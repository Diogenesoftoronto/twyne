//! The Dossier's original `.paper-sheet` background, prepared outside paint.
//!
//! The seven CSS gradient layers use Source order, positions, colors and tile
//! periods. This is not the body's `paper_grain`: Broadsheet's sheet still has
//! ink stripes/dots even though that theme disables the body's grain tokens.
//!
//! Call [`DossierPaper::prepare`] at an explicit theme/viewport boundary, retain
//! the returned Arc, and add [`DossierPaper::background`] before the Dossier's
//! children on its positioned root. Size/theme changes must prepare a new key;
//! painting a stale image fails rather than stretching or rasterizing it.
//!
//! Source's `.paper-foxed::after` paints OVER descendants with group opacity
//! 0.7 and destination multiply. GPUI's image canvas has no such blend API.
//! [`DossierFoxingStatus`] exposes that boundary; no normal-alpha substitute is
//! painted. Inset-shadow inputs are retained exactly, but GPUI's blur/gradient
//! raster is not certified as Chromium pixel parity by this module.

use crate::{
    assets::TwyneAssets,
    theme::{self, Palette},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    App, Bounds, BoxShadow, Canvas, ContentMask, DevicePixels, Pixels, RenderImage, Result,
    SvgRenderer, SvgSize, Window, canvas, point, px, rgb, size,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fmt::Write,
    sync::{Arc, Mutex, OnceLock},
};

#[cfg(feature = "ui-tests")]
#[path = "../fixtures/dossier-paper-resize-performance/parent-adoption/diagnostics.rs"]
pub(crate) mod resize_diagnostics;

#[cfg(feature = "ui-tests")]
pub fn resize_diagnostic_snapshot() -> serde_json::Value {
    resize_diagnostics::snapshot()
}

/// The exact Source selectors extracted in the owned source-contract fixture.
pub const SOURCE_SELECTORS: [&str; 2] = [".paper-sheet", ".paper-foxed::after"];
pub const MAX_CSS_DIMENSION: f32 = 4096.;
pub const MAX_RASTER_DIMENSION: u32 = 8192;
pub const MAX_RASTER_PIXELS: u64 = 8_388_608;
pub const CACHE_ENTRIES: usize = 2;
pub const FOXING_GROUP_OPACITY: f64 = 0.7;

/// A circle's center is relative to its own CSS background positioning area.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct PaperCircle {
    pub x: f64,
    pub y: f64,
    pub color_alpha: f64,
    pub solid_radius_px: f64,
    pub transparent_radius_px: f64,
}

/// CSS backgrounds 5..7. Each circle is centered within its own repeated tile.
pub const PAPER_DOTS: [(f64, PaperCircle); 3] = [
    (
        5.,
        PaperCircle {
            x: 0.3,
            y: 0.4,
            color_alpha: 0.04,
            solid_radius_px: 1.,
            transparent_radius_px: 1.4,
        },
    ),
    (
        7.,
        PaperCircle {
            x: 0.7,
            y: 0.6,
            color_alpha: 0.035,
            solid_radius_px: 1.,
            transparent_radius_px: 1.4,
        },
    ),
    (
        9.,
        PaperCircle {
            x: 0.15,
            y: 0.85,
            color_alpha: 0.03,
            solid_radius_px: 1.,
            transparent_radius_px: 1.4,
        },
    ),
];

/// Source's five global spots are NOT tiled. Their opacity is applied to the
/// composed group after these layers, rather than independently to each spot.
pub const FOXING_SPOTS: [PaperCircle; 5] = [
    PaperCircle {
        x: 0.12,
        y: 0.18,
        color_alpha: 0.18,
        solid_radius_px: 1.2,
        transparent_radius_px: 2.5,
    },
    PaperCircle {
        x: 0.88,
        y: 0.32,
        color_alpha: 0.16,
        solid_radius_px: 0.9,
        transparent_radius_px: 2.,
    },
    PaperCircle {
        x: 0.24,
        y: 0.78,
        color_alpha: 0.14,
        solid_radius_px: 1.4,
        transparent_radius_px: 2.8,
    },
    PaperCircle {
        x: 0.76,
        y: 0.88,
        color_alpha: 0.18,
        solid_radius_px: 1.,
        transparent_radius_px: 2.2,
    },
    PaperCircle {
        x: 0.5,
        y: 0.5,
        color_alpha: 0.12,
        solid_radius_px: 0.8,
        transparent_radius_px: 2.,
    },
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DossierPaperMetrics {
    width: f32,
    height: f32,
    scale: f32,
    raster_width: u32,
    raster_height: u32,
}

impl DossierPaperMetrics {
    pub fn new(width: f32, height: f32, scale: f32) -> Result<Self> {
        anyhow::ensure!(
            width.is_finite()
                && height.is_finite()
                && (1. ..=MAX_CSS_DIMENSION).contains(&width)
                && (1. ..=MAX_CSS_DIMENSION).contains(&height),
            "Dossier paper dimensions must be finite CSS pixels in 1..={MAX_CSS_DIMENSION}"
        );
        anyhow::ensure!(
            scale.is_finite() && (0.5..=4.).contains(&scale),
            "Dossier paper device scale must be finite in 0.5..=4"
        );
        let raster_width = (width * scale).ceil() as u32;
        let raster_height = (height * scale).ceil() as u32;
        anyhow::ensure!(
            raster_width <= MAX_RASTER_DIMENSION
                && raster_height <= MAX_RASTER_DIMENSION
                && u64::from(raster_width) * u64::from(raster_height) <= MAX_RASTER_PIXELS,
            "Dossier paper exceeds its bounded raster dimensions/pixel budget"
        );
        Ok(Self {
            width,
            height,
            scale,
            raster_width,
            raster_height,
        })
    }

    pub fn width(self) -> f32 {
        self.width
    }
    pub fn height(self) -> f32 {
        self.height
    }
    pub fn scale_factor(self) -> f32 {
        self.scale
    }
    pub fn raster_size(self) -> (u32, u32) {
        (self.raster_width, self.raster_height)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PaperColors {
    paper: u32,
    raised: u32,
    ink: u32,
    foxing: u32,
    foxing_alpha_bits: u32,
    shade: u32,
}

impl PaperColors {
    fn from_palette(palette: Palette) -> Result<Self> {
        anyhow::ensure!(
            [
                palette.paper,
                palette.paper_soft,
                palette.ink,
                palette.foxing,
                palette.shade
            ]
            .into_iter()
            .all(|color| color <= 0xff_ffff),
            "Dossier paper palette contains a non-RGB color"
        );
        anyhow::ensure!(
            palette.foxing_alpha.is_finite() && (0. ..=1.).contains(&palette.foxing_alpha),
            "Dossier paper foxing alpha must be finite in 0..=1"
        );
        Ok(Self {
            paper: palette.paper,
            raised: palette.paper_soft,
            ink: palette.ink,
            foxing: palette.foxing,
            foxing_alpha_bits: palette.foxing_alpha.to_bits(),
            shade: palette.shade,
        })
    }

    fn foxing_alpha(self) -> f32 {
        f32::from_bits(self.foxing_alpha_bits)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PaperKey {
    colors: PaperColors,
    width_bits: u32,
    height_bits: u32,
    scale_bits: u32,
}

impl PaperKey {
    fn new(colors: PaperColors, metrics: DossierPaperMetrics) -> Self {
        Self {
            colors,
            width_bits: metrics.width.to_bits(),
            height_bits: metrics.height.to_bits(),
            scale_bits: metrics.scale.to_bits(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DossierFoxingStatus {
    /// Source's foxing color is transparent (currently Broadsheet).
    Transparent,
    /// Source requires multiply over arbitrary live descendants. GPUI's
    /// public image canvas does not support a destination-reading blend.
    UnsupportedDestinationMultiply,
}

/// A prepared CSS-derived background image, NOT full Source raster parity.
pub struct DossierPaper {
    key: PaperKey,
    metrics: DossierPaperMetrics,
    svg: Arc<str>,
    image: Arc<RenderImage>,
    shadows: [BoxShadow; 2],
}

#[derive(Default)]
struct PaperCache {
    ready: VecDeque<Arc<DossierPaper>>,
}

fn cache() -> &'static Mutex<PaperCache> {
    static CACHE: OnceLock<Mutex<PaperCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(PaperCache::default()))
}

impl DossierPaper {
    /// May be scheduled on a host background executor. This method is the
    /// sole rasterization path and never runs from `background` or paint.
    pub fn prepare(palette: Palette, metrics: DossierPaperMetrics) -> Result<Arc<Self>> {
        #[cfg(feature = "ui-tests")]
        let mut diagnostic =
            resize_diagnostics::Operation::for_metrics(resize_diagnostics::Kind::Paper, metrics);
        let colors = PaperColors::from_palette(palette)?;
        let key = PaperKey::new(colors, metrics);
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::Validation);
        let mut cache = cache()
            .lock()
            .map_err(|_| anyhow::anyhow!("Dossier paper cache lock is poisoned"))?;
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::CacheWait);
        #[cfg(feature = "ui-tests")]
        diagnostic.cache_before(cache.ready.len());
        if let Some(index) = cache.ready.iter().position(|paper| paper.key == key) {
            let paper = cache.ready.remove(index).unwrap();
            cache.ready.push_front(paper.clone());
            #[cfg(feature = "ui-tests")]
            diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::CacheLookup);
            #[cfg(feature = "ui-tests")]
            diagnostic.outcome("cacheHit");
            return Ok(paper);
        }
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::CacheLookup);
        let svg: Arc<str> = background_svg(colors, metrics).into();
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::SvgBuild);
        let renderer = SvgRenderer::new(Arc::new(TwyneAssets));
        let parsed = renderer.parse_svg(svg.as_bytes())?;
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::RendererAndParse);
        let image = renderer.render_parsed(
            &parsed,
            SvgSize::ExactSize(size(
                DevicePixels(metrics.raster_width as i32),
                DevicePixels(metrics.raster_height as i32),
            )),
        )?;
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::RasterAndBgraConversion);
        let paper = Arc::new(Self {
            key,
            metrics,
            svg,
            image,
            shadows: inset_shadows(colors),
        });
        cache.ready.push_front(paper.clone());
        #[cfg(feature = "ui-tests")]
        diagnostic.evictions(cache.ready.len().saturating_sub(CACHE_ENTRIES));
        cache.ready.truncate(CACHE_ENTRIES);
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::InstallAndEviction);
        #[cfg(feature = "ui-tests")]
        diagnostic.outcome("cacheMissPrepared");
        Ok(paper)
    }

    pub fn matches(&self, palette: Palette, metrics: DossierPaperMetrics) -> bool {
        PaperColors::from_palette(palette)
            .is_ok_and(|colors| self.key == PaperKey::new(colors, metrics))
    }

    pub fn metrics(&self) -> DossierPaperMetrics {
        self.metrics
    }

    /// Original layer geometry serialized as a standalone SVG. No fonts,
    /// external URLs, guessed grain noise, inset filters or foxing substitution.
    pub fn svg(&self) -> &str {
        &self.svg
    }

    /// Prepared native SVG raster for receipts/caching inspection. It contains
    /// backgrounds only; the paint callback adds GPUI's inset-shadow primitives.
    pub fn raster_image(&self) -> &Arc<RenderImage> {
        &self.image
    }

    pub fn foxing_status(&self) -> DossierFoxingStatus {
        if self.key.colors.foxing_alpha() == 0. {
            DossierFoxingStatus::Transparent
        } else {
            DossierFoxingStatus::UnsupportedDestinationMultiply
        }
    }

    /// Paint-only canvas. It contributes no layout size/hitbox/focus handlers.
    /// Use as the FIRST child of a positioned root with the measured metrics.
    pub fn background(self: &Arc<Self>) -> Canvas<()> {
        let paper = self.clone();
        canvas(
            |_, _, _| (),
            move |bounds, (), window, cx| {
                // The host retains its opaque CSS paper fill while a fresh
                // preparation is outstanding. No stale image is stretched.
                let _ = paper.paint_background(bounds, window, cx);
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }

    /// A missing/mismatched preparation is observable to low-level consumers.
    /// The caller must also check `matches` after async theme preparation.
    pub fn paint_background(
        &self,
        bounds: Bounds<Pixels>,
        window: &mut Window,
        cx: &App,
    ) -> Result<()> {
        anyhow::ensure!(
            f32::from(bounds.size.width).to_bits() == self.metrics.width.to_bits()
                && f32::from(bounds.size.height).to_bits() == self.metrics.height.to_bits()
                && window.scale_factor().to_bits() == self.metrics.scale.to_bits()
                && self.matches(*theme::palette(cx), self.metrics),
            "Prepare Dossier paper for the actual viewport/device scale before painting"
        );
        let visible = bounds.intersect(&window.content_mask().bounds);
        window.with_content_mask(Some(ContentMask { bounds: visible }), |window| {
            window.paint_image(
                bounds,
                bounds,
                Default::default(),
                self.image.clone(),
                0,
                false,
            )?;
            // CSS lists its topmost shadow first. GPUI paints in supplied order.
            window.paint_inset_shadows(bounds, Default::default(), &self.shadows);
            Ok(())
        })
    }
}

/// Pure preparation seam for layer/geometry fixtures, before any native raster.
pub fn paper_sheet_svg(palette: Palette, metrics: DossierPaperMetrics) -> Result<String> {
    Ok(background_svg(PaperColors::from_palette(palette)?, metrics))
}

/// Standalone Source foxing contract. This SVG is NOT passed to GPUI's normal
/// alpha canvas. A consumer needs an actual multiply-over-descendants target.
pub fn foxing_svg(palette: Palette, metrics: DossierPaperMetrics) -> Result<String> {
    let colors = PaperColors::from_palette(palette)?;
    let mut svg = svg_start(metrics);
    svg.push_str("<defs>");
    for (index, circle) in FOXING_SPOTS.iter().enumerate() {
        radial_definition(
            &mut svg,
            &format!("fox-{index}"),
            SvgRadial {
                x: circle.x * f64::from(metrics.width),
                y: circle.y * f64::from(metrics.height),
                radius: circle.transparent_radius_px,
                solid_fraction: circle.solid_radius_px / circle.transparent_radius_px,
                color: colors.foxing,
                alpha: circle.color_alpha * f64::from(colors.foxing_alpha()),
            },
        );
    }
    svg.push_str("</defs><g opacity=\"0.7\" style=\"mix-blend-mode:multiply\">");
    for index in (0..FOXING_SPOTS.len()).rev() {
        filled_rect(
            &mut svg,
            metrics.width,
            metrics.height,
            &format!("url(#fox-{index})"),
        );
    }
    svg.push_str("</g></svg>");
    Ok(svg)
}

fn inset_shadows(colors: PaperColors) -> [BoxShadow; 2] {
    // Back-to-front: source's 1px shade is under its first blurred foxing inset.
    [
        BoxShadow {
            color: rgb(colors.shade).opacity(0.04).into(),
            offset: point(px(0.), px(0.)),
            blur_radius: px(0.),
            spread_radius: px(1.),
            inset: true,
        },
        BoxShadow {
            color: rgb(colors.foxing)
                .opacity(0.08 * colors.foxing_alpha())
                .into(),
            offset: point(px(0.), px(0.)),
            blur_radius: px(60.),
            spread_radius: px(0.),
            inset: true,
        },
    ]
}

fn svg_start(metrics: DossierPaperMetrics) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\" color-interpolation=\"sRGB\">",
        metrics.width, metrics.height, metrics.width, metrics.height
    )
}

struct SvgRadial {
    x: f64,
    y: f64,
    radius: f64,
    solid_fraction: f64,
    color: u32,
    alpha: f64,
}

fn radial_definition(svg: &mut String, id: &str, radial: SvgRadial) {
    let SvgRadial {
        x,
        y,
        radius,
        solid_fraction,
        color,
        alpha,
    } = radial;
    let _ = write!(
        svg,
        "<radialGradient id=\"{id}\" gradientUnits=\"userSpaceOnUse\" cx=\"{x}\" cy=\"{y}\" r=\"{radius}\"><stop offset=\"0\" stop-color=\"#{color:06x}\" stop-opacity=\"{alpha}\"/><stop offset=\"{solid_fraction}\" stop-color=\"#{color:06x}\" stop-opacity=\"{alpha}\"/><stop offset=\"1\" stop-color=\"#{color:06x}\" stop-opacity=\"0\"/></radialGradient>"
    );
}

fn filled_rect(svg: &mut String, width: f32, height: f32, fill: &str) {
    let _ = write!(
        svg,
        "<rect width=\"{width}\" height=\"{height}\" fill=\"{fill}\"/>"
    );
}

fn background_svg(colors: PaperColors, metrics: DossierPaperMetrics) -> String {
    let mut svg = svg_start(metrics);
    svg.push_str("<defs>");
    // `circle` defaults to farthest-corner. Percentage stops are measured along
    // that radius, not relative to width/height or an invented ellipse.
    for (index, (x, y, end, color, alpha)) in [
        (
            0.18,
            0.22,
            0.38,
            colors.foxing,
            0.06 * f64::from(colors.foxing_alpha()),
        ),
        (
            0.82,
            0.78,
            0.42,
            colors.foxing,
            0.05 * f64::from(colors.foxing_alpha()),
        ),
        (0.5, 0.5, 0.6, colors.raised, 0.6),
    ]
    .into_iter()
    .enumerate()
    {
        let (cx, cy) = (x * f64::from(metrics.width), y * f64::from(metrics.height));
        let farthest_x = cx.max(f64::from(metrics.width) - cx);
        let farthest_y = cy.max(f64::from(metrics.height) - cy);
        let radius = farthest_x.hypot(farthest_y) * end;
        radial_definition(
            &mut svg,
            &format!("wash-{index}"),
            SvgRadial {
                x: cx,
                y: cy,
                radius,
                solid_fraction: 0.,
                color,
                alpha,
            },
        );
    }
    // CSS 135deg projects onto (x+y)/sqrt(2), with the gradient-line start at
    // projection zero. A rotated 6px SVG pattern preserves that exact phase.
    let _ = write!(
        svg,
        "<pattern id=\"diagonal\" patternUnits=\"userSpaceOnUse\" width=\"6\" height=\"1\" patternTransform=\"rotate(45)\"><rect width=\"2\" height=\"1\" fill=\"#{:06x}\" fill-opacity=\"0.018\"/></pattern>",
        colors.ink
    );
    for (index, (period, circle)) in PAPER_DOTS.into_iter().enumerate() {
        radial_definition(
            &mut svg,
            &format!("dot-{index}"),
            SvgRadial {
                x: circle.x * period,
                y: circle.y * period,
                radius: circle.transparent_radius_px,
                solid_fraction: circle.solid_radius_px / circle.transparent_radius_px,
                color: colors.ink,
                alpha: circle.color_alpha,
            },
        );
        let _ = write!(
            svg,
            "<pattern id=\"tile-{index}\" patternUnits=\"userSpaceOnUse\" width=\"{period}\" height=\"{period}\"><rect width=\"{period}\" height=\"{period}\" fill=\"url(#dot-{index})\"/></pattern>"
        );
    }
    svg.push_str("</defs>");
    filled_rect(
        &mut svg,
        metrics.width,
        metrics.height,
        &format!("#{:06x}", colors.paper),
    );
    // CSS paints background-image's first layer on top, SVG paints last on top.
    for index in (0..PAPER_DOTS.len()).rev() {
        filled_rect(
            &mut svg,
            metrics.width,
            metrics.height,
            &format!("url(#tile-{index})"),
        );
    }
    filled_rect(&mut svg, metrics.width, metrics.height, "url(#diagonal)");
    for index in (0..3).rev() {
        filled_rect(
            &mut svg,
            metrics.width,
            metrics.height,
            &format!("url(#wash-{index})"),
        );
    }
    svg.push_str("</svg>");
    svg
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::{BROADSHEET, EDITORIAL};

    #[test]
    fn refuses_nonfinite_unbounded_and_overbudget_preparations() {
        for (width, height, scale) in [
            (f32::NAN, 860., 1.),
            (1280., f32::INFINITY, 1.),
            (0., 860., 1.),
            (4097., 860., 1.),
            (1280., 860., 0.),
            (1280., 860., 4.1),
            (4096., 4096., 1.),
        ] {
            assert!(DossierPaperMetrics::new(width, height, scale).is_err());
        }
        assert!(DossierPaperMetrics::new(1280., 860., 2.).is_ok());
    }

    #[test]
    fn source_layers_are_not_silently_replaced_by_body_grain() {
        let metrics = DossierPaperMetrics::new(1280., 860., 1.).unwrap();
        let sheet = paper_sheet_svg(BROADSHEET, metrics).unwrap();
        // Source's Broadsheet only makes foxing transparent; sheet stripes/dots
        // retain their explicitly mixed ink instead of the body --grain tokens.
        assert!(sheet.contains("fill=\"#111111\" fill-opacity=\"0.018\""));
        assert!(sheet.contains("stop-opacity=\"0.04\""));
        assert!(sheet.contains("stop-color=\"#fafafa\" stop-opacity=\"0.6\""));
        assert!(!sheet.contains("mix-blend-mode"));
        let foxing = foxing_svg(EDITORIAL, metrics).unwrap();
        assert!(foxing.contains("opacity=\"0.7\" style=\"mix-blend-mode:multiply\""));
    }

    #[test]
    fn source_percent_circles_keep_farthest_corner_radius_and_css_order() {
        let metrics = DossierPaperMetrics::new(100., 100., 1.).unwrap();
        let svg = paper_sheet_svg(EDITORIAL, metrics).unwrap();
        let wash = svg.find("fill=\"url(#wash-0)\"").unwrap();
        let second = svg.find("fill=\"url(#wash-1)\"").unwrap();
        let third = svg.find("fill=\"url(#wash-2)\"").unwrap();
        let dots = svg.find("fill=\"url(#tile-2)\"").unwrap();
        assert!(dots < third && third < second && second < wash);
        // sqrt(82²+78²)*38%; neither 38px nor an ellipse.
        assert!(svg.contains(&format!("r=\"{}\"", 82_f64.hypot(78.) * 0.38)));
    }

    #[test]
    fn source_fixture_controls_spot_geometry_and_layer_alpha() {
        let source: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/dossier-paper/source.json")).unwrap();
        let close = |expected: f64, value: &serde_json::Value| {
            assert!((expected - value.as_f64().unwrap()).abs() < 1e-12);
        };
        assert_eq!(source["blend"], "multiply");
        close(FOXING_GROUP_OPACITY, &source["groupOpacity"]);
        for (index, (period, circle)) in PAPER_DOTS.into_iter().enumerate() {
            let row = &source["backgrounds"][index + 4];
            close(period, &row["tile"][0]);
            close(circle.x, &row["center"][0]);
            close(circle.y, &row["center"][1]);
            close(circle.color_alpha, &row["colored"]["alpha"]);
        }
        for (index, circle) in FOXING_SPOTS.into_iter().enumerate() {
            let row = &source["foxing"][index];
            close(circle.x, &row["center"][0]);
            close(circle.y, &row["center"][1]);
            close(circle.color_alpha, &row["colored"]["alpha"]);
            assert_eq!(
                row["colored"]["stops"][1],
                format!("{}px", circle.solid_radius_px)
            );
            assert_eq!(
                row["transparent"]["stops"][0],
                format!("{}px", circle.transparent_radius_px)
            );
        }
    }

    #[test]
    fn identical_preparation_reuses_image_and_themes_remain_distinct() {
        let metrics = DossierPaperMetrics::new(96., 80., 2.).unwrap();
        let first = DossierPaper::prepare(EDITORIAL, metrics).unwrap();
        let same = DossierPaper::prepare(EDITORIAL, metrics).unwrap();
        assert!(Arc::ptr_eq(&first, &same));
        assert!(Arc::ptr_eq(first.raster_image(), same.raster_image()));
        assert_eq!(first.raster_image().size(0).width.0, 192);
        assert_eq!(first.raster_image().size(0).height.0, 160);
        assert!(
            first
                .raster_image()
                .as_bytes(0)
                .unwrap()
                .as_chunks::<4>()
                .0
                .iter()
                .all(|pixel| pixel[3] == 255)
        );
        let broadsheet = DossierPaper::prepare(BROADSHEET, metrics).unwrap();
        assert!(!Arc::ptr_eq(&first, &broadsheet));
        assert!(!first.matches(BROADSHEET, metrics));
        assert_eq!(
            first.foxing_status(),
            DossierFoxingStatus::UnsupportedDestinationMultiply
        );
        assert_eq!(broadsheet.foxing_status(), DossierFoxingStatus::Transparent);
    }
}
