//! Writer-comment previews from the original FlowSurface. Root supplies the
//! accepted ledger, actual mark identities, measured bounds and pacing state.
//! Quote overlap ranks notes; it never supplies identity or manuscript marks.

use crate::{
    flow::FlowMode,
    house::is_js_whitespace,
    marginalia::{CommentRef, UserComment},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginRailReply {
    pub author: String,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginRailNote {
    pub target: CommentRef,
    pub title: String,
    pub body: String,
    pub anchor_quote: String,
    pub reply: Option<MarginRailReply>,
    pub reply_count: usize,
    pub created_at: u64,
}
impl MarginRailNote {
    pub fn from_comment(comment: &UserComment) -> Option<Self> {
        let anchor = comment
            .anchor
            .as_ref()
            .filter(|anchor| !anchor.is_empty())?;
        if comment.resolved {
            return None;
        }
        Some(Self {
            target: comment.reference(),
            title: if comment.author.is_empty() {
                "Margin note".into()
            } else {
                comment.author.clone()
            },
            body: comment.text.clone(),
            anchor_quote: anchor.clone(),
            reply: comment.replies.last().map(|reply| MarginRailReply {
                author: reply.author.clone(),
                text: reply.text.clone(),
            }),
            reply_count: comment.replies.len(),
            created_at: if comment.updated_at == 0 {
                comment.created_at
            } else {
                comment.updated_at
            },
        })
    }
}
#[derive(Clone, Debug)]
pub struct MarginRailContext {
    pub mode: FlowMode,
    pub cursor_text: String,
    pub visible_anchor_quotes: HashSet<String>,
    pub dismissed: HashSet<CommentRef>,
    pub shown: HashSet<CommentRef>,
    pub weight: f64,
    pub now: u64,
    pub working_limit: usize,
}
impl Default for MarginRailContext {
    fn default() -> Self {
        Self {
            mode: FlowMode::Working,
            cursor_text: String::new(),
            visible_anchor_quotes: HashSet::new(),
            dismissed: HashSet::new(),
            shown: HashSet::new(),
            weight: 1.,
            now: 0,
            working_limit: 3,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarginRailDecision {
    pub visible: Vec<CommentRef>,
    pub held: usize,
}

fn normalize_anchor(value: &str) -> String {
    static RANGES: OnceLock<Vec<[u32; 2]>> = OnceLock::new();
    let ranges = RANGES.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../fixtures/marginalia/rail-letter-number-ranges.json"
        ))
        .expect("source Unicode category fixture")
    });
    let mut output = String::new();
    let mut pending_space = false;
    for ch in value.to_lowercase().chars() {
        let scalar = ch as u32;
        let index = ranges.partition_point(|range| range[1] < scalar);
        let letter_or_number = ranges.get(index).is_some_and(|range| range[0] <= scalar);
        if letter_or_number {
            if pending_space && !output.is_empty() {
                output.push(' ');
            }
            output.push(ch);
            pending_space = false;
        } else {
            pending_space = true;
        }
    }
    output
}
pub fn writer_note_overlap(note: &MarginRailNote, text: &str) -> f64 {
    if text.is_empty() || note.anchor_quote.is_empty() {
        return 0.;
    }
    let haystack = normalize_anchor(text);
    let needle = normalize_anchor(&note.anchor_quote);
    if needle.is_empty() {
        return 0.;
    }
    if haystack.contains(&needle) || needle.contains(&haystack) {
        return 1.;
    }
    let words = needle
        .split(' ')
        .filter(|word| word.encode_utf16().count() > 3)
        .collect::<Vec<_>>();
    if words.is_empty() {
        return 0.;
    }
    words
        .iter()
        .filter(|word| haystack.contains(**word))
        .count() as f64
        / words.len() as f64
}
pub fn writer_note_score(note: &MarginRailNote, context: &MarginRailContext) -> f64 {
    let age_minutes = context.now.saturating_sub(note.created_at) as f64 / 60_000.;
    let freshness = 0.6 + 0.4 * (-age_minutes / 20.).exp();
    let on_screen = if context.visible_anchor_quotes.contains(&note.anchor_quote) {
        0.15
    } else {
        0.
    };
    0.9 * context.weight
        * freshness
        * 1.1
        * (1. + writer_note_overlap(note, &context.cursor_text) + on_screen)
}
pub fn select_writer_notes(
    notes: &[MarginRailNote],
    context: &MarginRailContext,
) -> MarginRailDecision {
    let mut ranked = notes
        .iter()
        .filter(|note| !context.dismissed.contains(&note.target))
        .map(|note| (note, writer_note_score(note, context)))
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1)); // stable ties, as Array.sort in the source
    let visible = match context.mode {
        FlowMode::Flow => Vec::new(),
        FlowMode::Away | FlowMode::Settling => ranked
            .iter()
            .filter(|(note, _)| context.shown.contains(&note.target))
            .map(|(note, _)| note.target.clone())
            .collect(),
        FlowMode::Stuck => ranked
            .iter()
            .find(|(note, _)| writer_note_overlap(note, &context.cursor_text) > 0.3)
            .or(ranked.first())
            .map(|(note, _)| vec![note.target.clone()])
            .unwrap_or_default(),
        FlowMode::Working => ranked
            .iter()
            .take(context.working_limit)
            .map(|(note, _)| note.target.clone())
            .collect(),
    };
    MarginRailDecision {
        held: ranked.len() - visible.len(),
        visible,
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginRailRect {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}
impl MarginRailRect {
    pub fn right(self) -> f32 {
        self.left + self.width
    }
    pub fn bottom(self) -> f32 {
        self.top + self.height
    }
    fn valid(self) -> bool {
        [self.left, self.top, self.width, self.height]
            .iter()
            .all(|n| n.is_finite())
            && self.width >= 0.
            && self.height >= 0.
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct MarginRailAnchor {
    pub target: CommentRef,
    pub groups: Vec<Vec<MarginRailRect>>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize, Serialize)]
pub struct MarginRailObstacle {
    pub top: f32,
    pub height: f32,
}
#[derive(Clone, Debug, PartialEq)]
pub struct MarginRailGeometry {
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub canvas: MarginRailRect,
    pub scroller: MarginRailRect,
    pub text: MarginRailRect,
    pub cursor_top: Option<f32>,
    pub obstacles: Vec<MarginRailObstacle>,
}
impl MarginRailGeometry {
    fn valid(&self) -> bool {
        self.viewport_width.is_finite()
            && self.viewport_width > 0.
            && self.viewport_height.is_finite()
            && self.viewport_height > 0.
            && self.canvas.valid()
            && self.scroller.valid()
            && self.text.valid()
            && self.canvas.width > 0.
            && self.scroller.width > 0.
    }
    pub fn room(&self) -> MarginRailRoom {
        if self.scroller.right() - self.canvas.right() >= 304. {
            MarginRailRoom::Rail
        } else {
            MarginRailRoom::Dock
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct MarginRailOpenThread {
    pub target: CommentRef,
    pub anchor_top: f32,
    pub height: Option<f32>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MarginRailSlot {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub max_h: f32,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarginRailSnapshot {
    pub folio_id: Option<String>,
    pub notes: Vec<MarginRailNote>,
    pub visible: Vec<CommentRef>,
    pub held: usize,
    pub enabled: bool,
    pub mode: FlowMode,
    pub zen: bool,
    pub read_only: bool,
    pub foreground_open: bool,
    pub anchors: Option<Vec<MarginRailAnchor>>,
    pub geometry: Option<MarginRailGeometry>,
    pub peek: Option<CommentRef>,
    pub open_thread: Option<MarginRailOpenThread>,
}
/// Frequently changing presentation, excluding full saved note bodies.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarginRailPresentation {
    pub visible: Vec<CommentRef>,
    pub held: usize,
    pub enabled: bool,
    pub mode: FlowMode,
    pub zen: bool,
    pub read_only: bool,
    pub foreground_open: bool,
    pub anchors: Option<Vec<MarginRailAnchor>>,
    pub geometry: Option<MarginRailGeometry>,
    pub peek: Option<CommentRef>,
    pub open_thread: Option<MarginRailOpenThread>,
}
impl MarginRailSnapshot {
    fn anchor(&self, target: &CommentRef) -> Option<&MarginRailAnchor> {
        if self.folio_id.as_deref() != Some(target.folio_id.as_str()) {
            return None;
        }
        self.anchors
            .as_ref()?
            .iter()
            .find(|anchor| &anchor.target == target)
    }
    fn available(&self) -> bool {
        !self.zen
            && !self.read_only
            && self.mode != FlowMode::Flow
            && self.folio_id.is_some()
            && self.anchors.is_some()
            && self
                .geometry
                .as_ref()
                .is_some_and(MarginRailGeometry::valid)
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MarginRailRoom {
    Rail,
    #[default]
    Dock,
}
#[derive(Clone, Debug, PartialEq)]
pub struct MarginRailCard {
    pub target: CommentRef,
    pub top: f32,
    pub height: f32,
}
pub fn stack_margin_cards(
    cards: &[MarginRailCard],
    obstacles: &[MarginRailObstacle],
    gap: f32,
) -> HashMap<CommentRef, f32> {
    let mut placed = obstacles
        .iter()
        .copied()
        .filter(|o| o.top.is_finite() && o.height.is_finite() && o.height >= 0.)
        .collect::<Vec<_>>();
    let mut sorted = cards
        .iter()
        .filter(|card| card.top.is_finite() && card.height.is_finite() && card.height >= 0.)
        .collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.top.total_cmp(&b.top));
    let mut result = HashMap::new();
    for card in sorted {
        let mut top = card.top.max(0.);
        loop {
            let previous = top;
            for block in &placed {
                if top < block.top + block.height + gap && top + card.height + gap > block.top {
                    top = block.top + block.height + gap;
                }
            }
            if top == previous {
                break;
            }
        }
        placed.push(MarginRailObstacle {
            top,
            height: card.height,
        });
        result.insert(card.target.clone(), top);
    }
    result
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarginRailLayout {
    pub room: MarginRailRoom,
    pub cards: Vec<MarginRailCard>,
    pub dock_bottom: f32,
    pub more: usize,
    pub slot: Option<(CommentRef, MarginRailSlot)>,
}
pub fn layout_margin_notes(
    snapshot: &MarginRailSnapshot,
    dismissed: &HashSet<CommentRef>,
    heights: &HashMap<CommentRef, f32>,
    expanded: bool,
) -> MarginRailLayout {
    let mut result = MarginRailLayout::default();
    if !snapshot.available() {
        return result;
    }
    let geometry = snapshot.geometry.as_ref().unwrap();
    result.room = geometry.room();
    result.dock_bottom = (geometry.viewport_height - geometry.scroller.bottom() + 12.).max(16.);
    let admitted =
        |target: &CommentRef| snapshot.anchor(target).is_some() && !dismissed.contains(target);
    let mut targets = if snapshot.enabled && expanded {
        snapshot
            .notes
            .iter()
            .map(|note| note.target.clone())
            .collect()
    } else if snapshot.enabled {
        snapshot.visible.clone()
    } else {
        Vec::new()
    };
    for target in [
        snapshot.peek.as_ref(),
        snapshot.open_thread.as_ref().map(|thread| &thread.target),
    ]
    .into_iter()
    .flatten()
    {
        if !targets.contains(target) {
            targets.push(target.clone());
        }
    }
    targets.retain(|target| {
        admitted(target) && snapshot.notes.iter().any(|note| &note.target == target)
    });
    let open = snapshot.open_thread.as_ref().filter(|thread| {
        snapshot.anchor(&thread.target).is_some() && thread.anchor_top.is_finite()
    });
    let mut obstacles = geometry.obstacles.clone();
    let cardless = open
        .filter(|thread| !targets.contains(&thread.target))
        .map(|thread| {
            let target = thread.target.clone();
            let top = snapshot
                .anchor(&target)
                .and_then(|anchor| {
                    anchor
                        .groups
                        .iter()
                        .flatten()
                        .find(|rect| rect.valid() && rect.width > 1. && rect.height > 1.)
                })
                .map_or(thread.anchor_top, |rect| rect.top)
                - geometry.canvas.top;
            let height = thread
                .height
                .filter(|height| height.is_finite() && *height > 0.)
                .unwrap_or(280.);
            let top = stack_margin_cards(
                &[MarginRailCard {
                    target: target.clone(),
                    top,
                    height,
                }],
                &obstacles,
                10.,
            )[&target];
            obstacles.push(MarginRailObstacle { top, height });
            (target, top)
        });
    let cards = targets
        .into_iter()
        .map(|target| {
            let anchor = snapshot.anchor(&target).unwrap();
            let first = anchor
                .groups
                .iter()
                .flatten()
                .find(|rect| rect.valid() && rect.width > 1. && rect.height > 1.);
            let top = first
                .map(|rect| rect.top)
                .or(geometry.cursor_top.filter(|top| top.is_finite()))
                .unwrap_or(geometry.canvas.top)
                - geometry.canvas.top
                - 4.;
            let height = if let Some(thread) = open.filter(|thread| thread.target == target) {
                thread
                    .height
                    .filter(|height| height.is_finite() && *height > 0.)
                    .unwrap_or(280.)
            } else {
                heights
                    .get(&target)
                    .copied()
                    .filter(|height| height.is_finite() && *height > 0.)
                    .unwrap_or(120.)
            };
            MarginRailCard {
                target,
                top,
                height,
            }
        })
        .collect::<Vec<_>>();
    let tops = stack_margin_cards(&cards, &obstacles, 10.);
    result.cards = cards
        .into_iter()
        .map(|mut card| {
            card.top = tops[&card.target];
            card
        })
        .collect();
    result.more = result
        .cards
        .len()
        .saturating_add(if snapshot.enabled && !expanded {
            snapshot.held
        } else {
            0
        })
        .saturating_sub(1);
    if let Some(thread) = open
        && snapshot.enabled
    {
        let top = result
            .cards
            .iter()
            .find(|card| card.target == thread.target)
            .map(|card| card.top)
            .or(cardless.as_ref().map(|(_, top)| *top));
        if let Some(top) = top {
            let slot = if result.room == MarginRailRoom::Rail {
                let width = (geometry.scroller.right() - geometry.canvas.right() - 28. - 12.)
                    .clamp(268., 340.)
                    .round();
                let y = (geometry.canvas.top + top)
                    .max(geometry.scroller.top + 8.)
                    .min(geometry.viewport_height - 180.)
                    .round();
                MarginRailSlot {
                    left: (geometry.canvas.right() + 28.).round(),
                    top: y,
                    width,
                    max_h: (geometry.viewport_height - y - 12.).round().max(180.),
                }
            } else {
                let y = (geometry.scroller.top + 8.)
                    .max(geometry.canvas.top + top)
                    .min(geometry.viewport_height - 220.)
                    .max(12.);
                MarginRailSlot {
                    left: 12.,
                    top: y,
                    width: 340_f32.min(geometry.viewport_width - 24.),
                    max_h: (geometry.viewport_height - y - 12.).max(160.),
                }
            };
            result.slot = Some((thread.target.clone(), slot));
        }
    }
    result
}

#[derive(Clone, Debug, PartialEq)]
pub struct MarginRailConnection {
    pub target: CommentRef,
    pub primary: bool,
    pub marks: Vec<MarginRailRect>,
    pub bracket: [[f32; 2]; 4],
    pub line: Option<[[f32; 2]; 4]>,
}
/// Source connection geometry, from supplied real ID-scoped line rectangles.
pub fn margin_rail_connections(
    snapshot: &MarginRailSnapshot,
    layout: &MarginRailLayout,
    focus: Option<&CommentRef>,
) -> Vec<MarginRailConnection> {
    if !snapshot.available() {
        return Vec::new();
    }
    let Some(focus) =
        focus.filter(|target| layout.cards.iter().any(|card| &card.target == *target))
    else {
        return Vec::new();
    };
    let Some(focused_note) = snapshot.notes.iter().find(|note| &note.target == focus) else {
        return Vec::new();
    };
    let geometry = snapshot.geometry.as_ref().unwrap();
    let mut result = Vec::new();
    for card in &layout.cards {
        let Some(note) = snapshot
            .notes
            .iter()
            .find(|note| note.target == card.target)
        else {
            continue;
        };
        if &card.target != focus && note.anchor_quote != focused_note.anchor_quote {
            continue;
        }
        let Some(anchor) = snapshot.anchor(&card.target) else {
            continue;
        };
        for group in &anchor.groups {
            let rects = group
                .iter()
                .copied()
                .filter(|rect| rect.valid() && rect.width > 1. && rect.height > 1.)
                .collect::<Vec<_>>();
            if rects.is_empty() {
                continue;
            }
            let top = rects
                .iter()
                .map(|rect| rect.top)
                .fold(f32::INFINITY, f32::min);
            let bottom = rects
                .iter()
                .map(|rect| rect.bottom())
                .fold(f32::NEG_INFINITY, f32::max);
            let bx = geometry.text.right() + 10.;
            let primary = &card.target == focus;
            let mid = (top + bottom) / 2.;
            let card_x = geometry.canvas.right() + 28.;
            let card_y = geometry.canvas.top + card.top + 20.;
            result.push(MarginRailConnection {
                target: card.target.clone(),
                primary,
                marks: if primary {
                    rects
                        .into_iter()
                        .map(|rect| MarginRailRect {
                            left: rect.left - 1.,
                            top: rect.bottom() - 3.,
                            width: rect.width + 2.,
                            height: 3.,
                        })
                        .collect()
                } else {
                    Vec::new()
                },
                bracket: [[bx - 5., top], [bx, top], [bx, bottom], [bx - 5., bottom]],
                line: (layout.room == MarginRailRoom::Rail).then_some([
                    [card_x, card_y],
                    [card_x - 36., card_y],
                    [bx + 36., mid],
                    [bx + 3., mid],
                ]),
            });
        }
    }
    result
}

/// The source clips UTF-16 units before trimEnd. Only the rendered preview is
/// clipped: MarginRailNote retains every byte of the full body/reply.
pub fn clip_margin_preview(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.into();
    }
    let units = text
        .encode_utf16()
        .take(limit.saturating_add(1))
        .collect::<Vec<_>>();
    if units.len() <= limit {
        return text.into();
    }
    format!(
        "{}…",
        String::from_utf16_lossy(&units[..limit.saturating_sub(1)])
            .trim_end_matches(is_js_whitespace)
    )
}
fn collapsed_preview(text: &str) -> String {
    // Ordinary HTML whitespace only; nonbreaking space remains meaningful.
    let mut result = String::new();
    let mut space = false;
    for ch in text.chars() {
        if matches!(ch, ' ' | '\t' | '\n' | '\r' | '\u{000c}') {
            space = true;
        } else {
            if space && !result.is_empty() {
                result.push(' ');
            }
            result.push(ch);
            space = false;
        }
    }
    result
}

#[cfg(feature = "desktop")]
mod native {
    use super::*;
    use crate::{
        assets::{self, TwyneIcon},
        theme::{self, DISPLAY_FONT, SERIF_FONT, TYPEWRITER_FONT},
    };
    use gpui_kit::component::Sizable;
    use gpui_kit::prelude::*;
    use gpui_kit::{
        AnyElement, Bounds, BoxShadow, Context, EventEmitter, FocusHandle, FontWeight, PathBuilder,
        Render, SharedString, Subscription, TestSupportExt, Window, canvas, div, fill, point, px,
        rgb, size,
    };
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct MarginRailCapabilities {
        pub open_threads: bool,
        pub dismiss: bool,
    }
    #[derive(Clone, Debug, PartialEq)]
    pub enum MarginRailEvent {
        OpenThread {
            target: CommentRef,
            slot: Option<MarginRailSlot>,
        },
        SetAside(CommentRef),
        SlotChanged {
            target: CommentRef,
            slot: Option<MarginRailSlot>,
        },
    }
    pub struct MarginRailView {
        snapshot: MarginRailSnapshot,
        capabilities: MarginRailCapabilities,
        dismissed: HashSet<CommentRef>,
        expanded: bool,
        hovered: Option<CommentRef>,
        focused: Option<CommentRef>,
        focus_handles: HashMap<CommentRef, FocusHandle>,
        subscriptions: Vec<Subscription>,
        heights: Arc<Mutex<HashMap<CommentRef, f32>>>,
        last_slot: Option<(CommentRef, MarginRailSlot)>,
        previews: HashMap<CommentRef, Arc<RenderedNote>>,
    }
    struct RenderedNote {
        target: CommentRef,
        title: String,
        body: String,
        reply: Option<MarginRailReply>,
        reply_count: usize,
    }
    fn rendered_notes(notes: &[MarginRailNote]) -> HashMap<CommentRef, Arc<RenderedNote>> {
        notes
            .iter()
            .map(|note| {
                (
                    note.target.clone(),
                    Arc::new(RenderedNote {
                        target: note.target.clone(),
                        title: note.title.clone(),
                        body: collapsed_preview(&clip_margin_preview(&note.body, 280)),
                        reply: note.reply.as_ref().map(|reply| MarginRailReply {
                            author: reply.author.clone(),
                            text: collapsed_preview(&clip_margin_preview(&reply.text, 420)),
                        }),
                        reply_count: note.reply_count,
                    }),
                )
            })
            .collect()
    }
    impl EventEmitter<MarginRailEvent> for MarginRailView {}
    impl MarginRailView {
        pub fn new(
            snapshot: MarginRailSnapshot,
            capabilities: MarginRailCapabilities,
            _: &mut Context<Self>,
        ) -> Self {
            let previews = rendered_notes(&snapshot.notes);
            Self {
                snapshot,
                capabilities,
                dismissed: HashSet::new(),
                expanded: false,
                hovered: None,
                focused: None,
                focus_handles: HashMap::new(),
                subscriptions: Vec::new(),
                heights: Arc::new(Mutex::new(HashMap::new())),
                last_slot: None,
                previews,
            }
        }
        pub fn snapshot(&self) -> &MarginRailSnapshot {
            &self.snapshot
        }
        pub fn dismissed(&self) -> &HashSet<CommentRef> {
            &self.dismissed
        }
        pub fn set_snapshot(&mut self, snapshot: MarginRailSnapshot, cx: &mut Context<Self>) {
            if snapshot.folio_id != self.snapshot.folio_id {
                self.dismissed.clear();
                self.hovered = None;
                self.focused = None;
                self.expanded = false;
                self.focus_handles.clear();
                self.subscriptions.clear();
                self.heights.lock().unwrap().clear();
                self.last_slot = None;
            }
            if snapshot.mode != self.snapshot.mode
                && !matches!(snapshot.mode, FlowMode::Working | FlowMode::Stuck)
            {
                self.expanded = false;
            }
            if snapshot == self.snapshot {
                return;
            }
            self.previews = rendered_notes(&snapshot.notes);
            self.snapshot = snapshot;
            self.publish_slot(cx);
            cx.notify();
        }
        pub fn set_presentation(
            &mut self,
            presentation: MarginRailPresentation,
            cx: &mut Context<Self>,
        ) {
            if self.snapshot.visible == presentation.visible
                && self.snapshot.held == presentation.held
                && self.snapshot.enabled == presentation.enabled
                && self.snapshot.mode == presentation.mode
                && self.snapshot.zen == presentation.zen
                && self.snapshot.read_only == presentation.read_only
                && self.snapshot.foreground_open == presentation.foreground_open
                && self.snapshot.anchors == presentation.anchors
                && self.snapshot.geometry == presentation.geometry
                && self.snapshot.peek == presentation.peek
                && self.snapshot.open_thread == presentation.open_thread
            {
                return;
            }
            if presentation.mode != self.snapshot.mode
                && !matches!(presentation.mode, FlowMode::Working | FlowMode::Stuck)
            {
                self.expanded = false;
            }
            self.snapshot.visible = presentation.visible;
            self.snapshot.held = presentation.held;
            self.snapshot.enabled = presentation.enabled;
            self.snapshot.mode = presentation.mode;
            self.snapshot.zen = presentation.zen;
            self.snapshot.read_only = presentation.read_only;
            self.snapshot.foreground_open = presentation.foreground_open;
            self.snapshot.anchors = presentation.anchors;
            self.snapshot.geometry = presentation.geometry;
            self.snapshot.peek = presentation.peek;
            self.snapshot.open_thread = presentation.open_thread;
            self.publish_slot(cx);
            cx.notify();
        }
        pub fn set_capabilities(
            &mut self,
            capabilities: MarginRailCapabilities,
            cx: &mut Context<Self>,
        ) {
            if self.capabilities != capabilities {
                self.capabilities = capabilities;
                cx.notify();
            }
        }
        pub fn set_peek(&mut self, target: Option<CommentRef>, cx: &mut Context<Self>) {
            if self.snapshot.peek != target {
                self.snapshot.peek = target;
                self.publish_slot(cx);
                cx.notify();
            }
        }
        pub fn set_open_thread(
            &mut self,
            thread: Option<MarginRailOpenThread>,
            cx: &mut Context<Self>,
        ) {
            if let Some(thread) = &thread {
                self.dismissed.remove(&thread.target);
            }
            if self.snapshot.open_thread != thread {
                self.snapshot.open_thread = thread;
                self.publish_slot(cx);
                cx.notify();
            }
        }
        pub fn layout(&self) -> MarginRailLayout {
            layout_margin_notes(
                &self.snapshot,
                &self.dismissed,
                &self.heights.lock().unwrap(),
                self.expanded,
            )
        }
        pub fn slot(&self, target: &CommentRef) -> Option<MarginRailSlot> {
            self.layout()
                .slot
                .filter(|(id, _)| id == target)
                .map(|(_, slot)| slot)
        }
        pub fn reveal(
            &mut self,
            target: &CommentRef,
            anchor_top: f32,
            cx: &mut Context<Self>,
        ) -> Option<MarginRailSlot> {
            if !self.snapshot.available()
                || !self.snapshot.enabled
                || !anchor_top.is_finite()
                || self.snapshot.anchor(target).is_none()
                || self.snapshot.geometry.as_ref()?.room() != MarginRailRoom::Rail
            {
                return None;
            }
            self.dismissed.remove(target);
            self.snapshot.open_thread = Some(MarginRailOpenThread {
                target: target.clone(),
                anchor_top,
                height: None,
            });
            self.publish_slot(cx);
            cx.notify();
            self.slot(target)
        }
        fn publish_slot(&mut self, cx: &mut Context<Self>) {
            let next = self.layout().slot;
            if self.last_slot == next {
                return;
            }
            if let Some((target, slot)) = &next {
                cx.emit(MarginRailEvent::SlotChanged {
                    target: target.clone(),
                    slot: Some(*slot),
                });
            } else if let Some((target, _)) = &self.last_slot {
                cx.emit(MarginRailEvent::SlotChanged {
                    target: target.clone(),
                    slot: None,
                });
            }
            self.last_slot = next;
        }
        fn set_aside(&mut self, target: CommentRef, cx: &mut Context<Self>) {
            if !self.capabilities.dismiss || self.snapshot.anchor(&target).is_none() {
                return;
            }
            self.dismissed.insert(target.clone());
            if self.hovered.as_ref() == Some(&target) {
                self.hovered = None;
            }
            if self.focused.as_ref() == Some(&target) {
                self.focused = None;
            }
            cx.emit(MarginRailEvent::SetAside(target));
            cx.notify();
        }
        fn card(
            &mut self,
            note: &RenderedNote,
            top: f32,
            left: f32,
            width: f32,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) -> AnyElement {
            let p = *theme::palette(cx);
            let target = note.target.clone();
            let focus = if let Some(focus) = self.focus_handles.get(&target) {
                focus.clone()
            } else {
                let focus = cx.focus_handle();
                let on_focus = target.clone();
                let on_blur = target.clone();
                self.subscriptions
                    .push(cx.on_focus_in(&focus, window, move |this, _, cx| {
                        this.focused = Some(on_focus.clone());
                        cx.notify();
                    }));
                self.subscriptions
                    .push(cx.on_focus_out(&focus, window, move |this, _, _, cx| {
                        if this.focused.as_ref() == Some(&on_blur) {
                            this.focused = None;
                            cx.notify();
                        }
                    }));
                self.focus_handles.insert(target.clone(), focus.clone());
                focus
            };
            let hovered = self.hovered.as_ref() == Some(&target)
                || self.focused.as_ref() == Some(&target)
                || self.snapshot.peek.as_ref() == Some(&target);
            let hover_target = target.clone();
            let open_target = target.clone();
            let aside_target = target.clone();
            let body = gpui_kit::base::Button::new(SharedString::from(format!(
                "margin-rail-open-{}-{}",
                target.folio_id, target.id
            )))
            .accessibility_label("Open the conversation")
            .disabled(!self.capabilities.open_threads)
            .w_full()
            .p_0()
            .flex_col()
            .items_start()
            .gap(px(4.))
            .font_family(SERIF_FONT)
            .font_weight(FontWeight::NORMAL)
            .text_size(px(13.44))
            .line_height(px(20.16))
            .child(
                div()
                    .w_full()
                    .font_family(DISPLAY_FONT)
                    .font_weight(FontWeight::BOLD)
                    .text_size(px(13.76))
                    .line_height(px(17.888))
                    .child(note.title.clone()),
            )
            .when(!note.body.is_empty(), |body| {
                body.child(
                    div()
                        .w_full()
                        .text_color(rgb(p.ink_light))
                        .child(note.body.clone()),
                )
            })
            .on_click(cx.listener(move |this, _, _, cx| {
                if !this.capabilities.open_threads
                    || !this.snapshot.available()
                    || this.snapshot.anchor(&open_target).is_none()
                {
                    return;
                }
                let mut preview = this.snapshot.clone();
                let anchor_top = preview
                    .anchor(&open_target)
                    .and_then(|anchor| anchor.groups.iter().flatten().next())
                    .map(|rect| rect.top)
                    .unwrap_or_else(|| preview.geometry.as_ref().unwrap().canvas.top);
                preview.open_thread = Some(MarginRailOpenThread {
                    target: open_target.clone(),
                    anchor_top,
                    height: None,
                });
                let slot = if preview.enabled
                    && preview.geometry.as_ref().unwrap().room() == MarginRailRoom::Rail
                {
                    layout_margin_notes(
                        &preview,
                        &this.dismissed,
                        &this.heights.lock().unwrap(),
                        this.expanded,
                    )
                    .slot
                    .map(|(_, slot)| slot)
                } else {
                    None
                };
                cx.emit(MarginRailEvent::OpenThread {
                    target: open_target.clone(),
                    slot,
                });
                cx.stop_propagation();
            }));
            let measured = self.heights.clone();
            let measure_target = target.clone();
            let weak = cx.weak_entity();
            let card = div()
                .id(SharedString::from(format!(
                    "margin-rail-card-{}-{}",
                    target.folio_id, target.id
                )))
                .test_support()
                .track_focus(&focus)
                .occlude()
                .on_mouse_down(gpui_kit::MouseButton::Left, |_, _, cx| {
                    cx.stop_propagation()
                })
                .on_mouse_up(gpui_kit::MouseButton::Left, |_, _, cx| {
                    cx.stop_propagation()
                })
                .relative()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(7.2))
                .pt(px(10.4))
                .px(px(12.))
                .pb(px(9.6))
                .border_1()
                .border_t(px(3.))
                .border_color(rgb(p.rule))
                .rounded(px(1.))
                .bg(rgb(p.paper))
                .text_color(rgb(p.ink))
                .font_family(SERIF_FONT)
                .font_weight(FontWeight::NORMAL)
                .text_size(px(13.44))
                .line_height(px(20.16))
                .shadow(vec![
                    BoxShadow::new(px(0.), px(1.), rgb(p.rule).into()),
                    BoxShadow::new(
                        px(0.),
                        px(if hovered { 14. } else { 10. }),
                        rgb(0).opacity(if hovered { 0.5 } else { 0.45 }).into(),
                    )
                    .blur_radius(px(if hovered { 28. } else { 22. }))
                    .spread_radius(px(if hovered { -16. } else { -18. })),
                ])
                .on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
                    if *hovering {
                        this.hovered = Some(hover_target.clone());
                    } else if this.hovered.as_ref() == Some(&hover_target) {
                        this.hovered = None;
                    }
                    cx.notify();
                }))
                .child(
                    div()
                        .flex()
                        .items_start()
                        .justify_between()
                        .gap(px(8.))
                        .child(div().mt(px(7.)).child(crate::chrome::tracked_text(
                            "MARGIN NOTE",
                            gpui_kit::font(TYPEWRITER_FONT),
                            9.92,
                            0.7936,
                            p.writer_note,
                            11.904,
                        )))
                        .child(
                            gpui_kit::base::Button::new(SharedString::from(format!(
                                "margin-rail-aside-{}-{}",
                                target.folio_id, target.id
                            )))
                            .accessibility_label("Set this aside")
                            .disabled(!self.capabilities.dismiss)
                            .p_0()
                            .w(px(14.))
                            .h(px(18.8))
                            .opacity(if hovered { 1. } else { 0. })
                            .text_color(rgb(p.ink_muted))
                            .hover(|button| button.text_color(rgb(p.vermilion)))
                            .child(assets::icon(TwyneIcon::CloseCircle).with_size(px(14.)))
                            .on_click(cx.listener(
                                move |this, _, _, cx| {
                                    this.set_aside(aside_target.clone(), cx);
                                    cx.stop_propagation();
                                },
                            )),
                        ),
                )
                .child(body)
                .when_some(
                    note.reply.as_ref().filter(|reply| !reply.text.is_empty()),
                    |card, reply| {
                        card.child(
                            div()
                                .pt(px(7.2))
                                .pl(px(9.6))
                                .border_l_1()
                                .border_color(rgb(p.writer_note))
                                .child(crate::chrome::tracked_text(
                                    &reply.author.to_uppercase(),
                                    gpui_kit::font(TYPEWRITER_FONT),
                                    9.6,
                                    0.768,
                                    p.ink_muted,
                                    12.48,
                                ))
                                .child(div().italic().child(reply.text.clone())),
                        )
                    },
                )
                .when(note.reply_count > 0, |card| {
                    card.child(
                        div()
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(9.92))
                            .line_height(px(12.896))
                            .text_color(rgb(p.ink_muted))
                            .child(format!(
                                "{} {}",
                                note.reply_count,
                                if note.reply_count == 1 {
                                    "reply"
                                } else {
                                    "replies"
                                }
                            )),
                    )
                })
                .child(
                    canvas(
                        move |bounds, window, _| {
                            // Absolute size_full measures the card's padding
                            // box. Include its actual top3 + bottom1 borders in
                            // the reservation used by the source stacker.
                            let height = f32::from(bounds.size.height) + 4.;
                            let mut heights = measured.lock().unwrap();
                            if height > 0.
                                && heights
                                    .get(&measure_target)
                                    .is_none_or(|old| (*old - height).abs() > 0.01)
                            {
                                heights.insert(measure_target.clone(), height);
                                let weak = weak.clone();
                                window.on_next_frame(move |_, cx| {
                                    let _ = weak.update(cx, |view, cx| {
                                        view.publish_slot(cx);
                                        cx.notify();
                                    });
                                });
                            }
                        },
                        |_, (), _, _| {},
                    )
                    .absolute()
                    .inset_0()
                    .size_full(),
                )
                .into_any_element();
            // GPUI masks descendants to the bordered box. Paint the source's
            // accent border from the positioned, borderless wrapper so it
            // covers the existing top3 rule pixels without moving the content.
            div()
                .absolute()
                .left(px(left))
                .top(px(top - if hovered { 1. } else { 0. }))
                .w(px(width))
                .child(card)
                .child(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .top_0()
                        .h(px(3.))
                        .bg(rgb(p.writer_note)),
                )
                .into_any_element()
        }
    }
    impl Render for MarginRailView {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let layout = self.layout();
            let mut root = div()
                .id("margin-rail-surface")
                .test_support()
                .absolute()
                .inset_0()
                .size_full();
            if !self.snapshot.available() {
                return root;
            }
            let geometry = self.snapshot.geometry.clone().unwrap();
            let p = *theme::palette(cx);
            let hidden_target = self
                .snapshot
                .open_thread
                .as_ref()
                .map(|thread| &thread.target)
                .cloned();
            let opacity = if self.snapshot.mode == FlowMode::Settling {
                0.4
            } else {
                1.
            };
            let focus = self
                .hovered
                .as_ref()
                .or(self.focused.as_ref())
                .or(self.snapshot.peek.as_ref())
                .or(self
                    .snapshot
                    .open_thread
                    .as_ref()
                    .map(|thread| &thread.target));
            let connections = margin_rail_connections(&self.snapshot, &layout, focus);
            if !connections.is_empty() {
                let scroller = geometry.scroller;
                root = root.child(
                    div()
                        .absolute()
                        .left(px(scroller.left))
                        .top(px(scroller.top))
                        .w(px(scroller.width))
                        .h(px(scroller.height))
                        .overflow_hidden()
                        .child(
                            canvas(
                                |_, _, _| {},
                                move |bounds, (), window, _| {
                                    let coord = |p: [f32; 2]| {
                                        bounds.origin
                                            + point(
                                                px(p[0] - scroller.left),
                                                px(p[1] - scroller.top),
                                            )
                                    };
                                    for connection in &connections {
                                        for rect in &connection.marks {
                                            window.paint_quad(fill(
                                                Bounds::new(
                                                    coord([rect.left, rect.top]),
                                                    size(px(rect.width), px(rect.height)),
                                                ),
                                                rgb(p.writer_note).opacity(0.45 * opacity),
                                            ));
                                        }
                                        let mut bracket = PathBuilder::stroke(px(1.25));
                                        bracket.move_to(coord(connection.bracket[0]));
                                        for p in connection.bracket.iter().skip(1) {
                                            bracket.line_to(coord(*p));
                                        }
                                        if let Ok(path) = bracket.build() {
                                            window.paint_path(
                                                path,
                                                rgb(p.writer_note).opacity(0.8 * opacity),
                                            );
                                        }
                                        if let Some(line) = connection.line {
                                            let mut path = PathBuilder::stroke(px(1.25));
                                            if !connection.primary {
                                                path = path.dash_array(&[px(3.), px(4.)]);
                                            }
                                            path.move_to(coord(line[0]));
                                            path.cubic_bezier_to(
                                                coord(line[3]),
                                                coord(line[1]),
                                                coord(line[2]),
                                            );
                                            if let Ok(path) = path.build() {
                                                window.paint_path(
                                                    path,
                                                    rgb(p.writer_note).opacity(
                                                        if connection.primary {
                                                            0.8 * opacity
                                                        } else {
                                                            0.55 * opacity
                                                        },
                                                    ),
                                                );
                                            }
                                        }
                                    }
                                },
                            )
                            .absolute()
                            .size_full(),
                        ),
                );
            }
            if layout.room == MarginRailRoom::Rail {
                let mut rail = div()
                    .id("margin-rail-room")
                    .test_support()
                    .absolute()
                    .left(px(geometry.scroller.left))
                    .top(px(geometry.scroller.top))
                    .w(px(geometry.scroller.width))
                    .h(px(geometry.scroller.height))
                    .overflow_hidden()
                    .opacity(opacity);
                for card in &layout.cards {
                    if hidden_target.as_ref() == Some(&card.target) {
                        continue;
                    }
                    if let Some(note) = self.previews.get(&card.target).cloned() {
                        rail = rail.child(self.card(
                            &note,
                            geometry.canvas.top + card.top - geometry.scroller.top,
                            geometry.canvas.right() + 28. - geometry.scroller.left,
                            268.,
                            window,
                            cx,
                        ));
                    }
                }
                if self.snapshot.enabled && (self.snapshot.held > 0 || self.expanded) {
                    let waiting_label = if self.expanded {
                        "Fewer".to_owned()
                    } else {
                        format!("{} more in the margin", self.snapshot.held)
                    };
                    let top = layout
                        .cards
                        .iter()
                        .map(|card| card.top + 140.)
                        .fold(0_f32, f32::max);
                    rail = rail.child(
                        gpui_kit::base::Button::new("margin-rail-waiting")
                            .accessibility_label(waiting_label.clone())
                            .absolute()
                            .left(px(geometry.canvas.right() + 28. - geometry.scroller.left))
                            .top(px(geometry.canvas.top + top - geometry.scroller.top))
                            .px(px(8.8))
                            .py(px(3.2))
                            .border_1()
                            .border_dashed()
                            .border_color(rgb(p.rule))
                            .rounded(px(999.))
                            .bg(rgb(p.paper))
                            .text_color(rgb(p.ink_muted))
                            .hover(|button| {
                                let mut style = button.text_color(rgb(p.ink));
                                style.border_style = Some(gpui_kit::BorderStyle::Solid);
                                style
                            })
                            .child(crate::chrome::tracked_text(
                                &waiting_label,
                                gpui_kit::font(TYPEWRITER_FONT),
                                10.24,
                                0.512,
                                p.ink_muted,
                                15.36,
                            ))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.expanded = !this.expanded;
                                this.publish_slot(cx);
                                cx.notify();
                                cx.stop_propagation();
                            })),
                    );
                }
                root = root.child(rail);
            } else if !self.snapshot.foreground_open
                && let Some(card) = layout
                    .cards
                    .first()
                    .filter(|card| hidden_target.as_ref() != Some(&card.target))
                && let Some(note) = self.previews.get(&card.target).cloned()
            {
                let width = 300_f32.min((geometry.viewport_width - 32.).max(0.));
                let more_height = if layout.more > 0 { 19.68 } else { 0. };
                root = root.child(
                    div()
                        .id("margin-rail-dock")
                        .test_support()
                        .absolute()
                        .inset_0()
                        .size_full()
                        .opacity(opacity)
                        .child(self.card(
                            &note,
                            geometry.viewport_height
                                - layout.dock_bottom
                                - card.height
                                - more_height,
                            geometry.viewport_width - 16. - width,
                            width,
                            window,
                            cx,
                        ))
                        .when(layout.more > 0, |dock| {
                            dock.child(
                                div()
                                    .absolute()
                                    .right(px(16.))
                                    .bottom(px(layout.dock_bottom))
                                    .font_family(TYPEWRITER_FONT)
                                    .text_size(px(9.92))
                                    .line_height(px(14.88))
                                    .text_color(rgb(p.ink_muted))
                                    .child(format!("{} more when there's room", layout.more)),
                            )
                        }),
                );
            }
            root
        }
    }

    #[cfg(all(test, feature = "ui-tests"))]
    mod interaction {
        use super::*;
        use crate::marginalia::parse_marginalia_json;
        use gpui_kit::test::TestWindowExt;
        use gpui_kit::{
            AnyWindowHandle, App, AppContext, Entity, TestAppContext, WindowBounds, WindowOptions,
        };

        const FOLIO: &str = "twyne-gpui-parity";
        const NOTE: &str = "ee1a4fcc-a91b-4be9-8063-116e211e4496";
        const CARD: &str =
            "margin-rail-card-twyne-gpui-parity-ee1a4fcc-a91b-4be9-8063-116e211e4496";
        const OPEN: &str =
            "margin-rail-open-twyne-gpui-parity-ee1a4fcc-a91b-4be9-8063-116e211e4496";
        const ASIDE: &str =
            "margin-rail-aside-twyne-gpui-parity-ee1a4fcc-a91b-4be9-8063-116e211e4496";

        type RailHarness = (
            AnyWindowHandle,
            Entity<MarginRailView>,
            Arc<Mutex<usize>>,
            Arc<Mutex<Vec<MarginRailEvent>>>,
        );

        fn target() -> CommentRef {
            CommentRef {
                folio_id: FOLIO.into(),
                id: NOTE.into(),
            }
        }
        fn fixture(rail: bool) -> MarginRailSnapshot {
            let record = parse_marginalia_json(include_bytes!(
                "../fixtures/marginalia/browser-comments.json"
            ))
            .unwrap();
            let notes = record
                .comments
                .iter()
                .filter_map(MarginRailNote::from_comment)
                .collect::<Vec<_>>();
            assert_eq!(notes.len(), 1);
            assert_eq!(notes[0].target, target());
            MarginRailSnapshot {
                folio_id: Some(FOLIO.into()),
                visible: vec![target()],
                enabled: true,
                anchors: Some(vec![MarginRailAnchor {
                    target: target(),
                    groups: vec![vec![MarginRailRect {
                        left: 128.,
                        top: 280.,
                        width: 180.,
                        height: 24.,
                    }]],
                }]),
                geometry: Some(MarginRailGeometry {
                    viewport_width: 1280.,
                    viewport_height: 860.,
                    canvas: MarginRailRect {
                        left: if rail { 64. } else { 256. },
                        top: 180.,
                        width: if rail { 704. } else { 768. },
                        height: 1200.,
                    },
                    scroller: MarginRailRect {
                        left: 0.,
                        top: 160.,
                        width: 1280.,
                        height: 667.,
                    },
                    text: MarginRailRect {
                        left: if rail { 96. } else { 288. },
                        top: 196.,
                        width: if rail { 640. } else { 704. },
                        height: 1000.,
                    },
                    cursor_top: Some(280.),
                    obstacles: Vec::new(),
                }),
                notes,
                ..Default::default()
            }
        }
        struct Room {
            rail: Entity<MarginRailView>,
            background_clicks: Arc<Mutex<usize>>,
        }
        impl Render for Room {
            fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
                div()
                    .relative()
                    .size_full()
                    .bg(rgb(theme::palette(cx).paper))
                    .child(
                        gpui_kit::base::Button::new("rail-background")
                            .size_full()
                            .p_0()
                            .child("Manuscript")
                            .on_click(cx.listener(|this, _, _, _| {
                                *this.background_clicks.lock().unwrap() += 1
                            })),
                    )
                    .child(self.rail.clone())
            }
        }
        fn room(
            cx: &mut TestAppContext,
            snapshot: MarginRailSnapshot,
            capabilities: MarginRailCapabilities,
        ) -> RailHarness {
            let hits = Arc::new(Mutex::new(0));
            let room_hits = hits.clone();
            let (handle, host) = cx.update(|cx| {
                gpui_kit::init(cx);
                theme::apply(cx).unwrap();
                gpui_kit::open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: point(px(0.), px(0.)),
                            size: size(px(1280.), px(860.)),
                        })),
                        ..Default::default()
                    },
                    cx,
                    |_, cx| {
                        cx.new(|cx| Room {
                            rail: cx.new(|cx| MarginRailView::new(snapshot, capabilities, cx)),
                            background_clicks: room_hits,
                        })
                    },
                )
                .unwrap()
            });
            let rail = cx.update(|cx| host.read(cx).rail.clone());
            let events = Arc::new(Mutex::new(Vec::new()));
            let received = events.clone();
            cx.update(|cx| {
                cx.subscribe(&rail, move |_, event: &MarginRailEvent, _| {
                    received.lock().unwrap().push(event.clone())
                })
                .detach();
            });
            cx.update_window(handle, |_, window, cx| {
                window.activate_window();
                settle(window, cx);
            })
            .unwrap();
            cx.run_until_parked(); // Activate retained native focus subscriptions.
            (handle, rail, hits, events)
        }
        fn settle(window: &mut Window, cx: &mut App) {
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
        fn capabilities() -> MarginRailCapabilities {
            MarginRailCapabilities {
                open_threads: true,
                dismiss: true,
            }
        }
        fn presentation(snapshot: &MarginRailSnapshot) -> MarginRailPresentation {
            MarginRailPresentation {
                visible: snapshot.visible.clone(),
                held: snapshot.held,
                enabled: snapshot.enabled,
                mode: snapshot.mode,
                zen: snapshot.zen,
                read_only: snapshot.read_only,
                foreground_open: snapshot.foreground_open,
                anchors: snapshot.anchors.clone(),
                geometry: snapshot.geometry.clone(),
                peek: snapshot.peek.clone(),
                open_thread: snapshot.open_thread.clone(),
            }
        }

        #[gpui_kit::test]
        fn dock_open_emits_exact_scope_without_mutating_saved_notes_and_empty_overlay_is_transparent(
            cx: &mut TestAppContext,
        ) {
            let snapshot = fixture(false);
            let saved_notes = snapshot.notes.clone();
            let (handle, view, hits, events) = room(cx, snapshot, capabilities());
            cx.update_window(handle, |_, window, cx| {
                assert!(window.find(CARD).visible());
                assert_eq!(
                    view.read(cx).heights.lock().unwrap()[&target()],
                    f32::from(window.find(CARD).bounds().size.height),
                    "stacking must reserve the entire measured card, including its borders"
                );
                window.click_at("rail-background", point(px(40.), px(400.)), cx);
                window.render_frame(cx);
            })
            .unwrap();
            assert_eq!(
                *hits.lock().unwrap(),
                1,
                "empty overlay must leave manuscript input reachable"
            );
            cx.update_window(handle, |_, window, cx| {
                window.click(OPEN, cx);
                window.render_frame(cx);
                assert_eq!(view.read(cx).snapshot.notes, saved_notes);
                assert!(view.read(cx).snapshot.open_thread.is_none());
            })
            .unwrap();
            cx.update_window(handle, |_, window, cx| {
                // Header clicks are card-local too, although they are not the
                // conversation button.
                window.click_at(CARD, point(px(40.), px(14.)), cx);
            })
            .unwrap();
            cx.update_window(handle, |_, window, cx| {
                let y = window.find(CARD).bounds().size.height - px(12.);
                window.click_at(CARD, point(px(40.), y), cx);
            })
            .unwrap();
            assert_eq!(
                *hits.lock().unwrap(),
                1,
                "only the actual card rectangle occludes input"
            );
            assert_eq!(events.lock().unwrap().iter().filter(|event| matches!(event, MarginRailEvent::OpenThread { target: found, slot: None } if found == &target())).count(), 1);
        }

        #[gpui_kit::test]
        fn actual_hover_set_aside_and_mark_recall_are_transient_and_reserve_the_rail_slot(
            cx: &mut TestAppContext,
        ) {
            let snapshot = fixture(true);
            let saved_notes = snapshot.notes.clone();
            let (handle, view, _, events) = room(cx, snapshot, capabilities());
            let before = cx
                .update_window(handle, |_, window, _| window.find(CARD).bounds().top())
                .unwrap();
            cx.update_window(handle, |_, window, cx| {
                window.hover(OPEN, cx);
                window.render_frame(cx);
                assert_eq!(window.find(CARD).bounds().top(), before - px(1.));
                assert_eq!(view.read(cx).hovered, Some(target()));
                assert_eq!(
                    margin_rail_connections(
                        view.read(cx).snapshot(),
                        &view.read(cx).layout(),
                        Some(&target())
                    )
                    .len(),
                    1
                );
                window.click(ASIDE, cx);
                window.render_frame(cx);
                assert!(window.try_find(CARD).is_none());
                assert!(view.read(cx).dismissed().contains(&target()));
                assert_eq!(view.read(cx).snapshot.notes, saved_notes);
            })
            .unwrap();
            assert_eq!(
                events
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|event| **event == MarginRailEvent::SetAside(target()))
                    .count(),
                1
            );
            cx.update_window(handle, |_, window, cx| {
                view.update(cx, |view, cx| {
                    let slot = view.reveal(&target(), 280., cx).unwrap();
                    assert_eq!(slot.left, 796.);
                    assert_eq!(slot.top, 276.);
                    assert!(!view.dismissed().contains(&target()));
                    assert_eq!(view.snapshot.notes, saved_notes);
                });
                window.render_frame(cx);
                assert!(
                    window.try_find(CARD).is_none(),
                    "the actual open thread owns this slot"
                );
                view.update(cx, |view, cx| view.set_open_thread(None, cx));
                settle(window, cx);
                assert!(window.find(CARD).visible());
            })
            .unwrap();
        }

        #[gpui_kit::test]
        fn real_tab_focus_reveals_close_and_keyboard_open_keeps_metadata_unchanged(
            cx: &mut TestAppContext,
        ) {
            let snapshot = fixture(true);
            let saved_notes = snapshot.notes.clone();
            let (handle, view, _, events) = room(cx, snapshot, capabilities());
            cx.update_window(handle, |_, window, cx| {
                window.click_at("rail-background", point(px(40.), px(400.)), cx);
                window.press("tab", cx); // original invisible close button
                window.render_frame(cx);
            })
            .unwrap();
            cx.run_until_parked(); // Deliver actual native focus-in effects.
            cx.update_window(handle, |_, window, cx| {
                assert!(view.read(cx).focus_handles[&target()].contains_focused(window, cx));
                assert_eq!(view.read(cx).focused, Some(target()));
                window.press("tab", cx); // actual Open the conversation button
                window.press("enter", cx);
                window.render_frame(cx);
                assert_eq!(view.read(cx).snapshot.notes, saved_notes);
            })
            .unwrap();
            assert!(events.lock().unwrap().iter().any(|event| matches!(event, MarginRailEvent::OpenThread { target: found, slot: Some(_) } if found == &target())));
        }

        #[gpui_kit::test]
        fn real_more_and_fewer_controls_preserve_order_and_presentation_retains_cached_saved_text(
            cx: &mut TestAppContext,
        ) {
            let mut snapshot = fixture(true);
            let mut note = snapshot.notes[0].clone();
            note.target.id = "a-second-real-id".into();
            let mut anchor = snapshot.anchors.as_ref().unwrap()[0].clone();
            anchor.target = note.target.clone();
            snapshot.anchors.as_mut().unwrap().push(anchor);
            snapshot.notes.push(note);
            snapshot.held = 1;
            snapshot.notes[0].body = "retain raw full body **bytes**.\n".repeat(50_000);
            let body = snapshot.notes[0].body.clone();
            let (handle, view, _, events) = room(cx, snapshot, capabilities());
            cx.update_window(handle, |_, window, cx| {
                assert_eq!(view.read(cx).layout().cards.len(), 1);
                window.click("margin-rail-waiting", cx);
                settle(window, cx);
                assert_eq!(
                    view.read(cx)
                        .layout()
                        .cards
                        .iter()
                        .map(|card| card.target.id.as_str())
                        .collect::<Vec<_>>(),
                    [NOTE, "a-second-real-id"]
                );
                assert!(window.find("margin-rail-waiting").visible());
                window.click("margin-rail-waiting", cx);
                window.render_frame(cx);
                assert_eq!(view.read(cx).layout().cards.len(), 1);
                let cached = view.read(cx).previews[&target()].clone();
                let saved_body_pointer = view.read(cx).snapshot.notes[0].body.as_ptr();
                view.update(cx, |view, cx| {
                    let mut presentation = presentation(view.snapshot());
                    presentation.geometry.as_mut().unwrap().canvas.top -= 12.;
                    view.set_presentation(presentation, cx);
                });
                assert!(Arc::ptr_eq(&cached, &view.read(cx).previews[&target()]));
                assert_eq!(
                    view.read(cx).snapshot.notes[0].body.as_ptr(),
                    saved_body_pointer
                );
                assert_eq!(view.read(cx).snapshot.notes[0].body, body);
                assert!(cached.body.encode_utf16().count() <= 280);
            })
            .unwrap();
            assert!(
                events.lock().unwrap().is_empty(),
                "expansion and placement do not file comments"
            );
        }

        #[gpui_kit::test]
        fn unknown_or_foreign_marks_and_quiet_surfaces_hide_cards_while_explicit_disabled_peek_remains_real(
            cx: &mut TestAppContext,
        ) {
            let snapshot = fixture(false);
            let (handle, view, _, events) = room(cx, snapshot, MarginRailCapabilities::default());
            cx.update_window(handle, |_, window, cx| {
                window.click(OPEN, cx);
                window.hover(OPEN, cx);
                window.click(ASIDE, cx);
            })
            .unwrap();
            assert!(
                events.lock().unwrap().is_empty(),
                "absent capabilities must not fabricate commands"
            );
            for state in [
                "unknown",
                "foreign",
                "zen",
                "read-only",
                "flow",
                "foreground",
            ] {
                cx.update_window(handle, |_, window, cx| {
                    let mut snapshot = fixture(false);
                    match state {
                        "unknown" => snapshot.anchors = None,
                        "foreign" => {
                            snapshot.anchors.as_mut().unwrap()[0].target.folio_id = "foreign".into()
                        }
                        "zen" => snapshot.zen = true,
                        "read-only" => snapshot.read_only = true,
                        "flow" => snapshot.mode = FlowMode::Flow,
                        _ => snapshot.foreground_open = true,
                    }
                    view.update(cx, |view, cx| view.set_snapshot(snapshot, cx));
                    window.render_frame(cx);
                    assert!(window.try_find(CARD).is_none(), "{state}");
                })
                .unwrap();
            }
            cx.update_window(handle, |_, window, cx| {
                let mut snapshot = fixture(false);
                snapshot.enabled = false;
                view.update(cx, |view, cx| view.set_snapshot(snapshot, cx));
                window.render_frame(cx);
                assert!(window.try_find(CARD).is_none());
                view.update(cx, |view, cx| view.set_peek(Some(target()), cx));
                settle(window, cx);
                assert!(window.find(CARD).visible());
                view.update(cx, |view, cx| {
                    assert!(view.reveal(&target(), 280., cx).is_none())
                });
            })
            .unwrap();
        }
    }
}
#[cfg(feature = "desktop")]
pub use native::{MarginRailCapabilities, MarginRailEvent, MarginRailView};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::marginalia::parse_marginalia_json;
    use serde_json::Value;

    fn target(id: &str) -> CommentRef {
        CommentRef {
            folio_id: "web/folio:café".into(),
            id: id.into(),
        }
    }
    fn source_target(id: &Value) -> CommentRef {
        target(id.as_str().unwrap().strip_prefix("comment:").unwrap())
    }
    fn reference() -> Value {
        serde_json::from_str(include_str!(
            "../fixtures/marginalia/rail-web-reference.json"
        ))
        .unwrap()
    }
    fn fixture_note(id: &str) -> MarginRailNote {
        MarginRailNote {
            target: target(id),
            title: "You".into(),
            body: "Keep **all bytes**.\n\nNext paragraph.".into(),
            anchor_quote: "A repeated quotation".into(),
            reply: None,
            reply_count: 0,
            created_at: 100,
        }
    }
    fn snapshot() -> MarginRailSnapshot {
        let notes = vec![fixture_note("live"), fixture_note("same-quote-distinct-id")];
        MarginRailSnapshot {
            folio_id: Some("web/folio:café".into()),
            visible: notes.iter().map(|note| note.target.clone()).collect(),
            anchors: Some(
                notes
                    .iter()
                    .map(|note| MarginRailAnchor {
                        target: note.target.clone(),
                        groups: vec![vec![MarginRailRect {
                            left: 50.,
                            top: 250.,
                            width: 100.,
                            height: 24.,
                        }]],
                    })
                    .collect(),
            ),
            notes,
            enabled: true,
            geometry: Some(MarginRailGeometry {
                viewport_width: 1280.,
                viewport_height: 860.,
                canvas: MarginRailRect {
                    left: 100.,
                    top: 180.,
                    width: 704.,
                    height: 1200.,
                },
                scroller: MarginRailRect {
                    left: 0.,
                    top: 160.,
                    width: 1280.,
                    height: 667.,
                },
                text: MarginRailRect {
                    left: 132.,
                    top: 196.,
                    width: 640.,
                    height: 900.,
                },
                cursor_top: Some(280.),
                obstacles: Vec::new(),
            }),
            ..Default::default()
        }
    }
    #[test]
    fn decisions_scores_and_stable_ties_match_one_hundred_executed_web_cases() {
        let reference = reference();
        let notes = reference["notes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| MarginRailNote {
                target: source_target(&item["id"]),
                title: item["title"].as_str().unwrap().into(),
                body: item["body"].as_str().unwrap().into(),
                anchor_quote: item["anchors"][0].as_str().unwrap().into(),
                created_at: item["createdAt"].as_u64().unwrap(),
                reply: None,
                reply_count: 0,
            })
            .collect::<Vec<_>>();
        for case in reference["cases"].as_array().unwrap() {
            let context = MarginRailContext {
                mode: serde_json::from_value(case["mode"].clone()).unwrap(),
                cursor_text: case["cursorText"].as_str().unwrap().into(),
                now: case["now"].as_u64().unwrap(),
                weight: case["weight"].as_f64().unwrap(),
                working_limit: case["workingLimit"].as_u64().unwrap() as usize,
                visible_anchor_quotes: case["visibleAnchors"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap().to_owned())
                    .collect(),
                shown: case["shown"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(source_target)
                    .collect(),
                dismissed: case["dismissed"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(source_target)
                    .collect(),
            };
            let result = select_writer_notes(&notes, &context);
            assert_eq!(
                result.visible,
                case["visible"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(source_target)
                    .collect::<Vec<_>>(),
                "{case}"
            );
            assert_eq!(
                result.held,
                case["held"].as_u64().unwrap() as usize,
                "{case}"
            );
            for score in case["scores"].as_array().unwrap() {
                let note = notes
                    .iter()
                    .find(|note| note.target == source_target(&score["id"]))
                    .unwrap();
                assert!(
                    (writer_note_overlap(note, &context.cursor_text)
                        - score["overlap"].as_f64().unwrap())
                    .abs()
                        < 1e-12,
                    "{case}"
                );
                assert!(
                    (writer_note_score(note, &context) - score["score"].as_f64().unwrap()).abs()
                        < 1e-12,
                    "{case}"
                );
            }
        }
        assert_eq!(reference["cases"].as_array().unwrap().len(), 100);
    }
    #[test]
    fn collisions_and_thread_obstacles_match_executed_web_stacking() {
        for case in reference()["stackCases"].as_array().unwrap() {
            let cards = case["cards"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| MarginRailCard {
                    target: target(item["id"].as_str().unwrap()),
                    top: item["top"].as_f64().unwrap() as f32,
                    height: item["height"].as_f64().unwrap() as f32,
                })
                .collect::<Vec<_>>();
            let obstacles: Vec<MarginRailObstacle> =
                serde_json::from_value(case["obstacles"].clone()).unwrap();
            let result = stack_margin_cards(&cards, &obstacles, 10.);
            for (id, top) in case["expected"].as_object().unwrap() {
                assert_eq!(result[&target(id)], top.as_f64().unwrap() as f32, "{case}");
            }
        }
    }
    #[test]
    fn real_browser_projection_preserves_metadata_and_rejects_quote_as_mark_authority() {
        let record = parse_marginalia_json(include_bytes!(
            "../fixtures/marginalia/browser-comments.json"
        ))
        .unwrap();
        let before = record.to_web_value().unwrap();
        let notes = record
            .comments
            .iter()
            .filter_map(MarginRailNote::from_comment)
            .collect::<Vec<_>>();
        assert_eq!(notes.len(), 1); // Source UI really struck the second note.
        let original = &record.comments[0];
        assert_eq!(notes[0].target, original.reference());
        assert_eq!(notes[0].body.as_bytes(), original.text.as_bytes());
        assert_eq!(
            notes[0].reply.as_ref().unwrap().text,
            "You can keep the softened corners."
        );
        assert_eq!(notes[0].created_at, original.updated_at);
        let mut snapshot = snapshot();
        snapshot.folio_id = Some(original.folio_id.clone());
        snapshot.notes = notes.clone();
        snapshot.visible = vec![original.reference()];
        snapshot.anchors = None;
        assert!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .is_empty()
        );
        snapshot.anchors = Some(vec![MarginRailAnchor {
            target: CommentRef {
                folio_id: original.folio_id.clone(),
                id: "same-quote-but-no-original-id".into(),
            },
            groups: Vec::new(),
        }]);
        assert!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .is_empty()
        );
        snapshot.anchors = Some(vec![MarginRailAnchor {
            target: original.reference(),
            groups: Vec::new(),
        }]);
        assert_eq!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .len(),
            1
        );
        snapshot.folio_id = Some("foreign".into());
        assert!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .is_empty()
        );
        assert_eq!(record.to_web_value().unwrap(), before);
    }
    #[test]
    fn source_dock_threshold_and_open_thread_reflow_preserve_real_reservations() {
        let mut snapshot = snapshot();
        let geometry = snapshot.geometry.as_mut().unwrap();
        geometry.canvas.width = geometry.scroller.right() - geometry.canvas.left - 304.;
        assert_eq!(geometry.room(), MarginRailRoom::Rail);
        geometry.canvas.width += 0.01;
        assert_eq!(geometry.room(), MarginRailRoom::Dock);
        geometry.canvas.width -= 0.01;
        snapshot.open_thread = Some(MarginRailOpenThread {
            target: target("live"),
            anchor_top: 250.,
            height: Some(451.),
        });
        let result = layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false);
        assert_eq!(result.cards[0].top, 66.); // actual viewport mark minus canvas top minus4
        assert_eq!(result.cards[1].top, 527.); // give way to the actual measured thread
        let slot = result.slot.unwrap().1;
        assert_eq!(slot.left, 1004.);
        assert_eq!(slot.width, 268.);
        assert_eq!(slot.top, 246.);
        snapshot.geometry.as_mut().unwrap().viewport_width = 620.;
        snapshot.geometry.as_mut().unwrap().scroller.width = 620.;
        let result = layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false);
        assert_eq!(result.room, MarginRailRoom::Dock);
        assert_eq!(result.dock_bottom, 45.);
        let slot = result.slot.unwrap().1;
        assert_eq!(slot.left, 12.);
        assert_eq!(slot.width, 340.);
        assert_eq!(slot.top, 246.);
        assert_eq!(slot.max_h, 602.);
    }
    #[test]
    fn explicit_peeks_survive_disabled_ambient_and_quiet_or_read_only_stays_hidden() {
        let mut snapshot = snapshot();
        snapshot.enabled = false;
        assert!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .is_empty()
        );
        snapshot.peek = Some(target("live"));
        assert_eq!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .len(),
            1
        );
        for state in ["zen", "read-only", "flow"] {
            let mut quiet = snapshot.clone();
            match state {
                "zen" => quiet.zen = true,
                "read-only" => quiet.read_only = true,
                _ => quiet.mode = FlowMode::Flow,
            }
            assert!(
                layout_margin_notes(&quiet, &HashSet::new(), &HashMap::new(), false)
                    .cards
                    .is_empty()
            );
        }
        snapshot.geometry.as_mut().unwrap().viewport_width = f32::NAN;
        assert!(
            layout_margin_notes(&snapshot, &HashSet::new(), &HashMap::new(), false)
                .cards
                .is_empty()
        );
    }
    #[test]
    fn clipping_matches_original_utf16_and_does_not_parse_preview_markdown() {
        for case in reference()["clipCases"].as_array().unwrap() {
            assert_eq!(
                clip_margin_preview(
                    case["text"].as_str().unwrap(),
                    case["limit"].as_u64().unwrap() as usize
                ),
                case["expected"].as_str().unwrap()
            );
        }
        let note = fixture_note("live");
        assert_eq!(
            collapsed_preview(&note.body),
            "Keep **all bytes**. Next paragraph."
        );
        assert_eq!(note.body, "Keep **all bytes**.\n\nNext paragraph.");
        assert_eq!(collapsed_preview("A\u{00a0}B\n\nC"), "A\u{00a0}B C");
    }

    #[test]
    fn hover_connections_match_executed_source_and_never_join_the_wrong_docked_note() {
        fn numbers(path: &str) -> Vec<f32> {
            path.split(|ch: char| !ch.is_ascii_digit() && !matches!(ch, '.' | '-'))
                .filter(|part| !part.is_empty())
                .map(|part| part.parse().unwrap())
                .collect()
        }
        for case in reference()["connectionCases"].as_array().unwrap() {
            let mut snapshot = snapshot();
            let canvas: MarginRailRect = serde_json::from_value(case["canvas"].clone()).unwrap();
            let text: MarginRailRect = serde_json::from_value(case["text"].clone()).unwrap();
            snapshot.geometry.as_mut().unwrap().canvas = canvas;
            snapshot.geometry.as_mut().unwrap().text = text;
            snapshot.notes = case["notes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|placed| {
                    let mut note = fixture_note(
                        placed["item"]["id"]
                            .as_str()
                            .unwrap()
                            .strip_prefix("comment:")
                            .unwrap(),
                    );
                    note.anchor_quote = placed["item"]["anchors"][0].as_str().unwrap().into();
                    note
                })
                .collect();
            snapshot.anchors = Some(
                case["groups"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(id, groups)| MarginRailAnchor {
                        target: target(id.strip_prefix("comment:").unwrap()),
                        groups: serde_json::from_value(groups.clone()).unwrap(),
                    })
                    .collect(),
            );
            let layout = MarginRailLayout {
                room: if case["room"] == "rail" {
                    MarginRailRoom::Rail
                } else {
                    MarginRailRoom::Dock
                },
                cards: case["notes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|placed| MarginRailCard {
                        target: source_target(&placed["item"]["id"]),
                        top: placed["top"].as_f64().unwrap() as f32,
                        height: 120.,
                    })
                    .collect(),
                ..Default::default()
            };
            let focus = ["hoverId", "peekId", "openId"].iter().find_map(|field| {
                case[*field]
                    .as_str()
                    .map(|id| target(id.strip_prefix("comment:").unwrap()))
            });
            let result = margin_rail_connections(&snapshot, &layout, focus.as_ref());
            let expected = &case["expected"];
            assert_eq!(result.len(), expected["brackets"].as_array().unwrap().len());
            for (actual, bracket) in result.iter().zip(expected["brackets"].as_array().unwrap()) {
                let path = numbers(bracket["d"].as_str().unwrap());
                assert_eq!(
                    actual.bracket,
                    [
                        [canvas.left + path[0], canvas.top + path[1]],
                        [canvas.left + path[2], canvas.top + path[1]],
                        [canvas.left + path[2], canvas.top + path[3]],
                        [canvas.left + path[4], canvas.top + path[3]],
                    ]
                );
            }
            let lines = result
                .iter()
                .filter_map(|connection| connection.line)
                .collect::<Vec<_>>();
            assert_eq!(lines.len(), expected["lines"].as_array().unwrap().len());
            for (actual, line) in lines.iter().zip(expected["lines"].as_array().unwrap()) {
                let path = numbers(line["d"].as_str().unwrap());
                let expected = std::array::from_fn::<_, 4, _>(|point| {
                    [
                        canvas.left + path[point * 2],
                        canvas.top + path[point * 2 + 1],
                    ]
                });
                assert_eq!(*actual, expected);
            }
            let marks = result
                .iter()
                .flat_map(|connection| connection.marks.iter())
                .collect::<Vec<_>>();
            assert_eq!(marks.len(), expected["marks"].as_array().unwrap().len());
            for (actual, mark) in marks.iter().zip(expected["marks"].as_array().unwrap()) {
                assert_eq!(
                    actual.left,
                    canvas.left + mark["x"].as_f64().unwrap() as f32 - 1.
                );
                assert_eq!(
                    actual.top,
                    canvas.top
                        + mark["y"].as_f64().unwrap() as f32
                        + mark["h"].as_f64().unwrap() as f32
                        - 3.
                );
                assert_eq!(actual.width, mark["w"].as_f64().unwrap() as f32 + 2.);
                assert_eq!(actual.height, 3.);
            }
            assert!(
                result
                    .iter()
                    .all(|connection| connection.target.id != "unplaced")
            );
            if case["room"] == "dock" {
                assert!(result.iter().all(|connection| connection.line.is_none()));
            }
        }
    }
}
