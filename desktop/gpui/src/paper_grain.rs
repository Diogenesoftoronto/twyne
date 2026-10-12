//! The room's original CSS paper tooth, painted without an input surface.
//!
//! Add `paper_grain()` as the first child of a positioned, paper-colored root.
//! The absolute canvas contributes no flow size, inserts no hitbox, and installs
//! no pointer/keyboard/focus handlers. Source masks are rasterized once; theme
//! changes prepare cached color images before paint. Polychrome painting avoids
//! GPUI's font contrast correction, which would change the original grain alpha.

use crate::{
    assets,
    theme::{self, Palette, ThemePreset},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    App, AssetSource, Bounds, Canvas, ContentMask, Global, Pixels, Point, RenderImage, Result,
    SvgRenderer, Window, canvas, point, px, size,
};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, OnceLock},
};

const RASTER_SCALE: f32 = 4.;
const TINT_CACHE_LIMIT: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GrainKey {
    dark: bool,
    tint: u32,
}
impl GrainKey {
    fn for_palette(palette: Palette) -> Option<Self> {
        (theme::paper_grain_opacities(palette) != [0.; 3]).then_some(Self {
            dark: palette.preset == ThemePreset::Nightpress,
            tint: theme::paper_grain_base(palette),
        })
    }
}
#[derive(Clone)]
struct GrainImages {
    key: GrainKey,
    images: [Arc<RenderImage>; 2],
}
struct PreparedGrain(Option<GrainImages>);
impl Global for PreparedGrain {}

struct AlphaRaster {
    width: u32,
    height: u32,
    alpha: Vec<u8>,
}
#[derive(Default)]
struct GrainCache {
    source: [Option<[AlphaRaster; 2]>; 2],
    tinted: VecDeque<GrainImages>,
    rasterizations: usize,
    preparations: usize,
}
fn cache() -> &'static Mutex<GrainCache> {
    static CACHE: OnceLock<Mutex<GrainCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(GrainCache::default()))
}
impl GrainCache {
    fn prepare(&mut self, key: GrainKey) -> Result<GrainImages> {
        if let Some(index) = self.tinted.iter().position(|images| images.key == key) {
            let images = self.tinted.remove(index).unwrap();
            self.tinted.push_front(images.clone());
            return Ok(images);
        }
        let index = usize::from(key.dark);
        if self.source[index].is_none() {
            let renderer = SvgRenderer::new(Arc::new(assets::TwyneAssets));
            let mut sources = Vec::with_capacity(2);
            for mask in assets::paper_grain_masks(key.dark) {
                let bytes = assets::TwyneAssets
                    .load(mask.path)?
                    .ok_or_else(|| anyhow::anyhow!("Missing embedded paper mask {}", mask.path))?;
                let image = renderer.render_single_frame(&bytes, RASTER_SCALE / 2.)?;
                let dimensions = image.size(0);
                sources.push(AlphaRaster {
                    width: dimensions.width.0 as u32,
                    height: dimensions.height.0 as u32,
                    alpha: image
                        .as_bytes(0)
                        .unwrap()
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .map(|pixel| pixel[3])
                        .collect(),
                });
                self.rasterizations += 1;
            }
            self.source[index] = Some(sources.try_into().ok().unwrap());
        }
        let mut images = Vec::with_capacity(2);
        for source in self.source[index].as_ref().unwrap() {
            let mut bytes = Vec::with_capacity(source.alpha.len() * 4);
            for alpha in &source.alpha {
                // RenderImage's straight BGRA input is shared with GPUI's SVG decoder.
                bytes.extend_from_slice(&[
                    key.tint as u8,
                    (key.tint >> 8) as u8,
                    (key.tint >> 16) as u8,
                    *alpha,
                ]);
            }
            let image = image::RgbaImage::from_raw(source.width, source.height, bytes).unwrap();
            images.push(Arc::new(RenderImage::new(vec![image::Frame::new(image)])));
        }
        let images = GrainImages {
            key,
            images: images.try_into().ok().unwrap(),
        };
        self.preparations += 1;
        self.tinted.push_front(images.clone());
        self.tinted.truncate(TINT_CACHE_LIMIT);
        Ok(images)
    }
}

/// Called by theme application at an explicit preference/OS boundary. Frames
/// and keystrokes only clone ready images; they never generate/rasterize assets.
pub fn prepare_palette(palette: Palette, cx: &mut App) -> Result<()> {
    let key = GrainKey::for_palette(palette);
    if cx
        .try_global::<PreparedGrain>()
        .is_some_and(|prepared| prepared.0.as_ref().map(|images| images.key) == key)
    {
        return Ok(());
    }
    let images = key
        .map(|key| {
            cache()
                .lock()
                .map_err(|_| anyhow::anyhow!("Paper grain cache lock is poisoned"))?
                .prepare(key)
        })
        .transpose()?;
    cx.set_global(PreparedGrain(images));
    Ok(())
}

/// The original body background starts at the room's window-space origin.
pub fn paper_grain() -> Canvas<()> {
    paper_grain_at(Point::default())
}

/// Supply the body's translated window-space origin when its paper scrolls.
/// Clip/resize never restarts the pattern: phase follows this anchor.
pub fn paper_grain_at(anchor: Point<Pixels>) -> Canvas<()> {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, cx| {
            if let Err(error) = paint_paper_grain(bounds, anchor, *theme::palette(cx), window, cx) {
                eprintln!("Could not paint Twyne's paper grain: {error:#}");
            }
        },
    )
    .absolute()
    .inset_0()
    .size_full()
}

/// Low-level seam for an existing paint callback. Returns the number of painted
/// tiles. Broadsheet returns zero before loading or rasterizing any asset.
pub fn paint_paper_grain(
    bounds: Bounds<Pixels>,
    anchor: Point<Pixels>,
    palette: Palette,
    window: &mut Window,
    cx: &App,
) -> Result<usize> {
    if theme::paper_grain_opacities(palette) == [0.; 3] {
        return Ok(0);
    }
    let visible = bounds.intersect(&window.content_mask().bounds);
    let images = cx
        .try_global::<PreparedGrain>()
        .and_then(|prepared| prepared.0.as_ref())
        .filter(|images| Some(images.key) == GrainKey::for_palette(palette))
        .ok_or_else(|| anyhow::anyhow!("Apply the paper palette before painting its grain"))?;
    window.with_content_mask(Some(ContentMask { bounds: visible }), |window| {
        let mut painted = 0;
        for (mask, image) in assets::paper_grain_masks(images.key.dark)
            .into_iter()
            .zip(&images.images)
        {
            for tile in TileGrid::new(visible, anchor, mask.period_px) {
                window.paint_image(tile, tile, Default::default(), image.clone(), 0, false)?;
                painted += 1;
            }
        }
        Ok(painted)
    })
}

/// Constant-space traversal of only the tiles intersecting the current clip.
struct TileGrid {
    active: bool,
    first_x: f32,
    x: f32,
    y: f32,
    right: f32,
    bottom: f32,
    period: f32,
}
impl TileGrid {
    fn new(bounds: Bounds<Pixels>, anchor: Point<Pixels>, period: f32) -> Self {
        let left = f32::from(bounds.origin.x);
        let top = f32::from(bounds.origin.y);
        let width = f32::from(bounds.size.width);
        let height = f32::from(bounds.size.height);
        let first_x = left - (left - f32::from(anchor.x)).rem_euclid(period);
        let first_y = top - (top - f32::from(anchor.y)).rem_euclid(period);
        let right = left + width;
        let bottom = top + height;
        let valid = [
            left, top, width, height, first_x, first_y, right, bottom, period,
        ]
        .iter()
        .all(|value| value.is_finite())
            && period > 0.
            && width > 0.
            && height > 0.;
        Self {
            active: valid,
            first_x,
            x: first_x,
            y: first_y,
            right,
            bottom,
            period,
        }
    }
}
impl Iterator for TileGrid {
    type Item = Bounds<Pixels>;

    fn next(&mut self) -> Option<Self::Item> {
        if !self.active || self.y >= self.bottom || self.x >= self.right {
            return None;
        }
        let tile = Bounds {
            origin: point(px(self.x), px(self.y)),
            size: size(px(self.period), px(self.period)),
        };
        let next_x = self.x + self.period;
        if next_x <= self.x {
            self.active = false;
        }
        self.x = next_x;
        if self.x >= self.right {
            self.x = self.first_x;
            let next_y = self.y + self.period;
            if next_y <= self.y {
                self.active = false;
            }
            self.y = next_y;
        }
        Some(tile)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::AssetSource;

    #[test]
    fn original_css_geometry_and_opacities_are_embedded_without_runtime_files() {
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../assets/paper-grain.json")).unwrap();
        assert_eq!(reference["backgroundPosition"], "0% 0%, 0% 0%, 0% 0%");
        assert_eq!(reference["backgroundRepeat"], "repeat, repeat, repeat");
        for (index, layer) in theme::paper_grain(theme::EDITORIAL).iter().enumerate() {
            assert_eq!(
                layer.period_px,
                reference["layers"][index]["period"].as_f64().unwrap() as f32
            );
            assert_eq!(
                layer.center_x,
                reference["layers"][index]["x"].as_f64().unwrap() as f32
            );
            assert_eq!(
                layer.center_y,
                reference["layers"][index]["y"].as_f64().unwrap() as f32
            );
            assert_eq!(
                layer.radius_px,
                reference["layers"][index]["radius"].as_f64().unwrap() as f32
            );
        }
        assert_eq!(theme::paper_grain_opacities(theme::BROADSHEET), [0.; 3]);
        assert_eq!(theme::paper_grain_base(theme::NIGHTPRESS), 0);
        for dark in [false, true] {
            for mask in assets::paper_grain_masks(dark) {
                let data = assets::TwyneAssets.load(mask.path).unwrap().unwrap();
                let svg = std::str::from_utf8(&data).unwrap();
                assert!(svg.contains("<radialGradient"));
                assert!(svg.contains("patternUnits=\"userSpaceOnUse\""));
                assert_eq!(mask.period_px.rem_euclid(4.), 0.);
            }
        }
    }

    #[test]
    fn clipping_resize_and_scroll_keep_the_original_body_phase() {
        let bounds = Bounds {
            origin: point(px(20.), px(30.)),
            size: size(px(370.), px(360.)),
        };
        let tiles: Vec<_> = TileGrid::new(bounds, Point::default(), 364.).collect();
        assert_eq!(tiles.len(), 4);
        assert_eq!(tiles[0].origin, Point::default());
        assert_eq!(tiles[3].origin, point(px(364.), px(364.)));
        let scrolled = TileGrid::new(bounds, point(px(-14.), px(-27.)), 364.)
            .next()
            .unwrap();
        assert_eq!(scrolled.origin, point(px(-14.), px(-27.)));
        let resized = Bounds {
            size: size(px(1.), px(1.)),
            ..bounds
        };
        assert_eq!(
            TileGrid::new(resized, Point::default(), 364.)
                .next()
                .unwrap()
                .origin,
            Point::default()
        );
        assert!(
            TileGrid::new(Bounds::default(), Point::default(), 364.)
                .next()
                .is_none()
        );
    }

    #[test]
    fn native_theme_settings_match_the_executed_original_css() {
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/paper-grain/web-reference.json"))
                .unwrap();
        assert_eq!(reference["blockedNetworkRequests"], 0);
        for case in reference["cases"].as_array().unwrap() {
            let preference = theme::normalize_preference(&case["preference"]);
            let dark = case["prefersDark"].as_bool().unwrap();
            let palette = theme::resolve_palette(&preference, dark);
            assert_eq!(
                serde_json::to_value(&preference).unwrap(),
                case["preference"]
            );
            assert_eq!(palette.preset.id(), case["result"]["resolved"]);
            assert_eq!(
                serde_json::to_value(theme::resolved_token_values(&preference, dark)).unwrap(),
                case["tokens"]
            );
            assert_eq!(
                case["result"]["backgroundSize"],
                "7px 7px, 11px 11px, 13px 13px"
            );
            assert_eq!(case["result"]["backgroundPosition"], "0% 0%, 0% 0%, 0% 0%");
            assert_eq!(case["result"]["backgroundRepeat"], "repeat, repeat, repeat");
            assert_eq!(case["result"]["opacity"], "1");
            assert_eq!(case["result"]["bodyOrigin"], case["anchor"]);
            for (index, alpha) in theme::paper_grain_opacities(palette)
                .into_iter()
                .enumerate()
            {
                let web = &case["result"]["grain"][index];
                assert!((f64::from(alpha) - web["alpha"].as_f64().unwrap()).abs() < 1e-6);
                if alpha != 0. {
                    assert_eq!(
                        u64::from(theme::paper_grain_base(palette)),
                        web["rgb"].as_u64().unwrap()
                    );
                }
            }
        }
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod ui_tests {
    use super::*;
    use gpui_kit::component::input::{Input, InputState};
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AppContext, Context, Entity, HeadlessAppContext, IntoElement, NoopTextSystem, Render,
        TestApp, TestSupportExt, div, rgb,
    };
    use std::sync::Arc;

    struct InteractionProbe {
        input: Entity<InputState>,
        clicks: usize,
        grain: bool,
    }
    impl Render for InteractionProbe {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let mut root = div()
                .relative()
                .size_full()
                .flex()
                .flex_col()
                .gap(px(8.))
                .bg(rgb(theme::palette(cx).paper))
                .child(
                    div()
                        .id("grain-button")
                        .test_support()
                        .w(px(120.))
                        .h(px(32.))
                        .on_click(cx.listener(|view, _, _, cx| {
                            view.clicks += 1;
                            cx.notify();
                        }))
                        .child("Press"),
                )
                .child(Input::new(&self.input).id("grain-input").w(px(200.)));
            if self.grain {
                // Deliberately paint above controls to prove it has no hit surface.
                root = root.child(paper_grain());
            }
            root
        }
    }

    #[test]
    fn overlay_does_not_move_controls_or_intercept_clicks_keyboard_and_focus() {
        let mut app = TestApp::with_text_system_and_assets(
            Arc::new(NoopTextSystem::new()),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let mut window = app.open_window(|window, cx| InteractionProbe {
            input: cx.new(|cx| InputState::new(window, cx)),
            clicks: 0,
            grain: false,
        });
        let handle = window.handle();
        let before = app.update(|cx| {
            cx.update_window(handle.into(), |_, window, cx| {
                window.render_frame(cx);
                (
                    window.find("grain-button").bounds(),
                    window.find("grain-input").bounds(),
                )
            })
            .unwrap()
        });
        window.update(|view, _, cx| {
            view.grain = true;
            cx.notify();
        });
        app.update(|cx| {
            cx.update_window(handle.into(), |_, window, cx| {
                window.render_frame(cx);
                assert_eq!(window.find("grain-button").bounds(), before.0);
                assert_eq!(window.find("grain-input").bounds(), before.1);
                window.click("grain-button", cx);
            })
            .unwrap();
        });
        assert_eq!(window.read(|view, _| view.clicks), 1);
        app.update(|cx| {
            cx.update_window(handle.into(), |_, window, cx| {
                window.click("grain-input", cx);
                window.input("A paper room 🦊", cx);
                window.press("left", cx);
                window.input("!", cx);
            })
            .unwrap();
        });
        assert_eq!(
            window.read(|view, cx| view.input.read(cx).value().to_string()),
            "A paper room !🦊"
        );
        window.update(|view, _, cx| {
            view.grain = false;
            cx.notify();
        });
        app.update(|cx| {
            cx.update_window(handle.into(), |_, window, cx| {
                window.render_frame(cx);
                window.input("still focused ", cx);
            })
            .unwrap();
        });
        assert_eq!(
            window.read(|view, cx| view.input.read(cx).value().to_string()),
            "A paper room !still focused 🦊"
        );
    }

    #[derive(Default)]
    struct PixelProbe {
        anchor: Point<Pixels>,
        clip: Option<Bounds<Pixels>>,
    }
    impl Render for PixelProbe {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let palette = *theme::palette(cx);
            let anchor = self.anchor;
            let grain = if let Some(clip) = self.clip {
                canvas(
                    |_, _, _| (),
                    move |_, (), window, cx| {
                        paint_paper_grain(clip, anchor, palette, window, cx).unwrap();
                    },
                )
                .absolute()
                .inset_0()
                .size_full()
                .into_any_element()
            } else {
                paper_grain_at(anchor).into_any_element()
            };
            div()
                .relative()
                .size_full()
                .bg(rgb(palette.paper))
                .child(grain)
        }
    }

    #[test]
    #[ignore = "requires an explicit local GPU/software Vulkan renderer"]
    fn actual_native_gpu_pixels_match_original_css_and_reuse_cached_masks() {
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/paper-grain/web-reference.json"))
                .unwrap();
        let mut app = HeadlessAppContext::with_platform(
            Arc::new(NoopTextSystem::new()),
            Arc::new(assets::TwyneAssets),
            gpui_kit::platform::current_headless_renderer,
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let window = app
            .open_window(size(px(440.), px(390.)), |_, cx| {
                cx.new(|_| PixelProbe::default())
            })
            .unwrap();
        let capture =
            std::env::var_os("TWYNE_PAPER_GRAIN_CAPTURE_DIR").map(std::path::PathBuf::from);
        if let Some(path) = &capture {
            std::fs::create_dir_all(path).unwrap();
        }
        let mut metrics = Vec::new();
        for case in reference["cases"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            let mut preference = theme::normalize_preference(&case["preference"]);
            preference.preset = preference
                .preset
                .resolve(case["prefersDark"].as_bool().unwrap());
            app.update(|cx| theme::apply_preference(&preference, cx).unwrap());
            app.update_window(window.into(), |root, window, cx| {
                root.downcast::<PixelProbe>()
                    .unwrap()
                    .update(cx, |view, cx| {
                        view.anchor = point(
                            px(case["anchor"]["x"].as_f64().unwrap() as f32),
                            px(case["anchor"]["y"].as_f64().unwrap() as f32),
                        );
                        view.clip = case["clip"].as_object().map(|clip| Bounds {
                            origin: point(
                                px(clip["x"].as_f64().unwrap() as f32),
                                px(clip["y"].as_f64().unwrap() as f32),
                            ),
                            size: size(
                                px(clip["width"].as_f64().unwrap() as f32),
                                px(clip["height"].as_f64().unwrap() as f32),
                            ),
                        });
                        cx.notify();
                    });
                window.render_frame(cx);
                assert_eq!(window.scale_factor(), 2.);
            })
            .unwrap();
            let count = {
                let cache = cache().lock().unwrap();
                (cache.rasterizations, cache.preparations)
            };
            let native = app.capture_screenshot(window.into()).unwrap();
            app.update_window(window.into(), |_, window, cx| window.render_frame(cx))
                .unwrap();
            assert_eq!(
                {
                    let cache = cache().lock().unwrap();
                    (cache.rasterizations, cache.preparations)
                },
                count,
                "{id}: repeat frame must not rasterize or tint assets"
            );
            let web = image::open(format!(
                "{}/fixtures/paper-grain/web-{id}.png",
                env!("CARGO_MANIFEST_DIR")
            ))
            .unwrap()
            .into_rgba8();
            assert_eq!(native.dimensions(), web.dimensions());
            let palette = theme::resolve_palette(&preference, false);
            let paper = [
                (palette.paper >> 16) as u8,
                (palette.paper >> 8) as u8,
                palette.paper as u8,
            ];
            let mut difference = 0_u64;
            let mut flat_difference = 0_u64;
            let mut max_difference = 0_u8;
            for (actual, expected) in native.pixels().zip(web.pixels()) {
                for channel in 0..3 {
                    let delta = actual[channel].abs_diff(expected[channel]);
                    difference += u64::from(delta);
                    flat_difference += u64::from(paper[channel].abs_diff(expected[channel]));
                    max_difference = max_difference.max(delta);
                }
            }
            let mae =
                difference as f64 / (f64::from(native.width()) * f64::from(native.height()) * 3.);
            println!(
                "{id}: byte MAE {mae:.6}, max {max_difference}, error-to-flat {}",
                difference as f64 / flat_difference.max(1) as f64
            );
            if let Some(path) = &capture {
                native.save(path.join(format!("native-{id}.png"))).unwrap();
            }
            if palette.preset == ThemePreset::Broadsheet {
                assert_eq!(difference, 0, "{id}: flat paper must match exactly");
            } else {
                assert!(mae < 0.06, "{id}: native grain raster drift");
                assert!(max_difference <= 4, "{id}: native grain peak drift");
                assert!(
                    (difference as f64) < flat_difference as f64 * 0.7,
                    "{id}: texture must improve on missing/flat grain"
                );
            }
            metrics.push(serde_json::json!({"id":id,"byteMae":mae,"maxDifference":max_difference,"errorToFlat":difference as f64 / flat_difference.max(1) as f64}));
        }
        let cache = cache().lock().unwrap();
        assert_eq!(
            cache.rasterizations, 4,
            "Only the four original masks are rasterized"
        );
        assert!(cache.tinted.len() <= TINT_CACHE_LIMIT);
        if let Some(path) = &capture {
            std::fs::write(path.join("native-metrics.json"), serde_json::to_string_pretty(&serde_json::json!({"renderer":"GPUI platform WGPU HeadlessRenderer", "deviceScaleFactor":2, "maskRasterizations":cache.rasterizations, "tintPreparations":cache.preparations, "cachedTints":cache.tinted.len(), "cases":metrics})).unwrap()).unwrap();
        }
    }
}
