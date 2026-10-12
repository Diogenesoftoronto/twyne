//! The inline strong label and smaller hint from Source Claim Check.
//! Each face is shaped at its actual size; soft wraps share one baseline.
use crate::theme::{Palette, SERIF_FONT};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, AvailableSpace, Bounds, Element, ElementId, Font, FontWeight, GlobalElementId,
    InspectorElementId, IntoElement, LayoutId, Pixels, Point, ShapedLine, SharedString, Size,
    StrikethroughStyle, Style, TextAlign, TextRun, Window, div, font, point, px, rgb, size,
};
use std::{cell::RefCell, ops::Range, rc::Rc};

const LINE_HEIGHT: f32 = 14. * 1.55;

pub fn support_text(label: &str, hint: Option<&str>, filled: bool, colors: Palette) -> AnyElement {
    let mut whitespace = false;
    let label = collapse_spaces(label, &mut whitespace);
    let hint = if filled {
        String::new()
    } else {
        hint.map(|hint| collapse_spaces(&format!(" — {hint}"), &mut whitespace))
            .unwrap_or_default()
    };
    div()
        .flex_1()
        .min_w_0()
        .child(SupportText {
            label,
            hint,
            filled,
            colors,
        })
        .into_any_element()
}

// CSS normal whitespace collapses segment breaks, tabs and ASCII spaces.
// NBSP, narrow NBSP and other Unicode content keep their own break semantics.
fn collapsible(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\r' | '\u{000c}')
}

fn collapse_spaces(text: &str, previous_space: &mut bool) -> String {
    let mut out = String::new();
    for character in text.chars() {
        if collapsible(character) {
            if !*previous_space {
                out.push(' ');
            }
            *previous_space = true;
        } else {
            out.push(character);
            *previous_space = false;
        }
    }
    out
}

struct SupportText {
    label: String,
    hint: String,
    filled: bool,
    colors: Palette,
}

struct FaceRun {
    from: usize,
    shape: ShapedLine,
}

struct InlineLayout {
    text: String,
    runs: Vec<FaceRun>,
    breaks: Vec<usize>,
    baseline: Pixels,
    placements: Vec<(ShapedLine, Point<Pixels>)>,
}

impl InlineLayout {
    fn trimmed_range(&self, range: Range<usize>) -> Range<usize> {
        let text = &self.text[range.clone()];
        let start = range.start + text.len() - text.trim_start_matches(' ').len();
        let end = start + self.text[start..range.end].trim_end_matches(' ').len();
        start..end
    }

    fn width(&self, range: Range<usize>) -> Pixels {
        let range = self.trimmed_range(range);
        self.runs
            .iter()
            .map(|run| {
                let start = range.start.max(run.from);
                let end = range.end.min(run.from + run.shape.len());
                if end > start {
                    run.shape.x_for_index(end - run.from) - run.shape.x_for_index(start - run.from)
                } else {
                    px(0.)
                }
            })
            .sum()
    }

    fn measure(&mut self, wrap_width: Option<Pixels>) -> Size<Pixels> {
        self.placements.clear();
        let mut start = 0;
        let mut row = 0;
        let mut widest = px(0.);
        while start < self.text.len() {
            start += self.text[start..].len() - self.text[start..].trim_start_matches(' ').len();
            if start == self.text.len() {
                break;
            }
            let mut chosen = None;
            for end in self.breaks.iter().copied().filter(|end| *end > start) {
                if wrap_width.is_some_and(|width| self.width(start..end) > width) {
                    chosen = chosen.or(Some(end));
                    break;
                }
                chosen = Some(end);
            }
            let end = chosen.unwrap_or(self.text.len());
            let range = self.trimmed_range(start..end);
            let mut x = px(0.);
            for run in &self.runs {
                let from = range.start.max(run.from);
                let to = range.end.min(run.from + run.shape.len());
                if to <= from {
                    continue;
                }
                let (_, remainder) = run.shape.split_at(from - run.from);
                let (fragment, _) = remainder.split_at(to - from);
                let own_baseline =
                    (px(LINE_HEIGHT) - fragment.ascent - fragment.descent) / 2. + fragment.ascent;
                let width = fragment.width();
                self.placements.push((
                    fragment,
                    point(
                        x,
                        px(row as f32 * LINE_HEIGHT) + self.baseline - own_baseline,
                    ),
                ));
                x += width;
            }
            widest = widest.max(x);
            row += 1;
            start = end;
        }
        let intrinsic = self.width(0..self.text.len());
        let width = wrap_width.map_or(intrinsic, |width| intrinsic.min(width).max(widest));
        size(width, px(row.max(1) as f32 * LINE_HEIGHT))
    }
}

impl IntoElement for SupportText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for SupportText {
    type RequestLayoutState = Rc<RefCell<InlineLayout>>;
    type PrepaintState = ();
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
        let color = if self.filled {
            self.colors.ink_muted
        } else {
            self.colors.ink
        };
        let strong = window.text_system().shape_line(
            SharedString::from(self.label.clone()),
            px(14.),
            &[TextRun {
                len: self.label.len(),
                font: Font {
                    weight: FontWeight::BOLD,
                    ..font(SERIF_FONT)
                },
                color: rgb(color).into(),
                strikethrough: self.filled.then_some(StrikethroughStyle {
                    thickness: px(1.),
                    color: Some(rgb(color).into()),
                }),
                ..Default::default()
            }],
            None,
        );
        let strut = window.text_system().shape_line(
            "Mg".into(),
            px(14.),
            &[TextRun {
                len: 2,
                font: font(SERIF_FONT),
                ..Default::default()
            }],
            None,
        );
        let baseline = (px(LINE_HEIGHT) - strut.ascent - strut.descent) / 2. + strut.ascent;
        let mut runs = vec![FaceRun {
            from: 0,
            shape: strong,
        }];
        if !self.hint.is_empty() {
            runs.push(FaceRun {
                from: self.label.len(),
                shape: window.text_system().shape_line(
                    SharedString::from(self.hint.clone()),
                    px(12.),
                    &[TextRun {
                        len: self.hint.len(),
                        font: font(SERIF_FONT),
                        color: rgb(self.colors.ink_muted).into(),
                        ..Default::default()
                    }],
                    None,
                ),
            });
        }
        let text = format!("{}{}", self.label, self.hint);
        let breaks = unicode_linebreak::linebreaks(&text)
            .map(|(end, _)| end)
            .collect();
        let state = Rc::new(RefCell::new(InlineLayout {
            text,
            runs,
            breaks,
            baseline,
            placements: Vec::new(),
        }));
        let measure_state = state.clone();
        let id = window.request_measured_layout(Style::default(), move |known, available, _, _| {
            let width = known.width.or(match available.width {
                AvailableSpace::Definite(width) => Some(width),
                AvailableSpace::MinContent => Some(px(0.)),
                AvailableSpace::MaxContent => None,
            });
            measure_state.borrow_mut().measure(width)
        });
        (id, state)
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        _: &mut Window,
        _: &mut App,
    ) {
        state.borrow_mut().measure(Some(bounds.size.width));
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        for (shape, position) in &state.borrow().placements {
            let _ = shape.paint(
                bounds.origin + *position,
                px(LINE_HEIGHT),
                TextAlign::Left,
                None,
                window,
                cx,
            );
        }
    }
}
