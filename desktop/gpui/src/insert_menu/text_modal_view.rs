//! Original centered note/diagram dialog presentation; document ownership stays
//! in the host. Copy is generated from insert-panels.tsx.
use super::*;
use crate::{
    chrome::{tracked_text, tracked_typewriter},
    theme::{BUTTON_FONT, DISPLAY_FONT, TYPEWRITER_FONT},
};
use gpui_kit::base::Button;
use gpui_kit::{AnyElement, BoxShadow, FontWeight, MouseButton, font, point};

impl InsertFormView {
    pub(super) fn render_text_modal(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let p = *palette(cx);
        let spec = crate::insert_menu::modal_spec::spec(self.kind).unwrap();
        let focused = self.primary.read(cx).focus_handle(cx).is_focused(window);
        let empty = self.primary.read(cx).value().is_empty();
        let disabled = self.retired || self.primary.read(cx).value().trim().is_empty();
        let wide =
            self.kind == FormKind::Mermaid && f32::from(window.viewport_size().width) >= 768.;
        let input = div()
            .flex_1()
            .min_w_0()
            .child(
                div()
                    .id("slash-insert-label")
                    .test_support()
                    .mb(px(4.))
                    .child(tracked_typewriter(
                        &spec.input_label.to_uppercase(),
                        10.4,
                        1.872,
                        p.ink_muted,
                    )),
            )
            .child(
                div()
                    .id("slash-insert-primary")
                    .test_support()
                    .relative()
                    .child(
                        Textarea::new(&self.primary)
                            .accessibility_id("slash-text-modal-input")
                            .aria_label(spec.input_label.clone())
                            .appearance(false)
                            .w_full()
                            .h(px(spec.min_height_rem * 16.))
                            .min_h(px(spec.min_height_rem * 16.))
                            .px(px(12.))
                            .py(px(8.))
                            .border_1()
                            .border_color(rgb(if focused { p.vermilion } else { p.rule }))
                            .rounded(px(2.))
                            .bg(rgb(p.paper_soft))
                            .text_color(rgb(p.ink))
                            .font_family(TYPEWRITER_FONT)
                            .font_weight(FontWeight::NORMAL)
                            .text_size(px(14.))
                            .line_height(px(21.)),
                    )
                    .when(empty, |s| {
                        s.child(
                            div()
                                .id("slash-text-modal-placeholder")
                                .test_support()
                                .absolute()
                                .top(px(9.))
                                .left(px(13.))
                                .right(px(13.))
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(14.))
                                .line_height(px(21.))
                                .italic()
                                .whitespace_normal()
                                .text_color(rgb(p.ink_muted))
                                .child(spec.placeholder.clone())
                                .on_mouse_down(
                                    MouseButton::Left,
                                    cx.listener(|this, _, window, cx| {
                                        this.primary.update(cx, |s, cx| s.focus(window, cx));
                                        cx.stop_propagation();
                                    }),
                                ),
                        )
                    }),
            )
            .child(
                div()
                    .id("slash-insert-help")
                    .test_support()
                    // The original inline textarea leaves 7px of baseline
                    // space before the help paragraph's 8px top margin.
                    .mt(px(15.))
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(10.88))
                    .line_height(px(16.32))
                    .text_color(rgb(p.ink_muted))
                    .child(spec.help_text.clone()),
            );
        let body = div()
            .mt(px(16.))
            .flex()
            .when(wide, |s| s.flex_row().gap(px(16.)))
            .when(!wide, |s| s.flex_col().gap(px(16.)))
            .child(input)
            .when(self.kind == FormKind::Mermaid, |s| {
                s.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div().mb(px(4.)).child(tracked_typewriter(
                                &spec
                                    .preview_label
                                    .as_deref()
                                    .unwrap_or("Preview")
                                    .to_uppercase(),
                                10.4,
                                1.872,
                                p.ink_muted,
                            )),
                        )
                        .child(self.preview_element(cx)),
                )
            });
        let cancel = Button::new("slash-insert-cancel")
            .h_auto()
            .track_focus(&self.cancel_focus)
            .accessibility_label("Cancel")
            .px(px(14.4))
            .py(px(7.2))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(2.))
            .bg(rgb(p.paper_soft))
            .text_color(rgb(p.ink))
            .font_family(BUTTON_FONT)
            .font_weight(FontWeight::SEMIBOLD)
            .text_size(px(12.))
            .line_height(px(16.))
            .child("Cancel")
            .on_click(cx.listener(|this, _, _, cx| this.cancel(cx)));
        let label: &'static str = crate::insert_menu::modal_spec::spec(self.kind)
            .unwrap()
            .submit_label
            .as_str();
        let confirm = Button::new("slash-insert-confirm")
            .accessibility_label(label)
            .h_auto()
            .track_focus(&self.submit_focus)
            .px(px(16.))
            .py(px(8.8))
            .border_1()
            .rounded(px(2.))
            .bg(rgb(p.vermilion))
            .border_color(rgb(p.vermilion))
            .child(tracked_text(
                &label.to_uppercase(),
                font(TYPEWRITER_FONT),
                11.2,
                2.016,
                p.paper,
                14.933333,
            ))
            .disabled(disabled)
            .when(disabled, |button| button.opacity(0.4))
            .on_click(cx.listener(|this, _, _, cx| this.submit(cx)));
        div()
            .id("slash-insert-form")
            .test_support()
            .role(Role::Dialog)
            .aria_label(spec.title.clone())
            .occlude()
            .w_full()
            .max_w(px(if self.kind == FormKind::Mermaid {
                896.
            } else {
                512.
            }))
            .flex()
            .flex_col()
            .p(px(20.))
            .bg(rgb(p.paper_soft))
            .text_color(rgb(p.ink))
            .border_1()
            .border_color(rgb(p.rule))
            .shadow(vec![
                BoxShadow {
                    color: rgb(p.emboss).opacity(0.6).into(),
                    offset: point(px(0.), px(1.)),
                    blur_radius: px(0.),
                    spread_radius: px(0.),
                    inset: true,
                },
                BoxShadow {
                    color: rgb(p.shade).opacity(0.4).into(),
                    offset: point(px(0.), px(14.)),
                    blur_radius: px(32.),
                    spread_radius: px(-22.),
                    inset: false,
                },
                BoxShadow {
                    color: rgb(p.shade).opacity(0.05).into(),
                    offset: point(px(0.), px(2.)),
                    blur_radius: px(0.),
                    spread_radius: px(0.),
                    inset: false,
                },
            ])
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(|_, _, cx| cx.stop_propagation())
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::Escape, _, cx| {
                    if this.primary.read(cx).is_composing() {
                        cx.propagate();
                        return;
                    }
                    this.cancel(cx);
                    cx.stop_propagation();
                }),
            )
            .capture_action(
                cx.listener(|this, action: &gpui_kit::base::input::Enter, _, cx| {
                    if action.secondary && !this.primary.read(cx).is_composing() {
                        this.submit(cx);
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_action(cx.listener(
                |_, _: &gpui_kit::base::input::IndentInline, window, cx| {
                    window.focus_next(cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |_, _: &gpui_kit::base::input::OutdentInline, window, cx| {
                    window.focus_prev(cx);
                    cx.stop_propagation();
                },
            ))
            .child(div().mb(px(8.)).child(tracked_typewriter(
                &spec.kicker.to_uppercase(),
                10.,
                3.2,
                p.ink_muted,
            )))
            .child(
                div()
                    .id("slash-insert-title")
                    .test_support()
                    .font_family(DISPLAY_FONT)
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(16.))
                    .line_height(px(24.))
                    .child(spec.title.clone()),
            )
            .child(
                div()
                    .id("slash-insert-description")
                    .test_support()
                    .mt(px(8.))
                    .font_family(SANS_FONT)
                    .text_size(px(14.))
                    .line_height(px(22.75))
                    .text_color(rgb(p.ink_light))
                    .child(spec.description.clone()),
            )
            .child(body)
            .child(
                div()
                    .mt(px(20.))
                    .flex()
                    .justify_end()
                    .items_center()
                    .gap(px(8.))
                    .child(cancel)
                    .child(confirm),
            )
            .into_any_element()
    }
}
