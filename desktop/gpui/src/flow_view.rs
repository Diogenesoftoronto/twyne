//! The original two-colour status ribbon, rendered from its original SVG.
//!
//! The application supplies real rhythm snapshots and enabling preferences.
//! The view starts hidden and neither samples keys nor changes focus itself.

use crate::{
    flow::{FlowMode, FlowSnapshot},
    theme::{self, Palette, SANS_FONT, TYPEWRITER_FONT},
};
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::prelude::*;
use gpui_kit::{
    Animation, AnimationExt, AnyElement, Context, Font, Image, ImageFormat, IntoElement, Pixels,
    Render, Role, ShapedLine, SharedString, TestSupportExt, TextAlign, TextRun, Window, canvas,
    div, img, point, px, rgb,
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub const RIBBON_WIDTH_PX: f32 = 40.;
pub const RIBBON_HEIGHT_PX: f32 = 10.;
pub const RIBBON_GAP_PX: f32 = 0.4 * 16.;
pub const RIBBON_FONT_PX: f32 = 0.6875 * 16.;
pub const MANUSCRIPT_RIBBON_FONT_PX: f32 = 0.72 * 16.;
pub const RIBBON_TRACKING_PX: f32 = 0.1 * RIBBON_FONT_PX;
pub const RIBBON_LINE_HEIGHT_PX: f32 = RIBBON_FONT_PX * 1.5;
pub const LABEL_BREAKPOINT_PX: f32 = 640.;
pub const WORKSPACE_BREAKPOINT_PX: f32 = 639.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FlowRibbonHost {
    #[default]
    WritingWorkspace,
    Manuscript,
}
impl FlowRibbonHost {
    pub fn font_px(self) -> f32 {
        match self {
            Self::WritingWorkspace => RIBBON_FONT_PX,
            Self::Manuscript => MANUSCRIPT_RIBBON_FONT_PX,
        }
    }
    pub fn font_family(self) -> &'static str {
        match self {
            Self::WritingWorkspace => SANS_FONT,
            Self::Manuscript => TYPEWRITER_FONT,
        }
    }
    pub fn font_px_at(self, viewport_width: f32) -> f32 {
        if self == Self::Manuscript && viewport_width <= LABEL_BREAKPOINT_PX {
            0.75 * 16.
        } else {
            self.font_px()
        }
    }
    pub fn visible(self, viewport_width: f32) -> bool {
        self != Self::WritingWorkspace || viewport_width > WORKSPACE_BREAKPOINT_PX
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RibbonMotion {
    pub band_y: f32,
    pub band_opacity: f32,
    pub slack_opacity: f32,
}
impl RibbonMotion {
    pub fn for_mode(mode: FlowMode) -> Self {
        Self {
            band_y: match mode {
                FlowMode::Settling => -1.4,
                FlowMode::Flow => -2.8,
                _ => 0.,
            },
            band_opacity: if mode == FlowMode::Stuck { 0. } else { 1. },
            slack_opacity: if mode == FlowMode::Stuck { 0.7 } else { 0. },
        }
    }
}
fn svg(content: &str) -> String {
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10" width="40" height="10">{content}</svg>"#
    )
}
fn reels(colors: Palette) -> String {
    format!(
        r##"<circle cx="4" cy="5" r="3.2" fill="#{:06x}" stroke="#{:06x}" stroke-opacity="0.55" stroke-width="1"/><circle cx="36" cy="5" r="3.2" fill="#{:06x}" stroke="#{:06x}" stroke-opacity="0.55" stroke-width="1"/>"##,
        colors.paper, colors.ink, colors.paper, colors.ink
    )
}
fn band(colors: Palette) -> String {
    format!(
        r##"<rect x="4" y="2.2" width="32" height="2.8" fill="#{:06x}"/><rect x="4" y="5" width="32" height="2.8" fill="#{:06x}"/>"##,
        colors.ink, colors.vermilion
    )
}
fn slack(colors: Palette) -> String {
    format!(
        r##"<path d="M4 5 C 12 9, 20 1, 28 7 S 34 5, 36 5" fill="none" stroke="#{:06x}" stroke-width="2.4"/>"##,
        colors.ink
    )
}
/// Static inspection/export counterpart of the original component markup.
/// Native display uses separate layers so translated SVG artwork can overflow
/// the 10px spool, just as the original `.flow-ribbon__spool` does.
pub fn ribbon_svg(mode: FlowMode, colors: Palette) -> String {
    let motion = RibbonMotion::for_mode(mode);
    svg(&format!(
        r#"<g opacity="{}">{}<g transform="translate(0 {})" opacity="{}">{}</g><g opacity="{}">{}</g></g>"#,
        if mode == FlowMode::Away { 0.45 } else { 1. },
        reels(colors),
        motion.band_y,
        motion.band_opacity,
        band(colors),
        motion.slack_opacity,
        slack(colors)
    ))
}
#[derive(Clone)]
struct SpoolAssets {
    colors: [u32; 3],
    reels: Arc<Image>,
    band: Arc<Image>,
    slack: Arc<Image>,
}
impl SpoolAssets {
    fn new(colors: Palette) -> Self {
        let image =
            |source: String| Arc::new(Image::from_bytes(ImageFormat::Svg, source.into_bytes()));
        Self {
            colors: [colors.paper, colors.ink, colors.vermilion],
            reels: image(svg(&reels(colors))),
            band: image(svg(&band(colors))),
            slack: image(svg(&slack(colors))),
        }
    }
}
struct Transition {
    from: RibbonMotion,
    to: RibbonMotion,
    started: Instant,
    generation: u64,
}
impl Transition {
    fn current(&self) -> RibbonMotion {
        let elapsed = self.started.elapsed().as_secs_f32();
        let shift = css_ease((elapsed / 1.6).clamp(0., 1.));
        let fade = css_ease((elapsed / 1.2).clamp(0., 1.));
        RibbonMotion {
            band_y: lerp(self.from.band_y, self.to.band_y, shift),
            band_opacity: lerp(self.from.band_opacity, self.to.band_opacity, fade),
            slack_opacity: lerp(self.from.slack_opacity, self.to.slack_opacity, fade),
        }
    }
}
fn css_ease(progress: f32) -> f32 {
    gpui_kit::base::animation::cubic_bezier(0.25, 0.1, 0.25, 1.)(progress)
}
fn lerp(from: f32, to: f32, progress: f32) -> f32 {
    from + (to - from) * progress
}

struct TrackedPart {
    shape: ShapedLine,
    x: Pixels,
}
struct LabelLayout {
    key: (String, u32, FlowRibbonHost),
    width: Pixels,
    parts: Vec<TrackedPart>,
}
/// Immutable-key cache keeps SVG creation and font shaping out of input paths.
#[derive(Default)]
pub struct FlowRibbonView {
    snapshot: FlowSnapshot,
    host: FlowRibbonHost,
    reduced_motion: bool,
    transition: Option<Transition>,
    generation: u64,
    assets: Option<SpoolAssets>,
    label: Option<Arc<LabelLayout>>,
}
impl FlowRibbonView {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn snapshot(&self) -> &FlowSnapshot {
        &self.snapshot
    }
    pub fn set_host(&mut self, host: FlowRibbonHost, cx: &mut Context<Self>) {
        self.host = host;
        cx.notify();
    }
    pub fn set_snapshot(&mut self, snapshot: FlowSnapshot, cx: &mut Context<Self>) {
        if snapshot.enabled
            && self.snapshot.enabled
            && snapshot.mode != self.snapshot.mode
            && !self.reduced_motion
        {
            let from = self.transition.as_ref().map_or_else(
                || RibbonMotion::for_mode(self.snapshot.mode),
                Transition::current,
            );
            let to = RibbonMotion::for_mode(snapshot.mode);
            self.generation = self.generation.wrapping_add(1);
            self.transition = (from != to).then(|| Transition {
                from,
                to,
                started: Instant::now(),
                generation: self.generation,
            });
        } else if !snapshot.enabled || self.reduced_motion || !self.snapshot.enabled {
            self.transition = None;
        }
        self.snapshot = snapshot;
        cx.notify();
    }
    pub fn set_reduced_motion(&mut self, reduced_motion: bool, cx: &mut Context<Self>) {
        self.reduced_motion = reduced_motion;
        if reduced_motion {
            self.transition = None;
        }
        cx.notify();
    }
    fn label_layout(&mut self, label: String, color: u32, window: &mut Window) -> Arc<LabelLayout> {
        let key = (label, color, self.host);
        if let Some(layout) = &self.label
            && layout.key == key
        {
            return layout.clone();
        }
        let text: SharedString = key.0.clone().into();
        let run = TextRun {
            len: text.len(),
            font: Font {
                family: self.host.font_family().into(),
                features: theme::editorial_font_features(),
                ..Font::default()
            },
            color: rgb(color).into(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let shape = window
            .text_system()
            .shape_line(text, px(self.host.font_px()), &[run], None);
        let ends: Vec<_> = shape
            .text
            .char_indices()
            .map(|(start, character)| start + character.len_utf8())
            .collect();
        let tracking = self.host.font_px() * 0.1;
        let width = shape.width + px(tracking * ends.len() as f32);
        let mut cursor = shape.cursor();
        let mut start = 0;
        let parts = ends
            .iter()
            .enumerate()
            .map(|(index, &end)| {
                let x = shape.x_for_index(start) + px(tracking * index as f32);
                start = end;
                TrackedPart {
                    shape: cursor.take_until(end),
                    x,
                }
            })
            .collect();
        let layout = Arc::new(LabelLayout { key, width, parts });
        self.label = Some(layout.clone());
        layout
    }
}
impl Render for FlowRibbonView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.snapshot.enabled || !self.host.visible(f32::from(window.viewport_size().width)) {
            return div()
                .id("flow-ribbon-disabled")
                .test_support()
                .hidden()
                .into_any_element();
        }
        let colors = *theme::palette(cx);
        if self
            .assets
            .as_ref()
            .is_none_or(|assets| assets.colors != [colors.paper, colors.ink, colors.vermilion])
        {
            self.assets = Some(SpoolAssets::new(colors));
        }
        let assets = self.assets.as_ref().unwrap().clone();
        let mode = self.snapshot.mode;
        let target = RibbonMotion::for_mode(mode);
        let mut band_image = img(assets.band)
            .w(px(40.))
            .h(px(10.))
            .opacity(target.band_opacity)
            .into_any_element();
        let mut band_element = div()
            .id("flow-ribbon-band")
            .absolute()
            .left(px(0.))
            .top(px(target.band_y))
            .w(px(40.))
            .h(px(10.));
        let mut slack_image = img(assets.slack)
            .w(px(40.))
            .h(px(10.))
            .opacity(target.slack_opacity)
            .into_any_element();
        let mut band_animation = None;
        if !self.reduced_motion
            && let Some(transition) = &self.transition
        {
            let (from, to, generation) = (transition.from, transition.to, transition.generation);
            band_image = img(self.assets.as_ref().unwrap().band.clone())
                .w(px(40.))
                .h(px(10.))
                .with_animation(
                    SharedString::from(format!("flow-ribbon-band-opacity-{generation}")),
                    Animation::new(Duration::from_millis(1_200)).with_easing(css_ease),
                    move |image, delta| {
                        image.opacity(lerp(from.band_opacity, to.band_opacity, delta))
                    },
                )
                .into_any_element();
            slack_image = img(self.assets.as_ref().unwrap().slack.clone())
                .w(px(40.))
                .h(px(10.))
                .with_animation(
                    SharedString::from(format!("flow-ribbon-slack-opacity-{generation}")),
                    Animation::new(Duration::from_millis(1_200)).with_easing(css_ease),
                    move |image, delta| {
                        image.opacity(lerp(from.slack_opacity, to.slack_opacity, delta))
                    },
                )
                .into_any_element();
            band_animation = Some((from, to, generation));
        }
        band_element = band_element.child(band_image);
        let band_element: AnyElement = if let Some((from, to, generation)) = band_animation {
            band_element
                .with_animation(
                    SharedString::from(format!("flow-ribbon-band-shift-{generation}")),
                    Animation::new(Duration::from_millis(1_600)).with_easing(css_ease),
                    move |element, delta| element.top(px(lerp(from.band_y, to.band_y, delta))),
                )
                .into_any_element()
        } else {
            band_element.into_any_element()
        };
        let spool = div()
            .id("flow-ribbon-spool")
            .test_support()
            .relative()
            .flex_none()
            .w(px(RIBBON_WIDTH_PX))
            .h(px(RIBBON_HEIGHT_PX))
            .child(
                img(assets.reels)
                    .absolute()
                    .left(px(0.))
                    .top(px(0.))
                    .w(px(40.))
                    .h(px(10.)),
            )
            .child(band_element)
            .child(
                div()
                    .absolute()
                    .left(px(0.))
                    .top(px(0.))
                    .w(px(40.))
                    .h(px(10.))
                    .child(slack_image),
            );
        let label = self.snapshot.label();
        let title = mode.title();
        let mut element = div()
            .id("flow-ribbon")
            .test_support()
            .role(Role::Status)
            .aria_label(self.snapshot.accessibility_label())
            .aria_description(title)
            .flex()
            .items_center()
            .font_family(self.host.font_family())
            .text_size(px(self
                .host
                .font_px_at(f32::from(window.viewport_size().width))))
            .line_height(gpui_kit::relative(1.5))
            .gap(px(RIBBON_GAP_PX))
            .opacity(if mode == FlowMode::Away { 0.45 } else { 1. })
            .tooltip(move |window, cx| Tooltip::new(title).build(window, cx))
            .child(spool);
        if window.viewport_size().width > px(LABEL_BREAKPOINT_PX) {
            let color = if mode == FlowMode::Flow {
                colors.vermilion
            } else {
                colors.ink_light
            };
            let layout = self.label_layout(label.to_uppercase(), color, window);
            let width = layout.width;
            let line_height = self.host.font_px() * 1.5;
            element = element.child(
                div()
                    .id("flow-ribbon-label")
                    .test_support()
                    .role(Role::Label)
                    .aria_label(label)
                    .w(width)
                    .h(px(line_height))
                    .child(
                        canvas(
                            |_, _, _| (),
                            move |bounds, _, window, cx| {
                                for part in &layout.parts {
                                    let _ = part.shape.paint(
                                        bounds.origin + point(part.x, px(0.)),
                                        px(line_height),
                                        TextAlign::Left,
                                        None,
                                        window,
                                        cx,
                                    );
                                }
                            },
                        )
                        .w(width)
                        .h(px(line_height)),
                    ),
            );
        }
        element.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::TwyneAssets;
    use serde_json::Value;

    #[test]
    fn original_browser_computed_states_match_native_geometry_and_host_rules() {
        let reference: Value =
            serde_json::from_str(include_str!("../fixtures/flow/ribbon-reference.json")).unwrap();
        assert_eq!(reference["blockedNetworkRequests"], 0);
        for case in reference["cases"].as_array().unwrap() {
            let host = if case["host"] == "writingWorkspace" {
                FlowRibbonHost::WritingWorkspace
            } else {
                FlowRibbonHost::Manuscript
            };
            let mode: FlowMode = serde_json::from_value(case["mode"].clone()).unwrap();
            let result = &case["result"];
            let width = case["width"].as_f64().unwrap() as f32;
            assert_eq!(host.visible(width), result["visible"].as_bool().unwrap());
            assert_eq!(
                width > LABEL_BREAKPOINT_PX,
                result["labelVisible"].as_bool().unwrap()
            );
            assert_eq!(
                format!("{}px", host.font_px_at(width)),
                result["fontSize"].as_str().unwrap()
            );
            assert_eq!(result["title"], mode.title());
            assert_eq!(result["role"], "status");
            assert_eq!(result["ariaLive"], "off");
            let motion = RibbonMotion::for_mode(mode);
            let transform = result["bandTransform"].as_str().unwrap();
            let band_y = if transform == "none" {
                0.
            } else {
                transform
                    .trim_start_matches("matrix(")
                    .trim_end_matches(')')
                    .rsplit(',')
                    .next()
                    .unwrap()
                    .trim()
                    .parse::<f32>()
                    .unwrap()
            };
            if result["visible"] == true {
                // Browsers compute `none` for transforms beneath display: none.
                assert_eq!(motion.band_y, band_y, "{host:?} at {width}px: {mode:?}");
            }
            assert_eq!(result["gap"], "6.4px");
            assert_eq!(result["textTransform"], "uppercase");
            assert_eq!(
                f64::from(motion.band_opacity),
                result["bandOpacity"].as_f64().unwrap()
            );
            assert!(
                (f64::from(motion.slack_opacity) - result["slackOpacity"].as_f64().unwrap()).abs()
                    < 1e-6
            );
            assert_eq!(case["transitions"]["band"], "1.6s, 1.2s");
            assert_eq!(case["transitions"]["easing"], "ease, ease");
            assert_eq!(case["transitions"]["slack"], "1.2s");
            if result["visible"] == true {
                assert_eq!(result["spoolBounds"]["width"], RIBBON_WIDTH_PX);
                assert_eq!(result["spoolBounds"]["height"], RIBBON_HEIGHT_PX);
            }
        }
    }

    #[test]
    fn native_svg_raster_matches_original_browser_spool_with_codec_tolerance() {
        let renderer = gpui_kit::SvgRenderer::new(Arc::new(TwyneAssets));
        let palette = theme::ThemePreset::Editorial.palette(false);
        for mode in [
            FlowMode::Away,
            FlowMode::Working,
            FlowMode::Settling,
            FlowMode::Flow,
            FlowMode::Stuck,
        ] {
            let source = ribbon_svg(mode, palette);
            assert!(source.contains("M4 5 C 12 9, 20 1, 28 7 S 34 5, 36 5"));
            let parsed = renderer.parse_svg(source.as_bytes()).unwrap();
            // Pinned GPUI internally doubles SVG raster resolution. A scale
            // request of2 produces the same4× raster as this Chrome fixture.
            let native = renderer.render_parsed(&parsed, 2.).unwrap();
            let web = image::open(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("fixtures/flow")
                    .join(format!("web-spool-{}.png", mode.id())),
            )
            .unwrap()
            .into_rgba8();
            assert_eq!(web.dimensions(), (160, 40));
            assert_eq!(u32::from(native.size(0).width), web.width());
            assert_eq!(u32::from(native.size(0).height), web.height());
            let native = native.as_bytes(0).unwrap();
            let paper = [
                (palette.paper >> 16) as u8,
                (palette.paper >> 8) as u8,
                palette.paper as u8,
            ];
            let mut error = 0.;
            for (native, web) in native.as_chunks::<4>().0.iter().zip(web.pixels()) {
                for channel in 0..3 {
                    // GPUI converts resvg's premultiplied RGBA to straight
                    // BGRA. Composite it over the same original paper.
                    let alpha = f64::from(native[3]) / 255.;
                    let value = f64::from(native[2 - channel]) * alpha
                        + f64::from(paper[channel]) * (1. - alpha);
                    error += (value - f64::from(web.0[channel])).abs() / 255.;
                }
            }
            let mean = error / f64::from(web.width() * web.height() * 3);
            assert!(mean < 0.015, "{} raster error {mean}", mode.id());
            eprintln!("{} spool raster mean channel error={mean:.6}", mode.id());
        }
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod ui_tests {
    use super::*;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Bounds, Entity, Point, TestAppContext, WindowBounds, WindowOptions, size,
    };

    fn ribbon(cx: &mut TestAppContext, width: f32) -> (AnyWindowHandle, Entity<FlowRibbonView>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            cx.set_reduce_motion(true);
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(width), px(300.)),
                    })),
                    ..WindowOptions::default()
                },
                cx,
                |_, cx| cx.new(|_| FlowRibbonView::new()),
            )
            .unwrap()
        })
    }
    fn find(
        window: &Window,
        id: &'static str,
    ) -> Option<gpui_kit::base::test_support::ElementSnapshot> {
        gpui_kit::base::test_support::find(window, &[], &id.into())
    }
    #[gpui_kit::test]
    fn real_snapshot_controls_visibility_accessible_label_and_spool_bounds(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = ribbon(cx, 1_280.);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(find(window, "flow-ribbon").is_none());
            view.update(cx, |view, cx| {
                view.set_snapshot(
                    FlowSnapshot {
                        enabled: true,
                        mode: FlowMode::Working,
                        reading: None,
                    },
                    cx,
                )
            });
            window.render_frame(cx);
            assert_eq!(window.find("flow-ribbon").role(), Some(Role::Status));
            assert_eq!(
                window.find("flow-ribbon").label(),
                Some("writing. Twyne is reading your pace. The margin brings things in freely.")
            );
            assert_eq!(
                window.find("flow-ribbon-spool").bounds().size,
                size(px(40.), px(10.))
            );
            assert_eq!(
                window.find("flow-ribbon-label").bounds().size.height,
                px(16.5)
            );
            view.update(cx, |view, cx| {
                view.set_snapshot(FlowSnapshot::default(), cx)
            });
            window.render_frame(cx);
            assert!(find(window, "flow-ribbon").is_none());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn responsive_context_keeps_640px_spool_and_hides_workspace_at639px(cx: &mut TestAppContext) {
        for width in [640., 639.] {
            let (handle, view) = ribbon(cx, width);
            cx.update_window(handle, |_, window, cx| {
                view.update(cx, |view, cx| {
                    view.set_snapshot(
                        FlowSnapshot {
                            enabled: true,
                            mode: FlowMode::Settling,
                            reading: None,
                        },
                        cx,
                    )
                });
                window.render_frame(cx);
                assert_eq!(find(window, "flow-ribbon").is_some(), width == 640.);
                assert!(find(window, "flow-ribbon-label").is_none());
                view.update(cx, |view, cx| view.set_host(FlowRibbonHost::Manuscript, cx));
                window.render_frame(cx);
                assert!(find(window, "flow-ribbon").is_some());
                assert!(find(window, "flow-ribbon-label").is_none());
            })
            .unwrap();
        }
    }
}
