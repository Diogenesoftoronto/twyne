//! Original card shell and naming field, retained for one tool identity.
use super::{
    border::accent_border,
    model::ToolSnapshot,
    view::{self, ToolAction, ToolEvent, ToolScope, ToolView},
};
use crate::{
    chrome,
    native_ai::request::js_trim,
    theme::{self, DISPLAY_FONT, SERIF_FONT},
};
use gpui_kit::base::{
    Button,
    input::{InputEvent, InputState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, Context, Entity, EventEmitter, FontWeight, Render, Role, SharedString,
    Subscription, TestSupportExt, Window, div, px, relative, rgb,
};
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone)]
pub enum CardAction {
    Body(ToolAction),
    FocusAnchor,
    Dismiss,
    Keep {
        request: Uuid,
        name: String,
        config: Value,
    },
}
#[derive(Clone)]
pub struct CardEvent {
    pub scope: ToolScope,
    pub tool: Uuid,
    pub action: CardAction,
}
pub struct ToolCardView {
    scope: ToolScope,
    snapshot: ToolSnapshot,
    body: Entity<ToolView>,
    name: Entity<InputState>,
    naming: bool,
    keep_error: Option<String>,
    pending_keep: Option<Uuid>,
    retired: bool,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<CardEvent> for ToolCardView {}
impl ToolCardView {
    pub fn new(
        scope: ToolScope,
        snapshot: ToolSnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let body = cx.new(|cx| ToolView::new(scope.clone(), snapshot.clone(), window, cx));
        let name = cx.new(|cx| InputState::new(window, cx).placeholder(snapshot.title()));
        let body_subscription = cx.subscribe(&body, |card, sender, event: &ToolEvent, cx| {
            if !card.retired
                && sender == card.body
                && event.scope == card.scope
                && event.tool == card.snapshot.id
            {
                card.emit(CardAction::Body(event.action.clone()), cx);
            }
        });
        let name_subscription = cx.subscribe(&name, |card, _, event: &InputEvent, cx| {
            if card.retired {
                return;
            }
            if let InputEvent::PressEnter { .. } = event {
                card.keep(cx);
            }
            if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                cx.notify();
            }
        });
        Self {
            scope,
            snapshot,
            body,
            name,
            naming: false,
            keep_error: None,
            pending_keep: None,
            retired: false,
            _subscriptions: vec![body_subscription, name_subscription],
        }
    }
    pub fn scope(&self) -> &ToolScope {
        &self.scope
    }
    pub fn snapshot(&self) -> &ToolSnapshot {
        &self.snapshot
    }
    pub fn update(
        &mut self,
        snapshot: ToolSnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.retired
            || snapshot.id != self.snapshot.id
            || snapshot.component() != self.snapshot.component()
        {
            return false;
        }
        if !self
            .body
            .update(cx, |body, cx| body.update(snapshot.clone(), window, cx))
        {
            return false;
        }
        self.snapshot = snapshot;
        cx.notify();
        true
    }
    fn emit(&self, action: CardAction, cx: &mut Context<Self>) {
        if !self.retired {
            cx.emit(CardEvent {
                scope: self.scope.clone(),
                tool: self.snapshot.id,
                action,
            });
        }
    }
    fn keep(&mut self, cx: &mut Context<Self>) {
        if self.retired
            || !self.naming
            || self.pending_keep.is_some()
            || self.snapshot.saved_id.is_some()
        {
            return;
        }
        let text = self.name.read(cx).value();
        let trimmed = js_trim(text.as_ref());
        let name = if trimmed.is_empty() {
            self.snapshot.title().to_owned()
        } else {
            trimmed.to_owned()
        };
        let request = Uuid::new_v4();
        self.pending_keep = Some(request);
        self.emit(
            CardAction::Keep {
                request,
                name,
                config: self.snapshot.kept_config(),
            },
            cx,
        );
    }
    pub fn finish_keep(
        &mut self,
        request: Uuid,
        result: Result<String, String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.retired || self.pending_keep != Some(request) {
            return false;
        }
        self.pending_keep = None;
        match result {
            Ok(id) => {
                let mut snapshot = self.snapshot.clone();
                snapshot.saved_id = Some(id);
                snapshot.notice = Some("Kept in Your tools.".into());
                self.update(snapshot, window, cx);
                self.naming = false;
                self.keep_error = None;
            }
            Err(_) => {
                self.keep_error = Some("Couldn't keep it — storage refused the write.".into())
            }
        }
        cx.notify();
        true
    }
    pub fn finish_jot(
        &mut self,
        request: Uuid,
        result: Result<(), String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.retired {
            return false;
        }
        self.body
            .update(cx, |body, cx| body.finish_jot(request, result.is_ok(), cx))
    }
    pub fn finish_research(
        &mut self,
        request: Uuid,
        result: Result<(), String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.retired {
            return false;
        }
        self.body
            .update(cx, |body, cx| body.finish_research(request, result, cx))
    }
    pub fn retire(&mut self, cx: &mut Context<Self>) {
        self.retired = true;
        self.pending_keep = None;
        self.body.update(cx, |body, cx| body.retire(cx));
        cx.notify();
    }
    fn footer(&self, colors: theme::Palette, cx: &mut Context<Self>) -> AnyElement {
        let footer = div()
            .flex()
            .flex_col()
            .gap(px(5.6))
            .pt(px(8.8))
            .border_t_1()
            .border_color(rgb(colors.rule));
        let footer = if self.snapshot.saved_id.is_some() {
            footer.child(
                div()
                    .text_size(px(12.))
                    .text_color(rgb(colors.ink_muted))
                    .child("In Your tools"),
            )
        } else if self.naming {
            footer.child(
                div()
                    .id("in-flow-name-row")
                    .flex()
                    .items_center()
                    .gap(px(6.4))
                    .on_key_down(cx.listener(|card, event: &gpui_kit::KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            card.naming = false;
                            cx.stop_propagation();
                            cx.notify();
                        }
                    }))
                    .child(
                        div()
                            .id("in-flow-name-field")
                            .test_support()
                            .flex_1()
                            .min_w_0()
                            .child(
                                view::field(
                                    &self.name,
                                    "Name for this tool",
                                    colors,
                                    self.pending_keep.is_some(),
                                )
                                .accessibility_id("in-flow-name"),
                            ),
                    )
                    .child(
                        view::mini("in-flow-keep", "Keep", colors)
                            .on_click(cx.listener(|card, _, _, cx| card.keep(cx))),
                    ),
            )
        } else {
            footer.child(
                Button::new("in-flow-name-tool")
                    .accessibility_label("Keep this tool")
                    .self_start()
                    .font_family(SERIF_FONT)
                    .text_size(px(13.))
                    .line_height(px(17.))
                    .text_color(rgb(colors.cobalt))
                    .underline()
                    .child("Keep this tool")
                    .on_click(cx.listener(|card, _, _, cx| {
                        card.naming = true;
                        cx.notify();
                    })),
            )
        };
        footer
            .when_some(self.keep_error.clone(), |footer, message| {
                footer.child(
                    div()
                        .id("in-flow-keep-error")
                        .role(Role::Alert)
                        .text_size(px(12.))
                        .text_color(rgb(colors.ink_muted))
                        .child(message),
                )
            })
            .into_any_element()
    }
}
impl Render for ToolCardView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *theme::palette(cx);
        let card = div()
            .id("in-flow-card")
            .test_support()
            .relative()
            .w(px(296.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .px(px(14.4))
            .pt(px(12.8))
            .pb(px(11.2))
            .border_1()
            .border_l(px(3.))
            .border_color(rgb(colors.rule))
            .rounded(px(2.))
            .bg(rgb(colors.paper))
            .shadow(vec![
                gpui_kit::BoxShadow::new(px(0.), px(1.), rgb(colors.rule).into()),
                gpui_kit::BoxShadow::new(px(0.), px(8.), rgb(0).opacity(0.35).into())
                    .blur_radius(px(24.))
                    .spread_radius(px(-16.)),
            ])
            .font_family(SERIF_FONT)
            .text_size(px(14.))
            .line_height(relative(1.55))
            .text_color(rgb(colors.ink))
            .aria_label(format!("{} for this passage", self.snapshot.title()))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(8.))
                            .child(
                                Button::new("in-flow-anchor")
                                    .accessibility_label("Go to the passage")
                                    .flex_1()
                                    .min_w_0()
                                    .font_family(DISPLAY_FONT)
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_size(px(15.))
                                    .line_height(relative(1.55))
                                    .justify_start()
                                    .text_color(rgb(colors.ink))
                                    .hover(|style| style.text_color(rgb(colors.cobalt)))
                                    .child(self.snapshot.title())
                                    .on_click(cx.listener(|card, _, _, cx| {
                                        card.emit(CardAction::FocusAnchor, cx)
                                    })),
                            )
                            .when(self.snapshot.tentative, |header| {
                                header.child(chrome::tracked_typewriter(
                                    "MAYBE",
                                    11.,
                                    1.1,
                                    colors.ink_muted,
                                ))
                            })
                            .child(
                                Button::new("in-flow-dismiss")
                                    .accessibility_label("Dismiss this tool")
                                    .text_size(px(12.))
                                    .line_height(relative(1.55))
                                    .when(!self.snapshot.tentative, |button| button.mr(px(8.)))
                                    .text_color(rgb(colors.ink_muted))
                                    .hover(|style| style.text_color(rgb(colors.vermilion)))
                                    .child("✕")
                                    .on_click(cx.listener(|card, _, _, cx| {
                                        card.emit(CardAction::Dismiss, cx)
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .mt(px(2.4))
                            .italic()
                            .text_size(px(13.))
                            .text_color(rgb(colors.ink_light))
                            .child(SharedString::from(self.snapshot.reason.clone())),
                    ),
            )
            .child(self.body.clone())
            .when_some(self.snapshot.notice.clone(), |card, notice| {
                card.child(
                    div()
                        .id("in-flow-notice")
                        .role(Role::Status)
                        .text_size(px(12.))
                        .text_color(rgb(colors.ink_muted))
                        .child(notice),
                )
            })
            .child(self.footer(colors, cx));
        accent_border(card, colors.cobalt)
    }
}
