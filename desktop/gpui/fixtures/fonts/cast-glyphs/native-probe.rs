//! Read-only standalone native glyph audit; links the already-built shipping library.
use gpui_kit::{
    FontFallbacks, HeadlessAppContext, PlatformTextSystem, RenderGlyphParams, TextRun,
    WindowTextSystem, font, point, px,
};
use std::sync::Arc;
use twyne_desktop::{assets::TwyneAssets, theme};

fn main() {
    let embedded_only = std::env::args().any(|arg| arg == "--embedded-only");
    let actual: Arc<dyn PlatformTextSystem> = if embedded_only {
        Arc::new(gpui_wgpu::CosmicTextSystem::new_without_system_fonts(
            theme::SANS_FONT,
        ))
    } else {
        gpui_kit::platform::current_platform(true).text_system()
    };
    let initial_fonts = actual.all_font_names();
    if embedded_only {
        assert!(
            initial_fonts.is_empty(),
            "Hermetic probe must start without system fonts"
        );
    }
    let mut app = HeadlessAppContext::with_asset_source(actual.clone(), Arc::new(TwyneAssets));
    app.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
        let shaper = WindowTextSystem::new(cx.text_system().clone());
        let mut rows = Vec::new();
        let known = actual.all_font_names();
        for (label, primary, explicit) in [
            ("shipping-sans-automatic", theme::SANS_FONT, None),
            ("bundled-cast-helper", theme::SANS_FONT, None),
            ("sans-with-Inter-first", theme::SANS_FONT, Some(vec!["Inter"])),
            ("sans-with-exact-cast-chain", theme::SANS_FONT, Some(vec!["Inter", "Liberation Sans", "Adwaita Mono"])),
            ("sans-with-symbols2", theme::SANS_FONT, Some(vec!["Noto Sans Symbols 2"])),
            ("sans-with-symbols", theme::SANS_FONT, Some(vec!["Noto Sans Symbols"])),
            ("DejaVu Sans", "DejaVu Sans", None),
            ("Noto Sans", "Noto Sans", None),
            ("Liberation Sans", "Liberation Sans", None),
            ("Inter", "Inter", None),
            ("Adwaita Mono", "Adwaita Mono", None),
            ("shipped-Noto-Sans-Math", "Noto Sans Math", None),
            ("shipped-DejaVu-Sans-Mono", theme::MONO_FONT, None),
        ] {
            let mut face = font(primary);
            if label == "bundled-cast-helper" {
                face = theme::cast_badge_font();
            }
            if let Some(families) = explicit {
                face.fallbacks = Some(FontFallbacks::from_fonts(families.into_iter().map(Into::into).collect()));
            }
            let requested = actual.font_id(&face);
            let Ok(requested) = requested else {
                rows.push(serde_json::json!({"request":label,"unavailable":true}));
                continue;
            };
            for text in ["♠", "♥", "♦", "✦", "♣"] {
                let character = text.chars().next().unwrap();
                let line = shaper.layout_line(text, px(11.2), &[TextRun{len:text.len(),font:face.clone(),..Default::default()}],None);
                let mut runs = Vec::new();
                for run in &line.runs {
                    let mut glyphs = Vec::new();
                    for glyph in &run.glyphs {
                        let parameters = RenderGlyphParams {
                            font_id: run.font_id, glyph_id:glyph.id, font_size:px(11.2),
                            subpixel_variant:point(0,0), scale_factor:1., is_emoji:glyph.is_emoji,
                            subpixel_rendering:false, dilation:0,
                        };
                        let bounds = actual.glyph_raster_bounds(&parameters);
                        let raster = match bounds {
                            Ok(bounds) => match actual.rasterize_glyph(&parameters,bounds) {
                                Ok((size,bytes)) => serde_json::json!({
                                    "bounds":format!("{bounds:?}"),"size":format!("{size:?}"),
                                    "byteCount":bytes.len(),"nonzeroBytes":bytes.iter().filter(|byte|**byte!=0).count(),
                                    "maskFnv1a64":format!("{:016x}",bytes.iter().fold(0xcbf29ce484222325_u64,|hash,byte| (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)))
                                }),
                                Err(error) => serde_json::json!({"error":error.to_string()}),
                            },
                            Err(error) => serde_json::json!({"error":error.to_string()}),
                        };
                        glyphs.push(serde_json::json!({"id":glyph.id.0,"index":glyph.index,
                            "xPx":f32::from(glyph.position.x),"isEmoji":glyph.is_emoji,"nativeMask":raster}));
                    }
                    runs.push(serde_json::json!({"fontId":format!("{:?}",run.font_id),"glyphs":glyphs}));
                }
                rows.push(serde_json::json!({"request":label,"primary":primary,
                    "requestedFontId":format!("{requested:?}"),"text":text,"sizePx":11.2,
                    "primaryGlyph":actual.glyph_for_char(requested,character).map(|g|g.0),
                    "advancePx":f32::from(line.width),"selectedRuns":runs}));
            }
        }
        let report = serde_json::json!({"renderer":"Actual current Linux Cosmic/Swash with registered bundled Twyne fonts",
            "embeddedOnly":embedded_only,"initialFontNames":initial_fonts,
            "boundary":"Direct actual selected glyph/run/raster proof; actual Cast UI/GPU painting, Chromium raster and other OS rendering are separate. All fonts are registered by theme::apply; embedded-only mode has no system fonts.",
            "systemCandidates":known.into_iter().filter(|name|["Liberation Sans","Inter","Adwaita Mono","DM Sans","Noto Sans Math"].contains(&name.as_str())).collect::<Vec<_>>(),
            "rows":rows});
        let output = std::env::args().nth(1).expect("usage: native-probe output.json");
        std::fs::write(output,serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        println!("{}",serde_json::to_string_pretty(&report).unwrap());
    });
}
