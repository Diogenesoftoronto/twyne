use std::ops::Range;

use super::{
    Alignment, BlockObject, Command, EditorError, Element, ElementShell, InlineObject, ListKind,
    Mark, MarkKind, MathDisplay, Node, NodeKind, NodePath, NoteKind, ParagraphFormat, RichDocument,
    RunContent, Selection,
    model::{BlockLocation, InlineFragment, inline_fragments, nodes_from_fragments},
};

const DEFAULT_HISTORY_LIMIT: usize = 100;

#[cfg(test)]
#[path = "../../fixtures/math-write/edit-source/transaction_tests.rs"]
mod math_source_tests;

/// Accepted primitive input counts, in ProseMirror-compatible UTF-16 units.
/// A paragraph boundary consumes two positions; a simple list-item boundary
/// consumes four. Complex structural commands currently have no delta.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EditDelta {
    pub inserted_utf16: usize,
    pub deleted_utf16: usize,
}

impl EditDelta {
    pub fn is_empty(self) -> bool {
        self.inserted_utf16 == 0 && self.deleted_utf16 == 0
    }

    pub fn reversed(self) -> Self {
        Self {
            inserted_utf16: self.deleted_utf16,
            deleted_utf16: self.inserted_utf16,
        }
    }

    fn accumulate(&mut self, next: Self) {
        self.inserted_utf16 = self.inserted_utf16.saturating_add(next.inserted_utf16);
        self.deleted_utf16 = self.deleted_utf16.saturating_add(next.deleted_utf16);
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CommandOutcome {
    pub document_changed: bool,
    pub selection_changed: bool,
    pub history_changed: bool,
    pub edit_delta: Option<EditDelta>,
}

#[derive(Clone, Debug)]
struct HistoryEntry {
    document: RichDocument,
    selection: Selection,
    stored_marks: Option<Vec<Mark>>,
    edit_delta: Option<EditDelta>,
}

/// Native input and menus dispatch transactions to one owner. A history entry
/// shares unchanged subtrees; there is no HTML serialization on the keystroke
/// path. Document revision advances only for document changes, not caret moves.
#[derive(Clone, Debug)]
pub struct RichEditor {
    document: RichDocument,
    selection: Selection,
    stored_marks: Option<Vec<Mark>>,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
    history_limit: usize,
    revision: u64,
    read_only: bool,
    history_group_depth: usize,
    history_group_recorded: bool,
    history_group_before: Option<HistoryEntry>,
}

impl RichEditor {
    pub fn new(document: RichDocument) -> Self {
        Self {
            document,
            selection: Selection::caret(0),
            stored_marks: None,
            undo: Vec::new(),
            redo: Vec::new(),
            history_limit: DEFAULT_HISTORY_LIMIT,
            revision: 0,
            read_only: false,
            history_group_depth: 0,
            history_group_recorded: false,
            history_group_before: None,
        }
    }

    pub fn document(&self) -> &RichDocument {
        &self.document
    }
    pub fn selection(&self) -> Selection {
        self.selection
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn can_undo(&self) -> bool {
        !self.read_only && !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.read_only && !self.redo.is_empty()
    }
    pub fn is_read_only(&self) -> bool {
        self.read_only
    }
    pub fn set_read_only(&mut self, read_only: bool) {
        self.read_only = read_only;
    }

    pub fn set_history_limit(&mut self, history_limit: usize) {
        self.history_limit = history_limit;
        if self.undo.len() > history_limit {
            self.undo.drain(..self.undo.len() - history_limit);
        }
        if self.redo.len() > history_limit {
            self.redo.drain(..self.redo.len() - history_limit);
        }
    }

    /// IME candidate updates and a contiguous typing burst form one undo step.
    /// The native input adapter owns when such a group begins/ends.
    pub fn begin_history_group(&mut self) {
        if self.history_group_depth == 0 {
            self.history_group_recorded = false;
            self.history_group_before = Some(self.entry());
        }
        self.history_group_depth += 1;
    }
    pub fn end_history_group(&mut self) {
        self.history_group_depth = self.history_group_depth.saturating_sub(1);
        if self.history_group_depth == 0 {
            self.history_group_recorded = false;
            self.history_group_before = None;
        }
    }

    pub fn set_selection(&mut self, selection: Selection) -> Result<(), EditorError> {
        for position in [selection.anchor, selection.head] {
            if position > self.document.text_len() {
                return Err(EditorError::SelectionOutOfBounds {
                    position,
                    length: self.document.text_len(),
                });
            }
        }
        if self.selection != selection {
            self.stored_marks = None;
        }
        self.selection = selection;
        Ok(())
    }

    pub fn active_marks(&self) -> Vec<Mark> {
        self.stored_marks
            .clone()
            .unwrap_or_else(|| self.document.marks_at(self.selection.head))
    }

    /// Replace a projection after a verified session/source Apply. The caller
    /// controls whether this is a revision boundary and supplies the canonical
    /// Typst separately. An external replacement cannot leave a stale redo.
    pub fn replace_document(&mut self, document: RichDocument, record_history: bool) {
        if document == self.document {
            return;
        }
        if record_history {
            self.push_history(None);
        } else {
            self.undo.clear();
            self.redo.clear();
        }
        self.document = document;
        self.selection = Selection::caret(self.selection.head.min(self.document.text_len()));
        self.stored_marks = None;
        self.revision = self.revision.saturating_add(1);
    }

    pub fn execute(&mut self, command: Command) -> Result<CommandOutcome, EditorError> {
        if self.read_only {
            return Err(EditorError::ReadOnly);
        }
        if command == Command::Undo {
            return Ok(self.undo());
        }
        if command == Command::Redo {
            return Ok(self.redo());
        }
        let old_selection = self.selection;
        let old_stored_marks = self.stored_marks.clone();
        let mut edit_delta = None;
        let range = self.selection.range();
        let keep_stored_marks =
            matches!(
                &command,
                Command::InsertText(_)
                    | Command::ReplaceSelection(_)
                    | Command::DeleteBackward
                    | Command::DeleteForward
                    | Command::SplitBlock
                    | Command::InsertInline(_)
            ) && !matches!(&command, Command::InsertInline(InlineObject::Note { .. }));
        let (document, selection) = match command {
            Command::InsertText(text) | Command::ReplaceSelection(text) => {
                let result = replace_text(
                    &self.document,
                    range.clone(),
                    &text,
                    self.stored_marks.as_deref(),
                )?;
                edit_delta = replacement_delta(&self.document, range, &text);
                result
            }
            Command::PasteFragment(fragment) => {
                let result = paste_fragment(&self.document, range.clone(), &fragment)?;
                edit_delta = paste_delta(&self.document, range, &fragment);
                result
            }
            Command::DeleteBackward => {
                let range = if range.is_empty() {
                    range.start.saturating_sub(1)..range.end
                } else {
                    range
                };
                if range.is_empty() {
                    return Ok(CommandOutcome::default());
                }
                let result = replace_text(&self.document, range.clone(), "", None)?;
                edit_delta = replacement_delta(&self.document, range, "");
                result
            }
            Command::DeleteForward => {
                let range = if range.is_empty() {
                    range.start..(range.end + 1).min(self.document.text_len())
                } else {
                    range
                };
                if range.is_empty() {
                    return Ok(CommandOutcome::default());
                }
                let result = replace_text(&self.document, range.clone(), "", None)?;
                edit_delta = replacement_delta(&self.document, range, "");
                result
            }
            Command::SplitBlock => {
                let result =
                    split_block(&self.document, range.clone(), self.stored_marks.as_deref())?;
                edit_delta = split_delta(&self.document, range, &result.0, result.1);
                result
            }
            Command::ExitCodeBlock => {
                let Some(result) = exit_code_block(&self.document, self.selection)? else {
                    return Ok(CommandOutcome::default());
                };
                edit_delta = Some(EditDelta {
                    inserted_utf16: 1,
                    deleted_utf16: 0,
                });
                result
            }
            Command::ToggleMark(mark) => {
                if range.is_empty() {
                    return Ok(self.change_stored_mark(mark, MarkOperation::Toggle));
                }
                let remove = selection_has_mark(&self.document, &range, &mark);
                (
                    format_document(
                        &self.document,
                        &range,
                        if remove {
                            MarkChange::Remove(mark.kind())
                        } else {
                            MarkChange::Apply(mark)
                        },
                    ),
                    self.selection,
                )
            }
            Command::SetMark(mark) => {
                if range.is_empty() {
                    return Ok(self.change_stored_mark(mark, MarkOperation::Set));
                }
                (
                    format_document(&self.document, &range, MarkChange::Apply(mark)),
                    self.selection,
                )
            }
            Command::UnsetMark(kind) => {
                if range.is_empty() {
                    let mut marks = self.active_marks();
                    marks.retain(|mark| mark.kind() != kind);
                    self.stored_marks = Some(marks);
                    return Ok(CommandOutcome::default());
                }
                (
                    format_document(&self.document, &range, MarkChange::Remove(kind)),
                    self.selection,
                )
            }
            Command::ClearFormatting => {
                self.stored_marks = Some(Vec::new());
                let formatted = if range.is_empty() {
                    self.document.clone()
                } else {
                    format_document(&self.document, &range, MarkChange::Clear)
                };
                (
                    map_selected_blocks(&formatted, self.selection, |element, _| {
                        clear_paragraph_format(element)
                    }),
                    self.selection,
                )
            }
            Command::Recase(mode) => super::recase::apply(&self.document, self.selection, mode),
            Command::AddComment(attributes) => (
                super::comments::add(&self.document, &range, attributes)?,
                self.selection,
            ),
            Command::RemoveComment { id } => {
                (super::comments::remove(&self.document, &id), self.selection)
            }
            Command::SetParagraph => (
                map_selected_blocks(&self.document, self.selection, |element, _| {
                    retag_block(element, "p")
                }),
                self.selection,
            ),
            Command::SetHeading(level) => {
                if !(1..=3).contains(&level) {
                    return Err(EditorError::InvalidHeading);
                }
                (
                    map_selected_blocks(&self.document, self.selection, |element, _| {
                        retag_block(element, &format!("h{level}"))
                    }),
                    self.selection,
                )
            }
            Command::SetAlignment(alignment) => (
                map_selected_blocks(&self.document, self.selection, |element, _| {
                    set_alignment(element, alignment)
                }),
                self.selection,
            ),
            Command::SetParagraphFormat(format) => {
                validate_paragraph_format(&format)?;
                (
                    map_selected_blocks(&self.document, self.selection, |element, _| {
                        set_paragraph_format(element, &format)
                    }),
                    self.selection,
                )
            }
            Command::Indent | Command::Outdent => {
                let delta = if command == Command::Indent { 1 } else { -1 };
                let document = indent_document(&self.document, self.selection, delta)?;
                (document, self.selection)
            }
            Command::ToggleList(kind) => (
                toggle_list(&self.document, self.selection, kind)?,
                self.selection,
            ),
            Command::ToggleBlockQuote => (
                toggle_wrapper(&self.document, self.selection, "blockquote")?,
                self.selection,
            ),
            Command::ToggleCodeBlock => (
                map_selected_blocks(&self.document, self.selection, |element, _| {
                    if element.kind == NodeKind::CodeBlock {
                        retag_block(element, "p")
                    } else {
                        retag_block(element, "pre")
                    }
                }),
                self.selection,
            ),
            Command::InsertInline(object) => {
                let inserted_utf16 = object.node().projection_len_utf16();
                let result = insert_inline(
                    &self.document,
                    range.clone(),
                    object,
                    self.stored_marks.as_deref(),
                )?;
                edit_delta = replacement_delta(&self.document, range, "").map(|mut delta| {
                    delta.inserted_utf16 = inserted_utf16;
                    delta
                });
                result
            }
            Command::InsertBlock(object) => insert_block(&self.document, range, object)?,
            Command::SetAttributes { path, attributes } => {
                let element = self.document.node(&path).and_then(Node::as_element).ok_or(
                    EditorError::UnsupportedStructure("The metadata target is not an element"),
                )?;
                let mut shell = element.shell.clone();
                for (name, value) in attributes {
                    if let Some(value) = value {
                        shell.set_attr(&name, value);
                    } else {
                        shell.remove_attr(&name);
                    }
                }
                let document = self
                    .document
                    .replace_node(&path, vec![Node::element(shell, element.children.clone())])
                    .ok_or(EditorError::MissingTextBlock)?;
                let selection = Selection::new(
                    self.selection.anchor.min(document.text_len()),
                    self.selection.head.min(document.text_len()),
                );
                (document, selection)
            }
            Command::DeleteNode { path } => {
                let offset = self
                    .document
                    .offset_of_node(&path)
                    .ok_or(EditorError::MissingTextBlock)?;
                let document = self
                    .document
                    .replace_node(&path, Vec::new())
                    .ok_or(EditorError::MissingTextBlock)?;
                let document = if document.nodes().is_empty() {
                    RichDocument::default()
                } else {
                    document
                };
                let selection = Selection::caret(offset.min(document.text_len()));
                (document, selection)
            }
            Command::UpdateMathSource {
                path,
                expected,
                source,
            } => {
                let node = self
                    .document
                    .node(&path)
                    .ok_or(EditorError::UnsupportedStructure(
                        "The math reference is no longer current",
                    ))?;
                let element = node
                    .as_element()
                    .filter(|element| {
                        matches!(element.kind, NodeKind::Math(_))
                            && node.shares_storage_with(&expected)
                    })
                    .ok_or(EditorError::UnsupportedStructure(
                        "The math reference is no longer current",
                    ))?;
                let NodeKind::Math(display) = element.kind else {
                    unreachable!("math target validated above");
                };
                let mut shell = element.shell.clone();
                super::command::set_math_source_attributes(&mut shell, &source, display);
                // Source's renderHTML serializes the same raw source as both
                // data-latex and text. Do not retain an obsolete text payload
                // or embed rendered KaTeX/form DOM after an explicit commit.
                let document = self
                    .document
                    .replace_node(&path, vec![Node::element(shell, vec![Node::text(source)])])
                    .ok_or(EditorError::MissingTextBlock)?;
                let offset = self
                    .document
                    .offset_of_node(&path)
                    .ok_or(EditorError::MissingTextBlock)?;
                let selection = if display == MathDisplay::Inline
                    && self.selection.range() == (offset..offset + 1)
                {
                    // Actual Source setNodeMarkup maps an inline NodeSelection
                    // to a start text caret. A selected block remains selected.
                    Selection::caret(offset)
                } else {
                    self.selection
                };
                (document, selection)
            }
            Command::UpdateNote {
                path,
                expected,
                text,
                kind,
            } => {
                let node = self
                    .document
                    .node(&path)
                    .ok_or(EditorError::UnsupportedStructure(
                        "The note reference is no longer current",
                    ))?;
                let element = node
                    .as_element()
                    .filter(|element| {
                        matches!(element.kind, NodeKind::Note(_))
                            && node.shares_storage_with(&expected)
                    })
                    .ok_or(EditorError::UnsupportedStructure(
                        "The note reference is no longer current",
                    ))?;
                let mut shell = element.shell.clone();
                if let Some(kind) = kind {
                    shell.set_attr(
                        "data-type",
                        if kind == NoteKind::Footnote {
                            "footnote"
                        } else {
                            "endnote"
                        },
                    );
                }
                if let Some(text) = text {
                    if text.is_empty() {
                        shell.remove_attr("data-endnote-text");
                        shell.remove_attr("title");
                    } else {
                        shell.set_attr("data-endnote-text", &text);
                        shell.set_attr("title", &text);
                    }
                }
                let document = self
                    .document
                    .replace_node(&path, vec![Node::element(shell, element.children.clone())])
                    .ok_or(EditorError::MissingTextBlock)?;
                let offset = self
                    .document
                    .offset_of_node(&path)
                    .ok_or(EditorError::MissingTextBlock)?;
                let selection = if self.selection.range() == (offset..offset + 1) {
                    // Source setNodeMarkup replaces a selected atom and maps
                    // its NodeSelection to a text caret at the marker start.
                    Selection::caret(offset)
                } else {
                    self.selection
                };
                (document, selection)
            }
            Command::DeleteNote { path, expected } => {
                let node = self
                    .document
                    .node(&path)
                    .ok_or(EditorError::UnsupportedStructure(
                        "The note reference is no longer current",
                    ))?;
                if !node.shares_storage_with(&expected)
                    || !node
                        .as_element()
                        .is_some_and(|element| matches!(element.kind, NodeKind::Note(_)))
                {
                    return Err(EditorError::UnsupportedStructure(
                        "The note reference is no longer current",
                    ));
                }
                let offset = self
                    .document
                    .offset_of_node(&path)
                    .ok_or(EditorError::MissingTextBlock)?;
                let document = self
                    .document
                    .replace_node(&path, Vec::new())
                    .ok_or(EditorError::MissingTextBlock)?;
                let map = |position: usize| {
                    if position > offset {
                        position - 1
                    } else {
                        position
                    }
                };
                edit_delta = Some(EditDelta {
                    deleted_utf16: 1,
                    inserted_utf16: 0,
                });
                (
                    document,
                    Selection::new(map(self.selection.anchor), map(self.selection.head)),
                )
            }
            Command::MoveSection {
                source,
                target,
                placement,
            } => {
                let Some(plan) = self
                    .document
                    .plan_section_move(&source, &target, placement)?
                else {
                    return Ok(CommandOutcome::default());
                };
                super::block_moves::apply(&self.document, &plan, self.selection, true)?
            }
            Command::MoveBlocks {
                parent,
                source,
                insert_at,
            } => {
                let Some(plan) = self.document.plan_block_move(&parent, source, insert_at)? else {
                    return Ok(CommandOutcome::default());
                };
                super::block_moves::apply(&self.document, &plan, self.selection, false)?
            }
            Command::Table { cell, command } => {
                let document = super::tables::apply(&self.document, &cell, command)?;
                let selection = Selection::caret(self.selection.head.min(document.text_len()));
                (document, selection)
            }
            Command::Undo | Command::Redo => unreachable!("history handled above"),
        };
        // The cached metrics make this check constant time even for typing.
        // Every published projection, including an explicit image insertion,
        // must fit its reopen limits before caret/history/revision changes.
        if let Err(error) = document.validate_html_limits() {
            self.stored_marks = old_stored_marks;
            return Err(error);
        }
        let document_changed = document != self.document;
        if document_changed {
            self.push_history(edit_delta);
            self.document = document;
            self.selection = Selection::new(
                selection.anchor.min(self.document.text_len()),
                selection.head.min(self.document.text_len()),
            );
            self.revision = self.revision.saturating_add(1);
            if !keep_stored_marks
                && !matches!(self.stored_marks, Some(ref marks) if marks.is_empty())
            {
                self.stored_marks = None;
            }
        } else {
            self.selection = selection;
        }
        Ok(CommandOutcome {
            document_changed,
            selection_changed: old_selection != self.selection,
            history_changed: document_changed,
            edit_delta: document_changed
                .then_some(edit_delta)
                .flatten()
                .filter(|delta| !delta.is_empty()),
        })
    }

    pub fn undo(&mut self) -> CommandOutcome {
        if self.read_only {
            return CommandOutcome::default();
        }
        let Some(previous) = self.undo.pop() else {
            return CommandOutcome::default();
        };
        let selection_changed = self.selection != previous.selection;
        let edit_delta = previous.edit_delta;
        let mut current = self.entry();
        current.edit_delta = edit_delta;
        self.redo.push(current);
        self.restore(previous);
        CommandOutcome {
            document_changed: true,
            selection_changed,
            history_changed: true,
            edit_delta: edit_delta.map(EditDelta::reversed),
        }
    }

    pub fn redo(&mut self) -> CommandOutcome {
        if self.read_only {
            return CommandOutcome::default();
        }
        let Some(next) = self.redo.pop() else {
            return CommandOutcome::default();
        };
        let selection_changed = self.selection != next.selection;
        let edit_delta = next.edit_delta;
        let mut current = self.entry();
        current.edit_delta = edit_delta;
        self.undo.push(current);
        self.restore(next);
        CommandOutcome {
            document_changed: true,
            selection_changed,
            history_changed: true,
            edit_delta,
        }
    }

    fn entry(&self) -> HistoryEntry {
        HistoryEntry {
            document: self.document.clone(),
            selection: self.selection,
            stored_marks: self.stored_marks.clone(),
            edit_delta: None,
        }
    }
    fn restore(&mut self, entry: HistoryEntry) {
        self.document = entry.document;
        self.selection = entry.selection;
        self.stored_marks = entry.stored_marks;
        self.revision = self.revision.saturating_add(1);
    }
    fn push_history(&mut self, edit_delta: Option<EditDelta>) {
        self.redo.clear();
        if self.history_group_depth > 0 {
            if self.history_group_recorded {
                if let Some(entry) = self.undo.last_mut() {
                    if let (Some(delta), Some(next)) = (&mut entry.edit_delta, edit_delta) {
                        delta.accumulate(next);
                    } else {
                        // A manually grouped unsupported structural command
                        // must not turn an incomplete history map into input.
                        entry.edit_delta = None;
                    }
                }
                return;
            }
            self.history_group_recorded = true;
        }
        if self.history_limit == 0 {
            return;
        }
        if self.undo.len() == self.history_limit {
            self.undo.remove(0);
        }
        let mut entry = self
            .history_group_before
            .take()
            .unwrap_or_else(|| self.entry());
        entry.edit_delta = edit_delta.filter(|delta| !delta.is_empty());
        self.undo.push(entry);
    }

    fn change_stored_mark(&mut self, mark: Mark, operation: MarkOperation) -> CommandOutcome {
        let mut marks = self.active_marks();
        let active = marks.contains(&mark);
        marks.retain(|existing| {
            existing.kind() != mark.kind() && !opposite_script(mark.kind(), existing.kind())
        });
        if operation == MarkOperation::Set || !active {
            marks.push(mark);
        }
        self.stored_marks = Some(marks);
        CommandOutcome::default()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MarkOperation {
    Toggle,
    Set,
}
#[derive(Clone)]
enum MarkChange {
    Apply(Mark),
    Remove(MarkKind),
    Clear,
}

fn opposite_script(left: MarkKind, right: MarkKind) -> bool {
    matches!(
        (left, right),
        (MarkKind::Subscript, MarkKind::Superscript) | (MarkKind::Superscript, MarkKind::Subscript)
    )
}

pub(super) fn split_fragments(
    fragments: &[InlineFragment],
    position: usize,
) -> (Vec<InlineFragment>, Vec<InlineFragment>) {
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut cursor = 0;
    for fragment in fragments {
        let end = cursor + fragment.len();
        if end <= position {
            before.push(fragment.clone());
        } else if cursor >= position {
            after.push(fragment.clone());
        } else if let RunContent::Text(text) = &fragment.content {
            let byte = super::utf8_offset_for_scalar(text, position - cursor)
                .expect("bounded scalar offset");
            before.push(InlineFragment {
                content: RunContent::Text(text[..byte].into()),
                wrappers: fragment.wrappers.clone(),
            });
            after.push(InlineFragment {
                content: RunContent::Text(text[byte..].into()),
                wrappers: fragment.wrappers.clone(),
            });
        } else {
            // Native transactions never split an atom or embedded subtree.
            after.push(fragment.clone());
        }
        cursor = end;
    }
    (before, after)
}

fn wrappers_at(
    fragments: &[InlineFragment],
    position: usize,
    stored_marks: Option<&[Mark]>,
) -> Vec<ElementShell> {
    let mut cursor = 0;
    let mut wrappers = Vec::new();
    for fragment in fragments {
        let end = cursor + fragment.len();
        if (position > cursor && position <= end) || (position == 0 && cursor == 0 && end > cursor)
        {
            wrappers = fragment.wrappers.clone();
            break;
        }
        cursor = end;
    }
    if let Some(marks) = stored_marks {
        wrappers = clear_visual_marks(&wrappers);
        wrappers.extend(marks.iter().map(Mark::shell));
    }
    wrappers
}

/// Reads cached lengths and only the replacement's affected sibling passage.
/// The final synthetic newline is layout scaffolding, not a deleted PM node.
fn replacement_delta(
    document: &RichDocument,
    range: Range<usize>,
    text: &str,
) -> Option<EditDelta> {
    let first = document.block_at(range.start);
    if first.as_ref().is_none_or(|block| block.start > range.start) {
        return (text.is_empty()
            && range.end.saturating_sub(range.start) == 1
            && document
                .blocks_in_range(range.clone())
                .iter()
                .any(|block| block.kind.is_atom() && block.range == range))
        .then_some(EditDelta {
            inserted_utf16: 0,
            deleted_utf16: 1,
        });
    }
    let first = first?;
    let last = document.block_at(range.end)?;
    let first_parent = &first.path[..first.path.len() - 1];
    let last_parent = &last.path[..last.path.len() - 1];
    let extra_boundaries = if first.path == last.path {
        0
    } else if first_parent == last_parent {
        let siblings = if first_parent.is_empty() {
            document.nodes()
        } else {
            &document.node(first_parent)?.as_element()?.children
        };
        let passage = &siblings[*first.path.last()?..=*last.path.last()?];
        let mut text_blocks = 0usize;
        for node in passage {
            let element = node.as_element()?;
            if element.is_text_block {
                text_blocks += 1;
            } else if !element.kind.is_atom() {
                return None;
            }
        }
        text_blocks.saturating_sub(1)
    } else if first_parent.len() == last_parent.len()
        && !first_parent.is_empty()
        && first_parent[..first_parent.len() - 1] == last_parent[..last_parent.len() - 1]
    {
        let list = document
            .node(&first_parent[..first_parent.len() - 1])?
            .as_element()?;
        if !matches!(list.kind, NodeKind::List(_)) {
            return None;
        }
        let first_index = *first_parent.last()?;
        let last_index = *last_parent.last()?;
        for node in &list.children[first_index..=last_index] {
            let item = node.as_element()?;
            if !matches!(item.kind, NodeKind::ListItem { .. })
                || item.children.len() != 1
                || !item.children[0].as_element()?.is_text_block
            {
                return None;
            }
        }
        (last_index - first_index) * 3
    } else {
        return None;
    };
    let start = range.start.min(first.start + first.node.payload_len());
    let end = range.end.min(last.start + last.node.payload_len());
    let deleted_utf16 =
        document.scalar_to_utf16(end)? - document.scalar_to_utf16(start)? + extra_boundaries;
    let inserted_utf16 = text.encode_utf16().count()
        + if first.node.as_element()?.kind == NodeKind::CodeBlock {
            0
        } else {
            text.bytes().filter(|byte| *byte == b'\n').count()
        };
    Some(EditDelta {
        inserted_utf16,
        deleted_utf16,
    })
}

fn split_delta(
    before: &RichDocument,
    range: Range<usize>,
    after: &RichDocument,
    selection: Selection,
) -> Option<EditDelta> {
    let first = before.block_at(range.start)?;
    let last = after.block_at(selection.head)?;
    let mut delta = replacement_delta(before, range, "")?;
    delta.inserted_utf16 = if last.node.as_element()?.kind == NodeKind::CodeBlock {
        1
    } else if first.path[..first.path.len() - 1] != last.path[..last.path.len() - 1]
        && after
            .node(&last.path[..last.path.len() - 1])?
            .as_element()
            .is_some_and(|element| matches!(element.kind, NodeKind::ListItem { .. }))
    {
        4
    } else {
        2
    };
    Some(delta)
}

fn paste_delta(
    document: &RichDocument,
    range: Range<usize>,
    fragment: &super::RichFragment,
) -> Option<EditDelta> {
    let mut delta = replacement_delta(document, range, "")?;
    delta.inserted_utf16 = if fragment.is_inline() {
        fragment.document().text_len_utf16()
    } else if fragment.open_start()
        && fragment.open_end()
        && fragment.document().nodes().iter().all(|node| {
            node.as_element()
                .is_some_and(|element| element.is_text_block)
        })
    {
        // Both outer paragraph edges remain open. Each interior synthetic
        // newline represents a real pair of closing/opening PM positions.
        fragment.document().text_len_utf16() + fragment.document().nodes().len() - 2
    } else {
        // Closed block slices and container fitting require a native PM-map
        // adapter; do not invent input samples from their net document size.
        return None;
    };
    Some(delta)
}

fn replace_text(
    document: &RichDocument,
    range: Range<usize>,
    text: &str,
    stored_marks: Option<&[Mark]>,
) -> Result<(RichDocument, Selection), EditorError> {
    if text.is_empty()
        && range.end.saturating_sub(range.start) == 1
        && let Some(atom) = document
            .blocks_in_range(range.clone())
            .into_iter()
            .find(|block| block.range == range && block.kind.is_atom())
    {
        let result = document
            .replace_node(&atom.path, Vec::new())
            .ok_or(EditorError::MissingTextBlock)?;
        let result = if result.nodes().is_empty() {
            RichDocument::default()
        } else {
            result
        };
        return Ok((result, Selection::caret(range.start)));
    }
    let first = document
        .block_at(range.start)
        .ok_or(EditorError::MissingTextBlock)?;
    let last = document
        .block_at(range.end)
        .ok_or(EditorError::MissingTextBlock)?;
    let first_element = first.node.as_element().expect("text block");
    let first_fragments = inline_fragments(&first_element.children);
    let local_start = range
        .start
        .saturating_sub(first.start)
        .min(first.node.payload_len());
    let wrappers = wrappers_at(&first_fragments, local_start, stored_marks);
    let inserted = if text.is_empty() {
        Vec::new()
    } else {
        vec![InlineFragment {
            content: RunContent::Text(text.into()),
            wrappers,
        }]
    };
    let (prefix, _) = split_fragments(&first_fragments, local_start);
    let last_element = last.node.as_element().expect("text block");
    let last_fragments = inline_fragments(&last_element.children);
    let local_end = range
        .end
        .saturating_sub(last.start)
        .min(last.node.payload_len());
    let (_, suffix) = split_fragments(&last_fragments, local_end);
    let mut fragments = prefix;
    fragments.extend(inserted);
    fragments.extend(suffix);
    let replacements = if first_element.kind == NodeKind::CodeBlock {
        vec![Node::element(
            first_element.shell.clone(),
            nodes_from_fragments(&fragments),
        )]
    } else {
        blocks_from_fragments(&first_element.shell, fragments)
    };
    let result = replace_block_range(document, &first, &last, replacements)?;
    let caret = first.start + local_start + text.chars().count();
    Ok((result, Selection::caret(caret)))
}

fn replace_block_range(
    document: &RichDocument,
    first: &BlockLocation,
    last: &BlockLocation,
    replacements: Vec<Node>,
) -> Result<RichDocument, EditorError> {
    if first.path == last.path {
        return document
            .replace_node(&first.path, replacements)
            .ok_or(EditorError::MissingTextBlock);
    }
    let first_parent = &first.path[..first.path.len() - 1];
    let last_parent = &last.path[..last.path.len() - 1];
    if first_parent == last_parent {
        let siblings = if first_parent.is_empty() {
            document.nodes()
        } else {
            &document
                .node(first_parent)
                .and_then(Node::as_element)
                .ok_or(EditorError::MissingTextBlock)?
                .children
        };
        let first_index = *first.path.last().expect("nonempty path");
        let last_index = *last.path.last().expect("nonempty path");
        // A text selection can consume text blocks and explicit atoms. It
        // cannot accidentally delete an unselected table/list container.
        if siblings[first_index..=last_index].iter().any(|node| {
            node.as_element()
                .is_some_and(|element| !element.is_text_block && !element.kind.is_atom())
        }) {
            return Err(EditorError::UnsupportedStructure(
                "This replacement crosses a structural container; edit its individual text blocks",
            ));
        }
        let mut children = siblings.to_vec();
        children.splice(first_index..=last_index, replacements);
        return replace_children(document, first_parent, children);
    }
    // Adjacent simple list items share the list container, though their text
    // blocks have different immediate parents. Joining them keeps the list's
    // metadata and the first item's metadata intact.
    if first_parent.len() == last_parent.len()
        && !first_parent.is_empty()
        && first_parent[..first_parent.len() - 1] == last_parent[..last_parent.len() - 1]
    {
        let list_path = &first_parent[..first_parent.len() - 1];
        if let Some(list) = document
            .node(list_path)
            .and_then(Node::as_element)
            .filter(|element| matches!(element.kind, NodeKind::List(_)))
        {
            let first_index = *first_parent.last().expect("list item");
            let last_index = *last_parent.last().expect("list item");
            if list.children[first_index..=last_index].iter().all(|node| {
                node.as_element().is_some_and(|element| {
                    matches!(element.kind, NodeKind::ListItem { .. })
                        && element.children.len() == 1
                        && element.children[0]
                            .as_element()
                            .is_some_and(|element| element.is_text_block)
                })
            }) {
                let first_item = list.children[first_index].as_element().expect("list item");
                let mut children = list.children.clone();
                children.splice(
                    first_index..=last_index,
                    [Node::element(first_item.shell.clone(), replacements)],
                );
                return document
                    .replace_node(list_path, vec![Node::element(list.shell.clone(), children)])
                    .ok_or(EditorError::MissingTextBlock);
            }
        }
    }
    Err(EditorError::UnsupportedStructure(
        "This replacement crosses list/table boundaries; the container and its unselected content were preserved",
    ))
}

fn paste_fragment(
    document: &RichDocument,
    range: Range<usize>,
    fragment: &super::RichFragment,
) -> Result<(RichDocument, Selection), EditorError> {
    if let Some(atom) = document
        .blocks_in_range(range.clone())
        .into_iter()
        .find(|block| block.kind.is_atom() && block.range == range)
    {
        let replacements = if fragment.is_inline() {
            vec![Node::paragraph(fragment.document().nodes().to_vec())]
        } else {
            fragment.document().nodes().to_vec()
        };
        let length = replacements.iter().map(Node::projection_len).sum::<usize>();
        let text_tail = replacements
            .last()
            .and_then(Node::as_element)
            .is_some_and(|element| element.is_text_block);
        let mut result = document
            .replace_node(&atom.path, replacements)
            .ok_or(EditorError::MissingTextBlock)?;
        let caret = atom.range.start + length - usize::from(text_tail);
        if result.block_at(caret).is_none() && atom.path.len() == 1 {
            let mut nodes = result.nodes().to_vec();
            nodes.insert(
                atom.path[0] + fragment.document().nodes().len(),
                Node::paragraph(Vec::new()),
            );
            result = RichDocument::new(nodes);
        }
        return Ok((result, Selection::caret(caret)));
    }
    let first = document
        .block_at(range.start)
        .ok_or(EditorError::MissingTextBlock)?;
    let last = document
        .block_at(range.end)
        .ok_or(EditorError::MissingTextBlock)?;
    let first_element = first.node.as_element().expect("text block");
    let last_element = last.node.as_element().expect("text block");
    let local_start = range
        .start
        .saturating_sub(first.start)
        .min(first.node.payload_len());
    let local_end = range
        .end
        .saturating_sub(last.start)
        .min(last.node.payload_len());
    let (mut prefix, _) = split_fragments(&inline_fragments(&first_element.children), local_start);
    let (_, suffix) = split_fragments(&inline_fragments(&last_element.children), local_end);
    if fragment.is_inline() {
        let inserted = inline_fragments(fragment.document().nodes());
        if first_element.kind == NodeKind::CodeBlock
            && inserted
                .iter()
                .any(|part| matches!(part.content, RunContent::Object(_)))
        {
            return Err(EditorError::UnsupportedStructure(
                "Source atoms cannot be pasted into a code block",
            ));
        }
        let inserted_len = inserted.iter().map(InlineFragment::len).sum::<usize>();
        prefix.extend(inserted);
        prefix.extend(suffix);
        let result = replace_block_range(
            document,
            &first,
            &last,
            vec![Node::element(
                first_element.shell.clone(),
                nodes_from_fragments(&prefix),
            )],
        )?;
        return Ok((
            result,
            Selection::caret(first.start + local_start + inserted_len),
        ));
    }
    if first_element.kind == NodeKind::CodeBlock {
        return Err(EditorError::UnsupportedStructure(
            "Block fragments cannot be pasted into a code block",
        ));
    }
    let has_container = fragment.document().nodes().iter().any(|node| {
        node.as_element()
            .is_some_and(|element| !element.is_text_block && element.kind != NodeKind::NonContent)
    });
    if has_container
        && (1..first.path.len()).any(|end| {
            document
                .node(&first.path[..end])
                .and_then(Node::as_element)
                .is_some_and(|element| {
                    matches!(
                        element.kind,
                        NodeKind::TableCell { .. } | NodeKind::ListItem { .. }
                    )
                })
        })
    {
        return Err(EditorError::UnsupportedStructure(
            "Paste block containers into the manuscript outside table/list passages",
        ));
    }
    let mut inserted = fragment.document().nodes().to_vec();
    if inserted.is_empty() {
        return Err(EditorError::UnsupportedStructure(
            "The clipboard fragment has no content",
        ));
    }
    if inserted.iter().any(|node| node.as_text().is_some()) {
        return Err(EditorError::UnsupportedStructure(
            "A block clipboard fragment must contain structured blocks",
        ));
    }
    let mut replacements = Vec::new();
    if fragment.open_start()
        && let Some(element) = inserted[0]
            .as_element()
            .filter(|element| element.is_text_block)
    {
        prefix.extend(inline_fragments(&element.children));
        inserted[0] = Node::element(first_element.shell.clone(), nodes_from_fragments(&prefix));
    } else if !prefix.is_empty() {
        replacements.push(Node::element(
            first_element.shell.clone(),
            nodes_from_fragments(&prefix),
        ));
    }
    replacements.extend(inserted);
    let mut caret = replacements.iter().map(Node::projection_len).sum::<usize>();
    let tail = replacements.last().expect("inserted fragment");
    if let Some(element) = tail.as_element().filter(|element| element.is_text_block) {
        if fragment.open_end() {
            caret -= 1;
            let mut children = inline_fragments(&element.children);
            children.extend(suffix);
            let node = Node::element(element.shell.clone(), nodes_from_fragments(&children));
            *replacements.last_mut().expect("tail exists") = node;
        } else if suffix.is_empty() {
            caret -= 1;
        } else {
            replacements.push(Node::element(
                last_element.shell.clone(),
                nodes_from_fragments(&suffix),
            ));
        }
    } else {
        let mut shell = last_element.shell.clone();
        if matches!(last_element.kind, NodeKind::Heading(_)) {
            shell.tag = "p".into();
        }
        replacements.push(Node::element(shell, nodes_from_fragments(&suffix)));
    }
    let result = replace_block_range(document, &first, &last, replacements)?;
    Ok((result, Selection::caret(first.start + caret)))
}

fn blocks_from_fragments(first_shell: &ElementShell, fragments: Vec<InlineFragment>) -> Vec<Node> {
    let mut lines = vec![Vec::new()];
    for fragment in fragments {
        if let RunContent::Text(text) = &fragment.content {
            let mut pieces = text.split('\n').peekable();
            while let Some(piece) = pieces.next() {
                if !piece.is_empty() {
                    lines.last_mut().expect("one line").push(InlineFragment {
                        content: RunContent::Text(piece.into()),
                        wrappers: fragment.wrappers.clone(),
                    });
                }
                if pieces.peek().is_some() {
                    lines.push(Vec::new());
                }
            }
        } else {
            lines.last_mut().expect("one line").push(fragment);
        }
    }
    lines
        .into_iter()
        .enumerate()
        .map(|(index, fragments)| {
            let mut shell = first_shell.clone();
            if index > 0 && matches!(shell.kind(), NodeKind::Heading(_)) {
                shell.tag = "p".into();
            }
            Node::element(shell, nodes_from_fragments(&fragments))
        })
        .collect()
}

fn exit_code_block(
    document: &RichDocument,
    selection: Selection,
) -> Result<Option<(RichDocument, Selection)>, EditorError> {
    let Some(head) = document.block_at(selection.head) else {
        return Ok(None);
    };
    if head
        .node
        .as_element()
        .is_none_or(|element| element.kind != NodeKind::CodeBlock)
        || document
            .block_at(selection.anchor)
            .is_none_or(|anchor| anchor.path != head.path)
    {
        return Ok(None);
    }
    let caret = head.start + head.node.payload_len() + 1;
    let paragraph = Node::paragraph(Vec::new());
    let document = document
        .replace_node(&head.path, vec![head.node, paragraph])
        .ok_or(EditorError::MissingTextBlock)?;
    Ok(Some((document, Selection::caret(caret))))
}

fn split_block(
    document: &RichDocument,
    range: Range<usize>,
    stored_marks: Option<&[Mark]>,
) -> Result<(RichDocument, Selection), EditorError> {
    let (document, selection) = if range.is_empty() {
        (document.clone(), Selection::caret(range.start))
    } else {
        replace_text(document, range, "", stored_marks)?
    };
    let location = document
        .block_at(selection.head)
        .ok_or(EditorError::MissingTextBlock)?;
    let element = location.node.as_element().expect("text block");
    if element.kind == NodeKind::CodeBlock {
        return replace_text(&document, selection.range(), "\n", stored_marks);
    }
    let offset = selection
        .head
        .saturating_sub(location.start)
        .min(location.node.payload_len());
    let fragments = inline_fragments(&element.children);
    let (prefix, suffix) = split_fragments(&fragments, offset);
    let mut next_shell = element.shell.clone();
    if matches!(element.kind, NodeKind::Heading(_)) && offset == location.node.payload_len() {
        next_shell.tag = "p".into();
    }
    let before = Node::element(element.shell.clone(), nodes_from_fragments(&prefix));
    let after = Node::element(next_shell, nodes_from_fragments(&suffix));
    let parent_path = &location.path[..location.path.len() - 1];
    if let Some(item) = document
        .node(parent_path)
        .and_then(Node::as_element)
        .filter(|element| matches!(element.kind, NodeKind::ListItem { .. }))
        && item.children.len() == 1
    {
        let mut next_item = item.shell.clone();
        if matches!(item.kind, NodeKind::ListItem { task: true }) {
            next_item.set_attr("data-checked", "false");
        }
        let result = document
            .replace_node(
                parent_path,
                vec![
                    Node::element(item.shell.clone(), vec![before]),
                    Node::element(next_item, vec![after]),
                ],
            )
            .ok_or(EditorError::MissingTextBlock)?;
        return Ok((result, Selection::caret(location.start + offset + 1)));
    }
    let result = document
        .replace_node(&location.path, vec![before, after])
        .ok_or(EditorError::MissingTextBlock)?;
    Ok((result, Selection::caret(location.start + offset + 1)))
}

fn insert_inline(
    document: &RichDocument,
    range: Range<usize>,
    object: InlineObject,
    stored_marks: Option<&[Mark]>,
) -> Result<(RichDocument, Selection), EditorError> {
    let (document, selection) = if range.is_empty() {
        (document.clone(), Selection::caret(range.start))
    } else {
        replace_text(document, range, "", None)?
    };
    let block = document
        .block_at(selection.head)
        .ok_or(EditorError::MissingTextBlock)?;
    let element = block.node.as_element().expect("text block");
    let fragments = inline_fragments(&element.children);
    let offset = selection
        .head
        .saturating_sub(block.start)
        .min(block.node.payload_len());
    // Source EndnoteNode inserts an explicit unmarked atom, even at the end of
    // a formatted or commented passage. Other inline objects retain their
    // existing contextual insertion behavior.
    let wrappers = if matches!(object, InlineObject::Note { .. }) {
        Vec::new()
    } else {
        wrappers_at(&fragments, offset, stored_marks)
    };
    let (mut prefix, suffix) = split_fragments(&fragments, offset);
    let node = object.node();
    if node.projection_len() > 1 {
        return Err(EditorError::UnsupportedStructure(
            "An inline insertion must be a source atom or hard break",
        ));
    }
    let length = node.projection_len();
    prefix.push(InlineFragment {
        content: if matches!(object, InlineObject::HardBreak) {
            RunContent::HardBreak
        } else {
            RunContent::Object(node)
        },
        wrappers,
    });
    prefix.extend(suffix);
    let result = document
        .replace_node(
            &block.path,
            vec![Node::element(
                element.shell.clone(),
                nodes_from_fragments(&prefix),
            )],
        )
        .ok_or(EditorError::MissingTextBlock)?;
    Ok((result, Selection::caret(block.start + offset + length)))
}

fn insert_block(
    document: &RichDocument,
    range: Range<usize>,
    object: BlockObject,
) -> Result<(RichDocument, Selection), EditorError> {
    let (document, selection) = if range.is_empty() {
        (document.clone(), Selection::caret(range.start))
    } else {
        replace_text(document, range, "", None)?
    };
    let block = document
        .block_at(selection.head)
        .ok_or(EditorError::MissingTextBlock)?;
    let element = block.node.as_element().expect("text block");
    let offset = selection
        .head
        .saturating_sub(block.start)
        .min(block.node.payload_len());
    let (prefix, suffix) = split_fragments(&inline_fragments(&element.children), offset);
    let object_node = object.node()?;
    let mut replacements = Vec::new();
    let before_length = if prefix.is_empty() {
        0
    } else {
        let node = Node::element(element.shell.clone(), nodes_from_fragments(&prefix));
        let length = node.projection_len();
        replacements.push(node);
        length
    };
    let object_length = object_node.projection_len();
    replacements.push(object_node);
    let mut suffix_shell = element.shell.clone();
    if matches!(element.kind, NodeKind::Heading(_)) {
        suffix_shell.tag = "p".into();
    }
    replacements.push(Node::element(suffix_shell, nodes_from_fragments(&suffix)));
    let result = document
        .replace_node(&block.path, replacements)
        .ok_or(EditorError::MissingTextBlock)?;
    Ok((
        result,
        Selection::caret(block.start + before_length + object_length),
    ))
}

fn selection_has_mark(document: &RichDocument, range: &Range<usize>, mark: &Mark) -> bool {
    fn visit(
        nodes: &[Node],
        start: usize,
        range: &Range<usize>,
        mark: &Mark,
        found: &mut bool,
    ) -> bool {
        let mut cursor = start;
        for node in nodes {
            let end = cursor + node.projection_len();
            if cursor < range.end
                && end > range.start
                && let Some(element) = node.as_element()
            {
                if element.is_text_block {
                    let mut inline_cursor = cursor;
                    for fragment in inline_fragments(&element.children) {
                        let inline_end = inline_cursor + fragment.len();
                        if inline_cursor < range.end
                            && inline_end > range.start
                            && matches!(fragment.content, RunContent::Text(_))
                        {
                            *found = true;
                            if !fragment.marks().contains(mark) {
                                return false;
                            }
                        }
                        inline_cursor = inline_end;
                    }
                } else if !element.kind.is_atom()
                    && !visit(&element.children, cursor, range, mark, found)
                {
                    return false;
                }
            }
            cursor = end;
        }
        true
    }
    let mut found = false;
    visit(document.nodes(), 0, range, mark, &mut found) && found
}

fn format_document(
    document: &RichDocument,
    range: &Range<usize>,
    change: MarkChange,
) -> RichDocument {
    fn visit(nodes: &[Node], start: usize, range: &Range<usize>, change: &MarkChange) -> Vec<Node> {
        let mut cursor = start;
        nodes
            .iter()
            .map(|node| {
                let end = cursor + node.projection_len();
                let result = if cursor < range.end && end > range.start {
                    if let Some(element) = node.as_element() {
                        if element.is_text_block {
                            let local = range.start.saturating_sub(cursor).min(node.payload_len())
                                ..range.end.saturating_sub(cursor).min(node.payload_len());
                            let fragments = inline_fragments(&element.children);
                            let (mut before, tail) = split_fragments(&fragments, local.start);
                            let (selected, after) = split_fragments(&tail, local.end - local.start);
                            before.extend(selected.into_iter().map(|mut fragment| {
                                if matches!(fragment.content, RunContent::Text(_)) {
                                    fragment.wrappers = match change {
                                        MarkChange::Clear => clear_visual_marks(&fragment.wrappers),
                                        MarkChange::Remove(kind) => {
                                            remove_mark(&fragment.wrappers, *kind)
                                        }
                                        MarkChange::Apply(mark) => {
                                            let mut wrappers =
                                                remove_mark(&fragment.wrappers, mark.kind());
                                            if mark.kind() == MarkKind::Subscript {
                                                wrappers =
                                                    remove_mark(&wrappers, MarkKind::Superscript);
                                            }
                                            if mark.kind() == MarkKind::Superscript {
                                                wrappers =
                                                    remove_mark(&wrappers, MarkKind::Subscript);
                                            }
                                            wrappers.push(mark.shell());
                                            wrappers
                                        }
                                    };
                                }
                                fragment
                            }));
                            before.extend(after);
                            Node::element(element.shell.clone(), nodes_from_fragments(&before))
                        } else if !element.kind.is_atom() && element.kind != NodeKind::NonContent {
                            Node::element(
                                element.shell.clone(),
                                visit(&element.children, cursor, range, change),
                            )
                        } else {
                            node.clone()
                        }
                    } else {
                        node.clone()
                    }
                } else {
                    node.clone()
                };
                cursor = end;
                result
            })
            .collect()
    }
    RichDocument::new(visit(document.nodes(), 0, range, &change))
}

fn remove_mark(wrappers: &[ElementShell], kind: MarkKind) -> Vec<ElementShell> {
    wrappers
        .iter()
        .filter_map(|wrapper| {
            let mut shell = wrapper.clone();
            let semantic = match kind {
                MarkKind::Bold => matches!(shell.tag.as_str(), "strong" | "b"),
                MarkKind::Italic => matches!(shell.tag.as_str(), "em" | "i"),
                MarkKind::Underline => shell.tag == "u",
                MarkKind::Strike => matches!(shell.tag.as_str(), "s" | "del" | "strike"),
                MarkKind::Highlight => shell.tag == "mark",
                MarkKind::Subscript => shell.tag == "sub",
                MarkKind::Superscript => shell.tag == "sup",
                MarkKind::Link => shell.tag == "a",
                MarkKind::Code => shell.tag == "code",
                _ => false,
            };
            match kind {
                MarkKind::Bold => shell.set_style("font-weight", None),
                MarkKind::Italic => shell.set_style("font-style", None),
                MarkKind::FontFamily => shell.set_style("font-family", None),
                MarkKind::FontSize => shell.set_style("font-size", None),
                MarkKind::Color => shell.set_style("color", None),
                MarkKind::Highlight => {
                    shell.set_style("background-color", None);
                    shell.remove_attr("data-color");
                    if semantic && shell.style("color").as_deref() == Some("inherit") {
                        shell.set_style("color", None);
                    }
                }
                MarkKind::Underline | MarkKind::Strike => {
                    let target = if kind == MarkKind::Underline {
                        "underline"
                    } else {
                        "line-through"
                    };
                    for property in ["text-decoration", "text-decoration-line"] {
                        if let Some(value) = shell.style(property) {
                            let remaining = value
                                .split_whitespace()
                                .filter(|part| *part != target)
                                .collect::<Vec<_>>()
                                .join(" ");
                            shell.set_style(
                                property,
                                (!remaining.is_empty()).then_some(remaining.as_str()),
                            );
                        }
                    }
                }
                MarkKind::Link if semantic => {
                    for attribute in ["href", "target", "rel"] {
                        shell.remove_attr(attribute);
                    }
                    if let Some(classes) = shell.attr("class") {
                        let remaining = classes
                            .split_whitespace()
                            .filter(|class| *class != "editor-link")
                            .collect::<Vec<_>>()
                            .join(" ");
                        if remaining.is_empty() {
                            shell.remove_attr("class");
                        } else {
                            shell.set_attr("class", remaining);
                        }
                    }
                }
                _ => {}
            }
            if semantic {
                shell.tag = "span".into();
            }
            if shell.tag == "span" && shell.attributes.is_empty() {
                None
            } else {
                Some(shell)
            }
        })
        .collect()
}

fn clear_visual_marks(wrappers: &[ElementShell]) -> Vec<ElementShell> {
    let mut result = wrappers.to_vec();
    for kind in [
        MarkKind::Bold,
        MarkKind::Italic,
        MarkKind::Underline,
        MarkKind::Strike,
        MarkKind::Highlight,
        MarkKind::FontFamily,
        MarkKind::FontSize,
        MarkKind::Color,
        MarkKind::Subscript,
        MarkKind::Superscript,
        MarkKind::Code,
    ] {
        result = remove_mark(&result, kind);
    }
    result
}

fn map_selected_blocks(
    document: &RichDocument,
    selection: Selection,
    mut transform: impl FnMut(&Element, &[usize]) -> Node,
) -> RichDocument {
    fn visit(
        nodes: &[Node],
        start: usize,
        range: &Range<usize>,
        caret_path: Option<&[usize]>,
        path: &mut NodePath,
        transform: &mut impl FnMut(&Element, &[usize]) -> Node,
    ) -> Vec<Node> {
        let mut cursor = start;
        nodes
            .iter()
            .enumerate()
            .map(|(index, node)| {
                let end = cursor + node.projection_len();
                path.push(index);
                let overlaps = caret_path
                    .map_or(cursor < range.end && end > range.start, |caret| {
                        caret.starts_with(path)
                    });
                let result = if overlaps {
                    if let Some(element) = node.as_element() {
                        if element.is_text_block {
                            transform(element, path)
                        } else if !element.kind.is_atom() && element.kind != NodeKind::NonContent {
                            Node::element(
                                element.shell.clone(),
                                visit(
                                    &element.children,
                                    cursor,
                                    range,
                                    caret_path,
                                    path,
                                    transform,
                                ),
                            )
                        } else {
                            node.clone()
                        }
                    } else {
                        node.clone()
                    }
                } else {
                    node.clone()
                };
                path.pop();
                cursor = end;
                result
            })
            .collect()
    }
    let caret = selection
        .is_empty()
        .then(|| document.block_at(selection.head))
        .flatten();
    RichDocument::new(visit(
        document.nodes(),
        0,
        &selection.range(),
        caret.as_ref().map(|location| location.path.as_slice()),
        &mut Vec::new(),
        &mut transform,
    ))
}

fn retag_block(element: &Element, tag: &str) -> Node {
    if !matches!(
        element.kind,
        NodeKind::Paragraph | NodeKind::Heading(_) | NodeKind::CodeBlock
    ) {
        return Node::element(element.shell.clone(), element.children.clone());
    }
    let mut shell = element.shell.clone();
    shell.tag = tag.into();
    let children = if tag == "pre" {
        if element.kind == NodeKind::CodeBlock {
            element.children.clone()
        } else {
            vec![Node::element(
                ElementShell::html("code"),
                element.children.clone(),
            )]
        }
    } else if element.kind == NodeKind::CodeBlock
        && element.children.len() == 1
        && element.children[0].as_element().is_some_and(|element| {
            element.shell.tag == "code" && element.shell.attributes.is_empty()
        })
    {
        element.children[0]
            .as_element()
            .expect("code")
            .children
            .clone()
    } else {
        element.children.clone()
    };
    Node::element(shell, children)
}

fn clear_paragraph_format(element: &Element) -> Node {
    if !matches!(element.kind, NodeKind::Paragraph | NodeKind::Heading(_)) {
        return Node::element(element.shell.clone(), element.children.clone());
    }
    let mut shell = element.shell.clone();
    shell.tag = "p".into();
    for property in [
        "text-align",
        "line-height",
        "margin-top",
        "margin-bottom",
        "margin-left",
        "break-after",
        "page-break-after",
    ] {
        shell.set_style(property, None);
    }
    for attribute in [
        "data-indent",
        "data-space-before",
        "data-space-after",
        "data-keep-with-next",
    ] {
        shell.remove_attr(attribute);
    }
    Node::element(shell, element.children.clone())
}

fn set_alignment(element: &Element, alignment: Alignment) -> Node {
    let mut shell = element.shell.clone();
    if matches!(element.kind, NodeKind::Paragraph | NodeKind::Heading(_)) {
        shell.set_style("text-align", Some(alignment.css()));
    }
    Node::element(shell, element.children.clone())
}

fn validate_paragraph_format(format: &ParagraphFormat) -> Result<(), EditorError> {
    if let Some(Some(height)) = &format.line_height
        && !height
            .parse::<f64>()
            .is_ok_and(|height| height.is_finite() && (1.0..=2.0).contains(&height))
    {
        return Err(EditorError::InvalidStyle("paragraph line height".into()));
    }
    for (name, value) in [
        ("space before", format.space_before),
        ("space after", format.space_after),
    ] {
        if let Some(Some(points)) = value
            && (!points.is_finite() || !(0.0..=144.0).contains(&points))
        {
            return Err(EditorError::InvalidStyle(name.into()));
        }
    }
    Ok(())
}

fn set_paragraph_format(element: &Element, format: &ParagraphFormat) -> Node {
    let mut shell = element.shell.clone();
    if matches!(element.kind, NodeKind::Paragraph | NodeKind::Heading(_)) {
        if let Some(height) = &format.line_height {
            shell.set_style("line-height", height.as_deref());
        }
        for (value, attribute, property) in [
            (format.space_before, "data-space-before", "margin-top"),
            (format.space_after, "data-space-after", "margin-bottom"),
        ] {
            if let Some(value) = value {
                if let Some(points) = value {
                    shell.set_attr(attribute, points.to_string());
                    shell.set_style(property, Some(&format!("{points}pt")));
                } else {
                    shell.remove_attr(attribute);
                    shell.set_style(property, None);
                }
            }
        }
        if let Some(keep) = format.keep_with_next {
            if keep {
                shell.set_attr("data-keep-with-next", "true");
            } else {
                shell.remove_attr("data-keep-with-next");
            }
            for property in ["break-after", "page-break-after"] {
                shell.set_style(property, keep.then_some("avoid"));
            }
        }
    }
    Node::element(shell, element.children.clone())
}

fn indent_document(
    document: &RichDocument,
    selection: Selection,
    delta: i32,
) -> Result<RichDocument, EditorError> {
    let location = document
        .block_at(selection.head)
        .ok_or(EditorError::MissingTextBlock)?;
    let parent = &location.path[..location.path.len() - 1];
    if document
        .node(parent)
        .and_then(Node::as_element)
        .is_some_and(|element| matches!(element.kind, NodeKind::ListItem { .. }))
    {
        return indent_list_item(document, parent, delta);
    }
    Ok(map_selected_blocks(document, selection, |element, path| {
        if document
            .node(&path[..path.len() - 1])
            .and_then(Node::as_element)
            .is_some_and(|element| matches!(element.kind, NodeKind::ListItem { .. }))
        {
            return Node::element(element.shell.clone(), element.children.clone());
        }
        let mut shell = element.shell.clone();
        if matches!(element.kind, NodeKind::Paragraph | NodeKind::Heading(_)) {
            let current = shell
                .attr("data-indent")
                .and_then(|value| value.parse::<i32>().ok())
                .unwrap_or(0);
            let next = (current + delta).clamp(0, 8);
            if next == 0 {
                shell.remove_attr("data-indent");
                shell.set_style("margin-left", None);
            } else {
                shell.set_attr("data-indent", next.to_string());
                shell.set_style("margin-left", Some(&format!("{}rem", next * 2)));
            }
        }
        Node::element(shell, element.children.clone())
    }))
}

fn replace_children(
    document: &RichDocument,
    parent: &[usize],
    children: Vec<Node>,
) -> Result<RichDocument, EditorError> {
    if parent.is_empty() {
        return Ok(RichDocument::new(children));
    }
    let element = document
        .node(parent)
        .and_then(Node::as_element)
        .ok_or(EditorError::MissingTextBlock)?;
    document
        .replace_node(parent, vec![Node::element(element.shell.clone(), children)])
        .ok_or(EditorError::MissingTextBlock)
}

fn selected_siblings(
    document: &RichDocument,
    selection: Selection,
) -> Result<(NodePath, usize, usize), EditorError> {
    let first = document
        .block_at(selection.range().start)
        .ok_or(EditorError::MissingTextBlock)?;
    let last = document
        .block_at(
            selection
                .range()
                .end
                .saturating_sub(usize::from(!selection.is_empty())),
        )
        .ok_or(EditorError::MissingTextBlock)?;
    let first_parent = first.path[..first.path.len() - 1].to_vec();
    if first_parent != last.path[..last.path.len() - 1] {
        return Err(EditorError::UnsupportedStructure(
            "The selected blocks have different structural parents",
        ));
    }
    Ok((
        first_parent,
        *first.path.last().expect("first"),
        *last.path.last().expect("last"),
    ))
}

fn toggle_list(
    document: &RichDocument,
    selection: Selection,
    kind: ListKind,
) -> Result<RichDocument, EditorError> {
    let location = document
        .block_at(selection.head)
        .ok_or(EditorError::MissingTextBlock)?;
    let mut list_path = location.path.clone();
    while !list_path.is_empty() {
        if let Some(list) = document
            .node(&list_path)
            .and_then(Node::as_element)
            .filter(|element| matches!(element.kind, NodeKind::List(_)))
        {
            if list.kind == NodeKind::List(kind) {
                let mut replacements = Vec::new();
                for item in &list.children {
                    if let Some(item) = item
                        .as_element()
                        .filter(|element| matches!(element.kind, NodeKind::ListItem { .. }))
                    {
                        replacements
                            .extend(unwrap_with_metadata(item, &["data-type", "data-checked"]));
                    } else {
                        replacements.push(item.clone());
                    }
                }
                let replacements =
                    preserve_wrapper_metadata(list, replacements, &["data-type", "start"]);
                return document
                    .replace_node(&list_path, replacements)
                    .ok_or(EditorError::MissingTextBlock);
            }
            let mut shell = list_shell(kind);
            copy_unknown_attributes(&list.shell, &mut shell, &["data-type", "class", "start"]);
            let children = list
                .children
                .iter()
                .map(|node| {
                    if let Some(item) = node
                        .as_element()
                        .filter(|element| matches!(element.kind, NodeKind::ListItem { .. }))
                    {
                        let mut shell = item.shell.clone();
                        if kind == ListKind::Task {
                            shell.set_attr("data-type", "taskItem");
                            if shell.attr("data-checked").is_none() {
                                shell.set_attr("data-checked", "false");
                            }
                        } else {
                            shell.remove_attr("data-type");
                            shell.remove_attr("data-checked");
                        }
                        Node::element(shell, item.children.clone())
                    } else {
                        node.clone()
                    }
                })
                .collect();
            return document
                .replace_node(&list_path, vec![Node::element(shell, children)])
                .ok_or(EditorError::MissingTextBlock);
        }
        list_path.pop();
    }
    let (parent, first, last) = selected_siblings(document, selection)?;
    let siblings = if parent.is_empty() {
        document.nodes()
    } else {
        &document
            .node(&parent)
            .and_then(Node::as_element)
            .ok_or(EditorError::MissingTextBlock)?
            .children
    };
    let items = siblings[first..=last]
        .iter()
        .map(|node| {
            let mut shell = ElementShell::html("li");
            if kind == ListKind::Task {
                shell.set_attr("data-type", "taskItem");
                shell.set_attr("data-checked", "false");
            }
            Node::element(shell, vec![node.clone()])
        })
        .collect();
    let mut children = siblings.to_vec();
    children.splice(first..=last, [Node::element(list_shell(kind), items)]);
    replace_children(document, &parent, children)
}

fn list_shell(kind: ListKind) -> ElementShell {
    let mut shell = ElementShell::html(if kind == ListKind::Ordered {
        "ol"
    } else {
        "ul"
    });
    if kind == ListKind::Task {
        shell.set_attr("data-type", "taskList");
        shell.set_attr("class", "twyne-task-list");
    }
    shell
}

fn copy_unknown_attributes(from: &ElementShell, to: &mut ElementShell, known: &[&str]) {
    for attribute in &from.attributes {
        if !known
            .iter()
            .any(|known| attribute.name.eq_ignore_ascii_case(known))
        {
            to.attributes.push(attribute.clone());
        }
    }
}

fn unwrap_with_metadata(element: &Element, known: &[&str]) -> Vec<Node> {
    preserve_wrapper_metadata(element, element.children.clone(), known)
}

fn preserve_wrapper_metadata(element: &Element, children: Vec<Node>, known: &[&str]) -> Vec<Node> {
    let mut shell = ElementShell::html("div");
    copy_unknown_attributes(&element.shell, &mut shell, known);
    if shell.attributes.is_empty() {
        children
    } else {
        vec![Node::element(shell, children)]
    }
}

fn toggle_wrapper(
    document: &RichDocument,
    selection: Selection,
    tag: &str,
) -> Result<RichDocument, EditorError> {
    let location = document
        .block_at(selection.head)
        .ok_or(EditorError::MissingTextBlock)?;
    let mut path = location.path.clone();
    while !path.is_empty() {
        if let Some(element) = document
            .node(&path)
            .and_then(Node::as_element)
            .filter(|element| element.shell.tag == tag)
        {
            return document
                .replace_node(&path, unwrap_with_metadata(element, &[]))
                .ok_or(EditorError::MissingTextBlock);
        }
        path.pop();
    }
    let (parent, first, last) = selected_siblings(document, selection)?;
    let siblings = if parent.is_empty() {
        document.nodes()
    } else {
        &document
            .node(&parent)
            .and_then(Node::as_element)
            .ok_or(EditorError::MissingTextBlock)?
            .children
    };
    let mut children = siblings.to_vec();
    children.splice(
        first..=last,
        [Node::element(
            ElementShell::html(tag),
            siblings[first..=last].to_vec(),
        )],
    );
    replace_children(document, &parent, children)
}

fn indent_list_item(
    document: &RichDocument,
    item_path: &[usize],
    delta: i32,
) -> Result<RichDocument, EditorError> {
    let (&item_index, list_path) = item_path
        .split_last()
        .ok_or(EditorError::MissingTextBlock)?;
    let list = document
        .node(list_path)
        .and_then(Node::as_element)
        .ok_or(EditorError::MissingTextBlock)?;
    if delta > 0 {
        if item_index == 0 {
            return Ok(document.clone());
        }
        let previous = list.children[item_index - 1]
            .as_element()
            .ok_or(EditorError::MissingTextBlock)?;
        let mut previous_children = previous.children.clone();
        if let Some(nested) = previous_children
            .last()
            .and_then(Node::as_element)
            .filter(|element| element.kind == list.kind)
        {
            let mut children = nested.children.clone();
            children.push(list.children[item_index].clone());
            *previous_children.last_mut().expect("nested list") =
                Node::element(nested.shell.clone(), children);
        } else {
            previous_children.push(Node::element(
                list.shell.clone(),
                vec![list.children[item_index].clone()],
            ));
        }
        let mut children = list.children.clone();
        children[item_index - 1] = Node::element(previous.shell.clone(), previous_children);
        children.remove(item_index);
        return document
            .replace_node(list_path, vec![Node::element(list.shell.clone(), children)])
            .ok_or(EditorError::MissingTextBlock);
    }
    let Some((&outer_item_index, outer_list_path)) = list_path
        .get(..list_path.len().saturating_sub(1))
        .and_then(|parent_item| parent_item.split_last())
    else {
        return Ok(document.clone());
    };
    let parent_item_path = &list_path[..list_path.len() - 1];
    let parent_item = document
        .node(parent_item_path)
        .and_then(Node::as_element)
        .filter(|element| matches!(element.kind, NodeKind::ListItem { .. }))
        .ok_or(EditorError::UnsupportedStructure(
            "The item is not inside a nested list",
        ))?;
    let outer_list = document
        .node(outer_list_path)
        .and_then(Node::as_element)
        .filter(|element| matches!(element.kind, NodeKind::List(_)))
        .ok_or(EditorError::UnsupportedStructure(
            "The item is not inside a nested list",
        ))?;
    let mut nested_children = list.children.clone();
    let lifted = nested_children.remove(item_index);
    let mut parent_children = parent_item.children.clone();
    let nested_index = *list_path.last().expect("nested list index");
    if nested_children.is_empty() {
        parent_children.remove(nested_index);
    } else {
        parent_children[nested_index] = Node::element(list.shell.clone(), nested_children);
    }
    let mut children = outer_list.children.clone();
    children[outer_item_index] = Node::element(parent_item.shell.clone(), parent_children);
    children.insert(outer_item_index + 1, lifted);
    document
        .replace_node(
            outer_list_path,
            vec![Node::element(outer_list.shell.clone(), children)],
        )
        .ok_or(EditorError::MissingTextBlock)
}
