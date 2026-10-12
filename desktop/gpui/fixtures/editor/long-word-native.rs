//! Real native text-system proof using only an explicit newly owned X display.
use anyhow::{Context as _, Result, ensure};
use gpui_kit::{
    AppContext, Bounds, Context, Entity, IntoElement, ParentElement, Render, Styled, Window,
    WindowBounds, WindowOptions, div, px, rgb, size,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use twyne_desktop::editor::{
    RichDocument, Selection,
    view::{InitialMode, OpeningInitial, RichEditorView},
};

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
        "The native fixture must inherit only its explicit owned display"
    );
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let output = PathBuf::from(
        config["output"]
            .as_str()
            .context("Wrap fixture needs output")?,
    );
    let document =
        RichDocument::from_html(config["html"].as_str().context("Wrap fixture needs html")?)?;
    let original = document.to_html();
    let quiet = config["comments_quiet"].as_bool().unwrap_or(false);
    let height = config["height"].as_u64().unwrap_or(1900);
    ensure!(
        (700..=4096).contains(&height),
        "Bounded fixture height is required"
    );
    let blocks = document.blocks();
    let comment_ranges = document.comment_ranges();
    let ready = args.get(3).cloned();
    let release = args.get(4).cloned();
    let result = Arc::new(Mutex::new(None::<Result<serde_json::Value>>));
    let recorded = result.clone();
    gpui_kit::application().with_assets(twyne_desktop::assets::TwyneAssets).run(move |cx| {
        gpui_kit::init(cx);
        twyne_desktop::theme::apply(cx).unwrap();
        assert_eq!(cx.compositor_name(), "X11");
        let (handle, paper) = gpui_kit::open_window(WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(680.), px(height as f32)), cx))),
            ..Default::default()
        }, cx, |_, cx| cx.new(|cx| {
            Paper(cx.new(|cx| {
                    let mut view = RichEditorView::new(document, cx);
                    view.set_comments_quiet(quiet, cx);
                view.set_opening_initial(OpeningInitial { mode: InitialMode::Off, ..OpeningInitial::default() }, cx);
                view
            }))
        })).unwrap();
        let view = paper.read(cx).0.clone();
        cx.activate(true);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |_, cx| {
                cx.spawn_in(window, async move |view, cx| {
                    let proof = async {
                        cx.background_executor().timer(Duration::from_millis(250)).await;
                        let (paragraphs, comments) = view.update_in(cx, |view, _, cx| {
                            let mut paragraphs = Vec::new();
                            for block in blocks {
                                let source = block.runs.iter().filter_map(|run| match &run.content {
                                    twyne_desktop::editor::RunContent::Text(value) => Some(value.as_ref()),
                                    _ => None,
                                }).collect::<String>();
                                let mut lines: Vec<serde_json::Value> = Vec::new();
                                for (offset, character) in source.chars().enumerate() {
                                    // The trailing scalar boundary belongs to
                                    // its glyph's row, even at a soft wrap.
                                    view.set_selection(Selection::caret(block.range.start + offset + 1), cx).unwrap();
                                    let bounds = view.caret_bounds().expect("Native block was not prepainted");
                                    let y = f32::from(bounds.top());
                                    let right = f32::from(bounds.left());
                                    if lines.last().is_none_or(|line| (line["top"].as_f64().unwrap() as f32 - y).abs() > 0.01) {
                                        lines.push(serde_json::json!({"text":"", "top": y, "right":right, "range":[offset,offset]}));
                                    }
                                    let line = lines.last_mut().unwrap();
                                    let mut text = line["text"].as_str().unwrap().to_owned();
                                    text.push(character);
                                    line["text"] = text.into();
                                    line["right"] = right.max(line["right"].as_f64().unwrap() as f32).into();
                                    line["range"][1] = (offset + 1).into();
                                }
                                paragraphs.push(serde_json::json!({"source":source, "lineTexts":lines.iter().map(|line|line["text"].clone()).collect::<Vec<_>>(),"lines":lines,"width":600,"right":640}));
                            }
                            view.set_selection(Selection::caret(0), cx).unwrap();
                            ensure!(view.document().to_html() == original, "Measuring wrapped carets changed source");
                            let comments = comment_ranges.iter().map(|anchor| {
                                let bounds = view.comment_range_bounds(&anchor.id, &anchor.range).expect("Native comment passage was not measured");
                                serde_json::json!({"id":anchor.id,"range":[anchor.range.start,anchor.range.end], "bounds":{"x":f32::from(bounds.left()),"y":f32::from(bounds.top()),"width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height)}})
                            }).collect::<Vec<_>>();
                            Ok::<_, anyhow::Error>((paragraphs, comments))
                        })??;
                        if let Some(ready) = ready {
                            std::fs::write(ready, b"ready")?;
                        }
                        if let Some(release) = release {
                            let until = Instant::now() + Duration::from_secs(10);
                            while !std::path::Path::new(&release).exists() {
                                ensure!(Instant::now() < until, "Wrap screenshot gate timed out");
                                cx.background_executor().timer(Duration::from_millis(20)).await;
                            }
                        }
                        Ok(serde_json::json!({"backend":"X11", "html":original, "paragraphs": paragraphs, "comments":comments}))
                    }.await;
                    *recorded.lock().unwrap() = Some(proof);
                    let _ = cx.update(|_, cx| cx.quit());
                }).detach();
            });
        }).unwrap();
    });
    let report = result
        .lock()
        .unwrap()
        .take()
        .context("Native wrap fixture exited without proof")??;
    std::fs::write(output, serde_json::to_vec_pretty(&report)?)?;
    Ok(())
}
