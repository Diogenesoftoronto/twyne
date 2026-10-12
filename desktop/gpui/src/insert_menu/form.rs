//! Parameter entry for slash insertion. No document changes happen here.
use super::parameters::{FormKind, Parameters};
use crate::{
    chrome::{dept_label, paper_button},
    theme::{MONO_FONT, SANS_FONT, palette},
};
use gpui_kit::component::{
    Sizable,
    input::{InputEvent, Textarea, TextareaState},
};
use gpui_kit::{
    Context, Entity, EventEmitter, FocusHandle, Focusable, Render, Role, Subscription,
    TestSupportExt, Window, div, prelude::*, px, rgb,
};

#[path = "modal_preview.rs"]
mod modal_preview;
#[path = "text_modal_view.rs"]
mod text_modal;

#[derive(Clone, Debug)]
pub enum FormEvent {
    Insert(Parameters),
    Cancel,
}

pub struct InsertFormView {
    kind: FormKind,
    primary: Entity<TextareaState>,
    secondary: Entity<TextareaState>,
    error: Option<&'static str>,
    cancel_focus: FocusHandle,
    submit_focus: FocusHandle,
    retired: bool,
    preview: modal_preview::PreviewState,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<FormEvent> for InsertFormView {}

impl InsertFormView {
    pub fn new(kind: FormKind, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let primary = cx.new(|cx| {
            let state = TextareaState::new(window, cx).submit_on_enter(!kind.multiline());
            if let Some(spec) = super::modal_spec::spec(kind) {
                // This surface supplies a wrapped, italic placeholder. The kit's
                // single-line placeholder clips the original multi-line copy.
                state.rows(spec.rows)
            } else {
                state.auto_grow(1, 1)
            }
        });
        let secondary = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, 1)
                .submit_on_enter(true)
        });
        let subscriptions = [&primary, &secondary]
            .into_iter()
            .map(|field| {
                cx.subscribe_in(field, window, |this, _, event, window, cx| match event {
                    InputEvent::Change => {
                        if this.retired {
                            return;
                        }
                        this.error = None;
                        this.schedule_preview(window, cx);
                        cx.notify();
                    }
                    InputEvent::PressEnter { shift: false, .. } if !this.kind.multiline() => {
                        this.submit(cx)
                    }
                    _ => {}
                })
            })
            .collect();
        primary.update(cx, |s, cx| {
            s.set_selected_range(0..s.text().len(), cx);
            s.focus(window, cx);
        });
        Self {
            kind,
            primary,
            secondary,
            error: None,
            cancel_focus: cx.focus_handle().tab_stop(true),
            submit_focus: cx.focus_handle().tab_stop(true),
            retired: false,
            preview: Default::default(),
            _subscriptions: subscriptions,
        }
    }
    pub fn current_values(&self, cx: &gpui_kit::App) -> Result<Parameters, &'static str> {
        self.kind.values(
            &self.primary.read(cx).value(),
            &self.secondary.read(cx).value(),
        )
    }
    pub fn submit(&mut self, cx: &mut Context<Self>) {
        if self.retired
            || self.primary.read(cx).is_composing()
            || self.secondary.read(cx).is_composing()
        {
            return;
        }
        if self.is_text_modal() && self.primary.read(cx).value().trim().is_empty() {
            return;
        }
        match self.current_values(cx) {
            Ok(values) => cx.emit(FormEvent::Insert(values)),
            Err(message) => {
                self.error = Some(message);
                cx.notify();
            }
        }
    }
    pub fn cancel(&mut self, cx: &mut Context<Self>) {
        if self.retired {
            return;
        }
        cx.emit(FormEvent::Cancel);
    }
    pub fn is_text_modal(&self) -> bool {
        super::modal_spec::spec(self.kind).is_some()
    }
    pub fn retire(&mut self, cx: &mut Context<Self>) {
        self.retired = true;
        self.preview.generation = self.preview.generation.saturating_add(1);
        self.preview.task = None;
        cx.notify();
    }
    fn next_field(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.kind.secondary_label().is_some() {
            let next = if self.primary.read(cx).focus_handle(cx).is_focused(window) {
                &self.secondary
            } else {
                &self.primary
            };
            next.update(cx, |s, cx| s.focus(window, cx));
        } else {
            self.primary.update(cx, |s, cx| s.focus(window, cx));
        }
    }
    pub fn is_focused(&self, window: &Window, cx: &gpui_kit::App) -> bool {
        self.primary.read(cx).focus_handle(cx).is_focused(window)
            || self.secondary.read(cx).focus_handle(cx).is_focused(window)
    }
}

impl Render for InsertFormView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.is_text_modal() {
            return self.render_text_modal(window, cx);
        }
        let p = *palette(cx);
        div()
            .id("slash-insert-form")
            .test_support()
            .role(Role::Dialog)
            .aria_label(self.kind.title())
            .occlude()
            .w(px(320.))
            .max_w_full()
            .p(px(16.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .bg(rgb(p.paper))
            .border_1()
            .border_color(rgb(p.rule))
            .rounded(px(2.))
            .shadow_lg()
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::Escape, _, cx| {
                    this.cancel(cx);
                    cx.stop_propagation();
                }),
            )
            .capture_action(cx.listener(
                |this, _: &gpui_kit::base::input::IndentInline, window, cx| {
                    this.next_field(window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(cx.listener(
                |this, _: &gpui_kit::base::input::OutdentInline, window, cx| {
                    this.next_field(window, cx);
                    cx.stop_propagation();
                },
            ))
            .capture_action(
                cx.listener(|this, action: &gpui_kit::base::input::Enter, _, cx| {
                    if action.secondary && this.kind.multiline() {
                        this.submit(cx);
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .child(dept_label(self.kind.title(), cx))
            .child(
                div()
                    .font_family(SANS_FONT)
                    .text_size(px(12.))
                    .text_color(rgb(p.ink_muted))
                    .child(self.kind.primary_label()),
            )
            .child(
                div().id("slash-insert-primary").test_support().child(
                    Textarea::new(&self.primary)
                        .small()
                        .font_family(if self.kind.multiline() {
                            MONO_FONT
                        } else {
                            SANS_FONT
                        })
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .aria_label(self.kind.primary_label()),
                ),
            )
            .when_some(self.kind.secondary_label(), |s, label| {
                s.child(
                    div()
                        .font_family(SANS_FONT)
                        .text_size(px(12.))
                        .text_color(rgb(p.ink_muted))
                        .child(label),
                )
                .child(
                    div().id("slash-insert-secondary").test_support().child(
                        Textarea::new(&self.secondary)
                            .small()
                            .font_family(SANS_FONT)
                            .text_size(px(14.))
                            .line_height(px(20.))
                            .aria_label(label),
                    ),
                )
            })
            .when_some(self.error, |s, message| {
                s.child(
                    div()
                        .id("slash-insert-error")
                        .test_support()
                        .role(Role::Alert)
                        .text_size(px(12.))
                        .text_color(rgb(p.vermilion))
                        .child(message),
                )
            })
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        paper_button("slash-insert-cancel", "Cancel", None, cx)
                            .on_click(cx.listener(|this, _, _, cx| this.cancel(cx))),
                    )
                    .child(
                        paper_button("slash-insert-confirm", "Insert", None, cx)
                            .on_click(cx.listener(|this, _, _, cx| this.submit(cx))),
                    ),
            )
            .into_any_element()
    }
}
