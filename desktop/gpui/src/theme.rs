//! Twyne's web palette and type faces projected into native GPUI controls.
//!
//! Palette constants are generated from src/global.css. Presets and custom
//! overrides use the same preference shape as src/utils/theme.ts.

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::{App, Font, FontFallbacks, FontFeatures, Global, Hsla, SharedString, font, px, rgb};
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

pub const SANS_FONT: &str = "DM Sans";
/// Original DM Sans 4.004 at the actual paper-button axes opsz12/wght600.
/// Use only for 12px/600 UI controls; canonical/default family stays DM Sans.
pub const BUTTON_FONT: &str = "Twyne Button Sans";
/// Exact original File U+25BE fallback. Restrict this face to that glyph;
/// shared Sans and Typst font selection remain unchanged.
pub const FILE_DISCLOSURE_FONT: &str = "Noto Sans Math";
// Original Lora 3.008 outlines, instantiated for the native renderer. The
// derived internal name respects Lora's Reserved Font Name; source stays Lora.
pub const SERIF_FONT: &str = "Twyne Body";
pub const DISPLAY_FONT: &str = "Libre Baskerville";
pub const TYPEWRITER_FONT: &str = "Special Elite";
// The web root does not load JetBrains Mono or Fira Code, though its CSS
// names them first. Use Twyne's existing bundled mono export fallback so
// native code has an available face on every supported platform.
pub const MONO_FONT: &str = "DejaVu Sans Mono";
/// Original math textarea's actual ui-monospace fallback in the Source fixture.
/// The retained UA value node selects this already bundled regular face.
pub const MATH_SOURCE_MONO_FONT: &str = "Noto Sans Mono";
/// Original app's measured Noto Mono 2.014 fallback, restricted to Source UI.
/// Regular400/heading600 are unchanged outlines; native comment oblique uses
/// the original browser's quarter-shear mechanism, with its raster gap explicit.
pub const SOURCE_FONT: &str = "Twyne Source";
/// Original DM Sans 4.004 opsz11/wght400 for 11px Source helper and footer labels.
pub const SOURCE_HELPER_FONT: &str = "Twyne Source Label";
/// Footer-only alias of the exact original 11px/400 optical-size face.
/// Default Sans/source attributes/Typst families and bytes remain unchanged.
pub const FOOTER_FONT: &str = SOURCE_HELPER_FONT;
pub const SERIF_CJK_FALLBACK_FONT: &str = "Droid Sans Fallback";

/// Maps the canonical source family only while selecting a native UI face.
/// Stored HTML/Typst family names and font menu labels remain unchanged.
pub fn resolve_ui_font_family(family: &str) -> SharedString {
    match family {
        "Lora" | SERIF_FONT => SERIF_FONT.into(),
        SANS_FONT => SANS_FONT.into(),
        BUTTON_FONT => BUTTON_FONT.into(),
        DISPLAY_FONT => DISPLAY_FONT.into(),
        MONO_FONT => MONO_FONT.into(),
        TYPEWRITER_FONT => TYPEWRITER_FONT.into(),
        other => other.to_owned().into(),
    }
}

/// The exact CJK face used by the original browser's Lora writing fixture.
/// The caller applies this to a final Lora Font after explicit family marks;
/// Latin glyphs remain in the original primary face. Only the Arc is cloned.
pub fn serif_font_fallbacks() -> FontFallbacks {
    static FALLBACKS: OnceLock<FontFallbacks> = OnceLock::new();
    FALLBACKS
        .get_or_init(|| FontFallbacks::from_fonts(vec![SERIF_CJK_FALLBACK_FONT.into()]))
        .clone()
}

/// The original Source fixture selects this same Droid face for CJK/kana.
/// Hangul and emoji remain platform fallback boundaries; no font lookup or
/// generation occurs here, only a clone of the cached immutable chain.
pub fn source_font_fallbacks() -> FontFallbacks {
    serif_font_fallbacks()
}

pub fn source_font() -> Font {
    let mut face = font(SOURCE_FONT);
    face.fallbacks = Some(source_font_fallbacks());
    face
}

/// Original Apparatus URL/details fallback selected by Chrome at 11px/400.
/// This unmodified Noto Sans Mono 2.014 face is already embedded alongside the
/// Source originals. Restrict it to Apparatus; shared mono and Source adapters
/// retain their existing families, styles, and fallback chains.
pub fn apparatus_mono_font() -> Font {
    font("Noto Sans Mono")
}

/// The original span requests600/normal and Chrome selects Regular Math3.000.
/// GPUI retains that original glyph/advance; Chromium fallback faux-bold is
/// a separate tiny-glyph raster boundary, not an invented heavier face.
pub fn file_disclosure_font() -> Font {
    let mut face = font(FILE_DISCLOSURE_FONT);
    face.weight = gpui_kit::FontWeight::SEMIBOLD;
    face
}

/// The original Cast circles request DM Sans 400, but their source symbols
/// select Inter (heart), Liberation Sans (spade/diamond/club), and Adwaita Mono
/// (four-point star). Apply this cached chain only to those badge glyphs.
/// All three exact original fallback faces are bundled for offline selection.
pub fn cast_badge_font() -> Font {
    static FALLBACKS: OnceLock<FontFallbacks> = OnceLock::new();
    let mut face = font(SANS_FONT);
    face.fallbacks = Some(
        FALLBACKS
            .get_or_init(|| {
                FontFallbacks::from_fonts(vec![
                    "Inter".into(),
                    "Liberation Sans".into(),
                    "Adwaita Mono".into(),
                ])
            })
            .clone(),
    );
    face
}

/// The original Manager assistance glyphs inherit Libre Baskerville 16px/600.
/// Its missing suit glyphs select Liberation Serif Bold; the four-point star
/// selects Adwaita Mono Regular. Use only for these raw Manager spans, never
/// the DM Sans circles or Lora card headings. All source symbols stay intact.
pub fn cast_raw_glyph_font() -> Font {
    static FALLBACKS: OnceLock<FontFallbacks> = OnceLock::new();
    let mut face = font(DISPLAY_FONT);
    face.weight = gpui_kit::FontWeight::SEMIBOLD;
    face.fallbacks = Some(
        FALLBACKS
            .get_or_init(|| {
                FontFallbacks::from_fonts(vec!["Liberation Serif".into(), "Adwaita Mono".into()])
            })
            .clone(),
    );
    face
}
pub const REM_PX: f32 = 16.;
pub const DEPARTMENT_LABEL_PX: f32 = 10.;
pub const MASTHEAD_PX: f32 = 32.;
pub const PAPER_BUTTON_PX: f32 = 12.;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemePreset {
    System,
    Foolscap,
    Broadsheet,
    Nightpress,
    #[default]
    #[serde(other)]
    Editorial,
}

impl ThemePreset {
    /// The order of the original Settings Appearance cards.
    pub const APPEARANCE_ORDER: &'static [Self] = &[
        Self::Editorial,
        Self::Foolscap,
        Self::Broadsheet,
        Self::Nightpress,
        Self::System,
    ];
    pub const ALL: &'static [Self] = &[
        Self::System,
        Self::Editorial,
        Self::Foolscap,
        Self::Broadsheet,
        Self::Nightpress,
    ];

    pub const fn id(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Editorial => "editorial",
            Self::Foolscap => "foolscap",
            Self::Broadsheet => "broadsheet",
            Self::Nightpress => "nightpress",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::System => "System",
            Self::Editorial => "Editorial",
            Self::Foolscap => "Foolscap",
            Self::Broadsheet => "Broadsheet",
            Self::Nightpress => "Nightpress",
        }
    }
    pub const fn description(self) -> &'static str {
        match self {
            Self::Editorial => "Aged newsprint and vermilion. The room as first printed.",
            Self::Foolscap => "Cool grey-white with the yellow taken out. Easiest on tired eyes.",
            Self::Broadsheet => "Near-white and high contrast. Maximum legibility, minimum tint.",
            Self::Nightpress => "The composing room after hours. Warm dark, ink reversed out.",
            Self::System => {
                "Follow the machine — Editorial by day, Nightpress when your OS asks for dark."
            }
        }
    }

    pub const fn resolve(self, prefers_dark: bool) -> Self {
        match self {
            Self::System if prefers_dark => Self::Nightpress,
            Self::System => Self::Editorial,
            preset => preset,
        }
    }

    pub const fn palette(self, prefers_dark: bool) -> Palette {
        match self.resolve(prefers_dark) {
            Self::Foolscap => FOOLSCAP,
            Self::Broadsheet => BROADSHEET,
            Self::Nightpress => NIGHTPRESS,
            Self::System | Self::Editorial => EDITORIAL,
        }
    }
}

/// Matches the JSON stored as twyne.appearance.theme by the hosted desktop app.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ThemePreference {
    #[serde(default)]
    pub preset: ThemePreset,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub custom: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug)]
pub struct ThemeTokenDefinition {
    pub id: &'static str,
    pub css_var: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}
pub const THEME_TOKENS: &[ThemeTokenDefinition] = &[
    ThemeTokenDefinition {
        id: "paper",
        css_var: "--color-paper",
        label: "Paper",
        description: "The page itself — the ground everything sits on.",
    },
    ThemeTokenDefinition {
        id: "paper-2",
        css_var: "--color-paper-2",
        label: "Paper, deep",
        description: "Sidebars and panels, a shade below the page.",
    },
    ThemeTokenDefinition {
        id: "paper-3",
        css_var: "--color-paper-3",
        label: "Rule",
        description: "Borders, dividers, and hairlines.",
    },
    ThemeTokenDefinition {
        id: "paper-soft",
        css_var: "--color-paper-soft",
        label: "Paper, raised",
        description: "Cards, inputs, and anything lifted off the page.",
    },
    ThemeTokenDefinition {
        id: "ink",
        css_var: "--color-ink",
        label: "Ink",
        description: "Body text and headings.",
    },
    ThemeTokenDefinition {
        id: "ink-light",
        css_var: "--color-ink-light",
        label: "Ink, secondary",
        description: "Supporting text.",
    },
    ThemeTokenDefinition {
        id: "ink-muted",
        css_var: "--color-ink-muted",
        label: "Ink, muted",
        description: "Labels, captions, and placeholders.",
    },
    ThemeTokenDefinition {
        id: "vermilion",
        css_var: "--color-vermilion",
        label: "Accent",
        description: "The masthead red — buttons, marks, emphasis.",
    },
];
pub const WCAG_AA_CONTRAST: f64 = 4.5;

/// Exact `normalizeThemePreference` behavior: unknown presets become Editorial;
/// only eight plain #rgb/#rrggbb overrides survive, expanded to lower-case hex.
pub fn normalize_preference(value: &serde_json::Value) -> ThemePreference {
    let Some(raw) = value.as_object() else {
        return ThemePreference::default();
    };
    let preset = raw
        .get("preset")
        .and_then(serde_json::Value::as_str)
        .and_then(|id| ThemePreset::ALL.iter().find(|preset| preset.id() == id))
        .copied()
        .unwrap_or_default();
    let custom = raw
        .get("custom")
        .and_then(serde_json::Value::as_object)
        .into_iter()
        .flat_map(|custom| custom.iter())
        .filter(|(id, _)| THEME_TOKENS.iter().any(|token| token.id == id.as_str()))
        .filter_map(|(id, value)| Some((id.clone(), normalize_hex(value.as_str()?)?)))
        .collect();
    ThemePreference { preset, custom }
}
pub fn normalize_hex(value: &str) -> Option<String> {
    parse_hex(value).map(|color| format!("#{color:06x}"))
}
pub fn resolved_token_values(
    preference: &ThemePreference,
    prefers_dark: bool,
) -> BTreeMap<String, String> {
    let colors = resolve_palette(preference, prefers_dark);
    [
        ("paper", colors.paper),
        ("paper-2", colors.sidebar),
        ("paper-3", colors.rule),
        ("paper-soft", colors.paper_soft),
        ("ink", colors.ink),
        ("ink-light", colors.ink_light),
        ("ink-muted", colors.ink_muted),
        ("vermilion", colors.vermilion),
    ]
    .into_iter()
    .map(|(id, color)| (id.to_owned(), format!("#{color:06x}")))
    .collect()
}
pub fn theme_contrast(preference: &ThemePreference, prefers_dark: bool) -> f64 {
    fn luminance(color: u32) -> f64 {
        fn channel(value: u32) -> f64 {
            let value = value as f64 / 255.;
            // The application's original palette.ts uses this threshold.
            if value <= 0.03928 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        }
        0.2126 * channel((color >> 16) & 0xff)
            + 0.7152 * channel((color >> 8) & 0xff)
            + 0.0722 * channel(color & 0xff)
    }
    let colors = resolve_palette(preference, prefers_dark);
    let (paper, ink) = (luminance(colors.paper), luminance(colors.ink));
    (paper.max(ink) + 0.05) / (paper.min(ink) + 0.05)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub preset: ThemePreset,
    pub dark: bool,
    pub paper: u32,
    pub sidebar: u32,
    pub rule: u32,
    pub paper_soft: u32,
    pub page: u32,
    pub editor_line: u32,
    pub ink: u32,
    pub ink_light: u32,
    pub ink_muted: u32,
    pub vermilion: u32,
    pub vermilion_deep: u32,
    pub brand_light: u32,
    pub periwinkle: u32,
    pub sage: u32,
    pub mustard: u32,
    pub blush: u32,
    pub cobalt: u32,
    pub writer_note: u32,
    pub success: u32,
    pub warning: u32,
    pub danger: u32,
    pub blue: u32,
    pub emboss: u32,
    pub foxing: u32,
    pub shade: u32,
    pub foxing_alpha: f32,
}

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/palette.rs"));

// Keep existing callers compiling, with exactly the original source colors.
pub const PAPER: u32 = EDITORIAL.paper;
pub const SIDEBAR: u32 = EDITORIAL.sidebar;
pub const RULE: u32 = EDITORIAL.rule;
pub const PAGE: u32 = EDITORIAL.page;
pub const INK: u32 = EDITORIAL.ink;
pub const SECONDARY: u32 = EDITORIAL.ink_muted;
pub const VERMILION: u32 = EDITORIAL.vermilion;
pub const SUCCESS: u32 = EDITORIAL.success;
pub const INK_LIGHT: u32 = EDITORIAL.ink_light;
pub const INK_MUTED: u32 = EDITORIAL.ink_muted;
pub const PAPER_SOFT: u32 = EDITORIAL.paper_soft;
pub const EDITOR_LINE: u32 = EDITORIAL.editor_line;
pub const PERIWINKLE: u32 = EDITORIAL.periwinkle;
pub const SAGE: u32 = EDITORIAL.sage;
pub const MUSTARD: u32 = EDITORIAL.mustard;
pub const BLUSH: u32 = EDITORIAL.blush;
pub const COBALT: u32 = EDITORIAL.cobalt;
pub const WRITER_NOTE: u32 = EDITORIAL.writer_note;

pub(crate) struct NativePalette(Palette);
impl Global for NativePalette {}
struct FontsRegistered;
impl Global for FontsRegistered {}

pub fn palette(cx: &App) -> &Palette {
    cx.try_global::<NativePalette>()
        .map(|global| &global.0)
        .unwrap_or(&EDITORIAL)
}

pub fn resolve_palette(preference: &ThemePreference, prefers_dark: bool) -> Palette {
    let mut palette = preference.preset.palette(prefers_dark);
    for (token, value) in &preference.custom {
        let Some(color) = parse_hex(value) else {
            continue;
        };
        let dest = match token.as_str() {
            "paper" => &mut palette.paper,
            "paper-2" => &mut palette.sidebar,
            "paper-3" => &mut palette.rule,
            "paper-soft" => &mut palette.paper_soft,
            "ink" => &mut palette.ink,
            "ink-light" => &mut palette.ink_light,
            "ink-muted" => &mut palette.ink_muted,
            "vermilion" => &mut palette.vermilion,
            _ => continue,
        };
        *dest = color;
        if token == "ink" && palette.preset != ThemePreset::Nightpress {
            palette.shade = color;
        }
    }
    palette
}

fn parse_hex(value: &str) -> Option<u32> {
    let hex = value.strip_prefix('#')?;
    if !hex.bytes().all(|digit| digit.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        6 => u32::from_str_radix(hex, 16).ok(),
        3 => {
            let short = u32::from_str_radix(hex, 16).ok()?;
            Some(((short & 0xf00) << 8 | (short & 0xf0) << 4 | short & 0xf) * 17)
        }
        _ => None,
    }
}

pub fn editorial_font_features() -> FontFeatures {
    FontFeatures(Arc::new(vec![
        ("kern".into(), 1),
        ("liga".into(), 1),
        ("onum".into(), 1),
    ]))
}

/// Exact radial-grain sizes, positions, and opacity from the web body.
#[derive(Clone, Copy, Debug)]
pub struct GrainLayer {
    pub period_px: f32,
    pub center_x: f32,
    pub center_y: f32,
    pub radius_px: f32,
    pub color: Hsla,
}

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/grain.rs"));

pub fn paper_grain_base(palette: Palette) -> u32 {
    if palette.preset == ThemePreset::Nightpress {
        0x000000
    } else {
        palette.ink
    }
}

pub fn paper_grain_opacities(palette: Palette) -> [f32; 3] {
    match palette.preset {
        ThemePreset::Nightpress => DARK_GRAIN_ALPHA,
        ThemePreset::Broadsheet => [0.; 3],
        _ => LIGHT_GRAIN_ALPHA,
    }
}

pub fn paper_grain(palette: Palette) -> [GrainLayer; 3] {
    let base = paper_grain_base(palette);
    let alpha = paper_grain_opacities(palette);
    std::array::from_fn(|index| {
        let (period_px, center_x, center_y, radius_px) = BODY_GRAIN_LAYERS[index];
        GrainLayer {
            period_px,
            center_x,
            center_y,
            radius_px,
            color: Hsla::from(rgb(base)).alpha(alpha[index]),
        }
    })
}

fn register_fonts(cx: &mut App) -> anyhow::Result<()> {
    if cx.has_global::<FontsRegistered>() {
        return Ok(());
    }
    macro_rules! font {
        ($name:literal) => {
            Cow::Borrowed(
                include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/fonts/", $name))
                    .as_slice(),
            )
        };
    }
    cx.text_system().add_fonts(vec![
        font!("dmsans-DMSans-Regular.ttf"),
        font!("dmsans-DMSans-Italic.ttf"),
        font!("dmsans-DMSans-Bold.ttf"),
        font!("dmsans-DMSans-BoldItalic.ttf"),
        font!("TwyneButtonSans-SemiBold.ttf"),
        font!("TwyneBody-Regular.ttf"),
        font!("TwyneBody-Italic.ttf"),
        font!("TwyneBody-Bold.ttf"),
        font!("TwyneBody-BoldItalic.ttf"),
        font!("librebaskerville-LibreBaskerville-Regular.ttf"),
        font!("librebaskerville-LibreBaskerville-Italic.ttf"),
        font!("librebaskerville-LibreBaskerville-Bold.ttf"),
        font!("librebaskerville-LibreBaskerville-BoldItalic.ttf"),
        font!("specialelite-SpecialElite-Regular.ttf"),
        font!("fraunces-Fraunces-SOFT-WONK-opsz-wght.ttf"),
        font!("fraunces-Fraunces-Italic-SOFT-WONK-opsz-wght.ttf"),
        font!("DejaVuSansMono.ttf"),
        font!("DejaVuSansMono-Oblique.ttf"),
        font!("TwyneSource-Regular.ttf"),
        font!("TwyneSource-SemiBold.ttf"),
        font!("TwyneSource-Oblique.ttf"),
        font!("TwyneSourceLabel-Regular.ttf"),
        font!("NotoSansMath-Regular.ttf"),
        font!("LiberationSans-Regular.ttf"),
        font!("LiberationSerif-Bold.ttf"),
        font!("Inter-Regular.ttf"),
        font!("AdwaitaMono-Regular.ttf"),
        font!("DroidSansFallbackFull.ttf"),
        font!("LibertinusSerif-Regular.otf"),
        font!("LibertinusSerif-Italic.otf"),
        font!("LibertinusSerif-Bold.otf"),
        font!("LibertinusSerif-BoldItalic.otf"),
        font!("LibertinusMath-Regular.otf"),
        font!("source/NotoSansMono-Regular.ttf"),
    ])?;
    cx.set_global(FontsRegistered);
    Ok(())
}

pub fn apply(cx: &mut App) -> anyhow::Result<()> {
    apply_preference(&ThemePreference::default(), cx)
}

pub fn apply_preference(preference: &ThemePreference, cx: &mut App) -> anyhow::Result<()> {
    register_fonts(cx)?;
    let prefers_dark = ThemeMode::from(cx.window_appearance()).is_dark();
    let palette = resolve_palette(preference, prefers_dark);
    crate::paper_grain::prepare_palette(palette, cx)?;
    let mode = if palette.dark {
        ThemeMode::Dark
    } else {
        ThemeMode::Light
    };
    Theme::change(mode, None, cx);
    Theme::update(cx, |theme| {
        theme.font_family = SharedString::from(SANS_FONT);
        theme.font_size = px(REM_PX);
        theme.mono_font_family = SharedString::from(MONO_FONT);
        theme.mono_font_size = px(13.);
        theme.radius = px(2.);
        theme.radius_lg = px(4.);
        theme.shadow = false;
        theme.background = rgb(palette.paper).into();
        theme.foreground = rgb(palette.ink).into();
        theme.border = rgb(palette.rule).into();
        theme.input = rgb(palette.rule).into();
        theme.muted = rgb(palette.sidebar).into();
        theme.muted_foreground = rgb(palette.ink_muted).into();
        theme.accent = rgb(palette.sidebar).into();
        theme.accent_foreground = rgb(palette.ink).into();
        theme.primary = rgb(palette.vermilion).into();
        theme.primary_foreground = rgb(palette.paper).into();
        theme.primary_hover = rgb(palette.vermilion_deep).into();
        theme.primary_active = rgb(palette.vermilion_deep).into();
        theme.button_primary = theme.primary;
        theme.button_primary_foreground = theme.primary_foreground;
        theme.button_primary_hover = theme.primary_hover;
        theme.button_primary_active = theme.primary_active;
        theme.button = rgb(palette.paper_soft).into();
        theme.button_foreground = rgb(palette.ink).into();
        theme.button_hover = rgb(palette.sidebar).into();
        theme.button_active = rgb(palette.sidebar).into();
        theme.secondary = rgb(palette.sidebar).into();
        theme.secondary_foreground = rgb(palette.ink).into();
        theme.secondary_hover = rgb(palette.rule).into();
        theme.secondary_active = rgb(palette.rule).into();
        theme.button_secondary = theme.secondary;
        theme.button_secondary_foreground = theme.secondary_foreground;
        theme.button_secondary_hover = theme.secondary_hover;
        theme.button_secondary_active = theme.secondary_active;
        theme.caret = rgb(palette.vermilion).into();
        theme.ring = rgb(palette.vermilion).into();
        theme.selection = Hsla::from(rgb(palette.vermilion)).alpha(0.18);
        theme.link = rgb(palette.vermilion).into();
        theme.link_hover = rgb(palette.vermilion_deep).into();
        theme.link_active = rgb(palette.vermilion_deep).into();
        theme.success = rgb(palette.success).into();
        theme.warning = rgb(palette.warning).into();
        theme.danger = rgb(palette.danger).into();
        theme.info = rgb(palette.blue).into();
        theme.popover = rgb(palette.paper_soft).into();
        theme.popover_foreground = rgb(palette.ink).into();
        theme.colors.list = rgb(palette.sidebar).into();
        theme.list_active = rgb(palette.paper_soft).into();
        theme.list_active_border = rgb(palette.vermilion).into();
        theme.list_hover = rgb(palette.paper).into();
        theme.list_head = rgb(palette.sidebar).into();
    });
    cx.set_global(NativePalette(palette));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_and_custom_shape_matches_web_preferences() {
        let preference: ThemePreference = serde_json::from_str(
            r##"{"preset":"nightpress","custom":{"paper":"#abc","ink":"#102030","unknown":"#ffffff","vermilion":"url(evil)"}}"##,
        ).unwrap();
        let palette = resolve_palette(&preference, false);
        assert_eq!(palette.paper, 0xaabbcc);
        assert_eq!(palette.ink, 0x102030);
        assert_eq!(palette.vermilion, NIGHTPRESS.vermilion);
        assert_eq!(palette.page, NIGHTPRESS.page);
        assert_eq!(ThemePreset::System.palette(true), NIGHTPRESS);
        assert_eq!(ThemePreset::System.palette(false), EDITORIAL);
        assert_eq!(
            serde_json::from_str::<ThemePreset>("\"invalid\"").unwrap(),
            ThemePreset::Editorial
        );
    }

    #[test]
    fn editorial_preserves_source_colors_and_grain() {
        assert_eq!(SECONDARY, 0x8a7e6c);
        assert_eq!(SUCCESS, 0x5b7a3a);
        assert_eq!(INK_LIGHT, 0x4a3f33);
        assert_eq!(paper_grain(EDITORIAL)[0].color.a, 0.025);
        assert_eq!(paper_grain(BROADSHEET)[0].color.a, 0.);
        assert_eq!(paper_grain(NIGHTPRESS)[0].color.a, 0.18);
        assert_eq!(
            DOCUMENT_COLORS
                .iter()
                .find(|(name, _)| *name == "--color-text-olive")
                .unwrap()
                .1,
            0x556134
        );
    }

    #[cfg(feature = "ui-tests")]
    #[gpui_kit::test]
    fn palette_and_typography_reach_the_component_theme(cx: &mut gpui_kit::TestAppContext) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            apply(cx).unwrap();
            let preference = ThemePreference {
                preset: ThemePreset::Nightpress,
                custom: BTreeMap::from([("paper".into(), "#141210".into())]),
            };
            apply_preference(&preference, cx).unwrap();
            assert_eq!(palette(cx).paper, 0x141210);
            let theme = Theme::global(cx);
            assert!(theme.is_dark());
            assert_eq!(theme.background, Hsla::from(rgb(0x141210)));
            assert_eq!(theme.tokens.background.color, theme.background);
            assert_eq!(theme.font_size, px(16.));
            assert_eq!(theme.radius, px(2.));
            assert_eq!(theme.font_family.as_ref(), SANS_FONT);
            // TestAppContext uses a virtual font system. This assertion proves
            // repeat application preserves colors, rather than claiming that
            // its font enumeration is a real platform rendering check.
            apply_preference(&preference, cx).unwrap();
            assert_eq!(palette(cx).paper, 0x141210);
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_selects_original_paper_button_axes() {
        use gpui_kit::{FontWeight, HeadlessAppContext, TextRun, WindowTextSystem, font};
        let platform = gpui_kit::platform::current_platform(true);
        let actual = platform.text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let provenance: serde_json::Value = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/button-font-provenance.json"))).unwrap();
            let mut face = font(BUTTON_FONT);
            face.weight = FontWeight::SEMIBOLD;
            let id = actual.font_id(&face).unwrap();
            let mut original_default = font(SANS_FONT);
            original_default.weight = FontWeight::SEMIBOLD;
            assert_ne!(id, actual.font_id(&original_default).unwrap());
            for (text, expected) in provenance["testGlyphs"].as_object().unwrap() {
                let glyph = actual.glyph_for_char(id, text.chars().next().unwrap()).unwrap();
                assert_eq!(u64::from(glyph.0), expected["glyphId"].as_u64().unwrap());
                assert!((actual.advance(id, glyph).unwrap().width - expected["advanceUnits"].as_f64().unwrap() as f32).abs() < 0.001);
            }
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let text: SharedString = "Save note".into();
            let line = shaper.shape_line(text.clone(), px(12.), &[TextRun {len:text.len(),font:face,..Default::default()}], None);
            let width = f32::from(line.width());
            // Original response Chrome154 measures56.84375px at auto opsz12.
            // Native static instancing and CSS advance quantization are distinct.
            assert!((width - 56.84375).abs() < 0.03, "actual native button advance: {width}");
            if let Some(path) = std::env::var_os("TWYNE_BUTTON_AFTER_PROOF") {
                std::fs::write(path, serde_json::to_string_pretty(&serde_json::json!({
                    "system":"Actual Linux Cosmic/Swash platform text system",
                    "family":BUTTON_FONT,"sourceVersion":"4.004","axes":{"opsz":12,"wght":600},
                    "actualSelectedFontId":format!("{id:?}"),"source":text.as_ref(),"fontSizePx":12.,
                    "nativeAdvancePx":width,"originalResponseBrowserAdvancePx":56.84375,
                    "exactDerivedGlyphIdsAndAdvanceUnits":true,"defaultSansUnchanged":true
                })).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    #[ignore = "read-only actual selected button-font metric probe"]
    fn actual_platform_button_font_metric_probe() {
        use gpui_kit::{FontWeight, HeadlessAppContext, TextRun, WindowTextSystem, font};
        let platform = gpui_kit::platform::current_platform(true);
        let actual = platform.text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let mut rows = Vec::new();
            let mut dm_ids = Vec::new();
            for weight in [400., 600., 700.] {
                let mut face = font(SANS_FONT);
                face.weight = FontWeight(weight);
                let id = actual.font_id(&face).unwrap();
                dm_ids.push(id);
                let text: SharedString = "Save note".into();
                let line = shaper.shape_line(text.clone(), px(12.), &[TextRun { len:text.len(), font:face, ..Default::default() }], None);
                rows.push(serde_json::json!({"requestedWeight":weight,"fontId":format!("{id:?}"),"source":text.as_ref(),"widthPx":f32::from(line.width())}));
            }
            let text: SharedString = "PLACE NOTE".into();
            let line = shaper.shape_line(text.clone(), px(11.2), &[TextRun { len:text.len(), font:font(TYPEWRITER_FONT), ..Default::default() }], None);
            let width = f32::from(line.width());
            let report = serde_json::json!({
                "system":"Actual Linux Cosmic/Swash platform text system",
                "dmSans600Resolves700":dm_ids[1]==dm_ids[2],"dmSansRows":rows,
                "specialElite":{"source":text.as_ref(),"fontSizePx":11.2,"untrackedWidthPx":width,"trackingPx":2.016,"cssAdvanceIncludingFinalTrackingPx":width+2.016*text.chars().count() as f32}
            });
            println!("{}",serde_json::to_string_pretty(&report).unwrap());
            if let Some(path)=std::env::var_os("TWYNE_BUTTON_FONT_PROOF") {
                std::fs::write(path,serde_json::to_string_pretty(&report).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_selects_original_file_disclosure_glyph_without_changing_button_face() {
        use gpui_kit::{HeadlessAppContext, TextRun, WindowTextSystem, font};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let face = file_disclosure_font();
            let id = actual.font_id(&face).unwrap();
            let glyph = actual.glyph_for_char(id, '▾').unwrap();
            assert_eq!(glyph.0, 4754);
            assert!((actual.advance(id, glyph).unwrap().width - 462.).abs() < 0.001);
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let line = shaper.layout_line(
                "▾",
                px(12.),
                &[TextRun {
                    len: "▾".len(),
                    font: face,
                    ..Default::default()
                }],
                None,
            );
            assert_eq!(line.runs[0].font_id, id);
            assert_eq!(line.runs[0].glyphs[0].id, glyph);
            assert!((f32::from(line.width) - 5.546875).abs() < 0.01);
            let file = shaper.layout_line(
                "File",
                px(12.),
                &[TextRun {
                    len: 4,
                    font: font(BUTTON_FONT),
                    ..Default::default()
                }],
                None,
            );
            assert!((f32::from(file.width) - 19.984375).abs() < 0.01);
            // No global Sans or button-family substitution is part of this
            // explicit glyph face; their missing-character policy is separate.
            assert_ne!(line.runs[0].font_id, file.runs[0].font_id);
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    #[ignore = "read-only actual footer label sizing probe"]
    fn actual_platform_footer_font_metric_probe() {
        use gpui_kit::{HeadlessAppContext, TextRun, WindowTextSystem, font};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app =
            HeadlessAppContext::with_asset_source(actual, Arc::new(crate::assets::TwyneAssets));
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let mut rows = Vec::new();
            for family in [SANS_FONT, SOURCE_HELPER_FONT] {
                for text in ["Pages", "1 page", "Page 1 of 1", "Pages ⌄", "79 words"] {
                    let line = shaper.layout_line(text, px(11.), &[TextRun{len:text.len(),font:font(family),..Default::default()}],None);
                    rows.push(serde_json::json!({"requestedFamily":family,"weight":400,"fontSizePx":11.,"source":text,"widthPx":f32::from(line.width),"selectedRuns":line.runs.iter().map(|run|serde_json::json!({"fontId":format!("{:?}",run.font_id),"glyphs":run.glyphs.iter().map(|g|g.id.0).collect::<Vec<_>>()})).collect::<Vec<_>>()}));
                }
            }
            let proof = serde_json::json!({"system":"actual Linux Cosmic/Swash text system","browserEvidence":"fixtures/source_view/font-evidence/footer-select-sizing-probe.json","rows":rows,"boundary":"direct native label shaping; Root native dropdown is a separate control"});
            println!("{}",serde_json::to_string_pretty(&proof).unwrap());
            if let Some(path)=std::env::var_os("TWYNE_FOOTER_FONT_PROOF") {
                std::fs::write(path,serde_json::to_string_pretty(&proof).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    #[ignore = "read-only actual File-arrow fallback metric probe"]
    fn actual_platform_file_arrow_font_metric_probe() {
        use gpui_kit::{FontWeight, HeadlessAppContext, TextRun, WindowTextSystem, font};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let mut rows = Vec::new();
            for family in [BUTTON_FONT, SANS_FONT, "Noto Sans Math", "Noto Sans", "DejaVu Sans", "Noto Sans Symbols 2"] {
                for weight in [400., 600.] {
                    let mut face = font(family);
                    face.weight = FontWeight(weight);
                    let Ok(requested_id) = actual.font_id(&face) else { continue; };
                    for text in ["File", "▾"] {
                        let line = shaper.layout_line(text, px(12.), &[TextRun {len:text.len(),font:face.clone(),..Default::default()}], None);
                        rows.push(serde_json::json!({"requestedFamily":family,"weight":weight,
                            "requestedFontId":format!("{requested_id:?}"),"source":text,
                            "fontSizePx":12.,"widthPx":f32::from(line.width),
                            "primaryContainsArrow":actual.glyph_for_char(requested_id,'▾').is_some(),
                            "selectedRuns":line.runs.iter().map(|run|serde_json::json!({
                                "fontId":format!("{:?}",run.font_id),"glyphs":run.glyphs.iter().map(|glyph|serde_json::json!({
                                    "id":glyph.id.0,"index":glyph.index,"xPx":f32::from(glyph.position.x)
                                })).collect::<Vec<_>>()
                            })).collect::<Vec<_>>()
                        }));
                    }
                }
            }
            let proof = serde_json::json!({"system":"actual Linux Cosmic/Swash text system",
                "boundary":"direct native shaping probe; actual Root File control screenshot is separate",
                "browserEvidence":"fixtures/source_view/font-evidence/file-arrow-actual-app.json","rows":rows});
            println!("{}",serde_json::to_string_pretty(&proof).unwrap());
            if let Some(path)=std::env::var_os("TWYNE_FILE_ARROW_PROOF") {
                std::fs::write(path,serde_json::to_string_pretty(&proof).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_selects_original_lora_ui_faces_and_advances() {
        use gpui_kit::{FontStyle, FontWeight, HeadlessAppContext, font};
        let platform = gpui_kit::platform::current_platform(true);
        let actual = platform.text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let provenance: serde_json::Value = serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/lora-ui-provenance.json"
            )))
            .unwrap();
            let mut ids = Vec::new();
            let mut proof = Vec::new();
            for instance in provenance["instances"].as_array().unwrap() {
                let style = instance["style"].as_str().unwrap();
                let mut face = font(resolve_ui_font_family("Lora"));
                face.weight = FontWeight(instance["axes"]["wght"].as_f64().unwrap() as f32);
                face.style = if style.contains("Italic") {
                    FontStyle::Italic
                } else {
                    FontStyle::Normal
                };
                let id = actual.font_id(&face).unwrap();
                assert!(!ids.contains(&id), "each original weight/style needs its own face");
                ids.push(id);
                let mut glyphs = Vec::new();
                for (text, expected) in instance["testGlyphs"].as_object().unwrap() {
                    let ch = text.chars().next().unwrap();
                    let glyph = actual.glyph_for_char(id, ch).unwrap();
                    assert_eq!(u64::from(glyph.0), expected["glyphId"].as_u64().unwrap());
                    let advance = actual.advance(id, glyph).unwrap().width;
                    let expected_advance = expected["advanceUnits"].as_f64().unwrap() as f32;
                    assert!((advance - expected_advance).abs() < 0.001, "{style} {ch}: exact 3.008 advance units");
                    glyphs.push(serde_json::json!({"character":ch,"glyphId":glyph.0,"advanceUnits":advance}));
                }
                proof.push(serde_json::json!({"style":style,"fontId":format!("{id:?}"),"sourceSha256":instance["sourceSha256"],"glyphs":glyphs}));
            }
            assert_eq!(resolve_ui_font_family("Lora").as_ref(), SERIF_FONT);
            assert_eq!(resolve_ui_font_family(SERIF_FONT).as_ref(), SERIF_FONT);
            assert_eq!(resolve_ui_font_family("Georgia").as_ref(), "Georgia");
            assert_eq!(resolve_ui_font_family("lora").as_ref(), "lora");

            // The pinned renderer resolves default variable coordinates; a
            // 700 request alone cannot instantiate the original variable face.
            actual.add_fonts(vec![
                Cow::Borrowed(include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/fonts/lora-Lora-wght.ttf"))),
                Cow::Borrowed(include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/fonts/lora-Lora-Italic-wght.ttf"))),
            ]).unwrap();
            assert_eq!(actual.font_id(&font("Lora")).unwrap(), actual.font_id(&font("Lora").bold()).unwrap());
            assert_eq!(actual.font_id(&font("Lora").italic()).unwrap(), actual.font_id(&font("Lora").bold().italic()).unwrap());
            if let Some(path) = std::env::var_os("TWYNE_LORA_UI_FONT_PROOF") {
                std::fs::write(path, serde_json::to_string_pretty(&serde_json::json!({
                    "system":"Actual Linux Cosmic/Swash platform text system",
                    "sourceFamily":"Lora","nativeFamily":SERIF_FONT,"version":"3.008",
                    "distinctSelectedFaces":true,"sourceVariableRequiresStaticWeightInstances":true,
                    "canonicalFamilyMappingOnlyAtRender":true,"faces":proof
                })).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_selects_apparatus_original_mono_without_changing_source() {
        use gpui_kit::{HeadlessAppContext, TextRun, WindowTextSystem};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let face = apparatus_mono_font();
            assert_eq!(face.family.as_ref(), "Noto Sans Mono");
            assert_eq!(face.weight, gpui_kit::FontWeight::NORMAL);
            assert_eq!(face.style, gpui_kit::FontStyle::Normal);
            assert!(face.fallbacks.is_none());
            let id = actual.font_id(&face).unwrap();
            assert_ne!(id, actual.font_id(&source_font()).unwrap());
            assert_ne!(id, actual.font_id(&font(MONO_FONT)).unwrap());
            let provenance: serde_json::Value = serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/source-font-provenance.json"
            )))
            .unwrap();
            let original = provenance["faces"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["style"] == "Regular")
                .unwrap();
            for (text, expected) in original["testGlyphs"].as_object().unwrap() {
                let glyph = actual
                    .glyph_for_char(id, text.chars().next().unwrap())
                    .unwrap();
                assert_eq!(u64::from(glyph.0), expected["glyphId"].as_u64().unwrap());
                assert!(
                    (actual.advance(id, glyph).unwrap().width
                        - expected["advanceUnits"].as_f64().unwrap() as f32)
                        .abs()
                        < 0.001
                );
            }
            let text: SharedString = "doi:10.1234/native".into();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let line = shaper.shape_line(
                text.clone(),
                px(11.),
                &[TextRun {
                    len: text.len(),
                    font: face,
                    ..Default::default()
                }],
                None,
            );
            assert_eq!(line.text, text);
            assert_eq!(line.runs.len(), 1);
            assert!((f32::from(line.width()) - text.len() as f32 * 6.6).abs() < 0.001);
            assert_eq!(MONO_FONT, "DejaVu Sans Mono");
            assert_eq!(source_font().family.as_ref(), SOURCE_FONT);
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_selects_source_original_weight_and_oblique_with_exact_advances() {
        use gpui_kit::{FontStyle, FontWeight, HeadlessAppContext, TextRun, WindowTextSystem};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let provenance: serde_json::Value = serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/source-font-provenance.json"
            )))
            .unwrap();
            let mut ids = Vec::new();
            let mut faces = Vec::new();
            for face in provenance["faces"].as_array().unwrap() {
                let mut selected = source_font();
                selected.weight = FontWeight(face["weight"].as_f64().unwrap() as f32);
                selected.style = if face["style"] == "Oblique" {
                    FontStyle::Italic
                } else {
                    FontStyle::Normal
                };
                let id = actual.font_id(&selected).unwrap();
                assert!(!ids.contains(&id), "Source400/600/oblique must select distinct faces");
                ids.push(id);
                let mut glyphs = Vec::new();
                for (text, expected) in face["testGlyphs"].as_object().unwrap() {
                    let character = text.chars().next().unwrap();
                    let glyph = actual.glyph_for_char(id, character).unwrap();
                    let advance = actual.advance(id, glyph).unwrap().width;
                    assert_eq!(u64::from(glyph.0), expected["glyphId"].as_u64().unwrap());
                    assert!((advance - expected["advanceUnits"].as_f64().unwrap() as f32).abs() < 0.001);
                    glyphs.push(serde_json::json!({"character":character,"glyphId":glyph.0,"advanceUnits":advance}));
                }
                faces.push(serde_json::json!({"style":face["style"],"weight":face["weight"],"fontId":format!("{id:?}"),"glyphs":glyphs}));
            }
            let text: SharedString = "// Source: Café = #text(\"m\")".into();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let shape = |selected| shaper.shape_line(text.clone(), px(13.), &[TextRun { len:text.len(), font:selected, ..Default::default() }], None);
            let regular = shape(source_font());
            let oblique = shape(source_font().italic());
            let mut heading = source_font();
            heading.weight = FontWeight::SEMIBOLD;
            let heading = shape(heading);
            for line in [&regular, &oblique, &heading] {
                assert_eq!(line.text, text);
                assert_eq!(line.runs.len(), 1);
                assert!((f32::from(line.width()) - text.chars().count() as f32 * 7.8).abs() < 0.001);
            }
            assert_eq!(regular.width(), oblique.width());
            assert_eq!(regular.width(), heading.width());
            assert_eq!(MONO_FONT, "DejaVu Sans Mono");
            assert_eq!(source_font().family.as_ref(), SOURCE_FONT);
            if let Some(path) = std::env::var_os("TWYNE_SOURCE_FONT_PROOF") {
                std::fs::write(path, serde_json::to_string_pretty(&serde_json::json!({
                    "system":"Actual Linux Cosmic/Swash platform text system",
                    "family":SOURCE_FONT,"version":"2.014","distinctSelectedFaces":true,
                    "sourceGlyphIdsAndAdvancesUnchanged":true,"text":text,
                    "shapedWidth13px":f32::from(regular.width()),"faces":faces,
                    "rasterBoundary":"Oblique source-derived outlines use quarter shear; Chromium's actual synthetic raster remains a separate pixel check",
                    "fallbackBoundaries":"Droid CJK/kana explicit; Hangul/emoji remain platform-dependent"
                })).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_selects_the_matching_mono_oblique_without_changing_advances() {
        use gpui_kit::{HeadlessAppContext, TextRun, WindowTextSystem, font};

        // This uses Linux's actual Cosmic/FreeType shaping system, rather than
        // the virtual TestApp font implementation. No window/display is opened.
        let platform = gpui_kit::platform::current_platform(true);
        let mut app = HeadlessAppContext::with_asset_source(
            platform.text_system(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let text_system = cx.text_system();
            let regular = font(MONO_FONT);
            let oblique = regular.clone().italic();
            let regular_id = text_system.resolve_font(&regular);
            let oblique_id = text_system.resolve_font(&oblique);
            assert_ne!(regular_id, oblique_id, "italic must resolve its own face");
            assert!(
                text_system
                    .all_font_names()
                    .iter()
                    .any(|family| family == MONO_FONT)
            );
            let expected = text_system.advance(regular_id, px(12.), 'M').unwrap();
            for ch in "// Document helpers #set page(width: 210mm)".chars() {
                for id in [regular_id, oblique_id] {
                    let actual = text_system.advance(id, px(12.), ch).unwrap();
                    assert_eq!(actual.width, expected.width, "{ch:?}: mono advance");
                }
            }
            let source: SharedString = "// Document helpers".into();
            let shaper = WindowTextSystem::new(text_system.clone());
            let shape = |font| {
                shaper.shape_line(
                    source.clone(),
                    px(12.),
                    &[TextRun {
                        len: source.len(),
                        font,
                        color: rgb(EDITORIAL.ink).into(),
                        ..Default::default()
                    }],
                    None,
                )
            };
            let regular_line = shape(regular);
            let oblique_line = shape(oblique);
            assert_eq!(regular_line.runs.len(), 1);
            assert_eq!(oblique_line.runs.len(), 1);
            assert_eq!(regular_line.runs[0].font_id, regular_id);
            assert_eq!(oblique_line.runs[0].font_id, oblique_id);
            assert_eq!(regular_line.width(), oblique_line.width());
            assert_eq!(regular_line.text, oblique_line.text);
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    #[ignore = "diagnostic probe for actual platform CJK fallback faces"]
    fn actual_platform_cjk_fallback_probe() {
        use gpui_kit::{HeadlessAppContext, TextRun, WindowTextSystem, font};
        let platform = gpui_kit::platform::current_platform(true);
        let mut app = HeadlessAppContext::with_asset_source(
            platform.text_system(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let system = cx.text_system();
            let source: SharedString = "Prefix 東京 tail.".into();
            let shaper = WindowTextSystem::new(system.clone());
            let shaped = shaper.shape_line(
                source.clone(),
                px(18.),
                &[TextRun {
                    len: source.len(),
                    font: font(SERIF_FONT),
                    ..Default::default()
                }],
                None,
            );
            let report = serde_json::json!({
                "source":source.as_ref(),
                "font":"Lora18 regular, unspecified fallback",
                "width":f32::from(shaped.width()),
                // Font IDs identify loaded native faces, not public family
                // names. Compare the actual glyph IDs with the original face
                // rather than inferring its family from candidate resolution.
                "runs":shaped.runs.iter().map(|run|serde_json::json!({"fontId":format!("{:?}",run.font_id),"glyphs":run.glyphs.iter().map(|glyph|glyph.id.0).collect::<Vec<_>>()})).collect::<Vec<_>>()
            });
            println!("{}",serde_json::to_string_pretty(&report).unwrap());
            if let Some(path)=std::env::var_os("TWYNE_CJK_FONT_PROBE") {
                std::fs::write(path,serde_json::to_string_pretty(&report).unwrap()).unwrap();
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_cast_symbols_use_original_glyphs_and_advances() {
        use gpui_kit::{HeadlessAppContext, RenderGlyphParams, TextRun, WindowTextSystem, point};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let face = cast_badge_font();
            let again = cast_badge_font();
            assert_eq!(face.family.as_ref(), SANS_FONT);
            assert_eq!(face.weight, gpui_kit::FontWeight::NORMAL);
            assert_eq!(face.style, gpui_kit::FontStyle::Normal);
            assert!(Arc::ptr_eq(
                &face.fallbacks.as_ref().unwrap().0,
                &again.fallbacks.as_ref().unwrap().0,
            ));
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let proof: serde_json::Value = serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/cast-font-provenance.json"
            )))
            .unwrap();
            for symbol in proof["originalGlyphs"].as_array().unwrap() {
                let text = symbol["text"].as_str().unwrap();
                let line = shaper.layout_line(
                    text,
                    px(11.2),
                    &[TextRun {
                        len: text.len(),
                        font: face.clone(),
                        ..Default::default()
                    }],
                    None,
                );
                assert_eq!(line.runs.len(), 1);
                assert_eq!(line.runs[0].glyphs.len(), 1);
                let run = &line.runs[0];
                let glyph = &run.glyphs[0];
                assert_eq!(u64::from(glyph.id.0), symbol["glyphId"].as_u64().unwrap());
                assert_eq!(glyph.index, 0);
                assert!(!glyph.is_emoji);
                assert!(
                    (f64::from(f32::from(line.width))
                        - symbol["advanceAt11_2Px"].as_f64().unwrap())
                    .abs()
                        < 0.001,
                    "original Cast advance: {text}"
                );
                let parameters = RenderGlyphParams {
                    font_id: run.font_id,
                    glyph_id: glyph.id,
                    font_size: px(11.2),
                    subpixel_variant: point(0, 0),
                    scale_factor: 1.,
                    is_emoji: false,
                    subpixel_rendering: false,
                    dilation: 0,
                };
                let bounds = actual.glyph_raster_bounds(&parameters).unwrap();
                let (_, mask) = actual.rasterize_glyph(&parameters, bounds).unwrap();
                assert!(
                    mask.iter().any(|alpha| *alpha != 0),
                    "Cast glyph mask: {text}"
                );
            }
            let latin = "Cast editorial";
            let shape = |face| {
                shaper.layout_line(
                    latin,
                    px(11.2),
                    &[TextRun {
                        len: latin.len(),
                        font: face,
                        ..Default::default()
                    }],
                    None,
                )
            };
            let ordinary = shape(font(SANS_FONT));
            let badge = shape(face);
            assert_eq!(ordinary.width, badge.width);
            let glyphs = |line: &gpui_kit::LineLayout| {
                line.runs
                    .iter()
                    .flat_map(|run| run.glyphs.iter().map(|glyph| (glyph.id, glyph.position)))
                    .collect::<Vec<_>>()
            };
            assert_eq!(glyphs(&ordinary), glyphs(&badge));
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn real_platform_cast_raw_symbols_use_original_glyphs_and_advances() {
        use gpui_kit::{HeadlessAppContext, RenderGlyphParams, TextRun, WindowTextSystem, point};
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            actual.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let face = cast_raw_glyph_font();
            let again = cast_raw_glyph_font();
            assert_eq!(face.family.as_ref(), DISPLAY_FONT);
            assert_eq!(face.weight, gpui_kit::FontWeight::SEMIBOLD);
            assert_eq!(face.style, gpui_kit::FontStyle::Normal);
            assert!(Arc::ptr_eq(
                &face.fallbacks.as_ref().unwrap().0,
                &again.fallbacks.as_ref().unwrap().0,
            ));
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let shape = |text: &str, font| {
                shaper.layout_line(
                    text,
                    px(16.),
                    &[TextRun {
                        len: text.len(),
                        font,
                        ..Default::default()
                    }],
                    None,
                )
            };
            let proof: serde_json::Value = serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/cast-raw-font-provenance.json"
            )))
            .unwrap();
            for symbol in proof["originalGlyphs"].as_array().unwrap() {
                let text = symbol["text"].as_str().unwrap();
                let line = shape(text, face.clone());
                assert_eq!(line.runs.len(), 1);
                assert_eq!(line.runs[0].glyphs.len(), 1);
                let run = &line.runs[0];
                let glyph = &run.glyphs[0];
                assert_eq!(u64::from(glyph.id.0), symbol["glyphId"].as_u64().unwrap());
                assert_eq!(glyph.index, 0);
                assert!(!glyph.is_emoji);
                assert!(
                    (f64::from(f32::from(line.width)) - symbol["advanceAt16Px"].as_f64().unwrap())
                        .abs()
                        < 0.001,
                    "original raw Cast advance: {text}"
                );
                let parameters = RenderGlyphParams {
                    font_id: run.font_id,
                    glyph_id: glyph.id,
                    font_size: px(16.),
                    subpixel_variant: point(0, 0),
                    scale_factor: 1.,
                    is_emoji: false,
                    subpixel_rendering: false,
                    dilation: 0,
                };
                let bounds = actual.glyph_raster_bounds(&parameters).unwrap();
                let (_, mask) = actual.rasterize_glyph(&parameters, bounds).unwrap();
                assert!(
                    mask.iter().any(|alpha| *alpha != 0),
                    "raw Cast glyph mask: {text}"
                );
            }
            let text = "Mlle. Sceptique Sœur Encourageante Professeur Athenæum Le Lecteur";
            let mut ordinary_face = font(DISPLAY_FONT);
            ordinary_face.weight = gpui_kit::FontWeight::SEMIBOLD;
            let ordinary = shape(text, ordinary_face);
            let explicit = shape(text, face);
            assert_eq!(ordinary.width, explicit.width);
            let glyphs = |line: &gpui_kit::LineLayout| {
                line.runs
                    .iter()
                    .flat_map(|run| {
                        run.glyphs
                            .iter()
                            .map(|glyph| (glyph.id, glyph.position, glyph.index))
                    })
                    .collect::<Vec<_>>()
            };
            assert_eq!(glyphs(&ordinary), glyphs(&explicit));
            // Role-specific font caches can assign different native FontIds to
            // the same primary face. Compare real glyph masks as well as the
            // source-safe glyph IDs/positions rather than cache identifiers.
            let first_mask = |line: &gpui_kit::LineLayout| {
                let run = &line.runs[0];
                let glyph = &run.glyphs[0];
                let parameters = RenderGlyphParams {
                    font_id: run.font_id,
                    glyph_id: glyph.id,
                    font_size: px(16.),
                    subpixel_variant: point(0, 0),
                    scale_factor: 1.,
                    is_emoji: false,
                    subpixel_rendering: false,
                    dilation: 0,
                };
                let bounds = actual.glyph_raster_bounds(&parameters).unwrap();
                (bounds, actual.rasterize_glyph(&parameters, bounds).unwrap())
            };
            assert_eq!(first_mask(&ordinary), first_mask(&explicit));
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn explicit_original_cjk_fallback_shapes_actual_glyphs_and_preserves_primary_gate() {
        use gpui_kit::{HeadlessAppContext, TextRun, WindowTextSystem, font};
        let platform = gpui_kit::platform::current_platform(true);
        let platform_fonts = platform.text_system();
        let mut app = HeadlessAppContext::with_asset_source(
            platform_fonts.clone(),
            Arc::new(crate::assets::TwyneAssets),
        );
        app.update(|cx| {
            register_fonts(cx).unwrap();
            let first_chain = serif_font_fallbacks();
            let second_chain = serif_font_fallbacks();
            assert!(Arc::ptr_eq(&first_chain.0, &second_chain.0));
            let mut original = font(SERIF_FONT);
            original.fallbacks = Some(first_chain);
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            let shape = |text: &'static str, face| {
                shaper.shape_line(
                    text.into(),
                    px(18.),
                    &[TextRun {
                        len: text.len(),
                        font: face,
                        ..Default::default()
                    }],
                    None,
                )
            };
            let assert_droid = |line: &gpui_kit::ShapedLine| {
                let east = line
                    .runs
                    .iter()
                    .flat_map(|run| run.glyphs.iter().map(move |glyph| (run.font_id, glyph)))
                    .find(|(_, glyph)| glyph.index == 7)
                    .unwrap();
                let capital = line
                    .runs
                    .iter()
                    .flat_map(|run| run.glyphs.iter().map(move |glyph| (run.font_id, glyph)))
                    .find(|(_, glyph)| glyph.index == 10)
                    .unwrap();
                assert_eq!(east.1.id.0, 13577, "original Droid glyph for 東");
                assert_eq!(capital.1.id.0, 7236, "original Droid glyph for 京");
                assert_eq!(east.0, capital.0);
                assert_eq!(
                    platform_fonts.glyph_for_char(east.0, '東').unwrap().0,
                    13577
                );
            };
            let selected = shape("Prefix 東京 tail.", original.clone());
            assert_droid(&selected);

            // A fallback loaded first must never bypass primary font validation.
            // The platform call exposes rejection instead of TextSystem's normal
            // UI fallback-stack recovery, and must leave the face in its DB.
            assert!(platform_fonts.font_id(&font(SERIF_CJK_FALLBACK_FONT)).is_err());
            let mut after_rejection = original.clone();
            after_rejection.features = FontFeatures::disable_ligatures();
            assert_droid(&shape("Prefix 東京 tail.", after_rejection));

            let latin_before = shape("Latin coffee é", font(SERIF_FONT));
            let latin_after = shape("Latin coffee é", original.clone());
            assert_eq!(latin_before.width(), latin_after.width());
            let glyphs = |line: &gpui_kit::ShapedLine| {
                line.runs
                    .iter()
                    .flat_map(|run| run.glyphs.iter().map(|glyph| (glyph.id, glyph.position)))
                    .collect::<Vec<_>>()
            };
            assert_eq!(glyphs(&latin_before), glyphs(&latin_after));
            assert_eq!(selected.text.as_ref(), "Prefix 東京 tail.");

            if let Some(path) = std::env::var_os("TWYNE_CJK_ORIGINAL_FONT_PROOF") {
                std::fs::write(
                    path,
                    serde_json::to_string_pretty(&serde_json::json!({
                        "source":selected.text.as_ref(),
                        "font":"Lora18 regular + explicit original Droid Sans Fallback",
                        "glyphs":selected.runs.iter().flat_map(|run|run.glyphs.iter().map(move|glyph|serde_json::json!({"sourceByte":glyph.index,"fontId":format!("{:?}",run.font_id),"glyphId":glyph.id.0,"position":glyph.position}))).collect::<Vec<_>>(),
                        "fallbackFirstPrimaryRejected":true,
                        "primaryRejectionLeavesFallbackAvailable":true,
                        "latinAdvancesAndGlyphsUnchanged":true,
                        "sourceUnchanged":true,
                        "fallbackChainArcReused":true
                    }))
                    .unwrap(),
                )
                .unwrap();
            }
        });
    }
}
