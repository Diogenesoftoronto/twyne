//! Bounded, source-preserving groundwork for the KaTeX Write surface.
//!
//! This module deliberately does not reroute MathJax Proof/PDF rendering. The
//! current Source has KaTeX 0.18.1 with CSS 0.16.47. Its actual browser behavior
//! is retained in the fixtures; it is not certified by engine-matched geometry.
//! Only an explicitly selected diagnostic profile can return a native vector.
//! Run `render` on a background executor, never in an input transaction.

use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MATH_WRITE_SCHEMA: u32 = 1;
pub const MAX_MATH_SOURCE_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BYTES: usize = 128 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
const MAX_DIMENSION_PX: f32 = 4096.0;
const MAX_GLYPHS: usize = 12_000;
const MAX_TREE_NODES: usize = 20_000;
const MAX_CACHE_ENTRIES: usize = 128;
const MAX_CACHE_BYTES: usize = 32 * 1024 * 1024;
const MAX_CONCURRENT_RENDERS: usize = 2;
const HELPER_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MathWriteDisplay {
    Inline,
    Block,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MathWriteProfile {
    /// Actual original HTML/errors, with an explicit CSS mismatch refusal.
    #[default]
    CurrentSource,
    /// KaTeX 0.18.1 tree, matching CSS and original font outlines. This does
    /// not certify the current Source stylesheet or paragraph line box.
    EngineMatchedDiagnostic,
    /// Frozen vendor 0.16.47 CSS and original fonts, measured against the
    /// original NodeViews. Only the natural inline span/glyph fragment is
    /// admitted; wrapper, paragraph, display line and native raster are not.
    CurrentSourceCssDiagnostic,
}

#[derive(Clone, Debug)]
pub struct MathWriteRequest {
    /// Editor/view owner. UUIDs must not be reused after a folio/view switch.
    pub owner: Uuid,
    /// Exact queued job token, independent of cache reuse.
    pub request_id: Uuid,
    /// Caller-held atom/manuscript revision at the freshness boundary.
    pub generation: u64,
    /// Raw authored LaTeX. Trimming is only the original render operation.
    pub source: Arc<str>,
    pub display: MathWriteDisplay,
    pub profile: MathWriteProfile,
    pub font_size_px: f32,
    /// RGB, matching the native ink token; no alpha reinterpretation.
    pub color: u32,
    pub width_px: f32,
}

impl MathWriteRequest {
    pub fn key(&self) -> Result<MathWriteKey, MathWriteError> {
        if self.source.len() > MAX_MATH_SOURCE_BYTES {
            return Err(MathWriteError::new(
                MathWriteErrorKind::TooLarge,
                "Math source exceeds 64 KiB.",
            ));
        }
        if !self.font_size_px.is_finite()
            || !(4.0..=192.0).contains(&self.font_size_px)
            || !self.width_px.is_finite()
            || !(1.0..=MAX_DIMENSION_PX).contains(&self.width_px)
            || self.color > 0xffffff
        {
            return Err(MathWriteError::new(
                MathWriteErrorKind::InvalidStyle,
                "Invalid math font size, ink color, or available width.",
            ));
        }
        Ok(MathWriteKey {
            source: self.source.clone(),
            display: self.display,
            profile: self.profile,
            font_size_bits: self.font_size_px.to_bits(),
            width_bits: self.width_px.to_bits(),
            color: self.color,
        })
    }
}

/// Keep this key with the atom; render frames need not hash the raw source.
/// Equality includes source bytes rather than trusting a truncated fingerprint.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct MathWriteKey {
    pub source: Arc<str>,
    pub display: MathWriteDisplay,
    pub profile: MathWriteProfile,
    font_size_bits: u32,
    width_bits: u32,
    pub color: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MathWriteFidelity {
    Refused,
    EngineDerivedDiagnostic,
    CurrentSourceCssDerivedDiagnostic,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MathWriteIssue {
    pub kind: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Stable refusal categories for the caller. Raw helper kind/message/path are
/// also retained, so new or more specific engine failures are not erased.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MathWriteRefusalKind {
    InvalidSource,
    CurrentSourceCssMismatch,
    CurrentSourceUnverified,
    UnsupportedStructure,
    FontUnavailable,
    InvalidRequest,
    TooLarge,
    EngineUnavailable,
    AdapterFailure,
    Unknown,
}

impl MathWriteIssue {
    pub fn refusal_kind(&self) -> MathWriteRefusalKind {
        match self.kind.as_str() {
            "source" => MathWriteRefusalKind::InvalidSource,
            "css-version-mismatch" => MathWriteRefusalKind::CurrentSourceCssMismatch,
            "current-source-unverified" => MathWriteRefusalKind::CurrentSourceUnverified,
            "unsupported-structure"
            | "external-object"
            | "svg-external"
            | "vlist"
            | "rule"
            | "css-length"
            | "css-font"
            | "css-color"
            | "svg-geometry"
            | "current-css-cascade"
            | "current-css-structure"
            | "current-css-vlist"
            | "current-css-strut"
            | "current-css-svg"
            | "current-css-rule"
            | "current-css-flow"
            | "current-css-display-flow"
            | "current-css-inline-wrap" => MathWriteRefusalKind::UnsupportedStructure,
            "current-css-provenance" => MathWriteRefusalKind::CurrentSourceCssMismatch,
            "font" | "font-shaping" | "glyph" => MathWriteRefusalKind::FontUnavailable,
            "input" => MathWriteRefusalKind::InvalidRequest,
            "budget" => MathWriteRefusalKind::TooLarge,
            "engine-version" => MathWriteRefusalKind::EngineUnavailable,
            "adapter" => MathWriteRefusalKind::AdapterFailure,
            _ => MathWriteRefusalKind::Unknown,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteGlyph {
    pub text: String,
    pub codepoint: u32,
    pub glyph_id: u32,
    pub font: String,
    pub x: f32,
    /// Glyph baseline relative to the equation's baseline, not its image top.
    pub baseline: f32,
    pub font_size: f32,
    pub advance: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteFont {
    pub name: String,
    pub sha256: String,
    pub units_per_em: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MathWriteCssScope {
    KatexBaseInlineSpan,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MathWriteCssLayoutModel {
    Blink150Linux64ths,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteInlineStrut {
    pub path: String,
    /// Retained authored CSS height; inline non-replaced spans ignore it.
    pub authored_height_px: f32,
    pub vertical_align_px: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteCssTable {
    pub path: String,
    /// Actual CSS cell heights, not engine TeX ascent/depth.
    pub first_row_height_px: f32,
    pub second_row_height_px: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteCssGeometry {
    pub scope: MathWriteCssScope,
    pub layout_model: MathWriteCssLayoutModel,
    pub css_font_size_px: f32,
    /// Original font-outline scale after the observed platform quantization.
    pub platform_font_size_px: f32,
    /// Source's computed unitless 1.2 line-height. This is not a measured
    /// surrounding paragraph/inline-flex height and must not be used as one.
    pub line_height_px: f32,
    pub font_box_ascent_px: f32,
    pub font_box_descent_px: f32,
    pub ignored_inline_struts: Vec<MathWriteInlineStrut>,
    pub tables: Vec<MathWriteCssTable>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteVector {
    pub svg: Arc<str>,
    /// Natural math-content width; this is not the whole block wrapper width.
    pub width_px: f32,
    pub height_px: f32,
    /// Engine TeX baseline for EngineMatchedDiagnostic; actual inline span
    /// font-box baseline for CurrentSourceCssDiagnostic. Paragraph line-box
    /// fidelity remains unverified and must not be inferred from this metric.
    pub baseline_px: f32,
    pub ascent_px: f32,
    pub descent_px: f32,
    /// Visible font/path overflow has a separate paint frame. Use natural
    /// width for inline advance, then paint this image at its signed offsets.
    pub paint_width_px: f32,
    pub paint_height_px: f32,
    pub paint_offset_x_px: f32,
    pub paint_offset_y_px: f32,
    pub paint_baseline_px: f32,
    pub glyphs: Vec<MathWriteGlyph>,
    pub fonts: Vec<MathWriteFont>,
    pub node_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MathWriteOutput {
    pub schema: u32,
    pub source: Arc<str>,
    pub display: MathWriteDisplay,
    pub profile: MathWriteProfile,
    pub font_size_px: f32,
    pub color: u32,
    pub width_px: f32,
    pub engine_version: String,
    pub source_css_version: String,
    pub source_css_sha256: String,
    pub engine_css_sha256: String,
    pub original_html: Arc<str>,
    pub original_error: Option<String>,
    pub fidelity: MathWriteFidelity,
    pub issues: Vec<MathWriteIssue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css_geometry: Option<MathWriteCssGeometry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vector: Option<MathWriteVector>,
}

impl MathWriteOutput {
    pub fn refusal_kind(&self) -> Option<MathWriteRefusalKind> {
        if self.fidelity == MathWriteFidelity::Refused {
            self.issues.first().map(MathWriteIssue::refusal_kind)
        } else {
            None
        }
    }
    fn validate(&self, request: &MathWriteRequest) -> Result<(), MathWriteError> {
        let invalid = |message| MathWriteError::new(MathWriteErrorKind::InvalidResponse, message);
        if self.schema != MATH_WRITE_SCHEMA
            || self.source != request.source
            || self.display != request.display
            || self.profile != request.profile
            || self.font_size_px.to_bits() != request.font_size_px.to_bits()
            || self.width_px.to_bits() != request.width_px.to_bits()
            || self.color != request.color
            || self.engine_version != "0.18.1"
            || !valid_sha256(&self.source_css_sha256)
            || !valid_sha256(&self.engine_css_sha256)
        {
            return Err(invalid(
                "The helper response does not match this math request/version.",
            ));
        }
        match (self.fidelity, self.vector.as_ref()) {
            (MathWriteFidelity::Refused, None)
                if !self.issues.is_empty() && self.css_geometry.is_none() =>
            {
                Ok(())
            }
            (MathWriteFidelity::EngineDerivedDiagnostic, Some(vector))
                if self.profile == MathWriteProfile::EngineMatchedDiagnostic
                    && self.original_error.is_none()
                    && self.issues.is_empty()
                    && self.css_geometry.is_none() =>
            {
                vector.validate()
            }
            (MathWriteFidelity::CurrentSourceCssDerivedDiagnostic, Some(vector))
                if self.profile == MathWriteProfile::CurrentSourceCssDiagnostic
                    && self.display == MathWriteDisplay::Inline
                    && self.original_error.is_none()
                    && self.issues.is_empty()
                    && self.source_css_version == "0.16.47"
                    && self.source_css_sha256
                        == "1d0be692cde606a132f39e5150d8c81d83649ab0e6825329e93c2a6dcffcbe0d" =>
            {
                vector.validate()?;
                self.css_geometry
                    .as_ref()
                    .ok_or_else(|| {
                        invalid("The current-CSS diagnostic has no explicit scope/metrics.")
                    })?
                    .validate(request, vector)
            }
            _ => Err(invalid(
                "Inconsistent math fidelity, refusal, or vector payload.",
            )),
        }
    }

    /// Convert only an accepted diagnostic vector, on a background executor.
    /// A returned image has no current-Source or Proof/PDF parity claim.
    #[cfg(feature = "desktop")]
    pub fn diagnostic_image(&self) -> Result<Option<Arc<gpui_kit::Image>>, MathWriteError> {
        if !matches!(
            self.fidelity,
            MathWriteFidelity::EngineDerivedDiagnostic
                | MathWriteFidelity::CurrentSourceCssDerivedDiagnostic
        ) {
            return Ok(None);
        }
        self.validate(&MathWriteRequest {
            owner: Uuid::nil(),
            request_id: Uuid::nil(),
            generation: 0,
            source: self.source.clone(),
            display: self.display,
            profile: self.profile,
            font_size_px: self.font_size_px,
            color: self.color,
            width_px: self.width_px,
        })?;
        let Some(vector) = &self.vector else {
            return Err(MathWriteError::new(
                MathWriteErrorKind::InvalidResponse,
                "The diagnostic result contains no vector.",
            ));
        };
        vector.validate()?;
        Ok(Some(Arc::new(gpui_kit::Image::from_bytes(
            gpui_kit::ImageFormat::Svg,
            vector.svg.as_bytes().to_vec(),
        ))))
    }

    fn retained_bytes(&self) -> usize {
        let vector = self.vector.as_ref().map_or(0, |vector| {
            vector.svg.len()
                + vector
                    .glyphs
                    .iter()
                    .map(|glyph| {
                        std::mem::size_of::<MathWriteGlyph>() + glyph.text.len() + glyph.font.len()
                    })
                    .sum::<usize>()
                + vector
                    .fonts
                    .iter()
                    .map(|font| {
                        std::mem::size_of::<MathWriteFont>() + font.name.len() + font.sha256.len()
                    })
                    .sum::<usize>()
        });
        self.source.len()
            + self.original_html.len()
            + self.original_error.as_ref().map_or(0, String::len)
            + self
                .issues
                .iter()
                .map(|issue| {
                    std::mem::size_of::<MathWriteIssue>()
                        + issue.kind.len()
                        + issue.message.len()
                        + issue.path.as_ref().map_or(0, String::len)
                })
                .sum::<usize>()
            + vector
            + self.css_geometry.as_ref().map_or(0, |geometry| {
                std::mem::size_of::<MathWriteCssGeometry>()
                    + geometry
                        .ignored_inline_struts
                        .iter()
                        .map(|strut| std::mem::size_of::<MathWriteInlineStrut>() + strut.path.len())
                        .sum::<usize>()
                    + geometry
                        .tables
                        .iter()
                        .map(|table| std::mem::size_of::<MathWriteCssTable>() + table.path.len())
                        .sum::<usize>()
            })
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl MathWriteCssGeometry {
    fn validate(
        &self,
        request: &MathWriteRequest,
        vector: &MathWriteVector,
    ) -> Result<(), MathWriteError> {
        let invalid = |message| MathWriteError::new(MathWriteErrorKind::InvalidResponse, message);
        if self.ignored_inline_struts.len() > MAX_TREE_NODES
            || self.tables.len() > MAX_TREE_NODES
            || ![
                self.css_font_size_px,
                self.platform_font_size_px,
                self.line_height_px,
                self.font_box_ascent_px,
                self.font_box_descent_px,
            ]
            .iter()
            .all(|number| number.is_finite())
            || (self.css_font_size_px - request.font_size_px * 1.21).abs() > 0.001
            || (self.platform_font_size_px - (self.css_font_size_px * 64.0).trunc() / 64.0).abs()
                > 0.001
            || (self.line_height_px - self.css_font_size_px * 1.2).abs() > 0.001
            || (self.font_box_ascent_px - (self.platform_font_size_px * 0.903).round()).abs()
                > 0.001
            || (self.font_box_descent_px - (self.platform_font_size_px * 0.272).round()).abs()
                > 0.001
            || (vector.ascent_px - self.font_box_ascent_px).abs() > 0.001
            || (vector.descent_px - self.font_box_descent_px).abs() > 0.001
            || vector.width_px > request.width_px + 0.001
        {
            return Err(invalid("Invalid current-CSS inline span/font metrics."));
        }
        let path_valid = |path: &str| path.starts_with("root") && path.len() <= MAX_TREE_NODES;
        if self.ignored_inline_struts.iter().any(|strut| {
            !path_valid(&strut.path)
                || !strut.authored_height_px.is_finite()
                || !(0.0..=MAX_DIMENSION_PX).contains(&strut.authored_height_px)
                || !strut.vertical_align_px.is_finite()
                || strut.vertical_align_px.abs() > MAX_DIMENSION_PX
        }) || self.tables.iter().any(|table| {
            !path_valid(&table.path)
                || ![table.first_row_height_px, table.second_row_height_px]
                    .iter()
                    .all(|height| height.is_finite() && (0.0..=MAX_DIMENSION_PX).contains(height))
        }) {
            return Err(invalid("Invalid current-CSS strut/table metrics or paths."));
        }
        Ok(())
    }
}

impl MathWriteVector {
    fn validate(&self) -> Result<(), MathWriteError> {
        let invalid = |message| MathWriteError::new(MathWriteErrorKind::InvalidResponse, message);
        if self.svg.len() > MAX_SVG_BYTES
            || self.node_count > MAX_TREE_NODES
            || self.glyphs.len() > MAX_GLYPHS
            || self.fonts.len() > 20
        {
            return Err(invalid(
                "Math vector exceeds its byte/node/glyph/font budget.",
            ));
        }
        if ![
            self.width_px,
            self.height_px,
            self.baseline_px,
            self.ascent_px,
            self.descent_px,
            self.paint_width_px,
            self.paint_height_px,
            self.paint_offset_x_px,
            self.paint_offset_y_px,
            self.paint_baseline_px,
        ]
        .iter()
        .all(|number| number.is_finite())
            || !(1.0..=MAX_DIMENSION_PX).contains(&self.width_px)
            || !(1.0..=MAX_DIMENSION_PX).contains(&self.height_px)
            || !(1.0..=MAX_DIMENSION_PX).contains(&self.paint_width_px)
            || !(1.0..=MAX_DIMENSION_PX).contains(&self.paint_height_px)
            || self.paint_offset_x_px > 0.0
            || self.paint_offset_y_px > 0.0
            || self.paint_offset_x_px.abs() > MAX_DIMENSION_PX
            || self.paint_offset_y_px.abs() > MAX_DIMENSION_PX
            || (self.paint_baseline_px + self.paint_offset_y_px - self.baseline_px).abs() > 0.001
            || self.paint_baseline_px < 0.0
            || self.paint_baseline_px > self.paint_height_px
            || self.paint_width_px + self.paint_offset_x_px + 0.001 < self.width_px
            || self.paint_height_px + self.paint_offset_y_px + 0.001 < self.height_px
            || self.baseline_px < 0.0
            || self.baseline_px > self.height_px
            || self.ascent_px < 0.0
            || self.descent_px < 0.0
            || (self.baseline_px - self.ascent_px).abs() > 0.001
            || (self.ascent_px + self.descent_px - self.height_px).abs() > 1.001
        {
            return Err(invalid(
                "Math vector has invalid finite baseline/dimension metrics.",
            ));
        }
        if self.fonts.iter().any(|font| {
            font.name.is_empty()
                || font.name.len() > 64
                || !valid_sha256(&font.sha256)
                || font.units_per_em == 0
                || font.units_per_em > 16384
        }) || self.glyphs.iter().any(|glyph| {
            ![glyph.x, glyph.baseline, glyph.font_size, glyph.advance]
                .iter()
                .all(|n| n.is_finite())
                || glyph.x.abs() > MAX_DIMENSION_PX
                || glyph.baseline.abs() > MAX_DIMENSION_PX
                || glyph.font_size <= 0.0
                || glyph.font_size > 1024.0
                || glyph.advance < 0.0
                || glyph.advance > MAX_DIMENSION_PX
                || glyph.glyph_id == 0
                || char::from_u32(glyph.codepoint).is_none()
                || !self.fonts.iter().any(|font| font.name == glyph.font)
        }) {
            return Err(invalid(
                "Math vector contains an invalid or unbundled glyph/font.",
            ));
        }
        #[cfg(feature = "desktop")]
        validate_svg(&self.svg, self.paint_width_px, self.paint_height_px)?;
        Ok(())
    }
}

#[cfg(feature = "desktop")]
fn validate_svg(svg: &str, width: f32, height: f32) -> Result<(), MathWriteError> {
    let invalid = |message| MathWriteError::new(MathWriteErrorKind::InvalidVector, message);
    let document = roxmltree::Document::parse(svg)
        .map_err(|error| invalid(format!("Invalid math SVG: {error}")))?;
    let root = document.root_element();
    if root.tag_name().name() != "svg"
        || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
    {
        return Err(invalid("The math vector is not standalone SVG.".into()));
    }
    for node in document.descendants().filter(|node| node.is_element()) {
        if node.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
            || !matches!(
                node.tag_name().name(),
                "svg" | "g" | "path" | "rect" | "title"
            )
            || node.attributes().any(|attribute| {
                matches!(
                    attribute.name(),
                    "href" | "src" | "style" | "filter" | "mask"
                ) || attribute.name().starts_with("on")
                    || attribute.value().contains("url(")
            })
        {
            return Err(invalid(
                "The math vector contains nonlocal or unsupported paint.".into(),
            ));
        }
    }
    let geometry = |name| {
        root.attribute(name)
            .and_then(|value| value.parse::<f32>().ok())
    };
    let view_box: Vec<f32> = root
        .attribute("viewBox")
        .unwrap_or("")
        .split_ascii_whitespace()
        .map(str::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| invalid("Invalid math SVG viewBox.".into()))?;
    if geometry("width").is_none_or(|value| (value - width).abs() > 0.001)
        || geometry("height").is_none_or(|value| (value - height).abs() > 0.001)
        || view_box.len() != 4
        || !view_box.iter().all(|n| n.is_finite())
        || view_box.first() != Some(&0.0)
        || view_box.get(1) != Some(&0.0)
        || view_box
            .get(2)
            .is_none_or(|value| (value - width).abs() > 0.001)
        || view_box
            .get(3)
            .is_none_or(|value| (value - height).abs() > 0.001)
    {
        return Err(invalid(
            "Math SVG geometry differs from the helper metrics.".into(),
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MathWriteErrorKind {
    InvalidStyle,
    TooLarge,
    Busy,
    RendererUnavailable,
    Timeout,
    InvalidResponse,
    InvalidVector,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MathWriteError {
    pub kind: MathWriteErrorKind,
    pub message: String,
}

impl MathWriteError {
    pub fn new(kind: MathWriteErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self.kind,
            MathWriteErrorKind::Busy
                | MathWriteErrorKind::RendererUnavailable
                | MathWriteErrorKind::Timeout
        )
    }
}

impl std::fmt::Display for MathWriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.message.fmt(formatter)
    }
}

impl std::error::Error for MathWriteError {}

#[derive(Clone, Debug)]
pub struct MathWriteResult {
    pub owner: Uuid,
    pub request_id: Uuid,
    pub generation: u64,
    pub key: Option<MathWriteKey>,
    pub output: Result<Arc<MathWriteOutput>, MathWriteError>,
}

impl MathWriteResult {
    pub fn matches(&self, request: &MathWriteRequest) -> bool {
        self.owner == request.owner
            && self.request_id == request.request_id
            && self.generation == request.generation
            && self
                .key
                .as_ref()
                .is_some_and(|key| request.key().as_ref().is_ok_and(|current| current == key))
    }
}

/// A real local renderer boundary. Tests may supply executed fixture output;
/// this does not authorize synthetic Write/proof success in the application.
pub trait MathWriteBackend: Send + Sync {
    fn render(&self, request: &MathWriteRequest) -> Result<MathWriteOutput, MathWriteError>;
}

struct PackagedHelper {
    executable: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperInput<'a> {
    source: &'a str,
    display: MathWriteDisplay,
    profile: MathWriteProfile,
    font_size_px: f32,
    color: u32,
    width_px: f32,
}

impl MathWriteBackend for PackagedHelper {
    fn render(&self, request: &MathWriteRequest) -> Result<MathWriteOutput, MathWriteError> {
        let unavailable =
            |message| MathWriteError::new(MathWriteErrorKind::RendererUnavailable, message);
        let payload = serde_json::to_vec(&HelperInput {
            source: &request.source,
            display: request.display,
            profile: request.profile,
            font_size_px: request.font_size_px,
            color: request.color,
            width_px: request.width_px,
        })
        .map_err(|error| unavailable(format!("Cannot encode the math request: {error}")))?;
        if payload.len() > MAX_REQUEST_BYTES {
            return Err(MathWriteError::new(
                MathWriteErrorKind::TooLarge,
                "Encoded math request exceeds 128 KiB.",
            ));
        }
        let mut child = Command::new(&self.executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                unavailable(format!("Cannot start the packaged math helper: {error}"))
            })?;
        // Both pipe directions are off-thread so the deadline also applies to
        // a helper that never reads stdin or fills stdout before reading it.
        let mut stdin = child.stdin.take().expect("configured piped stdin");
        let stdout = child.stdout.take().expect("configured piped stdout");
        let writer = thread::spawn(move || stdin.write_all(&payload));
        let reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .take(MAX_RESPONSE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) if started.elapsed() < HELPER_TIMEOUT => {
                    thread::sleep(Duration::from_millis(10))
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(MathWriteError::new(
                        MathWriteErrorKind::Timeout,
                        "The bounded math helper timed out.",
                    ));
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(unavailable(format!(
                        "Cannot wait for the math helper: {error}"
                    )));
                }
            }
        };
        let written = writer
            .join()
            .map_err(|_| unavailable("Math helper input worker failed.".into()))?;
        let bytes = reader
            .join()
            .map_err(|_| unavailable("Math helper output worker failed.".into()))?
            .map_err(|error| unavailable(format!("Cannot read math helper output: {error}")))?;
        let status = status?;
        written.map_err(|error| unavailable(format!("Cannot write math helper input: {error}")))?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(MathWriteError::new(
                MathWriteErrorKind::TooLarge,
                "Math helper response exceeds 16 MiB.",
            ));
        }
        if !status.success() {
            return Err(unavailable(format!(
                "The packaged math helper exited with {status}."
            )));
        }
        serde_json::from_slice(&bytes).map_err(|error| {
            MathWriteError::new(
                MathWriteErrorKind::InvalidResponse,
                format!("Invalid math helper response: {error}"),
            )
        })
    }
}

#[derive(Default)]
struct RenderCache {
    entries: HashMap<MathWriteKey, (Arc<MathWriteOutput>, usize)>,
    order: VecDeque<MathWriteKey>,
    bytes: usize,
}

struct RendererState {
    backend: Arc<dyn MathWriteBackend>,
    active: AtomicUsize,
    cache: Mutex<RenderCache>,
}

#[derive(Clone)]
pub struct MathWriteRenderer {
    state: Arc<RendererState>,
}

impl MathWriteRenderer {
    /// Supply the packaged executable explicitly. No machine browser or PATH
    /// discovery becomes an accidental application dependency.
    pub fn with_executable(executable: PathBuf) -> Result<Self, MathWriteError> {
        if !executable.is_absolute() || !executable.is_file() {
            return Err(MathWriteError::new(
                MathWriteErrorKind::RendererUnavailable,
                "An absolute existing packaged math-helper path is required.",
            ));
        }
        Ok(Self::with_backend(Arc::new(PackagedHelper { executable })))
    }

    pub fn with_backend(backend: Arc<dyn MathWriteBackend>) -> Self {
        Self {
            state: Arc::new(RendererState {
                backend,
                active: AtomicUsize::new(0),
                cache: Mutex::new(RenderCache::default()),
            }),
        }
    }

    pub fn cached(&self, request: &MathWriteRequest) -> Option<MathWriteResult> {
        self.cached_key(
            &request.key().ok()?,
            request.owner,
            request.request_id,
            request.generation,
        )
    }

    /// The caller must retain the current key with the current atom revision.
    pub fn cached_key(
        &self,
        key: &MathWriteKey,
        owner: Uuid,
        request_id: Uuid,
        generation: u64,
    ) -> Option<MathWriteResult> {
        let mut cache = self
            .state
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let output = cache.entries.get(key)?.0.clone();
        cache.order.retain(|candidate| candidate != key);
        cache.order.push_back(key.clone());
        Some(MathWriteResult {
            owner,
            request_id,
            generation,
            key: Some(key.clone()),
            output: Ok(output),
        })
    }

    pub fn clear_cache(&self) {
        *self
            .state
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = RenderCache::default();
    }

    /// Bounded synchronous work for a background executor. There is no hidden
    /// unbounded queue; busy results are retryable at the next idle boundary.
    pub fn render(&self, request: MathWriteRequest) -> MathWriteResult {
        let key = match request.key() {
            Ok(key) => key,
            Err(error) => {
                return MathWriteResult {
                    owner: request.owner,
                    request_id: request.request_id,
                    generation: request.generation,
                    key: None,
                    output: Err(error),
                };
            }
        };
        if let Some(result) =
            self.cached_key(&key, request.owner, request.request_id, request.generation)
        {
            return result;
        }
        if self
            .state
            .active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < MAX_CONCURRENT_RENDERS).then_some(active + 1)
            })
            .is_err()
        {
            return MathWriteResult {
                owner: request.owner,
                request_id: request.request_id,
                generation: request.generation,
                key: Some(key),
                output: Err(MathWriteError::new(
                    MathWriteErrorKind::Busy,
                    "Two math renders are already running.",
                )),
            };
        }
        let _permit = RenderPermit(&self.state.active);
        let output = self.state.backend.render(&request).and_then(|output| {
            output.validate(&request)?;
            Ok(Arc::new(output))
        });
        if let Ok(output) = &output {
            self.store(key.clone(), output.clone());
        }
        MathWriteResult {
            owner: request.owner,
            request_id: request.request_id,
            generation: request.generation,
            key: Some(key),
            output,
        }
    }

    fn store(&self, key: MathWriteKey, output: Arc<MathWriteOutput>) {
        let bytes = output.retained_bytes() + key.source.len();
        if bytes > MAX_CACHE_BYTES {
            return;
        }
        let mut cache = self
            .state
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((_, old_bytes)) = cache.entries.remove(&key) {
            cache.bytes -= old_bytes;
        }
        cache.order.retain(|candidate| candidate != &key);
        while cache.entries.len() >= MAX_CACHE_ENTRIES || cache.bytes + bytes > MAX_CACHE_BYTES {
            let Some(oldest) = cache.order.pop_front() else {
                break;
            };
            if let Some((_, old_bytes)) = cache.entries.remove(&oldest) {
                cache.bytes -= old_bytes;
            }
        }
        cache.bytes += bytes;
        cache.order.push_back(key.clone());
        cache.entries.insert(key, (output, bytes));
    }
}

struct RenderPermit<'a>(&'a AtomicUsize);

impl Drop for RenderPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Condvar;

    fn fixtures(profile: MathWriteProfile) -> Vec<MathWriteOutput> {
        let raw = match profile {
            MathWriteProfile::CurrentSource => {
                include_str!("../fixtures/math-write/current-source-results.json")
            }
            MathWriteProfile::EngineMatchedDiagnostic => {
                include_str!("../fixtures/math-write/diagnostic-results.json")
            }
            MathWriteProfile::CurrentSourceCssDiagnostic => {
                include_str!("../fixtures/math-write/current-css/results.json")
            }
        };
        serde_json::from_str(raw).unwrap()
    }

    fn request(output: &MathWriteOutput) -> MathWriteRequest {
        MathWriteRequest {
            owner: Uuid::new_v4(),
            request_id: Uuid::new_v4(),
            generation: 7,
            source: output.source.clone(),
            display: output.display,
            profile: output.profile,
            font_size_px: output.font_size_px,
            color: output.color,
            width_px: output.width_px,
        }
    }

    struct FixtureBackend {
        outputs: Vec<MathWriteOutput>,
        calls: AtomicUsize,
    }

    impl FixtureBackend {
        fn diagnostic() -> Self {
            Self {
                outputs: fixtures(MathWriteProfile::EngineMatchedDiagnostic),
                calls: AtomicUsize::new(0),
            }
        }
    }

    impl MathWriteBackend for FixtureBackend {
        fn render(&self, request: &MathWriteRequest) -> Result<MathWriteOutput, MathWriteError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.outputs
                .iter()
                .find(|output| {
                    output.source == request.source
                        && output.display == request.display
                        && output.profile == request.profile
                })
                .cloned()
                .ok_or_else(|| {
                    MathWriteError::new(
                        MathWriteErrorKind::InvalidResponse,
                        "No executed fixture for this request.",
                    )
                })
        }
    }

    #[test]
    fn actual_helper_corpus_is_typed_and_diagnostic_geometry_is_valid() {
        let outputs = fixtures(MathWriteProfile::EngineMatchedDiagnostic);
        assert_eq!(outputs.len(), 28);
        assert_eq!(
            outputs
                .iter()
                .filter(|output| output.vector.is_some())
                .count(),
            21
        );
        for output in outputs {
            output.validate(&request(&output)).unwrap();
            if let Some(vector) = output.vector {
                assert!(vector.paint_width_px >= vector.width_px);
                assert!(vector.paint_height_px >= vector.height_px);
                assert!(
                    (vector.paint_baseline_px + vector.paint_offset_y_px - vector.baseline_px)
                        .abs()
                        < 0.001
                );
            }
        }
    }

    #[test]
    fn current_source_refusals_keep_original_source_html_and_errors() {
        let outputs = fixtures(MathWriteProfile::CurrentSource);
        assert_eq!(outputs.len(), 28);
        let original: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../fixtures/math-write/original-results.json"))
                .unwrap();
        for (output, original) in outputs.iter().zip(original) {
            output.validate(&request(output)).unwrap();
            assert_eq!(output.source.as_ref(), original["source"].as_str().unwrap());
            assert_eq!(
                output.original_html.as_ref(),
                original["html"].as_str().unwrap()
            );
            assert_eq!(output.original_error.as_deref(), original["error"].as_str());
            assert_eq!(
                output.refusal_kind(),
                Some(if output.original_error.is_some() {
                    MathWriteRefusalKind::InvalidSource
                } else {
                    MathWriteRefusalKind::CurrentSourceCssMismatch
                })
            );
            assert!(output.vector.is_none());
            #[cfg(feature = "desktop")]
            assert!(output.diagnostic_image().unwrap().is_none());
        }
        assert_eq!(outputs[0].source.as_ref(), "  x + y = 2  ");
    }

    #[test]
    fn current_css_source_nodeview_fixtures_keep_explicit_inline_scope_and_css_metrics() {
        let outputs = fixtures(MathWriteProfile::CurrentSourceCssDiagnostic);
        assert_eq!(outputs.len(), 15);
        assert_eq!(
            outputs
                .iter()
                .filter(|output| output.vector.is_some())
                .count(),
            11
        );
        for output in &outputs {
            output.validate(&request(output)).unwrap();
            if let Some(vector) = &output.vector {
                let css = output.css_geometry.as_ref().unwrap();
                assert_eq!(css.scope, MathWriteCssScope::KatexBaseInlineSpan);
                assert_eq!(
                    css.layout_model,
                    MathWriteCssLayoutModel::Blink150Linux64ths
                );
                assert_eq!(vector.ascent_px, css.font_box_ascent_px);
                assert_eq!(vector.descent_px, css.font_box_descent_px);
                assert!(vector.paint_height_px >= vector.height_px);
            } else {
                assert!(output.css_geometry.is_none());
            }
        }
        let fraction = &outputs[1];
        assert_eq!(fraction.vector.as_ref().unwrap().height_px, 26.0);
        assert!(
            fraction
                .css_geometry
                .as_ref()
                .unwrap()
                .ignored_inline_struts[0]
                .authored_height_px
                > 27.0
        );
        assert_eq!(outputs[4].issues[0].kind, "current-css-display-flow");
        assert_eq!(outputs[5].issues[0].kind, "current-css-structure");
        let small = outputs
            .iter()
            .find(|output| output.font_size_px == 12.0)
            .unwrap();
        assert_eq!(small.vector.as_ref().unwrap().height_px, 17.0);
    }

    #[test]
    fn current_css_diagnostic_cannot_impersonate_default_source_or_display_line_parity() {
        let original = fixtures(MathWriteProfile::CurrentSourceCssDiagnostic).remove(1);
        for profile in [
            MathWriteProfile::CurrentSource,
            MathWriteProfile::EngineMatchedDiagnostic,
        ] {
            let mut output = original.clone();
            output.profile = profile;
            assert!(output.validate(&request(&output)).is_err());
        }
        let mut block = original.clone();
        block.display = MathWriteDisplay::Block;
        assert!(block.validate(&request(&block)).is_err());
        let mut engine = original.clone();
        engine.fidelity = MathWriteFidelity::EngineDerivedDiagnostic;
        assert!(engine.validate(&request(&engine)).is_err());
        let mut absent = original.clone();
        absent.css_geometry = None;
        assert!(absent.validate(&request(&absent)).is_err());
        let mut drift = original.clone();
        drift.source_css_sha256 = "0".repeat(64);
        assert!(drift.validate(&request(&drift)).is_err());
    }

    #[test]
    fn current_css_cache_keeps_diagnostic_profile_and_rejects_changed_fragment_metrics() {
        let original = fixtures(MathWriteProfile::CurrentSourceCssDiagnostic).remove(1);
        let input = request(&original);
        let backend = Arc::new(FixtureBackend {
            outputs: vec![original.clone()],
            calls: AtomicUsize::new(0),
        });
        let renderer = MathWriteRenderer::with_backend(backend.clone());
        let first = renderer.render(input.clone());
        assert!(first.matches(&input));
        let mut next = input.clone();
        next.generation += 1;
        next.request_id = Uuid::new_v4();
        assert!(!first.matches(&next));
        assert!(renderer.cached(&next).unwrap().matches(&next));
        assert_eq!(backend.calls.load(Ordering::Relaxed), 1);
        let mut changed = input.clone();
        changed.profile = MathWriteProfile::EngineMatchedDiagnostic;
        assert!(renderer.cached(&changed).is_none());
        let mut output = original.clone();
        output.css_geometry.as_mut().unwrap().font_box_ascent_px += 1.0;
        assert!(output.validate(&input).is_err());
        let mut output = original.clone();
        output.css_geometry.as_mut().unwrap().tables[0].first_row_height_px = f32::NAN;
        assert!(output.validate(&input).is_err());
        let mut output = original;
        output.css_geometry.as_mut().unwrap().ignored_inline_struts[0].path = "foreign".into();
        assert!(output.validate(&input).is_err());
    }

    #[test]
    fn cached_geometry_can_be_reused_but_old_owner_token_or_revision_cannot_apply() {
        let backend = Arc::new(FixtureBackend::diagnostic());
        let input = request(&backend.outputs[0]);
        let renderer = MathWriteRenderer::with_backend(backend.clone());
        let first = renderer.render(input.clone());
        assert!(first.matches(&input));
        let mut next = input.clone();
        next.request_id = Uuid::new_v4();
        next.generation += 1;
        let cached = renderer.render(next.clone());
        assert!(!first.matches(&next));
        assert!(cached.matches(&next));
        assert_eq!(backend.calls.load(Ordering::Relaxed), 1);
        let mut switched = next.clone();
        switched.owner = Uuid::new_v4();
        assert!(!cached.matches(&switched));
        assert!(renderer.cached(&switched).unwrap().matches(&switched));
        renderer.clear_cache();
        assert!(renderer.cached(&switched).is_none());
    }

    #[test]
    fn source_display_font_ink_width_and_profile_each_invalidate_completion() {
        let backend = Arc::new(FixtureBackend::diagnostic());
        let input = request(&backend.outputs[0]);
        let renderer = MathWriteRenderer::with_backend(backend);
        let result = renderer.render(input.clone());
        let mut changes = vec![input.clone(); 6];
        changes[0].source = input.source.trim().into();
        changes[1].display = MathWriteDisplay::Block;
        changes[2].font_size_px += 1.0;
        changes[3].color = 0xffffff;
        changes[4].width_px -= 1.0;
        changes[5].profile = MathWriteProfile::CurrentSource;
        for changed in changes {
            assert!(!result.matches(&changed));
            assert!(renderer.cached(&changed).is_none());
        }
    }

    #[test]
    fn diagnostic_output_cannot_be_promoted_to_current_source_or_another_style() {
        let output = fixtures(MathWriteProfile::EngineMatchedDiagnostic).remove(0);
        let mut input = request(&output);
        input.profile = MathWriteProfile::CurrentSource;
        let mut mismatched = output.clone();
        mismatched.profile = MathWriteProfile::CurrentSource;
        assert_eq!(
            mismatched.validate(&input).unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
        let mut input = request(&output);
        input.color ^= 0x000001;
        assert_eq!(
            output.validate(&input).unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
        input = request(&output);
        input.font_size_px += 0.25;
        assert_eq!(
            output.validate(&input).unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
    }

    #[test]
    fn invalid_geometry_and_unbundled_glyphs_are_not_cacheable_success() {
        let mut output = fixtures(MathWriteProfile::EngineMatchedDiagnostic).remove(0);
        let input = request(&output);
        output.vector.as_mut().unwrap().glyphs[0].glyph_id = 0;
        assert_eq!(
            output.validate(&input).unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
        output = fixtures(MathWriteProfile::EngineMatchedDiagnostic).remove(0);
        output.vector.as_mut().unwrap().paint_baseline_px = f32::NAN;
        assert_eq!(
            output.validate(&input).unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn browser_or_remote_svg_paint_is_rejected_before_image_creation() {
        let output = fixtures(MathWriteProfile::EngineMatchedDiagnostic).remove(0);
        for injected in [
            "<image href=\"https://example.com/x.png\"/>",
            "<foreignObject/>",
            "<script/>",
            "<text>x</text>",
            "<path style=\"fill:url(https://example.com)\"/>",
        ] {
            let mut vector = output.vector.clone().unwrap();
            vector.svg = vector
                .svg
                .replace("</title>", &format!("</title>{injected}"))
                .into();
            assert_eq!(
                vector.validate().unwrap_err().kind,
                MathWriteErrorKind::InvalidVector
            );
        }
    }

    #[derive(Default)]
    struct HoldState {
        started: usize,
        released: bool,
    }
    struct HeldBackend {
        fixtures: FixtureBackend,
        state: Arc<(Mutex<HoldState>, Condvar)>,
    }

    impl MathWriteBackend for HeldBackend {
        fn render(&self, request: &MathWriteRequest) -> Result<MathWriteOutput, MathWriteError> {
            let (lock, signal) = &*self.state;
            let mut state = lock.lock().unwrap();
            state.started += 1;
            signal.notify_all();
            while !state.released {
                state = signal.wait(state).unwrap();
            }
            drop(state);
            self.fixtures.render(request)
        }
    }

    #[test]
    fn clones_share_two_job_limit_without_poisoning_a_later_retry() {
        let fixtures = FixtureBackend::diagnostic();
        let first = request(&fixtures.outputs[0]);
        let second = request(&fixtures.outputs[1]);
        let third = request(&fixtures.outputs[2]);
        let state = Arc::new((Mutex::new(HoldState::default()), Condvar::new()));
        let renderer = MathWriteRenderer::with_backend(Arc::new(HeldBackend {
            fixtures,
            state: state.clone(),
        }));
        let one = {
            let renderer = renderer.clone();
            thread::spawn(move || renderer.render(first))
        };
        let two = {
            let renderer = renderer.clone();
            thread::spawn(move || renderer.render(second))
        };
        let (lock, signal) = &*state;
        let held = lock.lock().unwrap();
        let (held, _) = signal
            .wait_timeout_while(held, Duration::from_secs(5), |state| state.started < 2)
            .unwrap();
        let started = held.started;
        drop(held);
        if started != 2 {
            let mut held = lock.lock().unwrap();
            held.released = true;
            signal.notify_all();
            drop(held);
            let _ = one.join();
            let _ = two.join();
            assert_eq!(
                started, 2,
                "Both background jobs must enter the held backend."
            );
            return;
        }
        let busy = renderer.render(third.clone());
        {
            let mut held = lock.lock().unwrap();
            held.released = true;
            signal.notify_all();
        }
        let one = one.join().unwrap();
        let two = two.join().unwrap();
        assert_eq!(started, 2);
        assert!(one.output.is_ok());
        assert!(two.output.is_ok());
        assert_eq!(busy.output.unwrap_err().kind, MathWriteErrorKind::Busy);
        assert!(renderer.render(third).output.is_ok());
    }

    #[test]
    fn size_and_style_limits_refuse_before_the_backend_is_called() {
        let backend = Arc::new(FixtureBackend::diagnostic());
        let original = request(&backend.outputs[0]);
        let renderer = MathWriteRenderer::with_backend(backend.clone());
        let mut oversized = original.clone();
        oversized.source = "x".repeat(MAX_MATH_SOURCE_BYTES + 1).into();
        assert_eq!(
            renderer.render(oversized).output.unwrap_err().kind,
            MathWriteErrorKind::TooLarge
        );
        let mut invalid = original;
        invalid.font_size_px = f32::NAN;
        assert_eq!(
            renderer.render(invalid).output.unwrap_err().kind,
            MathWriteErrorKind::InvalidStyle
        );
        assert_eq!(backend.calls.load(Ordering::Relaxed), 0);
        assert_eq!(
            MathWriteRenderer::with_executable("relative-helper".into())
                .err()
                .unwrap()
                .kind,
            MathWriteErrorKind::RendererUnavailable
        );
    }

    #[test]
    fn malformed_backend_response_is_a_failure_and_does_not_enter_the_cache() {
        let mut backend = FixtureBackend::diagnostic();
        let input = request(&backend.outputs[0]);
        backend.outputs[0].source_css_sha256 = "not-a-digest".into();
        let backend = Arc::new(backend);
        let renderer = MathWriteRenderer::with_backend(backend.clone());
        assert_eq!(
            renderer.render(input.clone()).output.unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
        assert!(renderer.cached(&input).is_none());
        assert_eq!(
            renderer.render(input).output.unwrap_err().kind,
            MathWriteErrorKind::InvalidResponse
        );
        assert_eq!(backend.calls.load(Ordering::Relaxed), 2);
    }
}
