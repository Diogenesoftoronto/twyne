//! Real bundled-only Manager glyphs and before/after automatic Latin shaping.
use gpui_kit::{
    Font, FontWeight, HeadlessAppContext, PlatformTextSystem, RenderGlyphParams, TextRun,
    WindowTextSystem, font, point, px,
};
use std::{borrow::Cow, sync::Arc};
use twyne_desktop::{assets::TwyneAssets, theme};

macro_rules! bytes {
    ($name:literal) => {
        Cow::Borrowed(include_bytes!(concat!("../../../assets/fonts/", $name)).as_slice())
    };
}

fn main() {
    let cosmic = Arc::new(gpui_wgpu::CosmicTextSystem::new_without_system_fonts(
        theme::SANS_FONT,
    ));
    assert!(cosmic.all_font_names().is_empty());
    // Only unchanged shipped Latin primaries establish the before-registration
    // baseline. No system face or raw-symbol fallback can satisfy a request.
    cosmic
        .add_fonts(vec![
            bytes!("dmsans-DMSans-Regular.ttf"),
            bytes!("dmsans-DMSans-Bold.ttf"),
            bytes!("librebaskerville-LibreBaskerville-Regular.ttf"),
            bytes!("librebaskerville-LibreBaskerville-Bold.ttf"),
            bytes!("TwyneBody-Regular.ttf"),
        ])
        .unwrap();
    let actual: Arc<dyn PlatformTextSystem> = cosmic.clone();
    let mut app = HeadlessAppContext::with_asset_source(actual.clone(), Arc::new(TwyneAssets));
    app.update(|cx| {
        let shaper = WindowTextSystem::new(cx.text_system().clone());
        let shape = |text: &str, face: Font, size: f32| shaper.layout_line(text, px(size), &[TextRun{len:text.len(),font:face,..Default::default()}],None);
        let latin_text = "Mlle. Sceptique Sœur Encourageante Professeur Athenæum Le Lecteur 0123456789";
        let latin_requests = [
            ("automatic-sans", font(theme::SANS_FONT), 11.2),
            ("automatic-display", {let mut face=font(theme::DISPLAY_FONT);face.weight=FontWeight::SEMIBOLD;face}, 16.),
            ("automatic-body", font(theme::SERIF_FONT), 20.),
        ];
        let latin_sample = |label: &str, face: Font, size| {
            let line = shape(latin_text, face, size);
            serde_json::json!({"request":label,"text":latin_text,"sizePx":size,"advancePx":f32::from(line.width),
                "glyphs":line.runs.iter().flat_map(|run|run.glyphs.iter().map(|glyph|serde_json::json!({
                    "id":glyph.id.0,"sourceByte":glyph.index,"xPx":f32::from(glyph.position.x),
                    "yPx":f32::from(glyph.position.y),"isEmoji":glyph.is_emoji,
                }))).collect::<Vec<_>>()})
        };
        let before = latin_requests.iter().map(|(label, face, size)|latin_sample(label, face.clone(), *size)).collect::<Vec<_>>();
        cosmic.add_fonts(vec![bytes!("LiberationSerif-Bold.ttf"),bytes!("AdwaitaMono-Regular.ttf")]).unwrap();
        let after = latin_requests.iter().map(|(label, face, size)|latin_sample(label, face.clone(), *size)).collect::<Vec<_>>();
        assert_eq!(before, after, "Default Latin glyphs/advances must remain unchanged after registration");

        let proof: serde_json::Value = serde_json::from_str(include_str!("../../../assets/cast-raw-font-provenance.json")).unwrap();
        let mut rows = Vec::new();
        let original: serde_json::Value = serde_json::from_str(include_str!("../../cast/browser-manager-raw-glyphs.json")).unwrap();
        for symbol in proof["originalGlyphs"].as_array().unwrap() {
            let text = symbol["text"].as_str().unwrap();
            let line = shape(text, theme::cast_raw_glyph_font(), 16.);
            assert_eq!(line.runs.len(), 1);
            assert_eq!(line.runs[0].glyphs.len(), 1);
            let run = &line.runs[0];
            let glyph = &run.glyphs[0];
            assert_eq!(u64::from(glyph.id.0), symbol["glyphId"].as_u64().unwrap());
            assert!(!glyph.is_emoji);
            let (weight, style) = cosmic.font_weight_and_style(run.font_id).unwrap();
            assert_eq!(weight, if text=="✦" {FontWeight::NORMAL} else {FontWeight::BOLD});
            assert_eq!(style, gpui_kit::FontStyle::Normal);
            let width = f64::from(f32::from(line.width));
            assert!((width-symbol["advanceAt16Px"].as_f64().unwrap()).abs()<0.001);
            let web = original["glyphs"].as_array().unwrap().iter().find(|row| row["glyph"]==text).unwrap();
            let browser_width = web["rect"]["width"].as_f64().unwrap();
            assert!((width-browser_width).abs()<0.016);
            let parameters = RenderGlyphParams {font_id:run.font_id,glyph_id:glyph.id,font_size:px(16.),
                subpixel_variant:point(0,0),scale_factor:1.,is_emoji:glyph.is_emoji,subpixel_rendering:false,dilation:0};
            let bounds = actual.glyph_raster_bounds(&parameters).unwrap();
            let (size, bytes) = actual.rasterize_glyph(&parameters,bounds).unwrap();
            assert!(bytes.iter().any(|alpha|*alpha!=0));
            rows.push(serde_json::json!({"text":text,"glyphId":glyph.id.0,"selectedNativeWeight":weight.0,
                "selectedNativeStyle":format!("{style:?}"),"nativeAdvancePx":width,"originalBrowserAdvancePx":browser_width,
                "differencePx":width-browser_width,"actualBrowserFaces":web["platformFonts"],"isEmoji":false,
                "nativeMask":{"bounds":format!("{bounds:?}"),"size":format!("{size:?}"),"byteCount":bytes.len(),
                    "nonzeroBytes":bytes.iter().filter(|alpha|**alpha!=0).count(),
                    "maskFnv1a64":format!("{:016x}",bytes.iter().fold(0xcbf29ce484222325_u64,|hash,byte|(hash^u64::from(*byte)).wrapping_mul(0x100000001b3)))},
            }));
        }
        let result = serde_json::json!({"renderer":"actual pinned Linux Cosmic/Swash, fresh empty database with only declared bundled bytes",
            "systemFontsLoaded":false,"helper":"theme::cast_raw_glyph_font()","fallbacks":["Liberation Serif","Adwaita Mono"],
            "requestedPrimary":"Libre Baskerville","requestedWeight":600,"requestedStyle":"normal","sizePx":16.,"lineHeightPx":24.,
            "allFiveOriginalGlyphIdsAndNonzeroMasks":true,"automaticLatinBefore":before,"automaticLatinAfter":after,
            "automaticLatinUnchangedAfterRegistration":true,"rows":rows,
            "boundary":"Only raw Manager assistance glyphs. Chromium synthesis/hinting/GPU pixels, actual assembled UI, other OS and Lora card headings are separate boundaries; circular badge chain unchanged."});
        let output = std::env::args().nth(1).expect("usage: raw-native-probe output.json");
        std::fs::write(output,serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    });
}
