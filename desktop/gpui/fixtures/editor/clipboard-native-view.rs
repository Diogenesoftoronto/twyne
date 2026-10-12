//! Native action/IME owner acceptance, only on the explicit owned display.
use anyhow::{Context as _, Result, ensure};
use gpui_kit::{AppContext, Bounds, Focusable, WindowBounds, WindowOptions, px, size};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use twyne_desktop::{
    editor::{
        RichDocument, Selection,
        clipboard_x11::{ClipboardOffer, X11Clipboard},
        view::{
            ClipboardPreflight, Copy, InitialMode, OpeningInitial, Paste, Redo, RichEditorView,
            Undo,
        },
    },
    manuscript::Manuscript,
    semantic_bridge::SemanticBridge,
    workspace::ProjectionState,
};

pub fn run(args: &[String]) -> Result<()> {
    ensure!(
        std::env::var("DISPLAY").ok().as_deref() == Some(args[1].as_str()),
        "The native fixture must inherit only its explicit owned display"
    );
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let output = PathBuf::from(
        config["output"]
            .as_str()
            .context("ui configuration needs output")?,
    );
    let race = config["race"].as_str().unwrap_or("").to_string();
    let bridge = SemanticBridge::discover()?;
    let source = bridge.from_html("<div data-type=\"raw-typst\" data-typst-source=\"// Authored clipboard fixture&#10;#let preserved = [Keep]&#10;\"></div><p>LeftRight</p>")?.source;
    let mut workspace = twyne_desktop::exchange::import_typst(
        source.as_bytes(),
        "Clipboard.typ",
        uuid::Uuid::new_v4().to_string(),
        1,
    )?;
    workspace.content.html = bridge.project(&source)?.html;
    workspace.projection = ProjectionState::Verified;
    let manuscript = Arc::new(Manuscript::from_workspace(workspace)?);
    let initial = RichDocument::from_html(&manuscript.workspace.as_ref().unwrap().content.html)?;
    let initial_html = initial.to_html();
    let initial_source = manuscript.body.clone();
    let text = initial.editing_text();
    let index = text
        .find("LeftRight")
        .context("The original helper did not project the clipboard fixture")?;
    let caret = text[..index].chars().count() + 4;
    let clipboard = Arc::new(X11Clipboard::connect(Some(&args[1]))?);
    let converted_source = Arc::new(Mutex::new(None::<String>));
    let candidate_ready = Arc::new(AtomicBool::new(false));
    let released = Arc::new(AtomicBool::new(race.is_empty()));
    let converted = converted_source.clone();
    let ready = candidate_ready.clone();
    let release = released.clone();
    let preflight_manuscript = manuscript.clone();
    let preflight: ClipboardPreflight = Arc::new(move |candidate| {
        // Pause at the real semantic boundary so a native action can race it.
        ready.store(true, Ordering::Release);
        let until = Instant::now() + Duration::from_secs(8);
        while !release.load(Ordering::Acquire) {
            if Instant::now() >= until {
                return Err("Fixture preflight gate timed out".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let result = twyne_desktop::document_edit::apply_html(
            (*preflight_manuscript).clone(),
            &candidate.to_html(),
        )
        .map_err(|error| format!("{error:#}"))?;
        *converted.lock().unwrap() = Some(result.body);
        Ok(())
    });
    let result = Arc::new(Mutex::new(None::<Result<serde_json::Value>>));
    let recorded = result.clone();
    let display = args[1].clone();
    gpui_kit::application().with_assets(twyne_desktop::assets::TwyneAssets).run(move |cx| {
        gpui_kit::init(cx);
        twyne_desktop::theme::apply(cx).unwrap();
        assert_eq!(cx.compositor_name(), "X11", "This fixture must use the actual X11 backend");
        let (handle, view) = gpui_kit::open_window(WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(900.), px(700.)), cx))),
            ..Default::default()
        }, cx, |_, cx| cx.new(|cx| {
            let mut view = RichEditorView::new(initial, cx);
            view.set_opening_initial(OpeningInitial { mode: InitialMode::Off, ..OpeningInitial::default() }, cx);
            view.set_external_clipboard(clipboard.clone(), preflight, cx);
            view
        })).unwrap();
        cx.activate(true);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |_, cx| {
                cx.spawn_in(window, async move |view, cx| {
                    let proof = async {
                        cx.background_executor().timer(Duration::from_millis(180)).await;
                        cx.update(|window, cx| {
                            view.update(cx, |view, cx| {
                                view.set_selection(Selection::caret(caret), cx).unwrap();
                                window.focus(&view.focus_handle(cx), cx);
                            }).unwrap();
                            window.dispatch_action(Box::new(Paste), cx);
                        })?;
                        let copy_display = display.clone();
                        let mut owner_replacement = None;
                        if !race.is_empty() {
                            let deadline = Instant::now() + Duration::from_secs(6);
                            while !candidate_ready.load(Ordering::Acquire) {
                                ensure!(Instant::now() < deadline, "Native paste did not reach preflight");
                                cx.background_executor().timer(Duration::from_millis(20)).await;
                            }
                            if race == "owner" {
                                owner_replacement = Some(cx.background_executor().spawn(async move {
                                    let transport = X11Clipboard::connect(Some(&display))?;
                                    transport.publish(ClipboardOffer { text: "Replacement owner".into(), html: None, native_metadata: None })?;
                                    // Retain the replacement owner through the final check.
                                    Ok::<_, anyhow::Error>(transport)
                                }).await?);
                            } else {
                                cx.update(|window, cx| {
                                    view.update(cx, |view, cx| match race.as_str() {
                                        "selection" => view.set_selection(Selection::caret(0), cx).unwrap(),
                                        "editor" => view.set_document(RichDocument::from_html("<p>Replacement editor</p>").unwrap(), false, cx),
                                        "read-only" => view.set_read_only(true, cx),
                                        "focus" => window.focus(&cx.focus_handle(), cx),
                                        _ => panic!("Unknown fixture race"),
                                    }).unwrap();
                                })?;
                            }
                            released.store(true, Ordering::Release);
                            cx.background_executor().timer(Duration::from_millis(1200)).await;
                        } else {
                            let deadline = Instant::now() + Duration::from_secs(8);
                            loop {
                                let done = view.update_in(cx, |view, _, _| view.revision() > 0 || view.error().is_some())?;
                                if done { break; }
                                ensure!(Instant::now() < deadline, "Native paste did not complete");
                                cx.background_executor().timer(Duration::from_millis(20)).await;
                            }
                        }
                        let (pasted, error, can_undo, selection, focused) = view.update_in(cx, |view, window, cx| (
                            view.document().to_html(), view.error().map(ToString::to_string), view.can_undo(), view.selection(), view.focus_handle(cx).is_focused(window)
                        ))?;
                        let mut copied = None;
                        let mut undone = None;
                        let mut redone = None;
                        if race.is_empty() && error.is_none() && can_undo {
                            cx.update(|window, cx| {
                                view.update(cx, |view, cx| {
                                    view.set_selection(Selection::new(0, view.document().text_len()), cx).unwrap();
                                }).unwrap();
                                window.dispatch_action(Box::new(Copy), cx);
                            })?;
                            cx.background_executor().timer(Duration::from_millis(120)).await;
                            let transport = clipboard.clone();
                            let snapshot = cx.background_executor().spawn(async move { transport.read() }).await?.context("Native copy has no owner")?;
                            let external_html = cx.background_executor().spawn(async move {
                                let result = std::process::Command::new("/usr/bin/xclip")
                                    .args(["-display", &copy_display, "-selection", "clipboard", "-out", "-target", "text/html"])
                                    .output()?;
                                ensure!(result.status.success(), "External consumer failed: {}", String::from_utf8_lossy(&result.stderr));
                                String::from_utf8(result.stdout).map_err(anyhow::Error::from)
                            }).await?;
                            ensure!(snapshot.html.as_deref() == Some(external_html.as_str()), "External xclip did not receive the native copy");
                            copied = Some(serde_json::json!({"html": snapshot.html, "external_html": external_html, "text": snapshot.text, "native_metadata": snapshot.native_metadata}));
                            cx.update(|window, cx| window.dispatch_action(Box::new(Undo), cx))?;
                            cx.background_executor().timer(Duration::from_millis(60)).await;
                            undone = Some(view.update_in(cx, |view, _, _| view.document().to_html())?);
                            cx.update(|window, cx| window.dispatch_action(Box::new(Redo), cx))?;
                            cx.background_executor().timer(Duration::from_millis(60)).await;
                            redone = Some(view.update_in(cx, |view, _, _| view.document().to_html())?);
                        }
                        let current = view.update_in(cx, |view, _, _| view.document().to_html())?;
                        drop(owner_replacement);
                        Ok(serde_json::json!({"backend": "X11", "race": race, "initial_html": initial_html, "pasted_html": pasted, "current_html": current, "error": error, "can_undo": can_undo, "selection": {"anchor":selection.anchor,"head":selection.head}, "focused": focused, "copy": copied, "undo_html": undone, "redo_html": redone, "initial_source": initial_source, "canonical_context_unchanged": manuscript.body == source, "converted_source": converted_source.lock().unwrap().clone()}))
                    }.await;
                    *recorded.lock().unwrap() = Some(proof);
                    let _ = cx.update(|_, cx| cx.quit());
                }).detach();
            });
        }).unwrap();
    });
    let proof = result
        .lock()
        .unwrap()
        .take()
        .context("Native clipboard fixture exited without a result")??;
    std::fs::write(output, serde_json::to_vec_pretty(&proof)?)?;
    Ok(())
}
