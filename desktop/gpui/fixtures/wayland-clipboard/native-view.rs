//! Actual GPUI connection/keyboard/action fixture for an explicitly owned
//! compositor. Configuration files are a fixture control channel; clipboard
//! publication itself is triggered by a real keyboard press, never by a
//! secondary connection or a fabricated serial.

use anyhow::{Result, ensure};
use gpui_kit::prelude::*;
use gpui_kit::{
    AppContext, Bounds, Context, Entity, FocusHandle, Focusable, IntoElement, KeyBinding, Render,
    Window, WindowBounds, WindowOptions, div, px, rgb, size,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    os::unix::fs::{FileTypeExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use twyne_desktop::{
    editor::{
        RichDocument, Selection,
        clipboard_wayland::{ClipboardOffer, ClipboardPaste, WaylandClipboard},
        view::{ClipboardPreflight, Cut, InitialMode, OpeningInitial, RichEditorView},
    },
    manuscript::Manuscript,
    semantic_bridge::SemanticBridge,
    workspace::ProjectionState,
};

gpui_kit::actions!(twyne_wayland_probe, [Publish, ReadSelection, QuitProbe]);

#[derive(Clone, Deserialize)]
struct Config {
    mode: String,
    app_id: String,
    output: PathBuf,
    command_file: PathBuf,
    #[serde(default)]
    html: String,
    #[serde(default)]
    text: String,
    native_metadata: Option<String>,
    offer_html: Option<String>,
    release_file: Option<PathBuf>,
    preflight_file: Option<PathBuf>,
    #[serde(default)]
    startup_publish: bool,
    #[serde(default)]
    selection_start: usize,
    selection_end: Option<usize>,
}

#[derive(Serialize, Default)]
struct Observation {
    backend: String,
    mode: String,
    ready: bool,
    operations: u64,
    publication: Option<Value>,
    read: Option<Value>,
    error: Option<String>,
    editor: Option<Value>,
}

struct Probe {
    config: Config,
    focus: FocusHandle,
    transport: Arc<WaylandClipboard>,
    editor: Option<Entity<RichEditorView>>,
    offer: ClipboardOffer,
    observation: Observation,
    command_generation: u64,
}

impl Probe {
    fn record(&mut self, cx: &mut Context<Self>) {
        if let Some(editor) = &self.editor {
            let view = editor.read(cx);
            self.observation.editor = Some(json!({
                "html": view.document().to_html(),
                "text": view.document().editing_text(),
                "text_len": view.document().text_len(),
                "revision": view.revision(),
                "can_undo": view.can_undo(),
                "can_redo": view.can_redo(),
                "error": view.error().map(ToString::to_string),
                "read_only": view.is_read_only(),
                "selection": {"anchor":view.selection().anchor,"head":view.selection().head},
            }));
        }
        let bytes = serde_json::to_vec_pretty(&self.observation).expect("Serialize fixture state");
        let temporary = self.config.output.with_extension("tmp");
        std::fs::write(&temporary, bytes).expect("Write fixture state");
        std::fs::rename(temporary, &self.config.output).expect("Publish fixture state");
    }

    fn publish(&mut self, _: &Publish, window: &mut Window, cx: &mut Context<Self>) {
        self.observation.operations += 1;
        let operation = self.observation.operations;
        self.observation.error = None;
        self.observation.publication = Some(json!({"pending":true}));
        match self.transport.begin_publish(self.offer.clone()) {
            Ok(publication) => {
                cx.spawn_in(window, async move |this, cx| {
                    let result = cx
                        .background_executor()
                        .spawn(async move { publication.wait() })
                        .await;
                    let _ = this.update_in(cx, |this, _, cx| {
                        if this.observation.operations != operation {
                            return;
                        }
                        match result {
                            Ok(token) => {
                                this.observation.publication = Some(json!({
                                    "pending":false,"input_serial":token.input_serial,
                                    "generation":token.generation,"flushed_request":true,
                                }));
                            }
                            Err(error) => {
                                this.observation.publication = Some(json!({"pending":false}));
                                this.observation.error = Some(format!("{error:#}"));
                            }
                        }
                        this.record(cx);
                    });
                })
                .detach();
            }
            Err(error) => {
                self.observation.publication = Some(json!({"pending":false}));
                self.observation.error = Some(format!("{error:#}"));
            }
        }
        self.record(cx);
    }

    fn read_selection(&mut self, _: &ReadSelection, window: &mut Window, cx: &mut Context<Self>) {
        self.observation.operations += 1;
        let operation = self.observation.operations;
        self.observation.error = None;
        self.observation.read = Some(json!({"pending":true}));
        let transport = self.transport.clone();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let Some(snapshot) = transport.read()? else {
                        return Ok(json!({"pending":false,"empty":true}));
                    };
                    let (kind, fragment_html) = match snapshot.paste()? {
                        ClipboardPaste::Rich(fragment) => ("rich", Some(fragment.to_html())),
                        ClipboardPaste::Plain(_) => ("plain", None),
                        ClipboardPaste::Empty => ("empty", None),
                    };
                    Ok::<_, anyhow::Error>(json!({
                        "pending":false,"kind":kind,"text":snapshot.text,
                        "html":snapshot.html,"native_metadata":snapshot.native_metadata,
                        "fragment_html":fragment_html,"rtf_offered":snapshot.rtf_offered,
                        "observed_selection_current":transport.is_current(snapshot.selection),
                    }))
                })
                .await;
            let _ = this.update_in(cx, |this, _, cx| {
                if this.observation.operations != operation {
                    return;
                }
                match result {
                    Ok(value) => this.observation.read = Some(value),
                    Err(error) => {
                        this.observation.read = Some(json!({"pending":false}));
                        this.observation.error = Some(format!("{error:#}"));
                    }
                }
                this.record(cx);
            });
        })
        .detach();
        self.record(cx);
    }

    fn control(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(bytes) = std::fs::read(&self.config.command_file) else {
            return;
        };
        let Ok(command) = serde_json::from_slice::<Value>(&bytes) else {
            return;
        };
        let generation = command["generation"].as_u64().unwrap_or(0);
        if generation <= self.command_generation {
            return;
        }
        self.command_generation = generation;
        match command["command"].as_str().unwrap_or("") {
            "quit" => cx.quit(),
            // Negative focus-epoch fixtures intentionally dispatch with no
            // fresh press. The actual bridge must refuse their publication.
            "publish" => self.publish(&Publish, window, cx),
            "cut" => window.dispatch_action(Box::new(Cut), cx),
            "selection" => {
                if let Some(editor) = &self.editor {
                    let start = command["start"].as_u64().unwrap_or(0) as usize;
                    let end = command["end"].as_u64().unwrap_or(start as u64) as usize;
                    editor.update(cx, |view, cx| {
                        view.set_selection(Selection::new(start, end), cx).unwrap();
                    });
                }
            }
            "read-only" => {
                if let Some(editor) = &self.editor {
                    editor.update(cx, |view, cx| view.set_read_only(true, cx));
                }
            }
            "replace-editor" => {
                if let Some(editor) = &self.editor {
                    editor.update(cx, |view, cx| {
                        view.set_document(
                            RichDocument::from_html("<p>Replacement editor</p>").unwrap(),
                            false,
                            cx,
                        );
                    });
                }
            }
            "blur" => window.focus(&self.focus, cx),
            "sample" => {}
            _ => panic!("Unknown owned fixture control command"),
        }
        self.record(cx);
    }
}

impl Render for Probe {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let base = div()
            .size_full()
            .p(px(24.))
            .bg(rgb(0xf9f5ed))
            .track_focus(&self.focus)
            .on_action(cx.listener(|_, _: &QuitProbe, _, cx| cx.quit()));
        if let Some(editor) = &self.editor {
            base.child(editor.clone())
        } else {
            base.key_context("TwyneWaylandTransportProbe")
                .on_action(cx.listener(Self::publish))
                .on_action(cx.listener(Self::read_selection))
                .child("Owned Wayland clipboard probe — Ctrl+C publishes; Ctrl+V reads")
        }
    }
}

fn validate_owned_environment(runtime: &Path, display: &str) -> Result<()> {
    ensure!(
        display.starts_with("wayland-") && !display.contains('/'),
        "Owned socket name required"
    );
    ensure!(runtime.is_absolute(), "Absolute private runtime required");
    ensure!(
        std::fs::metadata(runtime)?.permissions().mode() & 0o777 == 0o700,
        "Private runtime must have mode0700"
    );
    ensure!(
        runtime.join(".twyne-owned-wayland").is_file(),
        "Owned compositor marker missing"
    );
    ensure!(
        std::fs::symlink_metadata(runtime.join(display))?
            .file_type()
            .is_socket(),
        "Owned compositor socket missing"
    );
    ensure!(
        std::env::var_os("XDG_RUNTIME_DIR").as_deref() == Some(runtime.as_os_str()),
        "Runtime mismatch"
    );
    ensure!(
        std::env::var("WAYLAND_DISPLAY").ok().as_deref() == Some(display),
        "Display mismatch"
    );
    ensure!(
        std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_SOCKET").is_none(),
        "Inherited X11/socket forbidden"
    );
    Ok(())
}

pub fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    ensure!(
        args.len() == 3,
        "usage: probe /PRIVATE_RUNTIME wayland-OWNED config.json"
    );
    validate_owned_environment(Path::new(&args[0]), &args[1])?;
    let config: Config = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    ensure!(
        matches!(config.mode.as_str(), "transport" | "editor"),
        "Invalid fixture mode"
    );
    ensure!(
        config.app_id.starts_with("twyne-owned-wayland-"),
        "Private fixture app id required"
    );

    let document = RichDocument::from_html(&config.html)?;
    let offer = if config.offer_html.is_some()
        || config.native_metadata.is_some()
        || !config.text.is_empty()
    {
        ClipboardOffer {
            text: config.text.clone().into(),
            html: config.offer_html.clone().map(Arc::from),
            native_metadata: config.native_metadata.clone().map(Arc::from),
        }
    } else {
        ClipboardOffer::rich(&document.copy_fragment(0..document.text_len())?)?
    };
    let preflight: Option<ClipboardPreflight> = if config.mode == "editor" {
        let bridge = SemanticBridge::discover()?;
        let source = bridge.from_html(&document.to_html())?.source;
        let mut workspace = twyne_desktop::exchange::import_typst(
            source.as_bytes(),
            "Clipboard.typ",
            uuid::Uuid::new_v4().to_string(),
            1,
        )?;
        workspace.content.html = bridge.project(&source)?.html;
        workspace.projection = ProjectionState::Verified;
        let manuscript = Arc::new(Manuscript::from_workspace(workspace)?);
        let release = config.release_file.clone();
        let observation = config.preflight_file.clone();
        Some(Arc::new(move |candidate: &RichDocument| {
            if let Some(path) = &observation {
                std::fs::write(path, candidate.to_html()).map_err(|error| error.to_string())?;
            }
            let deadline = Instant::now() + Duration::from_secs(8);
            while release.as_ref().is_some_and(|path| !path.exists()) {
                if Instant::now() >= deadline {
                    return Err("Fixture preflight gate timed out".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            let applied = twyne_desktop::document_edit::apply_html(
                (*manuscript).clone(),
                &candidate.to_html(),
            )
            .map_err(|error| format!("{error:#}"))?;
            if let Some(path) = &observation {
                std::fs::write(path.with_extension("typ"), &applied.body)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        }))
    } else {
        None
    };

    gpui_kit::application()
        .with_assets(twyne_desktop::assets::TwyneAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            twyne_desktop::theme::apply(cx).unwrap();
            assert_eq!(
                cx.compositor_name(),
                "Wayland",
                "Actual Wayland backend required"
            );
            let transport = Arc::new(WaylandClipboard::current().unwrap());
            cx.bind_keys([
                KeyBinding::new("ctrl-c", Publish, Some("TwyneWaylandTransportProbe")),
                KeyBinding::new("ctrl-v", ReadSelection, Some("TwyneWaylandTransportProbe")),
                KeyBinding::new("ctrl-q", QuitProbe, None),
            ]);
            let mode = config.mode.clone();
            let startup_publish = config.startup_publish;
            let (handle, probe) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                        None,
                        size(px(900.), px(700.)),
                        cx,
                    ))),
                    app_id: Some(config.app_id.clone()),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    window.set_window_title(&config.app_id);
                    cx.new(|cx| {
                        let editor = preflight.map(|preflight| {
                            cx.new(|cx| {
                                let mut view = RichEditorView::new(document, cx);
                                view.set_opening_initial(
                                    OpeningInitial {
                                        mode: InitialMode::Off,
                                        ..OpeningInitial::default()
                                    },
                                    cx,
                                );
                                view.set_wayland_clipboard(transport.clone(), preflight, cx);
                                let end = config.selection_end.unwrap_or(config.selection_start);
                                view.set_selection(Selection::new(config.selection_start, end), cx)
                                    .unwrap();
                                view
                            })
                        });
                        Probe {
                            config,
                            focus: cx.focus_handle(),
                            transport,
                            editor,
                            offer,
                            observation: Observation {
                                backend: "Wayland".into(),
                                mode,
                                ready: false,
                                ..Observation::default()
                            },
                            command_generation: 0,
                        }
                    })
                },
            )
            .unwrap();
            cx.activate(true);
            cx.update_window(handle, |_, window, cx| {
                probe.update(cx, |probe, cx| {
                    if let Some(editor) = &probe.editor {
                        window.focus(&editor.focus_handle(cx), cx);
                    } else {
                        window.focus(&probe.focus, cx);
                    }
                    // This negative fixture runs before any injected key press.
                    // It must report a missing actual input serial, never own selection.
                    if startup_publish {
                        probe.publish(&Publish, window, cx);
                    }
                    cx.spawn_in(window, async move |probe, cx| {
                        let deadline = Instant::now() + Duration::from_secs(120);
                        loop {
                            cx.background_executor()
                                .timer(Duration::from_millis(35))
                                .await;
                            let finished = probe.update_in(cx, |probe, window, cx| {
                                probe.observation.ready = true;
                                probe.control(window, cx);
                                probe.record(cx);
                                Instant::now() >= deadline
                            });
                            if finished.is_err() {
                                break;
                            }
                            if finished.unwrap() {
                                let _ = cx.update(|_, cx| cx.quit());
                                break;
                            }
                        }
                    })
                    .detach();
                });
            })
            .unwrap();
        });
    Ok(())
}
