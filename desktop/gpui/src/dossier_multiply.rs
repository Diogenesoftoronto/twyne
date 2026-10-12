//! Prepared Dossier foxing group for the proposed destination-multiply API.
//!
//! This module is deliberately unregistered. The reviewed core/WGPU patch in
//! `fixtures/dossier-multiply/integration.patch` is required before mounting it.
//! It does not replace the existing paper background or paint normal alpha.
//!
//! All five CSS backgrounds are composited into ONE transparent group. The
//! group's pixels are stored as premultiplied BGRA; the shader applies Source's
//! 0.7 opacity once and emits `1 - g*a + g*p`. Fixed-function destination
//! multiplication then darkens arbitrary live descendants, preserving alpha.
//! This equals CSS multiply/source-over only over an already opaque backdrop.
//!
//! No Chromium raster equivalence has been established. SVG radial-gradient
//! rasterization, 8-bit alpha/color quantization and native sampling remain
//! separate pixel-proof requirements. Fractional device-grid extents/origins,
//! transparent windows, faded ancestors and unsupported color formats refuse.

use crate::{
    assets::TwyneAssets,
    dossier_paper::{DossierPaperMetrics, FOXING_GROUP_OPACITY, FOXING_SPOTS},
    theme::{self, Palette},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    App, Bounds, Canvas, DevicePixels, Pixels, RenderImage, Result, SvgRenderer, Window, canvas,
    size,
};
use std::{
    collections::VecDeque,
    fmt::Write,
    sync::{Arc, Mutex, OnceLock},
};

pub const MULTIPLY_CACHE_ENTRIES: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MultiplyKey {
    foxing: u32,
    alpha: u32,
    width: u32,
    height: u32,
    scale: u32,
}

impl MultiplyKey {
    fn new(palette: Palette, metrics: DossierPaperMetrics) -> Result<Self> {
        anyhow::ensure!(palette.foxing <= 0xff_ffff, "Foxing color must be RGB");
        anyhow::ensure!(
            palette.foxing_alpha.is_finite() && (0. ..=1.).contains(&palette.foxing_alpha),
            "Foxing alpha must be finite in 0..=1"
        );
        anyhow::ensure!(
            palette.foxing_alpha == 0.
                || ((metrics.width() * metrics.scale_factor()).fract() == 0.
                    && (metrics.height() * metrics.scale_factor()).fract() == 0.),
            "Fractional device-grid extents need a separate Source/native sampling proof"
        );
        Ok(Self {
            foxing: palette.foxing,
            alpha: palette.foxing_alpha.to_bits(),
            width: metrics.width().to_bits(),
            height: metrics.height().to_bits(),
            scale: metrics.scale_factor().to_bits(),
        })
    }
}

/// Exact arithmetic contract, before any raster or GPU quantization.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PremultipliedGroupPixel {
    pub rgb: [f64; 3],
    pub alpha: f64,
}

impl PremultipliedGroupPixel {
    pub fn destination_factor(self, group_opacity: f64) -> Result<[f64; 3]> {
        anyhow::ensure!(
            self.alpha.is_finite()
                && (0. ..=1.).contains(&self.alpha)
                && self.rgb.iter().all(|component| {
                    component.is_finite() && (0. ..=self.alpha).contains(component)
                })
                && group_opacity.is_finite()
                && (0. ..=1.).contains(&group_opacity),
            "Multiply requires finite premultiplied group color and opacity"
        );
        Ok(self
            .rgb
            .map(|component| 1. - group_opacity * self.alpha + group_opacity * component))
    }
}

/// A retained preparation, keyed only by actual foxing colors and viewport/DPR.
/// Preparation is for constructor/theme/resize boundaries, never render/input.
pub struct DossierMultiply {
    key: MultiplyKey,
    metrics: DossierPaperMetrics,
    svg: Arc<str>,
    premultiplied_group: Option<Arc<RenderImage>>,
}

fn preparations() -> &'static Mutex<VecDeque<Arc<DossierMultiply>>> {
    static CACHE: OnceLock<Mutex<VecDeque<Arc<DossierMultiply>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(VecDeque::new()))
}

impl DossierMultiply {
    pub fn prepare(palette: Palette, metrics: DossierPaperMetrics) -> Result<Arc<Self>> {
        #[cfg(feature = "ui-tests")]
        let mut diagnostic = crate::dossier_paper::resize_diagnostics::Operation::for_metrics(
            crate::dossier_paper::resize_diagnostics::Kind::Multiply,
            metrics,
        );
        let key = MultiplyKey::new(palette, metrics)?;
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::Validation);
        let mut cache = preparations()
            .lock()
            .map_err(|_| anyhow::anyhow!("Dossier multiply cache lock is poisoned"))?;
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::CacheWait);
        #[cfg(feature = "ui-tests")]
        diagnostic.cache_before(cache.len());
        if let Some(index) = cache.iter().position(|ready| ready.key == key) {
            let ready = cache.remove(index).unwrap();
            cache.push_front(ready.clone());
            #[cfg(feature = "ui-tests")]
            diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::CacheLookup);
            #[cfg(feature = "ui-tests")]
            diagnostic.outcome("cacheHit");
            return Ok(ready);
        }
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::CacheLookup);
        let svg: Arc<str> = foxing_group_svg(palette, metrics)?.into();
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::SvgBuild);
        let premultiplied_group = if palette.foxing_alpha == 0. {
            None
        } else {
            let renderer = SvgRenderer::new(Arc::new(TwyneAssets));
            let parsed = renderer.parse_svg(svg.as_bytes())?;
            #[cfg(feature = "ui-tests")]
            diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::RendererAndParse);
            let (width, height) = metrics.raster_size();
            // The proposed core API exports resvg's original premultiplied
            // bytes without the normal SvgRenderer unpremultiply/round-trip.
            let premultiplied = renderer.render_parsed_premultiplied(
                &parsed,
                size(DevicePixels(width as i32), DevicePixels(height as i32)),
            )?;
            #[cfg(feature = "ui-tests")]
            diagnostic
                .mark(crate::dossier_paper::resize_diagnostics::Phase::RasterAndBgraConversion);
            validate_premultiplied_bgra(premultiplied.as_bytes(0).unwrap())?;
            #[cfg(feature = "ui-tests")]
            diagnostic
                .mark(crate::dossier_paper::resize_diagnostics::Phase::PremultipliedValidation);
            Some(premultiplied)
        };
        let prepared = Arc::new(Self {
            key,
            metrics,
            svg,
            premultiplied_group,
        });
        cache.push_front(prepared.clone());
        #[cfg(feature = "ui-tests")]
        diagnostic.evictions(cache.len().saturating_sub(MULTIPLY_CACHE_ENTRIES));
        cache.truncate(MULTIPLY_CACHE_ENTRIES);
        #[cfg(feature = "ui-tests")]
        diagnostic.mark(crate::dossier_paper::resize_diagnostics::Phase::InstallAndEviction);
        #[cfg(feature = "ui-tests")]
        diagnostic.outcome("cacheMissPrepared");
        Ok(prepared)
    }

    pub fn matches(&self, palette: Palette, metrics: DossierPaperMetrics) -> bool {
        MultiplyKey::new(palette, metrics).is_ok_and(|key| key == self.key)
    }

    pub fn metrics(&self) -> DossierPaperMetrics {
        self.metrics
    }
    pub fn group_svg(&self) -> &str {
        &self.svg
    }
    pub fn is_transparent(&self) -> bool {
        self.premultiplied_group.is_none()
    }

    /// This image is a special premultiplied group, NOT a normal GPUI image.
    /// Exposed for Parent receipts; do not mount with `img`/`paint_image`.
    pub fn premultiplied_group(&self) -> Option<&Arc<RenderImage>> {
        self.premultiplied_group.as_ref()
    }

    /// Parent must retire uploaded images after invalidating every consumer's
    /// old scene. The two-entry CPU Arc cache alone does NOT evict GPU atlas
    /// tiles. Use at a quiescent accepted replacement/close boundary; a reused
    /// preparation can upload again. Shared-window consumers need refcounts.
    pub fn release_atlas_group_after_invalidation(&self, window: &mut Window) -> Result<()> {
        if let Some(image) = &self.premultiplied_group {
            window.drop_image(image.clone())?;
        }
        Ok(())
    }

    /// Mount LAST in the positioned, opaque Dossier root. No hitbox, focus,
    /// accessibility node, input handlers or preparation work are added here.
    pub fn overlay(self: &Arc<Self>) -> Canvas<()> {
        let prepared = self.clone();
        canvas(
            |_, _, _| (),
            move |bounds, (), window, cx| {
                // Host preparation errors and direct paint failures are observable
                // through prepare/paint_on_opaque_backdrop. Never stretch stale data.
                let _ = prepared.paint_on_opaque_backdrop(bounds, window, cx);
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }

    pub fn paint_on_opaque_backdrop(
        &self,
        bounds: Bounds<Pixels>,
        window: &mut Window,
        cx: &App,
    ) -> Result<()> {
        anyhow::ensure!(
            f32::from(bounds.size.width).to_bits() == self.metrics.width().to_bits()
                && f32::from(bounds.size.height).to_bits() == self.metrics.height().to_bits()
                && window.scale_factor().to_bits() == self.metrics.scale_factor().to_bits()
                && self.matches(*theme::palette(cx), self.metrics),
            "Prepare multiply for the actual Dossier palette, viewport and device scale"
        );
        let Some(image) = self.premultiplied_group.as_ref() else {
            return Ok(());
        };
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        {
            window.paint_multiply_image(bounds, image.clone(), FOXING_GROUP_OPACITY as f32)
        }
        #[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
        {
            let _ = (window, image);
            anyhow::bail!(
                "Destination-multiply is proposed only for the patched Linux/FreeBSD WGPU path"
            )
        }
    }
}

/// Validate the prepared group only at its explicit preparation boundary.
/// Existing straight-alpha RenderImages must not be passed to this pipeline.
pub fn validate_premultiplied_bgra(bytes: &[u8]) -> Result<()> {
    anyhow::ensure!(
        bytes.len().is_multiple_of(4),
        "Expected complete BGRA pixels"
    );
    anyhow::ensure!(
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .all(|pixel| pixel[..3].iter().all(|channel| *channel <= pixel[3])),
        "Group image must contain premultiplied BGRA pixels"
    );
    Ok(())
}

/// Source layer geometry, WITHOUT .7 opacity or multiply: those are applied
/// once to the composed group by the new pipeline. No external SVG resources.
pub fn foxing_group_svg(palette: Palette, metrics: DossierPaperMetrics) -> Result<String> {
    MultiplyKey::new(palette, metrics)?;
    let width = f64::from(metrics.width());
    let height = f64::from(metrics.height());
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\" color-interpolation=\"sRGB\"><defs>"
    );
    for (index, spot) in FOXING_SPOTS.iter().enumerate() {
        let x = spot.x * width;
        let y = spot.y * height;
        let radius = spot.transparent_radius_px;
        let solid = spot.solid_radius_px / radius;
        let alpha = spot.color_alpha * f64::from(palette.foxing_alpha);
        write!(svg,
            "<radialGradient id=\"fox-{index}\" gradientUnits=\"userSpaceOnUse\" cx=\"{x}\" cy=\"{y}\" r=\"{radius}\"><stop offset=\"0\" stop-color=\"#{:06x}\" stop-opacity=\"{alpha}\"/><stop offset=\"{solid}\" stop-color=\"#{:06x}\" stop-opacity=\"{alpha}\"/><stop offset=\"1\" stop-color=\"#{:06x}\" stop-opacity=\"0\"/></radialGradient>",
            palette.foxing, palette.foxing, palette.foxing).unwrap();
    }
    svg.push_str("</defs><g>");
    // CSS backgrounds list the top layer FIRST; SVG paints it LAST.
    for index in (0..FOXING_SPOTS.len()).rev() {
        write!(
            svg,
            "<rect width=\"{width}\" height=\"{height}\" fill=\"url(#fox-{index})\"/>"
        )
        .unwrap();
    }
    svg.push_str("</g></svg>");
    Ok(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_destination_factor_retains_black_and_mixed_channels() {
        let group = PremultipliedGroupPixel {
            rgb: [0.1, 0.2, 0.3],
            alpha: 0.5,
        };
        let factor = group.destination_factor(0.7).unwrap();
        for (actual, expected) in factor.into_iter().zip([0.72, 0.79, 0.86]) {
            assert!((actual - expected).abs() < 1e-14);
        }
        assert_eq!(0. * factor[0], 0.); // normal-alpha paint would lift black.
    }

    #[test]
    fn transparent_group_is_identity_and_invalid_premultiplication_refuses() {
        assert_eq!(
            PremultipliedGroupPixel {
                rgb: [0.; 3],
                alpha: 0.
            }
            .destination_factor(0.7)
            .unwrap(),
            [1.; 3]
        );
        assert!(
            PremultipliedGroupPixel {
                rgb: [0.4, 0., 0.],
                alpha: 0.2
            }
            .destination_factor(0.7)
            .is_err()
        );
        assert!(
            PremultipliedGroupPixel {
                rgb: [f64::NAN, 0., 0.],
                alpha: 0.2
            }
            .destination_factor(0.7)
            .is_err()
        );
    }

    #[test]
    fn straight_alpha_and_hidden_color_are_not_accepted_as_a_group() {
        assert!(validate_premultiplied_bgra(&[0, 0, 0, 0, 128, 64, 32, 128]).is_ok());
        assert!(validate_premultiplied_bgra(&[255, 127, 64, 128]).is_err());
        assert!(validate_premultiplied_bgra(&[1, 0, 0, 0]).is_err());
        assert!(validate_premultiplied_bgra(&[0, 0, 0]).is_err());
    }

    #[test]
    fn svg_has_source_reverse_order_and_no_group_opacity_substitution() {
        let palette = theme::ThemePreset::Editorial.palette(false);
        let metrics = DossierPaperMetrics::new(1280., 860., 1.).unwrap();
        let svg = foxing_group_svg(palette, metrics).unwrap();
        assert!(
            svg.find("fill=\"url(#fox-4)\"").unwrap() < svg.find("fill=\"url(#fox-0)\"").unwrap()
        );
        assert!(!svg.contains("<g opacity="));
        assert!(!svg.contains("mix-blend-mode"));
        assert!(svg.contains("cx=\"153.6\""));
    }

    #[test]
    fn unsupported_fractional_device_extents_are_not_stretched() {
        let metrics = DossierPaperMetrics::new(621., 861., 1.25).unwrap();
        assert!(foxing_group_svg(theme::ThemePreset::Editorial.palette(false), metrics).is_err());
        let exact = DossierPaperMetrics::new(620., 860., 1.25).unwrap();
        assert!(foxing_group_svg(theme::ThemePreset::Editorial.palette(false), exact).is_ok());
    }
}
