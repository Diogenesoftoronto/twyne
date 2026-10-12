//! Native flow of measured run fragments. Hyphens change display, not source.

use super::{
    Alignment, Hyphenation, Piece, Pixels, ShapedLine, Size, TextRun, TrackedText, VisualLine,
    Window, finish_line, point, px, size,
};
use std::{collections::VecDeque, sync::Arc};
use unicode_segmentation::UnicodeSegmentation;

const MAX_SHAPED_TOKEN_SCALARS: usize = 256;

/// Word segmentation is useful for spaces and source selections, but it
/// separates URL punctuation from its surrounding letters. Keep fragments in
/// the same natural line segment together so emergency prefix/suffix shaping
/// retains kerning within a bounded chunk, rather than reshaping one slash or
/// word at a time. Unicode natural opportunities remain distinct.
pub(super) fn natural_tokens<'a>(
    text: &'a str,
    start: usize,
    breaks: &Hyphenation,
) -> Vec<&'a str> {
    let mut tokens = Vec::new();
    let mut pending: Option<(usize, usize)> = None;
    let mut byte = 0;
    let mut scalar = start;
    for token in text.split_word_bounds() {
        let end = byte + token.len();
        let length = token.chars().count();
        let whitespace = token.chars().all(char::is_whitespace);
        if (whitespace || pending.is_some_and(|(_, end)| scalar >= end))
            && let Some((first, _)) = pending.take()
        {
            tokens.push(&text[first..byte]);
        }
        if whitespace {
            tokens.push(token);
        } else if pending.is_none() {
            pending = Some((byte, breaks.segment_end(scalar).unwrap_or(scalar + length)));
        }
        byte = end;
        scalar += length;
    }
    if let Some((first, _)) = pending {
        tokens.push(&text[first..]);
    }
    tokens
}

pub(super) struct ContextToken<'a> {
    pub text: &'a str,
    pub scalar_len: usize,
    /// A float glyph has its own face/geometry, rather than text context.
    pub isolated: bool,
    /// Source-free widgets interrupt the browser's inline shaping context.
    pub stop_after: bool,
}

pub(super) struct ContextShape {
    pub shape: ShapedLine,
    pub display_boundaries: Option<Arc<[usize]>>,
}

/// Cosmic-text shapes separate UAX14 words even for Wrap::None. The browser's
/// ASCII slash tailoring keeps these words together, including their kerning.
/// A default-ignorable display joiner asks the native shaper for that context;
/// its byte boundaries are mapped back to the unchanged source scalars.
fn joined_display(text: &str, next: Option<char>) -> (String, Option<Arc<[usize]>>) {
    let mut rendered = String::with_capacity(text.len());
    let mut boundaries = vec![0];
    let mut changed = false;
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        rendered.push(character);
        if character == '/'
            && characters.peek().copied().or(next).is_some_and(|next| {
                next.is_ascii_graphic() && !matches!(next, '(' | '<' | '[' | '{')
            })
        {
            rendered.push('\u{2060}');
            changed = true;
        }
        boundaries.push(rendered.len());
    }
    (rendered, changed.then(|| Arc::from(boundaries)))
}

/// Keep kerning across ordinary word/punctuation token boundaries. Token
/// ranges still drive line breaking and source selection; the native cursor
/// slices an already shaped, bounded same-style context without reshaping it.
pub(super) fn shape_contextual_tokens(
    tokens: &[ContextToken<'_>],
    style: &TextRun,
    font_size: Pixels,
    window: &mut Window,
) -> Vec<Option<ContextShape>> {
    let mut result = Vec::with_capacity(tokens.len());
    let mut first = 0;
    while first < tokens.len() {
        if tokens[first].text == "\n" {
            result.push(None);
            first += 1;
            continue;
        }
        let mut end = first + 1;
        let mut length = tokens[first].scalar_len;
        while end < tokens.len()
            && !tokens[end - 1].stop_after
            && !tokens[end - 1].isolated
            && !tokens[end].isolated
            && tokens[end].text != "\n"
            && length + tokens[end].scalar_len <= MAX_SHAPED_TOKEN_SCALARS
        {
            length += tokens[end].scalar_len;
            end += 1;
        }
        let displays = (first..end)
            .map(|index| {
                let next = (index + 1 < end)
                    .then(|| tokens[index + 1].text.chars().next())
                    .flatten();
                joined_display(tokens[index].text, next)
            })
            .collect::<Vec<_>>();
        let display = displays
            .iter()
            .map(|(text, _)| text.as_str())
            .collect::<String>();
        let mut style = style.clone();
        style.len = display.len();
        let shape = window
            .text_system()
            .shape_line(display.into(), font_size, &[style], None);
        let mut cursor = shape.cursor();
        let mut byte = 0;
        for (display, display_boundaries) in displays {
            byte += display.len();
            result.push(Some(ContextShape {
                shape: cursor.take_until(byte),
                display_boundaries,
            }));
        }
        first = end;
    }
    result
}

/// Token chunks share source strings and stop at full-block grapheme edges,
/// including clusters which cross inline mark boundaries. They are only a
/// shaping bound; they do not create visual break opportunities.
pub(super) fn bounded_tokens<'a>(
    text: &'a str,
    start: usize,
    breaks: &Hyphenation,
) -> Vec<&'a str> {
    let length = text.chars().count();
    if length <= MAX_SHAPED_TOKEN_SCALARS {
        return vec![text];
    }
    let mut result = Vec::new();
    let mut scalar = 0;
    let mut byte = 0;
    while scalar < length {
        let target = (scalar + MAX_SHAPED_TOKEN_SCALARS).min(length);
        let candidates = breaks.graphemes_in(start + scalar..start + target);
        let end = candidates
            .last()
            .copied()
            .or_else(|| {
                breaks
                    .graphemes_in(start + scalar..start + length)
                    .first()
                    .copied()
            })
            .map_or(length, |end| end - start);
        // utf8_offset scans at most this bounded chunk, rather than the full
        // suffix on each row. A single oversized grapheme remains indivisible.
        let bytes = crate::editor::utf8_offset_for_scalar(&text[byte..], end - scalar)
            .expect("bounded source chunk");
        result.push(&text[byte..byte + bytes]);
        scalar = end;
        byte += bytes;
    }
    result
}

pub(super) enum FlowItem {
    Piece(Box<StyledPiece>),
    Break(usize),
}

#[derive(Clone)]
pub(super) struct StyledPiece {
    pub piece: Piece,
    pub style: TextRun,
    pub font_size: Pixels,
    pub line_height: Pixels,
}

impl StyledPiece {
    fn split_at(&self, offset: usize, hyphen: bool, window: &mut Window) -> (Self, Option<Self>) {
        let relative = offset - self.piece.range.start;
        let byte = self.display_byte(relative);
        let source_length = self.piece.range.end - self.piece.range.start;
        let prefix = self.reshape(
            self.piece.range.start..offset,
            format!(
                "{}{}",
                &self.piece.shape.text[..byte],
                if hyphen { "\u{2010}" } else { "" }
            ),
            (0..=relative)
                .map(|index| {
                    if index == relative {
                        byte + if hyphen { '\u{2010}'.len_utf8() } else { 0 }
                    } else {
                        self.display_byte(index)
                    }
                })
                .collect(),
            hyphen,
            window,
        );
        let suffix = (relative < source_length).then(|| {
            self.reshape(
                offset..self.piece.range.end,
                self.piece.shape.text[byte..].to_string(),
                (relative..=source_length)
                    .map(|index| self.display_byte(index) - byte)
                    .collect(),
                false,
                window,
            )
        });
        (prefix, suffix)
    }

    fn display_byte(&self, scalar: usize) -> usize {
        self.piece
            .display_boundaries
            .as_ref()
            .and_then(|boundaries| boundaries.get(scalar).copied())
            .or_else(|| crate::editor::utf8_offset_for_scalar(&self.piece.shape.text, scalar))
            .expect("bounded source/display boundary")
    }

    fn reshape(
        &self,
        range: std::ops::Range<usize>,
        display: String,
        boundaries: Vec<usize>,
        hyphen: bool,
        window: &mut Window,
    ) -> Self {
        let mut style = self.style.clone();
        style.len = display.len();
        let shape = window
            .text_system()
            .shape_line(display.into(), self.font_size, &[style], None);
        let tracking = self
            .piece
            .tracking
            .as_ref()
            .map(|tracking| Arc::new(TrackedText::new(&shape, tracking.spacing)));
        let width = shape.width
            + self.piece.inset * 2.
            + tracking
                .as_ref()
                .map_or(px(0.), |tracking| tracking.shift_at(shape.text.len()));
        Self {
            piece: Piece {
                range,
                shape,
                display_boundaries: Some(Arc::from(boundaries)),
                tracking,
                visual_width: Some(width),
                discretionary_hyphen: hyphen,
                ..self.piece.clone()
            },
            ..self.clone()
        }
    }
}

pub(super) struct Flow {
    pub pieces: Vec<Piece>,
    pub lines: Vec<VisualLine>,
    pub size: Size<Pixels>,
}

struct Pen {
    x: Pixels,
    y: Pixels,
    height: Pixels,
    first: usize,
    start: usize,
    width: Pixels,
    base_height: Pixels,
    reserve: Pixels,
    reserve_height: Pixels,
    align: Alignment,
    pieces: Vec<Piece>,
    lines: Vec<VisualLine>,
    measure_inline_form: bool,
    math_row: super::math_source_flow::InlineRow,
    intrinsic_heights: Vec<Pixels>,
}

impl Pen {
    fn available(&self) -> Pixels {
        self.width
            - self.x
            - if self.y < self.reserve_height {
                self.reserve
            } else {
                px(0.)
            }
    }

    fn place(&mut self, mut styled: StyledPiece) {
        if self.measure_inline_form {
            self.math_row.include(&styled.piece, styled.line_height);
            self.intrinsic_heights.push(styled.line_height);
        }
        let piece = &mut styled.piece;
        let indent = if self.y < self.reserve_height {
            self.reserve
        } else {
            px(0.)
        };
        piece.line = self.lines.len();
        piece.origin = if piece.float_initial {
            point(px(0.), self.y + piece.origin.y)
        } else {
            point(indent + self.x, self.y)
        };
        if !piece.float_initial {
            self.x += piece.width();
            self.height = self.height.max(styled.line_height);
        }
        self.pieces.push(styled.piece);
    }

    fn finish(&mut self, end: usize, wrapped: bool) {
        let math_baseline = self.math_row.finish();
        if let Some(row) = math_baseline {
            self.height = self.height.max(row.height());
            for (piece, height) in self.pieces[self.first..]
                .iter_mut()
                .zip(&self.intrinsic_heights[self.first..])
            {
                if !piece.float_initial {
                    piece.math_row_height = Some(*height);
                }
            }
        }
        finish_line(
            &mut self.pieces,
            &mut self.lines,
            self.start..end,
            self.first,
            self.y,
            self.height,
            self.width,
            self.align,
            wrapped,
            self.reserve,
            self.reserve_height,
            math_baseline,
        );
    }

    fn advance(&mut self, end: usize, next: usize, wrapped: bool) {
        self.finish(end, wrapped);
        self.y += self.height;
        self.x = px(0.);
        self.first = self.pieces.len();
        self.start = next;
        self.height = self.base_height;
        self.math_row = super::math_source_flow::InlineRow::default();
    }

    fn word(&mut self, word: Vec<StyledPiece>, hyphenation: &Hyphenation, window: &mut Window) {
        let mut word: VecDeque<_> = word.into();
        let mut width: Pixels = word.iter().map(|piece| piece.piece.width()).sum();
        while !word.is_empty() {
            if width <= self.available() {
                word.into_iter().for_each(|piece| self.place(piece));
                return;
            }
            let start = word[0].piece.range.start;
            let end = word.back().expect("nonempty word").piece.range.end;
            let fitting = fitting_offset(&word, hyphenation, self.available());
            let split = hyphenation
                .in_range(start, fitting.saturating_add(1).min(end))
                .iter()
                .rev()
                .find_map(|&offset| {
                    let prefix = prefix_for_break(&word, offset, true, window);
                    let width: Pixels = prefix.iter().map(|piece| piece.piece.width()).sum();
                    (width <= self.available()).then_some((offset, prefix))
                });
            if let Some((offset, prefix)) = split {
                consume_prefix(&mut word, offset, &mut width, window);
                prefix.into_iter().for_each(|piece| self.place(piece));
                self.advance(offset, offset, true);
            } else if self.x > px(0.) {
                self.advance(start, start, true);
            } else {
                let split = hyphenation
                    .emergency_in(start..fitting.min(end))
                    .iter()
                    .rev()
                    .find_map(|&offset| {
                        let prefix = prefix_for_break(&word, offset, false, window);
                        let width: Pixels = prefix.iter().map(|piece| piece.piece.width()).sum();
                        (width <= self.available()).then_some((offset, prefix))
                    });
                let split = split.or_else(|| {
                    // CSS cannot divide a single extended grapheme. It may be
                    // wider than a line; consume it once rather than looping.
                    hyphenation
                        .emergency_in(start..end)
                        .first()
                        .copied()
                        .map(|offset| (offset, prefix_for_break(&word, offset, false, window)))
                });
                let Some((offset, prefix)) = split else {
                    // Explicit overflow-wrap:normal keeps its source policy.
                    word.into_iter().for_each(|piece| self.place(piece));
                    return;
                };
                consume_prefix(&mut word, offset, &mut width, window);
                prefix.into_iter().for_each(|piece| self.place(piece));
                if !word.is_empty() {
                    self.advance(offset, offset, true);
                }
            }
        }
    }
}

fn prefix_for_break(
    word: &VecDeque<StyledPiece>,
    offset: usize,
    hyphen: bool,
    window: &mut Window,
) -> Vec<StyledPiece> {
    let mut prefix = Vec::new();
    for piece in word {
        if offset > piece.piece.range.end || (!hyphen && offset == piece.piece.range.end) {
            prefix.push(piece.clone());
            if offset == piece.piece.range.end {
                break;
            }
        } else {
            let (left, _) = piece.split_at(offset, hyphen, window);
            prefix.push(left);
            break;
        }
    }
    prefix
}

fn consume_prefix(
    word: &mut VecDeque<StyledPiece>,
    offset: usize,
    width: &mut Pixels,
    window: &mut Window,
) {
    while let Some(piece) = word.pop_front() {
        *width -= piece.piece.width();
        if piece.piece.range.end <= offset {
            if piece.piece.range.end == offset {
                break;
            }
        } else {
            let (_, suffix) = piece.split_at(offset, false, window);
            if let Some(suffix) = suffix {
                *width += suffix.piece.width();
                word.push_front(suffix);
            }
            break;
        }
    }
}

fn fitting_offset(word: &VecDeque<StyledPiece>, breaks: &Hyphenation, available: Pixels) -> usize {
    let mut width = px(0.);
    let mut fitting = word[0].piece.range.start;
    for piece in word {
        if width + piece.piece.width() <= available {
            width += piece.piece.width();
            fitting = piece.piece.range.end;
        } else {
            let candidates = breaks.graphemes_in(piece.piece.range.clone());
            let index = candidates.partition_point(|offset| {
                width + piece.piece.x_for_offset(*offset - piece.piece.range.start) <= available
            });
            if let Some(offset) = index.checked_sub(1).and_then(|index| candidates.get(index)) {
                fitting = *offset;
            }
            break;
        }
    }
    fitting
}

#[allow(clippy::too_many_arguments)]
pub(super) fn layout(
    items: Vec<FlowItem>,
    hyphenation: &Hyphenation,
    width: Pixels,
    align: Alignment,
    base_height: Pixels,
    reserve: Pixels,
    reserve_height: Pixels,
    end: usize,
    measure_inline_form: bool,
    window: &mut Window,
) -> Flow {
    let mut pen = Pen {
        x: px(0.),
        y: px(0.),
        height: base_height,
        first: 0,
        start: 0,
        width,
        base_height,
        reserve,
        reserve_height,
        align,
        pieces: Vec::new(),
        lines: Vec::new(),
        measure_inline_form,
        math_row: super::math_source_flow::InlineRow::default(),
        intrinsic_heights: Vec::new(),
    };
    let mut items: VecDeque<_> = items.into();
    while let Some(item) = items.pop_front() {
        match item {
            FlowItem::Break(offset) => pen.advance(offset, offset + 1, false),
            FlowItem::Piece(styled) if styled.piece.whitespace => {
                pen.word(vec![*styled], hyphenation, window);
            }
            FlowItem::Piece(styled) if styled.piece.object || styled.piece.float_initial => {
                if !styled.piece.whitespace
                    && !styled.piece.float_initial
                    && styled.piece.width() > pen.available()
                    && pen.x > px(0.)
                {
                    let start = styled.piece.range.start;
                    pen.advance(start, start, true);
                }
                pen.place(*styled);
            }
            FlowItem::Piece(styled) => {
                let end = hyphenation
                    .segment_end(styled.piece.range.start)
                    .or_else(|| hyphenation.word_end(styled.piece.range.start))
                    .unwrap_or(styled.piece.range.end);
                let mut word = vec![*styled];
                while let Some(FlowItem::Piece(next)) = items.front()
                    && !next.piece.whitespace
                    && !next.piece.object
                    && !next.piece.float_initial
                    && next.piece.range.start < end
                {
                    let Some(FlowItem::Piece(next)) = items.pop_front() else {
                        unreachable!()
                    };
                    word.push(*next);
                }
                pen.word(word, hyphenation, window);
            }
        }
    }
    pen.finish(end, false);
    Flow {
        pieces: pen.pieces,
        lines: pen.lines,
        size: size(width, pen.y + pen.height),
    }
}
