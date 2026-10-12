//! Commit a confirmed citation as one history entry without moving the live
//! selection during preflight. Preparation and canonical conversion belong to
//! the host's explicit citation action, outside the ordinary input path.

use super::*;
use crate::citation_anchor::PreparedCitation;

impl RichEditorView {
    pub fn commit_prepared_citation(
        &mut self,
        prepared: &PreparedCitation,
        expected_revision: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<CommandOutcome, EditorError> {
        if self.is_read_only() {
            return Err(EditorError::ReadOnly);
        }
        if self.revision() != expected_revision || self.selection() != prepared.selection_before {
            return Err(EditorError::UnsupportedStructure(
                "The draft or selection changed while the citation was being prepared.",
            ));
        }
        if self.marked_range.is_some() {
            return Err(EditorError::UnsupportedStructure(
                "Finish composing text before placing a citation.",
            ));
        }
        if prepared.source_id.is_empty()
            || prepared.target.range.is_empty()
            || prepared.insert_at != Selection::caret(prepared.target.range.end)
            || self.document().scalar_to_utf16(prepared.target.range.start)
                != Some(prepared.target.utf16_range.from)
            || self.document().scalar_to_utf16(prepared.target.range.end)
                != Some(prepared.target.utf16_range.to)
            || !matches!(&prepared.command, Command::InsertInline(InlineObject::Note {
                kind: NoteKind::Footnote, text
            }) if !text.is_empty())
        {
            return Err(EditorError::UnsupportedStructure(
                "The prepared citation is not a footnote at the confirmed passage end.",
            ));
        }

        // Clone the shared tree and existing history. Begin the new group
        // before positioning its caret, so Undo restores the writer's original
        // selection and keeps every previously accepted history entry.
        let mut accepted = self.editor.clone();
        if self.typing_group.is_some() || self.note_edit_group_open() {
            accepted.end_history_group();
        }
        accepted.begin_history_group();
        accepted.set_selection(prepared.insert_at)?;
        let mut outcome = accepted.execute(prepared.command.clone())?;
        accepted.end_history_group();
        if !outcome.document_changed
            || accepted.document() != &prepared.candidate
            || accepted.selection() != prepared.selection_after
        {
            return Err(EditorError::UnsupportedStructure(
                "The prepared citation no longer matches the current draft.",
            ));
        }
        outcome.selection_changed = self.selection() != accepted.selection();

        self.cancel_block_drag(window, cx);
        window.focus(&self.focus, cx);
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        self.close_typing_group();
        self.close_note_edit_group();
        let before = self.snapshot();
        self.editor = accepted;
        self.error = None;
        self.clear_comment_hover(cx);
        self.comment_focus.borrow_mut().clear();
        cx.emit(RichEditorEvent::Transacted {
            before,
            after: self.snapshot(),
            revision: self.revision(),
        });
        cx.emit(RichEditorEvent::Changed {
            revision: self.revision(),
        });
        if self.focus.is_focused(window)
            && let Some(delta) = outcome.edit_delta
            && !delta.is_empty()
        {
            cx.emit(RichEditorEvent::Input { delta });
        }
        if outcome.selection_changed {
            cx.emit(RichEditorEvent::SelectionChanged);
        }
        cx.notify();
        Ok(outcome)
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use crate::citation_anchor::{CitationTarget, CitationTargetOrigin};
    use crate::semantic_bridge::CitationUtf16Range;
    use gpui_kit::{
        AnyWindowHandle, AppContext, Bounds, TestAppContext, WindowBounds, WindowOptions,
    };

    struct CitationPaper(Entity<RichEditorView>);
    impl Render for CitationPaper {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().w_full().p(px(40.)).child(self.0.clone())
        }
    }

    fn room(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<RichEditorView>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let (window, paper) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        Point::default(),
                        size(px(720.), px(600.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    cx.new(|cx| {
                        CitationPaper(cx.new(|cx| {
                            RichEditorView::new(
                                RichDocument::from_html(
                                    "<p>🌿 cited passage ends here.</p><p>Retained paragraph.</p>",
                                )
                                .unwrap(),
                                cx,
                            )
                        }))
                    })
                },
            )
            .unwrap();
            (window, paper.read(cx).0.clone())
        })
    }

    fn prepared(view: &RichEditorView) -> PreparedCitation {
        let range = 3..16;
        let selection_before = view.selection();
        let insert_at = Selection::caret(range.end);
        let command = Command::InsertInline(InlineObject::Note {
            kind: NoteKind::Footnote,
            text: "Author. Original source, 2024.".into(),
        });
        let mut candidate = RichEditor::new(view.snapshot());
        candidate.set_selection(selection_before).unwrap();
        candidate.begin_history_group();
        candidate.set_selection(insert_at).unwrap();
        candidate.execute(command.clone()).unwrap();
        candidate.end_history_group();
        PreparedCitation {
            source_id: "retained-source".into(),
            target: CitationTarget {
                origin: CitationTargetOrigin::Anchor,
                utf16_range: CitationUtf16Range {
                    from: view.document().scalar_to_utf16(range.start).unwrap(),
                    to: view.document().scalar_to_utf16(range.end).unwrap(),
                },
                range,
            },
            selection_before,
            insert_at,
            command,
            candidate: candidate.document().clone(),
            selection_after: candidate.selection(),
        }
    }

    #[gpui_kit::test]
    fn mounted_citation_commit_preserves_prior_typing_history_and_original_selection(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = room(cx);
        cx.update_window(handle, |_, window, cx| {
            let original = view.read(cx).snapshot();
            view.update(cx, |view, cx| {
                view.set_selection(Selection::caret(2), cx).unwrap();
                window.focus(&view.focus, cx);
                view.replace_text_in_range(None, "X", window, cx);
                assert!(view.typing_group.is_some());
            });
            let before = view.read(cx).snapshot();
            let request = prepared(view.read(cx));
            let revision = view.read(cx).revision();
            view.update(cx, |view, cx| {
                let outcome = view
                    .commit_prepared_citation(&request, revision, window, cx)
                    .unwrap();
                assert!(outcome.document_changed && outcome.history_changed);
                assert!(view.typing_group.is_none());
                assert_eq!(view.document(), &request.candidate);
                assert_eq!(view.selection(), request.selection_after);
                view.execute(Command::Undo, window, cx).unwrap();
                assert_eq!(view.document(), &before);
                assert_eq!(view.selection(), request.selection_before);
                view.execute(Command::Undo, window, cx).unwrap();
                assert_eq!(view.document(), &original);
                assert_eq!(view.selection(), Selection::caret(2));
                view.execute(Command::Redo, window, cx).unwrap();
                assert_eq!(view.document(), &before);
                view.execute(Command::Redo, window, cx).unwrap();
                assert_eq!(view.document(), &request.candidate);
                assert_eq!(view.selection(), request.selection_after);
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn mounted_citation_undo_restores_a_backward_writer_selection(cx: &mut TestAppContext) {
        let (handle, view) = room(cx);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                view.set_selection(Selection::new(12, 4), cx).unwrap();
                let before = view.snapshot();
                let request = prepared(view);
                view.commit_prepared_citation(&request, view.revision(), window, cx)
                    .unwrap();
                view.execute(Command::Undo, window, cx).unwrap();
                assert_eq!(view.document(), &before);
                assert_eq!(view.selection(), Selection::new(12, 4));
                assert!(!view.can_undo());
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn mounted_stale_or_invalid_citation_preflight_leaves_live_selection_and_history_untouched(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = room(cx);
        cx.update_window(handle, |_, window, cx| {
            let original = view.read(cx).snapshot();
            view.update(cx, |view, cx| {
                view.set_selection(Selection::caret(2), cx).unwrap();
                view.replace_text_in_range(None, "X", window, cx);
                let before = view.snapshot();
                let selection = view.selection();
                let revision = view.revision();
                let valid = prepared(view);
                let mut malformed = valid.clone();
                malformed.candidate = original.clone();
                for (candidate, expected_revision) in
                    [(&valid, revision + 1), (&malformed, revision)]
                {
                    assert!(
                        view.commit_prepared_citation(candidate, expected_revision, window, cx)
                            .is_err()
                    );
                    assert_eq!(view.document(), &before);
                    assert_eq!(view.selection(), selection);
                    assert_eq!(view.revision(), revision);
                    assert!(view.typing_group.is_some());
                }
                let mut moved = valid.clone();
                moved.selection_before = Selection::new(3, 1);
                assert!(
                    view.commit_prepared_citation(&moved, revision, window, cx)
                        .is_err()
                );
                view.editor.set_read_only(true);
                assert_eq!(
                    view.commit_prepared_citation(&valid, revision, window, cx),
                    Err(EditorError::ReadOnly)
                );
                view.editor.set_read_only(false);
                view.marked_range = Some(2..3);
                assert!(
                    view.commit_prepared_citation(&valid, revision, window, cx)
                        .is_err()
                );
                view.marked_range = None;
                assert_eq!(view.document(), &before);
                assert_eq!(view.selection(), selection);
                assert_eq!(view.revision(), revision);
                view.replace_text_in_range(None, "Y", window, cx);
                view.execute(Command::Undo, window, cx).unwrap();
                assert_eq!(view.document(), &original);
                assert_eq!(view.selection(), Selection::caret(2));
                assert!(!view.can_undo());
            });
        })
        .unwrap();
    }
}
