// Authored mounted regressions, not an execution receipt. Included inside
// dossier_view::tests::layout_correction only by the unapplied local patch.
use super::*;
use gpui_kit::{ScrollDelta, point};

fn close(actual: Pixels, expected: f32, label: &str) {
    assert!(
        (f32::from(actual) - expected).abs() <= 1.,
        "{label}: expected {expected}px, got {actual:?}"
    );
}

fn resize(cx: &TestAppContext, handle: AnyWindowHandle, width: f32, height: f32) {
    // Invoke the actual platform bounds-notification path, including existing
    // retained paper preparation. Changing a local width variable is not resize.
    cx.simulate_window_resize(handle, size(px(width), px(height)));
}

#[gpui_kit::test]
fn capped_folio_uses_source_border_box_gutters_after_real_bounds_notifications(
    cx: &mut TestAppContext,
) {
    let (handle, view, _directory) = form(cx, DossierOptions::default());
    let before = cx.update(|cx| view.read(cx).session.draft.clone());
    for width in [320., 620., 639., 640., 1023., 1024., 1472., 1600., 1280.] {
        resize(cx, handle, width, 860.);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let root = window.find("dossier-form").bounds();
            let wrapper = window.find("dossier-folio-wrapper").bounds();
            let frame = window.find("dossier-frame").bounds();
            let cap = width.min(1472.);
            let (x_padding, y_padding) = if width < 640. { (12., 12.) } else { (20., 16.) };
            close(root.size.width, width, "full-viewport paper width");
            close(root.size.height, 860., "full-viewport paper height");
            close(wrapper.size.width, cap, "1472px wrapper border-box cap");
            close(wrapper.origin.x, (width - cap) / 2., "centered wrapper");
            close(wrapper.size.height, 860., "wrapper grows with viewport");
            close(frame.origin.x, (width - cap) / 2. + x_padding, "frame x");
            close(frame.origin.y, y_padding, "frame y");
            close(frame.size.width, cap - 2. * x_padding, "frame width");
            close(frame.size.height, 860. - 2. * y_padding, "frame height");
            assert_eq!(view.read(cx).session.draft, before);
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn small_preview_and_surface_caption_change_at_the_source_sm_boundary(cx: &mut TestAppContext) {
    let (handle, view, _directory) = form(cx, DossierOptions::default());
    for width in [620., 639., 640., 641., 1280., 620.] {
        resize(cx, handle, width, 860.);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let first = window.find(("dossier-preview-field", 0_usize)).bounds();
            let second = window.find(("dossier-preview-field", 1_usize)).bounds();
            if width < 640. {
                close(
                    first.origin.x,
                    f32::from(second.origin.x),
                    "single-column cards",
                );
                assert!(
                    second.top() >= first.bottom() + px(5.),
                    "one-column row gap"
                );
                assert!(window.try_find("dossier-surface-caption").is_none());
            } else {
                close(
                    first.origin.y,
                    f32::from(second.origin.y),
                    "two-column first row",
                );
                assert!(second.left() >= first.right() + px(5.), "two-column gutter");
                assert!(window.find("dossier-surface-caption").visible());
            }
            assert!(window.find("dossier-surface-form").visible());
            assert!(window.find("dossier-surface-conversation").visible());
            assert_eq!(
                window.find("dossier-surface-conversation").disabled(),
                Some(true)
            );
            assert_eq!(view.read(cx).session.draft.step, 0);
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn horizontal_roman_wheel_retains_unblurred_answer_and_calls_real_navigation(
    cx: &mut TestAppContext,
) {
    const SOURCE: &str = "#let retained(x) = x\r\n\r\n= Authored material\n";
    let (handle, view, _directory) = form(
        cx,
        DossierOptions {
            initial_material: PriorMaterial {
                text: "Authored material".into(),
                typst_source: Some(SOURCE.into()),
                ..PriorMaterial::default()
            },
            ..DossierOptions::default()
        },
    );
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("dossier-answer-0", cx);
        window.press("secondary-a", cx);
        window.input("Unblurred rail title 東京!", cx);
    })
    .unwrap();
    resize(cx, handle, 320., 860.);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let rail = window.find("dossier-section-rail").bounds();
        let back = window.find("dossier-back").bounds();
        let next = window.find("dossier-next").bounds();
        assert!(rail.size.width > px(0.));
        assert!(back.right() <= rail.left() + px(1.));
        assert!(rail.right() <= next.left() + px(1.));
        let last = window.find(("dossier-section", 9_usize)).bounds();
        assert!(
            last.center().x > rail.right(),
            "fixture must really overflow"
        );
        let before_width = last.size.width;
        let delta = last.center().x - rail.center().x;
        window.scroll(
            "dossier-section-rail",
            ScrollDelta::Pixels(point(-delta, px(0.))),
            cx,
        );
        let moved = window.find(("dossier-section", 9_usize));
        close(
            moved.bounds().size.width,
            f32::from(before_width),
            "nonshrinking numeral",
        );
        assert!(moved.visible());
        assert!(
            moved.bounds().center().x >= rail.left() && moved.bounds().center().x <= rail.right(),
            "last numeral's actual click point must be inside its scroll mask"
        );
        window.click(("dossier-section", 9_usize), cx);
        assert_eq!(view.read(cx).session.draft.step, 9);
        assert_eq!(
            view.read(cx).session.draft.answers.working_title,
            "Unblurred rail title 東京!"
        );
        assert_eq!(
            view.read(cx)
                .session
                .draft
                .prior_material
                .typst_source
                .as_deref(),
            Some(SOURCE)
        );
        let retained_x = window.find(("dossier-section", 9_usize)).bounds().origin.x;
        window.render_frame(cx);
        close(
            window.find(("dossier-section", 9_usize)).bounds().origin.x,
            f32::from(retained_x),
            "keyed rail scroll survives repaint",
        );
    })
    .unwrap();
    let restored = cx.update(|cx| {
        DossierSession::open(view.read(cx).session.options.clone(), timestamp()).unwrap()
    });
    assert!(restored.restored);
    assert_eq!(
        restored.draft.answers.working_title,
        "Unblurred rail title 東京!"
    );
    assert_eq!(
        restored.draft.prior_material.typst_source.as_deref(),
        Some(SOURCE)
    );
}

#[gpui_kit::test]
fn short_viewport_clips_overflow_without_changing_draft_or_paper_bounds(cx: &mut TestAppContext) {
    let (handle, view, _directory) = form(cx, DossierOptions::default());
    // Deliberately injected UI error state, not evidence of an actual disk
    // failure. It challenges the same frame mask with oversized normal flow.
    let before = cx.update(|cx| {
        view.update(cx, |view, cx| {
            view.error = Some("A retained diagnostic line.\n".repeat(50));
            cx.notify();
            view.session.draft.clone()
        })
    });
    resize(cx, handle, 1280., 240.);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let root = window.find("dossier-form").bounds();
        let frame = window.find("dossier-frame").bounds();
        close(root.size.height, 240., "viewport remains locked");
        close(frame.size.height, 208., "frame remains in its gutter box");
        let next = window.find("dossier-next");
        assert!(
            next.bounds().top() >= frame.bottom(),
            "oversized fixture reaches the mask"
        );
        assert!(
            !next.visible(),
            "fully masked footer cannot claim visible input"
        );
        assert_eq!(view.read(cx).session.draft, before);
    })
    .unwrap();
}
