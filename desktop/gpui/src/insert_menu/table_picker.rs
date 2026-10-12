//! Original table-size grid; emits dimensions without owning the manuscript.
use super::table_grid::{DEFAULT_COLUMNS, DEFAULT_ROWS, Dimensions, Direction};
use crate::theme::{TYPEWRITER_FONT, palette};
use gpui_kit::{
    App, BoxShadow, Context, EventEmitter, FocusHandle, Focusable, FontWeight, KeyBinding,
    MouseButton, Render, Role, Subscription, TestSupportExt, Window, div, point, prelude::*, px,
    rgb,
};

gpui_kit::actions!(
    twyne_table_picker,
    [Up, Down, Left, Right, Home, End, Insert, Cancel]
);
const KEY_CONTEXT: &str = "TwyneTablePicker";
struct BindingsInstalled;
impl gpui_kit::Global for BindingsInstalled {}

pub fn init(cx: &mut App) {
    if cx.try_global::<BindingsInstalled>().is_some() {
        return;
    }
    cx.set_global(BindingsInstalled);
    cx.bind_keys([
        KeyBinding::new("up", Up, Some(KEY_CONTEXT)),
        KeyBinding::new("down", Down, Some(KEY_CONTEXT)),
        KeyBinding::new("left", Left, Some(KEY_CONTEXT)),
        KeyBinding::new("right", Right, Some(KEY_CONTEXT)),
        KeyBinding::new("home", Home, Some(KEY_CONTEXT)),
        KeyBinding::new("end", End, Some(KEY_CONTEXT)),
        KeyBinding::new("enter", Insert, Some(KEY_CONTEXT)),
        KeyBinding::new("escape", Cancel, Some(KEY_CONTEXT)),
    ]);
}

#[derive(Clone, Debug)]
pub enum TablePickerEvent {
    Insert(Dimensions),
    Cancel,
}

pub struct TablePickerView {
    focus: FocusHandle,
    cells: Vec<FocusHandle>,
    selected: Dimensions,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<TablePickerEvent> for TablePickerView {}
impl Focusable for TablePickerView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl TablePickerView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        init(cx);
        let focus = cx.focus_handle().tab_stop(true);
        let cells = (0..DEFAULT_ROWS * DEFAULT_COLUMNS)
            .map(|_| cx.focus_handle().tab_stop(true))
            .collect::<Vec<_>>();
        let subscriptions = cells
            .iter()
            .enumerate()
            .map(|(index, focus)| {
                cx.on_focus(focus, window, move |this, _, cx| {
                    this.select(
                        Dimensions {
                            rows: index / DEFAULT_COLUMNS + 1,
                            columns: index % DEFAULT_COLUMNS + 1,
                        },
                        cx,
                    );
                })
            })
            .collect();
        Self {
            focus,
            cells,
            selected: Dimensions {
                rows: 1,
                columns: 1,
            },
            _subscriptions: subscriptions,
        }
    }
    pub fn selected(&self) -> Dimensions {
        self.selected
    }
    fn limits() -> Dimensions {
        Dimensions {
            rows: DEFAULT_ROWS,
            columns: DEFAULT_COLUMNS,
        }
    }
    fn select(&mut self, dimensions: Dimensions, cx: &mut Context<Self>) {
        let next = dimensions.clamped(Self::limits());
        if self.selected != next {
            self.selected = next;
            cx.notify();
        }
    }
    fn resize(&mut self, direction: Direction, cx: &mut Context<Self>) {
        self.select(self.selected.moved(direction, Self::limits()), cx);
    }
}

impl Render for TablePickerView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = *palette(cx);
        let mut grid = div()
            .id("slash-table-grid")
            .test_support()
            .role(Role::Grid)
            .aria_label("Choose table size")
            .aria_row_count(DEFAULT_ROWS)
            .aria_column_count(DEFAULT_COLUMNS)
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus)
            .flex()
            .flex_col()
            .gap(px(4.))
            .on_action(cx.listener(|this, _: &Up, _, cx| this.resize(Direction::ArrowUp, cx)))
            .on_action(cx.listener(|this, _: &Down, _, cx| this.resize(Direction::ArrowDown, cx)))
            .on_action(cx.listener(|this, _: &Left, _, cx| this.resize(Direction::ArrowLeft, cx)))
            .on_action(cx.listener(|this, _: &Right, _, cx| this.resize(Direction::ArrowRight, cx)))
            .on_action(cx.listener(|this, _: &Home, _, cx| this.resize(Direction::Home, cx)))
            .on_action(cx.listener(|this, _: &End, _, cx| this.resize(Direction::End, cx)))
            .on_action(cx.listener(|this, _: &Insert, _, cx| {
                cx.emit(TablePickerEvent::Insert(this.selected))
            }))
            .on_action(cx.listener(|_, _: &Cancel, _, cx| cx.emit(TablePickerEvent::Cancel)))
            .focus_visible(|style| {
                style.shadow(vec![BoxShadow {
                    color: rgb(p.vermilion).into(),
                    offset: point(px(0.), px(0.)),
                    blur_radius: px(0.),
                    spread_radius: px(2.),
                    inset: false,
                }])
            });
        for row in 1..=DEFAULT_ROWS {
            let mut cells = div().flex().gap(px(4.));
            for column in 1..=DEFAULT_COLUMNS {
                let dimensions = Dimensions {
                    rows: row,
                    columns: column,
                };
                let focus = self.cells[(row - 1) * DEFAULT_COLUMNS + column - 1].clone();
                let selected = self.selected.contains(dimensions);
                cells = cells.child(
                    div()
                        .id(format!("slash-table-cell-{row}-{column}"))
                        .test_support()
                        .role(Role::Cell)
                        .aria_label(format!("{row} by {column} table"))
                        .aria_row_index(row)
                        .aria_column_index(column)
                        .aria_selected(selected)
                        .track_focus(&focus)
                        .size(px(18.4))
                        .flex_shrink_0()
                        .border_1()
                        .border_color(rgb(if selected { p.vermilion } else { p.rule }))
                        .bg(if selected {
                            rgb(p.vermilion).opacity(0.22)
                        } else {
                            rgb(p.sidebar)
                        })
                        .hover(|style| style.border_color(rgb(p.ink_muted)))
                        .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                            if *hovered {
                                this.select(dimensions, cx);
                            }
                        }))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(move |_, _, window, cx| {
                                window.focus(&focus, cx);
                                cx.stop_propagation();
                            }),
                        )
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(TablePickerEvent::Insert(dimensions))
                        })),
                );
            }
            grid = grid.child(cells);
        }
        div()
            .id("slash-table-picker")
            .test_support()
            .occlude()
            .w(px(246.))
            .flex()
            .flex_col()
            .p(px(12.))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(4.))
            .bg(rgb(p.paper))
            .text_color(rgb(p.ink))
            .font_family(TYPEWRITER_FONT)
            .shadow(vec![BoxShadow {
                color: rgb(p.ink).opacity(0.12).into(),
                offset: point(px(0.), px(6.)),
                blur_radius: px(8.),
                spread_radius: px(0.),
                inset: false,
            }])
            .child(
                div()
                    .id("slash-table-size")
                    .test_support()
                    .mb(px(8.))
                    .text_size(px(11.52))
                    .line_height(px(17.28))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(format!(
                        "{} × {} table",
                        self.selected.rows, self.selected.columns
                    )),
            )
            .child(grid)
            .child(
                div()
                    .mt(px(8.))
                    .text_size(px(9.92))
                    .line_height(px(14.88))
                    .text_color(rgb(p.ink_muted))
                    .child("Arrow keys resize. Enter inserts."),
            )
    }
}
