//! Source's reviewed-count stamp, prepared at explicit theme/DPR boundaries.
//!
//! GPUI rotates SVG sprites, but its public text/image painters cannot rotate
//! a complete bordered text box. Its SVG sprite path also rasterizes a new mask
//! during first paint. This module prepares original font outlines at actual
//! platform-shaped positions into a rotated raster before paint. Native/Chrome
//! hinting and antialiasing parity remain a separate actual-pixel gate.
use crate::{assets::TwyneAssets, theme};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Bounds, DevicePixels, FontId, FontWeight, Pixels, RenderImage, Result, Role,
    SvgRenderer, SvgSize, TestSupportExt, TextRun, TextSystem, Window, WindowTextSystem, canvas,
    div, font, point, px, size,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fmt::Write,
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub const FONT_SIZE_PX: f64 = 8.8;
pub const TRACKING_PX: f64 = 1.936;
pub const LINE_HEIGHT_PX: f64 = 13.2;
pub const BORDER_PX: f64 = 2.;
pub const PADDING_X_PX: f64 = 8.;
pub const PADDING_Y_PX: f64 = 2.4;
/// Original browser box quads retain the CSS layout engine's 1/64px used
/// lengths, not its rounded offsetHeight 22px. Only these measured vertical
/// lengths are quantized; platform-shaped glyph positions remain unchanged.
pub const USED_LINE_HEIGHT_PX: f64 = 13.1875;
pub const USED_PADDING_Y_PX: f64 = 2.390625;
pub const BORDER_RADIUS_PX: f64 = 2.;
pub const ROTATION_DEGREES: f64 = -3.;
pub const BACKGROUND_ALPHA: f64 = 0.04;
pub const COUNT_VARIANTS: usize = 8;
pub const CACHE_SETS: usize = 2;
const FONT_SHA: &str = "a776fcb4ceb8bdf03e2967688ebdad42680de5b91a7e62c17e718ae212d14bc4";
const MAX_SVG_BYTES: usize = 256 * 1024;
const MAX_RASTER_DIMENSION: u32 = 1024;
const MAX_SET_PIXELS: u64 = 1_048_576;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OriginalFont {
    font_sha256: String,
    units_per_em: f64,
    ascent_units: f64,
    descent_units: f64,
    glyphs: BTreeMap<u32, GlyphOutline>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlyphOutline {
    character: String,
    advance_units: f64,
    path: String,
}
fn original_font() -> Result<&'static OriginalFont> {
    static FONT: OnceLock<std::result::Result<OriginalFont, String>> = OnceLock::new();
    FONT.get_or_init(|| {
        let font: OriginalFont = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/dossier-stamp/outlines.json"
        )))
        .map_err(|error| error.to_string())?;
        if font.font_sha256 != FONT_SHA
            || font.units_per_em != 2048.
            || font.ascent_units != 1440.
            || font.descent_units != -608.
            || font.glyphs.len() != 16
        {
            return Err("Original Special Elite stamp outline contract changed".into());
        }
        Ok(font)
    })
    .as_ref()
    .map_err(|error| anyhow::anyhow!("{error}"))
}

/// Exact rotation/overflow geometry; raster padding is excluded from layout.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct StampGeometry {
    pub width_px: f64,
    pub height_px: f64,
    pub baseline_px: f64,
    pub paint_left_px: f64,
    pub paint_top_px: f64,
    pub paint_width_px: f64,
    pub paint_height_px: f64,
    pub scale: f32,
    pub raster_width: u32,
    pub raster_height: u32,
}
impl StampGeometry {
    pub fn new(advance_px: f64, ascent_px: f64, descent_px: f64, scale: f32) -> Result<Self> {
        anyhow::ensure!(
            advance_px.is_finite()
                && (1. ..=512.).contains(&advance_px)
                && ascent_px.is_finite()
                && descent_px.is_finite()
                && (0. ..=FONT_SIZE_PX * 2.).contains(&ascent_px)
                && (0. ..=FONT_SIZE_PX * 2.).contains(&descent_px),
            "Invalid measured stamp text geometry"
        );
        anyhow::ensure!(
            scale.is_finite() && (0.5..=4.).contains(&scale),
            "Stamp scale must be finite in 0.5..=4"
        );
        let width_px = advance_px + 2. * (PADDING_X_PX + BORDER_PX);
        let height_px = USED_LINE_HEIGHT_PX + 2. * (USED_PADDING_Y_PX + BORDER_PX);
        let angle = ROTATION_DEGREES.to_radians();
        let extent_x = width_px * angle.cos().abs() + height_px * angle.sin().abs();
        let extent_y = height_px * angle.cos().abs() + width_px * angle.sin().abs();
        let raster_width = (extent_x * f64::from(scale)).ceil() as u32;
        let raster_height = (extent_y * f64::from(scale)).ceil() as u32;
        anyhow::ensure!(
            raster_width <= MAX_RASTER_DIMENSION && raster_height <= MAX_RASTER_DIMENSION,
            "Stamp raster exceeds the bounded dimensions"
        );
        Ok(Self {
            width_px,
            height_px,
            baseline_px: BORDER_PX
                + USED_PADDING_Y_PX
                + (USED_LINE_HEIGHT_PX - ascent_px - descent_px) / 2.
                + ascent_px,
            paint_left_px: (width_px - extent_x) / 2.,
            paint_top_px: (height_px - extent_y) / 2.,
            // The ceil slack belongs to the raster viewport, never the CSS box.
            paint_width_px: f64::from(raster_width) / f64::from(scale),
            paint_height_px: f64::from(raster_height) / f64::from(scale),
            scale,
            raster_width,
            raster_height,
        })
    }
    pub fn layout_size(self) -> gpui_kit::Size<Pixels> {
        size(px(self.width_px as f32), px(self.height_px as f32))
    }
    pub fn rotated_corners(self) -> [[f64; 2]; 4] {
        let angle = ROTATION_DEGREES.to_radians();
        let (s, c) = angle.sin_cos();
        let center = [self.width_px / 2., self.height_px / 2.];
        [
            [0., 0.],
            [self.width_px, 0.],
            [self.width_px, self.height_px],
            [0., self.height_px],
        ]
        .map(|[x, y]| {
            let (x, y) = (x - center[0], y - center[1]);
            [center[0] + c * x - s * y, center[1] + s * x + c * y]
        })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct StampGlyph {
    pub id: u32,
    pub index: usize,
    pub x_px: f64,
    pub y_px: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct StampShape {
    pub label: String,
    pub untracked_advance_px: f64,
    pub tracked_advance_px: f64,
    pub ascent_px: f64,
    pub descent_px: f64,
    pub glyphs: Vec<StampGlyph>,
}
fn measure(reviewed: usize, font_id: FontId, shaper: &WindowTextSystem) -> Result<StampShape> {
    let label = format!("{reviewed} / 7 REVIEWED");
    let mut face = font(theme::TYPEWRITER_FONT);
    face.weight = FontWeight::NORMAL;
    face.features = theme::editorial_font_features();
    let layout = shaper.layout_line(
        &label,
        px(FONT_SIZE_PX as f32),
        &[TextRun {
            len: label.len(),
            font: face,
            ..Default::default()
        }],
        None,
    );
    let original = original_font()?;
    let mut glyphs = Vec::new();
    let mut indices = BTreeSet::new();
    for run in &layout.runs {
        anyhow::ensure!(
            run.font_id == font_id,
            "The stamp selected a fallback font; original outlines cannot be substituted"
        );
        for glyph in &run.glyphs {
            let outline = original.glyphs.get(&glyph.id.0).ok_or_else(|| {
                anyhow::anyhow!("Unreviewed Special Elite stamp glyph {}", glyph.id.0)
            })?;
            anyhow::ensure!(
                !glyph.is_emoji
                    && label.is_char_boundary(glyph.index)
                    && label.get(glyph.index..glyph.index + 1) == Some(outline.character.as_str())
                    && indices.insert(glyph.index),
                "Stamp shaping changed its one-character glyph contract"
            );
            let character = outline
                .character
                .chars()
                .next()
                .ok_or_else(|| anyhow::anyhow!("Missing original stamp character"))?;
            let advance = shaper.advance(font_id, px(FONT_SIZE_PX as f32), character)?;
            anyhow::ensure!(
                shaper.units_per_em(font_id) == original.units_per_em as u32
                    && (f64::from(f32::from(advance.width))
                        - outline.advance_units * FONT_SIZE_PX / original.units_per_em)
                        .abs()
                        < 0.001
                    && f32::from(glyph.position.x).is_finite()
                    && f32::from(glyph.position.y).is_finite(),
                "Stamp glyph advances differ from the original Special Elite face"
            );
            glyphs.push(StampGlyph {
                id: glyph.id.0,
                index: glyph.index,
                x_px: f64::from(f32::from(glyph.position.x)) + glyph.index as f64 * TRACKING_PX,
                y_px: f64::from(f32::from(glyph.position.y)),
            });
        }
    }
    anyhow::ensure!(
        glyphs.len() == label.len(),
        "Stamp shaping omitted or substituted a character"
    );
    let ascent_px = f64::from(f32::from(layout.ascent));
    let descent_px = f64::from(f32::from(layout.descent));
    anyhow::ensure!(
        (ascent_px - original.ascent_units * FONT_SIZE_PX / original.units_per_em).abs() < 0.001
            && (descent_px + original.descent_units * FONT_SIZE_PX / original.units_per_em).abs()
                < 0.001,
        "Stamp font metrics differ from the original Special Elite face"
    );
    let untracked_advance_px = f64::from(f32::from(layout.width));
    Ok(StampShape {
        tracked_advance_px: untracked_advance_px + label.len() as f64 * TRACKING_PX,
        label,
        untracked_advance_px,
        ascent_px,
        descent_px,
        glyphs,
    })
}

fn stamp_svg(shape: &StampShape, geometry: StampGeometry, color: u32) -> Result<String> {
    let original = original_font()?;
    let mut svg = String::new();
    write!(
        svg,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"{} {} {} {}\"><defs>",
        geometry.paint_width_px,
        geometry.paint_height_px,
        geometry.paint_left_px,
        geometry.paint_top_px,
        geometry.paint_width_px,
        geometry.paint_height_px
    )?;
    for id in shape
        .glyphs
        .iter()
        .map(|glyph| glyph.id)
        .collect::<BTreeSet<_>>()
    {
        let outline = original
            .glyphs
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("Original stamp glyph missing"))?;
        write!(svg, "<path id=\"g{id}\" d=\"{}\"/>", outline.path)?;
    }
    write!(
        svg,
        "</defs><g transform=\"rotate({ROTATION_DEGREES} {} {})\"><rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" rx=\"{BORDER_RADIUS_PX}\" fill=\"#{color:06x}\" fill-opacity=\"{BACKGROUND_ALPHA}\"/><rect x=\"1\" y=\"1\" width=\"{}\" height=\"{}\" rx=\"1\" fill=\"none\" stroke=\"#{color:06x}\" stroke-width=\"{BORDER_PX}\"/><g fill=\"#{color:06x}\">",
        geometry.width_px / 2.,
        geometry.height_px / 2.,
        geometry.width_px,
        geometry.height_px,
        geometry.width_px - BORDER_PX,
        geometry.height_px - BORDER_PX
    )?;
    let factor = FONT_SIZE_PX / original.units_per_em;
    for glyph in &shape.glyphs {
        write!(
            svg,
            "<use href=\"#g{}\" transform=\"translate({} {}) scale({factor} {})\"/>",
            glyph.id,
            BORDER_PX + PADDING_X_PX + glyph.x_px,
            geometry.baseline_px + glyph.y_px,
            -factor
        )?;
    }
    svg.push_str("</g></g></svg>");
    anyhow::ensure!(
        svg.len() <= MAX_SVG_BYTES,
        "Stamp SVG exceeds its bounded source bytes"
    );
    Ok(svg)
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct StampKey {
    color: u32,
    scale_bits: u32,
    font_id: FontId,
    text_system: usize,
}
#[derive(Default)]
struct StampCache {
    sets: VecDeque<Arc<DossierStampSet>>,
}
fn cache() -> &'static Mutex<StampCache> {
    static CACHE: OnceLock<Mutex<StampCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(StampCache::default()))
}

pub struct DossierStampSet {
    key: StampKey,
    // Weak keeps the TextSystem allocation identity unique without retaining
    // the application's platform lifetime or reusing another app's FontId.
    _text_system: Weak<TextSystem>,
    stamps: [Arc<DossierStamp>; COUNT_VARIANTS],
}
impl DossierStampSet {
    /// Constructor/theme/DPR boundary only. All counts are prepared together;
    /// navigation, Render, text input and paint merely clone a retained image.
    pub fn prepare(
        color: u32,
        scale: f32,
        shaper: &WindowTextSystem,
        cx: &App,
    ) -> Result<Arc<Self>> {
        anyhow::ensure!(color <= 0xff_ffff, "Stamp color must be a 24-bit RGB value");
        anyhow::ensure!(
            scale.is_finite() && (0.5..=4.).contains(&scale),
            "Stamp scale must be finite in 0.5..=4"
        );
        anyhow::ensure!(
            Arc::ptr_eq(shaper, cx.text_system()),
            "Stamp shaping must use this application's text system"
        );
        let mut face = font(theme::TYPEWRITER_FONT);
        face.features = theme::editorial_font_features();
        face.weight = FontWeight::NORMAL;
        let font_id = cx.text_system().resolve_font(&face);
        anyhow::ensure!(
            cx.text_system()
                .get_font_for_id(font_id)
                .is_some_and(|actual| actual.family == face.family),
            "Original Special Elite stamp font is unavailable"
        );
        let key = StampKey {
            color,
            scale_bits: scale.to_bits(),
            font_id,
            text_system: Arc::as_ptr(cx.text_system()) as usize,
        };
        let mut cache = cache()
            .lock()
            .map_err(|_| anyhow::anyhow!("Dossier stamp cache lock is poisoned"))?;
        if let Some(index) = cache.sets.iter().position(|set| set.key == key) {
            let set = cache.sets.remove(index).unwrap();
            cache.sets.push_front(set.clone());
            return Ok(set);
        }
        let renderer = SvgRenderer::new(Arc::new(TwyneAssets));
        let mut stamps = Vec::with_capacity(COUNT_VARIANTS);
        let mut pixels = 0_u64;
        for reviewed in 0..COUNT_VARIANTS {
            let shape = measure(reviewed, font_id, shaper)?;
            let geometry = StampGeometry::new(
                shape.tracked_advance_px,
                shape.ascent_px,
                shape.descent_px,
                scale,
            )?;
            pixels += u64::from(geometry.raster_width) * u64::from(geometry.raster_height);
            anyhow::ensure!(
                pixels <= MAX_SET_PIXELS,
                "Stamp set exceeds its bounded pixel budget"
            );
            let svg: Arc<str> = stamp_svg(&shape, geometry, color)?.into();
            let parsed = renderer.parse_svg(svg.as_bytes())?;
            let image = renderer.render_parsed(
                &parsed,
                SvgSize::ExactSize(size(
                    DevicePixels(geometry.raster_width as i32),
                    DevicePixels(geometry.raster_height as i32),
                )),
            )?;
            stamps.push(Arc::new(DossierStamp {
                color,
                shape,
                geometry,
                svg,
                image,
            }));
        }
        let stamps = stamps
            .try_into()
            .map_err(|_| anyhow::anyhow!("Incomplete prepared stamp count set"))?;
        let set = Arc::new(Self {
            key,
            _text_system: Arc::downgrade(cx.text_system()),
            stamps,
        });
        cache.sets.push_front(set.clone());
        cache.sets.truncate(CACHE_SETS);
        Ok(set)
    }
    pub fn matches(&self, color: u32, scale: f32) -> bool {
        self.key.color == color && self.key.scale_bits == scale.to_bits()
    }
    /// The host computes reviewed semantics. An invalid count is refused, never
    /// clamped into a fabricated completion or inferred from answer contents.
    pub fn stamp(&self, reviewed: usize) -> Option<&Arc<DossierStamp>> {
        self.stamps.get(reviewed)
    }
}

pub struct DossierStamp {
    color: u32,
    shape: StampShape,
    geometry: StampGeometry,
    svg: Arc<str>,
    image: Arc<RenderImage>,
}
impl DossierStamp {
    pub fn geometry(&self) -> StampGeometry {
        self.geometry
    }
    pub fn shape(&self) -> &StampShape {
        &self.shape
    }
    pub fn svg(&self) -> &str {
        &self.svg
    }
    pub fn raster_image(&self) -> &Arc<RenderImage> {
        &self.image
    }
    /// Source inline-block layout dimensions, with paint overflow. No hitbox,
    /// pointer/keyboard handler, focus stop, source or review transaction.
    pub fn element(self: &Arc<Self>) -> AnyElement {
        let stamp = self.clone();
        div()
            .id("dossier-reviewed-stamp")
            .test_support()
            .role(Role::Label)
            .aria_label(self.shape.label.to_lowercase())
            .w(px(self.geometry.width_px as f32))
            .h(px(self.geometry.height_px as f32))
            .flex_shrink_0()
            .relative()
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, cx| {
                        let _ = stamp.paint(bounds, window, cx);
                    },
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .into_any_element()
    }
    pub fn paint(&self, bounds: Bounds<Pixels>, window: &mut Window, cx: &App) -> Result<()> {
        anyhow::ensure!(
            window.scale_factor().to_bits() == self.geometry.scale.to_bits()
                && theme::palette(cx).vermilion == self.color,
            "Prepare the stamp for the current theme/device scale"
        );
        let paint = Bounds::new(
            bounds.origin
                + point(
                    px(self.geometry.paint_left_px as f32),
                    px(self.geometry.paint_top_px as f32),
                ),
            size(
                px(self.geometry.paint_width_px as f32),
                px(self.geometry.paint_height_px as f32),
            ),
        );
        // Use the paint bounds for BOTH arguments. Passing the unrotated CSS
        // bounds as clipping bounds would cut off the Source rotated corners.
        // Ancestor content masks are retained by Window::paint_image itself.
        window.paint_image(
            paint,
            paint,
            Default::default(),
            self.image.clone(),
            0,
            false,
        )
    }
}

#[cfg(test)]
#[path = "../fixtures/dossier-stamp/stamp_tests.rs"]
mod tests;
