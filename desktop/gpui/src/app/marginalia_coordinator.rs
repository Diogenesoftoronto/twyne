use super::*;
use std::collections::HashSet;
use twyne_desktop::{
    editor::{Command, RichEditor},
    marginalia::{
        CommentRef, MarginaliaEdit, MarginaliaEffect, MarginaliaRecord, MarginaliaRequest,
        MarginaliaStore,
    },
    marginalia_view::{MarginaliaCapabilities, MarginaliaEvent, MarginaliaView},
};

/// Independent comment metadata. The view is retained while the Board is
/// closed, so its input ropes can be captured at save/switch/close boundaries.
pub(super) struct MarginaliaState {
    pub(super) store: Option<MarginaliaStore>,
    pub(super) record: Arc<MarginaliaRecord>,
    pub(super) pending: Option<MarginaliaRequest>,
    pub(super) view: Option<Entity<MarginaliaView>>,
    subscription: Option<Subscription>,
    capabilities: Option<MarginaliaCapabilities>,
    scope: Option<String>,
    reconcile: Option<Task<()>>,
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{AnyWindowHandle, TestAppContext};
    use tempfile::TempDir;
    use twyne_desktop::marginalia::MarginaliaEdit;

    fn marked_room(
        cx: &mut TestAppContext,
    ) -> (
        AnyWindowHandle,
        Entity<WritingRoom>,
        Arc<Store>,
        TempDir,
        CommentRef,
    ) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = "<p><span data-comment-id=\"a\" data-comment-author=\"You\"><strong>Same words</strong></span> / <span data-comment-id=\"b\" data-comment-author=\"You\"><em>Same words</em></span></p>";
        let path = store.root().join("A marked folio.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let folio = document.workspace.as_deref().unwrap().folio.id.clone();
        let target = CommentRef {
            folio_id: folio.clone(),
            id: "b".into(),
        };
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                let value = serde_json::json!([
                    {"id":"a","folioId":folio,"text":"First note","author":"You","anchor":"Same words","resolved":false,"createdAt":10,"updatedAt":10,"replies":[],"future":{"keep":true}},
                    {"id":"b","folioId":folio,"text":"Second **note**","author":"You","anchor":"Same words","resolved":false,"createdAt":11,"updatedAt":11,"replies":[]},
                    {"id":"b","folioId":"another-folio","text":"Foreign note","author":"You","resolved":false,"createdAt":12,"updatedAt":12,"replies":[]}
                ]);
                let margins = MarginaliaStore::open(store.root()).unwrap();
                std::fs::write(margins.path(), serde_json::to_vec(&value).unwrap()).unwrap();
                room.marginalia = MarginaliaState::load(&store).0;
                room.ensure_marginalia(window, cx).unwrap();
                room.desk.set_zen(false, false);
                room.desk.board_open = true;
            });
            window.render_frame(cx);
            window.click("board-tab-Marginalia", cx);
            window.render_frame(cx);
            assert!(window.find("marginalia-panel").visible());
        }).unwrap();
        (handle, room, store, directory, target)
    }

    #[gpui_kit::test]
    fn missing_body_erase_saves_only_the_exact_native_mark_and_keeps_foreign_metadata(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir, target) = marked_room(cx);
        let margins = MarginaliaStore::open(store.root()).unwrap();
        // Seed an actual cold-loaded missing-body state. The original mark
        // remains in the manuscript and the foreign folio's same ID survives.
        let mut session =
            twyne_desktop::marginalia::MarginaliaSession::new(margins.load().unwrap().record);
        let request = session
            .request(MarginaliaEdit::Erase(vec![target.clone()]), timestamp())
            .unwrap()
            .unwrap();
        margins.save_request(&request).unwrap();
        let metadata_before = std::fs::read(margins.path()).unwrap();
        let mut native_id = None;
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                room.marginalia = MarginaliaState::load(&store).0;
                room.ensure_marginalia(window, cx).unwrap();
                native_id = Some(room.active);
                let editor = room.rich.clone().unwrap();
                editor.update(cx, |editor, cx| editor.set_comments_quiet(false, cx));
            });
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                room.open_inline_margin(target.id.clone(), 13..23, window, cx)
            });
            window.render_frame(cx);
            assert!(window.find("inline-margin-card").visible());
            window.click("inline-margin-erase", cx);
            window.render_frame(cx);
            assert!(window.try_find("inline-margin-card").is_none());
            room.update(cx, |room, cx| {
                let editor = room.rich.clone().unwrap();
                assert_eq!(
                    editor.read(cx).document().plain_text(),
                    "Same words / Same words"
                );
                assert_eq!(
                    editor.read(cx).document().comment_ids(),
                    vec![Arc::<str>::from("a")]
                );
                assert!(room.marginalia.record.comment(&target).is_none());
                assert!(
                    room.marginalia
                        .record
                        .comment(&CommentRef {
                            folio_id: "another-folio".into(),
                            id: target.id.clone(),
                        })
                        .is_some()
                );
                assert!(!room.dirty);
                editor
                    .update(cx, |editor, cx| editor.execute(Command::Undo, window, cx))
                    .unwrap();
                assert_eq!(
                    editor.read(cx).document().comment_ids(),
                    vec![Arc::<str>::from("a"), Arc::<str>::from("b")]
                );
                assert!(!editor.read(cx).can_undo());
            });
        })
        .unwrap();
        let saved = store
            .load()
            .unwrap()
            .documents
            .into_iter()
            .find(|document| Some(document.id) == native_id)
            .unwrap();
        let saved_html = &saved.workspace.unwrap().content.html;
        assert!(saved_html.contains("data-comment-id=\"a\""));
        assert!(!saved_html.contains("data-comment-id=\"b\""));
        assert_eq!(std::fs::read(margins.path()).unwrap(), metadata_before);
    }

    #[gpui_kit::test]
    fn board_jump_and_erase_follow_exact_marks_and_preserve_the_other_scope(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir, target) = marked_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert_eq!(
                    room.marginalia
                        .view
                        .as_ref()
                        .unwrap()
                        .read(cx)
                        .counts()
                        .pending,
                    2
                );
                room.jump_to_margin(&target, window, cx);
                let editor = room.rich.clone().unwrap();
                assert_eq!(editor.read(cx).selection(), Selection::new(13, 23));
                let before = editor.read(cx).document().plain_text();
                let margins = room.marginalia.view.clone().unwrap();
                margins
                    .update(cx, |view, cx| {
                        view.request_edit(MarginaliaEdit::Erase(vec![target.clone()]), window, cx)
                    })
                    .unwrap();
                room.flush_marginalia(window, cx).unwrap();
                assert!(room.marginalia.record.comment(&target).is_none());
                assert!(
                    room.marginalia
                        .record
                        .comment(&CommentRef {
                            folio_id: "another-folio".into(),
                            id: "b".into()
                        })
                        .is_some()
                );
                assert_eq!(
                    editor.read(cx).document().comment_ids(),
                    vec![Arc::<str>::from("a")]
                );
                assert_eq!(editor.read(cx).document().plain_text(), before);
                room.flush(cx).unwrap();
                editor
                    .update(cx, |view, cx| view.execute(Command::Undo, window, cx))
                    .unwrap();
                assert_eq!(
                    editor.read(cx).document().comment_ids(),
                    vec![Arc::<str>::from("a"), Arc::<str>::from("b")]
                );
            });
        })
        .unwrap();
        cx.run_until_parked();
        let record = MarginaliaStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert!(record.comment(&target).is_none());
        assert_eq!(
            record.comments[0].extra["future"],
            serde_json::json!({"keep":true})
        );
    }

    #[gpui_kit::test]
    fn reply_files_the_final_unblurred_character_and_drafts_survive_a_folio_switch(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir, target) = marked_room(cx);
        let mut expected_html = String::new();
        cx.update_window(handle, |_, window, cx| {
            window.click(
                SharedString::from(format!(
                    "marginalia-annotate-{}-{}",
                    target.folio_id, target.id
                )),
                cx,
            );
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            let input = room.update(cx, |room, cx| {
                expected_html = room.rich.as_ref().unwrap().read(cx).document().to_html();
                let view = room.marginalia.view.clone().unwrap();
                view.update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap()
            });
            input.read(cx).focus_handle(cx).focus(window, cx);
            window.render_frame(cx);
            window.input("The final character", cx);
            window.input("!", cx);
            room.update(cx, |room, cx| {
                let view = room.marginalia.view.clone().unwrap();
                let text = input.read(cx).text().to_string();
                view.update(cx, |view, cx| {
                    view.request_edit(
                        MarginaliaEdit::AppendReply {
                            target: target.clone(),
                            reply: twyne_desktop::marginalia::UserCommentReply::writer(
                                text,
                                timestamp(),
                            ),
                        },
                        window,
                        cx,
                    )
                })
                .unwrap();
                room.flush_marginalia(window, cx).unwrap();
                assert_eq!(
                    room.marginalia.record.comment(&target).unwrap().replies[0].text,
                    "The final character!"
                );
                assert_eq!(input.read(cx).text().to_string(), "");
                assert_eq!(
                    room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    expected_html
                );
                input.update(cx, |input, cx| {
                    input.set_value("Held across folios 🦊", window, cx)
                });
                let next = Manuscript::new("Another folio");
                assert!(room.add_document(next, window, cx));
            });
        })
        .unwrap();
        cx.run_until_parked();
        let record = MarginaliaStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(
            record.comment(&target).unwrap().replies[0].text,
            "The final character!"
        );
        assert_eq!(
            record.reply_drafts[&target.folio_id][&target.id],
            "Held across folios 🦊"
        );
    }

    #[gpui_kit::test]
    fn failed_metadata_filing_keeps_mark_and_draft_and_blocks_departure_until_retry(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir, target) = marked_room(cx);
        let margins = MarginaliaStore::open(store.root()).unwrap();
        let primary = std::fs::read(margins.path()).unwrap();
        std::fs::remove_file(margins.path()).unwrap();
        std::fs::create_dir(margins.path()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let view = room.marginalia.view.clone().unwrap();
                let input = view
                    .update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap();
                input.update(cx, |input, cx| {
                    input.set_value("Keep every character 🦊", window, cx)
                });
                let html = room.rich.as_ref().unwrap().read(cx).document().to_html();
                let active = room.active;
                let count = room.documents.len();
                assert!(!room.add_document(Manuscript::new("Blocked departure"), window, cx));
                assert_eq!((room.active, room.documents.len()), (active, count));
                assert_eq!(input.read(cx).text().to_string(), "Keep every character 🦊");
                assert_eq!(
                    room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    html
                );
                assert!(room.flush_marginalia_on_shutdown(cx).is_err());
                let request = view.read(cx).pending_request().unwrap().clone();
                std::fs::remove_dir(margins.path()).unwrap();
                std::fs::write(margins.path(), &primary).unwrap();
                room.flush_marginalia(window, cx).unwrap();
                assert!(view.read(cx).pending_request().is_none());
                assert_eq!(room.marginalia.record, request.candidate);
                assert_eq!(
                    room.marginalia.record.reply_drafts[&target.folio_id][&target.id],
                    "Keep every character 🦊"
                );
                assert!(room.add_document(Manuscript::new("Departure after retry"), window, cx));
            });
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(
            margins.load().unwrap().record.reply_drafts[&target.folio_id][&target.id],
            "Keep every character 🦊"
        );
    }

    #[gpui_kit::test]
    fn saved_native_anchor_deletion_reconciles_only_its_scope_and_keeps_held_reply(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _dir, target) = marked_room(cx);
        let input = cx
            .update_window(handle, |_, window, cx| {
                window.click(
                    SharedString::from(format!(
                        "marginalia-annotate-{}-{}",
                        target.folio_id, target.id
                    )),
                    cx,
                );
                window.render_frame(cx);
                let input = room.update(cx, |room, cx| {
                    let view = room.marginalia.view.clone().unwrap();
                    view.update(cx, |view, cx| view.reply_input(&target, window, cx))
                        .unwrap()
                });
                input.read(cx).focus_handle(cx).focus(window, cx);
                window.render_frame(cx);
                window.input("Keep my held reply", cx);
                window.input(" 🦊", cx);
                let editor = room.update(cx, |room, cx| {
                    let editor = room.rich.clone().unwrap();
                    assert!(
                        editor
                            .update(cx, |editor, cx| editor.select_comment("b", cx))
                            .unwrap()
                    );
                    editor
                });
                editor.read(cx).focus_handle(cx).focus(window, cx);
                window.render_frame(cx);
                window.press("backspace", cx);
                assert_eq!(editor.read(cx).document().plain_text(), "Same words / ");
                assert_eq!(
                    editor.read(cx).document().comment_ids(),
                    vec![Arc::<str>::from("a")]
                );
                input
            })
            .unwrap();
        while cx.executor().tick() {}
        cx.executor().advance_clock(Duration::from_millis(401));
        while cx.executor().tick() {}
        let margins = MarginaliaStore::open(store.root()).unwrap();
        assert!(
            margins.load().unwrap().record.comment(&target).is_some(),
            "Thread removal waits for the manuscript's durable save"
        );
        cx.executor().advance_clock(Duration::from_millis(301));
        while cx.executor().tick() {}
        let saved = margins.load().unwrap().record;
        assert!(saved.comment(&target).is_none());
        assert!(
            saved
                .comment(&CommentRef {
                    folio_id: "another-folio".into(),
                    id: "b".into()
                })
                .is_some()
        );
        assert_eq!(
            saved.comments[0].extra["future"],
            serde_json::json!({"keep":true})
        );
        assert_eq!(
            saved.reply_drafts[&target.folio_id][&target.id],
            "Keep my held reply 🦊"
        );
        cx.update_window(handle, |_, window, cx| {
            assert_eq!(input.read(cx).text().to_string(), "Keep my held reply 🦊");
            room.update(cx, |room, cx| {
                let editor = room.rich.clone().unwrap();
                assert_eq!(room.marginalia.record, saved);
                assert_eq!(editor.read(cx).document().plain_text(), "Same words / ");
                editor
                    .update(cx, |editor, cx| editor.execute(Command::Undo, window, cx))
                    .unwrap();
                assert_eq!(
                    editor.read(cx).document().plain_text(),
                    "Same words / Same words"
                );
                assert_eq!(
                    editor.read(cx).document().comment_ids(),
                    vec![Arc::<str>::from("a"), Arc::<str>::from("b")]
                );
                assert!(
                    !editor.read(cx).can_undo(),
                    "Reconciliation adds no manuscript history item"
                );
            });
        })
        .unwrap();
    }
}

impl MarginaliaState {
    pub(super) fn load(store: &Store) -> (Self, Vec<String>) {
        let (store, record, warnings) = match MarginaliaStore::open(store.root())
            .and_then(|store| Ok((store.clone(), store.load()?)))
        {
            Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
            Err(error) => (
                None,
                Arc::new(MarginaliaRecord::default()),
                vec![format!("Marginalia could not be opened: {error:#}")],
            ),
        };
        (
            Self {
                store,
                record,
                pending: None,
                view: None,
                subscription: None,
                capabilities: None,
                scope: None,
                reconcile: None,
            },
            warnings,
        )
    }
}

impl WritingRoom {
    /// Native edits only restart a timer. Anchor inspection waits for a
    /// durable, current rich revision, including at the quiet-save ACK.
    pub(super) fn schedule_marginalia_reconcile(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let active = self.active;
        let visit = self.revision_generation;
        let editor = self.rich.as_ref().map(Entity::entity_id);
        let timer = cx.background_executor().timer(Duration::from_millis(400));
        self.marginalia.reconcile = Some(cx.spawn_in(window, async move |this, cx| {
            timer.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.active == active
                    && this.revision_generation == visit
                    && this.rich.as_ref().map(Entity::entity_id) == editor
                {
                    this.reconcile_marginalia(window, cx);
                }
            });
        }));
    }

    pub(super) fn reconcile_marginalia(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.dirty
            || self.applying_source
            || self.margin.preflight.is_some()
            || self.marginalia.store.is_none()
            || self.marginalia.pending.is_some()
            || self
                .source_session
                .as_ref()
                .is_some_and(|session| session.pending)
            || self
                .marginalia
                .view
                .as_ref()
                .is_some_and(|view| view.read(cx).pending_request().is_some())
        {
            return;
        }
        let Some(editor) = &self.rich else {
            return;
        };
        if editor.read(cx).revision() != self.rich_saved_revision {
            return;
        }
        let folio_id = self.marginalia_folio_id();
        if !self
            .marginalia
            .record
            .comments
            .iter()
            .any(|comment| comment.folio_id == folio_id)
        {
            return;
        }
        let Some(mark_ids) = self.marginalia_anchor_ids(cx) else {
            return;
        };
        if self.ensure_marginalia(window, cx).is_err() {
            return;
        }
        let view = self.marginalia.view.clone().unwrap();
        let known = mark_ids.iter().map(String::as_str).collect::<HashSet<_>>();
        if !self
            .marginalia
            .record
            .comments
            .iter()
            .any(|comment| comment.folio_id == folio_id && !known.contains(comment.id.as_str()))
        {
            return;
        }
        if let Err(error) = view.update(cx, |view, cx| {
            view.request_edit(MarginaliaEdit::Reconcile { folio_id, mark_ids }, window, cx)
        }) {
            self.error = Some(format!("Margin notes remain held: {error:#}"));
            cx.notify();
        }
    }

    pub(super) fn marginalia_folio_id(&self) -> String {
        self.active_document().workspace.as_deref().map_or_else(
            || self.active.to_string(),
            |workspace| workspace.folio.id.clone(),
        )
    }

    fn marginalia_capabilities(&self, cx: &App) -> MarginaliaCapabilities {
        MarginaliaCapabilities {
            persist: self.marginalia.store.is_some(),
            jump_to_anchor: self.rich.is_some()
                && !self.applying_source
                && !self
                    .source_session
                    .as_ref()
                    .is_some_and(|session| session.pending),
            erase_anchors: !self.source_mode
                && !self.applying_source
                && self
                    .rich
                    .as_ref()
                    .is_some_and(|view| !view.read(cx).is_read_only()),
            ..MarginaliaCapabilities::default()
        }
    }

    /// Restricted to explicit opening and quiet-save boundaries. Source-only
    /// documents supply no anchor knowledge.
    fn marginalia_anchor_ids(&self, cx: &App) -> Option<Vec<String>> {
        self.rich.as_ref().map(|view| {
            view.read(cx)
                .document()
                .comment_ids()
                .into_iter()
                .map(|id| id.to_string())
                .collect()
        })
    }

    pub(super) fn sync_marginalia_capabilities(&mut self, cx: &mut Context<Self>) {
        let capabilities = self.marginalia_capabilities(cx);
        if self.marginalia.capabilities == Some(capabilities) {
            return;
        }
        self.marginalia.capabilities = Some(capabilities);
        if let Some(view) = &self.marginalia.view {
            view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
        }
    }

    pub(super) fn ensure_marginalia(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let scope = Some(self.marginalia_folio_id());
        let anchors = self.marginalia_anchor_ids(cx);
        let capabilities = self.marginalia_capabilities(cx);
        self.marginalia.capabilities = Some(capabilities);
        if let Some(view) = &self.marginalia.view {
            if self.marginalia.scope != scope {
                anyhow::ensure!(
                    view.update(cx, |view, cx| view.set_scope(
                        scope.clone(),
                        anchors,
                        window,
                        cx
                    )),
                    "Save the held Marginalia draft before opening another folio."
                );
            } else {
                view.update(cx, |view, cx| view.set_anchors(anchors, cx));
            }
            view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
        } else {
            let record = self.marginalia.record.clone();
            let view = cx.new(|cx| {
                MarginaliaView::new(record, scope.clone(), anchors, capabilities, window, cx)
            });
            self.marginalia.subscription =
                Some(
                    cx.subscribe_in(&view, window, |this, _, event, window, cx| {
                        this.marginalia_event(event.clone(), window, cx);
                    }),
                );
            self.marginalia.view = Some(view);
        }
        self.marginalia.scope = scope;
        Ok(())
    }

    pub(super) fn open_marginalia(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route()
            || self.dossier.is_some()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush(cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
        {
            return;
        }
        match self.ensure_marginalia(window, cx) {
            Ok(()) => {
                self.reconcile_marginalia(window, cx);
                self.desk.open_linked_panel(BoardContext::Marginalia);
                cx.notify();
            }
            Err(error) => {
                self.error = Some(format!("Marginalia could not be opened: {error:#}"));
                cx.notify();
            }
        }
    }

    fn marginalia_event(
        &mut self,
        event: MarginaliaEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            MarginaliaEvent::SaveRequested(request) => {
                self.request_marginalia_save(request, window, cx);
            }
            // Shared read models refresh at the accepted durable ACK below.
            // A queued child notification does not itself authorize a write.
            MarginaliaEvent::Filed { .. } => {}
            MarginaliaEvent::JumpToComment(target) => {
                self.jump_to_margin(&target, window, cx);
            }
            MarginaliaEvent::AskEditor(_)
            | MarginaliaEvent::PlayAudio { .. }
            | MarginaliaEvent::Speak { .. } => {}
        }
    }

    fn jump_to_margin(&mut self, target: &CommentRef, window: &mut Window, cx: &mut Context<Self>) {
        if target.folio_id != self.marginalia_folio_id()
            || !self.marginalia_capabilities(cx).jump_to_anchor
        {
            return;
        }
        self.set_write(window, cx);
        let Some(editor) = self.rich.clone() else {
            return;
        };
        match editor.update(cx, |editor, cx| editor.select_comment(&target.id, cx)) {
            Ok(true) => {
                self.focus_writing(window, cx);
                self.reveal_caret_next_frame(window, cx);
            }
            Ok(false) => {
                self.notice = Some("This note’s passage is no longer in the manuscript.".into())
            }
            Err(error) => self.error = Some(format!("This passage could not be selected: {error}")),
        }
        cx.notify();
    }

    fn request_marginalia_save(
        &mut self,
        request: MarginaliaRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self.marginalia.view.clone() else {
            return;
        };
        if self.marginalia.pending.is_some() || view.read(cx).pending_request() != Some(&request) {
            return;
        }
        // Erase's durable ACK and matching native mark removal share this
        // explicit action. A folio/mode switch cannot separate them.
        if request
            .effects
            .iter()
            .any(|effect| matches!(effect, MarginaliaEffect::Erased(_)))
        {
            match self.save_erased_margins(&request, window, cx) {
                Ok(record) => self.ack_marginalia(request.request_id, record, window, cx),
                Err(error) => view.update(cx, |view, cx| {
                    view.report_error(
                        request.request_id,
                        format!("This note was kept: {error:#}"),
                        cx,
                    );
                }),
            }
            cx.notify();
            return;
        }
        let Some(store) = self.marginalia.store.clone() else {
            view.update(cx, |view, cx| {
                view.report_error(
                    request.request_id,
                    "Marginalia is unavailable on this device.",
                    cx,
                );
            });
            return;
        };
        self.marginalia.pending = Some(request.clone());
        let library_lock = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let saved_request = request.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _library_lock = library_lock;
                    store.save_request(&saved_request)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.marginalia.pending.as_ref() != Some(&request) {
                    return;
                }
                this.marginalia.pending = None;
                match result {
                    Ok(record) => {
                        this.ack_marginalia(request.request_id, record, window, cx);
                    }
                    Err(error) => view.update(cx, |view, cx| {
                        view.report_error(
                            request.request_id,
                            format!("Could not file this margin note: {error:#}"),
                            cx,
                        );
                    }),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn ack_marginalia(
        &mut self,
        request_id: Uuid,
        record: Arc<MarginaliaRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let accepted = self.marginalia.view.as_ref().is_some_and(|view| {
            view.update(cx, |view, cx| {
                view.ack_saved(request_id, record.clone(), window, cx)
            })
        });
        if accepted {
            self.marginalia.record = record;
            let anchors = self.marginalia_anchor_ids(cx);
            if let Some(view) = &self.marginalia.view {
                view.update(cx, |view, cx| view.set_anchors(anchors, cx));
            }
            self.margin_filed(request_id, window, cx);
            self.schedule_marginalia_reconcile(window, cx);
        }
    }

    /// A source-only comment mark can outlive its metadata. Removing that
    /// exact mark must not invent a note or touch a matching foreign folio ID.
    pub(super) fn erase_unfiled_margin_mark(
        &mut self,
        target: &CommentRef,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.marginalia_capabilities(cx).erase_anchors
                && target.folio_id == self.marginalia_folio_id(),
            "Open the original editable folio to erase its margin mark."
        );
        anyhow::ensure!(
            self.marginalia.record.comment(target).is_none(),
            "The note is available again. Erase it through its saved thread."
        );
        let editor = self
            .rich
            .clone()
            .ok_or_else(|| anyhow::anyhow!("The writing editor is unavailable."))?;
        let mut candidate = RichEditor::new(editor.read(cx).snapshot());
        candidate.set_selection(editor.read(cx).selection())?;
        candidate.execute(Command::RemoveComment {
            id: target.id.clone(),
        })?;
        let mut snapshot = self.snapshot(cx);
        snapshot.rich = Some(candidate.document().clone());
        snapshot.materialize()?;
        editor.update(cx, |editor, cx| {
            editor.execute(
                Command::RemoveComment {
                    id: target.id.clone(),
                },
                window,
                cx,
            )
        })?;
        self.flush(cx)
    }

    fn save_erased_margins(
        &mut self,
        request: &MarginaliaRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<Arc<MarginaliaRecord>> {
        anyhow::ensure!(
            self.marginalia_capabilities(cx).erase_anchors,
            "Open the editable manuscript to erase its margin marks. The note was kept."
        );
        let folio = self.marginalia_folio_id();
        let targets = request
            .effects
            .iter()
            .filter_map(|effect| {
                if let MarginaliaEffect::Erased(target) = effect {
                    Some(target)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        anyhow::ensure!(
            targets.iter().all(|target| target.folio_id == folio),
            "The open folio changed. The note was kept in its original scope."
        );
        let editor = self
            .rich
            .clone()
            .ok_or_else(|| anyhow::anyhow!("The writing editor is unavailable."))?;
        let mut candidate = RichEditor::new(editor.read(cx).snapshot());
        candidate.set_selection(editor.read(cx).selection())?;
        for target in &targets {
            candidate.execute(Command::RemoveComment {
                id: target.id.clone(),
            })?;
        }
        let mut snapshot = self.snapshot(cx);
        snapshot.rich = Some(candidate.document().clone());
        // Validate canonical source and retained source atoms before metadata
        // or live history changes. This is an explicit command boundary.
        snapshot.materialize()?;
        let saved = self
            .marginalia
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Marginalia is unavailable on this device."))?
            .save_request(request)?;
        for target in targets {
            editor.update(cx, |editor, cx| {
                editor.execute(
                    Command::RemoveComment {
                        id: target.id.clone(),
                    },
                    window,
                    cx,
                )
            })?;
        }
        Ok(saved)
    }

    pub(super) fn flush_marginalia(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        self.file_marked_composition(window, cx)?;
        self.reconcile_marginalia(window, cx);
        let Some(view) = self.marginalia.view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        let result = if request
            .effects
            .iter()
            .any(|effect| matches!(effect, MarginaliaEffect::Erased(_)))
        {
            self.save_erased_margins(&request, window, cx)
        } else {
            self.marginalia
                .store
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Marginalia is unavailable on this device."))
                .and_then(|store| store.save_request(&request))
        };
        self.marginalia.pending = None;
        match result {
            Ok(record) => {
                self.ack_marginalia(request.request_id, record, window, cx);
                Ok(())
            }
            Err(error) => {
                view.update(cx, |view, cx| {
                    view.report_error(
                        request.request_id,
                        format!("Could not file before leaving: {error:#}"),
                        cx,
                    );
                });
                self.error = Some(format!("Your margin draft is kept: {error:#}"));
                cx.notify();
                Err(error)
            }
        }
    }

    pub(super) fn flush_marginalia_on_shutdown(
        &mut self,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.has_unfiled_marked_composition(),
            "The marked note is still held. File it in the writing window before closing."
        );
        let Some(view) = self.marginalia.view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        // Window close and the native Quit action flush commands with their
        // real Window first. A window-free platform quit must not acknowledge
        // an unapplied source-mark erase as successful metadata-only filing.
        anyhow::ensure!(
            !request
                .effects
                .iter()
                .any(|effect| matches!(effect, MarginaliaEffect::Erased(_))),
            "The margin erase is still held. Finish it in the writing window before closing."
        );
        let result = self
            .marginalia
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Marginalia is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        match result {
            Ok(record) => {
                self.marginalia.record = record;
                self.marginalia.pending = None;
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
                self.error = Some(format!("Your margin draft is kept: {error:#}"));
                cx.notify();
                Err(error)
            }
        }
    }
}
