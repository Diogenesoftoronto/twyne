//! Authored, uncompiled tests rebased onto Parent's responsive Dossier root.
//! Default-false TestWindow exercises refusal/identity/control boundaries,
//! not WGPU pixel output, presentation or actual retirement fences.
use super::*;
use crate::{
    dossier::DossierOptions,
    theme::{ThemePreference, ThemePreset},
};
use gpui_kit::{AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size};
use gpui_kit::test::TestWindowExt;
use tempfile::{TempDir, tempdir};

// This test's default platform ignores registered font bytes. Stamp preparation
// deliberately refuses its synthetic glyphs/metrics. Verify the actual accepted
// ordinary set without substituting stamps or granting a fake backend capability.
fn assert_prepared_set(view: &DossierView, with_group: bool) {
    let paper = view.paper.as_ref().expect("This fixture requires prepared paper");
    let mut expected = vec![paper.raster_image().clone()];
    if let Some(stamps) = &view.reviewed_stamps {
        for count in 0..crate::dossier_stamp::COUNT_VARIANTS {
            expected.push(
                stamps.stamp(count).expect("Complete real stamp set").raster_image().clone(),
            );
        }
    }
    assert!(matches!(expected.len(), 1 | 9), "Stamp sets are atomic, never partial");
    let group = view.prepared_multiply().expect("Prepared or transparent foxing");
    if with_group {
        expected.push(group.premultiplied_group().expect("Nontransparent group").clone());
    } else {
        assert!(group.is_transparent());
        assert!(group.premultiplied_group().is_none());
    }
    let actual = view.prepared_images();
    assert_eq!(actual.len(), expected.len());
    assert!(actual.len() <= crate::dossier_image_lifecycle::MAX_IMAGES_PER_CONSUMER);
    for (actual, expected) in actual.iter().zip(&expected) {
        assert_eq!(actual.id, expected.id, "Original preparation order retained");
        assert!(Arc::ptr_eq(actual, expected), "The lease retains the exact preparation");
    }
}

struct TestMountRoot {
    view: Entity<DossierView>,
    lifecycle: DossierImageLifecycle,
    show_view: bool,
    old_overlay: Option<AnyElement>,
}

impl Render for TestMountRoot {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .relative()
            .bg(rgb(theme::palette(cx).paper))
            .when(self.show_view, |root| root.child(self.view.clone()))
            .when_some(self.old_overlay.take(), |root, overlay| root.child(overlay))
            .child(self.lifecycle.marker())
    }
}

struct TestMountRoom {
    handle: AnyWindowHandle,
    root: Entity<TestMountRoot>,
    view: Entity<DossierView>,
    lifecycle: DossierImageLifecycle,
    _directory: TempDir,
}

fn mount_room(cx: &mut TestAppContext) -> TestMountRoom {
    let directory = tempdir().unwrap();
    let options = DossierOptions::default().with_recovery_directory(directory.path());
    let session = DossierSession::open(options, timestamp()).unwrap();
    let (handle, root, view, lifecycle) = cx.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
        init(cx);
        let (handle, root) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(1280.), px(860.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| {
                let lifecycle = DossierImageLifecycle::new(window, cx).unwrap();
                let view = cx.new(|cx| DossierView::new(session, window, cx));
                view.update(cx, |view, cx| {
                    view.attach_image_lifecycle(&lifecycle, window, cx).unwrap();
                });
                cx.new(|_| TestMountRoot {
                    view,
                    lifecycle,
                    show_view: true,
                    old_overlay: None,
                })
            },
        )
        .unwrap();
        let view = root.read(cx).view.clone();
        let lifecycle = root.read(cx).lifecycle.clone();
        (handle, root, view, lifecycle)
    });
    TestMountRoom {
        handle,
        root,
        view,
        lifecycle,
        _directory: directory,
    }
}

fn draw_test_frame(room: &TestMountRoom, cx: &mut TestAppContext) {
    cx.update_window(room.handle, |_, window, cx| {
        window.refresh();
        window.draw(cx).clear(cx);
    })
    .unwrap();
}

fn set_theme(room: &TestMountRoom, preset: ThemePreset, cx: &mut TestAppContext) {
    cx.update_window(room.handle, |_, window, cx| {
        theme::apply_preference(
            &ThemePreference {
                preset,
                ..Default::default()
            },
            cx,
        )
        .unwrap();
        // An explicit boundary avoids claiming an observer callback was
        // exercised synchronously within this same test update.
        room.view.update(cx, |view, cx| view.prepare_paper(window, cx));
    })
    .unwrap();
}

#[gpui_kit::test]
fn optional_group_is_tracked_and_unsupported_backend_keeps_live_controls(
    cx: &mut TestAppContext,
) {
    let room = mount_room(cx);
    let group = room.view.read_with(cx, |view, _| {
        let group = view
            .prepared_multiply()
            .unwrap()
            .premultiplied_group()
            .unwrap()
            .clone();
        let images = view.prepared_images();
        assert_prepared_set(view, true);
        assert_eq!(images.last().unwrap().id, group.id);
        assert!(Arc::ptr_eq(images.last().unwrap(), &group));
        group
    });
    draw_test_frame(&room, cx);
    cx.update_window(room.handle, |_, window, cx| {
        assert!(!window.supports_destination_multiply());
        assert_eq!(
            room.view.read(cx).foxing_paint_status(),
            DossierFoxingPaintStatus::UnsupportedBackend
        );
        assert!(!window.has_image_atlas_entry(&group));
        assert!(window.find("dossier-form").visible());
        window.press("secondary-a", cx);
        window.input("The last character!", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.update_window(room.handle, |_, _, cx| {
        let view = room.view.read(cx);
        assert_eq!(view.session.draft.answers.working_title, "The last character!");
        assert_eq!(view.session.draft.step, 1);
        assert_eq!(
            view.prepared_multiply()
                .unwrap()
                .premultiplied_group()
                .unwrap()
                .id,
            group.id,
            "Input/navigation retains the same prepared group"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn broadsheet_has_no_group_image_and_theme_restores_group(cx: &mut TestAppContext) {
    let room = mount_room(cx);
    set_theme(&room, ThemePreset::Broadsheet, cx);
    room.view.read_with(cx, |view, _| {
        assert!(view.prepared_multiply().unwrap().is_transparent());
        assert_prepared_set(view, false);
        assert!(view.foxing_overlay().is_none());
        assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::Transparent);
    });
    set_theme(&room, ThemePreset::Foolscap, cx);
    room.view.read_with(cx, |view, _| {
        assert!(!view.prepared_multiply().unwrap().is_transparent());
        assert_prepared_set(view, true);
        assert!(view.image_lease().unwrap().is_current());
    });
    // No claim about atlas retirement: that requires the actual normal
    // platform frame/marker boundary in Root's product probe.
}

#[gpui_kit::test]
fn old_overlay_cannot_upload_or_replace_new_group_receipt(cx: &mut TestAppContext) {
    let room = mount_room(cx);
    let (old_overlay, old_group) = room.view.read_with(cx, |view, _| {
        (
            view.foxing_overlay().unwrap().into_any_element(),
            view.prepared_multiply()
                .unwrap()
                .premultiplied_group()
                .unwrap()
                .clone(),
        )
    });
    set_theme(&room, ThemePreset::Nightpress, cx);
    room.view.read_with(cx, |view, _| {
        assert_ne!(
            view.prepared_multiply()
                .unwrap()
                .premultiplied_group()
                .unwrap()
                .id,
            old_group.id
        );
        assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::Prepared);
    });
    let observed = Rc::new(Cell::new(false));
    let observer = observed.clone();
    let watched_old_overlay = div()
        .absolute()
        .inset_0()
        .size_full()
        .child(old_overlay)
        .child(
            canvas(
                |_, _, _| (),
                move |_, (), _, _| observer.set(true),
            )
            .absolute()
            .inset_0()
            .size_full(),
        )
        .into_any_element();
    room.root.update(cx, |root, cx| {
        // Adversarial retained canvas: keep its old, still-current lease but
        // paint it after accepted pointers have changed. No fake capability.
        root.show_view = false;
        root.old_overlay = Some(watched_old_overlay);
        cx.notify();
    });
    draw_test_frame(&room, cx);
    assert!(observed.get(), "The retained overlay's live paint region was exercised");
    cx.update_window(room.handle, |_, window, cx| {
        assert_eq!(
            room.view.read(cx).foxing_paint_status(),
            DossierFoxingPaintStatus::Prepared
        );
        assert!(!window.has_image_atlas_entry(&old_group));
    })
    .unwrap();
}

#[gpui_kit::test]
fn manual_dpr_staleness_refuses_until_explicit_preparation(cx: &mut TestAppContext) {
    let room = mount_room(cx);
    let new_scale = cx.update_window(room.handle, |_, window, cx| {
        let old_scale = room.view.read(cx).prepared_multiply().unwrap().metrics().scale_factor();
        let new_scale = if old_scale == 1. { 2. } else { 1. };
        // The manual test override refreshes only; it does not fire a real
        // platform bounds observer or prepare a new image.
        window.set_scale_factor(new_scale);
        new_scale
    })
    .unwrap();
    draw_test_frame(&room, cx);
    room.view.read_with(cx, |view, _| {
        assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::StalePreparation);
    });
    cx.update_window(room.handle, |_, window, cx| {
        room.view.update(cx, |view, cx| view.prepare_paper(window, cx));
        assert_eq!(
            room.view.read(cx).prepared_multiply().unwrap().metrics().scale_factor(),
            new_scale
        );
    })
    .unwrap();
    draw_test_frame(&room, cx);
    room.view.read_with(cx, |view, _| {
        assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::UnsupportedBackend);
    });
}

#[gpui_kit::test]
fn dormant_theme_observer_cannot_revive_group_but_resume_tracks_current_one(
    cx: &mut TestAppContext,
) {
    let room = mount_room(cx);
    let (old_lease, old_group) = room.view.read_with(cx, |view, _| {
        (
            view.image_lease().unwrap().clone(),
            view.prepared_multiply()
                .unwrap()
                .premultiplied_group()
                .unwrap()
                .clone(),
        )
    });
    cx.update_window(room.handle, |_, window, cx| {
        room.lifecycle.retain_only(None, window, cx).unwrap();
    })
    .unwrap();
    set_theme(&room, ThemePreset::Nightpress, cx);
    room.view.read_with(cx, |view, _| {
        assert!(!old_lease.is_current());
        assert_eq!(
            view.prepared_multiply()
                .unwrap()
                .premultiplied_group()
                .unwrap()
                .id,
            old_group.id
        );
        assert!(view.foxing_overlay().is_none());
        assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::Untracked);
    });
    cx.update_window(room.handle, |_, window, cx| {
        room.view.update(cx, |view, cx| {
            view.resume_image_lifecycle(&room.lifecycle, window, cx).unwrap();
        });
        let view = room.view.read(cx);
        assert!(view.image_lease().unwrap().is_current());
        assert!(!old_lease.is_current());
        assert_prepared_set(view, true);
        assert_ne!(
            view.prepared_multiply()
                .unwrap()
                .premultiplied_group()
                .unwrap()
                .id,
            old_group.id
        );
        assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::Prepared);
    })
    .unwrap();
}

#[gpui_kit::test]
fn capped_wrapper_gutters_do_not_shrink_the_full_viewport_overlay(cx: &mut TestAppContext) {
    let room = mount_room(cx);
    for width in [620., 1600., 1280.] {
        // Real TestPlatform bounds-notification path, not an injected width.
        cx.simulate_window_resize(room.handle, size(px(width), px(860.)));
        draw_test_frame(&room, cx);
        cx.update_window(room.handle, |_, window, cx| {
            let root = window.find("dossier-form").bounds();
            let wrapper = window.find("dossier-folio-wrapper").bounds();
            assert_eq!(root.size.width, px(width));
            assert_eq!(root.size.height, px(860.));
            assert_eq!(wrapper.size.width, px(width.min(1472.)));
            assert_eq!(wrapper.origin.x, px((width - width.min(1472.)) / 2.));
            let view = room.view.read(cx);
            let metrics = view.prepared_multiply().unwrap().metrics();
            assert_eq!(metrics.width(), width);
            assert_eq!(metrics.height(), 860.);
            // The geometry/identity guards run before capability refusal. An
            // overlay inside the capped/gutter wrapper would instead be stale.
            assert_eq!(view.foxing_paint_status(), DossierFoxingPaintStatus::UnsupportedBackend);
            assert_prepared_set(view, true);
        })
        .unwrap();
    }
}
