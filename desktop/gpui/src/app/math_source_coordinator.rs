//! Application-owned equation source scope and canonical submit preparation.
//! The converter runs on the editor's Submit executor, never during typing.

use super::*;
use gpui_kit::EntityId;
use std::sync::RwLock;
use twyne_desktop::editor::view::{MathSourceHostContext, MathSourcePreflight};

#[derive(Default)]
pub(super) struct MathSourceScope {
    owner: Option<EntityId>,
    visit: u64,
    document: Option<Arc<RwLock<Manuscript>>>,
}

impl WritingRoom {
    pub(super) fn install_math_source_context(
        &mut self,
        editor: &Entity<RichEditorView>,
        cx: &mut Context<Self>,
    ) {
        if self.math_source.owner == Some(editor.entity_id()) {
            return;
        }
        let Some(visit) = self.math_source.visit.checked_add(1) else {
            self.error = Some("Equation source editing could not be opened in this window.".into());
            return;
        };
        self.math_source.visit = visit;
        let current = self.active_document().clone();
        let folio = current.id.to_string();
        let document = Arc::new(RwLock::new(current));
        let base = document.clone();
        let preflight: MathSourcePreflight = Arc::new(move |candidate| {
            let document = base
                .read()
                .map_err(|_| "The manuscript could not be read. Retry this equation.".to_owned())?
                .clone();
            // Use the same source-aware reconciliation and canonical budget
            // as Save. Discard the prepared copy: this callback neither files
            // metadata nor replaces the current manuscript or disk contents.
            twyne_desktop::document_edit::apply_html(document, &candidate.to_html())
                .map(|_| ())
                .map_err(|error| format!("The equation could not be converted: {error:#}"))
        });
        let mut context = MathSourceHostContext::new(folio, visit);
        context.preflight = Some(preflight);
        // The reviewed retained child reserves its actual measured box in
        // the paragraph. Renderer availability remains an independent gate.
        context.inline_form_in_flow = true;
        editor.update(cx, |editor, cx| {
            editor.set_math_source_context(Some(context), cx)
        });
        self.math_source.owner = Some(editor.entity_id());
        self.math_source.document = Some(document);
    }

    pub(super) fn retire_math_source_visit(&mut self, cx: &mut Context<Self>) {
        let Some(owner) = self.math_source.owner.take() else {
            return;
        };
        self.math_source.document = None;
        if let Some(editor) = &self.rich
            && editor.entity_id() == owner
        {
            // Clearing the actual scope cancels pending preparation, retires
            // the retained form and never submits or steals focus.
            editor.update(cx, |editor, cx| editor.set_math_source_context(None, cx));
        }
    }

    /// Update only at a real save boundary. Keystrokes never clone Source.
    pub(super) fn refresh_math_source_base(&mut self) {
        if let Some(base) = &self.math_source.document
            && self.rich.as_ref().map(Entity::entity_id) == self.math_source.owner
            && let Ok(mut document) = base.write()
            && document.id == self.active
        {
            *document = self.active_document().clone();
        }
    }

    pub(super) fn sync_math_source_presence(&mut self, cx: &mut Context<Self>) {
        let visible = !self.standalone_route()
            && self.dossier.is_none()
            && !self.source_mode
            && (!self.proof_mode || self.split_view);
        if !visible {
            self.retire_math_source_visit(cx);
        } else if let Some(editor) = self.rich.clone()
            && self.math_source.owner != Some(editor.entity_id())
        {
            // One actual mount transition, including return from a route.
            // Retained frames reuse the same context Arc and real form.
            self.install_math_source_context(&editor, cx);
        }
    }
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "../../fixtures/math-write/app-source-host/view_tests.rs"]
mod tests;
