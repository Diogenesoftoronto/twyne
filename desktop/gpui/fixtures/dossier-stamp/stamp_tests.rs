use super::*;
#[cfg(all(feature = "ui-tests", target_os = "linux"))]
use gpui_kit::test::TestWindowExt;

#[cfg(all(feature = "ui-tests", target_os = "linux"))]
static PREPARATION_TEST_LOCK: Mutex<()> = Mutex::new(());

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} differs from {expected}"
    );
}

#[test]
fn source_contract_and_exact_font_alphabet_are_preserved() {
    let source: serde_json::Value = serde_json::from_str(include_str!("source.json")).unwrap();
    for (name, expected) in [
        ("fontSizePx", FONT_SIZE_PX),
        ("trackingPx", TRACKING_PX),
        ("lineHeightPx", LINE_HEIGHT_PX),
        ("borderPx", BORDER_PX),
        ("paddingXPx", PADDING_X_PX),
        ("paddingYPx", PADDING_Y_PX),
        ("radiusPx", BORDER_RADIUS_PX),
        ("rotationDegrees", ROTATION_DEGREES),
        ("backgroundAlpha", BACKGROUND_ALPHA),
    ] {
        close(source["css"][name].as_f64().unwrap(), expected, 1e-12);
    }
    close(
        source["usedVerticalLayout"]["lineHeightPx"]
            .as_f64()
            .unwrap(),
        USED_LINE_HEIGHT_PX,
        1e-12,
    );
    close(
        source["usedVerticalLayout"]["paddingYPx"].as_f64().unwrap(),
        USED_PADDING_Y_PX,
        1e-12,
    );
    assert_eq!(source["css"]["fontFamily"], theme::TYPEWRITER_FONT);
    assert_eq!(source["css"]["colorToken"], "--color-vermilion");
    assert_eq!(source["css"]["transformOrigin"], "center center");
    let original = original_font().unwrap();
    assert_eq!(original.font_sha256, FONT_SHA);
    let alphabet: BTreeSet<_> = original
        .glyphs
        .values()
        .map(|glyph| glyph.character.as_str())
        .collect();
    assert_eq!(
        alphabet,
        [
            "0", "1", "2", "3", "4", "5", "6", "7", " ", "/", "R", "E", "V", "I", "W", "D"
        ]
        .into_iter()
        .collect()
    );
    assert_eq!(original.glyphs[&369].character, "0");
    assert_eq!(original.glyphs[&103].character, "1");
    assert_eq!(original.glyphs[&3].path, "");
    assert!(original.glyphs.values().all(|glyph| {
        glyph.advance_units > 0. && (glyph.character == " " || glyph.path.starts_with('M'))
    }));
}

#[test]
fn rotation_matches_retained_original_quad_without_changing_layout() {
    let source: serde_json::Value = serde_json::from_str(include_str!("source.json")).unwrap();
    let raw = source["retainedBrowserReceipt"]["row"]["box"]["border"]
        .as_array()
        .unwrap();
    let quad: [[f64; 2]; 4] = std::array::from_fn(|index| {
        [
            raw[index * 2].as_f64().unwrap(),
            raw[index * 2 + 1].as_f64().unwrap(),
        ]
    });
    let width = (quad[1][0] - quad[0][0]).hypot(quad[1][1] - quad[0][1]);
    let height = (quad[2][0] - quad[1][0]).hypot(quad[2][1] - quad[1][1]);
    close(height, 21.96875, 0.0001);
    // This receipt did not record the count. Derive width from its real quad,
    // rather than imposing an unverified label or rounded offsetWidth113.
    let geometry = StampGeometry::new(width - 20., 6.1875, 2.6125, 1.).unwrap();
    close(geometry.width_px, width, 1e-12);
    close(geometry.height_px, 21.96875, 1e-12);
    let expected = geometry.rotated_corners();
    let center = [
        quad.iter().map(|point| point[0]).sum::<f64>() / 4.,
        quad.iter().map(|point| point[1]).sum::<f64>() / 4.,
    ];
    for index in 0..4 {
        close(
            quad[index][0] - center[0],
            expected[index][0] - geometry.width_px / 2.,
            0.0001,
        );
        close(
            quad[index][1] - center[1],
            expected[index][1] - geometry.height_px / 2.,
            0.0001,
        );
    }
    // Negative rotation raises the right edge, with paint extending above and
    // below the fixed unrotated layout box (rounded22px offsetHeight), not a taller transformed flex item.
    assert!(expected[1][1] < expected[0][1]);
    assert!(geometry.paint_top_px < 0.);
    assert!(geometry.paint_left_px < 0.);
}

#[test]
fn device_scale_changes_raster_resolution_only() {
    let first = StampGeometry::new(93.344625, 6.1875, 2.6125, 1.).unwrap();
    for scale in [0.5, 1., 1.25, 2., 4.] {
        let current = StampGeometry::new(93.344625, 6.1875, 2.6125, scale).unwrap();
        assert_eq!(current.layout_size(), first.layout_size());
        assert_eq!(current.rotated_corners(), first.rotated_corners());
        assert_eq!(current.baseline_px, first.baseline_px);
        close(current.baseline_px, 12.771875, 1e-12);
        let right = current.paint_left_px + current.paint_width_px;
        let bottom = current.paint_top_px + current.paint_height_px;
        for [x, y] in current.rotated_corners() {
            assert!(x >= current.paint_left_px - 1e-12 && x <= right + 1e-12);
            assert!(y >= current.paint_top_px - 1e-12 && y <= bottom + 1e-12);
        }
        // Exact-sized render and natural image paint keep the ceil padding
        // below one device pixel instead of scaling the outlined artwork.
        assert!(right - (current.width_px - current.paint_left_px) < 1. / f64::from(scale));
        assert!(bottom - (current.height_px - current.paint_top_px) < 1. / f64::from(scale));
    }
}

#[test]
fn invalid_or_unbounded_geometry_is_refused() {
    for advance in [f64::NAN, f64::INFINITY, -1., 0., 513.] {
        assert!(StampGeometry::new(advance, 6., 3., 1.).is_err());
    }
    for scale in [f32::NAN, f32::INFINITY, 0., 0.49, 4.01] {
        assert!(StampGeometry::new(93., 6., 3., scale).is_err());
    }
    for metric in [f64::NAN, f64::INFINITY, -1., 18.] {
        assert!(StampGeometry::new(93., metric, 3., 1.).is_err());
        assert!(StampGeometry::new(93., 6., metric, 1.).is_err());
    }
    assert!(StampGeometry::new(512., 6., 3., 4.).is_err());
}

#[cfg(all(feature = "ui-tests", target_os = "linux"))]
#[test]
fn actual_registered_font_shapes_all_counts_and_reuses_prepared_rasters() {
    let _fixture_lock = PREPARATION_TEST_LOCK.lock().unwrap();
    use gpui_kit::HeadlessAppContext;
    let actual = gpui_kit::platform::current_platform(true).text_system();
    let mut app = HeadlessAppContext::with_asset_source(actual, Arc::new(TwyneAssets));
    app.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
        let shaper = WindowTextSystem::new(cx.text_system().clone());
        let color = theme::palette(cx).vermilion;
        let first = DossierStampSet::prepare(color, 1., &shaper, cx).unwrap();
        let same = DossierStampSet::prepare(color, 1., &shaper, cx).unwrap();
        assert!(Arc::ptr_eq(&first, &same));
        assert!(first.stamp(8).is_none());
        let original = original_font().unwrap();
        for reviewed in 0..COUNT_VARIANTS {
            let stamp = first.stamp(reviewed).unwrap();
            let label = format!("{reviewed} / 7 REVIEWED");
            assert_eq!(stamp.shape().label, label);
            assert_eq!(stamp.shape().glyphs.len(), 14);
            close(stamp.geometry().height_px, 21.96875, 1e-12);
            let advance_units: f64 = label
                .chars()
                .map(|character| {
                    original
                        .glyphs
                        .values()
                        .find(|glyph| glyph.character == character.to_string())
                        .unwrap()
                        .advance_units
                })
                .sum();
            close(
                stamp.shape().untracked_advance_px,
                advance_units * 8.8 / 2048.,
                0.002,
            );
            close(
                stamp.shape().tracked_advance_px - stamp.shape().untracked_advance_px,
                14. * 1.936,
                1e-12,
            );
            for glyph in &stamp.shape().glyphs {
                assert_eq!(
                    original.glyphs[&glyph.id].character,
                    label[glyph.index..glyph.index + 1],
                );
            }
            let svg = stamp.svg();
            assert!(!svg.contains("<text") && !svg.contains("font-family"));
            assert!(svg.contains("rotate(-3 ") && svg.contains("fill-opacity=\"0.04\""));
            for outline in original
                .glyphs
                .values()
                .filter(|glyph| label.contains(&glyph.character))
            {
                assert!(svg.contains(&outline.path));
            }
            let geometry = stamp.geometry();
            assert_eq!(
                stamp.raster_image().size(0).width.0 as u32,
                geometry.raster_width
            );
            assert_eq!(
                stamp.raster_image().size(0).height.0 as u32,
                geometry.raster_height
            );
            let pixels = stamp.raster_image().as_bytes(0).unwrap();
            assert!(pixels.as_chunks::<4>().1.is_empty());
            assert!(pixels.as_chunks::<4>().0.iter().any(|pixel| pixel[3] == 0));
            assert!(pixels.as_chunks::<4>().0.iter().any(|pixel| pixel[3] > 200));
            // Real raster alpha must reach beyond the unrotated Source used-height box.
            assert!(
                pixels
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .enumerate()
                    .any(|(index, pixel)| {
                        let y = (index / geometry.raster_width as usize) as f64 + 0.5;
                        let css_y = geometry.paint_top_px + y;
                        pixel[3] > 32 && !(0. ..geometry.height_px).contains(&css_y)
                    })
            );
        }
        let twice = DossierStampSet::prepare(color, 2., &shaper, cx).unwrap();
        assert!(!Arc::ptr_eq(&first, &twice));
        assert_eq!(
            first.stamp(7).unwrap().geometry().layout_size(),
            twice.stamp(7).unwrap().geometry().layout_size()
        );
        let changed = DossierStampSet::prepare(color ^ 0xff, 1., &shaper, cx).unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert!(!changed.matches(color, 1.));
        assert!(cache().lock().unwrap().sets.len() <= CACHE_SETS);
        assert!(DossierStampSet::prepare(0x100_0000, 1., &shaper, cx).is_err());
    });
}

#[cfg(all(feature = "ui-tests", target_os = "linux"))]
#[test]
fn distinct_application_font_namespaces_never_share_prepared_sets() {
    let _fixture_lock = PREPARATION_TEST_LOCK.lock().unwrap();
    use gpui_kit::HeadlessAppContext;
    let prepare = || {
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(actual, Arc::new(TwyneAssets));
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            DossierStampSet::prepare(theme::palette(cx).vermilion, 1., &shaper, cx).unwrap()
        })
    };
    let first = prepare();
    let next = prepare();
    assert!(!Arc::ptr_eq(&first, &next));
    assert!(!Arc::ptr_eq(
        first.stamp(0).unwrap().raster_image(),
        next.stamp(0).unwrap().raster_image()
    ));
}

#[cfg(all(feature = "ui-tests", target_os = "linux"))]
#[test]
fn stamp_has_fixed_layout_and_does_not_change_adjacent_input_or_focus() {
    let _fixture_lock = PREPARATION_TEST_LOCK.lock().unwrap();
    use gpui_kit::component::input::{Input, InputState};
    use gpui_kit::{AppContext, Context, Entity, IntoElement, Render, TestApp, rgb};

    struct Probe {
        stamp: Arc<DossierStamp>,
        visible: bool,
        input: Entity<InputState>,
        clicks: usize,
    }
    impl Render for Probe {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let stamp = if self.visible {
                self.stamp.element()
            } else {
                div()
                    .w(self.stamp.geometry().layout_size().width)
                    .h(self.stamp.geometry().layout_size().height)
                    .flex_shrink_0()
                    .into_any_element()
            };
            div()
                .size_full()
                .bg(rgb(theme::palette(cx).paper))
                .flex()
                .flex_col()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(40.))
                        .child(
                            div()
                                .id("stamp-neighbor")
                                .test_support()
                                .w(px(80.))
                                .h(px(28.))
                                .on_click(cx.listener(|view, _, _, cx| {
                                    view.clicks += 1;
                                    cx.notify();
                                }))
                                .child("Next"),
                        )
                        .child(stamp),
                )
                .child(Input::new(&self.input).id("stamp-input").w(px(240.)))
        }
    }

    let actual = gpui_kit::platform::current_platform(true).text_system();
    let mut app = TestApp::with_text_system_and_assets(actual, Arc::new(TwyneAssets));
    app.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
    });
    let mut view = app.open_window(|window, cx| {
        let stamp = DossierStampSet::prepare(
            theme::palette(cx).vermilion,
            window.scale_factor(),
            window.text_system(),
            cx,
        )
        .unwrap()
        .stamp(3)
        .unwrap()
        .clone();
        Probe {
            stamp,
            visible: false,
            input: cx.new(|cx| InputState::new(window, cx)),
            clicks: 0,
        }
    });
    let handle = view.handle();
    let before = app.update(|cx| {
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            (
                window.find("stamp-neighbor").bounds(),
                window.find("stamp-input").bounds(),
            )
        })
        .unwrap()
    });
    view.update(|view, _, cx| {
        view.visible = true;
        cx.notify();
    });
    app.update(|cx| {
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            let node = window.find("dossier-reviewed-stamp");
            close(f64::from(f32::from(node.bounds().size.height)), 22., 1e-9);
            assert_eq!(node.label(), Some("3 / 7 reviewed"));
            assert_eq!(node.role(), Some(Role::Label));
            assert_eq!(window.find("stamp-neighbor").bounds(), before.0);
            assert_eq!(window.find("stamp-input").bounds(), before.1);
            window.click("stamp-neighbor", cx);
            window.click("stamp-input", cx);
            window.input("Kept while reviewed", cx);
        })
        .unwrap();
    });
    assert_eq!(view.read(|view, _| view.clicks), 1);
    view.update(|_, _, cx| {
        cx.notify();
    });
    app.update(|cx| {
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            window.input("!", cx);
        })
        .unwrap();
    });
    assert_eq!(
        view.read(|view, cx| view.input.read(cx).value().to_string()),
        "Kept while reviewed!"
    );
}
