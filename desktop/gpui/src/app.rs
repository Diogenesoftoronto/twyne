use crate::assets::{self, TwyneIcon};
use crate::chrome::{
    dept_label, desk_button, dossier_button, editorial_dateline, file_menu_button, focus_outline,
    folio_numeral, ornament, page_selector_arrow, paper_button, press_button, tool_button,
    tracked_text, tracked_typewriter, wrapping_dept_label, wrapping_typewriter, zen_button,
};
use crate::proof::NativeCompiler;
use crate::theme::*;
use gpui_kit::component::{
    Disableable, FocusableExt, Rope, RopeExt, Sizable,
    button::{Button, ButtonVariants},
    input::{EditorState, Input, InputEvent, InputState, Textarea, TextareaState},
    menu::{DropdownMenu, PopupMenuItem},
    text::TextView,
};
use gpui_kit::prelude::*;
use gpui_kit::{
    App, Context, Entity, FocusHandle, Focusable, Font, FontWeight, Image, ImageFormat,
    IntoElement, KeyBinding, PathPromptOptions, Render, Role, ScrollHandle, SharedString,
    Subscription, Task, TestSupportExt, TextAlign, TextRun, Window, div, font, img, px, relative,
    rgb,
};
use std::{path::PathBuf, sync::Arc, time::Duration};
use twyne_desktop::{
    apparatus_view::ApparatusSurface,
    cast_view::CastSurface,
    compositor::{CompositorCapabilities, CompositorEvent, CompositorView},
    dossier::{
        DossierMode, DossierOptions, DossierSession, DossierSubmission, PriorMaterial,
        RecoveryIdentity,
    },
    dossier_image_lifecycle::DossierImageLifecycle,
    dossier_view::{DossierEvent, DossierView},
    editor::view::{InitialMode, OpeningInitial, RichEditorEvent, RichEditorView},
    editor::{RichDocument, Selection},
    house::{HouseRecord, HouseRequest, HouseStore, LibraryFolio},
    house_view::{HouseCapabilities, HouseEvent, HouseView, LibraryView},
    manuscript::{Manuscript, Statistics, export_filename, timestamp},
    native_typst::CompiledProof,
    page_furniture::{self, PageCanvasGeometry, PageFurnitureEvent, PageRulerView},
    revision_view::{RevisionCapabilities, RevisionEvent, RevisionView},
    revisions::{CheckpointOptions, RevisionStore, RevisionTimeline},
    rubric_view::RubricSurface,
    settings::{AppearanceRecord, AppearanceRequest, AppearanceStore},
    settings_view::{AppearanceCapabilities, SettingsEvent, SettingsView},
    source_session::SourceSession,
    source_view::SourceEditorView,
    storage::{Library, Store, export_bytes, export_file, import_file},
    view_state::{BoardContext, DeskState},
    workspace::{
        LayoutSettings, OpeningInitialCollection, OpeningInitialMode, OpeningInitialSettings,
        OpeningInitialSize, ProjectionState,
    },
};
use uuid::Uuid;

mod account_coordinator;
mod apparatus_coordinator;
mod cast_coordinator;
#[cfg(target_os = "linux")]
mod clipboard_coordinator;
#[cfg(all(test, feature = "ui-tests"))]
mod dossier_filing_tests;
#[cfg(all(
    test,
    feature = "ui-tests",
    any(target_os = "linux", target_os = "freebsd")
))]
#[path = "../fixtures/dossier-image-lifecycle/retained-settings-host/parent-adoption/host_tests.rs"]
mod dossier_retained_settings_host;
mod editor_drag_coordinator;
mod flow_coordinator;
mod gen_ui_coordinator;
mod house_coordinator;
mod image_coordinator;
mod manuscript_coordinator;
mod margin_composer;
mod margin_position;
mod margin_rail_coordinator;
mod marginalia_coordinator;
mod math_source_coordinator;
mod note_coordinator;
mod page_coordinator;
mod research_steering;
mod revision_coordinator;
mod room_layout;
mod rubric_coordinator;
mod settings_coordinator;
mod slash_coordinator;
mod source_tools;
mod status_coordinator;

gpui_kit::actions!(
    twyne,
    [
        NewDraft,
        ImportDraft,
        ExportDraft,
        SaveDraft,
        ToggleFocus,
        ToggleLibrary,
        ToggleNotebook,
        FindInDraft,
        FindNext,
        WriteMode,
        ReadMode,
        DuplicateDraft,
        ArchiveDraft,
        ExportNative,
        ToggleCompositor,
        CloseCompositor,
        SourceComment,
        SourceGoToLine,
        ApplySource,
        OpenHouse,
        NextProofPage,
        PreviousProofPage,
        FirstProofPage,
        LastProofPage,
        ForwardProofPages,
        BackwardProofPages,
        PageSelectorSpace,
        Quit
    ]
);

struct Snapshot {
    document: Manuscript,
    body: Rope,
    notes: Rope,
    rich: Option<RichDocument>,
    has_rich: bool,
    rich_revision: Option<u64>,
    page_settings: Option<(LayoutSettings, String, String)>,
}

impl Snapshot {
    fn materialize(mut self) -> anyhow::Result<Manuscript> {
        if let Some(rich) = self.rich {
            self.document =
                twyne_desktop::document_edit::apply_html(self.document, &rich.to_html())?;
        } else if !self.has_rich {
            self.document.body = self.body.to_string();
        }
        self.document.notes = self.notes.to_string();
        if let Some((layout, header, footer)) = self.page_settings {
            self.document = twyne_desktop::document_edit::apply_page_settings(
                self.document,
                layout,
                header,
                footer,
            )?;
        }
        Ok(self.document)
    }
}

pub struct WritingRoom {
    focus: FocusHandle,
    account_focus: FocusHandle,
    account_open: bool,
    account_error: Option<&'static str>,
    insert: slash_coordinator::InsertState,
    window_handle: gpui_kit::AnyWindowHandle,
    store: Arc<Store>,
    documents: Vec<Manuscript>,
    active: Uuid,
    title: Entity<TextareaState>,
    body: Entity<TextareaState>,
    source: Entity<EditorState>,
    source_line: Entity<InputState>,
    source_go_to_line: bool,
    source_wrapping: bool,
    source_session: Option<SourceSession>,
    source_debounce: Option<Task<()>>,
    source_proof_debounce: Option<Task<()>>,
    #[cfg(target_os = "linux")]
    clipboard: clipboard_coordinator::ClipboardState,
    rich: Option<Entity<RichEditorView>>,
    rich_subscription: Option<Subscription>,
    rich_saved_revision: u64,
    math_source: math_source_coordinator::MathSourceScope,
    editor_drag: editor_drag_coordinator::EditorDragState,
    projection_task: Option<Task<()>>,
    compositor: Option<Entity<CompositorView>>,
    compositor_tab_focus: [FocusHandle; 4],
    compositor_subscription: Option<Subscription>,
    page_ruler: Option<Entity<PageRulerView>>,
    page_ruler_subscription: Option<Subscription>,
    page_ruler_state: Option<(LayoutSettings, f64, bool, bool)>,
    pagination: std::cell::RefCell<page_coordinator::PageHostState>,
    revision_store: Option<RevisionStore>,
    revision_ready: bool,
    revision_timeline: Arc<RevisionTimeline>,
    revision_view: Option<Entity<RevisionView>>,
    revision_subscription: Option<Subscription>,
    revision_generation: u64,
    appearance_store: Option<AppearanceStore>,
    appearance_record: AppearanceRecord,
    appearance_preview: ThemePreference,
    appearance_pending: Option<AppearanceRequest>,
    settings_view: Option<Entity<SettingsView>>,
    settings_subscription: Option<Subscription>,
    settings_route: bool,
    settings_scroll: ScrollHandle,
    house_store: Option<HouseStore>,
    house_record: Arc<HouseRecord>,
    house_pending: Option<HouseRequest>,
    house_view: Option<Entity<HouseView>>,
    house_subscription: Option<Subscription>,
    house_route: bool,
    library_view: Option<Entity<LibraryView>>,
    library_subscription: Option<Subscription>,
    library_loading: bool,
    library_generation: u64,
    library_task: Option<Task<()>>,
    flow: flow_coordinator::FlowState,
    cast: cast_coordinator::CastState,
    rubric: rubric_coordinator::RubricState,
    gen_ui: gen_ui_coordinator::ToolState,
    apparatus: apparatus_coordinator::ApparatusState,
    steering: research_steering::SteeringState,
    marginalia: marginalia_coordinator::MarginaliaState,
    margin: margin_composer::MarginState,
    margin_rail: margin_rail_coordinator::MarginRailState,
    image_request: Option<image_coordinator::ImageFileRequest>,
    compiler: Arc<NativeCompiler>,
    proof: Option<Arc<CompiledProof>>,
    proof_images: Vec<Arc<Image>>,
    proof_zoom: u16,
    proof_scroll: ScrollHandle,
    selected_proof_page: usize,
    writing_scroll: ScrollHandle,
    caret_reveal_pending: bool,
    proof_status: String,
    proof_error: Option<String>,
    proof_mode: bool,
    split_view: bool,
    proof_generation: u64,
    proof_task: Option<Task<()>>,
    pdf_requested: bool,
    applying_source: bool,
    dossier_images: Option<DossierImageLifecycle>,
    dossier: Option<Entity<DossierView>>,
    dossier_subscription: Option<Subscription>,
    notes: Entity<TextareaState>,
    new_folio_name: Entity<InputState>,
    new_folio_form: bool,
    library_route: bool,
    find: Entity<InputState>,
    statistics: Statistics,
    page_selector_metrics: std::cell::Cell<Option<(usize, f32)>>,
    page_selector_typeahead: std::cell::RefCell<status_coordinator::PageSelectorTypeahead>,
    preview: SharedString,
    dirty: bool,
    reading: bool,
    source_mode: bool,
    desk: DeskState,
    dateline: String,
    archive_visible: bool,
    find_visible: bool,
    find_status: String,
    notice: Option<String>,
    error: Option<String>,
    debounce: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

#[derive(Clone)]
struct DossierFilingScope {
    folio_id: Uuid,
    revision: u64,
    mode: DossierMode,
    recovery: RecoveryIdentity,
}

impl WritingRoom {
    #[cfg(feature = "ui-tests")]
    pub fn set_capture_state(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        if state != "quiet" {
            self.desk.set_zen(false, false);
        }
        if matches!(
            state,
            "desk"
                | "drawer"
                | "board"
                | "source"
                | "proof"
                | "split"
                | "flow"
                | "tools"
                | "marginalia"
                | "margin-thread"
                | "margin-composer"
                | "cast"
                | "rubric"
        ) {
            self.desk.preferences.compositor_open = true;
        }
        if matches!(state, "drawer" | "marginalia") {
            self.desk.drawer_open = true;
        }
        if state == "board" {
            self.desk.board_open = true;
            self.open_cast(CastSurface::Board, window, cx);
        }
        if state == "source" {
            self.set_source(window, cx);
        }
        if state == "proof" || state == "split" {
            if let Err(error) = self.ensure_source(window, cx) {
                self.error = Some(error.to_string());
            }
            self.proof_mode = state == "proof";
            self.split_view = state == "split";
            self.request_proof(false, window, cx);
        }
        if state == "dossier" {
            self.open_dossier(window, cx);
        }
        if state == "settings" {
            self.open_settings(window, cx);
        }
        if matches!(
            state,
            "slash"
                | "slash-filtered"
                | "slash-form"
                | "slash-endnote"
                | "slash-footnote"
                | "slash-mermaid"
                | "slash-math-inline"
                | "slash-math-block"
        ) {
            let command = match state {
                "slash-form" => Some("insert.table"),
                "slash-endnote" => Some("insert.endnote"),
                "slash-footnote" => Some("insert.footnote"),
                "slash-mermaid" => Some("insert.mermaid"),
                "slash-math-inline" => Some("insert.math-inline"),
                "slash-math-block" => Some("insert.math-block"),
                _ => None,
            };
            self.capture_insert_menu(command, window, cx);
        }
        if state == "account" || state == "account-error" {
            self.account_open = true;
            if state == "account-error" {
                self.account_error = Some(account_coordinator::SIGN_IN_UNAVAILABLE);
            }
        }
        if state == "house" {
            self.open_house(window, cx);
        }
        if state == "library" {
            self.open_library(window, cx);
        }
        if state == "tools" {
            self.open_writing_tools(window, cx);
        }
        if let Some(kind) = twyne_desktop::gen_ui::seed::ToolKind::from_id(state) {
            let room = cx.weak_entity();
            window.on_next_frame(move |window, cx| {
                let _ = room.update(cx, |room, cx| room.open_native_tool(kind, None, window, cx));
            });
        }
        if state == "flow" {
            self.replay_flow_capture(window, cx);
        }
        if state == "versions" {
            self.open_versions(window, cx);
        }
        if state == "marginalia" {
            self.open_marginalia(window, cx);
        }
        if state == "cast" {
            self.open_cast(CastSurface::Board, window, cx);
        }
        if state == "editors" {
            self.open_cast(CastSurface::Manager, window, cx);
        }
        if state == "analysis" {
            self.open_cast(CastSurface::Analysis, window, cx);
        }
        if state == "rubric" {
            self.open_rubric(RubricSurface::Board, window, cx);
        }
        if state == "galley" {
            self.open_rubric(RubricSurface::Galley, window, cx);
        }
        if state == "apparatus" {
            self.desk.preferences.compositor_open = false;
            self.open_apparatus(ApparatusSurface::Board, window, cx);
            window.focus(&self.focus, cx);
        }
        if state == "apparatus-page" {
            self.open_apparatus(ApparatusSurface::Page, window, cx);
        }
        if state == "margin-thread" {
            let editor = self.rich.clone();
            if let Some(editor) = editor {
                editor.update(cx, |editor, cx| editor.set_comments_quiet(false, cx));
                if let Some(passage) = editor
                    .read(cx)
                    .document()
                    .comment_ranges()
                    .into_iter()
                    .next()
                {
                    let room = cx.weak_entity();
                    window.on_next_frame(move |window, cx| {
                        let _ = room.update(cx, |room, cx| {
                            room.open_inline_margin(
                                passage.id.to_string(),
                                passage.range,
                                window,
                                cx,
                            )
                        });
                    });
                }
            }
        }
        if state == "margin-composer"
            && let Some(editor) = self.rich.clone()
        {
            editor.update(cx, |editor, cx| editor.set_comments_quiet(false, cx));
            let end = editor.read(cx).document().text_len().min(12);
            if end > 0 {
                let selection = Selection::new(0, end);
                let _ = editor.update(cx, |editor, cx| editor.set_selection(selection, cx));
                let room = cx.weak_entity();
                window.on_next_frame(move |window, cx| {
                    let _ = room.update(cx, |room, cx| room.compose_margin(selection, window, cx));
                });
            }
        }
        cx.notify();
    }

    #[cfg(feature = "ui-tests")]
    pub fn capture_dossier_image_lifecycle(
        &self,
        window: &Window,
        cx: &App,
    ) -> Option<serde_json::Value> {
        let mut snapshot = self
            .dossier_images
            .as_ref()?
            .diagnostic_snapshot(window, cx)?;
        snapshot["surface"] = serde_json::json!({
            "dossierRetained": self.dossier.is_some(),
            "dossierMounted": self.dossier.is_some() && !self.standalone_route(),
            "standaloneRoute": self.standalone_route(),
        });
        // Observation only: no retained image Arc, upload, refresh or mutation.
        snapshot["foxing"] = self
            .dossier
            .as_ref()
            .map_or(serde_json::Value::Null, |view| {
                let view = view.read(cx);
                let prepared = view.prepared_multiply();
                serde_json::json!({
                    "prepared": prepared.is_some(),
                    "transparent": prepared.map(|ready| ready.is_transparent()),
                    "imageId": prepared.and_then(|ready| ready.premultiplied_group())
                        .map(|image| image.id.0.to_string()),
                    "logicalWidth": prepared.map(|ready| ready.metrics().width()),
                    "logicalHeight": prepared.map(|ready| ready.metrics().height()),
                    "scaleFactor": prepared.map(|ready| ready.metrics().scale_factor()),
                    "paintStatus": format!("{:?}", view.foxing_paint_status()),
                    "supportsDestinationMultiply": window.supports_destination_multiply(),
                })
            });
        Some(snapshot)
    }

    pub fn open_first_dossier(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_dossier(window, cx);
    }

    pub fn new(
        store: Arc<Store>,
        library: Library,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let active = library
            .active
            .expect("startup creates an active manuscript");
        let document = library
            .documents
            .iter()
            .find(|doc| doc.id == active)
            .unwrap();
        let title = manuscript_coordinator::title_state(window, cx);
        title.update(cx, |state, cx| {
            state.set_value(document.title.clone(), window, cx);
            state.set_text_align(TextAlign::Center, cx);
        });
        let body = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, twyne_desktop::manuscript::MAX_DOCUMENT_BYTES)
                .placeholder("Start writing here. Use Markdown for headings, emphasis, and lists.")
        });
        body.update(cx, |state, cx| {
            state.set_value(document.body.clone(), window, cx)
        });
        let source_session = document
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.canonical_source())
            .map(|canonical| {
                SourceSession::open(
                    document.id,
                    canonical,
                    store.load_source_draft(document.id).unwrap_or_default(),
                )
            });
        let source = cx.new(|cx| {
            let mut state = EditorState::new(window, cx)
                .language("typst")
                .soft_wrap(true)
                .auto_close(false);
            twyne_desktop::source_editor::install_highlighter(&mut state, cx);
            state
        });
        source.update(cx, |state, cx| {
            twyne_desktop::source_editor::set_source(
                state,
                source_session
                    .as_ref()
                    .map_or("", |session| session.source.as_str()),
                window,
                cx,
            )
        });
        let notes = cx.new(|cx| TextareaState::new(window, cx).placeholder("What is this piece trying to do? Keep your brief, sources, and loose thoughts here."));
        notes.update(cx, |state, cx| {
            state.set_value(document.notes.clone(), window, cx)
        });
        let new_folio_name = cx.new(|cx| InputState::new(window, cx).placeholder("Folio name"));
        let find = cx.new(|cx| InputState::new(window, cx).placeholder("Find in manuscript"));
        let source_line = cx.new(|cx| InputState::new(window, cx).placeholder("Line number"));
        let steering = research_steering::SteeringState::new(window, cx);
        let mut subscriptions = Vec::new();
        subscriptions.extend(steering.subscribe(window, cx));
        subscriptions.push(
            cx.subscribe_in(&source, window, |this, _, event, window, cx| {
                if matches!(event, InputEvent::Change) {
                    this.source_changed(window, cx);
                }
            }),
        );
        subscriptions.push(
            cx.subscribe_in(&source_line, window, |this, _, event, window, cx| {
                if matches!(event, InputEvent::PressEnter { .. }) {
                    this.go_to_source_line(window, cx);
                }
            }),
        );
        subscriptions.push(cx.observe(&source, |_, _, cx| cx.notify()));
        subscriptions.push(cx.observe_window_appearance(window, |this, window, cx| {
            this.appearance_changed(window, cx);
        }));
        subscriptions.push(
            cx.subscribe_in(&title, window, |this, _, event, window, cx| {
                this.prototype_title_event(event, window, cx)
            }),
        );
        for state in [&body, &notes] {
            subscriptions.push(cx.subscribe_in(
                state,
                window,
                |this, sender, event, window, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.changed(window, cx);
                    }
                    if sender == &this.body {
                        this.insert_body_event(event, window, cx);
                        if matches!(event, InputEvent::Change) {
                            this.reveal_caret_next_frame(window, cx);
                        }
                    }
                },
            ));
        }
        subscriptions.push(cx.observe_in(&body, window, |this, _, window, cx| {
            this.insert_body_selection_changed(window, cx);
        }));
        subscriptions.push(cx.subscribe_in(
            &new_folio_name,
            window,
            |this, _, event, window, cx| {
                if matches!(event, InputEvent::PressEnter { .. }) {
                    this.create_named_folio(window, cx);
                }
            },
        ));
        subscriptions.push(
            cx.subscribe_in(&find, window, |this, _, event, window, cx| {
                if matches!(event, InputEvent::PressEnter { .. }) {
                    this.find_next(window, cx);
                }
            }),
        );
        // Quit is an explicit freshness boundary, including the platform's
        // application menu. Capture the ropes before GPUI releases the view.
        subscriptions.push(cx.on_focus_lost(window, |this, window, cx| {
            // Retry disappears when its request starts; row actions can
            // disappear after a durable ACK. Keep keyboard actions in the
            // nearest surviving native focus scope.
            let target = window
                .focus_lost_restore_target(cx)
                .unwrap_or_else(|| this.focus.clone());
            window.focus(&target, cx);
        }));
        subscriptions.push(cx.on_app_quit(|this, cx| {
            if let Err(error) = this.flush_on_shutdown(cx) {
                eprintln!("Twyne could not save on shutdown: {error:#}");
            }
            async {}
        }));
        let close_view = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            close_view
                .update(cx, |this, cx| {
                    this.flush_apparatus(window, cx).is_ok()
                        && this.flush_rubric(window, cx).is_ok()
                        && this.flush_cast(window, cx).is_ok()
                        && this.flush_marginalia(window, cx).is_ok()
                        && this.flush_on_shutdown(cx).is_ok()
                })
                .unwrap_or(true)
        });
        let statistics = Statistics::for_body(&document.body);
        let preview = SharedString::from(document.body.clone());
        let source_mode = document
            .workspace
            .as_deref()
            .is_some_and(|workspace| workspace.canonical_source().is_some());
        let reading = document.workspace.is_some() && !source_mode;
        let mut notices = library.warnings.clone();
        let (appearance_store, appearance_record, appearance_warnings) =
            settings_coordinator::load_appearance(&store);
        notices.extend(appearance_warnings);
        let (house_store, house_record, house_warnings) = house_coordinator::load_house(&store);
        notices.extend(house_warnings);
        let (cast, cast_warnings) = cast_coordinator::CastState::load(&store);
        notices.extend(cast_warnings);
        let (rubric, rubric_warnings) = rubric_coordinator::RubricState::load(&store);
        notices.extend(rubric_warnings);
        let (gen_ui, tool_warnings) = gen_ui_coordinator::ToolState::load(&store);
        notices.extend(tool_warnings);
        let (apparatus, apparatus_warnings) = apparatus_coordinator::ApparatusState::load(&store);
        notices.extend(apparatus_warnings);
        let (flow, flow_warnings) = flow_coordinator::FlowState::load(&store, cx);
        notices.extend(flow_warnings);
        let (marginalia, marginalia_warnings) =
            marginalia_coordinator::MarginaliaState::load(&store);
        notices.extend(marginalia_warnings);
        #[cfg(target_os = "linux")]
        let (clipboard, clipboard_warning) = clipboard_coordinator::ClipboardState::open(cx);
        #[cfg(target_os = "linux")]
        notices.extend(clipboard_warning);
        if let Err(error) = apply_preference(&appearance_record.preference, cx) {
            notices.push(format!("Appearance could not be applied: {error:#}"));
        }
        source.update(cx, |state, cx| state.refresh(cx));
        let revision_store = match RevisionStore::open(store.root().to_path_buf()) {
            Ok(history) => Some(history),
            Err(error) => {
                notices.push(format!("Version history could not be opened: {error:#}"));
                None
            }
        };
        let mut revision_ready = revision_store.is_some();
        let revision_timeline = match &revision_store {
            Some(history) => match history.load(active) {
                Ok(loaded) => {
                    notices.extend(loaded.warnings);
                    loaded.timeline
                }
                Err(error) => {
                    revision_ready = false;
                    notices.push(format!("Version history could not be opened: {error:#}"));
                    Arc::new(RevisionTimeline::new(active))
                }
            },
            None => Arc::new(RevisionTimeline::new(active)),
        };
        let notice = (!notices.is_empty()).then(|| notices.join("\n"));
        body.update(cx, |state, cx| state.focus(window, cx));
        let mut room = Self {
            focus: cx.focus_handle(),
            account_focus: cx.focus_handle(),
            account_open: false,
            account_error: None,
            insert: slash_coordinator::InsertState::default(),
            window_handle: window.window_handle(),
            store,
            documents: library.documents,
            active,
            title,
            body,
            source,
            source_line,
            source_go_to_line: false,
            source_wrapping: true,
            source_session,
            source_debounce: None,
            source_proof_debounce: None,
            #[cfg(target_os = "linux")]
            clipboard,
            rich: None,
            rich_subscription: None,
            rich_saved_revision: 0,
            math_source: math_source_coordinator::MathSourceScope::default(),
            editor_drag: editor_drag_coordinator::EditorDragState::default(),
            projection_task: None,
            compositor: None,
            compositor_tab_focus: std::array::from_fn(|_| cx.focus_handle()),
            compositor_subscription: None,
            page_ruler: None,
            page_ruler_subscription: None,
            page_ruler_state: None,
            pagination: std::cell::RefCell::default(),
            revision_store,
            revision_ready,
            revision_timeline,
            revision_view: None,
            revision_subscription: None,
            revision_generation: 1,
            appearance_store,
            appearance_preview: appearance_record.preference.clone(),
            appearance_record,
            appearance_pending: None,
            settings_view: None,
            settings_subscription: None,
            settings_route: false,
            settings_scroll: ScrollHandle::new(),
            house_store,
            house_record,
            house_pending: None,
            house_view: None,
            house_subscription: None,
            house_route: false,
            library_view: None,
            library_subscription: None,
            library_loading: false,
            library_generation: 0,
            library_task: None,
            flow,
            cast,
            rubric,
            gen_ui,
            apparatus,
            steering,
            marginalia,
            margin: margin_composer::MarginState::default(),
            margin_rail: margin_rail_coordinator::MarginRailState::default(),
            image_request: None,
            compiler: Arc::new(NativeCompiler::default()),
            proof: None,
            proof_images: Vec::new(),
            proof_zoom: 100,
            proof_scroll: ScrollHandle::new(),
            selected_proof_page: 0,
            writing_scroll: ScrollHandle::new(),
            caret_reveal_pending: false,
            proof_status: "Proof updates when opened".into(),
            proof_error: None,
            proof_mode: false,
            split_view: false,
            proof_generation: 0,
            proof_task: None,
            pdf_requested: false,
            applying_source: false,
            dossier_images: DossierImageLifecycle::new(window, cx)
                .map_err(|error| eprintln!("Dossier image retirement is unavailable: {error:#}"))
                .ok(),
            dossier: None,
            dossier_subscription: None,
            notes,
            new_folio_name,
            new_folio_form: false,
            library_route: false,
            find,
            statistics,
            page_selector_metrics: std::cell::Cell::new(None),
            page_selector_typeahead: std::cell::RefCell::default(),
            preview,
            dirty: false,
            reading,
            source_mode,
            desk: DeskState::new(library.editor_view),
            dateline: editorial_dateline(),
            archive_visible: false,
            find_visible: false,
            find_status: String::new(),
            notice,
            error: None,
            debounce: None,
            _subscriptions: subscriptions,
        };
        room.install_rich(window, cx);
        if room.source_mode {
            room.schedule_source_proof(window, cx);
        }
        room.start_flow_ticker(window, cx);
        room.ensure_revision_baseline(cx);
        if room.desk.board_open
            && room.desk.board_context == BoardContext::Cast
            && let Err(error) = room.ensure_cast(window, cx)
        {
            room.error = Some(format!("Cast could not be opened: {error:#}"));
        }
        room
    }

    fn active_document(&self) -> &Manuscript {
        self.documents
            .iter()
            .find(|doc| doc.id == self.active)
            .unwrap()
    }

    fn install_rich(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.install_rich_editor(window, cx);
        self.install_compositor(window, cx);
        self.install_page_ruler(window, cx);
        self.focus_writing(window, cx);
        self.refresh_rubric_context(cx);
    }

    fn install_rich_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.retire_gen_ui_visit(cx);
        self.retire_math_source_visit(cx);
        self.stop_editor_drag_scroll();
        self.hide_inline_margin(window, cx);
        self.clear_margin_rail_peek(cx);
        if let Some(editor) = &self.rich {
            editor.update(cx, |editor, cx| {
                editor.cancel_block_drag(window, cx);
                editor.hide_note_popup(window, cx);
            });
        }
        self.detach_flow(cx);
        self.rich_subscription = None;
        self.rich = None;
        self.rich_saved_revision = 0;
        self.pagination = std::cell::RefCell::default();
        let Some(workspace) = self.active_document().workspace.as_deref() else {
            return;
        };
        if !matches!(
            workspace.projection,
            ProjectionState::Verified | ProjectionState::LegacyHtml
        ) {
            return;
        }
        let document = match RichDocument::from_html(&workspace.content.html) {
            Ok(document) => document,
            Err(error) => {
                self.error = Some(format!(
                    "The writing view could not be opened: {error}. Source is preserved."
                ));
                return;
            }
        };
        let html = workspace.content.html.clone();
        let settings = workspace
            .folio
            .layout
            .as_ref()
            .and_then(|layout| layout.opening_initial.as_ref());
        let opening = settings.map_or_else(OpeningInitial::default, opening_initial);
        let readonly = self.active_document().archived
            || self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending);
        let view = cx.new(|cx| {
            let mut view = RichEditorView::new(document, cx);
            view.set_opening_initial(opening, cx);
            view.set_read_only(readonly, cx);
            view.set_comments_quiet(self.desk.zen, cx);
            view
        });
        self.install_math_source_context(&view, cx);
        #[cfg(target_os = "linux")]
        self.install_external_clipboard(&view, cx);
        self.rich_subscription =
            Some(
                cx.subscribe_in(&view, window, |this, sender, event, window, cx| {
                    if this.rich.as_ref().is_none_or(|view| view != sender) {
                        return;
                    }
                    match event {
                        RichEditorEvent::Transacted {
                            before,
                            after,
                            revision,
                        } => {
                            this.accept_tool_transaction(before, after, *revision, window, cx);
                        }
                        RichEditorEvent::Changed { revision } => {
                            this.refresh_insert_menu(window, cx);
                            // Save can capture a live field before its queued
                            // change reaches this subscription. That accepted
                            // revision must not make the document dirty again.
                            if *revision <= this.rich_saved_revision {
                                return;
                            }
                            this.changed(window, cx);
                            this.schedule_marginalia_reconcile(window, cx);
                            this.reveal_caret_next_frame(window, cx);
                        }
                        RichEditorEvent::SelectionChanged => {
                            this.refresh_insert_menu(window, cx);
                            this.reveal_caret_next_frame(window, cx);
                            cx.notify();
                        }
                        RichEditorEvent::PaginationChanged { generation } => {
                            this.accept_pagination(sender, *generation, window, cx);
                        }
                        RichEditorEvent::Input { delta } => {
                            this.accept_flow_input(sender, *delta, window, cx);
                        }
                        RichEditorEvent::CommentRequested { id, range } => {
                            this.open_inline_margin(id.to_string(), range.clone(), window, cx);
                        }
                        RichEditorEvent::CommentHoverChanged { id } => {
                            this.set_margin_rail_peek(id.as_deref(), cx);
                        }
                        RichEditorEvent::DragStarted { .. } => {
                            this.stop_editor_drag_scroll();
                            this.clear_margin_rail_peek(cx);
                            this.hide_inline_margin(window, cx);
                        }
                        RichEditorEvent::DragFinished { .. } => {
                            this.stop_editor_drag_scroll();
                            cx.notify();
                        }
                        RichEditorEvent::DragAutoScrollRequested { position } => {
                            this.request_editor_drag_scroll(sender, *position, window, cx);
                        }
                        RichEditorEvent::Error(error) => {
                            this.error = Some(error.to_string());
                            cx.notify();
                        }
                    }
                }),
            );
        self.statistics = Statistics::for_body(&view.read(cx).document().plain_text());
        self.preview = html.into();
        self.rich = Some(view);
        self.schedule_marginalia_reconcile(window, cx);
        self.source_mode = readonly
            && self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending);
        self.reading = false;
    }

    fn focus_writing(&self, window: &mut Window, cx: &mut Context<Self>) {
        if self.source_mode {
            self.source.update(cx, |state, cx| state.focus(window, cx));
        } else if let Some(view) = &self.rich {
            window.focus(&view.read(cx).focus_handle(cx), cx);
        } else {
            self.body.update(cx, |state, cx| state.focus(window, cx));
        }
    }

    fn reveal_caret_next_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.caret_reveal_pending {
            return;
        }
        self.caret_reveal_pending = true;
        let view = cx.weak_entity();
        window.on_next_frame(move |window, cx| {
            let _ = view.update(cx, |this, cx| {
                this.caret_reveal_pending = false;
                if this.source_mode
                    || (this.proof_mode && !this.split_view)
                    || this.library_route
                    || this.settings_route
                    || this.house_route
                    || this.dossier.is_some()
                {
                    return;
                }
                let Some(caret) = this
                    .rich
                    .as_ref()
                    .and_then(|view| view.read(cx).caret_bounds())
                    .or_else(|| this.prototype_caret_line_bounds(window, cx))
                else {
                    return;
                };
                let viewport = this.writing_scroll.bounds();
                if viewport.size.height <= px(0.) {
                    return;
                }
                let mut offset = this.writing_scroll.offset();
                let previous = offset;
                if this
                    .rich
                    .as_ref()
                    .is_some_and(|view| view.read(cx).selection().head == 0)
                {
                    offset.y = px(0.);
                } else if caret.size.height + px(16.) > viewport.size.height {
                    // A short viewport must reveal the top of a full line,
                    // rather than oscillating between its top and bottom.
                    offset.y += viewport.top() - caret.top();
                } else if caret.top() < viewport.top() + px(8.) {
                    offset.y += viewport.top() + px(8.) - caret.top();
                } else if caret.bottom() > viewport.bottom() - px(8.) {
                    offset.y -= caret.bottom() - (viewport.bottom() - px(8.));
                }
                offset.y = offset.y.min(px(0.));
                if offset != previous {
                    this.writing_scroll.set_offset(offset);
                    cx.notify();
                }
            });
        });
    }

    fn install_compositor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.compositor_subscription = None;
        self.compositor = None;
        let Some(workspace) = self.active_document().workspace.as_deref() else {
            return;
        };
        let layout = workspace.folio.layout.clone().unwrap_or_default();
        let header = workspace.folio.header.clone().unwrap_or_default();
        let footer = workspace.folio.footer.clone().unwrap_or_default();
        let editor = self.rich.clone();
        let readonly = self.active_document().archived
            || self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending);
        let tab = self.desk.compositor_tab;
        let compositor = cx.new(|cx| {
            let mut view = CompositorView::new(editor, layout, cx);
            view.set_tab(tab, cx);
            view.set_chrome_text(header, footer, window, cx);
            view.set_read_only(readonly, cx);
            view.set_capabilities(self.compositor_capabilities(), cx);
            view
        });
        self.compositor_subscription = Some(cx.subscribe_in(
            &compositor,
            window,
            |this, _, event, window, cx| match event {
                CompositorEvent::LayoutChanged(layout) => {
                    if let Some(editor) = &this.rich {
                        let settings = layout.opening_initial.clone().unwrap_or_default();
                        editor.update(cx, |editor, cx| {
                            editor.set_opening_initial(opening_initial(&settings), cx)
                        });
                    }
                    this.changed(window, cx);
                    if this.proof_mode || this.split_view {
                        this.request_proof(false, window, cx);
                    }
                }
                CompositorEvent::ChromeTextChanged { .. } => this.changed(window, cx),
                CompositorEvent::SavePdfRequested { .. } => this.request_pdf(window, cx),
                CompositorEvent::FindRequested => this.show_find(window, cx),
                CompositorEvent::VersionHistoryRequested => this.open_versions(window, cx),
                CompositorEvent::ImageFileRequested { selection } => {
                    this.choose_image_file(*selection, window, cx)
                }
                CompositorEvent::MarginNoteRequested { selection } => {
                    this.compose_margin(*selection, window, cx)
                }
                CompositorEvent::Error(error) => {
                    this.error = Some(error.clone());
                    cx.notify();
                }
                _ => {}
            },
        ));
        self.compositor = Some(compositor);
    }

    fn set_write(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if self
            .source_session
            .as_ref()
            .is_some_and(|session| session.pending)
        {
            return;
        }
        if self.flush(cx).is_err() {
            return;
        }
        self.source_proof_debounce = None;
        self.proof_generation = self.proof_generation.saturating_add(1);
        self.proof_task = None;
        self.proof_mode = false;
        self.split_view = false;
        if let Some(view) = &self.rich {
            self.source_mode = false;
            self.reading = false;
            let readonly = self.active_document().archived;
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
            if let Some(view) = &self.compositor {
                view.update(cx, |view, cx| view.set_read_only(readonly, cx));
            }
            self.update_revision_capabilities(cx);
            window.focus(&view.read(cx).focus_handle(cx), cx);
            cx.notify();
            return;
        }
        let Some(workspace) = self.active_document().workspace.as_deref() else {
            self.source_mode = false;
            self.reading = false;
            self.body.update(cx, |state, cx| state.focus(window, cx));
            cx.notify();
            return;
        };
        let Some(source) = workspace.canonical_source().map(str::to_owned) else {
            return;
        };
        let id = self.active;
        let revision = self.active_document().revision;
        self.notice = Some("Opening the writing view…".into());
        self.projection_task = Some(cx.spawn_in(window, async move |this, cx| {
            let expected = source.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    twyne_desktop::semantic_bridge::SemanticBridge::discover()?.project(&source)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.active != id
                    || this.active_document().revision != revision
                    || this
                        .source_session
                        .as_ref()
                        .is_some_and(|session| session.pending)
                {
                    return;
                }
                match result {
                    Ok(projection) => {
                        let document = this
                            .documents
                            .iter_mut()
                            .find(|document| document.id == id)
                            .unwrap();
                        let workspace = Arc::make_mut(document.workspace.as_mut().unwrap());
                        if let Err(error) =
                            workspace.install_verified_projection(&expected, projection.html)
                        {
                            this.error = Some(error.to_string());
                            return;
                        }
                        this.install_rich(window, cx);
                        // The projection is now in the in-memory document that
                        // flush compares with its snapshot. Mark and schedule
                        // this metadata change so opening Write alone also
                        // persists the verified HTML beside the authored source.
                        this.changed(window, cx);
                        this.notice = None;
                        if let Some(view) = &this.rich {
                            window.focus(&view.read(cx).focus_handle(cx), cx);
                        }
                    }
                    Err(error) => {
                        this.error = Some(format!(
                            "The writing view could not be opened: {error:#}. Source is preserved."
                        ))
                    }
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn sync_source_after_save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .source_session
            .as_ref()
            .is_some_and(|session| session.pending)
        {
            return;
        }
        self.refresh_source_session();
        let Some(canonical) = self
            .active_document()
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.canonical_source())
            .map(str::to_owned)
        else {
            return;
        };
        self.source.update(cx, |state, cx| {
            twyne_desktop::source_editor::set_source(state, canonical.clone(), window, cx)
        });
        self.body
            .update(cx, |state, cx| state.set_value(canonical, window, cx));
    }

    fn refresh_source_session(&mut self) {
        if self
            .source_session
            .as_ref()
            .is_some_and(|session| session.pending)
        {
            return;
        }
        let Some(canonical) = self
            .active_document()
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.canonical_source())
            .map(str::to_owned)
        else {
            return;
        };
        if self
            .source_session
            .as_ref()
            .is_some_and(|session| session.canonical_source == canonical)
        {
            return;
        }
        let mut session = self.source_session.clone().unwrap_or_else(|| {
            SourceSession::open(
                self.active,
                &canonical,
                self.store
                    .load_source_draft(self.active)
                    .unwrap_or_default(),
            )
        });
        let record = session.discard(&canonical, timestamp());
        if let Err(error) = self.store.save_source_draft(self.active, &record) {
            self.notice = Some(format!(
                "The manuscript was saved, but source recovery could not be updated: {error:#}"
            ));
        }
        self.source_session = Some(session);
    }

    fn set_source(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if let Err(error) = self.ensure_source(window, cx) {
            self.error = Some(format!("Source could not be opened: {error:#}"));
            cx.notify();
            return;
        }
        if self.source_session.is_none() {
            return;
        }
        self.sync_source_after_save(window, cx);
        self.retire_math_source_visit(cx);
        self.source_mode = true;
        self.reading = false;
        self.proof_mode = false;
        self.split_view = false;
        self.source.update(cx, |state, cx| state.focus(window, cx));
        self.schedule_source_proof(window, cx);
        cx.notify();
    }

    fn schedule_source_proof(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.applying_source || self.source_session.is_none() {
            return;
        }
        let id = self.active;
        let source_generation = self.source_session.as_ref().unwrap().generation;
        self.proof_generation = self.proof_generation.saturating_add(1);
        self.proof_task = None;
        if self.proof.is_none() {
            self.proof_status = "Preparing proof…".into();
        }
        let timer = cx.background_executor().timer(Duration::from_millis(450));
        self.source_proof_debounce = Some(cx.spawn_in(window, async move |this, cx| {
            timer.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.active == id
                    && !this.standalone_route()
                    && (this.source_mode || this.proof_mode || this.split_view)
                    && this
                        .source_session
                        .as_ref()
                        .is_some_and(|session| session.generation == source_generation)
                {
                    this.request_proof(false, window, cx);
                }
            });
        }));
    }

    fn ensure_source(&mut self, window: &mut Window, cx: &mut Context<Self>) -> anyhow::Result<()> {
        self.flush(cx)?;
        if self.source_session.is_some() || self.active_document().workspace.is_none() {
            return Ok(());
        }
        let current = self.active_document();
        let html = current.workspace.as_deref().unwrap().content.html.clone();
        let revision = current.revision;
        let mut document = twyne_desktop::document_edit::apply_html(current.clone(), &html)?;
        document.touch();
        self.store.save_if_revision(&document, revision)?;
        *self
            .documents
            .iter_mut()
            .find(|document| document.id == self.active)
            .unwrap() = document;
        self.refresh_source_session();
        self.sync_source_after_save(window, cx);
        Ok(())
    }

    fn snapshot(&self, cx: &App) -> Snapshot {
        let document = self.active_document();
        Snapshot {
            document: Manuscript {
                format: document.format.clone(),
                version: document.version,
                id: document.id,
                title: self.title.read(cx).value().to_string(),
                body: if self.rich.is_some() {
                    document.body.clone()
                } else {
                    String::new()
                },
                notes: String::new(),
                created_at: document.created_at,
                updated_at: document.updated_at,
                revision: document.revision,
                archived: document.archived,
                workspace: document.workspace.clone(),
            },
            body: self.body.read(cx).text().clone(),
            notes: self.notes.read(cx).text().clone(),
            rich: self
                .rich
                .as_ref()
                .filter(|view| view.read(cx).revision() != self.rich_saved_revision)
                .map(|view| view.read(cx).snapshot()),
            has_rich: self.rich.is_some(),
            rich_revision: self.rich.as_ref().map(|view| view.read(cx).revision()),
            page_settings: self.compositor.as_ref().map(|view| {
                let view = view.read(cx);
                let (header, footer) = view.chrome_text(cx);
                (view.layout.clone(), header, footer)
            }),
        }
    }

    fn changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.invalidate_rubric_context(cx);
        let document = self
            .documents
            .iter_mut()
            .find(|doc| doc.id == self.active)
            .unwrap();
        document.revision = document.revision.saturating_add(1);
        document.updated_at = timestamp();
        self.dirty = true;
        // No whole-manuscript string, scan, Markdown parse, or file I/O here.
        // Cancelling this task restarts the quiet period on the next edit.
        let timer = cx.background_executor().timer(Duration::from_millis(700));
        self.debounce = Some(cx.spawn_in(window, async move |this, cx| {
            timer.await;
            let Ok((snapshot, store)) = this.update(cx, |this, cx| (this.snapshot(cx), this.store.clone())) else { return; };
            let id = snapshot.document.id;
            let revision = snapshot.document.revision;
            let rich_revision = snapshot.rich_revision;
            let result = cx.background_executor().spawn(async move {
                let document = snapshot.materialize()?;
                let statistics = Statistics::for_body(&twyne_desktop::document_edit::visible_text(&document));
                store.save(&document)?;
                anyhow::Ok((document, statistics))
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.active != id || this.active_document().revision != revision { return; }
                match result {
                    Ok((document, statistics)) => {
                        this.preview = document.workspace.as_deref().map_or_else(|| document.body.clone(), |workspace| workspace.content.html.clone()).into();
                        *this.documents.iter_mut().find(|doc| doc.id == id).unwrap() = document;
                        this.statistics = statistics;
                        if let Some(revision) = rich_revision { this.rich_saved_revision = revision; }
                        #[cfg(target_os = "linux")]
                        this.refresh_clipboard_context();
                        this.refresh_math_source_base();
                        this.sync_source_after_save(window, cx);
                        this.dirty = false;
                        this.refresh_rubric_context(cx);
                        this.error = None;
                        if let Err(error) = this.file_marked_composition(window, cx) {
                            this.error = Some(format!("Your marked note is still held: {error:#}"));
                        }
                        this.reconcile_marginalia(window, cx);
                        this.automatic_revision_after_save(cx);
                        if this.revision_view.is_some() { this.refresh_revision_view(window, cx); }
                        if this.proof_mode || this.split_view { this.request_proof(false, window, cx); }
                    }
                    Err(error) => this.error = Some(format!("Could not save your draft: {error:#}. Your text is still in this window. Retry Save or export a copy.")),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn source_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.active_document().archived || self.applying_source {
            return;
        }
        let Some(session) = &mut self.source_session else {
            return;
        };
        let generation = session.advance();
        self.source_proof_debounce = None;
        self.proof_generation = self.proof_generation.saturating_add(1);
        self.proof_task = None;
        self.proof_error = None;
        if let Some(view) = &self.rich {
            view.update(cx, |view, cx| view.set_read_only(true, cx));
        }
        if let Some(view) = &self.compositor {
            view.update(cx, |view, cx| view.set_read_only(true, cx));
        }
        self.update_revision_capabilities(cx);
        let timer = cx.background_executor().timer(Duration::from_millis(450));
        self.source_debounce = Some(cx.spawn_in(window, async move |this, cx| {
            timer.await;
            let Ok(Some((mut session, rope, store))) = this.update(cx, |this, cx| {
                this.source_session.as_ref().filter(|session| session.generation == generation)
                    .map(|session| (session.clone(), this.source.read(cx).text().clone(), this.store.clone()))
            }) else { return; };
            let id = session.folio_id;
            let (session, result) = cx.background_executor().spawn(async move {
                let record = session.capture(rope.to_string(), timestamp());
                let result = store.save_source_draft(id, &record);
                (session, result)
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.active != id || this.source_session.as_ref().is_none_or(|current| current.generation != generation) { return; }
                this.source_session = Some(session);
                if let Err(error) = result { this.error = Some(format!("Source could not be saved on this device: {error:#}. Save a source copy before leaving.")); }
                if !this.standalone_route() && (this.source_mode || this.proof_mode || this.split_view) { this.request_proof(false, window, cx); }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn flush_source(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        self.source_debounce = None;
        if !self.source_mode
            && self
                .source_session
                .as_ref()
                .is_none_or(|session| !session.pending)
        {
            return Ok(());
        }
        let Some(session) = &mut self.source_session else {
            return Ok(());
        };
        let record = session.capture(self.source.read(cx).value().to_string(), timestamp());
        if let Err(error) = self.store.save_source_draft(session.folio_id, &record) {
            self.error = Some(format!(
                "Source could not be saved on this device: {error:#}. Save a source copy before leaving."
            ));
            return Err(error);
        }
        let pending = session.pending;
        if let Some(view) = &self.rich {
            let readonly = self.active_document().archived || self.reading || pending;
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
        }
        if let Some(view) = &self.compositor {
            let readonly = self.active_document().archived || self.reading || pending;
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
        }
        self.update_revision_capabilities(cx);
        Ok(())
    }

    fn discard_source(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.applying_source {
            return;
        }
        self.proof_generation = self.proof_generation.saturating_add(1);
        self.proof_task = None;
        self.source_debounce = None;
        self.source_proof_debounce = None;
        let canonical = self
            .active_document()
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.canonical_source())
            .unwrap_or("")
            .to_owned();
        let Some(session) = &self.source_session else {
            self.pdf_requested = false;
            return;
        };
        let mut next = session.clone();
        let record = next.discard(&canonical, timestamp());
        match self.store.save_source_draft(next.folio_id, &record) {
            Ok(()) => {
                self.source.update(cx, |state, cx| {
                    twyne_desktop::source_editor::set_source(state, canonical, window, cx)
                });
                self.source_session = Some(next);
                if let Some(view) = &self.rich {
                    let readonly = self.active_document().archived;
                    view.update(cx, |view, cx| view.set_read_only(readonly, cx));
                }
                if let Some(view) = &self.compositor {
                    let readonly = self.active_document().archived;
                    view.update(cx, |view, cx| view.set_read_only(readonly, cx));
                }
                self.error = None;
                self.proof_error = None;
                if self.source_mode || self.proof_mode || self.split_view {
                    self.schedule_source_proof(window, cx);
                }
            }
            Err(error) => self.error = Some(format!("Could not discard source: {error:#}")),
        }
        self.update_revision_capabilities(cx);
        cx.notify();
    }

    fn request_proof(&mut self, apply: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.applying_source {
            return;
        }
        self.source_proof_debounce = None;
        if let Err(error) = self.ensure_source(window, cx) {
            self.error = Some(format!("Proof could not be prepared: {error:#}"));
            self.pdf_requested = false;
            cx.notify();
            return;
        }
        self.sync_source_after_save(window, cx);
        let Some(session) = &self.source_session else {
            return;
        };
        if apply && (!session.pending || session.conflict || self.active_document().archived) {
            return;
        }
        let source: Arc<str> = session.source.clone().into();
        let source_generation = session.generation;
        let id = self.active;
        let document = self.active_document().clone();
        let compiler = self.compiler.clone();
        self.proof_generation = self.proof_generation.saturating_add(1);
        let generation = self.proof_generation;
        self.proof_status = "Typesetting…".into();
        self.proof_error = None;
        self.applying_source = apply;
        self.proof_task = Some(cx.spawn_in(window, async move |this, cx| {
            let compiled_source = source.clone();
            let result = cx.background_executor().spawn(async move {
                compiler.compile(generation, compiled_source, document.workspace.as_deref(), &document.title)
            }).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.active != id || this.proof_generation != generation || this.source_session.as_ref().is_none_or(|session| !session.accepts(source_generation, &source)) { return; }
                this.applying_source = false;
                let export_pdf = std::mem::take(&mut this.pdf_requested);
                let mut proof_ready = false;
                if let Some(view) = &this.compositor { view.update(cx, |view, cx| view.set_preparing_pdf(false, cx)); }
                match result {
                    Ok(build) => {
                        if let Some(proof) = build.compilation.proof {
                            this.proof_status = format!("{} {}{}", proof.pages.len(), if proof.pages.len() == 1 { "page" } else { "pages" }, if this.source_session.as_ref().is_some_and(|session| session.pending) { " · source draft" } else { "" });
                            let previous_count = this.proof_images.len();
                            this.proof_images = proof.pages.iter().map(|page| Arc::new(Image::from_bytes(ImageFormat::Svg, page.svg.as_bytes().to_vec()))).collect();
                            if this.selected_proof_page > this.proof_images.len() { this.selected_proof_page = 0; }
                            if this.proof_images.len() != previous_count { this.queue_selected_proof_page(); }
                            this.proof = Some(Arc::new(proof));
                            proof_ready = true;
                            #[cfg(feature = "ui-tests")]
                            eprintln!("TWYNE_CAPTURE_PROOF_READY");
                            if apply {
                                let result = this.commit_source(&source, build.html.unwrap_or_default(), window, cx);
                                if let Err(error) = result { this.error = Some(format!("Source could not be applied: {error:#}. Your source draft is preserved.")); }
                            }
                        } else {
                            #[cfg(feature = "ui-tests")]
                            eprintln!("TWYNE_CAPTURE_PROOF_ERROR");
                            this.proof_status = if this.proof.is_some() { "Showing last valid proof" } else { "Proof unavailable" }.into();
                            this.proof_error = Some(build.compilation.diagnostics.iter().map(|diagnostic| diagnostic.message.as_str()).collect::<Vec<_>>().join("\n"));
                        }
                    }
                    Err(error) => {
                        #[cfg(feature = "ui-tests")]
                        eprintln!("TWYNE_CAPTURE_PROOF_ERROR: {error:#}");
                        this.proof_status = if this.proof.is_some() { "Showing last valid proof" } else { "Proof unavailable" }.into();
                        this.proof_error = Some(format!("{error:#}"));
                    }
                }
                if export_pdf && proof_ready { this.export_pdf(window, cx); }
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn commit_source(
        &mut self,
        source: &str,
        html: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let session = self
            .source_session
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No source session"))?;
        anyhow::ensure!(
            !session.conflict,
            "A newer manuscript exists; save a source copy before resolving the conflict."
        );
        let mut document = self.active_document().clone();
        anyhow::ensure!(
            !document.archived,
            "This folio was archived before source could be applied."
        );
        let workspace = Arc::make_mut(
            document
                .workspace
                .as_mut()
                .ok_or_else(|| anyhow::anyhow!("No source workspace"))?,
        );
        anyhow::ensure!(
            workspace.canonical_source() == Some(session.canonical_source.as_str()),
            "The manuscript changed before source could be applied."
        );
        workspace.content.typst_source = Some(source.to_owned());
        workspace.content.format = Some(twyne_desktop::workspace::ContentFormat::Typst);
        workspace.content.updated_at = timestamp();
        workspace.install_verified_projection(source, html)?;
        document.body = source.to_owned();
        document.touch();
        self.store
            .save_if_revision(&document, self.active_document().revision)?;
        self.body.update(cx, |state, cx| {
            state.set_value(document.body.clone(), window, cx)
        });
        let id = document.id;
        *self
            .documents
            .iter_mut()
            .find(|item| item.id == id)
            .unwrap() = document;
        let session = self.source_session.as_mut().unwrap();
        let record = session.discard(source, timestamp());
        self.store.save_source_draft(self.active, &record)?;
        self.install_rich(window, cx);
        self.load_active_revision_history(cx);
        self.source_mode = true;
        self.refresh_versions_if_open(window, cx);
        self.source.update(cx, |state, cx| state.focus(window, cx));
        self.proof_status = "Source applied · saved on this device".into();
        self.error = None;
        #[cfg(target_os = "linux")]
        self.refresh_clipboard_context();
        Ok(())
    }

    /// File I/O is synchronous only at explicit save/switch/close boundaries.
    /// Autosave normally completes before any of these; failures keep the draft
    /// in the current window and prevent switching or closing it.
    fn flush(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        if let Some(view) = &self.dossier
            && let Err(error) = view.update(cx, |view, cx| view.flush_recovery(cx))
        {
            self.error = Some(format!(
                "Your Dossier could not be saved on this device: {error:#}. The form remains open."
            ));
            cx.notify();
            return Err(error);
        }
        self.flush_source(cx)?;
        if let Some(editor) = &self.rich
            && let Err(error) = editor.update(cx, |editor, cx| editor.flush_note_input(cx))
        {
            self.error = Some(format!(
                "Your note could not be saved: {error}. It remains in this window."
            ));
            cx.notify();
            return Err(error.into());
        }
        self.debounce = None;
        // Capture on every explicit boundary, even when a native input event
        // is still queued and its Change subscription has not run yet.
        let snapshot = self.snapshot(cx);
        let rich_revision = snapshot.rich_revision;
        let mut document = match snapshot.materialize() {
            Ok(document) => document,
            Err(error) => {
                self.error = Some(format!(
                    "Your visual edits could not be saved: {error:#}. They remain in this window."
                ));
                cx.notify();
                return Err(error);
            }
        };
        let previous = self.active_document();
        if self.dirty
            || document.title != previous.title
            || document.body != previous.body
            || document.notes != previous.notes
            || document.workspace != previous.workspace
        {
            // Give an explicit snapshot a fresh revision even if Change is
            // queued behind this action. An already-running autosave must
            // not be able to replace these newer input values afterwards.
            document.touch();
            self.documents
                .iter_mut()
                .find(|doc| doc.id == document.id)
                .unwrap()
                .revision = document.revision;
            self.dirty = true;
            if let Err(error) = self.store.save(&document) {
                self.error = Some(format!(
                    "Could not save your draft: {error:#}. Your text is still in this window. Retry Save or export a copy."
                ));
                cx.notify();
                return Err(error);
            }
            self.statistics =
                Statistics::for_body(&twyne_desktop::document_edit::visible_text(&document));
            self.preview = document
                .workspace
                .as_deref()
                .map_or_else(
                    || document.body.clone(),
                    |workspace| workspace.content.html.clone(),
                )
                .into();
            let id = document.id;
            *self.documents.iter_mut().find(|doc| doc.id == id).unwrap() = document;
            self.dirty = false;
            self.error = None;
            if let Some(revision) = rich_revision {
                self.rich_saved_revision = revision;
            }
            self.refresh_source_session();
            self.automatic_revision_after_save(cx);
        }
        if let Err(error) = self.store.save_preferences(Some(self.active)) {
            self.error = Some(format!(
                "Your manuscript is saved, but Twyne could not remember the open draft: {error:#}"
            ));
            cx.notify();
            return Err(error);
        }
        self.error = None;
        #[cfg(target_os = "linux")]
        self.refresh_clipboard_context();
        self.refresh_math_source_base();
        self.refresh_rubric_context(cx);
        Ok(())
    }

    fn select(&mut self, id: Uuid, window: &mut Window, cx: &mut Context<Self>) {
        if id == self.active
            || self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
            || self.retire_dossier(cx).is_err()
        {
            return;
        }
        self.dossier = None;
        self.dossier_subscription = None;
        self.active = id;
        self.install_active_document(window, cx);
    }

    fn retire_dossier(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        if let Some(view) = &self.dossier
            && let Err(error) = view.update(cx, |view, _| view.retire())
        {
            self.error = Some(format!(
                "Your Dossier recovery writer could not be closed: {error:#}. The form remains open."
            ));
            cx.notify();
            return Err(error);
        }
        Ok(())
    }

    fn install_active_document(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.reset_insert_menu(cx);
        self.image_request = None;
        self.new_folio_form = false;
        self.library_route = false;
        self.settings_route = false;
        self.house_route = false;
        self.cast.route = None;
        self.rubric.route = false;
        self.apparatus.route = false;
        let id = self.active;
        self.proof_generation = self.proof_generation.saturating_add(1);
        self.proof_task = None;
        self.source_proof_debounce = None;
        self.proof = None;
        self.proof_error = None;
        self.pdf_requested = false;
        self.proof_images.clear();
        self.proof_scroll = ScrollHandle::new();
        self.writing_scroll = ScrollHandle::new();
        self.proof_mode = false;
        self.split_view = false;
        self.applying_source = false;
        self.projection_task = None;
        let document = self.active_document();
        self.title.update(cx, |state, cx| {
            state.set_value(document.title.clone(), window, cx)
        });
        self.body.update(cx, |state, cx| {
            state.set_value(document.body.clone(), window, cx)
        });
        self.notes.update(cx, |state, cx| {
            state.set_value(document.notes.clone(), window, cx)
        });
        let statistics = Statistics::for_body(&document.body);
        let preview = document.body.clone().into();
        let source_mode = document
            .workspace
            .as_deref()
            .is_some_and(|workspace| workspace.canonical_source().is_some());
        let reading = document.workspace.is_some() && !source_mode;
        let source_session = document
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.canonical_source())
            .map(|canonical| {
                SourceSession::open(
                    document.id,
                    canonical,
                    self.store
                        .load_source_draft(document.id)
                        .unwrap_or_default(),
                )
            });
        self.source.update(cx, |state, cx| {
            twyne_desktop::source_editor::set_source(
                state,
                source_session
                    .as_ref()
                    .map_or("", |session| session.source.as_str()),
                window,
                cx,
            )
        });
        self.source_session = source_session;
        self.statistics = statistics;
        self.preview = preview;
        self.find_status.clear();
        self.reading = reading;
        self.source_mode = source_mode;
        self.install_rich(window, cx);
        if (self.cast.view.is_some()
            || (self.desk.board_open && self.desk.board_context == BoardContext::Cast))
            && let Err(error) = self.ensure_cast(window, cx)
        {
            self.error = Some(format!(
                "The held Cast draft could not be re-scoped: {error:#}"
            ));
        }
        if (self.rubric.view.is_some()
            || (self.desk.board_open && self.desk.board_context == BoardContext::Rubric))
            && let Err(error) = self.ensure_rubric(window, cx)
        {
            self.error = Some(format!(
                "The held Rubric change could not be re-scoped: {error:#}"
            ));
        }
        if (self.apparatus.view.is_some()
            || (self.desk.board_open && self.desk.board_context == BoardContext::Apparatus))
            && let Err(error) = self.ensure_apparatus(window, cx)
        {
            self.error = Some(format!(
                "The held Apparatus change could not be re-scoped: {error:#}"
            ));
        }
        if self.marginalia.view.is_some()
            && let Err(error) = self.ensure_marginalia(window, cx)
        {
            self.error = Some(format!(
                "The held margin draft could not be re-scoped: {error:#}"
            ));
        }
        self.notice = None;
        self.load_active_revision_history(cx);
        self.refresh_versions_if_open(window, cx);
        if let Err(error) = self.store.save_preferences(Some(id)) {
            self.error = Some(error.to_string());
        }
        self.focus_writing(window, cx);
        if self.source_mode {
            self.schedule_source_proof(window, cx);
        }
        cx.notify();
    }

    fn add_document(
        &mut self,
        document: Manuscript,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return false;
        }
        if let Err(error) = self.store.save(&document) {
            self.error = Some(format!("Could not create your draft: {error:#}"));
            cx.notify();
            return false;
        }
        let id = document.id;
        self.documents.insert(0, document);
        self.archive_visible = false;
        self.select(id, window, cx);
        self.active == id
    }

    fn new_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.add_document(Manuscript::new(""), window, cx) {
            self.open_dossier(window, cx);
        }
    }

    fn open_new_folio_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.new_folio_form = true;
        self.new_folio_name.update(cx, |state, cx| {
            state.set_value("", window, cx);
            state.focus(window, cx);
        });
        cx.notify();
    }

    fn create_named_folio(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = self.new_folio_name.read(cx).value().to_string();
        let name = if name.trim().is_empty() {
            "Untitled folio"
        } else {
            name.trim()
        };
        if self.add_document(Manuscript::new(name), window, cx) {
            self.new_folio_form = false;
            self.open_dossier(window, cx);
        }
    }

    fn open_dossier(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
            || self.retire_dossier(cx).is_err()
        {
            return;
        }
        self.library_route = false;
        self.retire_math_source_visit(cx);
        self.settings_route = false;
        self.house_route = false;
        self.cast.route = None;
        self.rubric.route = false;
        self.apparatus.route = false;
        self.proof_generation = self.proof_generation.saturating_add(1);
        self.proof_task = None;
        self.applying_source = false;
        self.pdf_requested = false;
        let document = self.active_document();
        let workspace = document.workspace.as_deref();
        let brief = workspace.and_then(|workspace| workspace.brief.clone());
        let prose =
            if let Some(source) = workspace.and_then(|workspace| workspace.canonical_source()) {
                twyne_desktop::semantic_bridge::SemanticBridge::discover()
                    .and_then(|bridge| bridge.project(source))
                    .and_then(|projection| {
                        RichDocument::from_html(&projection.html).map_err(anyhow::Error::from)
                    })
                    .map(|document| document.plain_text())
                    .unwrap_or_default()
            } else {
                twyne_desktop::document_edit::visible_text(document)
            };
        let initial_material = PriorMaterial {
            text: prose,
            html: workspace.map(|workspace| workspace.content.html.clone()),
            typst_source: workspace.and_then(|workspace| workspace.content.typst_source.clone()),
            provenance: workspace.and_then(|workspace| workspace.provenance.clone()),
            carried_from_manuscript: !document.body.trim().is_empty(),
            ..PriorMaterial::default()
        };
        let options = DossierOptions {
            folio_id: Some(document.id.to_string()),
            folio_name: document.title.clone(),
            owner: None,
            mode: if brief.is_some() {
                DossierMode::Refine
            } else {
                DossierMode::Create
            },
            existing_brief: brief,
            initial_material,
            recovery: None,
        }
        .with_recovery_directory(self.store.root().join("dossier-recovery"));
        let scope = DossierFilingScope {
            folio_id: document.id,
            revision: document.revision,
            mode: options.mode,
            recovery: options.recovery_identity(),
        };
        match DossierSession::open(options, timestamp()) {
            Ok(session) => {
                let view = cx.new(|cx| DossierView::new(session, window, cx));
                if let Some(lifecycle) = &self.dossier_images
                    && let Err(error) = view.update(cx, |view, cx| {
                        view.attach_image_lifecycle(lifecycle, window, cx)
                    })
                {
                    self.error = Some(format!("Could not prepare the Dossier: {error:#}"));
                    cx.notify();
                    return;
                }
                self.dossier_subscription = Some(cx.subscribe_in(
                    &view,
                    window,
                    move |this, view, event, window, cx| match event {
                        DossierEvent::FilingRequested { token, submission } => this.file_dossier(
                            view.clone(),
                            *token,
                            submission.clone(),
                            scope.clone(),
                            window,
                            cx,
                        ),
                        DossierEvent::Cancelled if this.owns_dossier_view(view, &scope, cx) => {
                            this.dossier = None;
                            this.dossier_subscription = None;
                            cx.notify();
                        }
                        _ => {}
                    },
                ));
                self.dossier = Some(view);
                cx.notify();
            }
            Err(error) => {
                self.error = Some(format!("Could not open the Dossier: {error:#}"));
                cx.notify();
            }
        }
    }

    fn file_dossier(
        &mut self,
        view: Entity<DossierView>,
        token: u64,
        submission: DossierSubmission,
        scope: DossierFilingScope,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.owns_dossier_filing(&view, token, &scope, cx) {
            return;
        }
        if self.active_document().revision != scope.revision
            || submission.mode != scope.mode
            || scope.revision.checked_add(1).is_none()
        {
            view.update(cx, |view, cx| {
                view.report_filing_error(
                    token,
                    "Your folio changed. Reopen the Dossier to review it before filing.",
                    window,
                    cx,
                );
            });
            return;
        }
        let document = self.active_document().clone();
        let revision = scope.revision;
        let store = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let document = twyne_desktop::dossier_filing::prepare_document(
                        document,
                        submission.brief,
                        submission.prior_material,
                        submission.mode,
                    )?;
                    store.save_if_revision(&document, revision)?;
                    anyhow::Ok(document)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.finish_dossier_filing(&view, token, &scope, result, window, cx);
            });
        })
        .detach();
    }

    fn owns_dossier_filing(
        &self,
        view: &Entity<DossierView>,
        token: u64,
        scope: &DossierFilingScope,
        cx: &App,
    ) -> bool {
        self.owns_dossier_view(view, scope, cx) && view.read(cx).accepts_filing(token)
    }

    fn owns_dossier_view(
        &self,
        view: &Entity<DossierView>,
        scope: &DossierFilingScope,
        cx: &App,
    ) -> bool {
        self.active == scope.folio_id
            && self
                .dossier
                .as_ref()
                .is_some_and(|current| current.entity_id() == view.entity_id())
            && view.read(cx).session.options.folio_id.as_deref()
                == Some(scope.folio_id.to_string().as_str())
            && view.read(cx).session.options.mode == scope.mode
            && view.read(cx).session.options.recovery_identity() == scope.recovery
    }

    fn finish_dossier_filing(
        &mut self,
        view: &Entity<DossierView>,
        token: u64,
        scope: &DossierFilingScope,
        result: anyhow::Result<Manuscript>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // Qualify the visible request before acknowledgement can clear recovery.
        // A reopened form may use the same recovery path as the retired form.
        let current_request = self.owns_dossier_filing(view, token, scope, cx);
        match result {
            Ok(document) => {
                if document.id != scope.folio_id
                    || scope.revision.checked_add(1) != Some(document.revision)
                {
                    if current_request {
                        view.update(cx, |view, cx| {
                            view.report_filing_error(
                                token,
                                "The saved folio could not be confirmed. Your Dossier draft has been retained.",
                                window,
                                cx,
                            );
                        });
                    }
                    cx.notify();
                    return;
                }
                let adopted = self
                    .documents
                    .iter_mut()
                    .find(|current| current.id == scope.folio_id)
                    .filter(|current| current.revision == scope.revision)
                    .map(|current| *current = document)
                    .is_some();
                if current_request && adopted {
                    let acknowledgement =
                        view.update(cx, |view, cx| view.acknowledge_filed(token, cx));
                    if matches!(acknowledgement, Ok(false)) {
                        cx.notify();
                        return;
                    }
                    if let Err(error) = acknowledgement {
                        self.notice = Some(format!(
                            "The Dossier is filed, but recovery cleanup needs attention: {error:#}"
                        ));
                    }
                    self.dossier = None;
                    self.dossier_subscription = None;
                    self.install_active_document(window, cx);
                } else if current_request {
                    view.update(cx, |view, cx| {
                        view.report_filing_error(
                            token,
                            "Your folio changed while filing. Your Dossier draft has been retained.",
                            window,
                            cx,
                        );
                    });
                }
            }
            Err(error) if current_request => {
                view.update(cx, |view, cx| {
                    view.report_filing_error(
                        token,
                        format!("Could not file the Dossier: {error:#}"),
                        window,
                        cx,
                    );
                });
            }
            Err(_) => {}
        }
        cx.notify();
    }

    fn duplicate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if self.flush(cx).is_err() {
            return;
        }
        self.add_document(self.active_document().duplicate(), window, cx);
    }

    fn archive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if self.flush(cx).is_err() {
            return;
        }
        let mut document = self.active_document().clone();
        document.archived = !document.archived;
        document.touch();
        if let Err(error) = self.store.save(&document) {
            self.error = Some(error.to_string());
            cx.notify();
            return;
        }
        let archived = document.archived;
        let id = document.id;
        *self.documents.iter_mut().find(|doc| doc.id == id).unwrap() = document;
        if let Some(view) = &self.rich {
            let readonly = archived
                || self.reading
                || self
                    .source_session
                    .as_ref()
                    .is_some_and(|session| session.pending);
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
        }
        if let Some(view) = &self.compositor {
            let readonly = archived
                || self.reading
                || self
                    .source_session
                    .as_ref()
                    .is_some_and(|session| session.pending);
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
        }
        self.archive_visible = archived;
        self.update_revision_capabilities(cx);
        self.notice = Some(
            if archived {
                "Draft archived. Open Archive to restore it at any time."
            } else {
                "Draft restored to your manuscripts."
            }
            .into(),
        );
        cx.notify();
        self.focus_writing(window, cx);
    }

    fn import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(
                "Import a Twyne backup, Typst source, HTML, Markdown, or text file".into(),
            ),
        });
        cx.spawn_in(window, async move |this, cx| {
            let path = match picker.await {
                Ok(Ok(Some(paths))) => paths.into_iter().next(),
                Ok(Ok(None)) => return,
                result => {
                    let _ = this.update(cx, |this, cx| {
                        this.error = Some(format!("Could not open the file picker: {result:?}"));
                        cx.notify();
                    });
                    return;
                }
            };
            let Some(path) = path else {
                return;
            };
            let result = cx
                .background_executor()
                .spawn(async move { import_file(&path) })
                .await;
            let _ = cx.update(|window, cx| {
                this.update(cx, |this, cx| match result {
                    Ok(document) => {
                        this.add_document(document, window, cx);
                    }
                    Err(error) => {
                        this.error = Some(format!("Could not import this file: {error:#}"));
                        cx.notify();
                    }
                })
            });
        })
        .detach();
    }

    fn export(&mut self, native: bool, window: &mut Window, cx: &mut Context<Self>) {
        // Export stays available even if the local library cannot be written.
        let snapshot = self.snapshot(cx);
        let source_copy = (!native
            && self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending))
        .then(|| self.source.read(cx).text().clone());
        let name = format!(
            "{}.{}",
            export_filename(&snapshot.document.title),
            if native {
                if snapshot.document.workspace.is_some() {
                    "twyne.json"
                } else {
                    "twyne"
                }
            } else if snapshot
                .document
                .workspace
                .as_deref()
                .is_some_and(|workspace| workspace.canonical_source().is_some())
            {
                "typ"
            } else if snapshot.document.workspace.is_some() {
                "html"
            } else {
                "md"
            }
        );
        let directory = directories::UserDirs::new()
            .and_then(|dirs| dirs.document_dir().map(PathBuf::from))
            .unwrap_or_else(|| self.store.root().to_path_buf());
        let picker = cx.prompt_for_new_path(&directory, Some(&name));
        cx.spawn_in(window, async move |this, cx| {
            let path = match picker.await {
                Ok(Ok(Some(path))) => path,
                Ok(Ok(None)) => return,
                result => {
                    let _ = this.update(cx, |this, cx| {
                        this.error = Some(format!("Could not open the save dialog: {result:?}"));
                        cx.notify();
                    });
                    return;
                }
            };
            let result = cx
                .background_executor()
                .spawn(async move {
                    let result = match source_copy {
                        Some(source) => export_bytes(&path, source.to_string().as_bytes()),
                        None => snapshot
                            .materialize()
                            .and_then(|document| export_file(&document, &path)),
                    };
                    (path, result)
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                match result {
                    (path, Ok(())) => this.notice = Some(format!("Exported {}", path.display())),
                    (_, Err(error)) => {
                        this.error = Some(format!("Could not export your draft: {error:#}"))
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn set_reading(&mut self, reading: bool, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if self.flush(cx).is_err() {
            return;
        }
        self.proof_mode = false;
        self.split_view = false;
        if let Some(view) = &self.rich {
            self.reading = reading;
            self.source_mode = false;
            let readonly = reading
                || self.active_document().archived
                || self
                    .source_session
                    .as_ref()
                    .is_some_and(|session| session.pending);
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
            if let Some(view) = &self.compositor {
                view.update(cx, |view, cx| view.set_read_only(readonly, cx));
            }
        } else if self
            .active_document()
            .workspace
            .as_deref()
            .is_some_and(|workspace| workspace.canonical_source().is_some())
        {
            self.source_mode = true;
            self.reading = false;
        } else {
            self.reading = reading;
            self.source_mode = false;
        }
        self.update_revision_capabilities(cx);
        cx.notify();
    }

    fn toggle_focus(&mut self, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        self.desk.toggle_zen();
        if let Some(editor) = &self.rich {
            editor.update(cx, |editor, cx| {
                editor.set_comments_quiet(self.desk.zen, cx)
            });
        }
        self.flow_manual_focus(self.desk.zen, cx);
        self.persist_view();
        cx.notify();
    }

    fn persist_view(&mut self) {
        if let Err(error) = self.store.save_editor_view(self.desk.preferences) {
            self.notice = Some(format!("Could not save your desk preferences: {error:#}"));
        }
    }

    fn toggle_drawer(&mut self, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        self.desk.toggle_drawer();
        self.persist_view();
        cx.notify();
    }

    fn toggle_compositor(&mut self, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        self.desk.toggle_compositor();
        self.persist_view();
        cx.notify();
    }

    fn toggle_notebook(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if self.active_document().workspace.is_some() && !self.desk.board_open {
            match self.desk.board_context {
                BoardContext::Cast => self.open_cast(CastSurface::Board, window, cx),
                BoardContext::Rubric => self.open_rubric(RubricSurface::Board, window, cx),
                BoardContext::Apparatus => self.open_apparatus(ApparatusSurface::Board, window, cx),
                BoardContext::Marginalia => self.open_marginalia(window, cx),
                BoardContext::Tools => self.open_writing_tools(window, cx),
                _ => self.open_versions(window, cx),
            }
            return;
        }
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
        {
            return;
        }
        self.desk.toggle_board();
        self.persist_view();
        cx.notify();
    }

    fn show_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route() {
            return;
        }
        if self.source_mode && !self.proof_mode {
            self.source
                .update(cx, |state, cx| state.open_search(true, cx));
            cx.notify();
            return;
        }
        if self.flush(cx).is_err() {
            return;
        }
        self.proof_mode = false;
        self.split_view = false;
        self.reading = false;
        let readonly = self.active_document().archived
            || self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending);
        if let Some(view) = &self.rich {
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
        }
        if let Some(view) = &self.compositor {
            view.update(cx, |view, cx| view.set_read_only(readonly, cx));
        }
        self.find_visible = true;
        self.find.update(cx, |state, cx| state.focus(window, cx));
        cx.notify();
    }

    fn find_next(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let query = self.find.read(cx).value().to_string();
        if query.is_empty() {
            self.find_status.clear();
            cx.notify();
            return;
        }
        if !self.source_mode
            && let Some(view) = &self.rich
        {
            let text = view.read(cx).document().editing_text();
            let start = view.read(cx).selection().range().end;
            let start_byte = text
                .char_indices()
                .nth(start)
                .map_or(text.len(), |(byte, _)| byte);
            let next = text[start_byte..]
                .find(&query)
                .map(|offset| start_byte + offset)
                .or_else(|| text[..start_byte].find(&query));
            if let Some(byte) = next {
                let anchor = text[..byte].chars().count();
                let head = anchor + query.chars().count();
                self.find_status = format!("{} matches", text.matches(&query).count());
                if let Err(error) = view.update(cx, |view, cx| {
                    view.set_selection(Selection { anchor, head }, cx)
                }) {
                    self.error = Some(error.to_string());
                }
                window.focus(&view.read(cx).focus_handle(cx), cx);
            } else {
                self.find_status = "No matches".into();
            }
            cx.notify();
            return;
        }
        let (body, start) = if self.source_mode {
            let state = self.source.read(cx);
            (state.text().to_string(), state.selected_range().end)
        } else {
            let state = self.body.read(cx);
            (state.text().to_string(), state.selected_range().end)
        };
        let next = body
            .get(start..)
            .and_then(|rest| rest.find(&query))
            .map(|offset| start + offset)
            .or_else(|| body.get(..start).and_then(|before| before.find(&query)));
        if let Some(offset) = next {
            self.find_status = format!("{} matches", body.matches(&query).count());
            if self.source_mode {
                self.source.update(cx, |state, cx| {
                    state.set_selected_range(offset..offset + query.len(), cx);
                    state.focus(window, cx);
                });
            } else {
                self.body.update(cx, |state, cx| {
                    state.set_selected_range(offset..offset + query.len(), cx);
                    state.focus(window, cx);
                });
            }
        } else {
            self.find_status = "No matches".into();
        }
        cx.notify();
    }

    fn header(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *palette(cx);
        let has_brief = self
            .active_document()
            .workspace
            .as_deref()
            .is_some_and(|workspace| workspace.brief.is_some());
        let wordmark_face = Font {
            weight: FontWeight::BOLD,
            ..font(DISPLAY_FONT)
        };
        let wordmark_width = window
            .text_system()
            .shape_line(
                "TWYNE".into(),
                px(32.),
                &[TextRun {
                    len: 5,
                    font: wordmark_face.clone(),
                    color: rgb(colors.ink).into(),
                    ..Default::default()
                }],
                None,
            )
            .width()
            + px(5. * 1.92);
        div()
            .id("masthead")
            .test_support()
            .flex()
            .flex_col()
            .min_h(px(112.))
            .flex_shrink_0()
            .border_b_2()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.paper))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(16.))
                    .min_h(px(86.))
                    .px(px(20.))
                    .pt(px(12.))
                    .pb(px(6.))
                    .child(
                        Button::new("toggle-library")
                            .ghost()
                            .small()
                            .size(px(30.))
                            .p_0()
                            .min_w(px(28.))
                            .flex_shrink_1()
                            .rounded(px(2.))
                            .accessibility_label("Toggle the drawer sidebar")
                            .child(assets::drawer_icon())
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_drawer(cx))),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w(wordmark_width)
                            .flex()
                            .flex_col()
                            .items_center()
                            .child(
                                div()
                                    .id("masthead-department")
                                    .min_w_0()
                                    .max_w_full()
                                    .child(wrapping_dept_label(
                                        "An Anti-Tabula-Rasa Quarterly",
                                        cx,
                                    )),
                            )
                            .child(
                                div()
                                    .id("masthead-wordmark")
                                    .h(px(32.))
                                    .flex_shrink_0()
                                    .mt(px(2.))
                                    .role(Role::Label)
                                    .aria_label("TWYNE")
                                    .child(tracked_text(
                                        "TWYNE",
                                        wordmark_face,
                                        32.,
                                        1.92,
                                        colors.ink,
                                        32.,
                                    )),
                            )
                            .child(
                                div()
                                    .id("masthead-dateline")
                                    .min_w_0()
                                    .max_w_full()
                                    .mt(px(4.))
                                    .child(wrapping_typewriter(
                                        &self.dateline,
                                        0.5,
                                        colors.ink_muted,
                                    )),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_shrink_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .when(window.viewport_size().width >= px(640.), |this| {
                                this.child(
                                    dossier_button(
                                        if has_brief {
                                            "Refine dossier"
                                        } else {
                                            "Create dossier"
                                        },
                                        !has_brief,
                                        cx,
                                    )
                                    .flex_shrink_1()
                                    .min_w_0()
                                    .h_auto()
                                    .py(px(7.2))
                                    .on_click(cx.listener(
                                        |this, _, window, cx| this.open_dossier(window, cx),
                                    )),
                                )
                            })
                            .child(file_menu_button(cx).dropdown_menu(|menu, _, _| {
                                menu.menu("Dossier & House context", Box::new(OpenHouse))
                                    .separator()
                                    .menu("Save", Box::new(SaveDraft))
                                    .menu("Import…", Box::new(ImportDraft))
                                    .menu("Export…", Box::new(ExportDraft))
                                    .menu("Export with notebook…", Box::new(ExportNative))
                                    .separator()
                                    .menu("Duplicate", Box::new(DuplicateDraft))
                                    .menu("Archive / restore", Box::new(ArchiveDraft))
                            }))
                            .child(self.account_menu(cx))
                            .child(
                                Button::new("toggle-notebook")
                                    .ghost()
                                    .small()
                                    .size(px(30.))
                                    .p_0()
                                    .accessibility_label("Toggle the editorial board panel")
                                    .child(assets::editorial_board_icon())
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.toggle_notebook(window, cx)
                                    })),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .h(px(24.))
                    .px(px(20.))
                    .pb(px(8.))
                    .child(div().h(px(1.)).flex_1().bg(rgb(colors.ink)))
                    .child(
                        div()
                            .text_size(px(12.))
                            .text_color(rgb(colors.vermilion))
                            .child("✦"),
                    )
                    .child(div().h(px(1.)).flex_1().bg(rgb(colors.ink))),
            )
    }

    fn desk_controls(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *palette(cx);
        let narrow = window.viewport_size().width < px(640.);
        let row_height = if narrow { 40. } else { 36. };
        let compositor = self.desk.compositor_visible() && !self.proof_mode && !self.source_mode;
        let editor = self.rich.as_ref().map(|editor| editor.read(cx));
        let editable =
            editor.is_some_and(|editor| !editor.is_read_only()) && !self.active_document().archived;
        let can_undo = editable && editor.is_some_and(|editor| editor.can_undo());
        let can_redo = editable && editor.is_some_and(|editor| editor.can_redo());
        div()
            .flex()
            .flex_wrap()
            .flex_shrink_0()
            .min_h(px(row_height + if compositor { 0. } else { 1. }))
            .items_center()
            .px(px(if narrow { 4. } else { 8. }))
            .gap_x(px(if narrow { 2. } else { 4. }))
            .bg(rgb(colors.paper))
            .when(!compositor, |this| {
                this.border_b_1().border_color(rgb(colors.rule))
            })
            .child(
                desk_button(
                    "toggle-compositor",
                    "Compositor",
                    TwyneIcon::Settings,
                    false,
                    narrow,
                    cx,
                )
                .accessibility_label("Toggle compositor")
                .on_click(cx.listener(|this, _, _, cx| this.toggle_compositor(cx)))
                .map(|button| focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .h(px(row_height))
                    .border_x_1()
                    .border_color(rgb(colors.rule))
                    .child(
                        desk_button("write-mode", "Write", TwyneIcon::PenNib, true, narrow, cx)
                            .when(
                                !self.reading && !self.source_mode && !self.proof_mode,
                                |this| {
                                    this.bg(rgb(colors.paper_soft))
                                        .border_b_2()
                                        .border_color(rgb(colors.vermilion))
                                        .text_color(rgb(colors.vermilion))
                                },
                            )
                            .disabled(
                                self.source_session
                                    .as_ref()
                                    .is_some_and(|session| session.pending),
                            )
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.set_write(window, cx);
                            }))
                            .map(|button| {
                                focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)
                            }),
                    )
                    .child(
                        desk_button(
                            "source-mode",
                            "Source",
                            TwyneIcon::CodeFile,
                            true,
                            narrow,
                            cx,
                        )
                        .disabled(self.active_document().workspace.is_none())
                        .when(self.source_mode && !self.proof_mode, |this| {
                            this.bg(rgb(colors.paper_soft))
                                .border_b_2()
                                .border_color(rgb(colors.vermilion))
                                .text_color(rgb(colors.vermilion))
                        })
                        .on_click(cx.listener(|this, _, window, cx| this.set_source(window, cx)))
                        .map(|button| {
                            focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)
                        }),
                    )
                    .child(
                        desk_button("proof-mode", "Proof", TwyneIcon::BookOpen, true, narrow, cx)
                            .disabled(self.active_document().workspace.is_none())
                            .when(self.proof_mode, |this| {
                                this.bg(rgb(colors.paper_soft))
                                    .border_b_2()
                                    .border_color(rgb(colors.vermilion))
                                    .text_color(rgb(colors.vermilion))
                            })
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.show_proof(window, cx);
                            }))
                            .map(|button| {
                                focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)
                            }),
                    ),
            )
            .child(
                desk_button(
                    "split-view",
                    "Split",
                    TwyneIcon::SidebarRight,
                    false,
                    narrow,
                    cx,
                )
                .disabled(self.active_document().workspace.is_none())
                .when(self.split_view, |this| {
                    this.bg(rgb(colors.paper_soft))
                        .text_color(rgb(colors.vermilion))
                })
                .on_click(cx.listener(|this, _, window, cx| {
                    this.split_view = !this.split_view;
                    this.proof_mode = false;
                    if this.split_view {
                        this.request_proof(false, window, cx);
                    }
                    cx.notify();
                }))
                .map(|button| focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)),
            )
            .when(self.proof.is_some() && self.proof_error.is_none(), |this| {
                this.child(
                    desk_button(
                        "desk-download-pdf",
                        "PDF",
                        TwyneIcon::FileDownload,
                        false,
                        narrow,
                        cx,
                    )
                    .accessibility_label(
                        if self.dirty
                            || self
                                .source_session
                                .as_ref()
                                .is_some_and(|session| session.pending)
                        {
                            "Download draft PDF"
                        } else {
                            "Download PDF"
                        },
                    )
                    .on_click(cx.listener(|this, _, window, cx| this.export_pdf(window, cx)))
                    .map(|button| {
                        focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)
                    }),
                )
            })
            .when(compositor, |this| {
                this.child(
                    div()
                        .id("compositor-tabs")
                        .role(Role::TabList)
                        .aria_label("Tools")
                        .flex()
                        .flex_auto()
                        .min_w_0()
                        .h(px(row_height))
                        .when(narrow, |this| this.w_full().max_w_full().flex_shrink_0())
                        .gap(px(2.))
                        .children(
                            twyne_desktop::view_state::CompositorTab::ALL
                                .into_iter()
                                .enumerate()
                                .map(|(index, tab)| {
                                    let active = tab == self.desk.compositor_tab;
                                    gpui_kit::base::Tab::new(SharedString::from(format!(
                                        "compositor-tab-{}",
                                        tab.label()
                                    )))
                                    .selected(active)
                                    .set_position(index + 1, 4)
                                    .track_focus(&self.compositor_tab_focus[index])
                                    .tab_stop(true)
                                    .flex_shrink_0()
                                    .h(px(row_height))
                                    .px(px(8.))
                                    .rounded(px(0.))
                                    .accessibility_label(tab.label())
                                    .child(
                                        div()
                                            .font_family(BUTTON_FONT)
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_size(px(12.))
                                            .line_height(px(18.))
                                            .child(tab.label()),
                                    )
                                    .when(active, |this| {
                                        this.bg(rgb(colors.paper_soft))
                                            .text_color(rgb(colors.vermilion))
                                            .border_b_2()
                                            .border_color(rgb(colors.vermilion))
                                    })
                                    .hover(|this| this.bg(rgb(colors.paper_soft)))
                                    .on_key_down(cx.listener(
                                        move |this, event: &gpui_kit::KeyDownEvent, window, cx| {
                                            let next = match event.keystroke.key.as_str() {
                                                "right" => (index + 1) % 4,
                                                "left" => (index + 3) % 4,
                                                "enter" | "space" => index,
                                                _ => return,
                                            };
                                            this.choose_compositor_tab(next, window, cx);
                                            window.prevent_default();
                                            cx.stop_propagation();
                                        },
                                    ))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.choose_compositor_tab(index, window, cx);
                                    }))
                                    .map(|button| focus_outline(button, -2., 0., colors.vermilion))
                                }),
                        )
                        .child(div().flex_1().min_w_0())
                        .child(
                            div()
                                .id("compositor-history")
                                .role(Role::Group)
                                .aria_label("History")
                                .flex()
                                .items_center()
                                .gap(px(2.))
                                .px(px(4.))
                                .flex_shrink_0()
                                .child(
                                    Button::new("compositor-talk")
                                        .ghost()
                                        .small()
                                        .h(px(row_height))
                                        .px(px(if narrow { 4.8 } else { 7.2 }))
                                        .text_color(rgb(colors.ink_light))
                                        .accessibility_label("Open Live voice desk")
                                        .tooltip(
                                            "Live voice is not connected in this offline edition",
                                        )
                                        .disabled(true)
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(5.6))
                                                .font_family(TYPEWRITER_FONT)
                                                .text_size(px(12.))
                                                .line_height(px(18.))
                                                .child("◉")
                                                .when(
                                                    window.viewport_size().width >= px(640.),
                                                    |this| this.child("Talk"),
                                                ),
                                        ),
                                )
                                .children([(true, can_undo), (false, can_redo)].map(
                                    |(undo, enabled)| {
                                        let label = if undo { "Undo" } else { "Redo" };
                                        Button::new(if undo {
                                            "compositor-undo"
                                        } else {
                                            "compositor-redo"
                                        })
                                        .ghost()
                                        .small()
                                        .h(px(row_height))
                                        .px(px(if narrow { 4.8 } else { 7.2 }))
                                        .text_color(rgb(colors.ink_light))
                                        .accessibility_label(label)
                                        .tooltip(label)
                                        .disabled(!enabled)
                                        .when(!enabled, |this| this.opacity(0.3))
                                        .child(
                                            assets::icon_named(if undo { "undo" } else { "redo" })
                                                .expect(
                                                    "catalog includes the original history icon",
                                                )
                                                .with_size(px(17.)),
                                        )
                                        .on_click(
                                            cx.listener(move |this, _, window, cx| {
                                                this.run_rich_history(undo, window, cx);
                                            }),
                                        )
                                    },
                                )),
                        ),
                )
            })
    }

    fn run_rich_history(&mut self, undo: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editor) = self.rich.clone() else {
            return;
        };
        if self.active_document().archived || editor.read(cx).is_read_only() {
            return;
        }
        let command = if undo {
            twyne_desktop::editor::Command::Undo
        } else {
            twyne_desktop::editor::Command::Redo
        };
        if let Err(error) = editor.update(cx, |editor, cx| editor.execute(command, window, cx)) {
            self.error = Some(error.to_string());
        }
        window.focus(&editor.read(cx).focus_handle(cx), cx);
        cx.notify();
    }

    fn choose_compositor_tab(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tab) = twyne_desktop::view_state::CompositorTab::ALL
            .get(index)
            .copied()
        else {
            return;
        };
        self.desk.compositor_tab = tab;
        if let Some(view) = &self.compositor {
            view.update(cx, |view, cx| view.set_tab(tab, cx));
        }
        window.focus(&self.compositor_tab_focus[index], cx);
        cx.notify();
    }

    fn compositor_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(view) = &self.compositor
            && self.rich.is_some()
            && !self.source_mode
        {
            return div()
                .px(px(8.))
                .bg(rgb(palette(cx).paper))
                .border_b_1()
                .border_color(rgb(palette(cx).rule))
                .child(view.clone())
                .into_any_element();
        }
        let colors = *palette(cx);
        div()
            .id("compositor-panel")
            .test_support()
            .flex()
            .items_center()
            .flex_shrink_0()
            .h(px(40.))
            .px(px(8.))
            .gap(px(4.))
            .bg(rgb(colors.paper_soft))
            .border_b_1()
            .border_color(rgb(colors.rule))
            .child(
                tool_button("save", "Save", Some(TwyneIcon::Save), cx).on_click(cx.listener(
                    |this, _, _, cx| {
                        let _ = this.flush(cx);
                        cx.notify();
                    },
                )),
            )
            .child(
                tool_button("find", "Find", Some(TwyneIcon::Search), cx)
                    .on_click(cx.listener(|this, _, window, cx| this.show_find(window, cx))),
            )
            .child(
                tool_button("read-mode", "Read", Some(TwyneIcon::BookOpen), cx)
                    .on_click(cx.listener(|this, _, _, cx| this.set_reading(true, cx))),
            )
            .child(
                tool_button("duplicate", "Duplicate", Some(TwyneIcon::File), cx)
                    .on_click(cx.listener(|this, _, window, cx| this.duplicate(window, cx))),
            )
            .child(
                tool_button(
                    "archive-draft",
                    "Archive / restore",
                    Some(TwyneIcon::Folder),
                    cx,
                )
                .on_click(cx.listener(|this, _, window, cx| this.archive(window, cx))),
            )
            .into_any_element()
    }

    fn dossier_card(&self, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let colors = *palette(cx);
        let brief = self
            .active_document()
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.brief.as_ref());
        if let Some(brief) = brief {
            let answers = &brief.answers;
            let title = if answers.working_title.trim().is_empty() {
                "Untitled dossier"
            } else {
                answers.working_title.trim()
            };
            let probes = brief.probes.as_deref().unwrap_or_default();
            return div()
                .flex()
                .flex_col()
                .p(px(16.))
                .pt(px(40.))
                .bg(rgb(colors.paper_soft))
                .border_1()
                .border_color(rgb(colors.rule))
                .child(dept_label("Current filed copy", cx))
                .child(
                    div()
                        .mt(px(4.))
                        .font_family(DISPLAY_FONT)
                        .font_weight(FontWeight::BOLD)
                        .text_size(px(16.))
                        .line_height(relative(1.25))
                        .child(title.to_owned()),
                )
                .child(
                    div()
                        .mt(px(4.))
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(10.))
                        .text_color(rgb(colors.ink_muted))
                        .child(
                            chrono::DateTime::from_timestamp_millis(brief.updated_at as i64)
                                .map(|date| {
                                    format!(
                                        "Refiled {}",
                                        date.with_timezone(&chrono::Local)
                                            .format("%b %-d, %-I:%M %p")
                                    )
                                })
                                .unwrap_or_default(),
                        ),
                )
                .child(
                    div().mt(px(16.)).flex().flex_col().gap(px(12.)).children(
                        [
                            ("Format", &answers.format),
                            ("Audience", &answers.audience),
                            ("Goal", &answers.goal),
                            ("Tone", &answers.tone),
                            ("Non-negotiables", &answers.constraints),
                            ("Success signal", &answers.success_signal),
                        ]
                        .into_iter()
                        .map(|(label, value)| {
                            div().flex().flex_col().child(dept_label(label, cx)).child(
                                div()
                                    .mt(px(2.))
                                    .font_family(SERIF_FONT)
                                    .text_size(px(13.))
                                    .line_height(relative(24. / 13.))
                                    .text_color(rgb(colors.ink_light))
                                    .child(value.clone()),
                            )
                        }),
                    ),
                )
                .when(!probes.is_empty(), |this| {
                    this.child(
                        div()
                            .mt(px(16.))
                            .pt(px(12.))
                            .border_t_1()
                            .border_color(rgb(colors.rule))
                            .child(dept_label("Particulars", cx))
                            .children(probes.iter().enumerate().map(|(index, probe)| {
                                let answer = twyne_desktop::dossier::probe_answer_text(probe);
                                let text = if answer.is_empty() {
                                    format!("{}. {} · Awaiting an answer", index + 1, probe.prompt)
                                } else {
                                    format!("{}. {}: {}", index + 1, probe.prompt, answer)
                                };
                                div()
                                    .mt(px(8.))
                                    .font_family(SERIF_FONT)
                                    .text_size(px(11.))
                                    .line_height(relative(20. / 11.))
                                    .text_color(rgb(colors.ink_light))
                                    .child(text)
                            })),
                    )
                })
                .child(
                    div()
                        .mt(px(16.))
                        .pt(px(12.))
                        .border_t_1()
                        .border_color(rgb(colors.rule))
                        .flex()
                        .justify_between()
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(11.))
                        .text_color(rgb(colors.ink_muted))
                        .child(format!(
                            "{} particulars answered",
                            probes
                                .iter()
                                .filter(|probe| twyne_desktop::dossier::is_answered(probe))
                                .count()
                        ))
                        .child(format!("{} references", brief.attachments.len())),
                )
                .child(
                    paper_button("drawer-dossier", "Open filed dossier", None, cx)
                        .mt(px(12.))
                        .w_full()
                        .on_click(cx.listener(|this, _, window, cx| this.open_dossier(window, cx))),
                )
                .into_any_element();
        }
        div().flex().flex_col().p(px(16.)).pt(px(20.))
            .bg(rgb(colors.paper_soft)).border_1().border_color(rgb(colors.rule))
            .shadow(vec![
                gpui_kit::BoxShadow::new(px(0.), px(1.), rgb(colors.emboss).opacity(0.6).into()).inset(),
                gpui_kit::BoxShadow::new(px(0.), px(14.), rgb(colors.shade).opacity(0.4).into())
                    .blur_radius(px(32.)).spread_radius(px(-22.)),
                gpui_kit::BoxShadow::new(px(0.), px(2.), rgb(colors.shade).opacity(0.05).into()),
            ])
            .child(dept_label("The Dossier", cx))
            .child(div().mt(px(8.)).font_family(DISPLAY_FONT).font_weight(FontWeight::SEMIBOLD)
                .text_size(px(16.)).line_height(relative(1.5)).child("No dossier filed."))
            .child(div().mt(px(6.)).font_family(SERIF_FONT).italic().text_size(px(13.))
                .line_height(relative(24. / 13.)).text_color(rgb(colors.ink_light))
                .child("Sit for the interview to seed the draft with context. The room cannot read what hasn't been briefed."))
            .child(press_button("drawer-dossier", "Open the dossier", 11.2, cx).mt(px(16.))
                .flex_shrink_0().self_start()
                .on_click(cx.listener(|this, _, window, cx| this.open_dossier(window, cx))))
            .into_any_element()
    }

    fn drawer_link(
        &self,
        id: &'static str,
        department: &'static str,
        title: &'static str,
        enabled: bool,
        cx: &App,
    ) -> Button {
        let colors = *palette(cx);
        Button::new(id)
            .ghost()
            .w_full()
            .h_auto()
            .px(px(12.))
            .py(px(10.))
            .justify_start()
            .rounded(px(2.))
            .border_1()
            .border_color(rgb(colors.sidebar))
            .disabled(!enabled)
            .accessibility_label(format!("{department}: {title}"))
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .items_start()
                    .child(dept_label(department, cx))
                    .child(
                        div()
                            .font_family(DISPLAY_FONT)
                            .text_size(px(14.))
                            .line_height(px(20.))
                            .whitespace_normal()
                            .text_color(rgb(colors.ink_light))
                            .child(title),
                    ),
            )
    }

    fn library_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *palette(cx);
        let mut visible: Vec<_> = self
            .documents
            .iter()
            .filter(|document| document.archived == self.archive_visible)
            .collect();
        visible.sort_by_key(|document| document.created_at);
        let active_index = visible
            .iter()
            .position(|document| document.id == self.active);
        div()
            .id("drawer")
            .test_support()
            .flex()
            .flex_col()
            .w(px(288.))
            .flex_shrink_0()
            .h_full()
            .min_h_0()
            .bg(rgb(colors.sidebar))
            .border_r_2()
            .border_color(rgb(colors.rule))
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_shrink_0()
                    .mr(px(-2.))
                    .h(px(112.))
                    .px(px(20.))
                    .py(px(16.))
                    .border_b_1()
                    .border_color(rgb(colors.rule))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(assets::icon(TwyneIcon::Folder))
                            .child(dept_label(
                                &active_index.map_or_else(
                                    || "Folio drawer".to_owned(),
                                    |index| format!("Drawer No. {}", folio_numeral(index)),
                                ),
                                cx,
                            )),
                    )
                    .child(
                        div()
                            .mt(px(4.))
                            .font_family(DISPLAY_FONT)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_size(px(24.))
                            .line_height(relative(1.25))
                            .child(self.active_document().display_title().to_owned()),
                    )
                    .child(
                        div()
                            .mt(px(8.))
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .text_size(px(12.))
                            .text_color(rgb(colors.ink_light))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(assets::icon(TwyneIcon::File))
                                    .child(format!(
                                        "{} {}",
                                        visible.len(),
                                        if visible.len() == 1 {
                                            "folio"
                                        } else {
                                            "folios"
                                        }
                                    )),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(assets::icon(TwyneIcon::PenNib))
                                    .child(if self.active_document().archived {
                                        "Read only"
                                    } else {
                                        "Can edit"
                                    }),
                            ),
                    ),
            )
            .child(
                div()
                    .id("drawer-content")
                    .test_support()
                    .flex_1()
                    .mr(px(-2.))
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(16.))
                    .py(px(16.))
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(self.dossier_card(cx))
                    .child(ornament(cx))
                    .child(
                        div()
                            .id("manuscript-list")
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .children(visible.into_iter().enumerate().map(|(index, document)| {
                                let id = document.id;
                                Button::new(SharedString::from(format!("manuscript-{id}")))
                                    .ghost()
                                    .w_full()
                                    .h_auto()
                                    .px(px(12.))
                                    .py(px(10.))
                                    .rounded(px(2.))
                                    .justify_start()
                                    .border_1()
                                    .border_color(if id == self.active {
                                        rgb(colors.rule)
                                    } else {
                                        rgb(colors.sidebar)
                                    })
                                    .when(id == self.active, |this| this.bg(rgb(colors.paper_soft)))
                                    .accessibility_label(document.display_title().to_owned())
                                    .child(
                                        div()
                                            .w_full()
                                            .flex()
                                            .flex_col()
                                            .items_start()
                                            .child(dept_label(
                                                &format!("Folio {}", folio_numeral(index)),
                                                cx,
                                            ))
                                            .child(
                                                div()
                                                    .font_family(SERIF_FONT)
                                                    .text_size(px(14.))
                                                    .line_height(px(20.))
                                                    .whitespace_normal()
                                                    .text_color(rgb(if id == self.active {
                                                        colors.ink
                                                    } else {
                                                        colors.ink_light
                                                    }))
                                                    .child(document.display_title().to_owned()),
                                            ),
                                    )
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.library_route = false;
                                        this.select(id, window, cx);
                                    }))
                            }))
                            .when(!self.new_folio_form, |this| {
                                this.child(
                                    Button::new("new-draft")
                                        .ghost()
                                        .w_full()
                                        .h_auto()
                                        .px(px(12.))
                                        .py(px(8.))
                                        .border_1()
                                        .border_dashed()
                                        .border_color(rgb(colors.rule))
                                        .rounded(px(2.))
                                        .justify_start()
                                        .accessibility_label("New folio")
                                        .child(
                                            div()
                                                .w_full()
                                                .flex()
                                                .flex_col()
                                                .items_start()
                                                .child(dept_label("+", cx))
                                                .child(
                                                    div()
                                                        .font_family(SERIF_FONT)
                                                        .text_size(px(14.))
                                                        .line_height(px(20.))
                                                        .text_color(rgb(colors.ink_muted))
                                                        .child("New folio"),
                                                ),
                                        )
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.open_new_folio_form(window, cx)
                                        })),
                                )
                            })
                            .when(self.new_folio_form, |this| {
                                this.child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(8.))
                                        .child(
                                            div().id("new-folio-name").test_support().child(
                                                Input::new(&self.new_folio_name)
                                                    .font_family(DISPLAY_FONT)
                                                    .text_size(px(14.))
                                                    .aria_label("Folio name"),
                                            ),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .gap(px(8.))
                                                .child(
                                                    press_button("create-folio", "Create", 12., cx)
                                                        .flex_1()
                                                        .on_click(cx.listener(
                                                            |this, _, window, cx| {
                                                                this.create_named_folio(window, cx)
                                                            },
                                                        )),
                                                )
                                                .child(
                                                    paper_button(
                                                        "cancel-folio",
                                                        "Cancel",
                                                        None,
                                                        cx,
                                                    )
                                                    .flex_1()
                                                    .h_auto()
                                                    .py(px(7.2))
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.new_folio_form = false;
                                                        cx.notify();
                                                    })),
                                                ),
                                        ),
                                )
                            }),
                    )
                    .child(ornament(cx))
                    .child(
                        self.drawer_link(
                            "drawer-editors",
                            "Room of Editors",
                            "Manage editorial staff",
                            true,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_cast(CastSurface::Manager, window, cx);
                        })),
                    )
                    .child(
                        self.drawer_link(
                            "drawer-library",
                            "The Library",
                            "All documents",
                            true,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_library(window, cx);
                        })),
                    )
                    .child(
                        self.drawer_link(
                            "drawer-rubric",
                            "Galley Proof",
                            "Full rubric report",
                            true,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_rubric(RubricSurface::Galley, window, cx);
                        })),
                    )
                    .child(
                        self.drawer_link(
                            "drawer-analysis",
                            "The Full Analysis",
                            "Cast analysis report",
                            true,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_cast(CastSurface::Analysis, window, cx);
                        })),
                    )
                    .child(
                        self.drawer_link(
                            "drawer-tools",
                            "Writing tools",
                            "Grammar, revisions, voice, and evidence",
                            true,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_writing_tools(window, cx);
                        })),
                    )
                    .child(
                        self.drawer_link(
                            "drawer-apparatus",
                            "The Apparatus",
                            "Research + bibliography",
                            true,
                            cx,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.open_apparatus(ApparatusSurface::Page, window, cx);
                        })),
                    )
                    .child(self.drawer_link(
                        "drawer-pricing",
                        "Subscription",
                        "Pricing + Pro checkout",
                        false,
                        cx,
                    ))
                    .child(self.drawer_link(
                        "drawer-desk",
                        "My Desk",
                        "Writing activity + AI usage",
                        false,
                        cx,
                    ))
                    .child(
                        self.drawer_link(
                            "drawer-settings",
                            "The Composing Room",
                            "Preferences + models",
                            true,
                            cx,
                        )
                        .on_click(
                            cx.listener(|this, _, window, cx| this.open_settings(window, cx)),
                        ),
                    )
                    .child(ornament(cx))
                    .child(
                        Button::new("archive-list")
                            .ghost()
                            .small()
                            .justify_start()
                            .label(if self.archive_visible {
                                "Show manuscripts"
                            } else {
                                "Open archive"
                            })
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.archive_visible = !this.archive_visible;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("library-folder")
                            .ghost()
                            .small()
                            .justify_start()
                            .label("Open library folder")
                            .on_click(
                                cx.listener(|this, _, _, cx| cx.reveal_path(this.store.root())),
                            ),
                    ),
            )
    }

    fn notebook_panel(&self, window: &Window, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        if self.active_document().workspace.is_some()
            || self.desk.board_context == BoardContext::Apparatus
        {
            return self.editorial_board_panel(window, cx).into_any_element();
        }
        div()
            .flex()
            .flex_col()
            .id("editorial-board")
            .test_support()
            .w(px(464.))
            .h_full()
            .min_h_0()
            .flex_shrink_0()
            .bg(rgb(palette(cx).paper))
            .border_l_1()
            .border_color(rgb(palette(cx).rule))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_4()
                    .pt_4()
                    .pb_2()
                    .child(div().font_weight(FontWeight::BOLD).child("Notebook"))
                    .child(
                        Button::new("close-notebook")
                            .ghost()
                            .small()
                            .label("Hide")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.desk.board_open = false;
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .px_4()
                    .pb_3()
                    .text_size(px(12.))
                    .text_color(rgb(palette(cx).ink_muted))
                    .child("Your brief and loose thoughts, kept with this manuscript."),
            )
            .child(
                div()
                    .id("notebook-field")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .px_3()
                    .pb_4()
                    .child(
                        Textarea::new(&self.notes)
                            .h(relative(1.))
                            .appearance(false)
                            .bordered(false)
                            .text_size(px(14.))
                            .line_height(relative(1.6))
                            .readonly(
                                self.active_document().archived
                                    || self.active_document().workspace.is_some(),
                            )
                            .aria_label("Manuscript notebook"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .p_4()
                    .gap_2()
                    .border_t_1()
                    .border_color(rgb(palette(cx).rule))
                    .text_color(rgb(palette(cx).ink_muted))
                    .text_size(px(12.))
                    .child(format!("{} words", self.statistics.words))
                    .child(format!("{} paragraphs", self.statistics.paragraphs))
                    .child(format!("{} characters", self.statistics.characters))
                    .child(format!("{} min read", self.statistics.reading_minutes))
                    .child(
                        Button::new("export-native")
                            .small()
                            .label("Export with notebook")
                            .tooltip("Save a portable .twyne document")
                            .on_click(
                                cx.listener(|this, _, window, cx| this.export(true, window, cx)),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn manuscript_panel(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let archived = self.active_document().archived;
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .h_full()
            .min_h_0()
            .bg(rgb(palette(cx).page))
            .child(self.desk_controls(window, cx))
            .when(
                self.desk.compositor_visible() && !self.proof_mode && !self.source_mode,
                |this| {
                    this.child(self.flow_chrome(
                        flow_coordinator::RoomPart::Compositor,
                        self.compositor_panel(cx).into_any_element(),
                        cx,
                    ))
                },
            )
            .when(self.find_visible, |this| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_5()
                        .py_2()
                        .bg(rgb(palette(cx).paper))
                        .border_b_1()
                        .border_color(rgb(palette(cx).rule))
                        .child(
                            div().flex_1().min_w_0().child(
                                Input::new(&self.find)
                                    .small()
                                    .aria_label("Find in manuscript"),
                            ),
                        )
                        .child(Button::new("find-next").small().label("Next").on_click(
                            cx.listener(|this, _, window, cx| this.find_next(window, cx)),
                        ))
                        .child(
                            div()
                                .text_size(px(12.))
                                .text_color(rgb(palette(cx).ink_muted))
                                .child(self.find_status.clone()),
                        )
                        .child(
                            Button::new("close-find")
                                .ghost()
                                .small()
                                .label("Close")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.find_visible = false;
                                    this.focus_writing(window, cx);
                                    cx.notify();
                                })),
                        ),
                )
            })
            .when(archived, |this| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .px_5()
                        .py_2()
                        .bg(rgb(palette(cx).sidebar))
                        .child("This manuscript is archived.")
                        .child(
                            Button::new("restore-draft")
                                .small()
                                .label("Restore manuscript")
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.archive(window, cx)),
                                ),
                        ),
                )
            })
            .when(self.split_view, |this| {
                this.child(
                    div()
                        .flex()
                        .flex_1()
                        .min_h_0()
                        .min_w_0()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .w(relative(0.5))
                                .min_w_0()
                                .h_full()
                                .border_r_1()
                                .border_color(rgb(palette(cx).rule))
                                .when(self.source_mode, |this| this.child(self.source_panel(cx)))
                                .when(!self.source_mode, |this| {
                                    this.child(self.writing_panel(window, cx))
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .h_full()
                                .child(self.proof_panel(cx)),
                        ),
                )
            })
            .when(self.proof_mode && !self.split_view, |this| {
                this.child(self.proof_panel(cx))
            })
            .when(
                self.source_mode && !self.proof_mode && !self.split_view,
                |this| this.child(self.source_panel(cx)),
            )
            .when(
                !self.source_mode && !self.proof_mode && !self.split_view,
                |this| this.child(self.writing_panel(window, cx)),
            )
            .child(self.status_bar(window, cx))
    }

    fn writing_panel(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(editor) = &self.rich {
            return self.rich_page(editor, window, cx);
        }
        let readonly =
            self.active_document().archived || self.active_document().workspace.is_some();
        let layout = self
            .compositor
            .as_ref()
            .map(|view| &view.read(cx).layout)
            .or_else(|| {
                self.active_document()
                    .workspace
                    .as_deref()
                    .and_then(|workspace| workspace.folio.layout.as_ref())
            });
        let margins = layout.map(LayoutSettings::resolve_margins);
        let horizontal_padding = if self.desk.zen {
            (f32::from(window.viewport_size().width) * 0.03).clamp(16., 48.)
        } else {
            margins.map_or(32., |margins| margins.left as f32 * 16.)
        };
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            .max_w(px(if self.desk.zen {
                1184.
            } else {
                layout.map_or(768., |layout| layout.width_rem() as f32 * 16.)
            }))
            .mx_auto()
            .pl(px(horizontal_padding))
            .pr(px(if self.desk.zen {
                horizontal_padding
            } else {
                margins.map_or(32., |margins| margins.right as f32 * 16.)
            }))
            .when(self.rich.is_some(), |this| {
                this.pt(px(if self.desk.zen { 20. } else { 16. }))
                    .pb(px(if self.desk.zen { 48. } else { 16. }))
            })
            .when_some(self.rich.as_ref(), |this, view| {
                this.child(
                    div()
                        .id("body-field")
                        .test_support()
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .track_scroll(&self.writing_scroll)
                        .child(view.clone()),
                )
            })
            .when(self.rich.is_none(), |this| {
                this.child(self.prototype_manuscript_page(readonly, cx))
            })
            .into_any_element()
    }

    fn source_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *palette(cx);
        let pending = self
            .source_session
            .as_ref()
            .is_some_and(|session| session.pending);
        let conflict = self
            .source_session
            .as_ref()
            .is_some_and(|session| session.conflict);
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            .when(self.desk.compositor_visible(), |this| {
                this.child(self.source_ribbon(cx))
            })
            .when(self.source_go_to_line, |this| {
                this.child(self.source_line_prompt(cx))
            })
            .when(pending || conflict, |this| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .min_h(px(42.))
                        .flex_shrink_0()
                        .px(px(12.))
                        .bg(rgb(colors.paper_soft))
                        .border_b_1()
                        .border_color(rgb(colors.rule))
                        .text_size(px(12.))
                        .text_color(rgb(colors.ink_muted))
                        .child(if conflict {
                            "A newer manuscript exists · source draft preserved"
                        } else if pending {
                            "Source draft · saved separately from the manuscript"
                        } else {
                            "Typst source"
                        })
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(
                                    tool_button("apply-source", "Apply", None, cx)
                                        .disabled(
                                            !pending
                                                || conflict
                                                || self.applying_source
                                                || self.active_document().archived,
                                        )
                                        .bg(rgb(colors.vermilion))
                                        .text_color(rgb(colors.paper_soft))
                                        .accessibility_label("Apply source")
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.request_proof(true, window, cx)
                                        })),
                                )
                                .child(
                                    tool_button("discard-source", "Discard", None, cx)
                                        .disabled(!pending || self.applying_source)
                                        .accessibility_label("Discard source changes")
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.discard_source(window, cx)
                                        })),
                                ),
                        ),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(twyne_desktop::source_view::SOURCE_HEADING_HEIGHT_PX))
                    .flex_shrink_0()
                    .px(px(14.))
                    .border_b_1()
                    .border_color(rgb(colors.rule))
                    .text_size(px(11.))
                    .text_color(rgb(colors.ink_light))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.4))
                            .min_w_0()
                            .child(assets::icon(TwyneIcon::CodeFile).with_size(px(15.)))
                            .child(format!("{}.typ", self.active_document().title)),
                    )
                    .child(if self.active_document().archived {
                        "Read only"
                    } else {
                        "Typst"
                    }),
            )
            .child(
                div()
                    .id("source-field")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .key_context("TwyneSource")
                    .child(
                        SourceEditorView::new(&self.source)
                            .readonly(self.active_document().archived || self.applying_source),
                    ),
            )
    }

    fn proof_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *palette(cx);
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(40.))
                    .flex_shrink_0()
                    .px(px(12.))
                    .bg(rgb(colors.paper_soft))
                    .border_b_1()
                    .border_color(rgb(colors.rule))
                    .text_size(px(12.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(assets::icon(TwyneIcon::BookOpen))
                            .child("Typeset proof")
                            .child(
                                tool_button("proof-zoom-out", "−", None, cx)
                                    .accessibility_label("Zoom out")
                                    .disabled(self.proof_zoom <= 50)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.proof_zoom =
                                            this.proof_zoom.saturating_sub(25).max(50);
                                        cx.notify();
                                    })),
                            )
                            .child(
                                div()
                                    .font_family(MONO_FONT)
                                    .text_size(px(11.))
                                    .child(format!("{}%", self.proof_zoom)),
                            )
                            .child(
                                tool_button("proof-zoom-in", "+", None, cx)
                                    .accessibility_label("Zoom in")
                                    .disabled(self.proof_zoom >= 200)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.proof_zoom =
                                            this.proof_zoom.saturating_add(25).min(200);
                                        cx.notify();
                                    })),
                            )
                            .child(
                                tool_button("proof-fit", "Fit", Some(TwyneIcon::Fullscreen), cx)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.proof_zoom = 100;
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(
                        tool_button("download-pdf", "Download PDF", Some(TwyneIcon::Save), cx)
                            .disabled(self.proof.is_none())
                            .on_click(
                                cx.listener(|this, _, window, cx| this.export_pdf(window, cx)),
                            ),
                    ),
            )
            .child(
                div()
                    .id("typeset-pages")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .overflow_x_scroll()
                    .track_scroll(&self.proof_scroll)
                    .px(px(12.))
                    .pt(px(8.))
                    .pb(px(14.))
                    .bg(rgb(colors.page))
                    .when(self.proof_images.is_empty(), |this| {
                        this.child(
                            div()
                                .font_family(SERIF_FONT)
                                .text_size(px(16.))
                                .child(self.proof_status.clone()),
                        )
                    })
                    .children(self.proof_images.iter().enumerate().map(|(index, image)| {
                        let page = &self.proof.as_ref().unwrap().pages[index];
                        div()
                            .id(("proof-page", index))
                            .test_support()
                            .mb(px(16.))
                            .mx_auto()
                            .w(relative(if self.proof_mode {
                                f32::from(self.proof_zoom) / 100.
                            } else {
                                1.
                            }))
                            .max_w(px(864.
                                * if self.proof_mode {
                                    f32::from(self.proof_zoom) / 100.
                                } else {
                                    1.
                                }))
                            .child(
                                img(image.clone())
                                    .w_full()
                                    .aspect_ratio((page.width_pt / page.height_pt) as f32),
                            )
                            .child(
                                div()
                                    .text_center()
                                    .text_size(px(11.))
                                    .text_color(rgb(colors.ink_light))
                                    .p(px(10.))
                                    .child(format!(
                                        "Page {} of {}",
                                        index + 1,
                                        self.proof_images.len()
                                    )),
                            )
                    })),
            )
    }

    fn request_pdf(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.applying_source {
            return;
        }
        self.pdf_requested = true;
        if let Some(view) = &self.compositor {
            view.update(cx, |view, cx| view.set_preparing_pdf(true, cx));
        }
        self.request_proof(false, window, cx);
        if !self.pdf_requested
            && let Some(view) = &self.compositor
        {
            view.update(cx, |view, cx| view.set_preparing_pdf(false, cx));
        }
    }

    fn export_pdf(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(proof) = &self.proof else {
            return;
        };
        let proof = proof.clone();
        let name = format!("{}.pdf", export_filename(&self.active_document().title));
        let picker = cx.prompt_for_new_path(self.store.root(), Some(&name));
        cx.spawn_in(window, async move |this, cx| {
            let Ok(Ok(Some(path))) = picker.await else {
                return;
            };
            let result = cx
                .background_executor()
                .spawn(async move {
                    let result = export_bytes(&path, &proof.pdf);
                    (path, result)
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                match result {
                    (path, Ok(())) => this.notice = Some(format!("Exported {}", path.display())),
                    (_, Err(error)) => {
                        this.error = Some(format!("Could not export PDF: {error:#}"))
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
}

fn opening_initial(settings: &OpeningInitialSettings) -> OpeningInitial {
    OpeningInitial {
        mode: match settings.mode {
            OpeningInitialMode::Off => InitialMode::Off,
            OpeningInitialMode::Plain => InitialMode::Plain,
            OpeningInitialMode::Illuminated => InitialMode::Illuminated,
        },
        alternate: settings.collection == OpeningInitialCollection::Alternate,
        size: match settings.size {
            OpeningInitialSize::Small => 54.0,
            OpeningInitialSize::Medium => 75.6,
            OpeningInitialSize::Large => 99.0,
        },
    }
}

pub fn bind_keys(cx: &mut App) {
    margin_composer::init(cx);
    twyne_desktop::rubric_view::init(cx);
    twyne_desktop::apparatus_view::init(cx);
    cx.bind_keys([
        KeyBinding::new("down", NextProofPage, Some("TwynePageSelector")),
        KeyBinding::new("right", NextProofPage, Some("TwynePageSelector")),
        KeyBinding::new("up", PreviousProofPage, Some("TwynePageSelector")),
        KeyBinding::new("left", PreviousProofPage, Some("TwynePageSelector")),
        KeyBinding::new("home", FirstProofPage, Some("TwynePageSelector")),
        KeyBinding::new("end", LastProofPage, Some("TwynePageSelector")),
        KeyBinding::new("pagedown", ForwardProofPages, Some("TwynePageSelector")),
        KeyBinding::new("pageup", BackwardProofPages, Some("TwynePageSelector")),
        KeyBinding::new("space", PageSelectorSpace, Some("TwynePageSelector")),
    ]);
    // CodeMirror's Linux history map supports both Ctrl+Y and Ctrl+Shift+Z.
    // Keep this alias local to Source so other native inputs retain their maps.
    #[cfg(target_os = "linux")]
    cx.bind_keys([KeyBinding::new(
        "ctrl-shift-z",
        gpui_kit::base::input::Redo,
        Some("TwyneSource"),
    )]);
    let modifier = if cfg!(target_os = "macos") {
        "cmd"
    } else {
        "ctrl"
    };
    cx.bind_keys([
        KeyBinding::new(&format!("{modifier}-n"), NewDraft, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-o"), ImportDraft, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-shift-e"), ExportDraft, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-s"), SaveDraft, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-shift-f"), ToggleFocus, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-shift-l"), ToggleLibrary, Some("Twyne")),
        KeyBinding::new(
            &format!("{modifier}-shift-m"),
            ToggleNotebook,
            Some("Twyne"),
        ),
        KeyBinding::new(&format!("{modifier}-f"), FindInDraft, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-g"), FindNext, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-1"), WriteMode, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-2"), ReadMode, Some("Twyne")),
        KeyBinding::new(&format!("{modifier}-q"), Quit, Some("Twyne")),
        KeyBinding::new("escape", CloseCompositor, Some("Twyne")),
        KeyBinding::new("alt-g", SourceGoToLine, Some("TwyneSource")),
        KeyBinding::new(&format!("{modifier}-/"), SourceComment, Some("TwyneSource")),
        KeyBinding::new(
            &format!("{modifier}-enter"),
            ApplySource,
            Some("TwyneSource"),
        ),
    ]);
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests;
