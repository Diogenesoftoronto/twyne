//! Retained slash list. It owns filtering/selection/scroll, never document text.
use super::{Candidate, candidates};
use crate::{
    chrome::tracked_typewriter,
    theme::{SANS_FONT, SERIF_FONT, TYPEWRITER_FONT, palette},
};
use gpui_kit::{
    Context, EventEmitter, FontWeight, MouseButton, Render, Role, ScrollHandle, SharedString,
    TestSupportExt, Window, div, prelude::*, px, rgb,
};

#[derive(Clone, Debug)]
pub enum MenuEvent {
    Choose { id: String, binding: u64 },
    Dismiss { binding: u64 },
}

pub struct InsertMenuView {
    query: String,
    rows: Vec<Candidate>,
    selected: Option<&'static str>,
    scroll: ScrollHandle,
    max_height: f32,
    binding: u64,
}
impl EventEmitter<MenuEvent> for InsertMenuView {}

impl InsertMenuView {
    pub fn new(query: &str, _: &mut Context<Self>) -> Self {
        let rows = candidates(query);
        let selected = rows.first().map(|r| r.command.id.as_str());
        Self {
            query: query.to_owned(),
            rows,
            selected,
            scroll: ScrollHandle::new(),
            max_height: 320.,
            binding: 0,
        }
    }
    pub fn set_binding(&mut self, binding: u64, cx: &mut Context<Self>) {
        if self.binding != binding {
            self.binding = binding;
            cx.notify();
        }
    }
    pub fn set_query(&mut self, query: &str, cx: &mut Context<Self>) {
        if self.query == query {
            return;
        }
        self.query = query.to_owned();
        self.rows = candidates(query);
        if !self
            .rows
            .iter()
            .any(|r| Some(r.command.id.as_str()) == self.selected)
        {
            self.selected = self.rows.first().map(|r| r.command.id.as_str());
        }
        self.reveal_selection();
        cx.notify();
    }
    pub fn selected(&self) -> Option<&'static str> {
        self.selected
    }
    pub fn has_candidates(&self) -> bool {
        !self.rows.is_empty()
    }
    pub fn move_selection(&mut self, direction: isize, cx: &mut Context<Self>) {
        if self.rows.is_empty() {
            return;
        }
        let current = self
            .rows
            .iter()
            .position(|r| Some(r.command.id.as_str()) == self.selected)
            .unwrap_or(0);
        let next = (current as isize + direction).rem_euclid(self.rows.len() as isize) as usize;
        self.selected = Some(self.rows[next].command.id.as_str());
        self.reveal_selection();
        cx.notify();
    }
    fn reveal_selection(&self) {
        if let Some(index) = self
            .rows
            .iter()
            .position(|r| Some(r.command.id.as_str()) == self.selected)
        {
            self.scroll.scroll_to_item(index);
        }
    }
    pub fn set_max_height(&mut self, height: f32, cx: &mut Context<Self>) {
        let height = height.clamp(0., 320.);
        if self.max_height != height {
            self.max_height = height;
            cx.notify();
        }
    }
}

pub fn option_id(command: &str) -> String {
    format!("slash-command-{}", command.replace('.', "-"))
}

impl Render for InsertMenuView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = *palette(cx);
        let binding = self.binding;
        let mut results = div()
            .id("slash-command-results")
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .max_h(px(self.max_height))
            .py(px(4.));
        if self.rows.is_empty() {
            results = results.child(
                div()
                    .px(px(12.))
                    .py(px(20.))
                    .text_center()
                    .font_family(SERIF_FONT)
                    .text_size(px(14.))
                    .text_color(rgb(p.ink_muted))
                    .child("No commands match."),
            );
        }
        let mut previous_group = None;
        for row in &self.rows {
            let command = row.command;
            let selected = self.selected == Some(command.id.as_str());
            let mut item = div();
            if previous_group != Some(command.group.as_str()) {
                item = item.child(
                    div()
                        .border_b_1()
                        .border_color(rgb(p.rule))
                        .bg(rgb(p.paper_soft))
                        .px(px(12.))
                        .py(px(4.))
                        .child(tracked_typewriter(
                            &command.group.to_uppercase(),
                            9.28,
                            1.4848,
                            p.ink_muted,
                        )),
                );
            }
            previous_group = Some(command.group.as_str());
            let id = command.id.as_str();
            item = item.child(
                div()
                    .id(SharedString::from(option_id(id)))
                    .test_support()
                    .role(Role::ListBoxOption)
                    .aria_label(format!("{}: {}", command.label, command.description))
                    .aria_selected(selected)
                    .w_full()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .px(px(12.))
                    .py(px(8.))
                    .text_color(rgb(if selected { p.vermilion } else { p.ink }))
                    .when(selected, |s| s.bg(rgb(p.sidebar)).aria_active_descendant())
                    .hover(|s| s.bg(rgb(p.paper_soft)))
                    .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                        if *hovered && this.selected != Some(id) {
                            this.selected = Some(id);
                            cx.notify();
                        }
                    }))
                    .on_mouse_down(MouseButton::Left, |_, window, cx| {
                        window.prevent_default();
                        cx.stop_propagation();
                    })
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(MenuEvent::Choose {
                            id: id.to_owned(),
                            binding,
                        })
                    }))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .font_family(SANS_FONT)
                                    .text_size(px(14.))
                                    .line_height(px(20.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .truncate()
                                    .child(command.label.clone()),
                            )
                            .child(
                                div()
                                    .mt(px(2.))
                                    .font_family(SERIF_FONT)
                                    .text_size(px(12.))
                                    .line_height(px(16.))
                                    .text_color(rgb(p.ink_muted))
                                    .truncate()
                                    .child(command.description.clone()),
                            ),
                    )
                    .when_some(command.shortcut.as_ref(), |row, shortcut| {
                        row.child(
                            div()
                                .id(format!("slash-hint-{}", id.replace('.', "-")))
                                .test_support()
                                .flex_shrink_0()
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(9.92))
                                .line_height(px(14.88))
                                .text_color(rgb(p.ink_muted))
                                .child(shortcut.clone()),
                        )
                    }),
            );
            results = results.child(item);
        }
        div()
            .id("slash-command-menu")
            .test_support()
            .role(Role::ListBox)
            .aria_label("Insert command")
            .occlude()
            .w(px(288.))
            .max_w_full()
            .border_1()
            .border_color(rgb(p.rule))
            .bg(rgb(p.paper))
            .rounded(px(2.))
            .shadow_lg()
            .on_mouse_down_out(
                cx.listener(move |_, _, _, cx| cx.emit(MenuEvent::Dismiss { binding })),
            )
            .child(
                div()
                    .border_b_1()
                    .border_color(rgb(p.rule))
                    .px(px(12.))
                    .py(px(8.))
                    .child(tracked_typewriter(
                        &format!(
                            "INSERT {}",
                            if self.query.is_empty() {
                                "A BLOCK".to_owned()
                            } else {
                                format!("“{}”", self.query)
                            }
                        ),
                        9.92,
                        1.5872,
                        p.ink_muted,
                    )),
            )
            .child(results)
    }
}
