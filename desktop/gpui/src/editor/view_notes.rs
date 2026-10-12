//! Native, source-preserving note references and the inline note editor.
//!
//! Ordinals and marker text belong to the view. The atom's authored shell and
//! unknown metadata remain in the structured document.
use super::*;
use gpui_kit::base::input::{InputEvent, TextareaState};
use gpui_kit::component::{
    IndexPath,
    input::Textarea,
    searchable_list::SearchableVec,
    select::{Select, SelectEvent, SelectItem, SelectState},
    tooltip::Tooltip,
};
use gpui_kit::{InteractiveElement, Subscription, deferred};

gpui_kit::actions!(twyne_inline_notes, [DismissNote, UndoNote, RedoNote]);

pub(super) fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("escape", DismissNote, Some("TwyneNoteAnchor")),
        KeyBinding::new("escape", DismissNote, Some("TwyneInlineNotePopover")),
    ]);
    #[cfg(target_os = "macos")]
    let modifier = "cmd";
    #[cfg(not(target_os = "macos"))]
    let modifier = "ctrl";
    cx.bind_keys([
        KeyBinding::new(
            &format!("{modifier}-z"),
            UndoNote,
            Some("TwyneInlineNotePopover && Input"),
        ),
        KeyBinding::new(
            &format!("{modifier}-shift-z"),
            RedoNote,
            Some("TwyneInlineNotePopover && Input"),
        ),
        KeyBinding::new(
            &format!("{modifier}-y"),
            RedoNote,
            Some("TwyneInlineNotePopover && Input"),
        ),
        KeyBinding::new(&format!("{modifier}-z"), UndoNote, Some("TwyneNoteAnchor")),
        KeyBinding::new(
            &format!("{modifier}-shift-z"),
            RedoNote,
            Some("TwyneNoteAnchor"),
        ),
    ]);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoteReference {
    pub kind: NoteKind,
    pub number: usize,
    pub position: usize,
    pub text: Arc<str>,
    pub path: NodePath,
    /// A persistent identity guard; a later atom at the same path is refused.
    pub node: Node,
}

impl NoteReference {
    pub fn range(&self) -> Range<usize> {
        self.position..self.position + 1
    }
    fn label(&self) -> String {
        format!("{} {}", kind_label(self.kind), self.number)
    }
    fn accessible_label(&self) -> String {
        format!(
            "{}: {}. Activate to edit.",
            self.label(),
            if self.text.is_empty() {
                "Empty note"
            } else {
                &self.text
            }
        )
    }
}

fn kind_label(kind: NoteKind) -> &'static str {
    if kind == NoteKind::Footnote {
        "Footnote"
    } else {
        "Endnote"
    }
}

#[derive(Clone)]
struct RelativeNote {
    path: NodePath,
    position: usize,
    kind: NoteKind,
    text: Arc<str>,
    node: Node,
}
struct CachedNotes {
    node: Node,
    notes: Arc<[RelativeNote]>,
}

#[derive(Default)]
struct NoteCatalog {
    revision: Option<u64>,
    nodes: HashMap<NodePath, CachedNotes>,
    references: Arc<[NoteReference]>,
    #[cfg(test)]
    rebuilt: usize,
}

impl NoteCatalog {
    fn subtree(&mut self, node: &Node, path: &[usize]) -> Arc<[RelativeNote]> {
        if node.note_counts() == [0; 2] {
            return Arc::from([]);
        }
        if let Some(cached) = self.nodes.get(path)
            && cached.node.shares_storage_with(node)
        {
            return cached.notes.clone();
        }
        #[cfg(test)]
        {
            self.rebuilt += 1;
        }
        let Some(element) = node.as_element() else {
            return Arc::from([]);
        };
        let notes: Arc<[RelativeNote]> = if let NodeKind::Note(kind) = element.kind {
            Arc::from([RelativeNote {
                path: Vec::new(),
                position: 0,
                kind,
                text: Arc::from(element.shell.attr("data-endnote-text").unwrap_or("")),
                node: node.clone(),
            }])
        } else {
            let mut notes = Vec::new();
            let mut position = 0;
            for (index, child) in element.children.iter().enumerate() {
                if child.note_counts() != [0; 2] {
                    let mut child_path = path.to_vec();
                    child_path.push(index);
                    for note in self.subtree(child, &child_path).iter() {
                        let mut relative = note.clone();
                        relative.position += position;
                        relative.path.insert(0, index);
                        notes.push(relative);
                    }
                }
                position += child.projection_len();
            }
            notes.into()
        };
        self.nodes.insert(
            path.to_vec(),
            CachedNotes {
                node: node.clone(),
                notes: notes.clone(),
            },
        );
        notes
    }
    fn references(&mut self, document: &RichDocument, revision: u64) -> Arc<[NoteReference]> {
        if self.revision == Some(revision) {
            return self.references.clone();
        }
        let mut references = Vec::new();
        let mut position = 0;
        let mut counts = [0; 2];
        for (index, node) in document.nodes().iter().enumerate() {
            if node.note_counts() != [0; 2] {
                for note in self.subtree(node, &[index]).iter() {
                    let kind_index = usize::from(note.kind == NoteKind::Footnote);
                    counts[kind_index] += 1;
                    let mut path = vec![index];
                    path.extend(&note.path);
                    references.push(NoteReference {
                        kind: note.kind,
                        number: counts[kind_index],
                        position: position + note.position,
                        text: note.text.clone(),
                        path,
                        node: note.node.clone(),
                    });
                }
            }
            position += node.projection_len();
        }
        // Prune old paths only at this explicit note-list/open boundary.
        self.nodes.retain(|path, cached| {
            document
                .node(path)
                .is_some_and(|node| node.shares_storage_with(&cached.node))
        });
        self.revision = Some(revision);
        self.references = references.into();
        self.references.clone()
    }
}

#[derive(Default)]
pub(super) struct NotesState {
    catalog: RefCell<NoteCatalog>,
    pub geometry: RefCell<HashMap<NodePath, NoteGeometry>>,
    pub focus: RefCell<HashMap<NodePath, FocusHandle>>,
    pub hover: Option<NodePath>,
    popup: Option<NotePopup>,
    edit_group: Option<(NodePath, Instant)>,
    flash: Option<(NodePath, Instant)>,
}
pub(super) struct NoteGeometry {
    reference: NoteReference,
    pub bounds: Bounds<Pixels>,
}
struct NotePopup {
    reference: NoteReference,
    input: Entity<TextareaState>,
    _subscription: Subscription,
    scroll: gpui_kit::ScrollHandle,
    kind: Entity<SelectState<SearchableVec<NoteChoice>>>,
    _kind_subscription: Subscription,
}

#[derive(Clone)]
struct NoteChoice(NoteKind);
impl SelectItem for NoteChoice {
    type Value = NoteKind;
    fn title(&self) -> SharedString {
        kind_label(self.0).into()
    }
    fn value(&self) -> &NoteKind {
        &self.0
    }
}

#[derive(Clone)]
pub(super) struct Marker {
    path: NodePath,
    kind: NoteKind,
    number: usize,
    node: Node,
    text: Arc<str>,
    quiet_shape: ShapedLine,
    hover_shape: ShapedLine,
    quiet_tracking: Option<Arc<TrackedText>>,
    hover_tracking: Option<Arc<TrackedText>>,
}

/// Resolve the note leaves once when this changed block is shaped. Persistent
/// subtree counts prune every source/image atom and note-free branch.
pub(super) fn block_paths(block: &RichBlock) -> HashMap<usize, NodePath> {
    fn walk(node: &Node, path: &mut NodePath, start: usize, output: &mut HashMap<usize, NodePath>) {
        if node.note_counts() == [0; 2] {
            return;
        }
        let Some(element) = node.as_element() else {
            return;
        };
        if matches!(element.kind, NodeKind::Note(_)) {
            output.insert(start, path.clone());
            return;
        }
        let mut position = start;
        for (index, child) in element.children.iter().enumerate() {
            path.push(index);
            walk(child, path, position, output);
            path.pop();
            position += child.projection_len();
        }
    }
    let mut paths = HashMap::new();
    walk(&block.node, &mut block.path.clone(), 0, &mut paths);
    paths
}

pub(super) struct MarkerStyle<'a> {
    pub shape: &'a ShapedLine,
    pub style: &'a TextRun,
    pub size: Pixels,
    pub colors: &'a theme::Palette,
    pub spacing: Pixels,
}
pub(super) fn marker(
    path: NodePath,
    node: Node,
    kind: NoteKind,
    number: usize,
    style: MarkerStyle<'_>,
    window: &mut Window,
) -> Marker {
    let recolor = |color: u32| {
        let mut text_run = style.style.clone();
        text_run.color = rgb(color).into();
        window
            .text_system()
            .shape_line(style.shape.text.clone(), style.size, &[text_run], None)
    };
    let quiet_shape = recolor(style.colors.ink_muted);
    let hover_shape = recolor(if kind == NoteKind::Footnote {
        style.colors.cobalt
    } else {
        style.colors.vermilion_deep
    });
    let quiet_tracking =
        (style.spacing != px(0.)).then(|| Arc::new(TrackedText::new(&quiet_shape, style.spacing)));
    let hover_tracking =
        (style.spacing != px(0.)).then(|| Arc::new(TrackedText::new(&hover_shape, style.spacing)));
    Marker {
        path,
        kind,
        number,
        text: Arc::from(
            node.as_element()
                .and_then(|element| element.shell.attr("data-endnote-text"))
                .unwrap_or(""),
        ),
        node,
        quiet_shape,
        hover_shape,
        quiet_tracking,
        hover_tracking,
    }
}

pub(super) fn marker_bounds(piece: &Piece, line: &VisualLine) -> Bounds<Pixels> {
    let ink_height = piece.shape.ascent + piece.shape.descent;
    Bounds::new(
        piece.origin
            + point(
                px(0.),
                (piece.math_row_height.unwrap_or(line.height) - ink_height) / 2.,
            ),
        size(piece.width(), ink_height),
    )
}

pub(super) fn marker_button(
    marker: &Marker,
    piece: &Piece,
    global_start: usize,
    view: Entity<RichEditorView>,
    bounds: Bounds<Pixels>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let reference = NoteReference {
        kind: marker.kind,
        number: marker.number,
        position: global_start + piece.range.start,
        text: marker.text.clone(),
        path: marker.path.clone(),
        node: marker.node.clone(),
    };
    let id: SharedString = format!(
        "twyne-note-reference-{}",
        marker
            .path
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join("-")
    )
    .into();
    let focus = window
        .use_keyed_state(id.clone(), cx, |_, cx| cx.focus_handle())
        .read(cx)
        .clone();
    view.read(cx)
        .notes
        .focus
        .borrow_mut()
        .insert(reference.path.clone(), focus.clone());
    view.read(cx).notes.geometry.borrow_mut().insert(
        reference.path.clone(),
        NoteGeometry {
            reference: reference.clone(),
            bounds,
        },
    );
    let label = reference.accessible_label();
    let tooltip = reference.text.to_string();
    let pointer_focus = focus.clone();
    let pointer_view = view.clone();
    let hover_view = view.clone();
    let hovered_path = reference.path.clone();
    gpui_kit::base::Button::new(id)
        .track_focus(&focus)
        .key_context("TwyneNoteAnchor")
        .w(bounds.size.width)
        .h(bounds.size.height)
        .accessibility_label(label)
        .cursor(CursorStyle::PointingHand)
        .tooltip(move |window, cx| Tooltip::new(tooltip.clone()).build(window, cx))
        .on_hover(move |hovered, _, cx| {
            hover_view.update(cx, |view, cx| {
                let path = if *hovered {
                    Some(hovered_path.clone())
                } else {
                    None
                };
                if *hovered || view.notes.hover.as_ref() == Some(&hovered_path) {
                    view.notes.hover = path;
                    cx.notify();
                }
            });
        })
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            window.focus(&pointer_focus, cx);
            window.prevent_default();
            cx.stop_propagation();
            pointer_view.update(cx, |view, _| view.selecting = false);
        })
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            view.update(cx, |view, cx| {
                let _ = view.open_note(&reference, window, cx);
            });
        })
        .into_any_element()
}

pub(super) struct PaintState {
    pub quiet: bool,
    pub hover: Option<NodePath>,
    pub flash: Option<(NodePath, Instant)>,
    pub colors: theme::Palette,
}
pub(super) fn paint_marker(
    marker: &Marker,
    piece: &Piece,
    line: &VisualLine,
    origin: Point<Pixels>,
    state: &PaintState,
    selected: bool,
    window: &mut Window,
) -> (ShapedLine, Option<Arc<TrackedText>>) {
    let colors = &state.colors;
    let bounds = marker_bounds(piece, line);
    let bounds = Bounds::new(origin + bounds.origin, bounds.size);
    let quiet = state.quiet;
    let hovered = state.hover.as_ref() == Some(&marker.path);
    let color = rgb(if quiet {
        colors.ink_muted
    } else if marker.kind == NoteKind::Footnote {
        colors.cobalt
    } else if hovered {
        colors.vermilion_deep
    } else {
        colors.vermilion
    });
    if !quiet && hovered {
        window.paint_quad(fill(
            bounds,
            rgb(if marker.kind == NoteKind::Footnote {
                colors.cobalt
            } else {
                colors.vermilion
            })
            .opacity(if marker.kind == NoteKind::Footnote {
                0.12
            } else {
                0.10
            }),
        ));
    }
    if selected {
        let mut outline = gpui_kit::outline(
            Bounds::new(
                bounds.origin - point(px(2.5), px(2.5)),
                bounds.size + size(px(5.), px(5.)),
            ),
            rgb(colors.vermilion),
            gpui_kit::BorderStyle::Solid,
        );
        outline.border_widths = px(1.5).into();
        window.paint_quad(outline);
    }
    if let Some((path, started)) = &state.flash
        && path == &marker.path
    {
        let progress = started.elapsed().as_secs_f32() / 1.4;
        if progress < 1. {
            let fade = if progress < 0.35 {
                1.
            } else {
                let segment = (progress - 0.35) / 0.65;
                1. - gpui_kit::base::animation::cubic_bezier(0., 0., 0.58, 1.)(segment)
            };
            window.paint_quad(fill(bounds, color.opacity(0.3 * fade)));
            window.request_animation_frame();
        }
    }
    if quiet {
        (marker.quiet_shape.clone(), marker.quiet_tracking.clone())
    } else if hovered {
        (marker.hover_shape.clone(), marker.hover_tracking.clone())
    } else {
        (piece.shape.clone(), piece.tracking.clone())
    }
}

impl RichEditorView {
    pub(super) fn notes_has_popup(&self) -> bool {
        self.notes.popup.is_some()
    }
    pub(super) fn note_edit_group_open(&self) -> bool {
        self.notes.edit_group.is_some()
    }
    pub(super) fn note_paint_state(&self, colors: theme::Palette) -> PaintState {
        PaintState {
            quiet: self.comments_quiet,
            hover: self.notes.hover.clone(),
            flash: self.notes.flash.clone(),
            colors,
        }
    }
    /// An explicit list/open boundary. Unchanged note-bearing subtrees reuse
    /// their relative projections; no prose leaf is scanned on ordinary input.
    pub fn note_references(&self) -> Arc<[NoteReference]> {
        self.notes
            .catalog
            .borrow_mut()
            .references(self.document(), self.revision())
    }
    fn current_note(&self, reference: &NoteReference) -> bool {
        self.document().node(&reference.path).is_some_and(|node| {
            node.shares_storage_with(&reference.node)
                && self.document().offset_of_node(&reference.path) == Some(reference.position)
        })
    }
    /// The measured marker box in window coordinates, with no source traversal.
    pub fn note_bounds(&self, reference: &NoteReference) -> Option<Bounds<Pixels>> {
        let geometry = self.notes.geometry.borrow();
        let geometry = geometry.get(&reference.path)?;
        (geometry.reference.node.shares_storage_with(&reference.node)
            && geometry.reference.position == reference.position)
            .then_some(geometry.bounds)
    }
    pub fn jump_note(
        &mut self,
        reference: &NoteReference,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        if !self.current_note(reference) {
            return Ok(false);
        }
        if self.marked_range.is_some() {
            return Err(EditorError::UnsupportedStructure(
                "Finish composing text before jumping to a note",
            ));
        }
        self.close_note_popup(false, window, cx);
        self.set_selection(
            Selection::new(reference.position, reference.position + 1),
            cx,
        )?;
        let focus = self
            .notes
            .focus
            .borrow()
            .get(&reference.path)
            .cloned()
            .unwrap_or_else(|| self.focus.clone());
        window.focus(&focus, cx);
        self.notes.flash = (!cx.reduce_motion()).then(|| (reference.path.clone(), Instant::now()));
        cx.notify();
        Ok(true)
    }
    pub(super) fn close_note_edit_group(&mut self) {
        if self.notes.edit_group.take().is_some() {
            self.editor.end_history_group();
        }
    }
    pub(super) fn close_note_popup(
        &mut self,
        return_focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Err(error) = self.flush_note_input(cx) {
            self.error = Some(error);
        }
        self.close_note_edit_group();
        if let Some(popup) = self.notes.popup.take() {
            if return_focus && self.current_note(&popup.reference) {
                let _ = self.set_selection(
                    Selection::new(popup.reference.position, popup.reference.position + 1),
                    cx,
                );
                let focus = self
                    .notes
                    .focus
                    .borrow()
                    .get(&popup.reference.path)
                    .cloned()
                    .unwrap_or_else(|| self.focus.clone());
                window.focus(&focus, cx);
            }
            cx.notify();
        }
    }
    fn reference_at_path(&self, path: &[usize]) -> Option<NoteReference> {
        let node = self.document().node(path)?;
        let element = node.as_element()?;
        let NodeKind::Note(kind) = element.kind else {
            return None;
        };
        Some(NoteReference {
            kind,
            number: self.document().note_counts_before_node(path)?
                [usize::from(kind == NoteKind::Footnote)]
                + 1,
            position: self.document().offset_of_node(path)?,
            text: Arc::from(element.shell.attr("data-endnote-text").unwrap_or("")),
            path: path.to_vec(),
            node: node.clone(),
        })
    }
    fn open_note(
        &mut self,
        reference: &NoteReference,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        if !self.current_note(reference) {
            return Ok(false);
        }
        if self.marked_range.is_some() {
            return Err(EditorError::UnsupportedStructure(
                "Finish composing text before opening a note",
            ));
        }
        self.cancel_block_drag(window, cx);
        self.close_typing_group();
        self.close_note_popup(false, window, cx);
        self.selecting = false;
        self.clear_comment_hover(cx);
        let input =
            cx.new(|cx| TextareaState::new(window, cx).default_value(reference.text.to_string()));
        let subscription = cx.subscribe_in(&input, window, |this, input, event, window, cx| {
            if matches!(event, InputEvent::Change)
                && this
                    .notes
                    .popup
                    .as_ref()
                    .is_some_and(|popup| popup.input == *input)
            {
                let value = input.read(cx).value().to_string();
                this.note_text_changed(value, window, cx);
            }
        });
        let kind = cx.new(|cx| {
            SelectState::new(
                SearchableVec::new(vec![
                    NoteChoice(NoteKind::Footnote),
                    NoteChoice(NoteKind::Endnote),
                ]),
                Some(IndexPath::new(usize::from(
                    reference.kind == NoteKind::Endnote,
                ))),
                window,
                cx,
            )
            .searchable(false)
        });
        let kind_subscription = cx.subscribe_in(&kind, window, |this, input, event, window, cx| {
            if this
                .notes
                .popup
                .as_ref()
                .is_some_and(|popup| popup.kind == *input)
                && let SelectEvent::Confirm(Some(kind)) = event
            {
                this.convert_note(*kind, window, cx);
            }
        });
        self.notes.popup = Some(NotePopup {
            reference: reference.clone(),
            input: input.clone(),
            _subscription: subscription,
            scroll: gpui_kit::ScrollHandle::new(),
            kind,
            _kind_subscription: kind_subscription,
        });
        let view = cx.entity().downgrade();
        window.on_next_frame(move |window, cx| {
            let _ = view.update(cx, |view, cx| {
                if view
                    .notes
                    .popup
                    .as_ref()
                    .is_some_and(|popup| popup.input == input)
                {
                    let focus = input.read(cx).focus_handle(cx);
                    window.focus(&focus, cx);
                    input.update(cx, |input, cx| {
                        let end = input.value().len();
                        input.set_selected_range(end..end, cx);
                    });
                }
            });
        });
        cx.notify();
        Ok(true)
    }
    fn note_text_changed(&mut self, value: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Err(error) = self.apply_note_text(value, cx) {
            self.error = Some(error);
            self.close_note_edit_group();
            self.restore_note_input(cx, window);
            cx.notify();
        }
    }
    fn apply_note_text(
        &mut self,
        value: String,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        let Some(reference) = self
            .notes
            .popup
            .as_ref()
            .map(|popup| popup.reference.clone())
        else {
            return Ok(false);
        };
        if reference.text.as_ref() == value {
            return Ok(false);
        }
        if self.is_read_only() {
            return Err(EditorError::ReadOnly);
        }
        if !self.current_note(&reference) {
            return Err(EditorError::UnsupportedStructure(
                "The note changed before its text could be applied",
            ));
        }
        let now = Instant::now();
        if !self.notes.edit_group.as_ref().is_some_and(|(path, time)| {
            *path == reference.path && now.duration_since(*time) <= Duration::from_millis(500)
        }) {
            self.close_note_edit_group();
            self.editor.begin_history_group();
        }
        self.notes.edit_group = Some((reference.path.clone(), now));
        let result = self.accept_note_update(
            Command::UpdateNote {
                path: reference.path,
                expected: reference.node,
                text: Some(value),
                kind: None,
            },
            cx,
        );
        if result.is_err() {
            self.close_note_edit_group();
        }
        result
    }
    /// Capture a retained native field before explicit save/close boundaries,
    /// even when its Change/Confirm subscription is still queued. Previewing
    /// an unconfirmed kind menu never changes its committed selected_value.
    pub fn flush_note_input(&mut self, cx: &mut Context<Self>) -> Result<bool, EditorError> {
        let Some((value, kind)) = self.notes.popup.as_ref().map(|popup| {
            (
                popup.input.read(cx).value().to_string(),
                popup.kind.read(cx).selected_value().copied(),
            )
        }) else {
            return Ok(false);
        };
        let mut changed = self.apply_note_text(value, cx)?;
        if let Some(kind) = kind {
            changed |= self.apply_note_kind(kind, cx)?;
        }
        Ok(changed)
    }
    fn apply_note_kind(
        &mut self,
        kind: NoteKind,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        let Some(reference) = self
            .notes
            .popup
            .as_ref()
            .map(|popup| popup.reference.clone())
        else {
            return Ok(false);
        };
        if reference.kind == kind {
            return Ok(false);
        }
        if self.is_read_only() {
            return Err(EditorError::ReadOnly);
        }
        if !self.current_note(&reference) {
            return Err(EditorError::UnsupportedStructure(
                "The note changed before its kind could be applied",
            ));
        }
        self.close_note_edit_group();
        self.accept_note_update(
            Command::UpdateNote {
                path: reference.path,
                expected: reference.node,
                text: None,
                kind: Some(kind),
            },
            cx,
        )
    }
    // Note-only updates do not need window input/drag/layout APIs. Keeping
    // this primitive window-free lets the host flush during Save or Quit.
    fn accept_note_update(
        &mut self,
        command: Command,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        let before = self.snapshot();
        let outcome = self.editor.execute(command)?;
        if outcome.document_changed {
            cx.emit(RichEditorEvent::Transacted {
                before,
                after: self.snapshot(),
                revision: self.revision(),
            });
            let current = self
                .notes
                .popup
                .as_ref()
                .and_then(|popup| self.reference_at_path(&popup.reference.path));
            if let Some(popup) = &mut self.notes.popup
                && let Some(current) = current
            {
                popup.reference = current;
            }
            self.error = None;
            self.clear_comment_hover(cx);
            self.comment_focus.borrow_mut().clear();
            cx.emit(RichEditorEvent::Changed {
                revision: self.editor.revision(),
            });
        }
        if outcome.selection_changed {
            cx.emit(RichEditorEvent::SelectionChanged);
        }
        cx.notify();
        Ok(outcome.document_changed)
    }
    fn restore_note_input(&self, cx: &mut Context<Self>, window: &mut Window) {
        if let Some(popup) = &self.notes.popup {
            let text = popup.reference.text.to_string();
            popup
                .input
                .update(cx, |input, cx| input.set_value(text, window, cx));
        }
    }
    pub(super) fn sync_note_popup(
        &mut self,
        allow_changed_identity: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(previous) = self
            .notes
            .popup
            .as_ref()
            .map(|popup| popup.reference.clone())
        else {
            return;
        };
        let current = self.reference_at_path(&previous.path).filter(|current| {
            current.position == previous.position
                && (allow_changed_identity || current.node.shares_storage_with(&previous.node))
        });
        let Some(current) = current else {
            self.close_note_popup(false, window, cx);
            return;
        };
        if let Some(popup) = &mut self.notes.popup {
            popup.reference = current;
            if (allow_changed_identity || previous.kind != popup.reference.kind)
                && popup.kind.read(cx).selected_value() != Some(&popup.reference.kind)
            {
                popup.kind.update(cx, |kind, cx| {
                    kind.set_selected_value(&popup.reference.kind, window, cx)
                });
            }
            // Source input listeners commit synchronously. Native Change may
            // still be queued after typing or blur, so an ordinary frame must
            // retain that field. Accepted edits/Undo synchronize explicitly.
            let input = popup.input.read(cx);
            let replace_value =
                allow_changed_identity && input.value().as_ref() != popup.reference.text.as_ref();
            if replace_value {
                let text = popup.reference.text.to_string();
                popup
                    .input
                    .update(cx, |input, cx| input.set_value(text, window, cx));
            }
        }
    }
    pub(super) fn prepare_note_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_dragging() {
            self.close_note_popup(false, window, cx);
            self.notes.hover = None;
        }
        self.sync_note_popup(false, window, cx);
        self.notes.geometry.borrow_mut().clear();
        self.notes.focus.borrow_mut().clear();
    }
    fn navigate_note(&mut self, next: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(reference) = self
            .notes
            .popup
            .as_ref()
            .map(|popup| popup.reference.clone())
        else {
            return;
        };
        let references = self.note_references();
        let Some(index) = references.iter().position(|note| {
            note.path == reference.path && note.node.shares_storage_with(&reference.node)
        }) else {
            return;
        };
        let target = if next {
            references.get(index + 1)
        } else {
            index.checked_sub(1).and_then(|index| references.get(index))
        };
        if let Some(target) = target {
            let target = target.clone();
            if self.jump_note(&target, window, cx).unwrap_or(false) {
                let _ = self.open_note(&target, window, cx);
            }
        }
    }
    fn convert_note(&mut self, kind: NoteKind, window: &mut Window, cx: &mut Context<Self>) {
        let result = self
            .notes
            .popup
            .as_ref()
            .map(|popup| popup.input.read(cx).value().to_string())
            .map_or(Ok(false), |value| self.apply_note_text(value, cx))
            .and_then(|_| self.apply_note_kind(kind, cx));
        if let Err(error) = result {
            self.error = Some(error);
            self.restore_note_input(cx, window);
            self.sync_note_popup(true, window, cx);
            cx.notify();
        }
    }
    fn delete_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush_note_input(cx).is_err() {
            return;
        }
        let Some(reference) = self
            .notes
            .popup
            .as_ref()
            .map(|popup| popup.reference.clone())
        else {
            return;
        };
        if self.is_read_only() || !self.current_note(&reference) {
            return;
        }
        if self
            .execute(
                Command::DeleteNote {
                    path: reference.path,
                    expected: reference.node,
                },
                window,
                cx,
            )
            .is_ok()
        {
            self.close_note_popup(false, window, cx);
            window.focus(&self.focus, cx);
        }
    }

    /// Hide a retained native popover before its host hides/removes Write.
    pub fn hide_note_popup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_note_popup(false, window, cx);
        self.notes.hover = None;
        self.notes.flash = None;
    }
    pub(super) fn dismiss_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.notes.popup.is_some() {
            self.close_note_popup(true, window, cx);
        } else {
            let path = self
                .notes
                .focus
                .borrow()
                .iter()
                .find_map(|(path, focus)| focus.is_focused(window).then(|| path.clone()));
            if let Some(reference) = path.and_then(|path| self.reference_at_path(&path)) {
                let _ = self.set_selection(
                    Selection::new(reference.position, reference.position + 1),
                    cx,
                );
            }
        }
    }
    pub(super) fn note_history(
        &mut self,
        command: Command,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Err(error) = self.flush_note_input(cx) {
            self.error = Some(error);
            cx.notify();
            return;
        }
        let _ = self.execute(command, window, cx);
    }
}

fn action_button(
    id: &'static str,
    label: &'static str,
    disabled: bool,
    colors: &theme::Palette,
) -> gpui_kit::base::Button {
    gpui_kit::base::Button::new(id)
        .accessibility_label(label)
        .disabled(disabled)
        .font_family(TYPEWRITER_FONT)
        .text_size(px(11.52))
        .line_height(relative(1.45))
        .px(px(8.))
        .py(px(5.6))
        .border_1()
        .border_color(rgb(colors.rule))
        .rounded(px(3.))
        .bg(rgb(colors.paper_soft))
        .text_color(rgb(colors.ink))
        .cursor(CursorStyle::PointingHand)
        .child(label)
}

fn panel(
    view: Entity<RichEditorView>,
    width: Pixels,
    viewport_height: Pixels,
    cx: &mut App,
) -> Option<AnyElement> {
    let (reference, input, kind, scroll, read_only, previous, next) = {
        let state = view.read(cx);
        let popup = state.notes.popup.as_ref()?;
        let notes = state.note_references();
        let index = notes.iter().position(|note| {
            note.path == popup.reference.path
                && note.node.shares_storage_with(&popup.reference.node)
        })?;
        (
            popup.reference.clone(),
            popup.input.clone(),
            popup.kind.clone(),
            popup.scroll.clone(),
            state.is_read_only(),
            index > 0,
            index + 1 < notes.len(),
        )
    };
    let colors = *theme::palette(cx);
    let previous_view = view.clone();
    let next_view = view.clone();
    let reference_view = view.clone();
    let delete_view = view.clone();
    let escape_view = view.clone();
    let input_escape_view = view.clone();
    let undo_view = view.clone();
    let redo_view = view.clone();
    let dismiss_view = view.clone();
    Some(
        div()
            .id("twyne-inline-note-popover")
            .test_support()
            .role(gpui_kit::Role::Dialog)
            .aria_label(reference.label())
            .key_context("TwyneInlineNotePopover")
            .w(width)
            .max_h((viewport_height - px(32.)).max(px(120.)))
            .overflow_y_scroll()
            .track_scroll(&scroll)
            .p(px(12.8))
            .border_1()
            .border_color(rgb(colors.rule))
            .rounded(px(4.))
            .bg(rgb(colors.paper))
            .text_color(rgb(colors.ink))
            .font_family(TYPEWRITER_FONT)
            .shadow(vec![
                gpui_kit::BoxShadow::new(px(0.), px(12.), rgb(colors.shade).opacity(0.18).into())
                    .blur_radius(px(36.)),
            ])
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| {
                cx.stop_propagation();
            })
            .on_mouse_down_out(move |event, window, cx| {
                let marker_clicked = dismiss_view
                    .read(cx)
                    .notes
                    .geometry
                    .borrow()
                    .values()
                    .any(|note| note.bounds.contains(&event.position));
                if !marker_clicked {
                    dismiss_view.update(cx, |view, cx| view.close_note_popup(false, window, cx));
                }
            })
            .on_action(move |_: &DismissNote, window, cx| {
                escape_view.update(cx, |view, cx| view.dismiss_note(window, cx))
            })
            .on_action(move |_: &gpui_kit::base::input::Escape, window, cx| {
                input_escape_view.update(cx, |view, cx| view.dismiss_note(window, cx))
            })
            .on_action(move |_: &UndoNote, window, cx| {
                undo_view.update(cx, |view, cx| {
                    view.note_history(Command::Undo, window, cx);
                })
            })
            .on_action(move |_: &RedoNote, window, cx| {
                redo_view.update(cx, |view, cx| {
                    view.note_history(Command::Redo, window, cx);
                })
            })
            .child(
                div()
                    .id("twyne-note-heading")
                    .test_support()
                    .mb(px(8.8))
                    .font_weight(FontWeight::BOLD)
                    .child(crate::chrome::tracked_text(
                        &reference.label().to_uppercase(),
                        Font {
                            weight: FontWeight::BOLD,
                            ..font(TYPEWRITER_FONT)
                        },
                        11.52,
                        0.9216,
                        colors.ink,
                        17.28,
                    )),
            )
            .child(
                div().id("twyne-note-text").test_support().child(
                    Textarea::new(&input)
                        .accessibility_id("twyne-note-text")
                        .aria_label("Note text")
                        .appearance(false)
                        .xsmall()
                        .font_family(TYPEWRITER_FONT)
                        .line_height(relative(1.45))
                        .text_size(px(16.))
                        .h(px(135.6))
                        .px(px(4.8))
                        .py(px(8.8))
                        .border_1()
                        .border_color(rgb(colors.rule))
                        .rounded(px(3.))
                        .bg(rgb(colors.paper_soft))
                        .text_color(rgb(colors.ink))
                        .readonly(read_only),
                ),
            )
            .child(
                div()
                    .mt(px(10.4))
                    .flex()
                    .items_center()
                    .gap(px(6.4))
                    .text_size(px(12.))
                    .child("Kind")
                    .child(
                        // Kit's semantic Select root fills its parent; the
                        // inner trigger alone consumes the styled width.
                        // Give both the same actual native hit/focus bounds.
                        div().w(px(144.)).h(px(28.)).flex_none().child(
                            Select::new(&kind)
                                .id("twyne-note-kind")
                                .accessibility_label("Note kind")
                                .small()
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(12.))
                                .w_full()
                                .h_full()
                                .rounded(px(3.))
                                .bg(rgb(colors.paper_soft))
                                .text_color(rgb(colors.ink))
                                .border_color(rgb(colors.rule))
                                .disabled(read_only),
                        ),
                    ),
            )
            .child(
                div()
                    .mt(px(12.))
                    .flex()
                    .flex_wrap()
                    .gap(px(5.6))
                    .child(
                        action_button("twyne-note-previous", "Previous", !previous, &colors)
                            .on_click(move |_, window, cx| {
                                previous_view
                                    .update(cx, |view, cx| view.navigate_note(false, window, cx))
                            }),
                    )
                    .child(
                        action_button("twyne-note-return", "Reference", false, &colors).on_click(
                            move |_, window, cx| {
                                reference_view
                                    .update(cx, |view, cx| view.close_note_popup(true, window, cx))
                            },
                        ),
                    )
                    .child(
                        action_button("twyne-note-next", "Next", !next, &colors).on_click(
                            move |_, window, cx| {
                                next_view
                                    .update(cx, |view, cx| view.navigate_note(true, window, cx))
                            },
                        ),
                    )
                    .child(
                        action_button("twyne-note-delete", "Delete", read_only, &colors).on_click(
                            move |_, window, cx| {
                                delete_view.update(cx, |view, cx| view.delete_note(window, cx))
                            },
                        ),
                    ),
            )
            .into_any_element(),
    )
}

pub(super) fn popover(view: Entity<RichEditorView>) -> AnyElement {
    deferred(NotePopoverElement { view })
        .priority(2)
        .into_any_element()
}
struct NotePopoverElement {
    view: Entity<RichEditorView>,
}
impl IntoElement for NotePopoverElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl gpui_kit::Element for NotePopoverElement {
    type RequestLayoutState = ();
    type PrepaintState = Option<AnyElement>;
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let style = Style {
            size: size(px(0.).into(), px(0.).into()),
            ..Default::default()
        };
        (window.request_layout(style, Vec::new(), cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Option<AnyElement> {
        let anchor = {
            let view = self.view.read(cx);
            let popup = view.notes.popup.as_ref()?;
            view.note_bounds(&popup.reference)?
        };
        let viewport = window.viewport_size();
        let width = px(352.).min((viewport.width - px(32.)).max(px(240.)));
        let mut panel = panel(self.view.clone(), width, viewport.height, cx)?;
        let extent = panel.layout_as_root(
            size(AvailableSpace::Definite(width), AvailableSpace::MinContent),
            window,
            cx,
        );
        let left = anchor
            .left()
            .max(px(16.))
            .min((viewport.width - width - px(16.)).max(px(16.)));
        let below = anchor.bottom() + px(8.);
        let top = if below + extent.height <= viewport.height - px(16.) {
            below
        } else {
            (anchor.top() - extent.height - px(8.)).max(px(16.))
        };
        panel.prepaint_at(point(left, top), window, cx);
        Some(panel)
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        panel: &mut Option<AnyElement>,
        window: &mut Window,
        cx: &mut App,
    ) {
        if let Some(panel) = panel {
            panel.paint(window, cx);
        }
    }
}

#[cfg(test)]
#[path = "view_notes_tests.rs"]
mod tests;
