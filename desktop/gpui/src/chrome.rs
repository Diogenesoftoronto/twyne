use crate::{
    assets::{self, TwyneIcon},
    theme,
};
use chrono::{Datelike, Local, NaiveDate};
use gpui_kit::component::{
    Sizable,
    button::{Button, ButtonVariants},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    App, AvailableSpace, Bounds, Element, ElementId, Font, FontWeight, GlobalElementId,
    InspectorElementId, IntoElement, LayoutId, Pixels, Point, Role, ShapedLine, SharedString, Size,
    Style, TextAlign, TextRun, Window, div, font, point, px, rgb, size,
};
use std::{cell::RefCell, rc::Rc};
use unicode_segmentation::UnicodeSegmentation;

mod focus_outline;
pub use focus_outline::focus_outline;
mod page_selector;
pub use page_selector::PageSelectorTrigger;

/// The original Chromium menu-list arrow in its20px reserved slot. Its path
/// and stroke are independent of the selected option's font or length.
pub fn page_selector_arrow(color: u32) -> gpui_kit::AnyElement {
    gpui_kit::canvas(
        |bounds, _, _| {
            let mut arrow = gpui_kit::PathBuilder::stroke(px(2.));
            arrow.move_to(bounds.origin + point(px(8.), px(12.)));
            arrow.line_to(bounds.origin + point(px(12.), px(16.)));
            arrow.line_to(bounds.origin + point(px(16.), px(12.)));
            arrow.build().expect("The fixed menu-list arrow is valid")
        },
        move |_, arrow, window, _| window.paint_path(arrow, rgb(color)),
    )
    .w(px(20.))
    .h(px(28.))
    .flex_shrink_0()
    .into_any_element()
}

pub fn dept_label(label: &str, cx: &App) -> impl IntoElement {
    tracked_typewriter(
        &label.to_uppercase(),
        10.,
        3.2,
        theme::palette(cx).ink_muted,
    )
}

pub fn tracked_typewriter(
    label: &str,
    size: f32,
    tracking: f32,
    color: u32,
) -> gpui_kit::AnyElement {
    tracked_text(
        label,
        font(theme::TYPEWRITER_FONT),
        size,
        tracking,
        color,
        size * 1.5,
    )
}

pub fn tracked_text(
    label: &str,
    face: Font,
    size: f32,
    tracking: f32,
    color: u32,
    line_height: f32,
) -> gpui_kit::AnyElement {
    div()
        .id(SharedString::from(format!("dept-{label}")))
        .role(Role::Label)
        .font_family(face.family.clone())
        .font_weight(face.weight)
        .text_size(px(size))
        .line_height(px(line_height))
        .text_color(rgb(color))
        .aria_label(label.to_owned())
        .child(TrackedRun {
            label: label.to_owned().into(),
            size,
            tracking,
            color,
            face,
            line_height,
        })
        .into_any_element()
}

/// CSS can wrap the masthead department at spaces and hyphens. Each run
/// retains fractional glyph advances and the trailing letter spacing.
pub fn wrapping_dept_label(label: &str, cx: &App) -> impl IntoElement {
    let label = label.to_uppercase();
    let color = theme::palette(cx).ink_muted;
    wrapping_typewriter(&label, 3.2, color)
}

pub fn wrapping_typewriter(label: &str, tracking: f32, color: u32) -> gpui_kit::AnyElement {
    wrapped_tracked_text(
        label,
        font(theme::TYPEWRITER_FONT),
        10.,
        tracking,
        color,
        15.,
        WrappedBreakPolicy::Normal,
    )
}

/// Source buttons keep CSS normal word wrapping and center every tracked line.
pub fn centered_wrapping_typewriter(
    label: &str,
    size: f32,
    tracking: f32,
    color: u32,
    line_height: f32,
) -> gpui_kit::AnyElement {
    div()
        .id(SharedString::from(format!("wrapped-{label}")))
        .role(Role::Label)
        .aria_label(label.to_owned())
        .w_full()
        .min_w_0()
        .child(WrappedTrackedRun {
            label: label.to_owned().into(),
            face: font(theme::TYPEWRITER_FONT),
            size,
            line_height,
            tracking,
            color,
            policy: WrappedBreakPolicy::Normal,
            alignment: TextAlign::Center,
        })
        .into_any_element()
}

/// CSS normal line breaks with overflow-wrap:anywhere as the fallback for a
/// single oversized segment. Tracking follows the shaped grapheme clusters.
pub fn wrapping_tracked_text(
    label: &str,
    face: Font,
    size: f32,
    tracking: f32,
    color: u32,
    line_height: f32,
) -> gpui_kit::AnyElement {
    wrapped_tracked_text(
        label,
        face,
        size,
        tracking,
        color,
        line_height,
        WrappedBreakPolicy::Anywhere,
    )
}

/// Chromium's printable-ASCII word-break:break-all opportunities, preserving
/// punctuation restrictions. Other text retains the existing Unicode path.
pub fn break_all_text(
    label: &str,
    face: Font,
    size: f32,
    color: u32,
    line_height: f32,
) -> gpui_kit::AnyElement {
    wrapped_tracked_text(
        label,
        face,
        size,
        0.,
        color,
        line_height,
        WrappedBreakPolicy::AsciiBreakAll,
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WrappedBreakPolicy {
    Normal,
    Anywhere,
    AsciiBreakAll,
}

fn wrapped_tracked_text(
    label: &str,
    face: Font,
    size: f32,
    tracking: f32,
    color: u32,
    line_height: f32,
    policy: WrappedBreakPolicy,
) -> gpui_kit::AnyElement {
    div()
        .id(SharedString::from(format!("wrapped-{label}")))
        .role(Role::Label)
        .aria_label(label.to_owned())
        .min_w_0()
        .max_w_full()
        .child(WrappedTrackedRun {
            label: label.to_owned().into(),
            face,
            size,
            line_height,
            tracking,
            color,
            policy,
            alignment: TextAlign::Left,
        })
        .into_any_element()
}

struct WrappedTrackedRun {
    label: SharedString,
    face: Font,
    size: f32,
    line_height: f32,
    tracking: f32,
    color: u32,
    policy: WrappedBreakPolicy,
    alignment: TextAlign,
}

struct TrackedGlyph {
    start: usize,
    shape: ShapedLine,
}

struct WrappedTrackedLayout {
    label: SharedString,
    shape: ShapedLine,
    glyphs: Vec<TrackedGlyph>,
    normal_breaks: Vec<usize>,
    tracking: f32,
    line_height: f32,
    anywhere: bool,
    placements: Vec<(usize, Point<Pixels>)>,
    row_widths: Vec<Pixels>,
}

impl WrappedTrackedLayout {
    fn new(
        label: SharedString,
        shape: ShapedLine,
        tracking: f32,
        line_height: f32,
        policy: WrappedBreakPolicy,
    ) -> Self {
        let mut cursor = shape.cursor();
        let glyphs = label
            .grapheme_indices(true)
            .map(|(start, grapheme)| TrackedGlyph {
                start,
                shape: cursor.take_until(start + grapheme.len()),
            })
            .collect();
        let normal_breaks = if policy != WrappedBreakPolicy::Normal
            && label.bytes().all(|byte| byte.is_ascii_graphic())
        {
            // Chromium uses printable-ASCII compatibility pairs rather than
            // raw UAX14 for normal CSS wrapping. This is a character rule,
            // independent of URL syntax. See host-apparatus/README.md for the
            // primary generator/iterator sources and the bounded contract.
            let bytes = label.as_bytes();
            let mut breaks = (1..bytes.len())
                .filter(|&index| {
                    Self::ascii_normal_break(bytes, index)
                        || (policy == WrappedBreakPolicy::AsciiBreakAll
                            && Self::ascii_break_all_extra(bytes[index - 1], bytes[index]))
                })
                .collect::<Vec<_>>();
            breaks.push(label.len());
            breaks
        } else {
            // Preserve the typewriter helper's existing opportunities and the
            // current Unicode/whitespace/control path without ASCII tailoring.
            unicode_linebreak::linebreaks(&label)
                .map(|(end, _)| end)
                .collect()
        };
        Self {
            label,
            shape,
            glyphs,
            normal_breaks,
            tracking,
            line_height,
            anywhere: policy == WrappedBreakPolicy::Anywhere,
            placements: Vec::new(),
            row_widths: Vec::new(),
        }
    }

    fn ascii_normal_break(bytes: &[u8], index: usize) -> bool {
        let previous = bytes[index - 1];
        let next = bytes[index];
        if previous == b'-' && next.is_ascii_digit() {
            // A leading minus stays attached to its number; an alphanumeric
            // prefix permits a break after a hyphen in a longer token.
            return index > 1 && bytes[index - 2].is_ascii_alphanumeric();
        }
        if matches!(
            next,
            b'!' | b')' | b',' | b'.' | b'/' | b':' | b';' | b'?' | b']' | b'}'
        ) || (previous == b'?' && matches!(next, b'"' | b'\''))
            || (previous == b'-' && next == b'$')
            || previous.is_ascii_alphanumeric()
            || matches!(
                previous,
                b'$' | b'\'' | b'(' | b'/' | b'<' | b'@' | b'[' | b'^'..=b'`' | b'{'
            )
        {
            return false;
        }
        matches!(previous, b'-' | b'?') || matches!(next, b'(' | b'<' | b'[' | b'{')
    }

    fn ascii_break_all_extra(previous: u8, next: u8) -> bool {
        use unicode_linebreak::BreakClass::*;
        // The printable-ASCII subset of Chromium's additional break-all
        // class opportunities. Normal compatibility opportunities still take
        // precedence; a zero here falls back to them, not to arbitrary cuts.
        // See kBreakAllLineBreakClassTable / ShouldBreakAfterBreakAll in the
        // primary iterator linked from host-apparatus/README.md.
        let class = |byte| {
            if byte == b'+' {
                Alphabetic
            } else {
                unicode_linebreak::break_property(u32::from(byte))
            }
        };
        let previous = class(previous);
        let current = class(next);
        if current == After && next != b'|' {
            return false;
        }
        match previous {
            Alphabetic | After | Numeric | Symbol => matches!(
                current,
                Alphabetic | After | Hyphen | Numeric | OpenPunctuation | Prefix
            ),
            ClosePunctuation | CloseParenthesis => {
                matches!(current, Alphabetic | After | Hyphen | Numeric | Prefix)
            }
            Exclamation | Postfix => matches!(
                current,
                Alphabetic | After | Hyphen | Numeric | Postfix | Prefix
            ),
            InfixSeparator => matches!(current, Alphabetic | After | Hyphen | Numeric),
            Hyphen => current == Numeric,
            Prefix => current == Postfix,
            _ => false,
        }
    }

    fn width(&self, start: usize, end: usize) -> Pixels {
        let end = start + self.label[start..end].trim_end().len();
        let first = self.glyphs.partition_point(|glyph| glyph.start < start);
        let last = self.glyphs.partition_point(|glyph| glyph.start < end);
        self.shape.x_for_index(end) - self.shape.x_for_index(start)
            + px(self.tracking * (last - first) as f32)
    }

    fn measure(&mut self, wrap_width: Option<Pixels>) -> Size<Pixels> {
        let mut ranges = Vec::new();
        let mut start = 0;
        while start < self.label.len() {
            start += self.label[start..].len() - self.label[start..].trim_start().len();
            if start == self.label.len() {
                break;
            }
            let mut chosen = None;
            for end in self
                .normal_breaks
                .iter()
                .copied()
                .filter(|end| *end > start)
            {
                if wrap_width.is_some_and(|width| self.width(start, end) > width) {
                    if self.anywhere && chosen.is_none() {
                        // CSS retries at grapheme boundaries only when no
                        // ordinary break fits this line. A following oversized
                        // segment cannot cancel an already-fitting normal break.
                        // Always admit one complete grapheme to make progress.
                        let width = wrap_width.unwrap();
                        for (offset, grapheme) in self.label[start..end].grapheme_indices(true) {
                            let candidate = start + offset + grapheme.len();
                            if self.width(start, candidate) > width {
                                chosen = chosen.or(Some(candidate));
                                break;
                            }
                            chosen = Some(candidate);
                        }
                    } else {
                        chosen = chosen.or(Some(end));
                    }
                    break;
                }
                chosen = Some(end);
            }
            let end = chosen.unwrap_or(self.label.len());
            ranges.push(start..end);
            start = end;
        }
        self.placements.clear();
        self.row_widths.clear();
        let mut widest = px(0.);
        for (row, range) in ranges.iter().enumerate() {
            let end = range.start + self.label[range.clone()].trim_end().len();
            let first = self
                .glyphs
                .partition_point(|glyph| glyph.start < range.start);
            let last = self.glyphs.partition_point(|glyph| glyph.start < end);
            let row_width = self.width(range.start, end);
            self.row_widths.push(row_width);
            widest = widest.max(row_width);
            for index in first..last {
                self.placements.push((
                    index,
                    point(
                        self.shape.x_for_index(self.glyphs[index].start)
                            - self.shape.x_for_index(range.start)
                            + px(self.tracking * (index - first) as f32),
                        px(row as f32 * self.line_height),
                    ),
                ));
            }
        }
        let intrinsic = self.width(0, self.label.len());
        let width = wrap_width.map_or(intrinsic, |width| intrinsic.min(width).max(widest));
        size(width, px(ranges.len().max(1) as f32 * self.line_height))
    }
}

impl IntoElement for WrappedTrackedRun {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for WrappedTrackedRun {
    type RequestLayoutState = Rc<RefCell<WrappedTrackedLayout>>;
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
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let shape = window.text_system().shape_line(
            self.label.clone(),
            px(self.size),
            &[TextRun {
                len: self.label.len(),
                font: self.face.clone(),
                color: rgb(self.color).into(),
                ..Default::default()
            }],
            None,
        );
        let state = Rc::new(RefCell::new(WrappedTrackedLayout::new(
            self.label.clone(),
            shape,
            self.tracking,
            self.line_height,
            self.policy,
        )));
        let measure_state = state.clone();
        let id = window.request_measured_layout(Style::default(), move |known, available, _, _| {
            let width = known.width.or(match available.width {
                AvailableSpace::Definite(width) => Some(width),
                AvailableSpace::MinContent => Some(px(0.)),
                AvailableSpace::MaxContent => None,
            });
            measure_state.borrow_mut().measure(width)
        });
        let _ = cx;
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
        let state = state.borrow();
        for (index, position) in &state.placements {
            let row = (f32::from(position.y) / self.line_height).round() as usize;
            let spare = (bounds.size.width - state.row_widths[row]).max(px(0.));
            let offset = match self.alignment {
                TextAlign::Center => spare / 2.,
                TextAlign::Right => spare,
                _ => px(0.),
            };
            let _ = state.glyphs[*index].shape.paint(
                bounds.origin + *position + point(offset, px(0.)),
                px(self.line_height),
                TextAlign::Left,
                None,
                window,
                cx,
            );
        }
    }
}

struct TrackedRun {
    label: SharedString,
    size: f32,
    tracking: f32,
    color: u32,
    face: Font,
    line_height: f32,
}
struct TrackedRunLayout {
    parts: Vec<(ShapedLine, Pixels)>,
}
impl IntoElement for TrackedRun {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}
impl Element for TrackedRun {
    type RequestLayoutState = TrackedRunLayout;
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
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let shape = window.text_system().shape_line(
            self.label.clone(),
            px(self.size),
            &[TextRun {
                len: self.label.len(),
                font: self.face.clone(),
                color: rgb(self.color).into(),
                ..Default::default()
            }],
            None,
        );
        let mut cursor = shape.cursor();
        let parts = self
            .label
            .grapheme_indices(true)
            .enumerate()
            .map(|(index, (start, grapheme))| {
                (
                    cursor.take_until(start + grapheme.len()),
                    shape.x_for_index(start) + px(self.tracking * index as f32),
                )
            })
            .collect::<Vec<_>>();
        let mut style = Style::default();
        style.size.width = (shape.width() + px(self.tracking * parts.len() as f32)).into();
        style.size.height = px(self.line_height).into();
        style.flex_shrink = 0.;
        (
            window.request_layout(style, [], cx),
            TrackedRunLayout { parts },
        )
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Window,
        _: &mut App,
    ) {
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
        for (part, x) in &state.parts {
            let _ = part.paint(
                bounds.origin + point(*x, px(0.)),
                px(self.line_height),
                TextAlign::Left,
                None,
                window,
                cx,
            );
        }
    }
}

pub fn ornament(cx: &App) -> impl IntoElement {
    let colors = *theme::palette(cx);
    div()
        .flex()
        .items_center()
        .gap(px(12.))
        .font_family(theme::DISPLAY_FONT)
        .text_size(px(14.))
        .text_color(rgb(colors.ink_muted))
        .child(div().flex_1().h(px(1.)).bg(rgb(colors.rule)))
        .child("❦")
        .child(div().flex_1().h(px(1.)).bg(rgb(colors.rule)))
}

pub fn folio_numeral(index: usize) -> String {
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
        .get(index)
        .map_or_else(|| (index + 1).to_string(), |value| (*value).to_owned())
}

pub fn tool_button(
    id: &'static str,
    label: &'static str,
    icon: Option<TwyneIcon>,
    cx: &App,
) -> Button {
    Button::new(id)
        .ghost()
        .small()
        .h(px(36.))
        .px(px(8.))
        .rounded(px(0.))
        .text_color(rgb(theme::palette(cx).ink_light))
        .accessibility_label(label)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.4))
                .font_family(theme::SANS_FONT)
                .text_size(px(12.))
                .when_some(icon, |this, icon| this.child(assets::icon(icon)))
                .child(label),
        )
}

pub fn paper_button(
    id: &'static str,
    label: &'static str,
    icon: Option<TwyneIcon>,
    cx: &App,
) -> Button {
    let colors = *theme::palette(cx);
    Button::new(id)
        .ghost()
        .small()
        .h(px(32.))
        .px(px(14.4))
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(colors.rule))
        .bg(rgb(colors.paper_soft))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(rgb(colors.ink))
        .accessibility_label(label)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .min_w_0()
                .font_family(theme::BUTTON_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(12.))
                .line_height(px(18.))
                .when_some(icon, |this, icon| this.child(assets::icon(icon)))
                .child(
                    div()
                        .min_w_0()
                        .whitespace_normal()
                        .text_align(TextAlign::Center)
                        .child(label),
                ),
        )
}

pub fn press_button(
    id: &'static str,
    label: &'static str,
    text_size: f32,
    cx: &App,
) -> gpui_kit::base::Button {
    press_button_chrome(id, label, cx).child(tracked_typewriter(
        &label.to_uppercase(),
        text_size,
        text_size * 0.18,
        theme::palette(cx).paper,
    ))
}

pub fn wrapping_press_button(
    id: &'static str,
    label: &'static str,
    text_size: f32,
    cx: &App,
) -> gpui_kit::base::Button {
    press_button_chrome(id, label, cx).child(centered_wrapping_typewriter(
        &label.to_uppercase(),
        text_size,
        text_size * 0.18,
        theme::palette(cx).paper,
        text_size * 1.5,
    ))
}

fn press_button_chrome(id: &'static str, label: &'static str, cx: &App) -> gpui_kit::base::Button {
    let colors = *theme::palette(cx);
    gpui_kit::base::Button::new(id)
        .accessibility_label(label)
        .px(px(16.))
        .py(px(8.8))
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(colors.ink))
        .bg(rgb(colors.ink))
        .text_color(rgb(colors.paper))
        .hover(|this| {
            this.bg(rgb(colors.vermilion_deep))
                .border_color(rgb(colors.vermilion_deep))
                .shadow(vec![
                    gpui_kit::BoxShadow::new(
                        px(0.),
                        px(4.),
                        rgb(colors.vermilion_deep).opacity(0.6).into(),
                    )
                    .blur_radius(px(14.))
                    .spread_radius(px(-8.)),
                ])
        })
}

pub fn file_menu_button(cx: &App) -> Button {
    let colors = *theme::palette(cx);
    let disclosure = theme::file_disclosure_font();
    Button::new("file-menu")
        .ghost()
        .small()
        .h_auto()
        .px(px(14.4))
        .py(px(7.2))
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(colors.rule))
        .bg(rgb(colors.paper_soft))
        .text_color(rgb(colors.ink))
        .accessibility_label("File")
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .font_family(theme::BUTTON_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(12.))
                .line_height(px(16.))
                .child(assets::icon(TwyneIcon::File))
                .child("File")
                .child(
                    div()
                        .font_family(disclosure.family)
                        .font_weight(disclosure.weight)
                        .child("▾"),
                ),
        )
}

/// The source header lays the icon and wrapping label directly in its button.
/// Kit's ordinary button content is clipped to a single label box instead.
pub fn dossier_button(label: &'static str, pending: bool, cx: &App) -> gpui_kit::base::Button {
    let colors = *theme::palette(cx);
    gpui_kit::base::Button::new("create-dossier")
        .accessibility_label(label)
        .flex_shrink_1()
        .min_w_0()
        .px(px(14.4))
        .py(px(7.2))
        .gap(px(6.))
        .rounded(px(2.))
        .border_1()
        .border_color(rgb(if pending {
            colors.vermilion
        } else {
            colors.rule
        }))
        .bg(rgb(colors.paper_soft))
        .font_family(theme::BUTTON_FONT)
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(12.))
        .line_height(px(18.))
        .text_color(rgb(colors.ink))
        .hover(|this| {
            this.bg(rgb(colors.sidebar))
                .border_color(rgb(colors.ink_muted))
        })
        .child(
            assets::icon(if pending {
                TwyneIcon::Folder
            } else {
                TwyneIcon::Edit
            })
            .flex_shrink_0(),
        )
        .child(
            div()
                .min_w_0()
                .whitespace_normal()
                .text_align(TextAlign::Center)
                .child(label),
        )
}

/// The persistent view row uses the web controls' two distinct geometries.
pub fn desk_button(
    id: &'static str,
    label: &'static str,
    icon: TwyneIcon,
    view: bool,
    narrow: bool,
    cx: &App,
) -> Button {
    Button::new(id)
        .ghost()
        .small()
        .h(px(if narrow { 40. } else { 36. }))
        .px(px(match (narrow, view) {
            (true, true) => 5.6,
            (true, false) => 4.8,
            (false, true) => 8.,
            (false, false) => 7.2,
        }))
        .rounded(px(2.))
        .text_color(rgb(theme::palette(cx).ink_light))
        .accessibility_label(label)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(if view {
                    if narrow { 3.2 } else { 6.4 }
                } else {
                    5.6
                }))
                .font_family(if view {
                    theme::BUTTON_FONT
                } else {
                    theme::SANS_FONT
                })
                .font_weight(if view {
                    FontWeight::SEMIBOLD
                } else {
                    FontWeight::NORMAL
                })
                .text_size(px(12.))
                .line_height(px(18.))
                .when(!view || !narrow, |this| {
                    this.child(
                        assets::icon(icon).with_size(px(if icon == TwyneIcon::Settings {
                            16.
                        } else {
                            17.
                        })),
                    )
                })
                .child(label),
        )
}

pub fn zen_button(active: bool, cx: &App) -> Button {
    let colors = *theme::palette(cx);
    Button::new("focus")
        .ghost()
        .small()
        .h(px(28.))
        .px(px(4.))
        .ml_auto()
        .rounded(px(2.))
        .toggled(active)
        .accessibility_label("Toggle Zen mode")
        .text_color(rgb(if active {
            colors.vermilion
        } else {
            colors.ink_light
        }))
        .when(active, |this| {
            this.bg(rgb(colors.sidebar))
                .border_b_2()
                .border_color(rgb(colors.vermilion))
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.8))
                .font_family(theme::FOOTER_FONT)
                .text_size(px(11.))
                .line_height(px(16.5))
                .child(assets::icon(TwyneIcon::Eye).with_size(px(15.)))
                .child(if active { "Writing focus" } else { "Zen" }),
        )
}

pub fn editorial_dateline() -> String {
    dateline(Local::now().date_naive())
}

fn dateline(date: NaiveDate) -> String {
    let day = date.day();
    let suffix = match day % 100 {
        11..=13 => "th",
        _ => match day % 10 {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        },
    };
    format!(
        "Vol. I · No. {} · {}, the {day}{suffix} of {}, {}",
        date.ordinal(),
        date.format("%A"),
        date.format("%B"),
        date.year()
    )
}

#[cfg(test)]
mod tests {
    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    fn placed_lines(layout: &super::WrappedTrackedLayout) -> Vec<String> {
        let mut lines = Vec::<String>::new();
        for (index, position) in &layout.placements {
            let row = (f32::from(position.y) / layout.line_height).round() as usize;
            if lines.len() <= row {
                lines.resize(row + 1, String::new());
            }
            let start = layout.glyphs[*index].start;
            let end = layout
                .glyphs
                .get(index + 1)
                .map_or(layout.label.len(), |glyph| glyph.start);
            lines[row].push_str(&layout.label[start..end]);
        }
        lines
    }

    #[test]
    fn dateline_matches_the_reference_masthead() {
        assert_eq!(
            super::dateline(chrono::NaiveDate::from_ymd_opt(2026, 10, 4).unwrap()),
            "Vol. I · No. 277 · Sunday, the 4th of October, 2026"
        );
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn actual_platform_tracked_urls_match_original_css_wrapping() {
        use super::*;
        use gpui_kit::{HeadlessAppContext, WindowTextSystem};
        use std::sync::Arc;
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(actual, Arc::new(assets::TwyneAssets));
        let reference: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/host-apparatus/browser-url-wrap-observations.json"
        )))
        .unwrap();
        assert_eq!(reference["rows"].as_array().unwrap().len(), 20);
        assert_eq!(reference["css"]["fontSize"], 11);
        assert_eq!(reference["css"]["letterSpacing"], 1.1);
        assert_eq!(reference["css"]["lineHeight"], 15.95);
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            for case in reference["rows"].as_array().unwrap() {
                let label: SharedString = case["label"].as_str().unwrap().to_owned().into();
                let shape = shaper.shape_line(
                    label.clone(),
                    px(11.),
                    &[TextRun {
                        len: label.len(),
                        font: theme::apparatus_mono_font(),
                        ..Default::default()
                    }],
                    None,
                );
                let mut layout = WrappedTrackedLayout::new(
                    label,
                    shape,
                    1.1,
                    15.95,
                    WrappedBreakPolicy::Anywhere,
                );
                let breaks = layout.normal_breaks.clone();
                let width = px(case["width"].as_f64().unwrap() as f32);
                let measured = layout.measure(Some(width));
                assert_eq!(
                    serde_json::json!(placed_lines(&layout)),
                    case["lines"],
                    "{case}"
                );
                assert!(
                    (f32::from(measured.height) - case["height"].as_f64().unwrap() as f32).abs()
                        < 0.2,
                    "CSS line-box rounding for {case}"
                );
                layout.measure(None);
                let resized = layout.measure(Some(width));
                assert_eq!(layout.normal_breaks, breaks);
                assert_eq!(resized, measured);
                assert_eq!(serde_json::json!(placed_lines(&layout)), case["lines"]);
                assert_eq!(layout.label.as_ref(), case["label"].as_str().unwrap());
            }

            // Existing department labels retain 10px/15px typography and the
            // original Unicode opportunities: narrow boxes may overflow a
            // word, but must not introduce the URL helper's anywhere splits.
            for (text, expected) in [
                ("TYPEWRITER", vec!["TYPEWRITER"]),
                ("KEEP-THOUGHT", vec!["KEEP-", "THOUGHT"]),
            ] {
                let label: SharedString = text.into();
                let shape = shaper.shape_line(
                    label.clone(),
                    px(10.),
                    &[TextRun {
                        len: label.len(),
                        font: font(theme::TYPEWRITER_FONT),
                        ..Default::default()
                    }],
                    None,
                );
                let mut layout =
                    WrappedTrackedLayout::new(label, shape, 3.2, 15., WrappedBreakPolicy::Normal);
                let measured = layout.measure(Some(px(1.)));
                assert_eq!(placed_lines(&layout), expected);
                assert_eq!(measured.height, px(expected.len() as f32 * 15.));
                assert!(measured.width > px(1.));
            }
        });
    }

    #[cfg(all(feature = "ui-tests", target_os = "linux"))]
    #[test]
    fn actual_platform_page_urls_match_original_css_break_all() {
        use super::*;
        use gpui_kit::{HeadlessAppContext, WindowTextSystem};
        use std::sync::Arc;
        let actual = gpui_kit::platform::current_platform(true).text_system();
        let mut app = HeadlessAppContext::with_asset_source(actual, Arc::new(assets::TwyneAssets));
        let reference: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/host-apparatus/browser-page-url-wrap-observations.json"
        )))
        .unwrap();
        assert_eq!(reference["rows"].as_array().unwrap().len(), 20);
        assert_eq!(reference["css"]["fontSize"], 10.4);
        assert_eq!(reference["css"]["letterSpacing"], 0);
        assert_eq!(reference["css"]["lineHeight"], 15.6);
        assert_eq!(reference["css"]["wordBreak"], "break-all");
        assert_eq!(reference["css"]["overflowWrap"], "normal");
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let shaper = WindowTextSystem::new(cx.text_system().clone());
            for case in reference["rows"].as_array().unwrap() {
                let label: SharedString = case["label"].as_str().unwrap().to_owned().into();
                let shape = shaper.shape_line(
                    label.clone(),
                    px(10.4),
                    &[TextRun {
                        len: label.len(),
                        font: theme::apparatus_mono_font(),
                        ..Default::default()
                    }],
                    None,
                );
                let mut layout = WrappedTrackedLayout::new(
                    label,
                    shape,
                    0.,
                    15.6,
                    WrappedBreakPolicy::AsciiBreakAll,
                );
                let breaks = layout.normal_breaks.clone();
                let width = px(case["width"].as_f64().unwrap() as f32);
                let measured = layout.measure(Some(width));
                assert_eq!(
                    serde_json::json!(placed_lines(&layout)),
                    case["lines"],
                    "{case}"
                );
                assert!(
                    (f32::from(measured.height) - case["height"].as_f64().unwrap() as f32).abs()
                        < 0.2,
                    "CSS line-box rounding for {case}"
                );
                layout.measure(None);
                let resized = layout.measure(Some(width));
                assert_eq!(layout.normal_breaks, breaks);
                assert_eq!(resized, measured);
                assert_eq!(serde_json::json!(placed_lines(&layout)), case["lines"]);
                assert_eq!(layout.label.as_ref(), case["label"].as_str().unwrap());
            }
        });
    }
}
