//! Native visual writing surface. GPUI shapes the actual rich inline runs;
//! this is a text-input owner, not a read-only HTML/Markdown preview.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    ops::Range,
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

use gpui_kit::component::{Disableable, Sizable, checkbox::Checkbox};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, AvailableSpace, Bounds, ClipboardItem, Context, CursorStyle, ElementId,
    ElementInputHandler, Entity, EntityInputHandler, EventEmitter, FocusHandle, Focusable, Font,
    FontFeatures, FontStyle, FontWeight, Global, GlobalElementId, Hsla, ImageSource,
    InspectorElementId, IntoElement, KeyBinding, LayoutId, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, Pixels, Point, Render, ShapedLine, SharedString, Size,
    StrikethroughStyle, Style, Styled, StyledImage, Task, TestSupportExt, TextAlign, TextRun,
    UTF16Selection, UnderlineStyle, Window, div, fill, font, img, point, px, relative, rgb, size,
};
use unicode_segmentation::UnicodeSegmentation;

use super::{
    Command, CommandOutcome, EditDelta, EditorError, InlineObject, Mark, Node, NodeKind, NodePath,
    NoteKind, RichBlock, RichDocument, RichEditor, RichFragment, RunContent, Selection,
};
use crate::inline_proof::{
    AtomErrorKind, AtomKind, AtomRenderError, AtomRenderImage, AtomRenderKey, AtomRenderRequest,
    InlineProofRenderer,
};
use crate::theme::{self, DISPLAY_FONT, MONO_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT};

#[path = "atom_renderer_lifecycle.rs"]
mod atom_lifecycle;
#[path = "view_citations.rs"]
mod citations;
#[path = "view_comments.rs"]
mod comments;
#[path = "view_drag.rs"]
mod dragging;
#[path = "hyphenation.rs"]
mod hyphenation;
#[path = "images.rs"]
mod images;
#[path = "view_math_source.rs"]
mod math_source;
pub use math_source::{MathSourceHostContext, MathSourcePreflight};
#[path = "math_source_flow.rs"]
mod math_source_flow;
#[path = "view_notes.rs"]
mod notes;
pub use notes::NoteReference;
#[path = "view_insert.rs"]
mod insert;
#[path = "view_pagination.rs"]
mod paginated;
#[path = "paragraph_flow.rs"]
mod paragraph_flow;
#[path = "view_shortcuts.rs"]
mod shortcuts;
#[path = "view_flow.rs"]
mod text_flow;
use hyphenation::Hyphenation;
pub use paginated::{PaginationFallback, PaginationInfo, PaginationScrollAnchor};
use paragraph_flow::{FlowItem, StyledPiece};

#[cfg(target_os = "linux")]
#[path = "view_clipboard.rs"]
mod external_clipboard;
#[cfg(target_os = "linux")]
pub use external_clipboard::ClipboardPreflight;

gpui_kit::actions!(
    twyne_rich_editor,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        WordLeft,
        WordRight,
        SelectWordLeft,
        SelectWordRight,
        DeleteWordBackward,
        DeleteWordForward,
        Home,
        End,
        SelectHome,
        SelectEnd,
        DocumentStart,
        DocumentEnd,
        SelectAll,
        Enter,
        HardBreak,
        Copy,
        Cut,
        Paste,
        Undo,
        Redo,
        Bold,
        Italic,
        Underline,
        Indent,
        Outdent,
        CancelBlockDrag,
    ]
);

struct BindingsInstalled;
impl Global for BindingsInstalled {}
const EDITOR_KEY_CONTEXT: &str = "TwyneRichEditor && !TwyneCommentAnchor && !TwyneBlockHandle && !TwyneNoteAnchor && !TwyneInlineNotePopover && !TwyneMathAnchor && !TwyneMathSourceForm";

pub fn init(cx: &mut App) {
    if cx.try_global::<BindingsInstalled>().is_some() {
        return;
    }
    cx.set_global(BindingsInstalled);
    notes::init(cx);
    super::math_source_editor::init(cx);
    math_source::init(cx);
    shortcuts::init(cx);
    cx.bind_keys([
        KeyBinding::new("escape", CancelBlockDrag, Some("TwyneBlockHandle")),
        KeyBinding::new("backspace", Backspace, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("delete", Delete, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("left", Left, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("right", Right, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("up", Up, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("down", Down, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-left", SelectLeft, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-right", SelectRight, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-up", SelectUp, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-down", SelectDown, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("home", Home, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("end", End, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-home", SelectHome, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-end", SelectEnd, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("enter", Enter, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-enter", HardBreak, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("tab", Indent, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new("shift-tab", Outdent, Some(EDITOR_KEY_CONTEXT)),
    ]);
    #[cfg(target_os = "macos")]
    let word_modifier = "alt";
    #[cfg(not(target_os = "macos"))]
    let word_modifier = "ctrl";
    cx.bind_keys([
        KeyBinding::new(
            &format!("{word_modifier}-left"),
            WordLeft,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{word_modifier}-right"),
            WordRight,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{word_modifier}-shift-left"),
            SelectWordLeft,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{word_modifier}-shift-right"),
            SelectWordRight,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{word_modifier}-backspace"),
            DeleteWordBackward,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{word_modifier}-delete"),
            DeleteWordForward,
            Some(EDITOR_KEY_CONTEXT),
        ),
    ]);
    #[cfg(target_os = "macos")]
    let modifier = "cmd";
    #[cfg(not(target_os = "macos"))]
    let modifier = "ctrl";
    cx.bind_keys([
        KeyBinding::new(
            &format!("{modifier}-a"),
            SelectAll,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(&format!("{modifier}-c"), Copy, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(&format!("{modifier}-x"), Cut, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(&format!("{modifier}-v"), Paste, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(&format!("{modifier}-z"), Undo, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(
            &format!("{modifier}-shift-z"),
            Redo,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(&format!("{modifier}-y"), Redo, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(&format!("{modifier}-b"), Bold, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(&format!("{modifier}-i"), Italic, Some(EDITOR_KEY_CONTEXT)),
        KeyBinding::new(
            &format!("{modifier}-u"),
            Underline,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{modifier}-home"),
            DocumentStart,
            Some(EDITOR_KEY_CONTEXT),
        ),
        KeyBinding::new(
            &format!("{modifier}-end"),
            DocumentEnd,
            Some(EDITOR_KEY_CONTEXT),
        ),
    ]);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RichEditorEvent {
    /// Exact shared snapshots for scoped document anchors. Consumers map the
    /// accepted transaction, rather than reading a later queued revision.
    Transacted {
        before: RichDocument,
        after: RichDocument,
        revision: u64,
    },
    Changed {
        revision: u64,
    },
    /// Real accepted input while the native writing surface owns focus.
    Input {
        delta: EditDelta,
    },
    SelectionChanged,
    /// A fresh measured page frame is ready; presentation only.
    PaginationChanged {
        generation: u64,
    },
    CommentRequested {
        id: Arc<str>,
        range: Range<usize>,
    },
    CommentHoverChanged {
        id: Option<Arc<str>>,
    },
    DragStarted {
        source: NodePath,
    },
    DragFinished {
        moved: bool,
    },
    DragAutoScrollRequested {
        position: Point<Pixels>,
    },
    Error(EditorError),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialMode {
    Off,
    Plain,
    Illuminated,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OpeningInitial {
    pub mode: InitialMode,
    pub alternate: bool,
    /// Web presets: small 54px, medium 75.6px, large 99px.
    pub size: f32,
}
impl Default for OpeningInitial {
    fn default() -> Self {
        Self {
            mode: InitialMode::Illuminated,
            alternate: false,
            size: 75.6,
        }
    }
}

pub struct RichEditorView {
    editor: RichEditor,
    drag: dragging::DragState,
    pagination: paginated::PaginationState,
    focus: FocusHandle,
    marked_range: Option<Range<usize>>,
    tool_span: Option<Range<usize>>,
    tool_sentence: Option<Range<usize>>,
    typing_group: Option<TypingGroup>,
    selecting: bool,
    comments_quiet: bool,
    comment_geometry: RefCell<comments::MeasuredComments>,
    comment_hits: RefCell<Vec<comments::HoverTarget>>,
    comment_focus: RefCell<HashMap<ElementId, Arc<str>>>,
    comment_hover: Option<Arc<str>>,
    notes: notes::NotesState,
    inline_math_flow: math_source_flow::InlineMathFlow,
    math_source: math_source::MathSourceHostState,
    blocks: RefCell<HashMap<NodePath, Arc<RichBlock>>>,
    images: RefCell<HashMap<NodePath, CachedImage>>,
    layouts: RefCell<HashMap<NodePath, CachedLayout>>,
    hyphenation: RefCell<HashMap<NodePath, CachedHyphenation>>,
    language: Arc<str>,
    placed: RefCell<HashMap<NodePath, PlacedBlock>>,
    opening: OpeningInitial,
    opening_index: Option<usize>,
    error: Option<EditorError>,
    atom_renderer: Option<InlineProofRenderer>,
    atom_task: Option<Task<()>>,
    atom_pending: HashMap<AtomRenderKey, atom_lifecycle::PendingAtom>,
    atom_inflight: HashSet<AtomRenderKey>,
    atom_ready: HashMap<AtomRenderKey, Result<AtomRenderImage, AtomRenderError>>,
    atom_generation: u64,
    atom_revision: u64,
    atom_lifecycle: atom_lifecycle::AtomRendererLifecycle,
    #[cfg(target_os = "linux")]
    external_clipboard: Option<external_clipboard::ExternalClipboard>,
    #[cfg(target_os = "linux")]
    clipboard_task: Option<Task<()>>,
    #[cfg(target_os = "linux")]
    clipboard_generation: u64,
    #[cfg(target_os = "linux")]
    clipboard_publication: u64,
}

impl EventEmitter<RichEditorEvent> for RichEditorView {}
impl Focusable for RichEditorView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl RichEditorView {
    pub fn new(document: RichDocument, cx: &mut Context<Self>) -> Self {
        init(cx);
        Self {
            editor: RichEditor::new(document),
            drag: dragging::DragState::default(),
            pagination: paginated::PaginationState::default(),
            focus: cx.focus_handle(),
            marked_range: None,
            tool_span: None,
            tool_sentence: None,
            typing_group: None,
            selecting: false,
            comments_quiet: false,
            comment_geometry: RefCell::new(HashMap::new()),
            comment_hits: RefCell::new(Vec::new()),
            comment_focus: RefCell::new(HashMap::new()),
            comment_hover: None,
            notes: notes::NotesState::default(),
            inline_math_flow: math_source_flow::InlineMathFlow::default(),
            math_source: math_source::MathSourceHostState::default(),
            blocks: RefCell::new(HashMap::new()),
            images: RefCell::new(HashMap::new()),
            layouts: RefCell::new(HashMap::new()),
            hyphenation: RefCell::new(HashMap::new()),
            language: Arc::from("en"),
            placed: RefCell::new(HashMap::new()),
            opening: OpeningInitial::default(),
            opening_index: None,
            error: None,
            atom_renderer: None,
            atom_task: None,
            atom_pending: HashMap::new(),
            atom_inflight: HashSet::new(),
            atom_ready: HashMap::new(),
            atom_generation: 0,
            atom_revision: 0,
            atom_lifecycle: atom_lifecycle::AtomRendererLifecycle::default(),
            #[cfg(target_os = "linux")]
            external_clipboard: None,
            #[cfg(target_os = "linux")]
            clipboard_task: None,
            #[cfg(target_os = "linux")]
            clipboard_generation: 0,
            #[cfg(target_os = "linux")]
            clipboard_publication: 0,
        }
    }
    pub fn document(&self) -> &RichDocument {
        self.editor.document()
    }
    pub fn snapshot(&self) -> RichDocument {
        self.editor.document().clone()
    }
    /// ProseMirror-compatible textContent of the current text block, for a
    /// Flow tick or changed-block boundary. Atom payloads and hard breaks do
    /// not become fallback labels; no other block is projected or serialized.
    pub fn current_block_text_content(&self) -> Option<String> {
        let block = self.document().block_at(self.selection().head)?;
        let node = self.document().node(&block.path)?;
        if !node
            .as_element()
            .is_some_and(|element| element.is_text_block)
        {
            return None;
        }
        fn visit(node: &Node, output: &mut String) {
            match node.data() {
                super::NodeData::Text(text) => output.push_str(text),
                super::NodeData::Comment(_) => {}
                super::NodeData::Element(element) => {
                    if element.kind.is_atom()
                        || matches!(element.kind, NodeKind::NonContent | NodeKind::HardBreak)
                    {
                        return;
                    }
                    for child in &element.children {
                        visit(child, output);
                    }
                }
            }
        }
        let mut text = String::new();
        visit(node, &mut text);
        Some(text)
    }
    pub fn selection(&self) -> Selection {
        self.editor.selection()
    }
    /// Original Zen styling hides writer ink/chip hit targets without changing
    /// widget widths, source, selection, revision, or cached text layout.
    pub fn set_comments_quiet(&mut self, quiet: bool, cx: &mut Context<Self>) {
        if self.comments_quiet != quiet {
            self.comments_quiet = quiet;
            if quiet {
                self.clear_comment_hover(cx);
            }
            cx.notify();
        }
    }
    /// Select the first current passage for a writer thread. The thread store
    /// owns missing-anchor policy; selection itself remains history-neutral.
    pub fn select_comment(
        &mut self,
        id: &str,
        cx: &mut Context<Self>,
    ) -> Result<bool, EditorError> {
        let Some(range) = self.document().first_comment_range(id) else {
            return Ok(false);
        };
        self.set_selection(Selection::new(range.start, range.end), cx)?;
        Ok(true)
    }
    /// The most recently measured caret in window surface coordinates. The
    /// outer writing scroll view can reveal it on the frame after an edit.
    pub fn caret_bounds(&self) -> Option<Bounds<Pixels>> {
        self.position_for_offset(self.selection().head)
            .map(|(origin, height)| Bounds::new(origin, size(px(1.4), height)))
    }
    /// The current measured endpoint union used by the writer's multiline
    /// margin composer. Forward and backward selections share the same bounds;
    /// this reads cached geometry without moving selection or traversing text.
    pub fn selection_endpoint_bounds(&self) -> Option<Bounds<Pixels>> {
        let range = self.selection().range();
        self.range_endpoint_bounds(&range)
    }
    /// Cached layout coordinates for a tool's passage, independent of the
    /// current selection and without changing the writer's caret.
    pub fn range_endpoint_bounds(&self, range: &Range<usize>) -> Option<Bounds<Pixels>> {
        let (start, start_height) = self.position_for_offset(range.start)?;
        let (end, end_height) = self.position_for_offset(range.end)?;
        Some(
            Bounds::new(start, size(px(1.4), start_height))
                .union(&Bounds::new(end, size(px(1.4), end_height))),
        )
    }
    pub fn tool_anchor_bounds(&self, path: &[usize], position: usize) -> Option<Bounds<Pixels>> {
        let placed = self.placed.borrow();
        let block = placed.get(path)?;
        let (start, _) = self.position_for_offset(position)?;
        Some(Bounds::new(
            point(block.bounds.left(), start.y),
            size(
                block.bounds.size.width,
                (block.bounds.bottom() - start.y).max(px(0.)),
            ),
        ))
    }
    /// Presentation only: no marks, document revision, history entry or save.
    pub fn set_tool_decoration(
        &mut self,
        span: Option<Range<usize>>,
        sentence: Option<Range<usize>>,
        cx: &mut Context<Self>,
    ) {
        if self.tool_span != span || self.tool_sentence != sentence {
            self.tool_span = span;
            self.tool_sentence = sentence;
            cx.notify();
        }
    }
    /// Current marked-passage geometry, independent of caret/selection. The
    /// first passage follows document order; source text is not traversed.
    pub fn comment_bounds(&self, id: &str) -> Option<Bounds<Pixels>> {
        self.comment_geometry
            .borrow()
            .get(id)?
            .first_key_value()
            .map(|(_, anchor)| anchor.bounds)
    }
    /// Resolve the specific clicked passage when one thread has several
    /// disjoint anchors, searching only that ID's current measured passages.
    pub fn comment_range_bounds(&self, id: &str, range: &Range<usize>) -> Option<Bounds<Pixels>> {
        self.comment_geometry
            .borrow()
            .get(id)?
            .values()
            .find(|anchor| anchor.range == *range)
            .map(|anchor| anchor.bounds)
    }
    /// Exact current line boxes grouped by disjoint anchored passage. Outer
    /// furniture reads this measured cache, never scans source or uses a
    /// multiline union as a hover/connector target.
    pub fn comment_anchor_bounds(&self, id: &str) -> Option<Vec<Vec<Bounds<Pixels>>>> {
        Some(
            self.comment_geometry
                .borrow()
                .get(id)?
                .values()
                .map(|anchor| anchor.lines.clone())
                .collect(),
        )
    }
    pub fn revision(&self) -> u64 {
        self.editor.revision()
    }
    pub fn error(&self) -> Option<&EditorError> {
        self.error.as_ref()
    }
    pub fn active_marks(&self) -> Vec<Mark> {
        self.editor.active_marks()
    }
    pub fn can_undo(&self) -> bool {
        self.editor.can_undo()
    }
    pub fn can_redo(&self) -> bool {
        self.editor.can_redo()
    }
    pub fn is_read_only(&self) -> bool {
        self.editor.is_read_only()
    }

    pub fn set_document(
        &mut self,
        document: RichDocument,
        record_history: bool,
        cx: &mut Context<Self>,
    ) {
        self.cancel_drag(cx);
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        self.close_typing_group();
        self.close_note_edit_group();
        self.editor.end_history_group();
        self.retire_math_source(cx);
        let before = self.snapshot();
        self.editor.replace_document(document, record_history);
        if &before != self.document() {
            cx.emit(RichEditorEvent::Transacted {
                before,
                after: self.snapshot(),
                revision: self.revision(),
            });
        }
        self.notes = notes::NotesState::default();
        self.blocks.borrow_mut().clear();
        self.images.borrow_mut().clear();
        self.layouts.borrow_mut().clear();
        self.hyphenation.borrow_mut().clear();
        self.placed.borrow_mut().clear();
        self.comment_geometry.borrow_mut().clear();
        self.comment_hits.borrow_mut().clear();
        self.comment_focus.borrow_mut().clear();
        self.clear_comment_hover(cx);
        self.marked_range = None;
        self.tool_span = None;
        self.tool_sentence = None;
        self.error = None;
        self.retire_atom_owner(cx);
        cx.notify();
    }
    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        let atom_scope_changed = self.is_read_only() != read_only;
        self.clear_comment_hover(cx);
        self.cancel_drag(cx);
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        self.close_typing_group();
        self.close_note_edit_group();
        self.notes = notes::NotesState::default();
        self.editor.end_history_group();
        self.marked_range = None;
        self.editor.set_read_only(read_only);
        if atom_scope_changed {
            self.retire_atom_owner(cx);
        }
        self.sync_math_source_read_only(cx);
        cx.notify();
    }
    pub fn set_opening_initial(&mut self, opening: OpeningInitial, cx: &mut Context<Self>) {
        if self.opening != opening {
            self.opening = opening;
            self.layouts.borrow_mut().clear();
            cx.notify();
        }
    }
    /// Default manuscript language inherited by imported blocks. Explicit HTML
    /// lang attributes win. Only en/en-US currently have a native dictionary.
    pub fn set_language(&mut self, language: impl Into<Arc<str>>, cx: &mut Context<Self>) {
        let language = language.into();
        if self.language != language {
            self.language = language;
            self.hyphenation.borrow_mut().clear();
            self.layouts.borrow_mut().clear();
            cx.notify();
        }
    }
    pub fn set_selection(
        &mut self,
        selection: Selection,
        cx: &mut Context<Self>,
    ) -> Result<(), EditorError> {
        self.cancel_drag(cx);
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        self.close_typing_group();
        if self.marked_range.take().is_some() {
            self.editor.end_history_group();
        }
        self.editor.set_selection(selection)?;
        self.sync_math_source_target(cx);
        cx.emit(RichEditorEvent::SelectionChanged);
        cx.notify();
        Ok(())
    }
    pub fn execute(
        &mut self,
        command: Command,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<CommandOutcome, EditorError> {
        let note_identity_changed = matches!(
            &command,
            Command::UpdateNote { .. } | Command::Undo | Command::Redo
        );
        if !matches!(
            &command,
            Command::UpdateNote {
                text: Some(_),
                kind: None,
                ..
            }
        ) {
            self.close_note_edit_group();
        }
        let dragging = self.drag.is_active();
        self.cancel_block_drag(window, cx);
        if dragging {
            window.focus(&self.focus, cx);
        }
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        if !matches!(
            &command,
            Command::InsertText(_) | Command::ReplaceSelection(_)
        ) {
            self.close_typing_group();
        }
        let before = self.snapshot();
        match self.editor.execute(command) {
            Ok(outcome) => {
                self.sync_math_source_target(cx);
                self.error = None;
                if outcome.document_changed {
                    cx.emit(RichEditorEvent::Transacted {
                        before,
                        after: self.snapshot(),
                        revision: self.revision(),
                    });
                    self.sync_note_popup(note_identity_changed, window, cx);
                    self.clear_comment_hover(cx);
                    self.comment_focus.borrow_mut().clear();
                    cx.emit(RichEditorEvent::Changed {
                        revision: self.editor.revision(),
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
            Err(error) => {
                self.error = Some(error.clone());
                cx.emit(RichEditorEvent::Error(error.clone()));
                cx.notify();
                Err(error)
            }
        }
    }
    /// Source's insertContentAt replaces a sentence without first selecting it
    /// in a separate transaction. Preserve that original caret in Undo too.
    pub fn replace_tool_sentence(
        &mut self,
        range: Range<usize>,
        text: String,
        expected_revision: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<CommandOutcome, EditorError> {
        if self.is_read_only() {
            return Err(EditorError::ReadOnly);
        }
        if self.revision() != expected_revision || self.marked_range.is_some() {
            return Err(EditorError::UnsupportedStructure(
                "Finish the current edit before replacing this sentence.",
            ));
        }
        self.close_typing_group();
        self.close_note_edit_group();
        let before = self.snapshot();
        let selection_before = self.selection();
        let mut accepted = self.editor.clone();
        accepted.begin_history_group();
        accepted.set_selection(Selection::new(range.start, range.end))?;
        let mut outcome = accepted.execute(Command::ReplaceSelection(text))?;
        accepted.end_history_group();
        outcome.selection_changed = selection_before != accepted.selection();
        self.cancel_block_drag(window, cx);
        #[cfg(target_os = "linux")]
        self.cancel_external_paste();
        self.editor = accepted;
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

    fn dispatch(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
        // The retained equation field is a separate editor. Any rich action
        // without a matching field binding must not edit manuscript history.
        if self
            .math_source_form()
            .is_some_and(|form| form.focus_handle(cx).is_focused(window))
        {
            return;
        }
        let _ = self.execute(command, window, cx);
    }

    fn close_typing_group(&mut self) {
        if self.typing_group.take().is_some() {
            self.editor.end_history_group();
        }
    }

    /// Expiration is checked at the next edit; no timer or full-document work
    /// runs while the writer is idle. Formatting, movement, paste and IME
    /// establish their own explicit history boundaries.
    fn prepare_typing_group(&mut self, kind: TypingKind, before: Selection) {
        let now = Instant::now();
        let marks = self.editor.active_marks();
        let adjacent = self.typing_group.as_ref().is_some_and(|group| {
            group.kind == kind
                && group.head == before.head
                && before.is_empty()
                && group.marks == marks
                && now.duration_since(group.last_edit) <= Duration::from_millis(500)
        });
        if !adjacent {
            self.close_typing_group();
            self.editor.begin_history_group();
        }
        self.typing_group = Some(TypingGroup {
            kind,
            head: before.head,
            marks,
            last_edit: now,
        });
    }

    fn finish_typing_edit(&mut self) {
        let head = self.selection().head;
        if let Some(group) = &mut self.typing_group {
            group.head = head;
        }
    }

    fn move_to(&mut self, offset: usize, extend: bool, cx: &mut Context<Self>) {
        let offset = offset.min(self.document().text_len());
        let selection = if extend {
            Selection::new(self.selection().anchor, offset)
        } else {
            Selection::caret(offset)
        };
        let _ = self.set_selection(selection, cx);
    }

    fn horizontal(&mut self, forward: bool, extend: bool, cx: &mut Context<Self>) {
        let selection = self.selection();
        if !extend && !selection.is_empty() {
            self.move_to(
                if forward {
                    selection.range().end
                } else {
                    selection.range().start
                },
                false,
                cx,
            );
            return;
        }
        self.move_to(self.grapheme_target(forward), extend, cx);
    }

    fn grapheme_target(&self, forward: bool) -> usize {
        let selection = self.selection();
        let Some(block) = self.document().block_at_offset(selection.head) else {
            return if forward {
                (selection.head + 1).min(self.document().text_len())
            } else {
                selection.head.saturating_sub(1)
            };
        };
        let text = block.editing_text();
        let relative = selection
            .head
            .saturating_sub(block.range.start)
            .min(text.chars().count());
        let byte = super::utf8_offset_for_scalar(&text, relative).unwrap_or(text.len());
        let target = if forward {
            text.grapheme_indices(true)
                .find_map(|(index, _)| (index > byte).then_some(index))
                .unwrap_or(text.len())
        } else {
            text.grapheme_indices(true)
                .rev()
                .find_map(|(index, _)| (index < byte).then_some(index))
                .unwrap_or(0)
        };
        let mut offset =
            block.range.start + super::scalar_offset_for_utf8(&text, target).unwrap_or(relative);
        if offset == selection.head {
            offset = if forward {
                (offset + 1).min(self.document().text_len())
            } else {
                offset.saturating_sub(1)
            };
        }
        offset
    }

    fn word_target(&self, forward: bool) -> usize {
        let head = self.selection().head;
        let Some(mut block) = self.document().block_at_offset(head) else {
            return if forward {
                (head + 1).min(self.document().text_len())
            } else {
                head.saturating_sub(1)
            };
        };
        let mut relative = head
            .saturating_sub(block.range.start)
            .min(block.range.end - block.range.start);
        if !forward && relative == 0 && block.range.start > 0 {
            if let Some(previous) = self.document().block_at_offset(block.range.start - 1) {
                block = previous;
                relative = block.range.end - block.range.start;
            }
        } else if forward
            && relative == block.range.end - block.range.start
            && block.range.end + 1 < self.document().text_len()
            && let Some(next) = self.document().block_at_offset(block.range.end + 1)
        {
            block = next;
            relative = 0;
        }
        let text = block.editing_text();
        let byte = super::utf8_offset_for_scalar(&text, relative).unwrap_or(text.len());
        let byte = if forward {
            text.unicode_word_indices()
                .find_map(|(index, word)| (index + word.len() > byte).then_some(index + word.len()))
                .unwrap_or(text.len())
        } else {
            text.unicode_word_indices()
                .rev()
                .find_map(|(index, _)| (index < byte).then_some(index))
                .unwrap_or(0)
        };
        block.range.start + super::scalar_offset_for_utf8(&text, byte).unwrap_or(relative)
    }

    fn word_horizontal(&mut self, forward: bool, extend: bool, cx: &mut Context<Self>) {
        self.move_to(self.word_target(forward), extend, cx);
    }

    fn delete_word(&mut self, forward: bool, window: &mut Window, cx: &mut Context<Self>) {
        let before = self.selection();
        if before.is_empty() {
            let target = self.word_target(forward);
            if before.head == target {
                return;
            }
            self.prepare_typing_group(
                if forward {
                    TypingKind::DeleteForward
                } else {
                    TypingKind::DeleteBackward
                },
                before,
            );
            let _ = self
                .editor
                .set_selection(Selection::new(before.head, target));
        } else {
            self.close_typing_group();
        }
        self.dispatch(Command::ReplaceSelection(String::new()), window, cx);
        self.finish_typing_edit();
    }

    fn delete_grapheme(&mut self, forward: bool, window: &mut Window, cx: &mut Context<Self>) {
        let before = self.selection();
        if before.is_empty() {
            let target = self.grapheme_target(forward);
            if target == before.head {
                return;
            }
            self.prepare_typing_group(
                if forward {
                    TypingKind::DeleteForward
                } else {
                    TypingKind::DeleteBackward
                },
                before,
            );
            let _ = self
                .editor
                .set_selection(Selection::new(before.head, target));
        } else {
            self.close_typing_group();
        }
        self.dispatch(Command::ReplaceSelection(String::new()), window, cx);
        self.finish_typing_edit();
    }

    fn vertical(&mut self, forward: bool, extend: bool, cx: &mut Context<Self>) {
        let Some((position, height)) = self.position_for_offset(self.selection().head) else {
            return;
        };
        let target = point(
            position.x,
            position.y + if forward { height * 1.2 } else { -height * 0.8 },
        );
        if let Some(offset) = self.index_at_point(target) {
            self.move_to(offset, extend, cx);
        }
    }
    fn line_edge(&mut self, end: bool, extend: bool, cx: &mut Context<Self>) {
        let Some((position, _)) = self.position_for_offset(self.selection().head) else {
            return;
        };
        let target = point(
            if end { px(100_000.) } else { px(-100_000.) },
            position.y + px(1.),
        );
        if let Some(offset) = self.index_at_point(target) {
            self.move_to(offset, extend, cx);
        }
    }

    fn copy(&mut self, _: &Copy, window: &mut Window, cx: &mut Context<Self>) {
        if self.selection().is_empty() {
            return;
        }
        match self.clipboard_item() {
            Ok((item, fragment)) => self.publish_clipboard(item, fragment, window, cx),
            Err(error) => self.clipboard_error(error, cx),
        }
    }
    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(target_os = "linux")]
        if self
            .external_clipboard
            .as_ref()
            .is_some_and(|external| external.transport.is_wayland())
        {
            self.cut_wayland(window, cx);
            return;
        }
        if self.selection().is_empty() {
            return;
        }
        let (item, fragment) = match self.clipboard_item() {
            Ok(item) => item,
            Err(error) => {
                self.clipboard_error(error, cx);
                return;
            }
        };
        self.close_typing_group();
        if self.marked_range.take().is_some() {
            self.editor.end_history_group();
        }
        if self
            .execute(Command::ReplaceSelection(String::new()), window, cx)
            .is_ok()
        {
            self.publish_clipboard(item, fragment, window, cx);
        }
    }
    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        self.close_typing_group();
        if self.marked_range.take().is_some() {
            self.editor.end_history_group();
        }
        #[cfg(target_os = "linux")]
        if self.external_clipboard.is_some() {
            self.paste_external(window, cx);
            return;
        }
        if let Some(item) = cx.read_from_clipboard() {
            let text = item.text().unwrap_or_default();
            let rich = item
                .metadata()
                .map(|metadata| RichFragment::from_clipboard_metadata(metadata, &text));
            match rich {
                Some(Ok(Some(fragment))) => {
                    self.dispatch(Command::PasteFragment(fragment), window, cx)
                }
                Some(Err(error)) => self.clipboard_error(error, cx),
                _ if !text.is_empty() => self.replace_text_in_range(None, &text, window, cx),
                _ => {}
            }
        }
        self.close_typing_group();
    }

    fn clipboard_item(&self) -> Result<(ClipboardItem, RichFragment), EditorError> {
        let fragment = self.document().copy_fragment(self.selection().range())?;
        #[cfg(target_os = "linux")]
        if self.external_clipboard.is_some() {
            super::clipboard_x11::ClipboardOffer::rich(&fragment)
                .map_err(|error| EditorError::Clipboard(format!("{error:#}")))?;
        }
        let item = ClipboardItem::new_string_with_metadata(
            fragment.plain_text(),
            fragment.to_clipboard_metadata()?,
        );
        Ok((item, fragment))
    }
    #[cfg(not(target_os = "linux"))]
    fn publish_clipboard(
        &mut self,
        item: ClipboardItem,
        _: RichFragment,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        cx.write_to_clipboard(item);
    }
    fn clipboard_error(&mut self, error: EditorError, cx: &mut Context<Self>) {
        self.error = Some(error.clone());
        cx.emit(RichEditorEvent::Error(error));
        cx.notify();
    }

    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.drag.is_active() {
            self.cancel_block_drag(window, cx);
            return;
        }
        // Native child buttons claim focus/default handling before bubbling.
        // Leave their click tracking intact and keep this passage's caret.
        if window.default_prevented() && !self.focus.is_focused(window) {
            return;
        }
        window.focus(&self.focus, cx);
        self.selecting = true;
        if let Some(offset) = self.index_at_point(event.position) {
            self.move_to(offset, event.modifiers.shift, cx);
        }
    }
    fn mouse_move(&mut self, event: &MouseMoveEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_comment_hover(window, cx);
        if !self.drag.is_active()
            && self.selecting
            && let Some(offset) = self.index_at_point(event.position)
        {
            self.move_to(offset, true, cx);
        }
    }
    fn mouse_up(&mut self, _: &MouseUpEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.selecting = false;
        self.drag_mouse_up(window, cx);
    }

    fn utf16_range(&self, range: Range<usize>) -> Range<usize> {
        self.document().scalar_to_utf16(range.start).unwrap_or(0)
            ..self
                .document()
                .scalar_to_utf16(range.end)
                .unwrap_or(self.document().text_len_utf16())
    }
    fn scalar_range(&self, range: Range<usize>) -> Range<usize> {
        let length = self.document().text_len_utf16();
        let mut start = range.start.min(length);
        let mut end = range.end.min(length);
        while self.document().utf16_to_scalar(start).is_none() && start > 0 {
            start -= 1;
        }
        while self.document().utf16_to_scalar(end).is_none() && end < length {
            end += 1;
        }
        self.document().utf16_to_scalar(start).unwrap_or(0)
            ..self
                .document()
                .utf16_to_scalar(end)
                .unwrap_or(self.document().text_len())
    }

    fn position_for_offset(&self, offset: usize) -> Option<(Point<Pixels>, Pixels)> {
        let block = self.document().block_at_offset(offset)?;
        let placed = self.placed.borrow();
        let placed = placed.get(&block.path)?;
        let relative = offset
            .saturating_sub(block.range.start)
            .min(block.range.end - block.range.start);
        placed.layout.position(relative).map(|position| {
            (
                placed.bounds.origin + position,
                placed.layout.line_height_at(relative),
            )
        })
    }

    fn index_at_point(&self, position: Point<Pixels>) -> Option<usize> {
        let placed = self.placed.borrow();
        let (path, block) = placed.iter().min_by(|(_, left), (_, right)| {
            let distance = |block: &PlacedBlock| {
                let y = if position.y < block.bounds.top() {
                    block.bounds.top() - position.y
                } else if position.y > block.bounds.bottom() {
                    position.y - block.bounds.bottom()
                } else {
                    px(0.)
                };
                let x = if position.x < block.bounds.left() {
                    block.bounds.left() - position.x
                } else if position.x > block.bounds.right() {
                    position.x - block.bounds.right()
                } else {
                    px(0.)
                };
                f32::from(y) * 10_000. + f32::from(x)
            };
            distance(left).total_cmp(&distance(right))
        })?;
        Some(
            self.document().offset_of_node(path)?
                + block.layout.index(position - block.bounds.origin),
        )
    }

    fn layout_block(
        &self,
        block: &RichBlock,
        width: Pixels,
        initial: bool,
        window: &mut Window,
        cx: &App,
    ) -> Arc<ParagraphLayout> {
        let carry = self.opening_flow_before(block, width, window, cx);
        self.layout_block_with_carry(block, width, initial, carry, window, cx)
    }

    // Both continuous and paginated flow share the exact shape/cache path.
    // Page frames supply carry after their measured spacer transform.
    fn layout_block_with_carry(
        &self,
        block: &RichBlock,
        width: Pixels,
        initial: bool,
        carry: FloatReservation,
        window: &mut Window,
        cx: &App,
    ) -> Arc<ParagraphLayout> {
        let colors = *theme::palette(cx);
        let typography = self.typography_for_path(&block.path);
        let language = self.language_for_path(&block.path);
        let note_counts = if block.node.note_counts() == [0; 2] {
            [0; 2]
        } else {
            self.document()
                .note_counts_before_node(&block.path)
                .unwrap_or_default()
        };
        let atom_revision = if block
            .runs
            .iter()
            .any(|run| matches!(run.content, RunContent::Object(_)))
        {
            self.atom_revision
        } else {
            0
        };
        let math_form = self.inline_math_flow.for_block(block, self.document());
        let matches_context = |cached: &CachedLayout| {
            cached.node.shares_storage_with(&block.node)
                && cached.ink == colors.ink
                && cached.initial == initial
                && cached.opening == self.opening
                && cached.atom_revision == atom_revision
                && cached.math_form == math_form
                && cached.carry == carry
                && cached.typography == typography
                && cached.note_counts == note_counts
                && cached.language == language
        };
        if let Some(cached) = self.layouts.borrow().get(&block.path)
            && matches_context(cached)
        {
            if cached.width == width {
                return cached.layout.clone();
            }
            if let Some(alternate) = &cached.alternate
                && alternate.width == width
            {
                return alternate.layout.clone();
            }
        }
        let hyphenation = self.cached_hyphenation(block, &language);
        let layout = Arc::new(shape_block(
            block,
            width,
            ShapeOptions {
                opening: initial.then_some(self.opening),
                atom_ready: &self.atom_ready,
                generation: self.atom_generation,
                carry,
                typography,
                note_counts,
                hyphenation: &hyphenation,
                math_form: math_form.as_ref(),
            },
            window,
            cx,
        ));
        // A measured flow width and its native edge-snapped prepaint width can
        // differ. Retain precisely one other width with the same complete
        // shaping context so frame refreshes do not reshape untouched blocks.
        // A node/style/context change discards both previous variants.
        let alternate = self
            .layouts
            .borrow()
            .get(&block.path)
            .filter(|cached| matches_context(cached))
            .map(|cached| CachedWidthLayout {
                width: cached.width,
                layout: cached.layout.clone(),
            });
        self.layouts.borrow_mut().insert(
            block.path.clone(),
            CachedLayout {
                node: block.node.clone(),
                width,
                ink: colors.ink,
                initial,
                opening: self.opening,
                atom_revision,
                math_form,
                carry,
                typography,
                note_counts,
                language,
                layout: layout.clone(),
                alternate,
            },
        );
        layout
    }

    fn language_for_path(&self, path: &[usize]) -> Arc<str> {
        for end in (1..=path.len()).rev() {
            if let Some(language) = self
                .document()
                .node(&path[..end])
                .and_then(Node::as_element)
                .and_then(|element| element.shell.attr("lang"))
            {
                return Arc::from(language);
            }
        }
        self.language.clone()
    }

    fn cached_hyphenation(&self, block: &RichBlock, language: &Arc<str>) -> Arc<Hyphenation> {
        if let Some(cached) = self.hyphenation.borrow().get(&block.path)
            && cached.node.shares_storage_with(&block.node)
            && cached.language == *language
        {
            return cached.opportunities.clone();
        }
        let opportunities = Arc::new(Hyphenation::for_block(block, language));
        self.hyphenation.borrow_mut().insert(
            block.path.clone(),
            CachedHyphenation {
                node: block.node.clone(),
                language: language.clone(),
                opportunities: opportunities.clone(),
            },
        );
        opportunities
    }

    fn opening_flow_before(
        &self,
        block: &RichBlock,
        width: Pixels,
        window: &mut Window,
        cx: &App,
    ) -> FloatReservation {
        let Some(first) = self.opening_index else {
            return FloatReservation::default();
        };
        if self.opening.mode == InitialMode::Off
            || block.kind != NodeKind::Paragraph
            || block.path.len() != 1
            || block.path[0] <= first
        {
            return FloatReservation::default();
        }
        let mut carry = FloatReservation::default();
        for index in first..block.path[0] {
            let node = &self.document().nodes()[index];
            if !node
                .as_element()
                .is_some_and(|element| element.kind == NodeKind::Paragraph)
            {
                return FloatReservation::default();
            }
            let previous = self.cached_block(node, vec![index]);
            let layout = self.layout_block(&previous, width, index == first, window, cx);
            if index == first {
                carry = layout.float_reservation;
            }
            carry.height -= layout.size.height;
            let (after, _) = paragraph_margins(node);
            let (_, before) = paragraph_margins(&self.document().nodes()[index + 1]);
            carry.height -= px(after.max(before));
            if carry.height <= px(0.) {
                return FloatReservation::default();
            }
        }
        carry
    }

    fn previous_margin(&self, path: &[usize]) -> f32 {
        let Some((&index, parent)) = path.split_last() else {
            return 0.;
        };
        if index == 0 {
            return 0.;
        }
        let nodes = if parent.is_empty() {
            self.document().nodes()
        } else if let Some(element) = self.document().node(parent).and_then(Node::as_element) {
            &element.children
        } else {
            return 0.;
        };
        paragraph_margins(&nodes[index - 1]).0
    }

    fn typography_for_path(&self, path: &[usize]) -> TypographyContext {
        for end in (1..=path.len()).rev() {
            let Some(element) = self
                .document()
                .node(&path[..end])
                .and_then(Node::as_element)
            else {
                continue;
            };
            match element.kind {
                NodeKind::BlockQuote => return TypographyContext::Quote,
                NodeKind::TableCell { header: true } => return TypographyContext::TableHeader,
                NodeKind::TableCell { header: false } => return TypographyContext::TableBody,
                _ => {}
            }
        }
        TypographyContext::Body
    }

    /// Runs use local offsets here so a change in an earlier paragraph does
    /// not rebuild or reshape otherwise identical later paragraphs.
    fn cached_block(&self, node: &Node, path: NodePath) -> Arc<RichBlock> {
        if let Some(block) = self.blocks.borrow().get(&path)
            && block.node.shares_storage_with(node)
        {
            return block.clone();
        }
        let block = Arc::new(super::model::rich_block(node, 0, path.clone()));
        self.blocks.borrow_mut().insert(path, block.clone());
        block
    }

    fn image_source(&self, node: &Node, path: NodePath, src: &str) -> Result<ImageSource, String> {
        if let Some(cached) = self.images.borrow().get(&path)
            && cached.node.shares_storage_with(node)
        {
            return cached.source.clone();
        }
        let source = images::source(src);
        self.images.borrow_mut().insert(
            path,
            CachedImage {
                node: node.clone(),
                source: source.clone(),
            },
        );
        source
    }
}

impl EntityInputHandler for RichEditorView {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let scalar = self.scalar_range(range);
        *actual_range = Some(self.utf16_range(scalar.clone()));
        self.document().text_in_range(scalar).ok()
    }
    fn selected_text_range(
        &mut self,
        ignore_disabled: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        if self.is_read_only() && !ignore_disabled {
            return None;
        }
        Some(UTF16Selection {
            range: self.utf16_range(self.selection().range()),
            reversed: self.selection().head < self.selection().anchor,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range
            .clone()
            .map(|range| self.utf16_range(range))
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.marked_range.take().is_some() {
            self.editor.end_history_group();
        }
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let scalar = range
            .map(|range| self.scalar_range(range))
            .or_else(|| self.marked_range.clone())
            .unwrap_or_else(|| self.selection().range());
        let composing = self.marked_range.take().is_some();
        if composing || !scalar.is_empty() || text.is_empty() || text.contains(['\n', '\r']) {
            self.close_typing_group();
        } else {
            self.prepare_typing_group(TypingKind::Insert, Selection::caret(scalar.start));
        }
        if self
            .editor
            .set_selection(Selection::new(scalar.start, scalar.end))
            .is_ok()
        {
            self.dispatch(Command::ReplaceSelection(text.into()), window, cx);
        }
        if composing {
            self.editor.end_history_group();
        } else {
            self.finish_typing_edit();
        }
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let scalar = range
            .map(|range| self.scalar_range(range))
            .or_else(|| self.marked_range.clone())
            .unwrap_or_else(|| self.selection().range());
        if self.marked_range.is_none() {
            self.close_typing_group();
            self.editor.begin_history_group();
        }
        if self
            .editor
            .set_selection(Selection::new(scalar.start, scalar.end))
            .is_err()
        {
            return;
        }
        if self
            .execute(Command::ReplaceSelection(text.into()), window, cx)
            .is_err()
        {
            self.editor.end_history_group();
            self.marked_range = None;
            return;
        }
        let inserted_len = text.chars().count();
        self.marked_range = (!text.is_empty()).then_some(scalar.start..scalar.start + inserted_len);
        if let Some(selected) = selected {
            let start = super::scalar_offset_for_utf16(text, selected.start).unwrap_or(0);
            let end = super::scalar_offset_for_utf16(text, selected.end).unwrap_or(inserted_len);
            let _ = self
                .editor
                .set_selection(Selection::new(scalar.start + start, scalar.start + end));
        }
        if self.marked_range.is_none() {
            self.editor.end_history_group();
        }
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let scalar = self.scalar_range(range);
        let (start, height) = self.position_for_offset(scalar.start)?;
        let end = self
            .position_for_offset(scalar.end)
            .map(|(position, _)| position)
            .unwrap_or(start);
        Some(Bounds::new(
            start,
            size(
                if end.y == start.y {
                    (end.x - start.x).max(px(1.))
                } else {
                    px(1.)
                },
                height,
            ),
        ))
    }
    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        self.document().scalar_to_utf16(self.index_at_point(point)?)
    }
    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = self.scalar_range(range);
        let _ = self.set_selection(Selection::new(range.start, range.end), cx);
    }
    fn text_length_utf16(&mut self, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.document().text_len_utf16())
    }
    fn accepts_text_input(&self, _: &mut Window, _: &mut Context<Self>) -> bool {
        !self.is_read_only()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TypingKind {
    Insert,
    DeleteBackward,
    DeleteForward,
}

struct TypingGroup {
    kind: TypingKind,
    head: usize,
    marks: Vec<Mark>,
    last_edit: Instant,
}

impl Render for RichEditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_math_source_target(cx);
        self.sync_math_source_read_only(cx);
        self.prepare_inline_math_form(window, cx);
        self.prepare_pagination_frame();
        self.prepare_drag_frame(window, cx);
        self.prepare_note_frame(window, cx);
        let first_paragraph = self.document().nodes().iter().position(|node| {
            node.as_element()
                .is_some_and(|element| element.kind == NodeKind::Paragraph)
        });
        self.opening_index = first_paragraph;
        let nodes = self.document().nodes().to_vec();
        let entity = cx.entity();
        self.placed.borrow_mut().clear();
        self.comment_geometry.borrow_mut().clear();
        self.comment_hits.borrow_mut().clear();
        self.comment_focus.borrow_mut().clear();
        let hover_view = entity.downgrade();
        window.defer(cx, move |window, cx| {
            let _ = hover_view.update(cx, |view, cx| view.sync_comment_hover(window, cx));
        });
        let renderer = RichRender {
            entity: &entity,
            state: self,
            cx,
        };
        let children = paginated::render_nodes(&nodes, first_paragraph, &renderer);
        self.drag.finish_render();
        self.finish_pagination_frame(window, cx);
        let element = div()
            .id("twyne-rich-manuscript")
            .test_support()
            .w_full()
            .min_h(self.pagination_min_height())
            .flex()
            .flex_col()
            .key_context("TwyneRichEditor")
            .track_focus(&self.focus)
            .cursor(CursorStyle::IBeam)
            .on_action(
                cx.listener(|this, _: &math_source::EditMathSource, window, cx| {
                    this.edit_selected_math_source(window, cx);
                }),
            )
            .on_action(cx.listener(|this, _: &Backspace, window, cx| {
                this.delete_grapheme(false, window, cx)
            }))
            .on_action(
                cx.listener(|this, _: &Delete, window, cx| this.delete_grapheme(true, window, cx)),
            )
            .on_action(cx.listener(|this, _: &Left, _, cx| this.horizontal(false, false, cx)))
            .on_action(cx.listener(|this, _: &Right, _, cx| this.horizontal(true, false, cx)))
            .on_action(cx.listener(|this, _: &SelectLeft, _, cx| this.horizontal(false, true, cx)))
            .on_action(cx.listener(|this, _: &SelectRight, _, cx| this.horizontal(true, true, cx)))
            .on_action(
                cx.listener(|this, _: &WordLeft, _, cx| this.word_horizontal(false, false, cx)),
            )
            .on_action(
                cx.listener(|this, _: &WordRight, _, cx| this.word_horizontal(true, false, cx)),
            )
            .on_action(
                cx.listener(|this, _: &SelectWordLeft, _, cx| {
                    this.word_horizontal(false, true, cx)
                }),
            )
            .on_action(
                cx.listener(|this, _: &SelectWordRight, _, cx| {
                    this.word_horizontal(true, true, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &DeleteWordBackward, window, cx| {
                this.delete_word(false, window, cx)
            }))
            .on_action(cx.listener(|this, _: &DeleteWordForward, window, cx| {
                this.delete_word(true, window, cx)
            }))
            .on_action(cx.listener(|this, _: &Up, _, cx| this.vertical(false, false, cx)))
            .on_action(cx.listener(|this, _: &Down, _, cx| this.vertical(true, false, cx)))
            .on_action(cx.listener(|this, _: &SelectUp, _, cx| this.vertical(false, true, cx)))
            .on_action(cx.listener(|this, _: &SelectDown, _, cx| this.vertical(true, true, cx)))
            .on_action(cx.listener(|this, _: &Home, _, cx| this.line_edge(false, false, cx)))
            .on_action(cx.listener(|this, _: &End, _, cx| this.line_edge(true, false, cx)))
            .on_action(cx.listener(|this, _: &SelectHome, _, cx| this.line_edge(false, true, cx)))
            .on_action(cx.listener(|this, _: &SelectEnd, _, cx| this.line_edge(true, true, cx)))
            .on_action(cx.listener(|this, _: &DocumentStart, _, cx| this.move_to(0, false, cx)))
            .on_action(cx.listener(|this, _: &DocumentEnd, _, cx| {
                this.move_to(this.document().text_len().saturating_sub(1), false, cx)
            }))
            .on_action(cx.listener(|this, _: &SelectAll, _, cx| {
                let _ = this.set_selection(Selection::new(0, this.document().text_len()), cx);
            }))
            .on_action(cx.listener(|this, _: &Enter, window, cx| {
                this.dispatch(Command::SplitBlock, window, cx)
            }))
            .on_action(cx.listener(|this, _: &HardBreak, window, cx| {
                this.dispatch(Command::InsertInline(InlineObject::HardBreak), window, cx)
            }))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::paste))
            .on_action(
                cx.listener(|this, _: &Undo, window, cx| this.dispatch(Command::Undo, window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &Redo, window, cx| this.dispatch(Command::Redo, window, cx)),
            )
            .on_action(cx.listener(|this, _: &Bold, window, cx| {
                this.dispatch(Command::ToggleMark(Mark::Bold), window, cx)
            }))
            .on_action(cx.listener(|this, _: &Italic, window, cx| {
                this.dispatch(Command::ToggleMark(Mark::Italic), window, cx)
            }))
            .on_action(cx.listener(|this, _: &Underline, window, cx| {
                this.dispatch(Command::ToggleMark(Mark::Underline), window, cx)
            }))
            .on_action(cx.listener(|this, _: &Indent, window, cx| {
                this.dispatch(Command::Indent, window, cx)
            }))
            .on_action(cx.listener(|this, _: &Outdent, window, cx| {
                this.dispatch(Command::Outdent, window, cx)
            }))
            .on_action(cx.listener(|this, _: &CancelBlockDrag, window, cx| {
                this.cancel_block_drag(window, cx);
            }))
            .on_action(
                cx.listener(|this, _: &notes::DismissNote, window, cx| {
                    this.dismiss_note(window, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &notes::UndoNote, window, cx| {
                this.note_history(Command::Undo, window, cx)
            }))
            .on_action(cx.listener(|this, _: &notes::RedoNote, window, cx| {
                this.note_history(Command::Redo, window, cx)
            }))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .on_hover(cx.listener(|this, hovered: &bool, window, cx| {
                if !hovered {
                    this.sync_comment_hover(window, cx);
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_drag_move(cx.listener(Self::drag_move))
            .on_drop(cx.listener(Self::drop_blocks))
            .children(children)
            .when(self.notes_has_popup(), |this| {
                this.child(notes::popover(entity))
            });
        self.shortcut_handlers(element, cx)
    }
}

struct CachedLayout {
    node: Node,
    width: Pixels,
    ink: u32,
    initial: bool,
    opening: OpeningInitial,
    atom_revision: u64,
    math_form: Option<math_source_flow::BlockFormReservation>,
    carry: FloatReservation,
    typography: TypographyContext,
    note_counts: [usize; 2],
    language: Arc<str>,
    layout: Arc<ParagraphLayout>,
    alternate: Option<CachedWidthLayout>,
}
struct CachedWidthLayout {
    width: Pixels,
    layout: Arc<ParagraphLayout>,
}
struct CachedHyphenation {
    node: Node,
    language: Arc<str>,
    opportunities: Arc<Hyphenation>,
}
struct CachedImage {
    node: Node,
    source: Result<ImageSource, String>,
}
struct PlacedBlock {
    bounds: Bounds<Pixels>,
    layout: Arc<ParagraphLayout>,
}

#[derive(Clone)]
struct Piece {
    range: Range<usize>,
    shape: ShapedLine,
    origin: Point<Pixels>,
    line: usize,
    whitespace: bool,
    object: bool,
    baseline_shift: Pixels,
    float_initial: bool,
    visual_width: Option<Pixels>,
    paint_height: Option<Pixels>,
    image: Option<AtomRenderImage>,
    math_form: Option<math_source_flow::InlineMathPiece>,
    /// The intrinsic run box is used only on rows containing an open form.
    math_row_height: Option<Pixels>,
    /// Original scalar boundaries in the shaped, view-only display string.
    display_boundaries: Option<Arc<[usize]>>,
    tracking: Option<Arc<TrackedText>>,
    inset: Pixels,
    discretionary_hyphen: bool,
    comment_ink: Arc<[Hsla]>,
    comment_ids: Arc<[Arc<str>]>,
    comment_chip: Option<comments::CommentChip>,
    note: Option<notes::Marker>,
}

impl Piece {
    fn width(&self) -> Pixels {
        self.visual_width.unwrap_or(self.shape.width)
    }
    fn x_for_offset(&self, offset: usize) -> Pixels {
        if self.object {
            return if offset == 0 { px(0.) } else { self.width() };
        }
        let byte = self
            .display_boundaries
            .as_ref()
            .and_then(|boundaries| boundaries.get(offset).copied())
            .or_else(|| super::utf8_offset_for_scalar(&self.shape.text, offset))
            .unwrap_or(self.shape.text.len());
        let position = self.inset
            + self.shape.x_for_index(byte)
            + self
                .tracking
                .as_ref()
                .map_or(px(0.), |tracking| tracking.shift_at(byte));
        if self.whitespace && self.visual_width.is_some() {
            let unexpanded = self.shape.width
                + self.inset * 2.
                + self
                    .tracking
                    .as_ref()
                    .map_or(px(0.), |tracking| tracking.shift_at(self.shape.text.len()));
            if unexpanded > px(0.) {
                return position * (self.width() / unexpanded);
            }
        }
        position
    }
    fn index_for_x(&self, x: Pixels) -> usize {
        if self.object {
            return if x > self.width() / 2. {
                self.range.end - self.range.start
            } else {
                0
            };
        }
        if self.discretionary_hyphen {
            let byte = self.shape.text.len() - '\u{2010}'.len_utf8();
            let start = self.inset
                + self.shape.x_for_index(byte)
                + self
                    .tracking
                    .as_ref()
                    .map_or(px(0.), |tracking| tracking.shift_at(byte));
            if x >= start {
                return self.range.end - self.range.start;
            }
        }
        // Include the final source caret explicitly. GPUI's byte-length
        // fallback otherwise picks the end of any single non-ASCII glyph as
        // soon as x is positive. Source boundaries also keep ß→SS display
        // expansion and view-only hyphens out of the selection model.
        let mut first = 0;
        let mut last = self.range.end - self.range.start;
        while first < last {
            let middle = first + (last - first) / 2;
            if self.x_for_offset(middle) < x {
                first = middle + 1;
            } else {
                last = middle;
            }
        }
        let before = first.saturating_sub(1);
        if (self.x_for_offset(first) - x).abs() < (self.x_for_offset(before) - x).abs() {
            first
        } else {
            before
        }
    }
}

struct TrackedPart {
    shape: ShapedLine,
    x: Pixels,
}
struct TrackedText {
    parts: Vec<TrackedPart>,
    ends: Vec<usize>,
    spacing: Pixels,
}
impl TrackedText {
    fn new(shape: &ShapedLine, spacing: Pixels) -> Self {
        let ends: Vec<_> = shape
            .text
            .grapheme_indices(true)
            .map(|(start, grapheme)| start + grapheme.len())
            .collect();
        let mut cursor = shape.cursor();
        let mut start = 0;
        let parts = ends
            .iter()
            .enumerate()
            .map(|(index, &end)| {
                let x = shape.x_for_index(start) + spacing * index as f32;
                start = end;
                TrackedPart {
                    shape: cursor.take_until(end),
                    x,
                }
            })
            .collect();
        Self {
            parts,
            ends,
            spacing,
        }
    }
    fn shift_at(&self, byte: usize) -> Pixels {
        self.spacing * self.ends.partition_point(|&end| end <= byte) as f32
    }
}
struct VisualLine {
    range: Range<usize>,
    y: Pixels,
    height: Pixels,
    first: usize,
    last: usize,
}
struct ParagraphLayout {
    pieces: Vec<Piece>,
    lines: Vec<VisualLine>,
    size: Size<Pixels>,
    atom_requests: Vec<AtomRenderRequest>,
    float_reservation: FloatReservation,
    break_opportunities: Arc<Hyphenation>,
    comment_marks: Vec<comments::LocalComment>,
    comment_hover: Vec<comments::LocalHover>,
}

impl ParagraphLayout {
    fn index(&self, position: Point<Pixels>) -> usize {
        let Some(line) = self
            .lines
            .iter()
            .find(|line| position.y < line.y + line.height)
            .or_else(|| self.lines.last())
        else {
            return 0;
        };
        let pieces = &self.pieces[line.first..line.last];
        for piece in pieces {
            if position.x <= piece.origin.x + piece.width() {
                let raw = piece.range.start + piece.index_for_x(position.x - piece.origin.x);
                let (before, after) = self.break_opportunities.grapheme_edges(raw);
                if before == after {
                    return raw;
                }
                let x_for = |offset: usize| {
                    pieces.iter().find_map(|piece| {
                        (offset >= piece.range.start && offset <= piece.range.end).then(|| {
                            piece.origin.x + piece.x_for_offset(offset - piece.range.start)
                        })
                    })
                };
                return match (x_for(before), x_for(after)) {
                    (Some(left), Some(right))
                        if (right - position.x).abs() < (left - position.x).abs() =>
                    {
                        after
                    }
                    _ => before,
                };
            }
        }
        line.range.end
    }
    fn position(&self, offset: usize) -> Option<Point<Pixels>> {
        for piece in &self.pieces {
            if offset >= piece.range.start && offset <= piece.range.end {
                let x = piece.x_for_offset(offset - piece.range.start);
                let (y, _) = math_source_flow::caret_y_height(piece, &self.lines[piece.line]);
                return Some(point(piece.origin.x + x, y));
            }
        }
        self.lines.last().map(|line| point(px(0.), line.y))
    }
    fn line_height_at(&self, offset: usize) -> Pixels {
        if let Some(piece) = self.pieces.iter().find(|piece| {
            !piece.range.is_empty() && offset >= piece.range.start && offset <= piece.range.end
        }) {
            return math_source_flow::caret_y_height(piece, &self.lines[piece.line]).1;
        }
        self.lines
            .iter()
            .find(|line| offset >= line.range.start && offset <= line.range.end)
            .map_or(px(32.4), |line| line.height)
    }
}

struct BlockElement {
    view: Entity<RichEditorView>,
    block: Arc<RichBlock>,
    global_start: usize,
    initial: bool,
    placement: Option<paginated::BlockPlacement>,
}
type LayoutState = Rc<RefCell<Option<Arc<ParagraphLayout>>>>;
struct BlockPrepaint {
    bounds: Bounds<Pixels>,
    layout: Arc<ParagraphLayout>,
    images: Vec<AnyElement>,
    comment_buttons: Vec<AnyElement>,
    note_buttons: Vec<AnyElement>,
    inline_math_form: Option<math_source_flow::InlineMathChild>,
    math_buttons: Vec<AnyElement>,
}

impl IntoElement for BlockElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl gpui_kit::Element for BlockElement {
    type RequestLayoutState = LayoutState;
    type PrepaintState = BlockPrepaint;
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
        _: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let state = Rc::new(RefCell::new(None));
        let measured_state = state.clone();
        let view = self.view.clone();
        let block = self.block.clone();
        let initial = self.initial;
        let placement = self.placement.clone();
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        let id = window.request_measured_layout(style, move |known, available, window, cx| {
            let width = known
                .width
                .or(match available.width {
                    AvailableSpace::Definite(width) => Some(width),
                    _ => None,
                })
                .unwrap_or(px(640.))
                .max(px(1.));
            let layout = placement
                .as_ref()
                .and_then(paginated::BlockPlacement::measured_layout)
                .unwrap_or_else(|| {
                    view.read(cx)
                        .layout_block(&block, width, initial, window, cx)
                });
            let result = layout.size;
            *measured_state.borrow_mut() = Some(layout);
            result
        });
        (id, state)
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let exact = self
            .placement
            .as_ref()
            .and_then(|placement| placement.content());
        let bounds = exact.as_ref().map_or(bounds, |(bounds, _)| *bounds);
        let layout = exact.map(|(_, layout)| layout).unwrap_or_else(|| {
            state.borrow().clone().unwrap_or_else(|| {
                self.view.read(cx).layout_block(
                    &self.block,
                    bounds.size.width,
                    self.initial,
                    window,
                    cx,
                )
            })
        });
        self.view.read(cx).placed.borrow_mut().insert(
            self.block.path.clone(),
            PlacedBlock {
                bounds,
                layout: layout.clone(),
            },
        );
        let requests = layout.atom_requests.clone();
        if !requests.is_empty()
            && let Some(scope) = self.view.read(cx).atom_request_ticket()
        {
            let view = self.view.downgrade();
            let block = self.block.clone();
            window.defer(cx, move |window, cx| {
                let _ = view.update(cx, |view, cx| {
                    view.enqueue_atoms(block, scope, requests, window, cx)
                });
            });
        }
        let images = layout
            .pieces
            .iter()
            .filter_map(|piece| {
                let image = piece.image.as_ref()?;
                let mut element = img(image.image.clone())
                    .w(px(image.width_px))
                    .h(px(image.height_px))
                    .into_any_element();
                element.prepaint_as_root(
                    bounds.origin + piece.origin,
                    size(
                        AvailableSpace::Definite(px(image.width_px)),
                        AvailableSpace::Definite(px(image.height_px)),
                    ),
                    window,
                    cx,
                );
                Some(element)
            })
            .collect();
        let (quiet, revision) = {
            let view = self.view.read(cx);
            (view.comments_quiet, view.revision())
        };
        let mut comment_buttons = Vec::new();
        {
            let view = self.view.read(cx);
            let mut measured = view.comment_geometry.borrow_mut();
            for mark in &layout.comment_marks {
                measured.entry(mark.chip.id.clone()).or_default().insert(
                    (self.block.path.clone(), mark.chip.ordinal),
                    comments::MeasuredComment {
                        range: self.global_start + mark.chip.range.start
                            ..self.global_start + mark.chip.range.end,
                        bounds: Bounds::new(bounds.origin + mark.bounds.origin, mark.bounds.size),
                        lines: mark
                            .lines
                            .iter()
                            .map(|line| Bounds::new(bounds.origin + line.origin, line.size))
                            .collect(),
                    },
                );
            }
        }
        if !quiet {
            let view = self.view.read(cx);
            let mut hits = view.comment_hits.borrow_mut();
            for area in &layout.comment_hover {
                let hitbox = window.insert_hitbox(
                    Bounds::new(bounds.origin + area.bounds.origin, area.bounds.size),
                    gpui_kit::HitboxBehavior::Normal,
                );
                hits.push(comments::HoverTarget {
                    hitbox,
                    ids: area.ids.clone(),
                });
            }
        }
        for piece in &layout.pieces {
            if let Some(chip) = &piece.comment_chip {
                let line = &layout.lines[piece.line];
                let origin = bounds.origin
                    + point(
                        piece.origin.x + chip.font_size * 0.25,
                        piece
                            .math_row_height
                            .map_or(line.y + line.height / 2., |height| {
                                piece.origin.y + height / 2.
                            })
                            - chip.font_size * 0.25,
                    );
                if !quiet {
                    let control = window.pixel_snap_bounds(Bounds::new(
                        origin,
                        size(chip.font_size * 0.5, chip.font_size * 0.5),
                    ));
                    let hitbox = window.insert_hitbox(control, gpui_kit::HitboxBehavior::Normal);
                    self.view
                        .read(cx)
                        .comment_hits
                        .borrow_mut()
                        .push(comments::HoverTarget {
                            hitbox,
                            ids: Arc::from([chip.id.clone()]),
                        });
                    let mut button = comments::button(
                        chip,
                        &self.block.path,
                        self.global_start,
                        self.view.clone(),
                        revision,
                        window,
                        cx,
                    );
                    button.prepaint_as_root(
                        control.origin,
                        size(
                            AvailableSpace::Definite(control.size.width),
                            AvailableSpace::Definite(control.size.height),
                        ),
                        window,
                        cx,
                    );
                    comment_buttons.push(button);
                }
            }
        }
        let mut note_buttons = Vec::new();
        for piece in &layout.pieces {
            if let Some(marker) = &piece.note {
                let local = notes::marker_bounds(piece, &layout.lines[piece.line]);
                let control = Bounds::new(bounds.origin + local.origin, local.size);
                let mut button = notes::marker_button(
                    marker,
                    piece,
                    self.global_start,
                    self.view.clone(),
                    control,
                    window,
                    cx,
                );
                button.prepaint_as_root(
                    control.origin,
                    size(
                        AvailableSpace::Definite(control.size.width),
                        AvailableSpace::Definite(control.size.height),
                    ),
                    window,
                    cx,
                );
                note_buttons.push(button);
            }
        }
        let math_buttons =
            math_source::anchor_buttons(&self.view, &layout, self.global_start, bounds, window, cx);
        let mut inline_math_form = {
            let view = self.view.read(cx);
            view.inline_math_child(&layout, bounds.origin, cx)
        };
        if let Some(form) = &mut inline_math_form {
            form.prepaint(window, cx);
        }
        BlockPrepaint {
            bounds,
            layout,
            images,
            comment_buttons,
            note_buttons,
            inline_math_form,
            math_buttons,
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        state: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let bounds = state.bounds;
        let view = self.view.read(cx);
        let focus = view.focus.clone();
        let selection = view.selection();
        let selected = selection.range();
        let marked = view.marked_range.clone();
        let tool_span = view.tool_span.clone();
        let tool_sentence = view.tool_sentence.clone();
        let read_only = view.is_read_only();
        let comments_quiet = view.comments_quiet;
        let colors = *theme::palette(cx);
        let note_paint = view.note_paint_state(colors);
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.view.clone()),
            cx,
        );
        for piece in &state.layout.pieces {
            let global =
                (self.global_start + piece.range.start)..(self.global_start + piece.range.end);
            for (decoration, opacity, underline) in
                [(&tool_span, 0.38, true), (&tool_sentence, 0.14, false)]
            {
                if let Some(range) = decoration
                    && !piece.range.is_empty()
                    && range.start < global.end
                    && range.end > global.start
                {
                    let from = range.start.saturating_sub(global.start);
                    let to = range.end.saturating_sub(global.start).min(global.len());
                    let x = piece.x_for_offset(from);
                    let ink =
                        math_source_flow::selection_bounds(piece, &state.layout.lines[piece.line]);
                    let mut color: Hsla = rgb(colors.cobalt).into();
                    color.a = opacity;
                    window.paint_quad(fill(
                        Bounds::new(
                            bounds.origin
                                + point(
                                    piece.origin.x + x,
                                    if underline {
                                        ink.bottom() - px(1.)
                                    } else {
                                        ink.top()
                                    },
                                ),
                            size(
                                (piece.x_for_offset(to) - x).max(px(1.)),
                                if underline { px(1.) } else { ink.size.height },
                            ),
                        ),
                        color,
                    ));
                }
            }
            if !comments_quiet {
                comments::paint_ink(
                    piece,
                    bounds.origin,
                    &state.layout.lines[piece.line],
                    window,
                );
            }
            if (piece.note.is_none() || selected != global)
                && !piece.range.is_empty()
                && selected.start < global.end
                && selected.end > global.start
            {
                let from = selected.start.saturating_sub(global.start);
                let to = selected
                    .end
                    .saturating_sub(global.start)
                    .min(global.end - global.start);
                let x = |offset| piece.x_for_offset(offset);
                let line = &state.layout.lines[piece.line];
                let mut color: Hsla = rgb(colors.vermilion).into();
                color.a = 0.18;
                let ink = math_source_flow::selection_bounds(piece, line);
                window.paint_quad(fill(
                    Bounds::new(
                        bounds.origin + point(piece.origin.x + x(from), ink.origin.y),
                        size((x(to) - x(from)).max(px(1.)), ink.size.height),
                    ),
                    color,
                ));
            }
            let origin = bounds.origin + piece.origin + point(piece.inset, px(0.));
            let line = &state.layout.lines[piece.line];
            let paint_height = piece
                .paint_height
                .or(piece.math_row_height)
                .unwrap_or(line.height);
            let note_shape = piece.note.as_ref().map(|marker| {
                notes::paint_marker(
                    marker,
                    piece,
                    line,
                    bounds.origin,
                    &note_paint,
                    selected == global,
                    window,
                )
            });
            let shape = note_shape
                .as_ref()
                .map(|(shape, _)| shape)
                .unwrap_or(&piece.shape);
            let tracking = note_shape
                .as_ref()
                .and_then(|(_, tracking)| tracking.as_ref())
                .or(piece.tracking.as_ref());
            // The real child paints an open form. Its placeholder carries
            // inherited font metrics, never manuscript or preview text.
            if piece.math_form.is_none() {
                if let Some(tracking) = tracking {
                    for part in &tracking.parts {
                        let part_origin = origin + point(part.x, px(0.));
                        let _ = part.shape.paint_background(
                            part_origin,
                            paint_height,
                            TextAlign::Left,
                            None,
                            window,
                            cx,
                        );
                        let _ = part.shape.paint(
                            part_origin,
                            paint_height,
                            TextAlign::Left,
                            None,
                            window,
                            cx,
                        );
                    }
                } else {
                    let _ = shape.paint_background(
                        origin,
                        paint_height,
                        TextAlign::Left,
                        None,
                        window,
                        cx,
                    );
                    let _ = shape.paint(origin, paint_height, TextAlign::Left, None, window, cx);
                }
            }
            if marked.as_ref().is_some_and(|range| {
                !piece.range.is_empty() && range.start < global.end && range.end > global.start
            }) {
                window.paint_quad(fill(
                    Bounds::new(
                        bounds.origin
                            + point(
                                piece.origin.x,
                                math_source_flow::selection_bounds(piece, line).bottom() - px(2.),
                            ),
                        size(piece.width(), px(1.)),
                    ),
                    rgb(colors.vermilion),
                ));
            }
        }
        for image in &mut state.images {
            image.paint(window, cx);
        }
        for button in &mut state.comment_buttons {
            button.paint(window, cx);
        }
        for button in &mut state.note_buttons {
            button.paint(window, cx);
        }
        if let Some(form) = &mut state.inline_math_form {
            form.paint(window, cx);
        }
        for button in &mut state.math_buttons {
            button.paint(window, cx);
        }
        if !read_only
            && focus.is_focused(window)
            && selection.is_empty()
            && selection.head >= self.global_start
            && selection.head <= self.global_start + self.block.range.end
            && let Some(position) = state.layout.position(selection.head - self.global_start)
        {
            window.paint_quad(fill(
                Bounds::new(
                    bounds.origin + position,
                    size(
                        px(1.4),
                        state
                            .layout
                            .line_height_at(selection.head - self.global_start),
                    ),
                ),
                rgb(colors.vermilion),
            ));
        }
    }
}

struct RichRender<'a> {
    entity: &'a Entity<RichEditorView>,
    state: &'a RichEditorView,
    cx: &'a App,
}

fn render_node(
    node: &Node,
    path: NodePath,
    global_start: usize,
    renderer: &RichRender<'_>,
    initial: bool,
) -> gpui_kit::AnyElement {
    render_node_with_placement(node, path, global_start, renderer, initial, None)
}

fn render_node_with_placement(
    node: &Node,
    path: NodePath,
    global_start: usize,
    renderer: &RichRender<'_>,
    initial: bool,
    placement: Option<paginated::BlockPlacement>,
) -> gpui_kit::AnyElement {
    let inner = render_node_content(
        node,
        path.clone(),
        global_start,
        renderer,
        initial,
        placement.clone(),
    );
    dragging::measure(node, path, inner, renderer, placement)
}

fn render_node_content(
    node: &Node,
    path: NodePath,
    global_start: usize,
    renderer: &RichRender<'_>,
    initial: bool,
    placement: Option<paginated::BlockPlacement>,
) -> gpui_kit::AnyElement {
    let colors = *theme::palette(renderer.cx);
    let Some(element) = node.as_element() else {
        return div().into_any_element();
    };
    if element.kind == NodeKind::NonContent {
        return div().into_any_element();
    }
    if element.is_text_block {
        let block = renderer.state.cached_block(node, path.clone());
        let shell = &element.shell;
        let (bottom, top) = paragraph_margins(node);
        let indent = shell
            .attr("data-indent")
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(0.)
            * 32.;
        let mut container = div().w_full().ml(px(indent)).relative();
        if placement.is_none() {
            container = container
                .mt(px((top - renderer.state.previous_margin(&path)).max(0.)))
                .mb(px(bottom));
        }
        container = container.child(BlockElement {
            view: renderer.entity.clone(),
            block: block.clone(),
            global_start,
            initial,
            placement: placement.clone(),
        });
        if matches!(element.kind, NodeKind::Heading(_)) && path.len() == 1 {
            container = container.child(dragging::heading_handle(
                node,
                &path,
                (top - renderer.state.previous_margin(&path)).max(0.),
                renderer,
            ));
        }
        if element.kind == NodeKind::Heading(1) && placement.is_none() {
            container = container.child(
                div()
                    .w_full()
                    .text_center()
                    .text_size(px(16.))
                    .line_height(px(17.6))
                    .mt(px(4.8))
                    .text_color(rgb(colors.vermilion))
                    .child("✦"),
            );
        }
        if element.kind == NodeKind::CodeBlock {
            container = container
                .bg(rgb(colors.ink))
                .px(px(22.5))
                .py(px(18.))
                .border_l(px(4.))
                .border_color(rgb(colors.mustard))
                .rounded(px(2.));
        }
        if initial
            && let Some((glyph, _, _)) = initial_glyph(&block)
            && glyph.len() == 1
            && glyph.as_bytes()[0].is_ascii_alphabetic()
        {
            let opening = renderer.state.opening;
            if opening.mode == InitialMode::Illuminated {
                let path = format!(
                    "assets/illuminated-initials/{}{}.avif",
                    glyph.to_ascii_lowercase(),
                    if opening.alternate { "-alt" } else { "" }
                );
                let bound = px(opening.size * 1.16);
                container = container.child(
                    div()
                        .absolute()
                        .left(px(0.))
                        .top(px(opening.size * 0.035))
                        .w(bound)
                        .h(bound)
                        .child(img(path).size_full()),
                );
            }
        }
        return container.into_any_element();
    }
    if element.kind.is_atom() {
        if element.kind == NodeKind::Math(crate::editor::MathDisplay::Block)
            && let Some(form) = renderer.state.math_form_at(&path)
        {
            // Same equation container and retained form child; no detached
            // overlay, source token, or saved renderer drawn under the form.
            return div()
                .w_full()
                .my(px(16.))
                .py(px(12.))
                .px(px(16.))
                .child(form)
                .into_any_element();
        }
        if matches!(element.kind, NodeKind::Math(_) | NodeKind::Mermaid) {
            return div()
                .w_full()
                .my(px(16.))
                .py(px(12.))
                .px(px(16.))
                .child(BlockElement {
                    view: renderer.entity.clone(),
                    block: renderer.state.cached_block(node, path),
                    global_start,
                    initial: false,
                    placement: None,
                })
                .into_any_element();
        }
        if element.kind == NodeKind::Image {
            let image = element.children.iter().find_map(|node| {
                node.as_element()
                    .filter(|element| element.shell.tag == "img")
            });
            let src = element
                .shell
                .attr("src")
                .or_else(|| image.and_then(|image| image.shell.attr("src")))
                .unwrap_or("");
            let width = element
                .shell
                .attr("data-image-width")
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(100.)
                .clamp(10., 100.)
                / 100.;
            let mut figure = div()
                .w(relative(width))
                .my(px(25.2))
                .mx_auto()
                .flex()
                .flex_col();
            if !src.is_empty() {
                let image_id = SharedString::from(format!(
                    "twyne-rich-image-{}",
                    path.iter()
                        .map(usize::to_string)
                        .collect::<Vec<_>>()
                        .join(".")
                ));
                let alt = image
                    .and_then(|image| image.shell.attr("alt"))
                    .unwrap_or("Image")
                    .to_owned();
                match renderer.state.image_source(node, path, src) {
                    Ok(source) => {
                        figure = figure.child(
                            img(source)
                                .w_full()
                                .when_some(
                                    renderer.state.pagination_image_max_height(),
                                    |image, height| {
                                        image
                                            .max_h(px(height))
                                            .object_fit(gpui_kit::ObjectFit::Contain)
                                    },
                                )
                                .with_fallback(move || {
                                    div()
                                        .w_full()
                                        .p(px(12.))
                                        .text_size(px(13.))
                                        .child(format!("{alt} — image unavailable"))
                                        .into_any_element()
                                })
                                .id(image_id)
                                .test_support(),
                        );
                    }
                    Err(error) => {
                        figure = figure.child(
                            div()
                                .w_full()
                                .p(px(12.))
                                .text_size(px(13.))
                                .child(format!("{alt} — {error}")),
                        )
                    }
                }
            }
            if let Some(caption) = element.children.iter().find_map(|node| {
                node.as_element()
                    .filter(|element| element.shell.tag == "figcaption")
            }) {
                let mut text = String::new();
                for node in &caption.children {
                    node.write_editing_text(&mut text);
                }
                figure = figure.child(
                    div()
                        .text_center()
                        .font_family(SANS_FONT)
                        .text_size(px(12.))
                        .text_color(rgb(colors.ink_muted))
                        .child(text),
                );
            }
            return figure.into_any_element();
        }
        if element.kind == NodeKind::HorizontalRule {
            return div()
                .w_full()
                .my(px(18.))
                .h(px(1.))
                .bg(rgb(colors.rule))
                .into_any_element();
        }
        if element.kind == NodeKind::PageBreak {
            // Source page-break nodes are invisible in both modes.
            // The active pagination frame paints the inert spacer label.
            return div().w_full().h(px(0.)).into_any_element();
        }
        let source = element
            .shell
            .attr("data-typst-source")
            .or_else(|| element.shell.attr("data-latex"))
            .or_else(|| element.shell.attr("data-mermaid-source"))
            .unwrap_or("");
        return div()
            .w_full()
            .my(px(12.))
            .p(px(12.))
            .border_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.paper_soft))
            .font_family(MONO_FONT)
            .text_size(px(13.))
            .text_color(rgb(colors.ink_muted))
            .child(source.to_string())
            .into_any_element();
    }
    let mut container = div().w_full().flex().flex_col();
    if element.kind == NodeKind::BlockQuote {
        container = container
            .border_l(px(3.))
            .border_color(rgb(colors.vermilion))
            .px(px(28.125))
            .py(px(9.))
            .my(px(27.));
    }
    if matches!(element.kind, NodeKind::List(_)) {
        container = container.pl(px(26.)).my(px(8.));
    }
    if element.kind == NodeKind::TableRow {
        container = div().w_full().flex().flex_row();
    }
    if matches!(element.kind, NodeKind::TableCell { .. }) {
        container = div()
            .flex_1()
            .min_w(px(40.))
            .flex()
            .flex_col()
            .p(px(8.))
            .border_1()
            .border_color(rgb(colors.rule));
        if let Some(color) = element
            .shell
            .attr("data-cell-background")
            .and_then(parse_color)
        {
            container = container.bg(color);
        }
    }
    let mut child_start = global_start;
    for (index, child) in element.children.iter().enumerate() {
        let mut child_path = path.clone();
        child_path.push(index);
        if matches!(element.kind, NodeKind::List(_))
            && child
                .as_element()
                .is_some_and(|element| matches!(element.kind, NodeKind::ListItem { .. }))
        {
            let item = child.as_element().expect("list item");
            let marker = match element.kind {
                NodeKind::List(super::ListKind::Ordered) => format!(
                    "{}.",
                    index
                        + element
                            .shell
                            .attr("start")
                            .and_then(|value| value.parse::<usize>().ok())
                            .unwrap_or(1)
                ),
                NodeKind::List(super::ListKind::Task) => {
                    if item.shell.attr("data-checked") == Some("true") {
                        "☑".into()
                    } else {
                        "☐".into()
                    }
                }
                _ => "•".into(),
            };
            let marker = if element.kind == NodeKind::List(super::ListKind::Task) {
                let view = renderer.entity.clone();
                let item_path = child_path.clone();
                let checked = item.shell.attr("data-checked") == Some("true");
                let id = SharedString::from(format!(
                    "twyne-task-{}",
                    child_path
                        .iter()
                        .map(usize::to_string)
                        .collect::<Vec<_>>()
                        .join(".")
                ));
                div()
                    .w(px(20.))
                    .pt(px(7.))
                    .child(
                        Checkbox::new(id)
                            .small()
                            .checked(checked)
                            .disabled(renderer.state.is_read_only())
                            .accessibility_label("Mark task complete")
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .on_click(move |checked, window, cx| {
                                view.update(cx, |this, cx| {
                                    this.dispatch(
                                        Command::SetAttributes {
                                            path: item_path.clone(),
                                            attributes: vec![(
                                                "data-checked".into(),
                                                Some(checked.to_string()),
                                            )],
                                        },
                                        window,
                                        cx,
                                    );
                                    window.focus(&this.focus, cx);
                                });
                            }),
                    )
                    .into_any_element()
            } else {
                div()
                    .w(px(20.))
                    .pt(px(2.))
                    .text_size(px(18.))
                    .text_color(rgb(colors.vermilion))
                    .child(marker)
                    .into_any_element()
            };
            container = container.child(
                div()
                    .w_full()
                    .flex()
                    .flex_row()
                    .gap(px(10.))
                    .child(marker)
                    .child(div().flex_1().min_w(px(0.)).child(render_node(
                        child,
                        child_path,
                        child_start,
                        renderer,
                        false,
                    ))),
            );
        } else {
            container =
                container.child(render_node(child, child_path, child_start, renderer, false));
        }
        child_start += child.projection_len();
    }
    container.into_any_element()
}

fn parse_color(value: &str) -> Option<Hsla> {
    let value = value.trim().strip_prefix('#')?;
    let value = if value.len() == 3 {
        value
            .chars()
            .flat_map(|character| [character, character])
            .collect::<String>()
    } else {
        value.to_string()
    };
    u32::from_str_radix(&value, 16)
        .ok()
        .map(|value| rgb(value).into())
}

fn initial_glyph(block: &RichBlock) -> Option<(String, usize, usize)> {
    let text = block.editing_text();
    for (byte, grapheme) in text.grapheme_indices(true) {
        if grapheme
            .chars()
            .all(|character| character.is_whitespace() || "“‘\"'«‹「『([{¿¡".contains(character))
        {
            continue;
        }
        if !grapheme.chars().next().is_some_and(char::is_alphanumeric) {
            return None;
        }
        let offset = super::scalar_offset_for_utf8(&text, byte)?;
        return Some((
            grapheme.to_string(),
            offset,
            offset + grapheme.chars().count(),
        ));
    }
    None
}

fn paragraph_margins(node: &Node) -> (f32, f32) {
    let Some(element) = node.as_element() else {
        return (0., 0.);
    };
    if !element.is_text_block {
        return (0., 0.);
    }
    let (before, after) = match element.kind {
        NodeKind::Heading(1) => (48., 18.),
        NodeKind::Heading(2) => (36., 9.6),
        NodeKind::Heading(3) => (19.2, 4.8),
        // Tailwind preflight resets H4–H6; Twyne adds no rules for them.
        NodeKind::Heading(4..=6) => (0., 0.),
        _ => (0., 8.1),
    };
    (
        element
            .shell
            .attr("data-space-after")
            .and_then(|value| value.parse::<f32>().ok())
            .map_or(after, |points| points * 4. / 3.),
        element
            .shell
            .attr("data-space-before")
            .and_then(|value| value.parse::<f32>().ok())
            .map_or(before, |points| points * 4. / 3.),
    )
}

#[derive(Clone, Copy, Default, PartialEq)]
struct FloatReservation {
    width: Pixels,
    height: Pixels,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TypographyContext {
    Body,
    Quote,
    TableBody,
    TableHeader,
}

struct ShapeOptions<'a> {
    opening: Option<OpeningInitial>,
    atom_ready: &'a HashMap<AtomRenderKey, Result<AtomRenderImage, AtomRenderError>>,
    generation: u64,
    carry: FloatReservation,
    typography: TypographyContext,
    note_counts: [usize; 2],
    hyphenation: &'a Arc<Hyphenation>,
    math_form: Option<&'a math_source_flow::BlockFormReservation>,
}

fn shape_block(
    block: &RichBlock,
    width: Pixels,
    options: ShapeOptions<'_>,
    window: &mut Window,
    cx: &App,
) -> ParagraphLayout {
    let ShapeOptions {
        opening,
        atom_ready,
        generation,
        carry,
        typography,
        mut note_counts,
        hyphenation,
        math_form: reserved_form,
    } = options;
    let colors = *theme::palette(cx);
    let editorial_features = theme::editorial_font_features();
    let (base_family, base_size, base_height, base_weight, mut default_align) = match block.kind {
        NodeKind::Heading(1) => (DISPLAY_FONT, 40., 44., FontWeight::BOLD, Alignment::Center),
        NodeKind::Heading(2) => (
            DISPLAY_FONT,
            24.,
            30.,
            FontWeight::SEMIBOLD,
            Alignment::Left,
        ),
        NodeKind::Heading(3) => (SANS_FONT, 12., 21.6, FontWeight::BOLD, Alignment::Left),
        NodeKind::CodeBlock => (MONO_FONT, 14., 25.2, FontWeight::NORMAL, Alignment::Left),
        NodeKind::Math(_) | NodeKind::Mermaid => {
            (SERIF_FONT, 18., 32.4, FontWeight::NORMAL, Alignment::Center)
        }
        _ => match typography {
            TypographyContext::Body => (
                SERIF_FONT,
                18.,
                32.4,
                FontWeight::NORMAL,
                Alignment::Justify,
            ),
            TypographyContext::Quote => (
                DISPLAY_FONT,
                22.5,
                34.875,
                FontWeight::NORMAL,
                Alignment::Justify,
            ),
            TypographyContext::TableBody => (
                SANS_FONT,
                15.2,
                27.36,
                FontWeight::NORMAL,
                Alignment::Justify,
            ),
            TypographyContext::TableHeader => (
                TYPEWRITER_FONT,
                11.2,
                20.16,
                FontWeight::BOLD,
                Alignment::Justify,
            ),
        },
    };
    if matches!(block.kind, NodeKind::Heading(4..=6)) {
        default_align = Alignment::Left;
    }
    let uppercase = block.kind == NodeKind::Heading(3)
        || (typography == TypographyContext::TableHeader && block.kind != NodeKind::CodeBlock);
    let letter_spacing = if block.kind == NodeKind::Heading(3) {
        px(3.84)
    } else if typography == TypographyContext::TableHeader && block.kind != NodeKind::CodeBlock {
        px(2.016)
    } else {
        px(0.)
    };
    let align = block
        .node
        .as_element()
        .and_then(|element| element.shell.style("text-align"))
        .map_or(default_align, |value| match value.as_str() {
            "center" => Alignment::Center,
            "right" => Alignment::Right,
            "justify" => Alignment::Justify,
            _ => Alignment::Left,
        });
    let base_height = block
        .node
        .as_element()
        .and_then(|element| element.shell.style("line-height"))
        .and_then(|value| value.parse::<f32>().ok())
        .map_or(base_height, |multiplier| multiplier * base_size);
    let mut items = Vec::new();
    let mut comment_anchors = comments::anchors(block);
    let note_paths = notes::block_paths(block);
    let mut atom_requests = Vec::new();
    let initial = opening
        .filter(|opening| opening.mode != InitialMode::Off)
        .and_then(|opening| initial_glyph(block).map(|glyph| (opening, glyph)));
    let reserve = initial.as_ref().map_or(carry.width, |(opening, _)| {
        px(opening.size
            * if opening.mode == InitialMode::Illuminated {
                1.16 + 0.14
            } else {
                0.85
            })
    });
    let reserve_height = initial.as_ref().map_or(carry.height, |(opening, _)| {
        px(opening.size
            * if opening.mode == InitialMode::Illuminated {
                0.035 + 1.16 + 0.02
            } else {
                1.2
            })
    });
    let mut cursor = 0;
    for run in &block.runs {
        let mut face: Font = font(base_family);
        face.weight = base_weight;
        face.features = editorial_features.clone();
        if typography == TypographyContext::Quote {
            face.style = FontStyle::Italic;
        }
        let mut font_size = base_size;
        let mut color: Hsla = rgb(if block.kind == NodeKind::CodeBlock {
            colors.paper
        } else if block.kind == NodeKind::Heading(3) {
            colors.vermilion
        } else if typography == TypographyContext::Quote
            && !matches!(block.kind, NodeKind::Heading(1..=3))
        {
            colors.ink_light
        } else {
            colors.ink
        })
        .into();
        let mut background = None;
        let mut underline = None;
        let mut strike = None;
        let mut shift = px(0.);
        let comment_ink = comments::ink(&run.wrappers, &colors);
        let comment_ids = comments::ids(&run.wrappers);
        for mark in &run.marks {
            match mark {
                Mark::Bold => face.weight = FontWeight::BOLD,
                Mark::Italic => face.style = FontStyle::Italic,
                Mark::FontFamily(family) => {
                    face.family = family.trim_matches(['\'', '"']).to_string().into()
                }
                Mark::FontSize(value) => {
                    let value = value.trim();
                    let (raw, factor) = if let Some(raw) = value.strip_suffix("pt") {
                        (raw, 4. / 3.)
                    } else if let Some(raw) = value.strip_suffix("rem") {
                        (raw, 16.)
                    } else if let Some(raw) = value.strip_suffix("em") {
                        (raw, base_size)
                    } else {
                        (value.trim_end_matches("px"), 1.)
                    };
                    if let Ok(size) = raw.parse::<f32>() {
                        font_size = (size * factor).clamp(6., 200.);
                    }
                }
                Mark::Color(value) => {
                    if let Some(value) = parse_color(value) {
                        color = value;
                    }
                }
                Mark::Highlight(value) => background = parse_color(value),
                Mark::Underline | Mark::Link { .. } => {
                    underline = Some(UnderlineStyle {
                        thickness: px(1.),
                        color: Some(color),
                        wavy: false,
                    })
                }
                Mark::Strike => {
                    strike = Some(StrikethroughStyle {
                        thickness: px(1.),
                        color: Some(color),
                    })
                }
                Mark::Subscript => {
                    font_size *= 0.72;
                    shift = px(font_size * 0.22);
                }
                Mark::Superscript => {
                    font_size *= 0.72;
                    shift = px(-font_size * 0.45);
                }
                Mark::Code => face.family = MONO_FONT.into(),
            }
        }
        let mut image = None;
        let mut math_form = None;
        let mut note = false;
        let mut note_reference = None;
        let mut inset = px(0.);
        let (display, object) = match &run.content {
            RunContent::Text(text) => (text.to_string(), false),
            RunContent::HardBreak => ("\n".to_string(), false),
            RunContent::Comment(_) => continue,
            RunContent::Object(node) => {
                let Some(element) = node.as_element() else {
                    continue;
                };
                if node.projection_len() == 0 {
                    continue;
                }
                if let Some(reserved) =
                    reserved_form.filter(|reserved| reserved.matches_atom(cursor, node))
                {
                    math_form = Some(reserved.measured.clone());
                    // Keep inherited run metrics for the source caret. The
                    // saved equation renderer and fallback are both hidden.
                    (String::new(), true)
                } else if let NodeKind::Note(kind) = element.kind {
                    note = true;
                    face.family = TYPEWRITER_FONT.into();
                    face.weight = FontWeight::SEMIBOLD;
                    // The specific ProseMirror sup rule wins over the note
                    // class: 0.72em with a -0.45em relative top offset.
                    font_size *= 0.72;
                    shift = px(-font_size * 0.45);
                    inset = px(font_size * 0.1);
                    let index = usize::from(kind == NoteKind::Footnote);
                    note_counts[index] += 1;
                    note_reference = Some((kind, note_counts[index], node.clone()));
                    color = rgb(if kind == NoteKind::Footnote {
                        colors.cobalt
                    } else {
                        colors.vermilion
                    })
                    .into();
                    (
                        format!(
                            "{}{}",
                            if kind == NoteKind::Footnote {
                                "†"
                            } else {
                                ""
                            },
                            note_counts[index]
                        ),
                        true,
                    )
                } else {
                    face.family = MONO_FONT.into();
                    font_size = 13.;
                    color = rgb(colors.ink_muted).into();
                    let source = element
                        .shell
                        .attr("data-typst-source")
                        .or_else(|| element.shell.attr("data-latex"))
                        .or_else(|| element.shell.attr("data-mermaid-source"))
                        .unwrap_or("◊");
                    let kind = match element.kind {
                        NodeKind::Math(display) => Some(AtomKind::LatexMath {
                            block: display == super::MathDisplay::Block,
                        }),
                        NodeKind::Mermaid => Some(AtomKind::Mermaid),
                        _ => None,
                    };
                    let mut fallback = source.to_string();
                    if let Some(kind) = kind {
                        let request = AtomRenderRequest {
                            kind,
                            source: Arc::from(source),
                            font_size_px: base_size,
                            color: colors.ink,
                            width_px: f32::from(width).clamp(1., 4096.),
                            generation,
                        };
                        match request.key() {
                            Ok(key) => match atom_ready.get(&key) {
                                Some(Ok(ready)) => {
                                    image = Some(ready.clone());
                                    fallback.clear();
                                }
                                Some(Err(error)) => {
                                    color = rgb(0x742718).into();
                                    background = Some(rgb(0xfff2ee).into());
                                    fallback = format!("{source} — {}", error.message);
                                }
                                None => atom_requests.push(request),
                            },
                            Err(error) => fallback = format!("{source} — {}", error.message),
                        }
                    }
                    (fallback.replace(['\n', '\r'], " "), true)
                }
            }
        };
        face.family = theme::resolve_ui_font_family(&face.family);
        if face.family == SERIF_FONT {
            face.fallbacks = Some(theme::serif_font_fallbacks());
        }
        if letter_spacing != px(0.) && (!object || note) {
            let mut features = editorial_features.0.as_ref().clone();
            features.push(("calt".into(), 0));
            face.features = FontFeatures(Arc::new(features));
        }
        let basic_tokens = if object {
            vec![display.as_str()]
        } else {
            paragraph_flow::natural_tokens(&display, cursor, hyphenation)
        };
        let mut tokens = Vec::new();
        let mut token_cursor = cursor;
        let mut bounded = Vec::new();
        for token in basic_tokens {
            if object {
                bounded.push(token);
            } else {
                bounded.extend(paragraph_flow::bounded_tokens(
                    token,
                    token_cursor,
                    hyphenation,
                ));
            }
            token_cursor += if object { 1 } else { token.chars().count() };
        }
        token_cursor = cursor;
        for token in bounded {
            let token_length = if object { 1 } else { token.chars().count() };
            if !object
                && let Some((_, (_, start, end))) = &initial
                && *start < token_cursor + token_length
                && *end > token_cursor
            {
                let start = start.saturating_sub(token_cursor).min(token_length);
                let end = end.saturating_sub(token_cursor).min(token_length);
                let from_byte =
                    super::utf8_offset_for_scalar(token, start).expect("bounded opening offset");
                let to_byte =
                    super::utf8_offset_for_scalar(token, end).expect("bounded opening offset");
                if from_byte > 0 {
                    tokens.push(&token[..from_byte]);
                }
                tokens.push(&token[from_byte..to_byte]);
                if to_byte < token.len() {
                    tokens.push(&token[to_byte..]);
                }
            } else {
                tokens.push(token);
            }
            token_cursor += token_length;
        }
        let mut contextual_shapes = if !object && !uppercase && letter_spacing == px(0.) {
            let mut source_cursor = cursor;
            let contexts = tokens
                .iter()
                .map(|&token| {
                    let scalar_len = token.chars().count();
                    let isolated = initial.as_ref().is_some_and(|(_, (_, from, to))| {
                        source_cursor == *from && source_cursor + scalar_len == *to
                    });
                    source_cursor += scalar_len;
                    paragraph_flow::ContextToken {
                        text: token,
                        scalar_len,
                        isolated,
                        stop_after: comment_anchors.contains_key(&source_cursor),
                    }
                })
                .collect::<Vec<_>>();
            paragraph_flow::shape_contextual_tokens(
                &contexts,
                &TextRun {
                    len: 0,
                    font: face.clone(),
                    color,
                    background_color: background,
                    underline,
                    strikethrough: strike,
                },
                px(font_size),
                window,
            )
        } else {
            Vec::new()
        };
        for (token_index, token) in tokens.into_iter().enumerate() {
            let length = if object { 1 } else { token.chars().count() };
            if token == "\n" && !object {
                items.push(FlowItem::Break(cursor));
                cursor += 1;
                continue;
            }
            let whitespace = math_form.is_none() && token.chars().all(char::is_whitespace);
            let (rendered, mut display_boundaries) = if uppercase && !object {
                let mut rendered = String::with_capacity(token.len());
                let mut boundaries = vec![0];
                for character in token.chars() {
                    rendered.extend(character.to_uppercase());
                    boundaries.push(rendered.len());
                }
                (rendered, Some(Arc::<[usize]>::from(boundaries)))
            } else {
                (token.to_string(), None)
            };
            let spacing = if !object || note {
                letter_spacing
            } else {
                px(0.)
            };
            let text_run = TextRun {
                len: rendered.len(),
                font: face.clone(),
                color,
                background_color: background,
                underline,
                strikethrough: strike,
            };
            let shape = if math_form.is_some() {
                let mut strut_run = text_run.clone();
                strut_run.len = 1;
                window
                    .text_system()
                    .shape_line(" ".into(), px(font_size), &[strut_run], None)
            } else {
                contextual_shapes
                    .get_mut(token_index)
                    .and_then(Option::take)
                    .map(|context| {
                        display_boundaries = context.display_boundaries;
                        context.shape
                    })
                    .unwrap_or_else(|| {
                        window.text_system().shape_line(
                            SharedString::from(rendered),
                            px(font_size),
                            std::slice::from_ref(&text_run),
                            None,
                        )
                    })
            };
            let tracking = (spacing != px(0.)).then(|| Arc::new(TrackedText::new(&shape, spacing)));
            let text_width = shape.width
                + tracking
                    .as_ref()
                    .map_or(px(0.), |tracking| tracking.shift_at(shape.text.len()));
            let piece_width = math_form.as_ref().map_or_else(
                || {
                    image
                        .as_ref()
                        .map_or(text_width + inset * 2., |image| px(image.width_px))
                },
                |form| form.size.width,
            );
            let float_initial = initial
                .as_ref()
                .is_some_and(|(_, (_, from, to))| cursor == *from && cursor + length == *to);
            let hidden_initial = initial.as_ref().is_some_and(|(opening, (glyph, _, _))| {
                float_initial
                    && opening.mode == InitialMode::Illuminated
                    && glyph.len() == 1
                    && glyph.as_bytes()[0].is_ascii_alphabetic()
            });
            let mut shape = shape;
            if hidden_initial {
                shape = window
                    .text_system()
                    .shape_line("".into(), px(font_size), &[], None);
            } else if float_initial && let Some((opening, _)) = &initial {
                let mut initial_font = face.clone();
                initial_font.weight = FontWeight::BOLD;
                shape = window.text_system().shape_line(
                    token.to_string().into(),
                    px(opening.size),
                    &[TextRun {
                        len: token.len(),
                        font: initial_font,
                        color: rgb(colors.vermilion).into(),
                        background_color: None,
                        underline: None,
                        strikethrough: None,
                    }],
                    None,
                );
            }
            let intrinsic_height = px(font_size * base_height / base_size);
            let caret = math_source_flow::NativeStrut::from_shape(&shape, intrinsic_height);
            let height = math_form.as_ref().map_or_else(
                || {
                    image.as_ref().map_or(intrinsic_height, |image| {
                        px(image.height_px).max(intrinsic_height)
                    })
                },
                |form| form.size.height,
            );
            let styled = StyledPiece {
                piece: Piece {
                    range: cursor..cursor + length,
                    shape: shape.clone(),
                    origin: if float_initial {
                        point(
                            px(0.),
                            px(initial.as_ref().map_or(0., |(opening, _)| {
                                opening.size
                                    * if opening.mode == InitialMode::Illuminated {
                                        0.035
                                    } else {
                                        0.08
                                    }
                            })),
                        )
                    } else {
                        point(px(0.), px(0.))
                    },
                    line: 0,
                    whitespace,
                    object: object || float_initial,
                    baseline_shift: shift,
                    float_initial,
                    visual_width: if hidden_initial {
                        Some(reserve)
                    } else if tracking.is_some() || note || image.is_some() || math_form.is_some() {
                        Some(piece_width)
                    } else {
                        None
                    },
                    paint_height: float_initial.then(|| {
                        px(initial
                            .as_ref()
                            .map_or(font_size, |(opening, _)| opening.size)
                            * 0.85)
                    }),
                    image: image.clone(),
                    math_form: math_form
                        .as_ref()
                        .map(|form| math_source_flow::InlineMathPiece {
                            measured: form.clone(),
                            caret,
                        }),
                    math_row_height: None,
                    display_boundaries,
                    tracking,
                    inset,
                    discretionary_hyphen: false,
                    comment_ink: comment_ink.clone(),
                    comment_ids: comment_ids.clone(),
                    comment_chip: None,
                    note: note_reference.as_ref().and_then(|(kind, number, node)| {
                        note_paths.get(&cursor).map(|path| {
                            notes::marker(
                                path.clone(),
                                node.clone(),
                                *kind,
                                *number,
                                notes::MarkerStyle {
                                    shape: &shape,
                                    style: &text_run,
                                    size: px(font_size),
                                    colors: &colors,
                                    spacing,
                                },
                                window,
                            )
                        })
                    }),
                },
                style: text_run,
                font_size: px(font_size),
                line_height: height,
            };
            let chips = comment_anchors
                .remove(&(cursor + length))
                .unwrap_or_default()
                .into_iter()
                .map(|chip| comments::styled_chip(chip, &styled, window))
                .collect::<Vec<_>>();
            items.push(FlowItem::Piece(Box::new(styled)));
            items.extend(
                chips
                    .into_iter()
                    .map(|chip| FlowItem::Piece(Box::new(chip))),
            );
            cursor += length;
        }
    }
    let flow = paragraph_flow::layout(
        items,
        hyphenation,
        width,
        align,
        px(base_height),
        reserve,
        reserve_height,
        cursor,
        reserved_form.is_some(),
        window,
    );
    let comment_marks = comments::measure_marks(&flow.pieces, &flow.lines);
    let comment_hover = comments::measure_hover(&flow.pieces, &flow.lines);
    ParagraphLayout {
        pieces: flow.pieces,
        lines: flow.lines,
        size: flow.size,
        atom_requests,
        float_reservation: FloatReservation {
            width: reserve,
            height: reserve_height,
        },
        break_opportunities: hyphenation.clone(),
        comment_marks,
        comment_hover,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Alignment {
    Left,
    Center,
    Right,
    Justify,
}

#[allow(clippy::too_many_arguments)]
fn finish_line(
    pieces: &mut [Piece],
    lines: &mut Vec<VisualLine>,
    range: Range<usize>,
    first: usize,
    y: Pixels,
    height: Pixels,
    width: Pixels,
    align: Alignment,
    wrapped: bool,
    reserve: Pixels,
    reserve_height: Pixels,
    math_baseline: Option<math_source_flow::RowBaseline>,
) {
    let last = pieces.len();
    let indentation = if y < reserve_height { reserve } else { px(0.) };
    let line = &mut pieces[first..last];
    let text_width = line
        .last()
        .map_or(px(0.), |piece| piece.origin.x + piece.width() - indentation);
    let extra = (width - indentation - text_width).max(px(0.));
    let spaces = line.iter().filter(|piece| piece.whitespace).count();
    let mut distributed = px(0.);
    let ascent = line
        .iter()
        .filter(|piece| !piece.float_initial)
        .map(|piece| {
            piece
                .image
                .as_ref()
                .map_or(piece.shape.ascent, |image| px(image.baseline_px))
        })
        .max()
        .unwrap_or(px(0.));
    let descent = line
        .iter()
        .filter(|piece| !piece.float_initial)
        .map(|piece| {
            piece.image.as_ref().map_or(piece.shape.descent, |image| {
                px(image.height_px - image.baseline_px)
            })
        })
        .max()
        .unwrap_or(px(0.));
    for piece in line {
        if piece.float_initial {
            continue;
        }
        let shift = match align {
            Alignment::Center => extra / 2.,
            Alignment::Right => extra,
            Alignment::Justify if wrapped && spaces > 0 => distributed,
            _ => px(0.),
        };
        piece.origin.x += shift;
        if let Some(row) = math_baseline {
            let baseline = y + row.above;
            if let Some(form) = &piece.math_form {
                piece.origin.y = baseline - form.measured.baseline;
            } else if let Some(image) = &piece.image {
                piece.origin.y = baseline - px(image.baseline_px);
            } else {
                let strut = math_source_flow::NativeStrut::from_shape(
                    &piece.shape,
                    piece.math_row_height.unwrap_or(height),
                );
                piece.origin.y = baseline - strut.baseline + piece.baseline_shift;
            }
        } else if let Some(image) = &piece.image {
            piece.origin.y = y + (height - ascent - descent) / 2. + ascent - px(image.baseline_px);
        } else {
            piece.origin.y += (ascent - descent - piece.shape.ascent + piece.shape.descent) / 2.
                + piece.baseline_shift;
        }
        if piece.whitespace && align == Alignment::Justify && wrapped && spaces > 0 {
            let added = extra / spaces as f32;
            piece.visual_width = Some(piece.width() + added);
            distributed += added;
        }
    }
    lines.push(VisualLine {
        range,
        y,
        height,
        first,
        last,
    });
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "view_tests.rs"]
mod tests;

#[cfg(all(test, feature = "ui-tests"))]
#[path = "view_flow_tests.rs"]
mod flow_tests;
