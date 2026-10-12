//! Source-styled fields over the Kit's retained native editing engine.
use crate::theme::{Palette, SERIF_FONT};
use gpui_kit::base::StyledExt as _;
use gpui_kit::base::input::{Input, InputBase, InputBaseState, InputModeKind, InputState};
use gpui_kit::prelude::*;
use gpui_kit::{
    AccessibleAction, App, ElementId, Entity, Focusable, IntoElement, RenderOnce, Role,
    SharedString, StyleRefinement, TextAlign, Window, accesskit, px, relative, rgb,
};

pub(super) fn input_frame<M: InputModeKind>(
    frame: InputBase,
    state: &Entity<InputBaseState<M>>,
    disabled: bool,
    window: &mut Window,
    cx: &mut App,
) -> InputBase {
    state.update(cx, |state, cx| {
        state.set_disabled(disabled, cx);
        state.set_editor_paddings(gpui_kit::Edges::default());
    });
    let focus = state.read(cx).focus_handle(cx);
    let focus_state = state.clone();
    let value_state = state.clone();
    frame
        .track_focus(&focus)
        .focused(focus.is_focused(window))
        .disabled(disabled)
        .aria_value(state.read(cx).value().to_string())
        .on_a11y_action(AccessibleAction::Focus, move |_, window, cx| {
            focus_state.update(cx, |state, cx| {
                if !state.presentation().is_disabled() {
                    state.focus_handle(cx).focus(window, cx);
                }
            });
        })
        .when(!disabled, |frame| {
            frame.on_a11y_action(AccessibleAction::SetValue, move |data, window, cx| {
                if let Some(accesskit::ActionData::Value(value)) = data {
                    value_state.update(cx, |state, cx| {
                        if state.is_editable() {
                            state.replace_all(value.to_string(), window, cx);
                        }
                    });
                }
            })
        })
}

#[derive(IntoElement)]
pub(super) struct ToolInput {
    state: Entity<InputState>,
    label: &'static str,
    colors: Palette,
    disabled: bool,
    style: StyleRefinement,
    alignment: TextAlign,
    role: Role,
    accessibility_id: Option<SharedString>,
    numeric_bounds: Option<(f64, f64)>,
}

pub(super) fn field(
    state: &Entity<InputState>,
    label: &'static str,
    colors: Palette,
    disabled: bool,
) -> ToolInput {
    ToolInput {
        state: state.clone(),
        label,
        colors,
        disabled,
        style: StyleRefinement::default(),
        alignment: TextAlign::Left,
        role: Role::TextInput,
        accessibility_id: None,
        numeric_bounds: None,
    }
}

impl ToolInput {
    pub(super) fn accessibility_id(mut self, id: impl Into<SharedString>) -> Self {
        self.accessibility_id = Some(id.into());
        self
    }

    pub(super) fn numeric(mut self, min: f64, max: f64) -> Self {
        self.alignment = TextAlign::Center;
        self.role = Role::SpinButton;
        self.numeric_bounds = Some((min, max));
        self
    }
}

impl Styled for ToolInput {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for ToolInput {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        self.state
            .update(cx, |state, cx| state.set_text_align(self.alignment, cx));
        let id = self
            .accessibility_id
            .clone()
            .map(ElementId::from)
            .unwrap_or_else(|| ("in-flow-input", self.state.entity_id()).into());
        let frame = InputBase::new(id)
            .role(self.role)
            .accessibility_label(self.label)
            .when_some(self.accessibility_id, |frame, id| {
                frame.accessibility_id(id)
            })
            .when_some(self.numeric_bounds, |frame, (min, max)| {
                frame
                    .aria_min_numeric_value(min)
                    .aria_max_numeric_value(max)
                    .aria_numeric_value_step(1.)
                    .when_some(
                        self.state
                            .read(cx)
                            .value()
                            .parse::<f64>()
                            .ok()
                            .filter(|n| n.is_finite()),
                        |frame, value| frame.aria_numeric_value(value),
                    )
            })
            .w_full()
            .h(px(34.9))
            .px(px(8.))
            .py(px(5.6))
            .border_1()
            .border_color(rgb(self.colors.rule))
            .rounded(px(2.))
            .bg(rgb(self.colors.paper_soft))
            .font_family(SERIF_FONT)
            .text_size(px(14.))
            .line_height(relative(1.55))
            .text_color(rgb(self.colors.ink))
            .styles(|styles| styles.focused(|style| style.border_color(rgb(self.colors.cobalt))))
            .refine_style(&self.style)
            .child(Input::new(&self.state));
        input_frame(frame, &self.state, self.disabled, window, cx)
    }
}
