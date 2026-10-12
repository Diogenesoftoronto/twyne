//! Measured writer-comment ink and source-free native thread controls.
use super::*;
use gpui_kit::{InteractiveElement, Rgba};

pub(super) type MeasuredComments =
    HashMap<Arc<str>, std::collections::BTreeMap<(NodePath, usize), MeasuredComment>>;
pub(super) struct MeasuredComment {
    pub range: Range<usize>,
    pub bounds: Bounds<Pixels>,
    pub lines: Vec<Bounds<Pixels>>,
}

pub(super) struct LocalComment {
    pub chip: CommentChip,
    pub bounds: Bounds<Pixels>,
    pub lines: Vec<Bounds<Pixels>>,
}

pub(super) struct LocalHover {
    pub ids: Arc<[Arc<str>]>,
    pub bounds: Bounds<Pixels>,
}
pub(super) struct HoverTarget {
    pub ids: Arc<[Arc<str>]>,
    pub hitbox: gpui_kit::Hitbox,
}

struct ChipFocus {
    focus: FocusHandle,
    _focus_in: gpui_kit::Subscription,
    _focus_out: gpui_kit::Subscription,
}

impl RichEditorView {
    pub(super) fn clear_comment_hover(&mut self, cx: &mut Context<Self>) {
        if self.comment_hover.take().is_some() {
            cx.emit(RichEditorEvent::CommentHoverChanged { id: None });
        }
    }
    pub(super) fn sync_comment_hover(&mut self, window: &Window, cx: &mut Context<Self>) {
        let id = if self.comments_quiet || self.is_read_only() || self.is_dragging() {
            None
        } else {
            window
                .focused(cx)
                .and_then(|focus| {
                    self.comment_focus
                        .borrow()
                        .get(&ElementId::from(&focus))
                        .cloned()
                })
                .or_else(|| {
                    self.comment_hits
                        .borrow()
                        .iter()
                        .rev()
                        .find(|area| area.hitbox.is_hovered(window))
                        .and_then(|area| area.ids.last().cloned())
                })
        };
        if id != self.comment_hover {
            self.comment_hover = id.clone();
            cx.emit(RichEditorEvent::CommentHoverChanged { id });
        }
    }
}

pub(super) fn ids(wrappers: &[super::super::ElementShell]) -> Arc<[Arc<str>]> {
    wrappers
        .iter()
        .filter(|shell| shell.tag == "span")
        .filter_map(|shell| {
            shell
                .attr("data-comment-id")
                .filter(|id| !id.is_empty())
                .map(Arc::from)
        })
        .collect::<Vec<_>>()
        .into()
}

#[derive(Clone)]
pub(super) struct CommentChip {
    pub id: Arc<str>,
    pub range: Range<usize>,
    pub font_size: Pixels,
    pub ordinal: usize,
}

pub(super) fn anchors(block: &RichBlock) -> HashMap<usize, Vec<CommentChip>> {
    // Original MarkAnchorWidgets walks text nodes only. Atoms and paragraph
    // boundaries interrupt an otherwise contiguous passage for the same ID.
    let mut latest = HashMap::<Arc<str>, usize>::new();
    let mut ranges: Vec<CommentChip> = Vec::new();
    for run in &block.runs {
        if !matches!(run.content, RunContent::Text(_)) {
            continue;
        }
        for shell in &run.wrappers {
            let Some(id) = shell
                .attr("data-comment-id")
                .filter(|id| shell.tag == "span" && !id.is_empty())
            else {
                continue;
            };
            let id: Arc<str> = Arc::from(id);
            if let Some(index) = latest.get(&id).copied()
                && ranges[index].range.end == run.range.start
            {
                ranges[index].range.end = run.range.end;
            } else {
                latest.insert(id.clone(), ranges.len());
                ranges.push(CommentChip {
                    id,
                    range: run.range.clone(),
                    font_size: px(18.),
                    ordinal: ranges.len(),
                });
            }
        }
    }
    let mut by_end = HashMap::<_, Vec<_>>::new();
    for range in ranges {
        by_end.entry(range.range.end).or_default().push(range);
    }
    by_end
}

pub(super) fn ink(wrappers: &[super::super::ElementShell], colors: &theme::Palette) -> Arc<[Hsla]> {
    wrappers
        .iter()
        .filter(|shell| {
            shell.tag == "span"
                && shell
                    .attr("data-comment-id")
                    .is_some_and(|id| !id.is_empty())
        })
        .map(|shell| color(shell.attr("data-comment-color"), colors))
        .collect::<Vec<_>>()
        .into()
}

fn color(value: Option<&str>, colors: &theme::Palette) -> Hsla {
    let value = value.unwrap_or("var(--color-writer-note)").trim();
    let semantic = match value {
        "var(--color-writer-note)" | "var(--color-mustard)" => Some(colors.writer_note),
        "var(--color-vermilion)" => Some(colors.vermilion),
        "var(--color-cobalt)" => Some(colors.cobalt),
        "var(--color-sage)" => Some(colors.sage),
        "var(--color-periwinkle)" => Some(colors.periwinkle),
        "var(--color-blush)" => Some(colors.blush),
        _ => None,
    };
    if let Some(value) = semantic {
        return rgb(value).into();
    }
    if let Ok(value) = Rgba::try_from(value) {
        return value.into();
    }
    let named = match value.to_ascii_lowercase().as_str() {
        "black" => 0x000000,
        "white" => 0xffffff,
        "red" => 0xff0000,
        "green" => 0x008000,
        "blue" => 0x0000ff,
        "yellow" => 0xffff00,
        "gray" | "grey" => 0x808080,
        "silver" => 0xc0c0c0,
        "maroon" => 0x800000,
        "purple" => 0x800080,
        "fuchsia" | "magenta" => 0xff00ff,
        "lime" => 0x00ff00,
        "olive" => 0x808000,
        "navy" => 0x000080,
        "teal" => 0x008080,
        "aqua" | "cyan" => 0x00ffff,
        "orange" => 0xffa500,
        "transparent" => return Hsla::transparent_black(),
        _ => colors.writer_note,
    };
    rgb(named).into()
}

pub(super) fn styled_chip(
    chip: CommentChip,
    template: &StyledPiece,
    window: &mut Window,
) -> StyledPiece {
    let shape = window
        .text_system()
        .shape_line("".into(), template.font_size, &[], None);
    StyledPiece {
        piece: Piece {
            range: chip.range.end..chip.range.end,
            shape,
            visual_width: Some(template.font_size * 0.9),
            object: true,
            whitespace: false,
            float_initial: false,
            image: None,
            math_form: None,
            math_row_height: None,
            paint_height: None,
            tracking: None,
            display_boundaries: None,
            discretionary_hyphen: false,
            inset: px(0.),
            comment_ink: Arc::from([]),
            comment_ids: Arc::from([]),
            comment_chip: Some(CommentChip {
                font_size: template.font_size,
                ..chip
            }),
            ..template.piece.clone()
        },
        ..template.clone()
    }
}

pub(super) fn paint_ink(
    piece: &Piece,
    origin: Point<Pixels>,
    line: &VisualLine,
    window: &mut Window,
) {
    if piece.comment_ink.is_empty() || piece.width() <= px(0.) {
        return;
    }
    let bounds = ink_bounds(piece, line);
    let bounds = Bounds::new(origin + bounds.origin, bounds.size);
    for &color in piece.comment_ink.iter() {
        window.paint_quad(fill(bounds, color.alpha(color.a * 0.18)));
        window.paint_quad(fill(
            Bounds::new(
                bounds.origin + point(px(0.), bounds.size.height),
                size(bounds.size.width, px(2.)),
            ),
            color,
        ));
    }
}

fn ink_bounds(piece: &Piece, line: &VisualLine) -> Bounds<Pixels> {
    let height = piece
        .paint_height
        .unwrap_or(piece.shape.ascent + piece.shape.descent)
        .max(px(1.));
    Bounds::new(
        piece.origin
            + point(
                px(0.),
                (piece.math_row_height.unwrap_or(line.height) - height) / 2.,
            ),
        size(piece.width(), height),
    )
}

/// Coalesce adjacent ink on each row at the changed-block layout boundary.
/// Different nesting or vertical ink geometry retains a separate hit target;
/// whitespace expands exactly as the painted justified mark does.
pub(super) fn measure_hover(pieces: &[Piece], lines: &[VisualLine]) -> Vec<LocalHover> {
    let mut areas = Vec::<LocalHover>::new();
    for piece in pieces.iter().filter(|piece| {
        !piece.comment_ids.is_empty() && !piece.range.is_empty() && piece.width() > px(0.)
    }) {
        let mut bounds = ink_bounds(piece, &lines[piece.line]);
        bounds.size.height += px(2.);
        if let Some(previous) = areas.last_mut()
            && previous.ids == piece.comment_ids
            && previous.bounds.top() == bounds.top()
            && previous.bounds.bottom() == bounds.bottom()
            && (previous.bounds.right() - bounds.left()).abs() < px(0.01)
        {
            previous.bounds = previous.bounds.union(&bounds);
        } else {
            areas.push(LocalHover {
                ids: piece.comment_ids.clone(),
                bounds,
            });
        }
    }
    areas
}

/// Compute passage rectangles at the changed-block shaping boundary. The
/// source-free chip is a separate hit target and never determines placement.
pub(super) fn measure_marks(pieces: &[Piece], lines: &[VisualLine]) -> Vec<LocalComment> {
    pieces
        .iter()
        .filter_map(|piece| piece.comment_chip.as_ref())
        .filter_map(|chip| {
            let first = pieces.partition_point(|piece| piece.range.end <= chip.range.start);
            let last = pieces.partition_point(|piece| piece.range.start < chip.range.end);
            let mut rows = std::collections::BTreeMap::<usize, Bounds<Pixels>>::new();
            for piece in pieces[first..last]
                .iter()
                .filter(|piece| !piece.range.is_empty())
            {
                let mut bounds = ink_bounds(piece, &lines[piece.line]);
                let start = chip.range.start.max(piece.range.start) - piece.range.start;
                let end = chip.range.end.min(piece.range.end) - piece.range.start;
                let left = piece.x_for_offset(start);
                let right = piece.x_for_offset(end);
                bounds.origin.x += left.min(right);
                bounds.size.width = (right - left).abs();
                bounds.size.height += px(2.); // Original inline border box.
                rows.entry(piece.line)
                    .and_modify(|row| *row = row.union(&bounds))
                    .or_insert(bounds);
            }
            let lines: Vec<_> = rows.into_values().collect();
            let bounds = lines
                .iter()
                .copied()
                .reduce(|bounds, next| bounds.union(&next))?;
            Some(LocalComment {
                chip: chip.clone(),
                bounds,
                lines,
            })
        })
        .collect()
}

pub(super) fn button(
    chip: &CommentChip,
    path: &[usize],
    global_start: usize,
    view: Entity<RichEditorView>,
    revision: u64,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let colors = *theme::palette(cx);
    let id = SharedString::from(format!(
        "twyne-comment-chip-{}-{}",
        path.iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join("-"),
        chip.ordinal
    ));
    let requested = chip.id.clone();
    let range = global_start + chip.range.start..global_start + chip.range.end;
    let mut idle: Hsla = rgb(colors.vermilion).into();
    idle.a = 0.55;
    let accent = colors.vermilion;
    let focus_view = view.downgrade();
    let focus = window
        .use_keyed_state(id.clone(), cx, move |window, cx| {
            let focus = cx.focus_handle();
            let entered = focus_view.clone();
            let focus_in = window.on_focus_in(&focus, cx, move |window, cx| {
                let _ = entered.update(cx, |view, cx| view.sync_comment_hover(window, cx));
            });
            let focus_out = window.on_focus_out(&focus, cx, move |_, window, cx| {
                let _ = focus_view.update(cx, |view, cx| view.sync_comment_hover(window, cx));
            });
            ChipFocus {
                focus,
                _focus_in: focus_in,
                _focus_out: focus_out,
            }
        })
        .read(cx)
        .focus
        .clone();
    view.read(cx)
        .comment_focus
        .borrow_mut()
        .insert(ElementId::from(&focus), chip.id.clone());
    let pointer_focus = focus.clone();
    let pointer_view = view.clone();
    gpui_kit::base::Button::new(id)
        .track_focus(&focus)
        .key_context("TwyneCommentAnchor")
        .size(chip.font_size * 0.5)
        .rounded_full()
        .bg(idle)
        .hover(move |this| this.bg(rgb(accent)))
        .focus(move |this| this.bg(rgb(accent)))
        .cursor(CursorStyle::PointingHand)
        .accessibility_label("Open comment")
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            // Claim the actual chip focus before the manuscript's bubbling
            // pointer handler can place its caret. Focus remains a peek target
            // after the pointer leaves this exact chip circle.
            window.focus(&pointer_focus, cx);
            window.prevent_default();
            cx.stop_propagation();
            pointer_view.update(cx, |view, cx| view.sync_comment_hover(window, cx));
        })
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            view.update(cx, |view, cx| {
                if !view.comments_quiet && view.revision() == revision {
                    cx.emit(RichEditorEvent::CommentRequested {
                        id: requested.clone(),
                        range: range.clone(),
                    });
                }
            });
        })
        .into_any_element()
}
