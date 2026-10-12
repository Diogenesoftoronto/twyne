//! Real X11 fixture controlled by a separate XTEST process on an owned display.
use anyhow::{Context as _, Result, ensure};
use gpui_kit::{
    AppContext, Bounds, Context, Entity, Focusable, IntoElement, ParentElement, Render, Styled,
    Window, WindowBounds, WindowOptions, div, px, rgb, size,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use twyne_desktop::editor::{
    Command, RichDocument, Selection,
    view::{InitialMode, OpeningInitial, RichEditorEvent, RichEditorView},
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

fn report(view: &RichEditorView, initial: &str, events: &[String]) -> serde_json::Value {
    serde_json::json!({"backend":"X11", "html":view.document().to_html(), "initial":initial,
        "selection":[view.selection().anchor,view.selection().head], "revision":view.revision(),
        "undo":view.can_undo(),"redo":view.can_redo(),"dragging":view.is_dragging(),
        "readOnly":view.is_read_only(),"events":events})
}

pub fn run(args: &[String]) -> Result<()> {
    ensure!(
        std::env::var("DISPLAY").ok().as_deref() == Some(args[1].as_str()),
        "Only the explicit owned display is allowed"
    );
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let output = PathBuf::from(config["output"].as_str().context("Need output")?);
    let control = PathBuf::from(config["control"].as_str().context("Need control")?);
    let ready = PathBuf::from(args.get(3).context("Need ready file")?);
    let release = PathBuf::from(args.get(4).context("Need release file")?);
    let document = RichDocument::from_html(config["html"].as_str().context("Need HTML")?)?;
    let initial = document.to_html();
    let initial_document = document.clone();
    let target = config["target"].as_u64().context("Need heading target")? as usize;
    let atom = config["atom"].as_u64().context("Need atom index")? as usize;
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    gpui_kit::application().with_assets(twyne_desktop::assets::TwyneAssets).run(move |cx| {
        gpui_kit::init(cx);
        twyne_desktop::theme::apply(cx).unwrap();
        assert_eq!(cx.compositor_name(), "X11");
        let (handle, paper) = gpui_kit::open_window(WindowOptions {
            window_bounds:Some(WindowBounds::Windowed(Bounds::centered(None,size(px(720.),px(1000.)),cx))),
            ..Default::default()
        },cx, |_,cx| cx.new(|cx| Paper(cx.new(|cx| {
            let mut view = RichEditorView::new(document,cx);
            view.set_opening_initial(OpeningInitial {mode:InitialMode::Off,..OpeningInitial::default()},cx);
            view.set_selection(Selection::new(1,3),cx).unwrap();
            view
        })))).unwrap();
        let view = paper.read(cx).0.clone();
        let observed = events.clone();
        let observed_initial = initial.clone();
        let event_output = output.clone();
        cx.subscribe(&view,move |view,event:&RichEditorEvent,cx| {
            let label = match event {
                RichEditorEvent::DragStarted {source} => format!("start:{source:?}"),
                RichEditorEvent::DragFinished {moved} => format!("finish:{moved}"),
                RichEditorEvent::Changed {revision} => format!("change:{revision}"),
                RichEditorEvent::Input {..} => "input".to_owned(),
                _ => return,
            };
            let mut events = observed.lock().unwrap();
            events.push(label);
            let report = report(view.read(cx),&observed_initial,&events);
            std::fs::write(&event_output,serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        }).detach();
        cx.activate(true);
        cx.update_window(handle,|_,window,cx| {
            window.focus(&view.focus_handle(cx),cx);
            view.update(cx,|_,cx| {
                cx.spawn_in(window,async move |view,cx| {
                    cx.background_executor().timer(Duration::from_millis(350)).await;
                    let measured = cx.update(|window,cx| view.update(cx,|view,cx| {
                        let first = view.block_bounds(&[0]).context("First heading not measured")?;
                        let target_bounds = view.block_bounds(&[target]).context("Target not measured")?;
                        let atom_bounds = view.block_bounds(&[atom]).context("Atom not measured")?;
                        let image_bounds = view.block_bounds(&[4]).context("Image not measured")?;
                        let last_bounds = view.block_bounds(&[8]).context("Last heading not measured")?;
                        let state = report(view,&initial,&events.lock().unwrap());
                        std::fs::write(&output,serde_json::to_vec_pretty(&state)?)?;
                        let record = serde_json::json!({"windowOrigin":[f32::from(window.bounds().origin.x),f32::from(window.bounds().origin.y)],
                            "handle":[f32::from(first.left()-px(20.)),f32::from(first.top()-px(48.)+px(19.4))],
                            "target":[f32::from(target_bounds.center().x),f32::from(target_bounds.bottom()-px(1.))],
                            "selfTarget":[f32::from(first.center().x),f32::from(first.center().y)],
                            "atom":[f32::from(atom_bounds.center().x),f32::from(atom_bounds.center().y)],
                            "image":[f32::from(image_bounds.center().x),f32::from(image_bounds.center().y)],
                            "lastTarget":[f32::from(last_bounds.center().x),f32::from(last_bounds.bottom()-px(1.))],
                            "nativeBodyFamily":twyne_desktop::theme::SERIF_FONT,"original":initial});
                        let _ = cx;
                        Ok::<_,anyhow::Error>(record)
                    })) .unwrap().unwrap().unwrap();
                    std::fs::write(&ready,serde_json::to_vec_pretty(&measured).unwrap()).unwrap();
                    let deadline = Instant::now()+Duration::from_secs(30);
                    let mut previous = String::new();
                    while !release.exists() && Instant::now()<deadline {
                        if let Ok(command) = std::fs::read_to_string(&control) && command != previous {
                            previous = command.clone();
                            let _ = cx.update(|window,cx| view.update(cx,|view,cx| {
                                match command.trim() {
                                    "readonly" => view.set_read_only(true,cx),
                                    "writable" => view.set_read_only(false,cx),
                                    "reset" => {view.cancel_block_drag(window,cx);view.set_document(initial_document.clone(),false,cx);view.set_selection(Selection::new(1,3),cx).unwrap();},
                                    "cancel" => view.cancel_block_drag(window,cx),
                                    "edit" => { view.execute(Command::InsertText("Background edit".into()),window,cx).unwrap(); },
                                    _ => {},
                                }
                                let report = report(view,&initial,&events.lock().unwrap());
                                std::fs::write(&output,serde_json::to_vec_pretty(&report).unwrap()).unwrap();
                            }));
                        }
                        cx.background_executor().timer(Duration::from_millis(10)).await;
                    }
                    cx.update(|_,cx|cx.quit()).unwrap();
                }).detach();
            });
        }).unwrap();
    });
    Ok(())
}
