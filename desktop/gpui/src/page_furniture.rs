//! Native page furniture projected from Twyne's existing page components.
//!
//! Rulers and borders are presentation. The continuous wrapper never invents
//! sheets or inserts pagination spacers into the document. A caller with an
//! actual pagination engine can supply its measured geometry to `page_chrome`.

use crate::{
    assets::TwyneAssets,
    theme::{self, REM_PX, TYPEWRITER_FONT},
    workspace::{LayoutSettings, PageBorderStyle},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AccessibleAction, AnyElement, App, AssetSource, Bounds, Context, Corners, CursorStyle,
    DispatchPhase, EventEmitter, FocusHandle, HitboxBehavior, IntoElement, KeyDownEvent,
    MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Orientation, Path, Pixels, Render,
    RenderImage, Role, TestSupportExt, WeakEntity, Window, canvas, div, fill, point, px, relative,
    rgb, size,
};
use std::{
    cell::RefCell,
    rc::Rc,
    sync::{Arc, OnceLock},
};

pub const RULER_HEIGHT_PX: f32 = 1.35 * REM_PX;
pub const RULER_BOTTOM_GAP_PX: f32 = 0.25 * REM_PX;
pub const RULER_SPACE_PX: f32 = RULER_HEIGHT_PX + RULER_BOTTOM_GAP_PX;
pub const MARGIN_STEP_REM: f64 = 0.25;
const MIN_COLUMN_REM: f64 = 8.;
const MAX_MARGIN_REM: f64 = 8.;
const HANDLE_WIDTH_PX: f32 = 1.1 * REM_PX;
const TRACK_INSET_PX: f32 = 0.3 * REM_PX;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarginEdge {
    Left,
    Right,
}

impl MarginEdge {
    fn id(self) -> &'static str {
        match self {
            Self::Left => "page-ruler-left",
            Self::Right => "page-ruler-right",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Left => "Left margin",
            Self::Right => "Right margin",
        }
    }
}

/// Screen-direction keys deliberately invert the right margin's number.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarginKey {
    Left,
    Right,
    Home,
}

pub fn clamp_margin(rem: f64, opposite: f64, page_width_rem: f64) -> f64 {
    let maximum = (page_width_rem - opposite - MIN_COLUMN_REM).clamp(0., MAX_MARGIN_REM);
    if rem.is_finite() {
        rem.clamp(0., maximum)
    } else {
        0.
    }
}

pub fn margin_at_pointer(edge: MarginEdge, pointer_x: f32, left: f32, right: f32) -> f64 {
    let from_edge = match edge {
        MarginEdge::Left => pointer_x - left,
        MarginEdge::Right => right - pointer_x,
    };
    let rem = f64::from(from_edge / REM_PX);
    // JavaScript Math.round rather than Rust's away-from-zero rounding.
    (rem / MARGIN_STEP_REM + 0.5).floor() * MARGIN_STEP_REM
}

/// Patches only the chosen independent margin, retaining older settings and
/// all unknown fields. It does not add an absent pagination preference.
pub fn margin_layout(
    layout: &LayoutSettings,
    edge: MarginEdge,
    rem: f64,
    page_width_rem: f64,
) -> LayoutSettings {
    let margins = layout.resolve_margins();
    let opposite = match edge {
        MarginEdge::Left => margins.right,
        MarginEdge::Right => margins.left,
    };
    let value = clamp_margin(rem, opposite, page_width_rem);
    let mut next = layout.clone();
    match edge {
        MarginEdge::Left => next.margin_left = Some(value),
        MarginEdge::Right => next.margin_right = Some(value),
    }
    next
}

pub fn nudge_margin(
    layout: &LayoutSettings,
    edge: MarginEdge,
    key: MarginKey,
    shift: bool,
    page_width_rem: f64,
) -> LayoutSettings {
    let margins = layout.resolve_margins();
    let current = match edge {
        MarginEdge::Left => margins.left,
        MarginEdge::Right => margins.right,
    };
    let step = MARGIN_STEP_REM * if shift { 4. } else { 1. };
    let value = match (edge, key) {
        (_, MarginKey::Home) => 0.,
        (MarginEdge::Left, MarginKey::Left) | (MarginEdge::Right, MarginKey::Right) => {
            current - step
        }
        _ => current + step,
    };
    margin_layout(layout, edge, value, page_width_rem)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageMarginsPx {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}

impl PageMarginsPx {
    fn from_layout(layout: &LayoutSettings) -> Self {
        let margins = layout.resolve_margins();
        Self {
            left: margins.left as f32 * REM_PX,
            right: margins.right as f32 * REM_PX,
            top: margins.top as f32 * REM_PX,
            bottom: margins.bottom as f32 * REM_PX,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageBorderGeometry {
    pub style: PageBorderStyle,
    pub inset_px: f32,
    pub frame_width_px: f32,
}

impl PageBorderGeometry {
    pub fn resolve(layout: &LayoutSettings, canvas_width_px: f32, zen: bool) -> Self {
        let style = if zen {
            PageBorderStyle::None
        } else {
            layout.page_border.unwrap_or(PageBorderStyle::Plain)
        };
        let ornate = matches!(
            style,
            PageBorderStyle::Botanical | PageBorderStyle::Engraved | PageBorderStyle::Illuminated
        );
        let compact = canvas_width_px < 32. * REM_PX;
        Self {
            style,
            inset_px: if ornate && !compact {
                1.5 * REM_PX
            } else {
                0.625 * REM_PX
            },
            frame_width_px: if ornate {
                if compact { 2. * REM_PX } else { 3. * REM_PX }
            } else {
                1.
            },
        }
    }
}

/// Continuous manuscript geometry from manuscript-panel.tsx and global.css.
/// No manuscript length, sheet count, or estimated line height enters this API.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageCanvasGeometry {
    pub width_px: f32,
    pub padding_left_px: f32,
    pub padding_right_px: f32,
    pub padding_top_px: f32,
    pub padding_bottom_px: f32,
    pub guides: PageMarginsPx,
    pub border: PageBorderGeometry,
    pub ruler_width_rem: f64,
    pub ruler_space_px: f32,
    pub zen: bool,
}

impl PageCanvasGeometry {
    pub fn resolve(layout: &LayoutSettings, available_width_px: f32, zen: bool) -> Self {
        Self::resolve_with_viewport(layout, available_width_px, available_width_px, zen)
    }

    /// Viewport width controls the web media queries; available width may be
    /// smaller because the writer has opened the Folio drawer or Margin.
    pub fn resolve_with_viewport(
        layout: &LayoutSettings,
        available_width_px: f32,
        viewport_width_px: f32,
        zen: bool,
    ) -> Self {
        let available = if available_width_px.is_finite() {
            available_width_px.max(0.)
        } else {
            0.
        };
        let narrow_viewport = viewport_width_px <= 639.;
        let width_px = if zen {
            if narrow_viewport {
                available
            } else {
                (available - 2. * REM_PX).clamp(0., 74. * REM_PX)
            }
        } else {
            available.min(layout.width_rem() as f32 * REM_PX)
        };
        let guides = PageMarginsPx::from_layout(layout);
        let border = PageBorderGeometry::resolve(layout, width_px, zen);
        let ornate = matches!(
            border.style,
            PageBorderStyle::Botanical | PageBorderStyle::Engraved | PageBorderStyle::Illuminated
        );
        let clearance = if ornate {
            if narrow_viewport {
                2.75 * REM_PX
            } else {
                5. * REM_PX
            }
        } else {
            0.
        };
        let (left, right, top, bottom) = if zen {
            let side = if narrow_viewport {
                REM_PX
            } else {
                (viewport_width_px * 0.03).clamp(REM_PX, 3. * REM_PX)
            };
            (
                side,
                side,
                if narrow_viewport {
                    0.75 * REM_PX
                } else {
                    1.25 * REM_PX
                },
                3. * REM_PX,
            )
        } else {
            (
                guides.left.max(clearance),
                guides.right.max(clearance),
                guides.top.max(clearance),
                guides.bottom.max(clearance),
            )
        };
        Self {
            width_px,
            padding_left_px: left,
            padding_right_px: right,
            padding_top_px: top,
            padding_bottom_px: bottom,
            guides,
            border,
            ruler_width_rem: f64::from(width_px / REM_PX),
            ruler_space_px: if zen || viewport_width_px <= 640. {
                0.
            } else {
                RULER_SPACE_PX
            },
            zen,
        }
    }

    /// Physical sheet mode preserves width even in a narrow viewport. The
    /// host's real manuscript scroller supplies horizontal overflow. Unlike
    /// continuous Zen, paginated Zen retains original margin/ornament padding.
    pub fn resolve_paginated(layout: &LayoutSettings, viewport_width_px: f32, zen: bool) -> Self {
        let page = crate::editor::pagination::PageGeometry::from_layout(
            layout,
            f64::from(REM_PX),
            crate::editor::pagination::PAGE_GAP_REM,
        );
        let width_px = page.page_w as f32;
        let guides = PageMarginsPx::from_layout(layout);
        // PageChrome dims in Zen; its original border style and clearance
        // remain. Source's Zen padding override excludes .is-paginated.
        let border = PageBorderGeometry::resolve(layout, width_px, false);
        let ornate = matches!(
            border.style,
            PageBorderStyle::Botanical | PageBorderStyle::Engraved | PageBorderStyle::Illuminated
        );
        let clearance = if ornate {
            if viewport_width_px <= 639. {
                2.75 * REM_PX
            } else {
                5. * REM_PX
            }
        } else {
            0.
        };
        Self {
            width_px,
            padding_left_px: guides.left.max(clearance),
            padding_right_px: guides.right.max(clearance),
            padding_top_px: guides.top.max(clearance),
            padding_bottom_px: guides.bottom.max(clearance),
            guides,
            border,
            ruler_width_rem: f64::from(width_px / REM_PX),
            ruler_space_px: if zen || viewport_width_px <= 640. {
                0.
            } else {
                RULER_SPACE_PX
            },
            zen,
        }
    }

    pub fn content_width_px(self) -> f32 {
        (self.width_px - self.padding_left_px - self.padding_right_px).max(0.)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PageFurnitureEvent {
    LayoutChanged(LayoutSettings),
}

/// The existing web ruler: rem ticks, two captured margin handles, arrows,
/// Shift arrows, and Home. A drag leaving the ruler continues until release.
pub struct PageRulerView {
    pub layout: LayoutSettings,
    page_width_rem: f64,
    zen: bool,
    read_only: bool,
    focus: [FocusHandle; 2],
    dragging: Option<MarginEdge>,
    bounds: Rc<RefCell<Bounds<Pixels>>>,
}
impl EventEmitter<PageFurnitureEvent> for PageRulerView {}

impl PageRulerView {
    pub fn new(layout: LayoutSettings, page_width_rem: f64, cx: &mut Context<Self>) -> Self {
        Self {
            layout,
            page_width_rem,
            zen: false,
            read_only: false,
            focus: [
                cx.focus_handle().tab_stop(true),
                cx.focus_handle().tab_stop(true),
            ],
            dragging: None,
            bounds: Rc::new(RefCell::new(Bounds::default())),
        }
    }

    pub fn set_layout(
        &mut self,
        layout: LayoutSettings,
        page_width_rem: f64,
        cx: &mut Context<Self>,
    ) {
        self.layout = layout;
        self.page_width_rem = page_width_rem;
        cx.notify();
    }
    pub fn set_zen(&mut self, zen: bool, cx: &mut Context<Self>) {
        self.zen = zen;
        if zen {
            self.dragging = None;
        }
        cx.notify();
    }
    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        self.read_only = read_only;
        if read_only {
            self.dragging = None;
        }
        cx.notify();
    }

    fn value(&self, edge: MarginEdge) -> f64 {
        let margins = self.layout.resolve_margins();
        match edge {
            MarginEdge::Left => margins.left,
            MarginEdge::Right => margins.right,
        }
    }
    fn commit(&mut self, next: LayoutSettings, cx: &mut Context<Self>) {
        if self.read_only || self.zen || self.layout == next {
            return;
        }
        self.layout = next;
        cx.emit(PageFurnitureEvent::LayoutChanged(self.layout.clone()));
        cx.notify();
    }
    fn move_pointer(&mut self, edge: MarginEdge, x: Pixels, cx: &mut Context<Self>) {
        let bounds = *self.bounds.borrow();
        let rem = margin_at_pointer(
            edge,
            f32::from(x),
            f32::from(bounds.left()),
            f32::from(bounds.right()),
        );
        self.commit(
            margin_layout(&self.layout, edge, rem, self.page_width_rem),
            cx,
        );
    }
    fn key(
        &mut self,
        edge: MarginEdge,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = match event.keystroke.key.as_str() {
            "left" => MarginKey::Left,
            "right" => MarginKey::Right,
            "home" => MarginKey::Home,
            "escape" if self.dragging.is_some() => {
                self.dragging = None;
                window.release_pointer();
                cx.stop_propagation();
                cx.notify();
                return;
            }
            _ => return,
        };
        self.commit(
            nudge_margin(
                &self.layout,
                edge,
                key,
                event.keystroke.modifiers.shift,
                self.page_width_rem,
            ),
            cx,
        );
        window.prevent_default();
        cx.stop_propagation();
    }

    fn handle(&self, edge: MarginEdge, window: &Window, cx: &Context<Self>) -> AnyElement {
        let index = usize::from(edge == MarginEdge::Right);
        let focus = self.focus[index].clone();
        let focused = focus.is_focused(window);
        let active = self.dragging.is_some() || focused;
        let value = self.value(edge);
        let fraction = if self.page_width_rem > 0. {
            value / self.page_width_rem
        } else {
            0.
        };
        let position = match edge {
            MarginEdge::Left => fraction,
            MarginEdge::Right => 1. - fraction,
        };
        let entity = cx.weak_entity();
        let read_only = self.read_only;
        let color = if active {
            theme::palette(cx).vermilion
        } else {
            theme::palette(cx).ink_light
        };
        let marker = canvas(
            |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
            move |bounds, hitbox, window, cx| {
                if focused {
                    let expanded = Bounds::new(
                        bounds.origin - point(px(3.), px(3.)),
                        bounds.size + size(px(6.), px(6.)),
                    );
                    let mut outline = gpui_kit::outline(
                        expanded,
                        rgb(theme::palette(cx).vermilion),
                        Default::default(),
                    );
                    outline.border_widths = px(2.).into();
                    outline.corner_radii = px(2.).into();
                    window.paint_quad(outline);
                }
                let scale = if focused || hitbox.is_hovered(window) {
                    1.15
                } else {
                    1.
                };
                let center = bounds.center();
                let half_width = px(0.32 * REM_PX * scale);
                let half_height = px(0.42 * REM_PX * scale / 2.);
                let mut triangle = Path::new(point(center.x - half_width, center.y - half_height));
                triangle.line_to(point(center.x + half_width, center.y - half_height));
                triangle.line_to(point(center.x, center.y + half_height));
                window.paint_path(
                    triangle,
                    rgb(if hitbox.is_hovered(window) {
                        theme::palette(cx).vermilion
                    } else {
                        color
                    }),
                );
                if !read_only {
                    pointer_listeners(entity, edge, hitbox, focus, window);
                }
            },
        )
        .size_full();
        let increment = cx.weak_entity();
        let decrement = cx.weak_entity();
        div()
            .id(edge.id())
            .test_support()
            .role(Role::Slider)
            .aria_label(edge.label())
            .aria_value(format!("{} {:.2} rem", edge.label(), value))
            .aria_numeric_value(value)
            .aria_min_numeric_value(0.)
            .aria_max_numeric_value(MAX_MARGIN_REM)
            .aria_numeric_value_step(MARGIN_STEP_REM)
            .aria_orientation(Orientation::Horizontal)
            .absolute()
            .top(px(TRACK_INSET_PX))
            .left(relative(position as f32))
            .ml(px(-HANDLE_WIDTH_PX / 2.))
            .w(px(HANDLE_WIDTH_PX))
            .h(px(RULER_HEIGHT_PX - 2. * TRACK_INSET_PX))
            .cursor(CursorStyle::ResizeLeftRight)
            .rounded(px(2.))
            .when(!self.read_only, |this| this.track_focus(&self.focus[index]))
            .opacity(if self.read_only { 0.35 } else { 1. })
            .on_key_down(
                cx.listener(move |this, event, window, cx| this.key(edge, event, window, cx)),
            )
            .on_a11y_action(AccessibleAction::Increment, move |_, _, cx| {
                let _ = increment.update(cx, |this, cx| {
                    this.commit(
                        margin_layout(
                            &this.layout,
                            edge,
                            this.value(edge) + MARGIN_STEP_REM,
                            this.page_width_rem,
                        ),
                        cx,
                    )
                });
            })
            .on_a11y_action(AccessibleAction::Decrement, move |_, _, cx| {
                let _ = decrement.update(cx, |this, cx| {
                    this.commit(
                        margin_layout(
                            &this.layout,
                            edge,
                            this.value(edge) - MARGIN_STEP_REM,
                            this.page_width_rem,
                        ),
                        cx,
                    )
                });
            })
            .child(marker)
            .into_any_element()
    }
}

fn pointer_listeners(
    entity: WeakEntity<PageRulerView>,
    edge: MarginEdge,
    hitbox: gpui_kit::Hitbox,
    focus: FocusHandle,
    window: &mut Window,
) {
    let down = entity.clone();
    window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
        if phase == DispatchPhase::Bubble
            && event.button == MouseButton::Left
            && hitbox.is_hovered(window)
        {
            let _ = down.update(cx, |this, cx| {
                if this.read_only || this.zen {
                    return;
                }
                this.dragging = Some(edge);
                window.capture_pointer(hitbox.id);
                focus.focus(window, cx);
                cx.notify();
                window.prevent_default();
                cx.stop_propagation();
            });
        }
    });
    let moved = entity.clone();
    window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
        if phase != DispatchPhase::Capture {
            return;
        }
        let _ = moved.update(cx, |this, cx| {
            if this.dragging != Some(edge) {
                return;
            }
            if event.pressed_button != Some(MouseButton::Left) {
                this.dragging = None;
                window.release_pointer();
                cx.notify();
                return;
            }
            this.move_pointer(edge, event.position.x, cx);
            window.prevent_default();
            cx.stop_propagation();
        });
    });
    window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
        if phase == DispatchPhase::Capture && event.button == MouseButton::Left {
            let _ = entity.update(cx, |this, cx| {
                if this.dragging == Some(edge) {
                    this.dragging = None;
                    window.release_pointer();
                    cx.notify();
                    cx.stop_propagation();
                }
            });
        }
    });
}

impl Render for PageRulerView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.zen || f32::from(window.viewport_size().width) <= 640. {
            return div().into_any_element();
        }
        let palette = *theme::palette(cx);
        let bounds_store = self.bounds.clone();
        let margins = self.layout.resolve_margins();
        let width_rem = self.page_width_rem;
        let left = (margins.left / width_rem) as f32;
        let right = (margins.right / width_rem) as f32;
        div()
            .id("page-ruler")
            .test_support()
            .role(Role::Group)
            .aria_label("Page margins")
            .relative()
            .w(px(width_rem as f32 * REM_PX))
            .max_w_full()
            .h(px(RULER_HEIGHT_PX))
            .mb(px(RULER_BOTTOM_GAP_PX))
            .mx_auto()
            .flex_shrink_0()
            .child(
                canvas(
                    move |bounds, _, _| {
                        *bounds_store.borrow_mut() = bounds;
                    },
                    move |bounds, _, window, _| {
                        let track = Bounds::new(
                            point(bounds.left(), bounds.top() + px(TRACK_INSET_PX)),
                            size(bounds.size.width, px(RULER_HEIGHT_PX - 2. * TRACK_INSET_PX)),
                        );
                        window.paint_quad(fill(track, rgb(palette.rule)));
                        let column = Bounds::new(
                            point(
                                bounds.left() + bounds.size.width * left,
                                track.top() + px(TRACK_INSET_PX),
                            ),
                            size(
                                bounds.size.width * (1. - left - right).max(0.),
                                track.size.height - px(2. * TRACK_INSET_PX),
                            ),
                        );
                        window.paint_quad(fill(column, rgb(palette.paper_soft)));
                        window.paint_quad(fill(
                            Bounds::new(column.origin, size(px(1.), column.size.height)),
                            rgb(palette.ink_muted),
                        ));
                        window.paint_quad(fill(
                            Bounds::new(
                                point(column.right() - px(1.), column.top()),
                                size(px(1.), column.size.height),
                            ),
                            rgb(palette.ink_muted),
                        ));
                        for tick in 1..=(width_rem.max(0.).floor() as usize) {
                            let x = bounds.left()
                                + bounds.size.width * (tick as f32 / width_rem as f32);
                            window.paint_quad(fill(
                                Bounds::new(
                                    point(x, track.center().y - px(TRACK_INSET_PX / 2.)),
                                    size(px(1.), px(TRACK_INSET_PX)),
                                ),
                                rgb(palette.ink_muted).opacity(0.5),
                            ));
                        }
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(self.handle(MarginEdge::Left, window, cx))
            .child(self.handle(MarginEdge::Right, window, cx))
            .when_some(self.dragging, |this, edge| {
                let value = self.value(edge);
                let fraction = (value / width_rem) as f32;
                let left = if edge == MarginEdge::Left {
                    fraction
                } else {
                    1. - fraction
                };
                this.child(
                    div()
                        .id("page-ruler-readout")
                        .test_support()
                        .absolute()
                        .top(px(-RULER_HEIGHT_PX + TRACK_INSET_PX))
                        .left(relative(left))
                        .ml(px(-40.))
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(0.6 * REM_PX))
                        .px(px(0.35 * REM_PX))
                        .py(px(0.1 * REM_PX))
                        .bg(rgb(palette.ink))
                        .text_color(rgb(palette.paper))
                        .rounded(px(2.))
                        .child(format!("{value:.2} rem")),
                )
            })
            .into_any_element()
    }
}

/// A source slice and its exact destination. Edge tiles use CSS `round`:
/// the motif is rescaled to an integer count, never stretched as one image.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BorderTile {
    pub slice: &'static str,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub fn border_tiles(border: PageBorderGeometry, width: f32, height: f32) -> Vec<BorderTile> {
    if !matches!(
        border.style,
        PageBorderStyle::Botanical | PageBorderStyle::Engraved | PageBorderStyle::Illuminated
    ) {
        return Vec::new();
    }
    let inset = border.inset_px;
    let w = (width - 2. * inset).max(0.);
    let h = (height - 2. * inset).max(0.);
    let frame = border.frame_width_px.min(w / 2.).min(h / 2.);
    if frame <= 0. {
        return Vec::new();
    }
    let edge_w = (w - 2. * frame).max(0.);
    let edge_h = (h - 2. * frame).max(0.);
    let horizontal = ((edge_w / (frame * 384. / 320.) + 0.5).floor() as usize).max(1);
    let vertical = ((edge_h / (frame * 896. / 320.) + 0.5).floor() as usize).max(1);
    let mut tiles = vec![
        BorderTile {
            slice: "nw",
            x: inset,
            y: inset,
            width: frame,
            height: frame,
        },
        BorderTile {
            slice: "ne",
            x: inset + w - frame,
            y: inset,
            width: frame,
            height: frame,
        },
        BorderTile {
            slice: "sw",
            x: inset,
            y: inset + h - frame,
            width: frame,
            height: frame,
        },
        BorderTile {
            slice: "se",
            x: inset + w - frame,
            y: inset + h - frame,
            width: frame,
            height: frame,
        },
    ];
    let tile_w = edge_w / horizontal as f32;
    for index in 0..horizontal {
        let x = inset + frame + index as f32 * tile_w;
        tiles.push(BorderTile {
            slice: "n",
            x,
            y: inset,
            width: tile_w,
            height: frame,
        });
        tiles.push(BorderTile {
            slice: "s",
            x,
            y: inset + h - frame,
            width: tile_w,
            height: frame,
        });
    }
    let tile_h = edge_h / vertical as f32;
    for index in 0..vertical {
        let y = inset + frame + index as f32 * tile_h;
        tiles.push(BorderTile {
            slice: "w",
            x: inset,
            y,
            width: frame,
            height: tile_h,
        });
        tiles.push(BorderTile {
            slice: "e",
            x: inset + w - frame,
            y,
            width: frame,
            height: tile_h,
        });
    }
    tiles
}

const SLICES: [&str; 8] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
type BorderImages = [(String, Arc<RenderImage>); 8];
type CachedBorder = OnceLock<Result<BorderImages, String>>;
static BOTANICAL: CachedBorder = OnceLock::new();
static ENGRAVED: CachedBorder = OnceLock::new();
static ILLUMINATED: CachedBorder = OnceLock::new();

fn border_images(style: PageBorderStyle) -> Option<&'static BorderImages> {
    let (cache, name) = match style {
        PageBorderStyle::Botanical => (&BOTANICAL, "botanical"),
        PageBorderStyle::Engraved => (&ENGRAVED, "engraved"),
        PageBorderStyle::Illuminated => (&ILLUMINATED, "illuminated"),
        _ => return None,
    };
    cache
        .get_or_init(|| {
            let mut images = Vec::with_capacity(8);
            for slice in SLICES {
                let path = format!("/assets/page-borders/slices/{name}-{slice}.avif");
                let bytes = TwyneAssets
                    .load(&path)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| format!("Missing embedded page border: {path}"))?;
                let mut rgba = image::load_from_memory(&bytes)
                    .map_err(|error| error.to_string())?
                    .into_rgba8();
                for pixel in rgba.as_chunks_mut::<4>().0 {
                    pixel.swap(0, 2);
                }
                images.push((
                    slice.to_owned(),
                    Arc::new(RenderImage::new([image::Frame::new(rgba)])),
                ));
            }
            images
                .try_into()
                .map_err(|_| "Page border must have eight slices".to_owned())
        })
        .as_ref()
        .ok()
}

fn border_layer(border: PageBorderGeometry, cx: &App) -> AnyElement {
    let rule = theme::palette(cx).rule;
    let images = border_images(border.style);
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            if border.style == PageBorderStyle::Plain {
                let inset = px(border.inset_px);
                let frame = Bounds::new(
                    bounds.origin + point(inset, inset),
                    size(
                        (bounds.size.width - inset * 2.).max(px(0.)),
                        (bounds.size.height - inset * 2.).max(px(0.)),
                    ),
                );
                for edge in [
                    Bounds::new(frame.origin, size(frame.size.width, px(1.))),
                    Bounds::new(
                        point(frame.left(), frame.bottom() - px(1.)),
                        size(frame.size.width, px(1.)),
                    ),
                    Bounds::new(frame.origin, size(px(1.), frame.size.height)),
                    Bounds::new(
                        point(frame.right() - px(1.), frame.top()),
                        size(px(1.), frame.size.height),
                    ),
                ] {
                    window.paint_quad(fill(edge, rgb(rule)));
                }
            } else if let Some(images) = images {
                for tile in border_tiles(
                    border,
                    f32::from(bounds.size.width),
                    f32::from(bounds.size.height),
                ) {
                    if let Some((_, image)) = images.iter().find(|(slice, _)| slice == tile.slice) {
                        let target = Bounds::new(
                            bounds.origin + point(px(tile.x), px(tile.y)),
                            size(px(tile.width), px(tile.height)),
                        );
                        let _ = window.paint_image(
                            target,
                            target,
                            Corners::default(),
                            image.clone(),
                            0,
                            false,
                        );
                    }
                }
            }
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
    .into_any_element()
}

/// Wraps the real editor child. It adds no inner scroll container or copied
/// manuscript, and the furniture never participates in hit testing.
pub fn page_canvas(
    layout: &LayoutSettings,
    geometry: PageCanvasGeometry,
    child: AnyElement,
    cx: &App,
) -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {
    page_canvas_surface(layout, geometry, child, None, cx)
}

/// The engine supplies accepted measured sheets. It does not estimate count
/// from words or copy the editor into a second, noninteractive surface.
pub fn page_canvas_paginated(
    layout: &LayoutSettings,
    geometry: PageCanvasGeometry,
    metrics: PageChromeGeometry,
    text: PageChromeText<'_>,
    child: AnyElement,
    cx: &App,
) -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {
    page_canvas_surface(layout, geometry, child, Some((metrics, text)), cx)
}

fn page_canvas_surface(
    layout: &LayoutSettings,
    geometry: PageCanvasGeometry,
    child: AnyElement,
    chrome: Option<(PageChromeGeometry, PageChromeText<'_>)>,
    cx: &App,
) -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {
    let color = rgb(theme::palette(cx).vermilion).opacity(0.28);
    div()
        .id("manuscript-page-canvas")
        .test_support()
        .relative()
        .mx_auto()
        .w(px(geometry.width_px))
        .when(chrome.is_none(), |this| this.max_w_full())
        .when(chrome.is_some(), |this| this.flex_shrink_0())
        .pl(px(geometry.padding_left_px))
        .pr(px(geometry.padding_right_px))
        .pt(px(geometry.padding_top_px))
        .pb(px(geometry.padding_bottom_px))
        .when(layout.show_margin_guides == Some(true), |this| {
            this.child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let margins = geometry.guides;
                        for (x, y, width, height) in [
                            (margins.left, 0., 1., f32::from(bounds.size.height)),
                            (
                                f32::from(bounds.size.width) - margins.right,
                                0.,
                                1.,
                                f32::from(bounds.size.height),
                            ),
                            (0., margins.top, f32::from(bounds.size.width), 1.),
                            (
                                0.,
                                f32::from(bounds.size.height) - margins.bottom,
                                f32::from(bounds.size.width),
                                1.,
                            ),
                        ] {
                            window.paint_quad(fill(
                                Bounds::new(
                                    bounds.origin + point(px(x), px(y)),
                                    size(px(width), px(height)),
                                ),
                                color,
                            ));
                        }
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
        })
        .when(chrome.is_none(), |this| {
            this.child(border_layer(geometry.border, cx))
        })
        .when_some(chrome, |this, (metrics, text)| {
            this.min_h(px(metrics.total_height_px())).child(page_chrome(
                layout,
                metrics,
                text,
                geometry.width_px,
                geometry.zen,
                cx,
            ))
        })
        .child(
            div()
                .id("manuscript-page-content")
                .test_support()
                .relative()
                .w_full()
                .child(child),
        )
}

/// Values supplied by an actual pagination engine. This type does not estimate
/// how many pages a rich document occupies and is unused in continuous mode.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageChromeGeometry {
    pub page_count: usize,
    pub page_height_px: f32,
    pub gap_px: f32,
    pub margins: PageMarginsPx,
}
impl PageChromeGeometry {
    pub fn total_height_px(self) -> f32 {
        if self.page_count == 0 {
            0.
        } else {
            self.page_count as f32 * (self.page_height_px + self.gap_px) - self.gap_px
        }
    }
    pub fn sheet_top_px(self, index: usize) -> Option<f32> {
        (index < self.page_count).then_some(index as f32 * (self.page_height_px + self.gap_px))
    }
    pub fn header_top_px(self) -> f32 {
        (self.margins.top * 0.45).max(4.)
    }
    pub fn footer_bottom_px(self) -> f32 {
        (self.margins.bottom * 0.4).max(4.)
    }
}

pub fn furniture_display<'a>(custom: Option<&'a str>, fallback: &'a str) -> &'a str {
    custom
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PageChromeText<'a> {
    pub title: Option<&'a str>,
    pub author: Option<&'a str>,
    pub header: Option<&'a str>,
    pub footer: Option<&'a str>,
}

/// Paints engine-supplied sheets behind the real content. Header/footer edits
/// remain in the native compositor, which owns their explicit save boundary.
pub fn page_chrome(
    layout: &LayoutSettings,
    metrics: PageChromeGeometry,
    text: PageChromeText<'_>,
    width_px: f32,
    zen: bool,
    cx: &App,
) -> AnyElement {
    if metrics.page_count == 0
        || !metrics.page_height_px.is_finite()
        || metrics.page_height_px <= 0.
    {
        return div().into_any_element();
    }
    let palette = *theme::palette(cx);
    let title = furniture_display(
        text.header,
        text.title
            .filter(|title| !title.is_empty())
            .unwrap_or("Untitled"),
    )
    .to_uppercase();
    let footer = furniture_display(text.footer, "\u{a0}").to_owned();
    let border = PageBorderGeometry::resolve(layout, width_px, false);
    div()
        .id("page-chrome")
        .test_support()
        .aria_label("Page headers and footers")
        .absolute()
        .top_0()
        .left_0()
        .w_full()
        .h(px(metrics.total_height_px()))
        .opacity(if zen { 0.25 } else { 1. })
        .children((0..metrics.page_count).map(|index| {
            div()
                .id(("page-sheet", index))
                .test_support()
                .absolute()
                .left_0()
                .w_full()
                .top(px(metrics.sheet_top_px(index).unwrap_or(0.)))
                .h(px(metrics.page_height_px))
                .border_1()
                .border_color(rgb(palette.rule))
                .bg(rgb(palette.paper))
                .shadow(vec![
                    gpui_kit::BoxShadow {
                        color: rgb(palette.shade).opacity(0.04).into(),
                        offset: point(px(0.), px(1.)),
                        blur_radius: px(0.),
                        spread_radius: px(0.),
                        inset: false,
                    },
                    gpui_kit::BoxShadow {
                        color: rgb(palette.shade).opacity(0.35).into(),
                        offset: point(px(0.), px(18.)),
                        blur_radius: px(34.),
                        spread_radius: px(-22.),
                        inset: false,
                    },
                ])
                .child(border_layer(border, cx))
                .when(layout.running_header, |this| {
                    this.child(
                        div()
                            .id(("page-running-header", index))
                            .test_support()
                            .absolute()
                            .top(px(metrics.header_top_px()))
                            .left(px(metrics.margins.left))
                            .right(px(metrics.margins.right))
                            .flex()
                            .items_baseline()
                            .justify_between()
                            .gap(px(REM_PX))
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(0.62 * REM_PX))
                            .text_color(rgb(palette.ink_muted))
                            .border_b_1()
                            .border_color(rgb(palette.rule))
                            .pb(px(0.3 * REM_PX))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .overflow_hidden()
                                    .text_ellipsis()
                                    .child(title.clone()),
                            )
                            .when_some(text.author, |this, author| {
                                this.child(author.to_uppercase())
                            }),
                    )
                })
                .when(
                    layout.page_numbers || text.footer.is_some_and(|value| !value.is_empty()),
                    |this| {
                        this.child(
                            div()
                                .id(("page-running-footer", index))
                                .test_support()
                                .absolute()
                                .bottom(px(metrics.footer_bottom_px()))
                                .left(px(metrics.margins.left))
                                .right(px(metrics.margins.right))
                                .flex()
                                .items_center()
                                .gap(px(REM_PX))
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(0.68 * REM_PX))
                                .text_color(rgb(palette.ink_muted))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .overflow_hidden()
                                        .text_ellipsis()
                                        .child(footer.clone()),
                                )
                                .when(layout.page_numbers, |this| {
                                    this.child(
                                        div()
                                            .id(("page-number", index))
                                            .test_support()
                                            .child((index + 1).to_string()),
                                    )
                                })
                                .child(div().flex_1()),
                        )
                    },
                )
        }))
        .into_any_element()
}

#[cfg(test)]
mod contracts {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../fixtures/page-furniture/web-contract.json")).unwrap()
    }
    fn close(actual: f32, expected: &Value, name: &str) {
        let expected = expected.as_f64().unwrap() as f32;
        assert!(
            (actual - expected).abs() < 0.001,
            "{name}: {actual} != {expected}"
        );
    }

    #[test]
    fn continuous_geometry_matches_executed_web_defaults_and_authoritative_css() {
        let fixture = fixture();
        for case in fixture["continuous"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let layout: LayoutSettings = serde_json::from_value(case["layout"].clone()).unwrap();
            let original = layout.clone();
            let geometry = PageCanvasGeometry::resolve_with_viewport(
                &layout,
                case["available"].as_f64().unwrap() as f32,
                case["viewport"].as_f64().unwrap() as f32,
                case["zen"].as_bool().unwrap(),
            );
            let expected = &case["expected"];
            for (actual, value) in [
                (geometry.width_px, &expected["width"]),
                (geometry.padding_left_px, &expected["padding"]["left"]),
                (geometry.padding_right_px, &expected["padding"]["right"]),
                (geometry.padding_top_px, &expected["padding"]["top"]),
                (geometry.padding_bottom_px, &expected["padding"]["bottom"]),
                (geometry.guides.left, &expected["guides"]["left"]),
                (geometry.guides.right, &expected["guides"]["right"]),
                (geometry.guides.top, &expected["guides"]["top"]),
                (geometry.guides.bottom, &expected["guides"]["bottom"]),
                (geometry.border.inset_px, &expected["inset"]),
                (geometry.border.frame_width_px, &expected["frame"]),
                (geometry.ruler_space_px, &expected["rulerSpace"]),
            ] {
                close(actual, value, name);
            }
            assert_eq!(
                serde_json::to_value(geometry.border.style).unwrap(),
                expected["border"]
            );
            assert_eq!(layout, original);
            assert_eq!(
                layout.pagination, None,
                "rendering must not upgrade legacy view preferences"
            );
        }
    }

    #[test]
    fn nine_slice_round_counts_match_the_actual_print_ornament_contract() {
        for case in fixture()["physical"].as_array().unwrap() {
            let layout: LayoutSettings = serde_json::from_value(case["layout"].clone()).unwrap();
            let width = case["width"].as_f64().unwrap() as f32;
            let height = case["height"].as_f64().unwrap() as f32;
            let border = PageBorderGeometry::resolve(&layout, width, false);
            let tiles = border_tiles(border, width, height);
            assert_eq!(
                tiles.iter().filter(|tile| tile.slice == "n").count(),
                case["tiles"]["horizontal"].as_u64().unwrap() as usize
            );
            assert_eq!(
                tiles.iter().filter(|tile| tile.slice == "w").count(),
                case["tiles"]["vertical"].as_u64().unwrap() as usize
            );
            let corners: Vec<_> = tiles.iter().filter(|tile| tile.slice.len() == 2).collect();
            assert_eq!(corners.len(), 4);
            assert!(
                corners
                    .iter()
                    .all(|tile| tile.width == 48. && tile.height == 48.)
            );
            let north: Vec<_> = tiles.iter().filter(|tile| tile.slice == "n").collect();
            let covered: f32 = north.iter().map(|tile| tile.width).sum();
            assert!((covered - (width - 2. * (24. + 48.))).abs() < 0.001);
            assert!(tiles.iter().all(|tile| tile.x >= 0.
                && tile.y >= 0.
                && tile.x + tile.width <= width
                && tile.y + tile.height <= height));
        }
    }

    #[test]
    fn margins_remain_generational_and_cannot_collapse_the_live_column() {
        let layout: LayoutSettings = serde_json::from_value(json!({
            "width":"normal", "margin":"roomy", "marginX":1.75,
            "runningHeader":false,"pageNumbers":true,
            "futureGutter":{"binding":"left"},
            "openingInitial":{"mode":"plain","collection":"alternate","size":"large","futureInk":"blue"}
        })).unwrap();
        assert_eq!(layout.resolve_margins().left, 1.75);
        let right = nudge_margin(&layout, MarginEdge::Right, MarginKey::Left, false, 12.);
        assert_eq!(right.margin_right, Some(2.));
        let constrained = margin_layout(&right, MarginEdge::Left, 1000., 12.);
        assert_eq!(constrained.margin_left, Some(2.));
        assert_eq!(constrained.margin_right, Some(2.));
        assert_eq!(constrained.pagination, None);
        assert_eq!(constrained.margin_x, Some(1.75));
        assert_eq!(constrained.extra, layout.extra);
        assert_eq!(constrained.opening_initial, layout.opening_initial);
        let home = nudge_margin(&constrained, MarginEdge::Right, MarginKey::Home, true, 12.);
        assert_eq!(home.margin_right, Some(0.));
        assert_eq!(margin_at_pointer(MarginEdge::Left, 50., 0., 192.), 3.25);
        assert_eq!(margin_at_pointer(MarginEdge::Right, 142., 0., 192.), 3.25);
    }

    #[test]
    fn every_original_border_slice_decodes_once_with_its_source_dimensions() {
        for style in [
            PageBorderStyle::Botanical,
            PageBorderStyle::Engraved,
            PageBorderStyle::Illuminated,
        ] {
            let images = border_images(style).expect("embedded original border slices");
            for (slice, image) in images {
                let size = image.size(0);
                let (width, height) = match slice.as_str() {
                    "n" | "s" => (384., 320.),
                    "w" | "e" => (320., 896.),
                    _ => (320., 320.),
                };
                assert_eq!(u32::from(size.width), width as u32);
                assert_eq!(u32::from(size.height), height as u32);
                assert!(
                    image
                        .as_bytes(0)
                        .unwrap()
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .any(|pixel| pixel[3] != 0)
                );
            }
            let cached = border_images(style).unwrap();
            for ((_, image), (_, again)) in images.iter().zip(cached) {
                assert!(Arc::ptr_eq(image, again));
            }
        }
        assert!(border_images(PageBorderStyle::Plain).is_none());
    }

    #[test]
    fn only_actual_page_metrics_produce_sheet_positions_and_chrome_fallbacks() {
        for item in fixture()["furniture"].as_array().unwrap() {
            assert_eq!(
                furniture_display(item["custom"].as_str(), item["fallback"].as_str().unwrap()),
                item["displayed"].as_str().unwrap()
            );
        }
        let metrics = PageChromeGeometry {
            page_count: 3,
            page_height_px: 1056.,
            gap_px: 24.,
            margins: PageMarginsPx {
                left: 32.,
                right: 32.,
                top: 16.,
                bottom: 16.,
            },
        };
        assert_eq!(metrics.sheet_top_px(0), Some(0.));
        assert_eq!(metrics.sheet_top_px(2), Some(2160.));
        assert_eq!(metrics.sheet_top_px(3), None);
        assert_eq!(metrics.total_height_px(), 3216.);
        assert_eq!(metrics.header_top_px(), 7.2);
        assert_eq!(metrics.footer_bottom_px(), 6.4);
        let inactive = PageChromeGeometry {
            page_count: 0,
            ..metrics
        };
        assert_eq!(inactive.total_height_px(), 0.);
        assert_eq!(inactive.sheet_top_px(0), None);
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod interaction {
    use super::*;
    use crate::editor::{
        RichDocument,
        view::{InitialMode, OpeningInitial, RichEditorView},
    };
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, AppContext, Entity, Focusable, Point, ScrollDelta, ScrollHandle,
        TestAppContext, WindowBounds, WindowOptions,
    };
    use serde_json::json;
    use std::sync::Mutex;

    struct Room {
        ruler: Entity<PageRulerView>,
        editor: Entity<RichEditorView>,
        scroll: ScrollHandle,
        zen: bool,
    }
    impl Render for Room {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let layout = self.ruler.read(cx).layout.clone();
            let viewport = window.viewport_size();
            let geometry = PageCanvasGeometry::resolve_with_viewport(
                &layout,
                f32::from(viewport.width) - 64.,
                f32::from(viewport.width),
                self.zen,
            );
            let child = div()
                .id("actual-manuscript-child")
                .test_support()
                .min_h(px(f32::from(viewport.height) * 0.6))
                .child(self.editor.clone())
                .into_any_element();
            div()
                .size_full()
                .flex()
                .flex_col()
                .bg(rgb(theme::palette(cx).paper))
                .child(div().h(px(128.)).flex_shrink_0())
                .child(
                    div()
                        .id("writing-scroll")
                        .test_support()
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .track_scroll(&self.scroll)
                        .child(self.ruler.clone())
                        .child(page_canvas(&layout, geometry, child, cx)),
                )
        }
    }
    fn room(
        cx: &mut TestAppContext,
        layout: LayoutSettings,
        width: f32,
        html: &str,
    ) -> (
        AnyWindowHandle,
        Entity<Room>,
        Entity<PageRulerView>,
        Entity<RichEditorView>,
    ) {
        let document = RichDocument::from_html(html).unwrap();
        cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            crate::editor::view::init(cx);
            let (handle, entity) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        Point::default(),
                        size(px(width), px(860.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    cx.new(|cx| {
                        let ruler = cx.new(|cx| PageRulerView::new(layout, 48., cx));
                        cx.observe(&ruler, |_, _, cx| cx.notify()).detach();
                        let editor = cx.new(|cx| {
                            let mut editor = RichEditorView::new(document, cx);
                            editor.set_opening_initial(
                                OpeningInitial {
                                    mode: InitialMode::Off,
                                    ..OpeningInitial::default()
                                },
                                cx,
                            );
                            editor
                        });
                        Room {
                            ruler,
                            editor,
                            scroll: ScrollHandle::new(),
                            zen: false,
                        }
                    })
                },
            )
            .unwrap();
            (
                handle,
                entity.clone(),
                entity.read(cx).ruler.clone(),
                entity.read(cx).editor.clone(),
            )
        })
    }
    fn events(
        cx: &mut TestAppContext,
        ruler: &Entity<PageRulerView>,
    ) -> Arc<Mutex<Vec<LayoutSettings>>> {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let received = captured.clone();
        cx.update(|cx| {
            cx.subscribe(ruler, move |_, event: &PageFurnitureEvent, _| {
                let PageFurnitureEvent::LayoutChanged(layout) = event;
                received.lock().unwrap().push(layout.clone());
            })
            .detach()
        });
        captured
    }

    #[gpui_kit::test]
    fn native_ruler_keys_follow_screen_direction_and_retain_imported_source(
        cx: &mut TestAppContext,
    ) {
        let original = "<p><strong>Original text</strong><span data-type=\"raw-typst-inline\" data-typst-source=\"#keep[exact]\"></span></p>";
        let mut layout = LayoutSettings::default();
        layout
            .extra
            .insert("futureBinding".into(), json!({"inside":0.5}));
        let (handle, _, ruler, editor) = room(cx, layout.clone(), 1280., original);
        let captured = events(cx, &ruler);
        cx.update_window(handle, |_, window, cx| {
            window.activate_window();
            window.render_frame(cx);
            assert_eq!(window.find("page-ruler").role(), Some(Role::Group));
            assert_eq!(window.find("page-ruler-left").role(), Some(Role::Slider));
            assert_eq!(window.find("page-ruler-left").label(), Some("Left margin"));
            window.click("page-ruler-left", cx);
            assert_eq!(window.find("page-ruler-left").focused(), Some(true));
            window.press("right", cx);
            assert_eq!(ruler.read(cx).layout.margin_left, Some(2.25));
            window.press("shift-right", cx);
            assert_eq!(ruler.read(cx).layout.margin_left, Some(3.25));
            window.press("left", cx);
            assert_eq!(ruler.read(cx).layout.margin_left, Some(3.));
            window.press("home", cx);
            assert_eq!(ruler.read(cx).layout.margin_left, Some(0.));
            window.press("tab", cx);
            assert_eq!(window.find("page-ruler-right").focused(), Some(true));
            window.press("left", cx);
            assert_eq!(ruler.read(cx).layout.margin_right, Some(2.25));
            window.press("shift-right", cx);
            assert_eq!(ruler.read(cx).layout.margin_right, Some(1.25));
            assert_eq!(
                window.find("page-ruler-right").value(),
                Some("Right margin 1.25 rem")
            );
            assert_eq!(editor.read(cx).document().to_html(), original);
            assert_eq!(ruler.read(cx).layout.pagination, None);
            assert_eq!(ruler.read(cx).layout.extra, layout.extra);
        })
        .unwrap();
        assert_eq!(captured.lock().unwrap().len(), 6);
    }

    #[gpui_kit::test]
    fn captured_drag_snaps_in_rem_and_releases_outside_the_ruler(cx: &mut TestAppContext) {
        let (handle, _, ruler, editor) = room(
            cx,
            LayoutSettings::default(),
            1280.,
            "<p>Words stay in their manuscript.</p>",
        );
        let captured = events(cx, &ruler);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let bounds = window.find("page-ruler").bounds();
            let start = window.find("page-ruler-left").bounds().center();
            window.drag(
                start,
                point(bounds.left() + px(50.), bounds.top() + px(100.)),
                cx,
            );
            assert_eq!(ruler.read(cx).layout.margin_left, Some(3.25));
            assert_eq!(ruler.read(cx).dragging, None);
            assert!(window.captured_hitbox().is_none());
            let start = window.find("page-ruler-right").bounds().center();
            window.drag(
                start,
                point(bounds.right() + px(500.), bounds.top() + px(100.)),
                cx,
            );
            assert_eq!(ruler.read(cx).layout.margin_right, Some(0.));
            let start = window.find("page-ruler-left").bounds().center();
            window.drag(
                start,
                point(bounds.right() + px(500.), bounds.top() + px(100.)),
                cx,
            );
            assert_eq!(ruler.read(cx).layout.margin_left, Some(8.));
            assert!(window.try_find("page-ruler-readout").is_none());
            assert_eq!(
                editor.read(cx).document().to_html(),
                "<p>Words stay in their manuscript.</p>"
            );
        })
        .unwrap();
        assert!(!captured.lock().unwrap().is_empty());
    }

    #[gpui_kit::test]
    fn continuous_canvas_bounds_include_the_real_ruler_and_original_padding(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, ruler, _) = room(
            cx,
            LayoutSettings::default(),
            1280.,
            "<h1>A proper page</h1><p>Prose under the heading.</p>",
        );
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let rule = window.find("page-ruler").bounds();
            let canvas = window.find("manuscript-page-canvas").bounds();
            let content = window.find("manuscript-page-content").bounds();
            // GPUI snaps layout to native device pixels; preserve the exact
            // CSS value above and permit half a device pixel at this boundary.
            let tolerance = 0.5 / window.scale_factor() + 0.001;
            assert!((f32::from(rule.size.height) - RULER_HEIGHT_PX).abs() < tolerance);
            assert!(
                (f32::from(canvas.top() - rule.bottom()) - RULER_BOTTOM_GAP_PX).abs() < tolerance
            );
            assert_eq!(f32::from(canvas.size.width), 768.);
            assert_eq!(f32::from(content.size.width), 704.);
            assert_eq!(f32::from(content.left() - canvas.left()), 32.);
            assert_eq!(f32::from(content.top() - canvas.top()), 16.);
            assert!(f32::from(canvas.size.height) >= 516. + 32.);
            ruler.update(cx, |view, cx| view.set_zen(true, cx));
            room.update(cx, |room, cx| {
                room.zen = true;
                cx.notify();
            });
            window.render_frame(cx);
            assert!(window.try_find("page-ruler").is_none());
            let canvas = window.find("manuscript-page-canvas").bounds();
            let content = window.find("manuscript-page-content").bounds();
            assert_eq!(f32::from(content.top() - canvas.top()), 20.);
            assert!((f32::from(content.left() - canvas.left()) - 38.4).abs() < tolerance);
            assert_eq!(f32::from(canvas.size.width), 1184.);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn border_and_guides_do_not_steal_caret_or_outer_scroll(cx: &mut TestAppContext) {
        let layout = LayoutSettings {
            page_border: Some(PageBorderStyle::Botanical),
            show_margin_guides: Some(true),
            ..LayoutSettings::default()
        };
        let html = format!(
            "<p>{}</p>",
            "A growing continuous manuscript keeps its original frame. ".repeat(150)
        );
        let (handle, room, _, editor) = room(cx, layout, 1280., &html);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let canvas = window.find("manuscript-page-canvas").bounds();
            let content = window.find("manuscript-page-content").bounds();
            assert_eq!(f32::from(content.left() - canvas.left()), 80.);
            assert_eq!(f32::from(content.top() - canvas.top()), 80.);
            window.click_at("actual-manuscript-child", point(px(20.), px(18.)), cx);
            assert!(editor.read(cx).focus_handle(cx).is_focused(window));
            window.input("Native ", cx);
            assert!(editor.read(cx).document().to_html().contains("Native "));
            let old = room.read(cx).scroll.offset();
            window.scroll(
                "writing-scroll",
                ScrollDelta::Pixels(point(px(0.), px(-300.))),
                cx,
            );
            assert!(room.read(cx).scroll.offset().y < old.y);
            assert!(window.try_find("page-number").is_none());
            assert!(window.try_find("page-chrome").is_none());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn readonly_ruler_and_mobile_surface_cannot_mutate_layout(cx: &mut TestAppContext) {
        let layout = LayoutSettings::default();
        let (handle, _, ruler, _) = room(cx, layout.clone(), 1280., "<p>Read only.</p>");
        let captured = events(cx, &ruler);
        cx.update_window(handle, |_, window, cx| {
            ruler.update(cx, |ruler, cx| ruler.set_read_only(true, cx));
            window.render_frame(cx);
            let bounds = window.find("page-ruler").bounds();
            let start = window.find("page-ruler-left").bounds().center();
            window.drag(start, point(bounds.left() + px(80.), bounds.top()), cx);
            window.click("page-ruler-right", cx);
            window.press("left", cx);
            assert_eq!(ruler.read(cx).layout, layout);
        })
        .unwrap();
        assert!(captured.lock().unwrap().is_empty());
        let (mobile, _, _, _) = room(cx, layout, 640., "<p>A small window.</p>");
        cx.update_window(mobile, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.try_find("page-ruler").is_none());
        })
        .unwrap();
    }
}
