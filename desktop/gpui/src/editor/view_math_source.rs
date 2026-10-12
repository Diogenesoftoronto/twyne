//! Unmounted, qualified host for the original equation-source form.
//!
//! This module deliberately chooses no preview renderer. The application must
//! supply canonical candidate preparation, and inline opening remains refused
//! until its host actually provides an in-flow form slot. See the unapplied
//! integration patch and proof boundaries in fixtures/math-write/source-host.

use super::*;
use crate::editor::math_source_editor::{
    MathPreviewAvailability, MathSourceCancellation, MathSourceEditorEvent, MathSourceEditorView,
    MathSourceOwner, MathSourcePresentation, MathSourceSubmission, MathSourceTarget,
};
use gpui_kit::{InteractiveElement, Role, Subscription};
use uuid::Uuid;

/// Run only at explicit Submit, on a background executor. The application
/// should use its original document_edit::apply_html / semantic converter
/// boundary here. Returning Ok certifies preparation only, never a disk save,
/// successful LaTeX render, or compatible Source preview geometry.
pub type MathSourcePreflight =
    Arc<dyn Fn(&RichDocument) -> Result<(), String> + Send + Sync + 'static>;

#[derive(Clone)]
pub struct MathSourceHostContext {
    pub folio: Arc<str>,
    pub generation: u64,
    pub preflight: Option<MathSourcePreflight>,
    pub presentation: MathSourcePresentation,
    /// Set true only with a real inline child/form reservation in the native
    /// paragraph layout. An overlay or detached test fixture is not that slot.
    pub inline_form_in_flow: bool,
}

impl MathSourceHostContext {
    pub fn new(folio: impl Into<Arc<str>>, generation: u64) -> Self {
        Self {
            folio: folio.into(),
            generation,
            preflight: None,
            presentation: MathSourcePresentation::default(),
            inline_form_in_flow: false,
        }
    }

    fn same_scope(&self, other: &Self) -> bool {
        self.folio == other.folio
            && self.generation == other.generation
            && self.inline_form_in_flow == other.inline_form_in_flow
            && match (&self.preflight, &other.preflight) {
                (None, None) => true,
                (Some(left), Some(right)) => Arc::ptr_eq(left, right),
                _ => false,
            }
    }
}

struct MathSourceSession {
    form: Entity<MathSourceEditorView>,
    target: MathSourceTarget,
    form_id: Uuid,
    generation: u64,
    presentation: MathSourcePresentation,
    _subscription: Subscription,
    _observation: Subscription,
}

#[derive(Default)]
pub(super) struct MathSourceHostState {
    context: Option<MathSourceHostContext>,
    session: Option<MathSourceSession>,
    pending: Option<MathSourceSubmission>,
    task: Option<Task<()>>,
    focus: RefCell<HashMap<NodePath, FocusHandle>>,
}

gpui_kit::actions!(twyne_math_source_host, [EditMathSource]);

pub(super) fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("enter", EditMathSource, Some("TwyneMathAnchor")),
        KeyBinding::new("f2", EditMathSource, Some("TwyneMathAnchor")),
        KeyBinding::new("f2", EditMathSource, Some(EDITOR_KEY_CONTEXT)),
    ]);
}

fn same_target(left: &MathSourceTarget, right: &MathSourceTarget) -> bool {
    left.owner == right.owner
        && left.revision == right.revision
        && left.path == right.path
        && left.position == right.position
        && left.display == right.display
        && left.raw_source == right.raw_source
        && left.expected.shares_storage_with(&right.expected)
}

fn current_target(editor: &RichEditor, target: &MathSourceTarget) -> bool {
    editor.revision() == target.revision
        && editor.document().offset_of_node(&target.path) == Some(target.position)
        && editor.document().node(&target.path).is_some_and(|node| {
            node.shares_storage_with(&target.expected)
                && node
                    .as_element()
                    .is_some_and(|element| element.kind == NodeKind::Math(target.display))
        })
}

/// Descend only the branch containing this scalar; source/image payloads are
/// never traversed. Sibling positions use the model's cached projection lengths.
fn math_path_at(document: &RichDocument, position: usize) -> Option<NodePath> {
    fn descend(nodes: &[Node], position: usize, path: &mut NodePath) -> Option<NodePath> {
        let mut start = 0;
        for (index, node) in nodes.iter().enumerate() {
            let end = start + node.projection_len();
            if start <= position && position < end {
                let element = node.as_element()?;
                path.push(index);
                return if matches!(element.kind, NodeKind::Math(_)) {
                    (position == start).then(|| path.clone())
                } else if element.kind.is_atom() || element.kind == NodeKind::NonContent {
                    None
                } else {
                    descend(&element.children, position - start, path)
                };
            }
            start = end;
        }
        None
    }
    descend(document.nodes(), position, &mut Vec::new())
}

fn prepare_submission(
    mut candidate: RichEditor,
    request: &MathSourceSubmission,
    preflight: &MathSourcePreflight,
) -> Result<Command, String> {
    if candidate.is_read_only() || !current_target(&candidate, &request.target) {
        return Err("The equation target is no longer current.".into());
    }
    candidate.end_history_group();
    let command = request.command();
    candidate
        .execute(command.clone())
        .map_err(|error| error.to_string())?;
    candidate
        .document()
        .validate_html_limits()
        .map_err(|error| error.to_string())?;
    preflight(candidate.document())?;
    Ok(command)
}

impl RichEditorView {
    /// Call at actual folio/visit changes, not every Render. Clearing/replacing
    /// scope destroys the old form; it never submits, acknowledges or focuses.
    pub fn set_math_source_context(
        &mut self,
        context: Option<MathSourceHostContext>,
        cx: &mut Context<Self>,
    ) {
        let context = context.filter(|context| !context.folio.is_empty());
        let unchanged = match (&self.math_source.context, &context) {
            (None, None) => true,
            (Some(left), Some(right)) => left.same_scope(right),
            _ => false,
        };
        if !unchanged {
            // This is the application's actual folio/visit/context boundary.
            // Retire closed-atom jobs independently of form submission state.
            self.retire_atom_owner(cx);
            self.retire_math_source(cx);
            self.math_source.focus.borrow_mut().clear();
        }
        self.math_source.context = context;
        cx.notify();
    }

    pub fn math_source_form(&self) -> Option<Entity<MathSourceEditorView>> {
        self.math_source
            .session
            .as_ref()
            .filter(|session| {
                self.math_source.context.as_ref().is_some_and(|context| {
                    context.folio == session.target.owner.folio
                        && context.generation == session.target.owner.generation
                }) && current_target(&self.editor, &session.target)
                    && self.selection().range()
                        == (session.target.position..session.target.position + 1)
            })
            .map(|session| session.form.clone())
    }

    /// Destroy on editor replacement/hiding. Source's destroy also discards an
    /// unsubmitted field; this has no Save, Cancel-focus or renderer side effect.
    pub fn retire_math_source(&mut self, cx: &mut Context<Self>) {
        self.math_source.task = None;
        self.math_source.pending = None;
        if let Some(session) = self.math_source.session.take() {
            session.form.update(cx, |form, cx| form.retire(cx));
        }
        self.math_source.focus.borrow_mut().clear();
        cx.notify();
    }

    pub(super) fn sync_math_source_read_only(&mut self, cx: &mut Context<Self>) {
        let read_only = self.is_read_only();
        if read_only {
            self.math_source.task = None;
            self.math_source.pending = None;
        }
        if let Some(session) = &self.math_source.session {
            session
                .form
                .update(cx, |form, cx| form.set_read_only(read_only, cx));
        }
    }

    pub(super) fn sync_math_source_target(&mut self, cx: &mut Context<Self>) {
        if self.math_source.session.as_ref().is_some_and(|session| {
            !self.owns_math_target(&session.target, cx)
                || self.selection().range()
                    != (session.target.position..session.target.position + 1)
        }) {
            self.retire_math_source(cx);
        }
    }

    fn owns_math_target(&self, target: &MathSourceTarget, cx: &Context<Self>) -> bool {
        target.owner.editor == cx.entity().entity_id()
            && self.math_source.context.as_ref().is_some_and(|context| {
                target.owner.folio == context.folio && target.owner.generation == context.generation
            })
            && current_target(&self.editor, target)
    }

    pub fn open_math_source_at(
        &mut self,
        path: NodePath,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        let Some(node) = self.document().node(&path).cloned() else {
            return Ok(false);
        };
        let Some(element) = node.as_element() else {
            return Ok(false);
        };
        let NodeKind::Math(display) = element.kind else {
            return Ok(false);
        };
        let position = self
            .document()
            .offset_of_node(&path)
            .ok_or(EditorError::MissingTextBlock)?;
        if self.marked_range.is_some() {
            return Err(EditorError::UnsupportedStructure(
                "Finish composing text before opening an equation",
            ));
        }
        // Source selects the node even when readonly prevents opening a form.
        self.set_selection(Selection::new(position, position + 1), cx)?;
        if self.is_read_only() {
            return Ok(false);
        }
        let context = self
            .math_source
            .context
            .clone()
            .ok_or(EditorError::UnsupportedStructure(
                "Equation source editing is unavailable here",
            ))?;
        if display == crate::editor::MathDisplay::Inline && !context.inline_form_in_flow {
            return Err(EditorError::UnsupportedStructure(
                "Inline equation source editing is unavailable here",
            ));
        }
        if self.math_source.session.as_ref().is_some_and(|session| {
            session.target.path == path && self.owns_math_target(&session.target, cx)
        }) {
            if let Some(session) = &self.math_source.session {
                let focus = session.form.read(cx).focus_handle(cx);
                window.focus(&focus, cx);
            }
            return Ok(false);
        }
        self.flush_note_input(cx)?;
        self.close_note_popup(false, window, cx);
        self.close_note_edit_group();
        self.cancel_block_drag(window, cx);
        self.close_typing_group();
        self.editor.end_history_group();
        self.retire_math_source(cx);
        self.selecting = false;
        self.clear_comment_hover(cx);
        // Note flushing can advance the rich revision; recapture only the
        // original persistent node and real scalar position after that boundary.
        let expected = self
            .document()
            .node(&path)
            .cloned()
            .filter(|current| current.shares_storage_with(&node))
            .ok_or(EditorError::UnsupportedStructure(
                "The equation target changed before it could be opened",
            ))?;
        let position = self
            .document()
            .offset_of_node(&path)
            .ok_or(EditorError::MissingTextBlock)?;
        self.set_selection(Selection::new(position, position + 1), cx)?;
        let target = MathSourceTarget::new(
            MathSourceOwner {
                editor: cx.entity().entity_id(),
                folio: context.folio,
                generation: context.generation,
            },
            self.revision(),
            path,
            position,
            expected,
        )
        .ok_or(EditorError::UnsupportedStructure(
            "The equation target is no longer current",
        ))?;
        let mut presentation = context.presentation;
        // This lane does not connect MathJax or the unapplied CSS renderer.
        presentation.preview = MathPreviewAvailability::Unavailable(Arc::from(
            "Preview unavailable. You can still edit the equation source.",
        ));
        let form = cx
            .new(|cx| MathSourceEditorView::new(target.clone(), presentation.clone(), window, cx));
        let form_id = form.read(cx).form_id();
        let generation = form.read(cx).generation();
        let subscription = cx.subscribe_in(&form, window, |view, sender, event, window, cx| {
            view.math_source_event(sender, event, window, cx);
        });
        let observation = cx.observe(&form, |_, _, cx| cx.notify());
        self.math_source.session = Some(MathSourceSession {
            form,
            target,
            form_id,
            generation,
            presentation,
            _subscription: subscription,
            _observation: observation,
        });
        self.error = None;
        cx.notify();
        Ok(true)
    }

    pub(super) fn edit_selected_math_source(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.math_source.session.is_some() {
            return;
        }
        let range = self.selection().range();
        if range.end != range.start + 1 {
            return;
        }
        if let Some(path) = math_path_at(self.document(), range.start)
            && let Err(error) = self.open_math_source_at(path, window, cx)
        {
            self.error = Some(error.clone());
            cx.emit(RichEditorEvent::Error(error));
            cx.notify();
        }
    }

    fn owns_math_submission(
        &self,
        sender: &Entity<MathSourceEditorView>,
        request: &MathSourceSubmission,
        cx: &Context<Self>,
    ) -> bool {
        !self.is_read_only()
            && self.math_source.session.as_ref().is_some_and(|session| {
                session.form == *sender
                    && session.form_id == request.form_id
                    && session.generation == request.generation
                    && same_target(&session.target, &request.target)
                    && self.owns_math_target(&session.target, cx)
                    && self.selection().range()
                        == (session.target.position..session.target.position + 1)
                    && sender.read(cx).accepts_submission(request, cx)
            })
    }

    fn math_source_event(
        &mut self,
        sender: &Entity<MathSourceEditorView>,
        event: &MathSourceEditorEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            MathSourceEditorEvent::SubmitRequested(request) => {
                if !self.owns_math_submission(sender, request, cx) {
                    return;
                }
                let Some(preflight) = self
                    .math_source
                    .context
                    .as_ref()
                    .and_then(|context| context.preflight.clone())
                else {
                    sender.update(cx, |form, cx| {
                        form.reject_submission(request, "Equation source could not be applied. Your input remains here for retry.", cx);
                    });
                    return;
                };
                if self
                    .math_source
                    .pending
                    .as_ref()
                    .is_some_and(|pending| pending.request_id == request.request_id)
                {
                    return;
                }
                self.close_typing_group();
                self.close_note_edit_group();
                self.editor.end_history_group();
                let candidate = self.editor.clone();
                let request = request.clone();
                let form = sender.clone();
                self.math_source.pending = Some(request.clone());
                self.math_source.task = Some(cx.spawn_in(window, async move |this, cx| {
                    let prepared_request = request.clone();
                    let result = cx
                        .background_executor()
                        .spawn(async move {
                            prepare_submission(candidate, &prepared_request, &preflight)
                        })
                        .await;
                    let _ = this.update_in(cx, |view, window, cx| {
                        view.finish_math_source(&form, &request, result, window, cx);
                    });
                }));
            }
            MathSourceEditorEvent::SubmissionCancelled(request) => {
                if self
                    .math_source
                    .session
                    .as_ref()
                    .is_some_and(|session| session.form == *sender)
                    && self.math_source.pending.as_ref().is_some_and(|pending| {
                        pending.form_id == request.form_id
                            && pending.request_id == request.request_id
                            && pending.generation == request.generation
                            && same_target(&pending.target, &request.target)
                    })
                {
                    self.math_source.task = None;
                    self.math_source.pending = None;
                }
            }
            MathSourceEditorEvent::Cancelled(request) => {
                self.cancel_math_source(sender, request, window, cx)
            }
            MathSourceEditorEvent::PreviewRequested(_)
            | MathSourceEditorEvent::PreviewCancelled(_) => {}
        }
    }

    fn finish_math_source(
        &mut self,
        sender: &Entity<MathSourceEditorView>,
        request: &MathSourceSubmission,
        result: Result<Command, String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.owns_math_submission(sender, request, cx)
            || self
                .math_source
                .pending
                .as_ref()
                .is_none_or(|pending| pending.request_id != request.request_id)
        {
            return;
        }
        self.math_source.task = None;
        self.math_source.pending = None;
        let command = match result {
            Ok(command) if command == request.command() => command,
            Ok(_) => {
                sender.update(cx, |form, cx| { form.reject_submission(request, "Equation source preparation returned a different command. Your input remains in this form.", cx); });
                return;
            }
            Err(error) => {
                sender.update(cx, |form, cx| { form.reject_submission(request, format!("Equation source could not be applied: {error}. Your input remains in this form."), cx); });
                return;
            }
        };
        // Suppress ordinary target invalidation while this one exact accepted
        // command replaces its expected node. Failure reinstates the same form.
        let session = self
            .math_source
            .session
            .take()
            .expect("qualified live math form");
        match self.execute(command, window, cx) {
            Ok(_) => {
                sender.update(cx, |form, cx| {
                    form.acknowledge_submission(request, cx);
                });
                window.focus(&self.focus, cx);
            }
            Err(error) => {
                self.math_source.session = Some(session);
                sender.update(cx, |form, cx| { form.reject_submission(request, format!("Equation source could not be applied: {error}. Your input remains in this form."), cx); });
            }
        }
        cx.notify();
    }

    fn cancel_math_source(
        &mut self,
        sender: &Entity<MathSourceEditorView>,
        request: &MathSourceCancellation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let qualified = self.math_source.session.as_ref().is_some_and(|session| {
            session.form == *sender
                && session.form_id == request.form_id
                && session.generation == request.generation
                && same_target(&session.target, &request.target)
                && self.owns_math_target(&session.target, cx)
                && sender.read(cx).is_retired()
                && sender.read(cx).generation() == request.generation.wrapping_add(1)
        });
        if !qualified {
            return;
        }
        self.retire_math_source(cx);
        let _ = self.set_selection(
            Selection::new(request.target.position, request.target.position + 1),
            cx,
        );
        window.focus(&self.focus, cx);
    }

    /// Opening typography for the same qualified retained child. The inline
    /// flow host uses it only to derive the real label baseline; it must not
    /// recreate the textarea or certify a Source-compatible preview.
    pub fn math_source_presentation(&self) -> Option<MathSourcePresentation> {
        self.math_source_form()?;
        Some(self.math_source.session.as_ref()?.presentation.clone())
    }

    pub(super) fn math_form_at(&self, path: &[usize]) -> Option<Entity<MathSourceEditorView>> {
        self.math_source
            .session
            .as_ref()
            .filter(|session| session.target.path == path)?;
        self.math_source_form()
    }
}

/// Actual one-scalar equation controls placed over the equation's already
/// measured piece. This is an activation hit target, not a form overlay.
pub(super) fn anchor_buttons(
    view: &Entity<RichEditorView>,
    layout: &ParagraphLayout,
    global_start: usize,
    bounds: Bounds<Pixels>,
    window: &mut Window,
    cx: &mut App,
) -> Vec<AnyElement> {
    // Standalone/read-only projections with no installed source owner keep
    // their ordinary caret and drag targets. An unavailable control must not
    // intercept the existing manuscript input path.
    if view.read(cx).math_source.context.is_none() {
        return Vec::new();
    }
    let mut buttons = Vec::new();
    for piece in &layout.pieces {
        if !piece.object || piece.range.end != piece.range.start + 1 {
            continue;
        }
        let position = global_start + piece.range.start;
        let Some(path) = math_path_at(view.read(cx).document(), position) else {
            continue;
        };
        // A real form child owns its controls. Never place an activation hit
        // target over the reserved inline or block form.
        if view.read(cx).math_form_at(&path).is_some() {
            continue;
        }
        let Some(node) = view.read(cx).document().node(&path).cloned() else {
            continue;
        };
        let Some(element) = node.as_element() else {
            continue;
        };
        let NodeKind::Math(display) = element.kind else {
            continue;
        };
        let line = &layout.lines[piece.line];
        let control = Bounds::new(
            bounds.origin + point(piece.origin.x, line.y),
            size(piece.width().max(px(1.)), line.height),
        );
        let cached_focus = view.read(cx).math_source.focus.borrow().get(&path).cloned();
        let focus = cached_focus.unwrap_or_else(|| {
            let focus = cx.focus_handle();
            view.read(cx)
                .math_source
                .focus
                .borrow_mut()
                .insert(path.clone(), focus.clone());
            focus
        });
        let label = format!(
            "{} equation: {}",
            if display == crate::editor::MathDisplay::Block {
                "Block"
            } else {
                "Inline"
            },
            element.shell.attr("data-latex").unwrap_or("empty")
        );
        let owner = view.clone();
        let keyboard_owner = owner.clone();
        let keyboard_path = path.clone();
        let expected = node.clone();
        let keyboard_expected = expected.clone();
        let revision = view.read(cx).revision();
        let scope = view
            .read(cx)
            .math_source
            .context
            .as_ref()
            .map(|context| (context.folio.clone(), context.generation));
        let keyboard_scope = scope.clone();
        let mut button = div()
            .id(SharedString::from(format!(
                "twyne-math-anchor-{}",
                path.iter()
                    .map(usize::to_string)
                    .collect::<Vec<_>>()
                    .join(".")
            )))
            .test_support()
            .role(Role::Button)
            .aria_label(label)
            .aria_description("Activate to edit LaTeX equation")
            .key_context("TwyneMathAnchor")
            .track_focus(&focus)
            .cursor(CursorStyle::PointingHand)
            .w(control.size.width)
            .h(control.size.height)
            // Preserve the parent's whole-block drag gesture. The click
            // selects/opens the atom after the ordinary pointer-down path.
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                owner.update(cx, |view, cx| {
                    if view.revision() == revision
                        && view
                            .math_source
                            .context
                            .as_ref()
                            .map(|context| (context.folio.clone(), context.generation))
                            == scope
                        && view.document().offset_of_node(&path) == Some(position)
                        && view
                            .document()
                            .node(&path)
                            .is_some_and(|node| node.shares_storage_with(&expected))
                        && let Err(error) = view.open_math_source_at(path.clone(), window, cx)
                    {
                        view.error = Some(error.clone());
                        cx.emit(RichEditorEvent::Error(error));
                    }
                });
            })
            .on_action(move |_: &EditMathSource, window, cx| {
                keyboard_owner.update(cx, |view, cx| {
                    if view.revision() == revision
                        && view
                            .math_source
                            .context
                            .as_ref()
                            .map(|context| (context.folio.clone(), context.generation))
                            == keyboard_scope
                        && view.document().offset_of_node(&keyboard_path) == Some(position)
                        && view
                            .document()
                            .node(&keyboard_path)
                            .is_some_and(|node| node.shares_storage_with(&keyboard_expected))
                        && let Err(error) =
                            view.open_math_source_at(keyboard_path.clone(), window, cx)
                    {
                        view.error = Some(error.clone());
                        cx.emit(RichEditorEvent::Error(error));
                    }
                });
            })
            .into_any_element();
        button.prepaint_as_root(
            control.origin,
            size(
                AvailableSpace::Definite(control.size.width),
                AvailableSpace::Definite(control.size.height),
            ),
            window,
            cx,
        );
        buttons.push(button);
    }
    buttons
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "../../fixtures/math-write/source-host/host_tests.rs"]
mod tests;
