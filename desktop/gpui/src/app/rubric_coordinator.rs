use super::*;
use twyne_desktop::{
    rubric::{RubricRecord, RubricRequest, RubricStore},
    rubric_view::{
        RubricCapabilities, RubricEvent, RubricFreshness, RubricSurface, RubricView,
        RubricViewContext,
    },
    semantic_bridge::SemanticBridge,
};

/// Accepted editorial artifacts stay separate from manuscript source. The
/// existing library Store owns the OS lock for this metadata writer as well.
pub(super) struct RubricState {
    pub(super) store: Option<RubricStore>,
    pub(super) record: Arc<RubricRecord>,
    pub(super) pending: Option<RubricRequest>,
    pub(super) view: Option<Entity<RubricView>>,
    pub(super) subscription: Option<Subscription>,
    pub(super) scope: Option<String>,
    pub(super) route: bool,
    pub(super) boundary_error: Option<String>,
    context: RubricViewContext,
    context_generation: u64,
    context_task: Option<Task<()>>,
}

impl RubricState {
    pub(super) fn load(library: &Store) -> (Self, Vec<String>) {
        let (store, record, warnings) = match RubricStore::open(library.root()).and_then(|store| {
            let loaded = store.load()?;
            Ok((store, loaded))
        }) {
            Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
            Err(error) => (
                None,
                Arc::new(RubricRecord::default()),
                vec![format!("The Galley Proof could not be opened: {error:#}")],
            ),
        };
        (
            Self {
                store,
                record,
                pending: None,
                view: None,
                subscription: None,
                scope: None,
                route: false,
                boundary_error: None,
                context: RubricViewContext::default(),
                context_generation: 0,
                context_task: None,
            },
            warnings,
        )
    }
}

/// This runs only on the background executor at an opening or settled-save
/// boundary. The original helper supplies projection/fingerprint arithmetic;
/// neither measured static features nor room explanation creates a grade.
fn prepare_context(
    document: Manuscript,
    record: Arc<RubricRecord>,
    scope: &str,
) -> anyhow::Result<RubricViewContext> {
    let bridge = SemanticBridge::discover()?;
    let html = match document.workspace.as_deref() {
        Some(workspace) => std::borrow::Cow::Borrowed(workspace.content.html.as_str()),
        None => std::borrow::Cow::Owned(bridge.from_markdown(&document.body)?.html),
    };
    let draft = bridge.rubric_draft_context(&html)?;
    let display = record.display(scope)?;
    let result = display.result.value.as_ref();
    let freshness = result.map_or(RubricFreshness::Unknown, |result| {
        if result.draft_fingerprint.as_ref() == Some(&draft.fingerprint) {
            RubricFreshness::Fresh
        } else {
            RubricFreshness::Stale
        }
    });
    let room_parts = result
        .filter(|result| {
            result
                .scoring_method
                .as_ref()
                .is_none_or(|method| method.as_str() != "judgement")
        })
        .and_then(|result| {
            let judges = serde_json::to_value(&result.judges).ok()?;
            let static_score = serde_json::to_value(&result.static_score).ok()?;
            let brief = document
                .workspace
                .as_deref()
                .and_then(|workspace| workspace.brief.as_ref())
                .and_then(|brief| serde_json::to_value(brief).ok());
            bridge
                .rubric_room_parts(
                    &judges,
                    &static_score,
                    brief.as_ref(),
                    result.target_fit.as_ref().copied(),
                )
                .ok()
        });
    Ok(RubricViewContext {
        freshness,
        draft_word_count: Some(draft.word_count),
        minimum_words: draft.min_words,
        result_filed_label: result
            .and_then(|result| bridge.local_timestamp_ms(result.timestamp).ok())
            .map(|date| date.label),
        live_review_filed_label: display
            .live_review
            .value
            .as_ref()
            .and_then(|review| bridge.local_timestamp_ms(review.at).ok())
            .map(|date| date.label),
        live_review_status: None,
        room_parts,
    })
}

impl WritingRoom {
    fn rubric_capabilities(&self) -> RubricCapabilities {
        RubricCapabilities {
            persist: self.rubric.store.is_some(),
            refine_dossier: !self.active_document().archived,
            tools: self.rich.is_some()
                && !self.active_document().archived
                && self
                    .source_session
                    .as_ref()
                    .is_none_or(|session| !session.pending),
            ..RubricCapabilities::default()
        }
    }

    pub(super) fn sync_rubric_surface(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let desired = if self.rubric.route {
            RubricSurface::Galley
        } else {
            RubricSurface::Board
        };
        if let Some(view) = &self.rubric.view
            && view.read(cx).surface() != desired
        {
            view.update(cx, |view, cx| view.set_surface(desired, window, cx));
        }
    }

    pub(super) fn ensure_rubric(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let scope = Some(self.marginalia_folio_id());
        let capabilities = self.rubric_capabilities();
        let context = RubricViewContext::default();
        if let Some(view) = &self.rubric.view {
            anyhow::ensure!(
                view.update(cx, |view, cx| view.set_scope(
                    scope.clone(),
                    context.clone(),
                    window,
                    cx
                )),
                "File the held Rubric change before opening another folio."
            );
            view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
        } else {
            let record = self.rubric.record.clone();
            let view = cx.new(|cx| {
                RubricView::new(
                    record,
                    scope.clone(),
                    context.clone(),
                    capabilities,
                    window,
                    cx,
                )
            });
            self.rubric.subscription = Some(cx.subscribe_in(
                &view,
                window,
                |this, _, event, window, cx| this.rubric_event(event.clone(), window, cx),
            ));
            self.rubric.view = Some(view);
        }
        self.rubric.scope = scope;
        self.rubric.context = context;
        self.refresh_rubric_context(cx);
        Ok(())
    }

    pub(super) fn refresh_rubric_context(&mut self, cx: &mut Context<Self>) {
        let (Some(scope), Some(view_id)) = (
            self.rubric.scope.clone(),
            self.rubric.view.as_ref().map(Entity::entity_id),
        ) else {
            return;
        };
        if scope != self.marginalia_folio_id() {
            return;
        }
        if self.rubric_draft_unsettled(cx) {
            self.invalidate_rubric_context(cx);
            return;
        }
        self.rubric.context_generation = self.rubric.context_generation.saturating_add(1);
        let generation = self.rubric.context_generation;
        let document = self.active_document().clone();
        let native_id = document.id;
        let revision = document.revision;
        let record = self.rubric.record.clone();
        let metadata_generation = record.generation;
        self.rubric.context_task = Some(cx.spawn(async move |this, cx| {
            let prepared_scope = scope.clone();
            let result = cx.background_executor().spawn(async move {
                prepare_context(document, record, &prepared_scope)
            }).await;
            let _ = this.update(cx, |this, cx| {
                if this.active != native_id || this.active_document().revision != revision
                    || this.rubric_draft_unsettled(cx)
                    || this.rubric.context_generation != generation
                    || this.rubric.record.generation != metadata_generation
                    || this.rubric.scope.as_ref() != Some(&scope)
                    || this.rubric.view.as_ref().map(Entity::entity_id) != Some(view_id) { return; }
                this.rubric.context_task = None;
                match result {
                    Ok(context) => {
                        this.rubric.context = context.clone();
                        if let Some(view) = &this.rubric.view {
                            view.update(cx, |view, cx| view.set_context(context, cx));
                        }
                    }
                    Err(error) => {
                        this.notice = Some(format!("The saved Rubric is retained, but its draft context could not be read: {error:#}"));
                    }
                }
                cx.notify();
            });
        }));
    }

    fn rubric_draft_unsettled(&self, cx: &App) -> bool {
        self.dirty
            || self
                .rich
                .as_ref()
                .is_some_and(|editor| editor.read(cx).revision() != self.rich_saved_revision)
    }

    /// An edit invalidates a completed reading with constant work. Exact text
    /// projection runs after the existing quiet-period save, never per key.
    pub(super) fn invalidate_rubric_context(&mut self, cx: &mut Context<Self>) {
        if self.rubric.view.is_none() {
            return;
        }
        self.rubric.context_generation = self.rubric.context_generation.saturating_add(1);
        self.rubric.context_task = None;
        if self.rubric.context.freshness != RubricFreshness::Unknown {
            self.rubric.context.freshness = RubricFreshness::Unknown;
            if let Some(view) = &self.rubric.view {
                let context = self.rubric.context.clone();
                view.update(cx, |view, cx| view.set_context(context, cx));
            }
        }
    }

    pub(super) fn open_rubric(
        &mut self,
        surface: RubricSurface,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if (surface == RubricSurface::Board && self.dossier.is_some())
            || self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        if let Err(error) = self.ensure_rubric(window, cx) {
            self.error = Some(format!("The Galley Proof could not be opened: {error:#}"));
            cx.notify();
            return;
        }
        let view = self.rubric.view.clone().unwrap();
        view.update(cx, |view, cx| view.set_surface(surface, window, cx));
        self.rubric.route = surface == RubricSurface::Galley;
        if surface == RubricSurface::Galley {
            self.retire_math_source_visit(cx);
        }
        self.cast.route = None;
        self.house_route = false;
        self.library_route = false;
        self.settings_route = false;
        self.dossier = None;
        self.dossier_subscription = None;
        self.find_visible = false;
        self.new_folio_form = false;
        self.source_go_to_line = false;
        if surface == RubricSurface::Board {
            self.desk.open_linked_panel(BoardContext::Rubric);
        } else {
            window.focus(&view.read(cx).focus_handle(cx), cx);
        }
        cx.notify();
    }

    fn rubric_event(&mut self, event: RubricEvent, window: &mut Window, cx: &mut Context<Self>) {
        if let RubricEvent::SaveRequested(request) = event {
            self.request_rubric_save(request, window, cx);
            return;
        }
        if matches!(event, RubricEvent::Filed { .. }) {
            return;
        }
        let visible = self.rubric.route
            || (!self.standalone_route()
                && self.desk.board_open
                && self.desk.board_context == BoardContext::Rubric);
        if !visible {
            return;
        }
        match event {
            RubricEvent::SurfaceRequested(surface) => self.open_rubric(surface, window, cx),
            RubricEvent::BackToDesk
                if self.flush_apparatus(window, cx).is_ok()
                    && self.flush_rubric(window, cx).is_ok()
                    && self.flush(cx).is_ok() =>
            {
                self.rubric.route = false;
                self.apparatus.route = false;
                self.focus_writing(window, cx);
                cx.notify();
            }
            RubricEvent::RefineDossierRequested { folio_id }
                if self.rubric.scope.as_deref() == Some(&folio_id)
                    && self.rubric_capabilities().refine_dossier =>
            {
                self.open_dossier(window, cx);
            }
            RubricEvent::OpenToolRequested { folio_id, tool, .. }
                if self.rubric.scope.as_deref() == Some(&folio_id)
                    && self.rubric_capabilities().tools =>
            {
                if let Some(kind) = twyne_desktop::gen_ui::seed::ToolKind::from_id(&tool) {
                    let hint = self
                        .rubric
                        .record
                        .display(&folio_id)
                        .ok()
                        .and_then(|display| {
                            display.live_review.value.as_ref().and_then(|review| {
                                review
                                    .passages
                                    .iter()
                                    .filter(|passage| {
                                        passage.kind != twyne_desktop::rubric::PassageKind::Nothing
                                    })
                                    .reduce(|first, next| {
                                        if next.priority > first.priority {
                                            next
                                        } else {
                                            first
                                        }
                                    })
                                    .map(|passage| passage.passage.text.clone())
                            })
                        });
                    self.open_native_tool(kind, hint.as_deref(), window, cx);
                }
            }
            // These remain capability-gated until their real provider/tool or
            // guide adapters exist. Local arithmetic is never a new reading.
            _ => {}
        }
    }

    pub(super) fn rubric_page(&self, cx: &Context<Self>) -> gpui_kit::AnyElement {
        div()
            .id("native-rubric")
            .test_support()
            .size_full()
            .min_h_0()
            .bg(rgb(palette(cx).paper_soft))
            .when_some(self.rubric.view.clone(), |page, view| page.child(view))
            .into_any_element()
    }

    fn request_rubric_save(
        &mut self,
        request: RubricRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self.rubric.view.clone() else {
            return;
        };
        if self.rubric.pending.is_some() || view.read(cx).pending_request() != Some(&request) {
            return;
        }
        let Some(store) = self.rubric.store.clone() else {
            self.rubric.boundary_error =
                Some("The Galley Proof is unavailable on this device.".into());
            view.update(cx, |view, cx| {
                view.report_error(
                    request.request_id,
                    "The Galley Proof is unavailable on this device.",
                    cx,
                );
            });
            return;
        };
        self.rubric.pending = Some(request.clone());
        let keep_library_lock = self.store.clone();
        let view_id = view.entity_id();
        cx.spawn_in(window, async move |this, cx| {
            let saved_request = request.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _keep_library_lock = keep_library_lock;
                    store.save_request(&saved_request)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.rubric.pending.as_ref() != Some(&request)
                    || this.rubric.view.as_ref().map(Entity::entity_id) != Some(view_id)
                {
                    return;
                }
                this.rubric.pending = None;
                match result {
                    Ok(record) => {
                        this.ack_rubric(request.request_id, record, window, cx);
                    }
                    Err(error) => {
                        this.rubric.boundary_error =
                            Some(format!("Your Rubric change is kept: {error:#}"));
                        if let Some(view) = &this.rubric.view {
                            view.update(cx, |view, cx| {
                                view.report_error(
                                    request.request_id,
                                    format!("Could not file this change: {error:#}"),
                                    cx,
                                );
                            });
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn ack_rubric(
        &mut self,
        id: Uuid,
        record: Arc<RubricRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let accepted = self.rubric.view.as_ref().is_some_and(|view| {
            view.update(cx, |view, cx| {
                view.ack_saved(id, record.clone(), window, cx)
            })
        });
        if accepted {
            self.rubric.record = record;
            self.rubric.boundary_error = None;
            self.refresh_rubric_context(cx);
        }
        accepted
    }

    pub(super) fn flush_rubric(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let Some(view) = self.rubric.view.clone() else {
            return Ok(());
        };
        let prepared = view.update(cx, |view, cx| view.prepare_pending_edits(cx));
        let Some(request) = prepared.inspect_err(|error| {
            self.rubric.boundary_error = Some(format!("Your Rubric change is kept: {error:#}"));
            cx.notify();
        })?
        else {
            return Ok(());
        };
        let result = self
            .rubric
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Galley Proof is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        self.rubric.pending = None;
        match result {
            Ok(record) => {
                anyhow::ensure!(
                    self.ack_rubric(request.request_id, record, window, cx),
                    "The held Rubric change could not be acknowledged."
                );
                Ok(())
            }
            Err(error) => {
                self.rubric.boundary_error = Some(format!("Your Rubric change is kept: {error:#}"));
                view.update(cx, |view, cx| {
                    view.report_error(
                        request.request_id,
                        format!("Could not file this change: {error:#}"),
                        cx,
                    );
                });
                cx.notify();
                Err(error)
            }
        }
    }

    pub(super) fn flush_rubric_on_shutdown(
        &mut self,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let Some(view) = self.rubric.view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        let result = self
            .rubric
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Galley Proof is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        self.rubric.pending = None;
        match result {
            Ok(record) => {
                self.rubric.record = record;
                Ok(())
            }
            Err(error) => {
                view.update(cx, |view, cx| {
                    view.report_error(
                        request.request_id,
                        format!("Could not file before closing: {error:#}"),
                        cx,
                    );
                });
                Err(error)
            }
        }
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, TestAppContext, test::TestWindowExt};
    use tempfile::TempDir;
    use twyne_desktop::rubric::{RubricEdit, parse_rubric_json};

    fn rubric_room(
        cx: &mut TestAppContext,
    ) -> (
        AnyWindowHandle,
        Entity<WritingRoom>,
        Arc<Store>,
        TempDir,
        String,
    ) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = "<h1>The notebook</h1><p>The retained argument.</p>";
        let path = store.root().join("The notebook.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let scope = document.workspace.as_deref().unwrap().folio.id.clone();
        let mut record =
            parse_rubric_json(include_bytes!("../../fixtures/rubric/retained-native.json"))
                .unwrap();
        let artifacts = record.folios.remove("original/path/folio:café").unwrap();
        record.folios.insert(scope.clone(), artifacts);
        let metadata = RubricStore::open(store.root()).unwrap();
        std::fs::write(metadata.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.rubric = RubricState::load(&store).0;
                room.desk.set_zen(false, false);
                room.open_rubric(RubricSurface::Board, window, cx);
            });
            window.render_frame(cx);
            assert!(window.find("rubric-root").visible());
        })
        .unwrap();
        (handle, room, store, directory, scope)
    }

    #[test]
    fn context_uses_original_text_fingerprint_without_aliases_or_static_grades() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("Context.html");
        let html = "<h1>The notebook</h1><p>The retained argument.</p>";
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let scope = document.workspace.as_deref().unwrap().folio.id.clone();
        let mut record =
            parse_rubric_json(include_bytes!("../../fixtures/rubric/retained-native.json"))
                .unwrap();
        let mut artifacts = record.folios.remove("original/path/folio:café").unwrap();
        let bridge = SemanticBridge::discover().unwrap();
        let draft = bridge.rubric_draft_context(html).unwrap();
        let result = artifacts.result.as_ref().unwrap().clone();
        let mut result = result.as_object().unwrap().clone();
        result.insert(
            "draftFingerprint".into(),
            serde_json::Value::String(draft.fingerprint),
        );
        artifacts.result =
            twyne_desktop::exchange::OptionalField::Value(serde_json::Value::Object(result));
        record.folios.insert(scope.clone(), artifacts);
        let record = Arc::new(record);
        let initial = prepare_context(document.clone(), record.clone(), &scope).unwrap();
        assert_eq!(initial.freshness, RubricFreshness::Fresh);
        assert_eq!(
            (initial.draft_word_count, initial.minimum_words),
            (Some(5), 500)
        );
        assert!(initial.room_parts.is_none());
        let formatting = twyne_desktop::document_edit::apply_html(
            document.clone(),
            "<h1>The notebook</h1><p><strong>The retained argument.</strong></p>",
        )
        .unwrap();
        assert_eq!(
            prepare_context(formatting, record.clone(), &scope)
                .unwrap()
                .freshness,
            RubricFreshness::Fresh
        );
        let changed = twyne_desktop::document_edit::apply_html(
            document.clone(),
            "<h1>The notebook</h1><p>The revised argument.</p>",
        )
        .unwrap();
        assert_eq!(
            prepare_context(changed, record.clone(), &scope)
                .unwrap()
                .freshness,
            RubricFreshness::Stale
        );
        assert_eq!(
            prepare_context(document, record.clone(), "row-alias-is-not-scope")
                .unwrap()
                .freshness,
            RubricFreshness::Unknown
        );
        assert_eq!(
            record
                .display(&scope)
                .unwrap()
                .result
                .value
                .unwrap()
                .overall_score,
            65.
        );
    }

    #[gpui_kit::test]
    fn one_rubric_view_retains_scope_and_grade_through_board_report_and_shutdown(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = rubric_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let view = room.rubric.view.clone().unwrap();
                let manuscript = std::fs::read(store.document_path(room.active)).unwrap();
                let before = room.rubric.record.clone();
                let request = view
                    .update(cx, |view, cx| {
                        view.request_edit(
                            RubricEdit::SetWeight {
                                folio_id: scope.clone(),
                                id: "thesis".into(),
                                weight: 2.,
                            },
                            window,
                            cx,
                        )
                    })
                    .unwrap()
                    .unwrap();
                room.open_rubric(RubricSurface::Galley, window, cx);
                assert!(room.rubric.route);
                assert!(room.standalone_route());
                assert_eq!(
                    view.entity_id(),
                    room.rubric.view.as_ref().unwrap().entity_id()
                );
                assert_eq!(view.read(cx).surface(), RubricSurface::Galley);
                assert!(view.read(cx).pending_request().is_none());
                assert_eq!(room.rubric.record, request.candidate);
                room.open_rubric(RubricSurface::Board, window, cx);
                assert!(!room.rubric.route);
                assert_eq!(room.desk.board_context, BoardContext::Rubric);
                assert!(room.desk.board_open);
                assert_eq!(
                    view.entity_id(),
                    room.rubric.view.as_ref().unwrap().entity_id()
                );
                assert_eq!(view.read(cx).active_folio_id(), Some(scope.as_str()));
                room.flush_on_shutdown(cx).unwrap();
                assert_eq!(
                    room.rubric.record.folios[&scope].result,
                    before.folios[&scope].result
                );
                assert_eq!(
                    room.rubric.record.folios[&scope].history,
                    before.folios[&scope].history
                );
                assert_eq!(
                    room.rubric.record.folios[&scope].live_review,
                    before.folios[&scope].live_review
                );
                assert_eq!(
                    room.rubric.record.folios["unmounted/foreign"],
                    before.folios["unmounted/foreign"]
                );
                assert_eq!(room.rubric.record.legacy, before.legacy);
                assert_eq!(
                    std::fs::read(store.document_path(room.active)).unwrap(),
                    manuscript
                );
            });
        })
        .unwrap();
        cx.run_until_parked();
        let record = RubricStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        let display = record.display(&scope).unwrap();
        assert_eq!(
            display
                .criteria
                .iter()
                .find(|criterion| criterion.id == "thesis")
                .unwrap()
                .weight,
            2.
        );
        assert_eq!(display.result.value.unwrap().overall_score, 65.);
    }

    #[gpui_kit::test]
    fn rubric_view_follows_selected_folio_without_aliasing_the_prior_result(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = rubric_room(cx);
        let path = store.root().join("Another folio.html");
        let html = "<h1>Another folio</h1><p>A distinct manuscript.</p>";
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let other_scope = document.workspace.as_deref().unwrap().folio.id.clone();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let view = room.rubric.view.clone().unwrap();
                let original_id = room.active;
                let original_result = room.rubric.record.folios[&scope].result.clone();
                view.update(cx, |view, cx| {
                    view.request_edit(
                        RubricEdit::SetWeight {
                            folio_id: scope.clone(),
                            id: "thesis".into(),
                            weight: 1.75,
                        },
                        window,
                        cx,
                    )
                })
                .unwrap()
                .unwrap();
                assert!(room.add_document(document, window, cx));
                assert_eq!(
                    view.entity_id(),
                    room.rubric.view.as_ref().unwrap().entity_id()
                );
                assert_eq!(room.rubric.scope.as_deref(), Some(other_scope.as_str()));
                assert_eq!(view.read(cx).active_folio_id(), Some(other_scope.as_str()));
                assert_eq!(view.read(cx).display().unwrap().folio_id, other_scope);
                assert!(view.read(cx).display().unwrap().result.value.is_none());
                assert!(
                    view.update(cx, |view, cx| view.request_edit(
                        RubricEdit::ToggleCriterion {
                            folio_id: other_scope.clone(),
                            id: "thesis".into(),
                        },
                        window,
                        cx
                    ))
                    .is_err()
                );
                assert!(!room.rubric.record.folios.contains_key(&other_scope));
                assert_eq!(room.rubric.record.folios[&scope].result, original_result);
                room.select(original_id, window, cx);
                assert_eq!(view.read(cx).active_folio_id(), Some(scope.as_str()));
                assert_eq!(view.read(cx).display().unwrap().folio_id, scope);
                assert_eq!(
                    view.read(cx)
                        .display()
                        .unwrap()
                        .criteria
                        .iter()
                        .find(|criterion| criterion.id == "thesis")
                        .unwrap()
                        .weight,
                    1.75
                );
                assert_eq!(
                    view.read(cx)
                        .display()
                        .unwrap()
                        .result
                        .value
                        .as_ref()
                        .unwrap()
                        .overall_score,
                    65.
                );
                assert!(view.read(cx).pending_request().is_none());
            });
        })
        .unwrap();
        cx.run_until_parked();
    }

    #[gpui_kit::test]
    fn explicit_save_settles_rubric_context_from_the_latest_accepted_manuscript(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _directory, scope) = rubric_room(cx);
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(room.read(cx).rubric.context.draft_word_count, Some(5));
            assert_eq!(
                room.read(cx).rubric.context.freshness,
                RubricFreshness::Stale
            );
        });
        cx.update_window(handle, |_, window, cx| {
            let editor = room.read(cx).rich.clone().unwrap();
            editor.update(cx, |editor, cx| {
                let end = editor.document().text_len();
                editor.set_selection(Selection::new(end, end), cx).unwrap();
                editor
                    .execute(
                        twyne_desktop::editor::Command::InsertText(" More words".into()),
                        window,
                        cx,
                    )
                    .unwrap();
            });
        })
        .unwrap();
        cx.read(|cx| {
            assert!(room.read(cx).dirty);
            assert_eq!(
                room.read(cx).rubric.context.freshness,
                RubricFreshness::Unknown
            );
        });
        cx.update_window(handle, |_, _, cx| {
            room.update(cx, |room, cx| {
                room.flush(cx).unwrap();
                assert!(!room.dirty);
                assert!(room.debounce.is_none());
                assert_eq!(room.rubric.scope.as_deref(), Some(scope.as_str()));
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(room.read(cx).rubric.context.draft_word_count, Some(7));
            assert_eq!(
                room.read(cx).rubric.context.freshness,
                RubricFreshness::Stale
            );
            assert_eq!(
                room.read(cx)
                    .rubric
                    .record
                    .display(&scope)
                    .unwrap()
                    .result
                    .value
                    .unwrap()
                    .overall_score,
                65.
            );
        });
    }

    #[gpui_kit::test]
    fn metadata_ack_cannot_read_the_old_projection_as_fresh_during_unsaved_typing(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = rubric_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let html = &room
                    .active_document()
                    .workspace
                    .as_deref()
                    .unwrap()
                    .content
                    .html;
                let fingerprint = SemanticBridge::discover()
                    .unwrap()
                    .rubric_draft_context(html)
                    .unwrap()
                    .fingerprint;
                let mut record = (*room.rubric.record).clone();
                record.generation += 1;
                let mut result = record.folios[&scope].result.as_ref().unwrap().clone();
                result["draftFingerprint"] = serde_json::Value::String(fingerprint);
                record.folios.get_mut(&scope).unwrap().result =
                    twyne_desktop::exchange::OptionalField::Value(result);
                let record = Arc::new(record);
                std::fs::write(
                    RubricStore::open(store.root()).unwrap().path(),
                    serde_json::to_vec(&record).unwrap(),
                )
                .unwrap();
                assert!(room.rubric.view.as_ref().unwrap().update(cx, |view, cx| {
                    view.replace_record(record.clone(), window, cx)
                }));
                room.rubric.record = record;
                room.refresh_rubric_context(cx);
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(
                room.read(cx).rubric.context.freshness,
                RubricFreshness::Fresh
            )
        });
        cx.update_window(handle, |_, window, cx| {
            let editor = room.read(cx).rich.clone().unwrap();
            editor.update(cx, |editor, cx| {
                let end = editor.document().text_len();
                editor.set_selection(Selection::new(end, end), cx).unwrap();
                editor
                    .execute(
                        twyne_desktop::editor::Command::InsertText(" Unsaved words".into()),
                        window,
                        cx,
                    )
                    .unwrap();
            });
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.dirty);
                let before = room
                    .active_document()
                    .workspace
                    .as_deref()
                    .unwrap()
                    .content
                    .html
                    .clone();
                let view = room.rubric.view.clone().unwrap();
                view.update(cx, |view, cx| {
                    view.request_edit(
                        RubricEdit::SetWeight {
                            folio_id: scope.clone(),
                            id: "thesis".into(),
                            weight: 2.5,
                        },
                        window,
                        cx,
                    )
                })
                .unwrap()
                .unwrap();
                room.flush_rubric(window, cx).unwrap();
                assert!(room.dirty);
                assert!(room.rubric.context_task.is_none());
                assert_eq!(room.rubric.context.freshness, RubricFreshness::Unknown);
                assert_eq!(
                    room.active_document()
                        .workspace
                        .as_deref()
                        .unwrap()
                        .content
                        .html,
                    before
                );
                // Freeze the normal timer to model a draft whose write has
                // not succeeded. Metadata ACK must not supply a replacement
                // reading of its old accepted projection in that interval.
                room.debounce = None;
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert!(room.read(cx).dirty);
            assert_eq!(
                room.read(cx).rubric.context.freshness,
                RubricFreshness::Unknown
            );
            assert_eq!(room.read(cx).rubric.context.draft_word_count, Some(5));
        });
        cx.update_window(handle, |_, _, cx| {
            room.update(cx, |room, cx| room.flush(cx).unwrap())
        })
        .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(room.read(cx).rubric.context.draft_word_count, Some(7));
            assert_eq!(
                room.read(cx).rubric.context.freshness,
                RubricFreshness::Stale
            );
        });
    }

    #[gpui_kit::test]
    fn failed_rubric_write_holds_candidate_and_blocks_folio_route_and_close_until_retry(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = rubric_room(cx);
        let metadata = RubricStore::open(store.root()).unwrap();
        let primary = std::fs::read(metadata.path()).unwrap();
        std::fs::remove_file(metadata.path()).unwrap();
        std::fs::create_dir(metadata.path()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            let (view, request, native_id, count, original) = room.update(cx, |room, cx| {
                let view = room.rubric.view.clone().unwrap();
                let original = room.rubric.record.clone();
                let request = view
                    .update(cx, |view, cx| {
                        view.request_edit(
                            RubricEdit::ToggleCriterion {
                                folio_id: scope.clone(),
                                id: "voice".into(),
                            },
                            window,
                            cx,
                        )
                    })
                    .unwrap()
                    .unwrap();
                let native_id = room.active;
                let count = room.documents.len();
                assert!(!room.add_document(Manuscript::new("Held departure"), window, cx));
                room.open_cast(CastSurface::Manager, window, cx);
                assert!(room.cast.route.is_none());
                assert!(room.rubric.boundary_error.is_some());
                assert_eq!(room.rubric.record, original);
                assert_eq!(view.read(cx).pending_request(), Some(&request));
                assert!(room.flush_rubric_on_shutdown(cx).is_err());
                (view, request, native_id, count, original)
            });
            window.render_frame(cx);
            assert!(window.find("dismiss-message").visible());
            std::fs::remove_dir(metadata.path()).unwrap();
            std::fs::write(metadata.path(), &primary).unwrap();
            window.click("dismiss-message", cx);
            room.update(cx, |room, cx| {
                assert_eq!((room.active, room.documents.len()), (native_id, count));
                assert!(room.rubric.boundary_error.is_none());
                assert!(view.read(cx).pending_request().is_none());
                assert_eq!(room.rubric.record, request.candidate);
                assert_eq!(
                    room.rubric.record.folios[&scope].result,
                    original.folios[&scope].result
                );
                assert!(!room.ack_rubric(
                    request.request_id,
                    request.candidate.clone(),
                    window,
                    cx
                ));
                room.request_rubric_save(request, window, cx);
                assert!(room.rubric.pending.is_none());
                assert!(room.add_document(Manuscript::new("After retry"), window, cx));
            });
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(metadata.load().unwrap().record.generation, 1);
    }

    #[gpui_kit::test]
    fn rubric_route_boundary_joins_exact_background_candidate_once(cx: &mut TestAppContext) {
        let (handle, room, store, _directory, scope) = rubric_room(cx);
        let mut accepted = None;
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let view = room.rubric.view.clone().unwrap();
                let request = view
                    .update(cx, |view, cx| {
                        view.request_edit(
                            RubricEdit::SetWeight {
                                folio_id: scope.clone(),
                                id: "thesis".into(),
                                weight: 2.5,
                            },
                            window,
                            cx,
                        )
                    })
                    .unwrap()
                    .unwrap();
                room.request_rubric_save(request.clone(), window, cx);
                assert_eq!(room.rubric.pending, Some(request.clone()));
                room.flush_rubric(window, cx).unwrap();
                assert!(room.rubric.pending.is_none());
                assert!(view.read(cx).pending_request().is_none());
                assert_eq!(room.rubric.record, request.candidate);
                accepted = Some(request.candidate);
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.read(|cx| assert_eq!(room.read(cx).rubric.record, accepted.clone().unwrap()));
        assert_eq!(
            RubricStore::open(store.root())
                .unwrap()
                .load()
                .unwrap()
                .record,
            accepted.unwrap()
        );
    }
}
