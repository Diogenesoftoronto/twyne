//! Twyne's original product assets, embedded for the native renderer.
//!
//! `tools/sync-assets.ts` produces the catalog from the web application's
//! semantic icon renderer and source files. No network or repository-relative
//! asset access is needed when the compiled application runs.

use gpui_kit::component::{Icon, Sizable};
use gpui_kit::{AssetSource, Result, SharedString, px};
use std::borrow::Cow;

struct EmbeddedAsset {
    path: &'static str,
    bytes: &'static [u8],
}

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/catalog.rs"));

/// Loads Twyne assets first and retains the component kit's internal assets.
#[derive(Clone, Copy, Default)]
pub struct TwyneAssets;

impl AssetSource for TwyneAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        let path = path.trim_start_matches('/');
        if let Ok(index) = EMBEDDED_ASSETS.binary_search_by_key(&path, |asset| asset.path) {
            return Ok(Some(Cow::Borrowed(EMBEDDED_ASSETS[index].bytes)));
        }
        // GPUI Kit owns the icons used inside its native widgets.
        gpui_kit::assets::Assets.load(path)
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let path = path.trim_start_matches('/');
        let mut paths = gpui_kit::assets::Assets.list(path)?;
        paths.extend(
            EMBEDDED_ASSETS
                .iter()
                .filter(|asset| asset.path.starts_with(path))
                .map(|asset| SharedString::from(asset.path)),
        );
        paths.sort();
        paths.dedup();
        Ok(paths)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum IconWeight {
    #[default]
    Outline,
    Filled,
}

/// The exact Reicon outline used by Twyne's semantic icon renderer.
pub fn icon(name: TwyneIcon) -> Icon {
    icon_with_weight(name, IconWeight::Outline)
}

pub fn icon_with_weight(name: TwyneIcon, weight: IconWeight) -> Icon {
    Icon::default().path(name.path(weight)).with_size(px(16.))
}

pub fn icon_named(name: &str) -> Option<Icon> {
    TwyneIcon::from_name(name).map(icon)
}

/// The web editor's original drawer button, including its 1.6px stroke.
pub fn drawer_icon() -> Icon {
    Icon::default()
        .path("twyne/icons/editor-drawer.svg")
        .with_size(px(18.))
}

/// The web editor's original editorial-board toggle.
pub fn editorial_board_icon() -> Icon {
    Icon::default()
        .path("twyne/icons/editorial-board.svg")
        .with_size(px(18.))
}

/// The original compact SpeakButton idle speaker, with its filled speaker and
/// two 1.8px round arcs. Playback state remains the caller's responsibility.
pub fn speak_icon() -> Icon {
    Icon::default()
        .path("twyne/icons/speak-idle.svg")
        .with_size(px(12.))
}

/// The original ChatComposer send arrow, including its 2px round stroke.
pub fn composer_send_icon() -> Icon {
    Icon::default()
        .path("twyne/icons/composer-send.svg")
        .with_size(px(15.))
}

/// The original ChatComposer microphone, with its filled capsule and 1.8px
/// round strokes. Voice availability remains the caller's responsibility.
pub fn composer_mic_icon() -> Icon {
    Icon::default()
        .path("twyne/icons/composer-mic.svg")
        .with_size(px(15.))
}

#[derive(Clone, Copy, Debug)]
pub struct PaperGrainMask {
    pub path: &'static str,
    pub period_px: f32,
}

/// Source-derived alpha masks, cached by GPUI independently of the theme tint.
pub fn paper_grain_masks(dark_grain: bool) -> [PaperGrainMask; 2] {
    [
        PaperGrainMask {
            path: if dark_grain {
                "twyne/paper-grain/dark-outer.svg"
            } else {
                "twyne/paper-grain/light-outer.svg"
            },
            period_px: crate::theme::GRAIN_OUTER_TILE_PX,
        },
        PaperGrainMask {
            path: if dark_grain {
                "twyne/paper-grain/dark-middle.svg"
            } else {
                "twyne/paper-grain/light-middle.svg"
            },
            period_px: crate::theme::GRAIN_MIDDLE_TILE_PX,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_semantic_icon_weight_has_embedded_original_svg() {
        for name in TwyneIcon::ALL {
            assert_eq!(TwyneIcon::from_name(name.name()), Some(*name));
            for weight in [IconWeight::Outline, IconWeight::Filled] {
                let bytes = TwyneAssets.load(name.path(weight)).unwrap().unwrap();
                let svg = std::str::from_utf8(&bytes).unwrap();
                assert!(svg.contains("viewBox=\"0 0 24 24\""));
                assert!(svg.contains("currentColor"));
            }
        }
        assert!(TwyneIcon::from_name("ornamental-fleuron").is_none());
    }

    #[test]
    fn public_urls_resolve_without_a_hosted_origin_and_kit_icons_still_load() {
        for path in [
            "/assets/griffin-mark.svg",
            "/assets/avatars/engraved-2026-09/owl.webp",
            "/assets/manual/editors/devil-transparent-480.webp",
            "/assets/illuminated-initials/a.avif",
            "/assets/page-borders/illuminated.avif",
            "fonts/specialelite-SpecialElite-Regular.ttf",
        ] {
            assert!(TwyneAssets.load(path).unwrap().is_some(), "{path}");
        }
        let name = gpui_kit::assets::IconName::Check;
        assert!(TwyneAssets.load(name.path().as_ref()).unwrap().is_some());
    }

    #[test]
    fn asset_list_is_unique_and_avif_urls_return_a_supported_codec() {
        let listed = TwyneAssets.list("assets/illuminated-initials/").unwrap();
        assert_eq!(listed.len(), 52);
        let bytes = TwyneAssets
            .load("/assets/illuminated-initials/a.avif")
            .unwrap()
            .unwrap();
        // The native GPUI image crate has WebP support, but no AVIF feature.
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WEBP");
        assert!(
            EMBEDDED_ASSETS
                .windows(2)
                .all(|pair| pair[0].path < pair[1].path)
        );
    }

    #[test]
    fn original_cast_fallback_faces_and_notices_are_embedded() {
        for path in [
            "fonts/LiberationSans-Regular.ttf",
            "fonts/Inter-Regular.ttf",
            "fonts/AdwaitaMono-Regular.ttf",
            "fonts/LiberationSerif-Bold.ttf",
        ] {
            let bytes = TwyneAssets.load(path).unwrap().unwrap();
            assert_eq!(
                &bytes[..4],
                &[0, 1, 0, 0],
                "standalone original TTF: {path}"
            );
        }
        for path in [
            "licenses/cast-liberation-sans-OFL.txt",
            "licenses/cast-inter-OFL.txt",
            "licenses/cast-adwaita-mono-OFL.txt",
            "licenses/cast-raw-liberation-serif-OFL.txt",
        ] {
            let bytes = TwyneAssets.load(path).unwrap().unwrap();
            assert!(std::str::from_utf8(&bytes).unwrap().contains("1.1"));
        }
        let provenance = TwyneAssets
            .load("cast-font-provenance.json")
            .unwrap()
            .unwrap();
        let proof: serde_json::Value = serde_json::from_slice(&provenance).unwrap();
        assert_eq!(proof["fonts"].as_array().unwrap().len(), 3);
        assert_eq!(proof["originalGlyphs"].as_array().unwrap().len(), 5);
        let raw_provenance = TwyneAssets
            .load("cast-raw-font-provenance.json")
            .unwrap()
            .unwrap();
        let raw: serde_json::Value = serde_json::from_slice(&raw_provenance).unwrap();
        assert_eq!(raw["postScriptName"], "LiberationSerif-Bold");
        assert_eq!(raw["version"], "Version 2.1.5");
        assert_eq!(raw["originalGlyphs"].as_array().unwrap().len(), 5);
        assert!(
            TwyneAssets
                .load("licenses/cast-raw-FONTLOG.txt")
                .unwrap()
                .is_some()
        );
    }
}
