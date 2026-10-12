//! A retained native child inside the original one-scalar inline math atom.
//!
//! This is a child module of `editor::view`, enabled by the accompanying
//! unapplied integration patch. Measure the real form once before paragraph
//! measurement, then prepaint and paint that same AnyElement. The form is not
//! an overlay and its field text never becomes manuscript text.
//!
//! The first-label baseline is derived from the native shaped label and the
//! Source border/padding. GPUI exposes the measured child size, but not a flex
//! first-baseline result. The native contract and browser baseline equivalence
//! still need the authored mounted gates and an actual open-NodeView comparison.

use super::*;
use crate::editor::math_source_editor::{
    MathSourceEditorView, MathSourcePresentation, MathSourceTarget,
};
use gpui_kit::EntityId;
use uuid::Uuid;

const LABEL_SIZE_PX: f32 = 12.8;
const SOURCE_BORDER_AND_PADDING_PX: f32 = 1. + 10.4;

/// A font-derived text strut. This remains text height beside a tall form;
/// the source-free reservation must not turn a normal caret into a tall one.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct NativeStrut {
    pub height: Pixels,
    pub baseline: Pixels,
}

impl NativeStrut {
    pub(super) fn from_shape(shape: &ShapedLine, height: Pixels) -> Self {
        Self {
            height,
            // This is the pinned ShapedLine::paint equation, not a painted
            // correction. All inline consumers use the resulting placement.
            baseline: (height - shape.ascent - shape.descent) / 2. + shape.ascent,
        }
    }
}

/// Presentation identity, independent of field text and the document tree.
/// Node storage identity is compared in constant time; no raw payload is
/// serialized, Debug-printed, or materialized on input.
#[derive(Clone)]
pub(super) struct InlineMathReservation {
    target: Arc<MathSourceTarget>,
    form_entity: EntityId,
    form_id: Uuid,
    generation: u64,
    pub size: Size<Pixels>,
    pub baseline: Pixels,
}

impl PartialEq for InlineMathReservation {
    fn eq(&self, other: &Self) -> bool {
        self.form_entity == other.form_entity
            && self.form_id == other.form_id
            && self.generation == other.generation
            && self.target.owner == other.target.owner
            && self.target.revision == other.target.revision
            && self.target.path == other.target.path
            && self.target.position == other.target.position
            && self.target.display == other.target.display
            && self
                .target
                .expected
                .shares_storage_with(&other.target.expected)
            && self.size == other.size
            && self.baseline == other.baseline
    }
}

#[derive(Clone, PartialEq)]
pub(super) struct BlockFormReservation {
    pub offset: usize,
    pub measured: Arc<InlineMathReservation>,
}

impl BlockFormReservation {
    /// The local scalar identifies the run; persistent node identity prevents
    /// an unrelated atom at a reused path from receiving this child.
    pub(super) fn matches_atom(&self, offset: usize, node: &Node) -> bool {
        self.offset == offset
            && node.shares_storage_with(&self.measured.target.expected)
            && node.as_element().is_some_and(|element| {
                element.kind == NodeKind::Math(super::super::MathDisplay::Inline)
            })
    }
}

#[derive(Clone)]
pub(super) struct InlineMathPiece {
    pub measured: Arc<InlineMathReservation>,
    pub caret: NativeStrut,
}

#[derive(Clone, Copy, Default)]
pub(super) struct InlineRow {
    above: Pixels,
    below: Pixels,
    has_form: bool,
}

#[derive(Clone, Copy)]
pub(super) struct RowBaseline {
    pub above: Pixels,
    pub below: Pixels,
}

impl RowBaseline {
    pub(super) fn height(self) -> Pixels {
        self.above + self.below
    }
}

impl InlineRow {
    /// Ordinary rows retain their established path. Only a row with an open
    /// form adopts these native above/below-baseline extents.
    pub(super) fn include(&mut self, piece: &Piece, height: Pixels) {
        if piece.float_initial {
            return;
        }
        let (above, below) = if let Some(form) = &piece.math_form {
            self.has_form = true;
            (
                form.measured.baseline,
                form.measured.size.height - form.measured.baseline,
            )
        } else if let Some(image) = &piece.image {
            let leading = (height - px(image.height_px)) / 2.;
            (
                leading + px(image.baseline_px),
                leading + px(image.height_px - image.baseline_px),
            )
        } else {
            let strut = NativeStrut::from_shape(&piece.shape, height);
            (
                strut.baseline - piece.baseline_shift,
                strut.height - strut.baseline + piece.baseline_shift,
            )
        };
        self.above = self.above.max(above.max(px(0.)));
        self.below = self.below.max(below.max(px(0.)));
    }

    pub(super) fn finish(self) -> Option<RowBaseline> {
        self.has_form.then_some(RowBaseline {
            above: self.above,
            below: self.below,
        })
    }
}

/// The caret at a form edge uses its original inherited math text strut.
/// Other text on that row uses the same native placement as its actual paint.
pub(super) fn caret_y_height(piece: &Piece, line: &VisualLine) -> (Pixels, Pixels) {
    if let Some(form) = &piece.math_form {
        (
            piece.origin.y + form.measured.baseline - form.caret.baseline,
            form.caret.height,
        )
    } else if !piece.float_initial
        && let Some(height) = piece.math_row_height
    {
        (piece.origin.y, height)
    } else {
        (line.y, line.height)
    }
}

/// A selection/IME decoration shares actual ink placement, not the entire
/// tall row. Selecting the atom covers its real measured child rectangle.
pub(super) fn selection_bounds(piece: &Piece, line: &VisualLine) -> Bounds<Pixels> {
    let (y, height) = if let Some(form) = &piece.math_form {
        (piece.origin.y, form.measured.size.height)
    } else {
        caret_y_height(piece, line)
    };
    Bounds::new(point(piece.origin.x, y), size(piece.width(), height))
}

struct PreparedForm {
    measured: Arc<InlineMathReservation>,
    form: Entity<MathSourceEditorView>,
    child: AnyElement,
    bounds: Option<Bounds<Pixels>>,
    prepainted: bool,
    painted: bool,
}

/// There is at most one active source form per RichEditorView. Its native
/// AnyElement is frame-local; stable geometry retains a cheap measurement Arc
/// across frames so an unchanged paragraph keeps its existing layout Arc.
#[derive(Default)]
pub(super) struct InlineMathFlow {
    frame: Option<Rc<RefCell<PreparedForm>>>,
    previous: Option<Arc<InlineMathReservation>>,
}

fn target_is_current(editor: &RichEditor, owner: EntityId, target: &MathSourceTarget) -> bool {
    target.owner.editor == owner
        && target.display == super::super::MathDisplay::Inline
        && target.revision == editor.revision()
        && editor.selection().range() == (target.position..target.position + 1)
        && editor.document().offset_of_node(&target.path) == Some(target.position)
        && editor.document().node(&target.path).is_some_and(|node| {
            node.shares_storage_with(&target.expected)
                && node.as_element().is_some_and(|element| {
                    element.kind == NodeKind::Math(super::super::MathDisplay::Inline)
                })
        })
}

fn first_label_baseline(
    presentation: &MathSourcePresentation,
    target: &MathSourceTarget,
    window: &mut Window,
) -> Pixels {
    let mut run = window.text_style().to_run(target.label().len());
    run.font.family = presentation.inherited_font_family.clone();
    run.font.weight = FontWeight::SEMIBOLD;
    let shape =
        window
            .text_system()
            .shape_line(target.label().into(), px(LABEL_SIZE_PX), &[run], None);
    // TextStyle::line_height_in_px rounds the native relative line height.
    let height = px((LABEL_SIZE_PX * presentation.inherited_line_height).round());
    px(SOURCE_BORDER_AND_PADDING_PX) + NativeStrut::from_shape(&shape, height).baseline
}

impl InlineMathFlow {
    pub(super) fn prepare(
        &mut self,
        form: Option<Entity<MathSourceEditorView>>,
        presentation: Option<MathSourcePresentation>,
        editor: &RichEditor,
        owner: EntityId,
        window: &mut Window,
        cx: &mut App,
    ) {
        // Drop the previous frame's drawable even if its measured geometry is
        // unchanged. AnyElement cannot be painted twice or reused next frame.
        self.frame = None;
        let Some((form, presentation)) = form.zip(presentation) else {
            self.previous = None;
            return;
        };
        let (target, form_id, generation) = {
            let source = form.read(cx);
            if source.is_retired() || !target_is_current(editor, owner, source.target()) {
                self.previous = None;
                return;
            }
            (
                Arc::new(source.target().clone()),
                source.form_id(),
                source.generation(),
            )
        };
        let mut child = form.clone().into_any_element();
        // This MUST occur before any paragraph/page measured callback. GPUI
        // temporarily takes its layout engine while running those callbacks,
        // so laying out a child there would re-enter the engine. MinContent is
        // sufficient: the real inline form defines its own Source viewport
        // minimum/width, and all text/control sizes come from its actual view.
        // Prepaint and paint run inside the manuscript Div's identity. Enter
        // that same namespace during early measurement so the retained child
        // keeps its exact global identity through every draw phase.
        let measured_size = window.with_element_namespace("twyne-rich-manuscript", |window| {
            child.layout_as_root(
                size(AvailableSpace::MinContent, AvailableSpace::MinContent),
                window,
                cx,
            )
        });
        let baseline = first_label_baseline(&presentation, &target, window);
        if !f32::from(measured_size.width).is_finite()
            || !f32::from(measured_size.height).is_finite()
            || !f32::from(baseline).is_finite()
            || measured_size.width <= px(0.)
            || measured_size.height <= px(0.)
            || baseline < px(0.)
            || baseline > measured_size.height
        {
            self.previous = None;
            return;
        }
        let measured = Arc::new(InlineMathReservation {
            target,
            form_entity: form.entity_id(),
            form_id,
            generation,
            size: measured_size,
            baseline,
        });
        let measured = self
            .previous
            .as_ref()
            .filter(|old| old.as_ref() == measured.as_ref())
            .cloned()
            .unwrap_or(measured);
        self.previous = Some(measured.clone());
        self.frame = Some(Rc::new(RefCell::new(PreparedForm {
            measured,
            form,
            child,
            bounds: None,
            prepainted: false,
            painted: false,
        })));
    }

    pub(super) fn frame_key(&self) -> Option<Arc<InlineMathReservation>> {
        self.frame
            .as_ref()
            .map(|frame| frame.borrow().measured.clone())
    }

    pub(super) fn for_block(
        &self,
        block: &RichBlock,
        document: &RichDocument,
    ) -> Option<BlockFormReservation> {
        let measured = self.frame_key()?;
        if !measured.target.path.starts_with(&block.path) {
            return None;
        }
        let start = document.offset_of_node(&block.path)?;
        let offset = measured.target.position.checked_sub(start)?;
        (offset < block.range.end - block.range.start)
            .then_some(BlockFormReservation { offset, measured })
    }

    pub(super) fn mounted_bounds(&self) -> Option<Bounds<Pixels>> {
        self.frame.as_ref().and_then(|frame| frame.borrow().bounds)
    }
}

/// A real dispatch/accessibility subtree retained through paragraph layout.
/// Its sole mount consumes the exact Piece origin from the shared line plan.
pub(super) struct InlineMathChild {
    frame: Rc<RefCell<PreparedForm>>,
    bounds: Bounds<Pixels>,
}

fn form_matches(frame: &PreparedForm, cx: &App) -> bool {
    let form = frame.form.read(cx);
    !form.is_retired()
        && form.form_id() == frame.measured.form_id
        && form.generation() == frame.measured.generation
        && form.target().owner == frame.measured.target.owner
        && form.target().revision == frame.measured.target.revision
        && form.target().path == frame.measured.target.path
        && form.target().position == frame.measured.target.position
        && form
            .target()
            .expected
            .shares_storage_with(&frame.measured.target.expected)
}

impl RichEditorView {
    pub(super) fn prepare_inline_math_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let form = self.math_source_form();
        let presentation = self.math_source_presentation();
        self.inline_math_flow.prepare(
            form,
            presentation,
            &self.editor,
            cx.entity().entity_id(),
            window,
            cx,
        );
    }

    pub(super) fn inline_math_child(
        &self,
        layout: &ParagraphLayout,
        origin: Point<Pixels>,
        cx: &App,
    ) -> Option<InlineMathChild> {
        let frame = self.inline_math_flow.frame.as_ref()?.clone();
        let bounds = {
            let prepared = frame.borrow();
            if prepared.prepainted
                || !form_matches(&prepared, cx)
                || self.math_source_form().as_ref() != Some(&prepared.form)
                || !target_is_current(
                    &self.editor,
                    prepared.measured.target.owner.editor,
                    &prepared.measured.target,
                )
            {
                return None;
            }
            let piece = layout.pieces.iter().find(|piece| {
                piece
                    .math_form
                    .as_ref()
                    .is_some_and(|form| *form.measured == *prepared.measured)
            })?;
            Bounds::new(origin + piece.origin, prepared.measured.size)
        };
        Some(InlineMathChild { frame, bounds })
    }

    /// Current measured in-flow form bounds, for host scrolling at an explicit
    /// open/focus boundary. No selection or manuscript traversal is performed.
    pub fn inline_math_form_bounds(&self) -> Option<Bounds<Pixels>> {
        self.inline_math_flow.mounted_bounds()
    }
}

impl InlineMathChild {
    pub(super) fn prepaint(&mut self, window: &mut Window, cx: &mut App) {
        let mut frame = self.frame.borrow_mut();
        if !frame.prepainted && form_matches(&frame, cx) {
            frame.child.prepaint_at(self.bounds.origin, window, cx);
            frame.bounds = Some(self.bounds);
            frame.prepainted = true;
        }
    }

    pub(super) fn paint(&mut self, window: &mut Window, cx: &mut App) {
        let mut frame = self.frame.borrow_mut();
        if frame.prepainted && !frame.painted && form_matches(&frame, cx) {
            // The retained native Textarea registers its own focused input
            // handler here, after the manuscript's handler. Real controls,
            // dispatch scopes and accessibility stay with the actual child.
            frame.child.paint(window, cx);
            frame.painted = true;
        }
    }
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "../../fixtures/math-write/inline-source-flow/view_tests.rs"]
mod tests;
