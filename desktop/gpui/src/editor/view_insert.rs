//! Slash insertion's view transaction boundary, isolated from layout/input.
use super::*;
use crate::insert_menu::{self, SlashQuery, parameters::Parameters};

impl RichEditorView {
    pub fn is_composing(&self) -> bool {
        self.marked_range.is_some()
    }

    pub fn insert_from_slash(
        &mut self,
        query: &SlashQuery,
        expected_revision: u64,
        command: &str,
        values: &Parameters,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<CommandOutcome, EditorError> {
        self.perform_insertion(window, cx, |editor| {
            insert_menu::rich::apply(editor, query, expected_revision, command, values)
        })
    }

    pub fn remove_slash_query(
        &mut self,
        query: &SlashQuery,
        expected_revision: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<CommandOutcome, EditorError> {
        self.perform_insertion(window, cx, |editor| {
            insert_menu::rich::remove_query(editor, query, expected_revision)
        })
    }

    pub fn insert_at_cursor(
        &mut self,
        expected_revision: u64,
        selection: Selection,
        command: &str,
        values: &Parameters,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<CommandOutcome, EditorError> {
        self.perform_insertion(window, cx, |editor| {
            insert_menu::rich::apply_at(editor, expected_revision, selection, command, values)
        })
    }

    fn perform_insertion(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        operation: impl FnOnce(&mut RichEditor) -> Result<CommandOutcome, EditorError>,
    ) -> Result<CommandOutcome, EditorError> {
        if self.marked_range.is_some() {
            return Err(EditorError::UnsupportedStructure(
                "Finish the current text composition before inserting.",
            ));
        }
        self.close_typing_group();
        self.close_note_edit_group();
        let before = self.snapshot();
        let outcome = operation(&mut self.editor)?;
        self.cancel_block_drag(window, cx);
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        self.sync_math_source_target(cx);
        self.error = None;
        if outcome.document_changed {
            self.sync_note_popup(false, window, cx);
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
        }
        if outcome.selection_changed {
            cx.emit(RichEditorEvent::SelectionChanged);
        }
        cx.notify();
        Ok(outcome)
    }
}
