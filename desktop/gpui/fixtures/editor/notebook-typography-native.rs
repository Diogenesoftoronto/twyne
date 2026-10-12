//! Read-only actual-font diagnostic; only runs on an explicit owned X11 display.
use anyhow::{Context as _, Result, ensure};
use gpui_kit::{
    AppContext, Bounds, Context, Entity, FontWeight, IntoElement, ParentElement, Render, Styled,
    TextRun, Window, WindowBounds, WindowOptions, div, font, px, rgb, size,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use twyne_desktop::editor::{RichDocument, Selection, view::RichEditorView};

struct Paper(Entity<RichEditorView>);
impl Render for Paper {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .w_full()
            .p(px(40.))
            .bg(rgb(twyne_desktop::theme::palette(cx).paper))
            .child(self.0.clone())
    }
}

pub fn run(args: &[String]) -> Result<()> {
    ensure!(
        std::env::var("DISPLAY").ok().as_deref() == Some(args[1].as_str()),
        "Only the explicit owned display is allowed"
    );
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let width = config["width"].as_f64().context("Need width")? as f32;
    ensure!(
        (96.0..=2048.0).contains(&width),
        "Need bounded content width"
    );
    let output = PathBuf::from(config["output"].as_str().context("Need output")?);
    let ready = config["ready"].as_str().map(PathBuf::from);
    let release = config["release"].as_str().map(PathBuf::from);
    ensure!(
        ready.is_some() == release.is_some(),
        "Capture handshake needs both paths"
    );
    let document = RichDocument::from_html(config["html"].as_str().context("Need HTML")?)?;
    let original = document.to_html();
    let blocks = document.blocks();
    let result = Arc::new(Mutex::new(None));
    let recorded = result.clone();
    gpui_kit::application().with_assets(twyne_desktop::assets::TwyneAssets).run(move|cx| {
        gpui_kit::init(cx);
        twyne_desktop::theme::apply(cx).unwrap();
        assert_eq!(cx.compositor_name(),"X11");
        let (handle,paper)=gpui_kit::open_window(WindowOptions {
            window_bounds:Some(WindowBounds::Windowed(Bounds::centered(None,size(px(width+80.),px(900.)),cx))),
            ..Default::default()
        },cx,|_,cx|cx.new(|cx|Paper(cx.new(|cx| {
            let mut view=RichEditorView::new(document,cx);
            view.set_read_only(true,cx);
            view
        })))).unwrap();
        let view=paper.read(cx).0.clone();
        let _=cx.update_window(handle,|_,window,cx|view.update(cx,|_,cx| {
            cx.spawn_in(window,async move|view,cx| {
                cx.background_executor().timer(Duration::from_millis(350)).await;
                let proof=view.update_in(cx,|view,window,cx| {
                    let mut paragraphs=Vec::new();
                    for block in blocks {
                        let source=block.runs.iter().filter_map(|run|match &run.content {
                            twyne_desktop::editor::RunContent::Text(text)=>Some(text.as_ref()), _=>None,
                        }).collect::<String>();
                        let bounds=view.block_bounds(&block.path).context("Block not measured")?;
                        let mut lines=Vec::<serde_json::Value>::new();
                        let mut scalars=Vec::new();
                        for (offset,character) in source.chars().enumerate() {
                            view.set_selection(Selection::caret(block.range.start+offset+1),cx)?;
                            let caret=view.caret_bounds().context("Caret not measured")?;
                            let top=f32::from(caret.top());
                            let x=f32::from(caret.left());
                            if lines.last().is_none_or(|line|(line["top"].as_f64().unwrap() as f32-top).abs()>0.01) {
                                lines.push(serde_json::json!({"text":"","top":top,"height":f32::from(caret.size.height),"right":x}));
                            }
                            let line=lines.last_mut().unwrap();
                            line["text"]=format!("{}{}",line["text"].as_str().unwrap(),character).into();
                            line["right"]=x.max(line["right"].as_f64().unwrap() as f32).into();
                            scalars.push(serde_json::json!({"offset":offset,"char":character,"x":x,"top":top}));
                        }
                        paragraphs.push(serde_json::json!({"path":block.path,"source":source,"bounds":{"x":f32::from(bounds.left()),"y":f32::from(bounds.top()),"width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height)},"lines":lines,"scalars":scalars}));
                    }
                    let mut measures=Vec::new();
                    for (family,font_size,weight,phrases) in [
                        (twyne_desktop::theme::SERIF_FONT,18.,FontWeight::NORMAL,vec![
                            "November, its corners had softened and the cover had begun to ",
                            "November, its corners had softened and the cover had begun to re‐",
                            "November, its corners had softened and the cover had begun to remem‐",
                            "re‐","remem‐","remember","‐","⋮⋮","Hgjp",
                        ]),
                        (twyne_desktop::theme::DISPLAY_FONT,24.,FontWeight::SEMIBOLD,vec!["A note for the next draft","Hgjp"]),
                    ] {
                        for text in phrases {
                            let mut face=font(family);
                            face.weight=weight;
                            face.features=twyne_desktop::theme::editorial_font_features();
                            let shape=window.text_system().shape_line(text.into(),px(font_size),&[TextRun {
                                len:text.len(),font:face,color:rgb(0).into(),background_color:None,underline:None,strikethrough:None,
                            }],None);
                            measures.push(serde_json::json!({"family":family,"size":font_size,"text":text,"width":f32::from(shape.width),"ascent":f32::from(shape.ascent),"descent":f32::from(shape.descent)}));
                        }
                    }
                    let dictionary=hypher::hyphenate_bounded("remember",hypher::Lang::English,2,2).collect::<Vec<_>>();
                    ensure!(view.document().to_html()==original && view.revision()==0 && !view.can_undo(),"Diagnostic changed manuscript/history");
                    Ok::<_,anyhow::Error>(serde_json::json!({"width":width,"backend":"X11","html_unchanged":true,"paragraphs":paragraphs,"measures":measures,"dictionary_remember":dictionary,"default_initial_size_px":75.6,"default_float_inset_px":75.6*(1.16+0.14)}))
                }).unwrap().unwrap();
                *recorded.lock().unwrap()=Some(proof);
                if let (Some(ready),Some(release)) = (ready,release) {
                    std::fs::write(ready,b"measured").unwrap();
                    let until=Instant::now()+Duration::from_secs(10);
                    while !release.exists() {
                        ensure!(Instant::now()<until,"Owned typography screenshot timed out");
                        cx.background_executor().timer(Duration::from_millis(10)).await;
                    }
                }
                cx.update(|_,cx|cx.quit()).unwrap();
                Ok::<_,anyhow::Error>(())
            }).detach();
        }));
    });
    let proof = result
        .lock()
        .unwrap()
        .take()
        .context("No diagnostic result")?;
    std::fs::write(output, serde_json::to_vec_pretty(&proof)?)?;
    Ok(())
}
