use super::*;
use gpui_kit::component::input::{Redo, RopeExt, Undo};
use gpui_kit::{AnyElement, MouseButton};
use twyne_desktop::source_editor::{self, Snippet};
use twyne_desktop::source_view::{
    SourceToolState, ribbon_button as source_button, ribbon_group as source_group,
};

#[derive(Clone, Copy)]
enum SourceCommand {
    Undo,
    Redo,
    Find,
    GoToLine,
}

impl WritingRoom {
    fn source_writable(&self) -> bool {
        self.source_session.is_some() && !self.active_document().archived && !self.applying_source
    }

    fn source_command(
        &mut self,
        command: SourceCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !matches!(command, SourceCommand::Find | SourceCommand::GoToLine)
            && !self.source_writable()
        {
            return;
        }
        match command {
            SourceCommand::Undo | SourceCommand::Redo => {
                self.source.update(cx, |state, cx| state.focus(window, cx));
                if matches!(command, SourceCommand::Undo) {
                    window.dispatch_action(Box::new(Undo), cx);
                } else {
                    window.dispatch_action(Box::new(Redo), cx);
                }
            }
            SourceCommand::Find => self
                .source
                .update(cx, |state, cx| state.open_search(true, cx)),
            SourceCommand::GoToLine => self.show_source_line_prompt(window, cx),
        }
        cx.notify();
    }

    pub(super) fn show_source_line_prompt(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.source_mode {
            return;
        }
        let line = self.source.read(cx).cursor_position().line + 1;
        self.source_go_to_line = true;
        self.source_line.update(cx, |state, cx| {
            state.set_value(line.to_string(), window, cx);
            state.focus(window, cx);
        });
        cx.notify();
    }

    pub(super) fn go_to_source_line(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(line) = self.source_line.read(cx).value().trim().parse::<usize>() else {
            return;
        };
        let lines = self.source.read(cx).text().lines_len();
        if line == 0 || line > lines {
            return;
        }
        self.source.update(cx, |state, cx| {
            let offset = state.text().line_start_offset(line - 1);
            let position = state.text().offset_to_position(offset);
            state.unfold_at(position, cx);
            state.set_cursor_position(position, window, cx);
        });
        self.source_go_to_line = false;
        cx.notify();
    }

    pub(super) fn toggle_source_comment(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.source_writable() {
            return;
        }
        self.source.update(cx, |state, cx| {
            let selected = state.selected_range();
            let text = state.text();
            let first = text.offset_to_point(selected.start).row;
            let mut last = text.offset_to_point(selected.end).row;
            if selected.end > selected.start
                && last > first
                && selected.end == text.line_start_offset(last)
            {
                last -= 1;
            }
            let start = text.line_start_offset(first);
            let end = text.line_end_offset(last);
            let edit = source_editor::comment_edit(
                &text.slice(start..end).to_string(),
                selected.start - start..selected.end - start,
            );
            state.replace_range_with_selection(
                start..end,
                edit.text,
                start + edit.selection.start..start + edit.selection.end,
                window,
                cx,
            );
            state.focus(window, cx);
        });
        cx.notify();
    }

    fn insert_source_snippet(
        &mut self,
        kind: Snippet,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.source_writable() {
            return;
        }
        self.source.update(cx, |state, cx| {
            let selected = state.selected_range();
            let row = state.text().offset_to_point(selected.start).row;
            let at_line_start = state.text().line_start_offset(row) == selected.start;
            let insertion =
                source_editor::snippet(kind, &state.selected_text().to_string(), at_line_start);
            state.replace_range_with_selection(
                selected.clone(),
                insertion.text,
                selected.start + insertion.selection.start
                    ..selected.start + insertion.selection.end,
                window,
                cx,
            );
            state.focus(window, cx);
        });
        cx.notify();
    }

    pub(super) fn source_ribbon(&self, cx: &mut Context<Self>) -> AnyElement {
        let readonly = !self.source_writable();
        let can_undo = self.source.read(cx).can_undo();
        let can_redo = self.source.read(cx).can_redo();
        let history = [
            (
                "source-undo",
                "Undo source edit",
                "undo",
                SourceCommand::Undo,
            ),
            (
                "source-redo",
                "Redo source edit",
                "redo",
                SourceCommand::Redo,
            ),
        ]
        .into_iter()
        .map(|(id, label, icon, command)| {
            let available = if matches!(command, SourceCommand::Undo) {
                can_undo
            } else {
                can_redo
            };
            source_button(
                id,
                label,
                None,
                icon,
                SourceToolState {
                    disabled: readonly || !available,
                    ..Default::default()
                },
                cx,
            )
            .on_click(
                cx.listener(move |this, _, window, cx| this.source_command(command, window, cx)),
            )
            .into_any_element()
        })
        .collect::<Vec<_>>();
        let navigation =
            [
                (
                    "source-find",
                    "Find and replace in source",
                    "Find",
                    "search",
                    SourceCommand::Find,
                ),
                (
                    "source-go-to-line",
                    "Go to line",
                    "Go to line",
                    "list",
                    SourceCommand::GoToLine,
                ),
            ]
            .into_iter()
            .map(|(id, label, text, icon, command)| {
                source_button(id, label, Some(text), icon, SourceToolState::default(), cx)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.source_command(command, window, cx)
                    }))
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let inserts =
            [
                (
                    "source-insert-bold",
                    "Insert bold",
                    "text-bold",
                    Snippet::Bold,
                ),
                (
                    "source-insert-italic",
                    "Insert italic",
                    "text-italic",
                    Snippet::Italic,
                ),
                (
                    "source-insert-heading",
                    "Insert heading",
                    "heading",
                    Snippet::Heading,
                ),
                (
                    "source-insert-equation",
                    "Insert equation",
                    "math",
                    Snippet::Equation,
                ),
                ("source-insert-link", "Insert link", "link", Snippet::Link),
                (
                    "source-insert-page-break",
                    "Insert page break",
                    "page",
                    Snippet::PageBreak,
                ),
            ]
            .into_iter()
            .map(|(id, label, icon, kind)| {
                source_button(
                    id,
                    label,
                    None,
                    icon,
                    SourceToolState {
                        disabled: readonly,
                        ..Default::default()
                    },
                    cx,
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.insert_source_snippet(kind, window, cx)
                }))
                .into_any_element()
            })
            .collect::<Vec<_>>();
        let comment = source_button(
            "source-comment",
            "Toggle comment",
            Some("Comment"),
            "code",
            SourceToolState {
                disabled: readonly,
                ..Default::default()
            },
            cx,
        )
        .on_click(cx.listener(|this, _, window, cx| this.toggle_source_comment(window, cx)))
        .into_any_element();
        let wrap = source_button(
            "source-wrap",
            "Wrap lines",
            Some("Wrap"),
            "text-wrap",
            SourceToolState {
                pressed: self.source_wrapping,
                ..Default::default()
            },
            cx,
        )
        .toggled(self.source_wrapping)
        .on_click(cx.listener(|this, _, window, cx| {
            this.source_wrapping = !this.source_wrapping;
            this.source.update(cx, |state, cx| {
                state.set_soft_wrap(this.source_wrapping, window, cx)
            });
            cx.notify();
        }))
        .into_any_element();
        let save = source_button(
            "save-source-copy",
            "Save source copy",
            Some("Save .typ"),
            "code-file",
            SourceToolState {
                disabled: self.source_session.is_none(),
                ..Default::default()
            },
            cx,
        )
        .on_click(cx.listener(|this, _, window, cx| this.export(false, window, cx)))
        .into_any_element();
        div()
            .id("source-ribbon")
            .test_support()
            .role(Role::Toolbar)
            .aria_label("Typst source tools")
            .flex()
            .items_center()
            .w_full()
            .h(px(twyne_desktop::source_view::SOURCE_RIBBON_HEIGHT_PX))
            .min_h(px(twyne_desktop::source_view::SOURCE_RIBBON_HEIGHT_PX))
            .flex_shrink_0()
            .bg(rgb(palette(cx).paper_soft))
            .border_t_1()
            .border_color(rgb(palette(cx).rule))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .children([
                source_group("Source history", history, false, cx),
                source_group("Source navigation", navigation, false, cx),
                source_group("Insert Typst", inserts, false, cx),
                source_group("Code tools", [comment, wrap], false, cx),
                source_group("Source file", [save], true, cx),
            ])
            .into_any_element()
    }

    pub(super) fn source_line_prompt(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id("source-line-prompt")
            .test_support()
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(40.))
            .flex_shrink_0()
            .px(px(12.))
            .bg(rgb(palette(cx).paper_soft))
            .border_b_1()
            .border_color(rgb(palette(cx).rule))
            .text_size(px(12.))
            .child("Go to line")
            .child(
                Input::new(&self.source_line)
                    .id("source-line-number")
                    .w(px(100.))
                    .aria_label("Line number"),
            )
            .child(
                tool_button("source-line-go", "Go", None, cx).on_click(
                    cx.listener(|this, _, window, cx| this.go_to_source_line(window, cx)),
                ),
            )
            .child(
                tool_button("source-line-close", "Cancel", None, cx).on_click(cx.listener(
                    |this, _, window, cx| {
                        this.source_go_to_line = false;
                        this.source.update(cx, |state, cx| state.focus(window, cx));
                        cx.notify();
                    },
                )),
            )
            .into_any_element()
    }
}
