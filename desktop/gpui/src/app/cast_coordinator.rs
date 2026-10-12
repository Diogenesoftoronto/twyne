use super::*;
use twyne_desktop::{
    cast::{CastRecord, CastRequest, CastStore},
    cast_view::{CastBriefLabel, CastCapabilities, CastEvent, CastSurface, CastView},
};

/// The single retained room view owns local working inputs. The coordinator
/// owns accepted metadata, route changes and disk acknowledgement. Detached
/// writers also retain the library Store so its OS lock outlives the write.
pub(super) struct CastState {
    pub(super) store: Option<CastStore>,
    pub(super) record: Arc<CastRecord>,
    pub(super) pending: Option<CastRequest>,
    pub(super) view: Option<Entity<CastView>>,
    pub(super) subscription: Option<Subscription>,
    pub(super) scope: Option<String>,
    pub(super) route: Option<CastSurface>,
    pub(super) boundary_error: Option<String>,
}

impl CastState {
    pub(super) fn load(library: &Store) -> (Self, Vec<String>) {
        let (store, record, warnings) = match CastStore::open(library.root()).and_then(|store| {
            let loaded = store.load()?;
            Ok((store, loaded))
        }) {
            Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
            Err(error) => (
                None,
                Arc::new(CastRecord::default()),
                vec![format!(
                    "The Room of Editors could not be opened: {error:#}"
                )],
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
                route: None,
                boundary_error: None,
            },
            warnings,
        )
    }
}

impl WritingRoom {
    pub(super) fn sync_cast_surface(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let desired = self.cast.route.unwrap_or(CastSurface::Board);
        if let Some(view) = &self.cast.view
            && view.read(cx).surface() != desired
        {
            view.update(cx, |view, cx| view.set_surface(desired, window, cx));
        }
    }

    fn cast_capabilities(&self) -> CastCapabilities {
        CastCapabilities {
            persist: self.cast.store.is_some(),
            ..CastCapabilities::default()
        }
    }

    pub(super) fn ensure_cast(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let scope = Some(self.marginalia_folio_id());
        let brief = self
            .active_document()
            .workspace
            .as_deref()
            .and_then(|workspace| workspace.brief.as_ref())
            .map_or_else(CastBriefLabel::default, |brief| CastBriefLabel {
                title: Some(brief.answers.working_title.clone()),
                format: Some(brief.answers.format.clone()),
            });
        let capabilities = self.cast_capabilities();
        if let Some(view) = &self.cast.view {
            anyhow::ensure!(
                view.update(cx, |view, cx| view.set_scope(
                    scope.clone(),
                    brief,
                    None,
                    window,
                    cx
                )),
                "File the held Cast change before opening another folio."
            );
            view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
        } else {
            let record = self.cast.record.clone();
            let view = cx.new(|cx| {
                CastView::new(record, scope.clone(), brief, None, capabilities, window, cx)
            });
            self.cast.subscription = Some(cx.subscribe_in(
                &view,
                window,
                |this, _, event, window, cx| this.cast_event(event.clone(), window, cx),
            ));
            self.cast.view = Some(view);
        }
        self.cast.scope = scope;
        if let Some(analysis) = self
            .cast
            .scope
            .as_deref()
            .and_then(|scope| self.cast.record.analysis(scope))
        {
            // This is an explicit pane-opening/scope boundary. The local
            // helper uses the same Intl date formatting as the original app.
            let label = twyne_desktop::semantic_bridge::SemanticBridge::discover()
                .and_then(|bridge| bridge.local_timestamp(analysis.timestamp))
                .ok()
                .map(|date| date.label);
            if let Some(view) = &self.cast.view {
                view.update(cx, |view, cx| view.set_analysis_filed_label(label, cx));
            }
        }
        Ok(())
    }

    pub(super) fn open_cast(
        &mut self,
        surface: CastSurface,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if (surface == CastSurface::Board && self.dossier.is_some())
            || self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        if let Err(error) = self.ensure_cast(window, cx) {
            self.error = Some(format!("Cast could not be opened: {error:#}"));
            cx.notify();
            return;
        }
        let view = self.cast.view.clone().unwrap();
        view.update(cx, |view, cx| view.set_surface(surface, window, cx));
        self.cast.route = (surface != CastSurface::Board).then_some(surface);
        if surface != CastSurface::Board {
            self.retire_math_source_visit(cx);
        }
        self.rubric.route = false;
        self.apparatus.route = false;
        self.house_route = false;
        self.library_route = false;
        self.settings_route = false;
        self.dossier = None;
        self.dossier_subscription = None;
        self.find_visible = false;
        self.new_folio_form = false;
        self.source_go_to_line = false;
        if surface == CastSurface::Board {
            self.desk.open_linked_panel(BoardContext::Cast);
        } else {
            window.focus(&view.read(cx).focus_handle(cx), cx);
        }
        cx.notify();
    }

    fn cast_event(&mut self, event: CastEvent, window: &mut Window, cx: &mut Context<Self>) {
        if let CastEvent::SaveRequested(request) = event {
            self.request_cast_save(request, window, cx);
            return;
        }
        if matches!(event, CastEvent::Filed { .. }) {
            return;
        }
        let visible = self.cast.route.is_some()
            || (!self.standalone_route()
                && self.desk.board_open
                && self.desk.board_context == BoardContext::Cast);
        if !visible {
            return;
        }
        match event {
            CastEvent::SurfaceRequested(surface) => self.open_cast(surface, window, cx),
            CastEvent::BackToDesk => {
                if self.flush_apparatus(window, cx).is_ok()
                    && self.flush_rubric(window, cx).is_ok()
                    && self.flush_cast(window, cx).is_ok()
                    && self.flush(cx).is_ok()
                {
                    self.cast.route = None;
                    self.rubric.route = false;
                    self.apparatus.route = false;
                    self.focus_writing(window, cx);
                    cx.notify();
                }
            }
            CastEvent::DownloadAnalysis {
                folio_id,
                filename,
                markdown,
            } => {
                if self.cast.scope.as_deref() == Some(folio_id.as_str())
                    && self.cast.record.analysis(&folio_id).is_some()
                {
                    self.download_cast_analysis(filename, markdown, window, cx);
                }
            }
            // These events require their actual provider/mark/analytics
            // transactions. The local view supplies none of those capabilities.
            CastEvent::SaveRequested(_)
            | CastEvent::Filed { .. }
            | CastEvent::JumpToPersonaNote(_)
            | CastEvent::GetNotesRequested { .. }
            | CastEvent::ProposeEditsRequested { .. }
            | CastEvent::RunAnalysisRequested { .. }
            | CastEvent::AskEditor { .. }
            | CastEvent::AskForFix(_)
            | CastEvent::Speak { .. }
            | CastEvent::ClearRoomRequested { .. }
            | CastEvent::FeedbackRequested { .. } => {}
        }
    }

    fn download_cast_analysis(
        &mut self,
        filename: String,
        markdown: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let directory = directories::UserDirs::new()
            .and_then(|dirs| dirs.document_dir().map(PathBuf::from))
            .unwrap_or_else(|| self.store.root().to_path_buf());
        let picker = cx.prompt_for_new_path(&directory, Some(&filename));
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
                    let result = export_bytes(&path, markdown.as_bytes());
                    (path, result)
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                match result {
                    (path, Ok(())) => this.notice = Some(format!("Exported {}", path.display())),
                    (_, Err(error)) => {
                        this.error = Some(format!("Could not export this analysis: {error:#}"));
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn cast_page(&self, cx: &Context<Self>) -> gpui_kit::AnyElement {
        div()
            .id("native-cast")
            .test_support()
            .size_full()
            .min_h_0()
            .bg(rgb(palette(cx).paper_soft))
            .when_some(self.cast.view.clone(), |page, view| page.child(view))
            .into_any_element()
    }

    fn request_cast_save(
        &mut self,
        request: CastRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self.cast.view.clone() else {
            return;
        };
        if self.cast.pending.is_some() || view.read(cx).pending_request() != Some(&request) {
            return;
        }
        let Some(store) = self.cast.store.clone() else {
            self.cast.boundary_error =
                Some("The Room of Editors is unavailable on this device.".into());
            view.update(cx, |view, cx| {
                view.report_error(
                    request.request_id,
                    "The Room of Editors is unavailable on this device.",
                    cx,
                );
            });
            return;
        };
        self.cast.pending = Some(request.clone());
        let keep_library_lock = self.store.clone();
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
                if this.cast.pending.as_ref() != Some(&request) {
                    return;
                }
                this.cast.pending = None;
                match result {
                    Ok(record) => {
                        this.ack_cast(request.request_id, record, window, cx);
                    }
                    Err(error) => {
                        this.cast.boundary_error =
                            Some(format!("Your Cast draft is kept: {error:#}"));
                        view.update(cx, |view, cx| {
                            view.report_error(
                                request.request_id,
                                format!("Could not file this change: {error:#}"),
                                cx,
                            );
                        });
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn ack_cast(
        &mut self,
        id: Uuid,
        record: Arc<CastRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let accepted = self.cast.view.as_ref().is_some_and(|view| {
            view.update(cx, |view, cx| {
                view.ack_saved(id, record.clone(), window, cx)
            })
        });
        if accepted {
            self.cast.record = record;
            self.cast.boundary_error = None;
        }
        accepted
    }

    /// Capture live inputs before a route/scope change. CastStore serializes
    /// writers and accepts the same complete candidate idempotently, so this
    /// boundary can join a background request without replacing newer state.
    pub(super) fn flush_cast(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let Some(view) = self.cast.view.clone() else {
            return Ok(());
        };
        let prepared = view.update(cx, |view, cx| view.prepare_pending_edits(cx));
        let Some(request) = prepared.inspect_err(|error| {
            self.cast.boundary_error = Some(format!("Your Cast draft is kept: {error:#}"));
            cx.notify();
        })?
        else {
            return Ok(());
        };
        let result = self
            .cast
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Room of Editors is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        self.cast.pending = None;
        match result {
            Ok(record) => {
                anyhow::ensure!(
                    self.ack_cast(request.request_id, record, window, cx),
                    "The held Cast change could not be acknowledged."
                );
                Ok(())
            }
            Err(error) => {
                self.cast.boundary_error = Some(format!("Your Cast draft is kept: {error:#}"));
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

    pub(super) fn flush_cast_on_shutdown(&mut self, cx: &mut Context<Self>) -> anyhow::Result<()> {
        let Some(view) = self.cast.view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        let result = self
            .cast
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Room of Editors is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        self.cast.pending = None;
        match result {
            Ok(record) => {
                self.cast.record = record;
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
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{AnyWindowHandle, ScrollDelta, TestAppContext};
    use tempfile::TempDir;
    use twyne_desktop::cast::{CastEdit, CastNoteRef, parse_cast_json};

    fn cast_room(
        cx: &mut TestAppContext,
    ) -> (
        AnyWindowHandle,
        Entity<WritingRoom>,
        Arc<Store>,
        TempDir,
        CastNoteRef,
    ) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = "<h1>The notebook</h1><p>The repeated sentence.</p>";
        let path = store.root().join("The notebook.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let scope = document.workspace.as_deref().unwrap().folio.id.clone();
        let target = CastNoteRef {
            folio_id: scope.clone(),
            id: "pn-source:one".into(),
        };
        let mut record =
            parse_cast_json(include_bytes!("../../fixtures/cast/native-retained.json")).unwrap();
        // Bind only the fixture's enclosing artifact path. Original row IDs,
        // raw folioId fields and the unrelated foreign scope stay untouched.
        let artifacts = record.folios.remove("web/folio:café").unwrap();
        record.folios.insert(scope, artifacts);
        let cast_store = CastStore::open(store.root()).unwrap();
        std::fs::write(cast_store.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.cast = CastState::load(&store).0;
                room.desk.set_zen(false, false);
                room.open_cast(CastSurface::Board, window, cx);
            });
            window.render_frame(cx);
            assert!(window.find("cast-root").visible());
        })
        .unwrap();
        (handle, room, store, directory, target)
    }

    fn reveal(window: &mut Window, id: &'static str, cx: &mut App) {
        for _ in 0..30 {
            window.render_frame(cx);
            if window.try_find(id).is_some_and(|element| element.visible()) {
                return;
            }
            let delta = window.try_find(id).map_or(-220., |element| {
                if element.bounds().origin.y < window.find("cast-scroll").bounds().top() {
                    220.
                } else {
                    -220.
                }
            });
            window.scroll(
                "cast-scroll",
                ScrollDelta::Pixels(gpui_kit::point(px(0.), px(delta))),
                cx,
            );
        }
        assert!(window.find(id).visible(), "{id} must be reachable");
    }

    #[gpui_kit::test]
    fn retained_cast_routes_capture_the_final_reply_character_without_editing_the_manuscript(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, target) = cast_room(cx);
        let (view, html) = cx
            .update_window(handle, |_, window, cx| {
                window.activate_window();
                reveal(window, "cast-reply-open-0", cx);
                window.click("cast-reply-open-0", cx);
                window.render_frame(cx);
                window.simulate_next_frame(cx);
                window.render_frame(cx);
                let (view, html) = room.update(cx, |room, cx| {
                    (
                        room.cast.view.clone().unwrap(),
                        room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    )
                });
                window.input("Held café", cx);
                window.input("!", cx);
                window.click("cast-edit-roster", cx);
                (view, html)
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                assert_eq!(room.cast.route, Some(CastSurface::Manager));
                assert_eq!(
                    room.cast.view.as_ref().unwrap().entity_id(),
                    view.entity_id()
                );
                assert_eq!(
                    room.cast.record.reply_drafts[&target.folio_id][&target.id],
                    "Held café!"
                );
                assert_eq!(
                    room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    html
                );
            });
            window.click("cast-back-to-desk", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(view.read(cx).surface(), CastSurface::Board);
            window.click("cast-analysis", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(view.read(cx).surface(), CastSurface::Analysis);
            window.click("cast-analysis-back", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(view.read(cx).surface(), CastSurface::Board);
            room.update(cx, |room, cx| {
                assert!(room.cast.route.is_none());
                assert_eq!(room.desk.board_context, BoardContext::Cast);
                assert!(room.desk.board_open);
                assert_eq!(
                    room.cast.view.as_ref().unwrap().entity_id(),
                    view.entity_id()
                );
                let old = room.active;
                assert!(room.add_document(Manuscript::new("Another folio"), window, cx));
                room.select(old, window, cx);
                let input = view
                    .update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap();
                assert_eq!(input.read(cx).text().to_string(), "Held café!");
                input.update(cx, |input, cx| {
                    input.set_value("Shutdown keeps the last 🦊", window, cx)
                });
                room.flush_cast_on_shutdown(cx).unwrap();
                assert_eq!(
                    room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    html
                );
            });
        })
        .unwrap();
        cx.run_until_parked();
        let record = CastStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(
            record.reply_drafts[&target.folio_id][&target.id],
            "Shutdown keeps the last 🦊"
        );
        assert_eq!(record.folios["unimported/foreign"].notes.len(), 1);
        assert_eq!(
            record.folios[&target.folio_id].notes[0].extra["sourceMetadata"],
            serde_json::json!({"exact":"<>& 東京"})
        );
    }

    #[gpui_kit::test]
    fn failed_cast_filing_holds_the_full_request_and_blocks_departure_until_retry(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, target) = cast_room(cx);
        let cast_store = CastStore::open(store.root()).unwrap();
        let primary = std::fs::read(cast_store.path()).unwrap();
        std::fs::remove_file(cast_store.path()).unwrap();
        std::fs::create_dir(cast_store.path()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            let (view, request, html) = room.update(cx, |room, cx| {
                let view = room.cast.view.clone().unwrap();
                let input = view
                    .update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap();
                input.update(cx, |input, cx| {
                    input.set_value("Keep every character 🦊", window, cx)
                });
                let accepted = room.cast.record.clone();
                let html = room.rich.as_ref().unwrap().read(cx).document().to_html();
                let active = room.active;
                let count = room.documents.len();
                assert!(!room.add_document(Manuscript::new("Blocked departure"), window, cx));
                assert_eq!((room.active, room.documents.len()), (active, count));
                assert_eq!(room.cast.record, accepted);
                assert!(room.cast.boundary_error.is_some());
                assert_eq!(input.read(cx).text().to_string(), "Keep every character 🦊");
                assert!(room.flush_cast_on_shutdown(cx).is_err());
                let request = view.read(cx).pending_request().unwrap().clone();
                std::fs::remove_dir(cast_store.path()).unwrap();
                std::fs::write(cast_store.path(), &primary).unwrap();
                (view, request, html)
            });
            window.render_frame(cx);
            assert!(window.find("dismiss-message").visible());
            window.click("dismiss-message", cx);
            room.update(cx, |room, cx| {
                assert!(view.read(cx).pending_request().is_none());
                assert!(room.cast.boundary_error.is_none());
                assert_eq!(room.cast.record, request.candidate);
                assert!(!room.ack_cast(request.request_id, request.candidate.clone(), window, cx));
                room.request_cast_save(request.clone(), window, cx);
                assert!(room.cast.pending.is_none());
                assert_eq!(
                    room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    html
                );
                assert!(room.add_document(Manuscript::new("Departure after retry"), window, cx));
            });
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(
            cast_store.load().unwrap().record.reply_drafts[&target.folio_id][&target.id],
            "Keep every character 🦊"
        );
    }

    #[gpui_kit::test]
    fn route_boundary_joins_the_exact_background_cast_request_once(cx: &mut TestAppContext) {
        let (handle, room, store, _directory, _) = cast_room(cx);
        let mut accepted = None;
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let view = room.cast.view.clone().unwrap();
                let mut settings = room.cast.record.settings();
                settings.max_proposals += 1;
                let request = view
                    .update(cx, |view, cx| {
                        view.request_edit(CastEdit::SetRoomSettings(settings), window, cx)
                    })
                    .unwrap()
                    .unwrap();
                room.request_cast_save(request.clone(), window, cx);
                assert_eq!(room.cast.pending, Some(request.clone()));
                room.flush_cast(window, cx).unwrap();
                assert!(room.cast.pending.is_none());
                assert!(view.read(cx).pending_request().is_none());
                assert_eq!(room.cast.record, request.candidate);
                accepted = Some(request.candidate);
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.read(|cx| assert_eq!(room.read(cx).cast.record, accepted.clone().unwrap()));
        assert_eq!(
            CastStore::open(store.root())
                .unwrap()
                .load()
                .unwrap()
                .record,
            accepted.unwrap()
        );
    }
}
