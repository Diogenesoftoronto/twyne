//! The four original tool bodies. The host owns passage geometry, document
//! commands, provider requests, and the surrounding rail/popover/card shell.
pub(super) use super::input::field;
use super::input::input_frame;
use super::model::{ToolModel, ToolSnapshot, rhythm_summary};
use super::support_text::support_text;
use crate::{
    chrome,
    theme::{self, Palette, SERIF_FONT, TYPEWRITER_FONT},
};
use gpui_kit::base::{
    Button, Checkbox, CheckboxState,
    input::{InputBase, InputEvent, InputState, Textarea, TextareaState},
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, Context, Entity, EntityInputHandler, EventEmitter, FocusHandle, Focusable,
    IntoElement, Render, Role, SharedString, Subscription, TestSupportExt, Window, canvas, div,
    point, px, relative, rgb,
};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
use uuid::Uuid;

#[derive(Clone, PartialEq, Eq)]
pub struct ToolScope {
    pub folio: Arc<str>,
    pub visit: Uuid,
}
#[derive(Clone)]
pub enum ToolAction {
    ApplyVariant(String),
    HighlightSentence(Option<usize>),
    SelectSentence(usize),
    SetRhythmBand { min: f64, max: f64 },
    Reask(String),
    Research { request: Uuid, claim: String },
    Jot { request: Uuid, question: String },
}
#[derive(Clone)]
pub struct ToolEvent {
    pub scope: ToolScope,
    pub tool: Uuid,
    pub action: ToolAction,
}

pub struct ToolView {
    scope: ToolScope,
    model: ToolModel,
    working: Entity<TextareaState>,
    adding: Entity<InputState>,
    angle: Entity<InputState>,
    minimum: Entity<InputState>,
    maximum: Entity<InputState>,
    subscriptions: Vec<Subscription>,
    bars: BTreeMap<String, BarFocus>,
}
struct BarFocus {
    handle: FocusHandle,
    _subscriptions: [Subscription; 2],
}
impl EventEmitter<ToolEvent> for ToolView {}

impl ToolView {
    pub fn new(
        scope: ToolScope,
        snapshot: ToolSnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let model = ToolModel::new(snapshot);
        let working = cx.new(|cx| {
            TextareaState::new(window, cx)
                .rows(3)
                .submit_on_enter(false)
                .default_value(model.working.clone())
        });
        let adding =
            cx.new(|cx| InputState::new(window, cx).placeholder("Another kind of support…"));
        let angle = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("the piece's intended reader")
                .default_value(model.angle.clone())
        });
        let minimum = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(number_text(&model.snapshot.props()["targetMin"]))
        });
        let maximum = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(number_text(&model.snapshot.props()["targetMax"]))
        });
        let mut view = Self {
            scope,
            model,
            working,
            adding,
            angle,
            minimum,
            maximum,
            subscriptions: Vec::new(),
            bars: BTreeMap::new(),
        };
        view.subscriptions.push(cx.subscribe(
            &view.working,
            |view, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) && view.model.writable() {
                    view.model.working = input.read(cx).value().to_string();
                    cx.notify();
                }
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
            },
        ));
        view.subscriptions.push(cx.subscribe_in(
            &view.adding,
            window,
            |view, input, event: &InputEvent, window, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
                if matches!(event, InputEvent::PressEnter { .. })
                    && view.model.add_support(input.read(cx).value().as_ref())
                {
                    input.update(cx, |input, cx| input.set_value("", window, cx));
                    cx.notify();
                }
            },
        ));
        view.subscriptions.push(cx.subscribe(
            &view.angle,
            |view, input, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
                if !view.model.writable() {
                    return;
                }
                if matches!(event, InputEvent::Change) {
                    view.model.angle = input.read(cx).value().to_string();
                    cx.notify();
                }
                if matches!(event, InputEvent::PressEnter { .. }) {
                    view.emit(ToolAction::Reask(input.read(cx).value().to_string()), cx);
                }
            },
        ));
        for (input, is_min) in [(view.minimum.clone(), true), (view.maximum.clone(), false)] {
            view.subscriptions.push(cx.subscribe(
                &input,
                move |view, input, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                        cx.notify();
                    }
                    if !matches!(event, InputEvent::Change | InputEvent::Blur)
                        || view.model.snapshot.component() != "RhythmStrip"
                    {
                        return;
                    }
                    let Ok(mut value) = input.read(cx).value().parse::<f64>() else {
                        return;
                    };
                    if !value.is_finite() {
                        return;
                    }
                    let props = view.model.snapshot.props();
                    let min = props["targetMin"].as_f64().unwrap();
                    let max = props["targetMax"].as_f64().unwrap();
                    if matches!(event, InputEvent::Blur) {
                        value = if is_min {
                            value.max(1.0).min(max - 1.0).round()
                        } else {
                            value.max(min + 1.0).min(120.0).round()
                        };
                    }
                    if value != if is_min { min } else { max } {
                        view.emit(
                            ToolAction::SetRhythmBand {
                                min: if is_min { value } else { min },
                                max: if is_min { max } else { value },
                            },
                            cx,
                        );
                    }
                },
            ));
        }
        view.sync_bar_focus(window, cx);
        view
    }
    pub fn scope(&self) -> &ToolScope {
        &self.scope
    }
    pub fn snapshot(&self) -> &ToolSnapshot {
        &self.model.snapshot
    }
    pub fn update(
        &mut self,
        snapshot: ToolSnapshot,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.model.update(snapshot) {
            return false;
        }
        if self.model.snapshot.component() == "RhythmStrip" {
            for (input, key) in [(&self.minimum, "targetMin"), (&self.maximum, "targetMax")] {
                let value = number_text(&self.model.snapshot.props()[key]);
                if input.read(cx).value().as_ref() != value {
                    input.update(cx, |input, cx| input.set_value(value, window, cx));
                }
            }
        }
        self.sync_bar_focus(window, cx);
        cx.notify();
        true
    }
    fn sync_bar_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.snapshot.component() != "RhythmStrip" {
            self.bars.clear();
            return;
        }
        let keys: Vec<String> = self.model.snapshot.props()["sentences"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, s)| format!("{i}-{}", number_text(&s["words"])))
            .collect();
        self.bars.retain(|key, _| keys.contains(key));
        for (index, key) in keys.into_iter().enumerate() {
            if self.bars.contains_key(&key) {
                continue;
            }
            let handle = cx.focus_handle();
            let focus = cx.on_focus_in(&handle, window, move |view, _, cx| {
                view.emit(ToolAction::HighlightSentence(Some(index)), cx)
            });
            let blur = cx.on_focus_out(&handle, window, |view, _, _, cx| {
                view.emit(ToolAction::HighlightSentence(None), cx)
            });
            self.bars.insert(
                key,
                BarFocus {
                    handle,
                    _subscriptions: [focus, blur],
                },
            );
        }
    }
    pub fn retire(&mut self, cx: &mut Context<Self>) {
        self.emit(ToolAction::HighlightSentence(None), cx);
        self.model.retire();
        self.bars.clear();
        cx.notify();
    }
    pub fn finish_research(
        &mut self,
        request: Uuid,
        result: Result<(), String>,
        cx: &mut Context<Self>,
    ) -> bool {
        let accepted = self.model.finish_research(request, result);
        if accepted {
            cx.notify();
        }
        accepted
    }
    pub fn finish_jot(&mut self, request: Uuid, saved: bool, cx: &mut Context<Self>) -> bool {
        let accepted = self.model.finish_jot(request, saved);
        if accepted {
            cx.notify();
        }
        accepted
    }
    fn emit(&self, action: ToolAction, cx: &mut Context<Self>) {
        if self.model.writable() {
            cx.emit(ToolEvent {
                scope: self.scope.clone(),
                tool: self.model.snapshot.id,
                action,
            });
        }
    }
    fn sentence_lab(
        &self,
        colors: Palette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.working.update(cx, |state, cx| {
            state.set_editor_paddings(gpui_kit::Edges::default());
            state.set_readonly(!self.model.writable(), cx);
        });
        let props = self.model.snapshot.props();
        let mut body = body();
        for (field, label) in [
            ("attempts", "Your earlier tries"),
            ("variants", "Other ways"),
        ] {
            let choices = props[field].as_array().unwrap();
            if field == "attempts" && choices.is_empty() {
                continue;
            }
            let mut section = div()
                .flex()
                .flex_col()
                .gap(px(4.8))
                .child(label_element(label, colors));
            let mut rows = div().flex().flex_col().gap(px(4.8));
            for (index, choice) in choices.iter().enumerate() {
                let text = choice.as_str().unwrap().to_owned();
                let selected = self.model.working == text;
                let label = text.clone();
                rows = rows.child(
                    Button::new(SharedString::from(format!("in-flow-{field}-{index}")))
                        .accessibility_label(SharedString::from(format!(
                            "Load this {} into the working copy",
                            if field == "attempts" {
                                "attempt"
                            } else {
                                "variant"
                            }
                        )))
                        .w_full()
                        .px(px(8.))
                        .py(px(5.6))
                        .border_1()
                        .when(!selected, |this| this.border_dashed())
                        .border_color(rgb(if selected { colors.cobalt } else { colors.rule }))
                        .rounded(px(2.))
                        .bg(if selected {
                            rgb(colors.paper).blend(rgb(colors.cobalt).opacity(0.07))
                        } else {
                            rgb(colors.paper_soft)
                        })
                        .hover(move |style| style.border_color(rgb(colors.cobalt)))
                        .disabled(!self.model.writable())
                        .child(
                            div()
                                .w_full()
                                .whitespace_normal()
                                .child(SharedString::from(label)),
                        )
                        .on_click(cx.listener(move |view, _, window, cx| {
                            view.working
                                .update(cx, |input, cx| input.set_value(text.clone(), window, cx));
                            view.model.working = text.clone();
                            cx.notify();
                        })),
                );
            }
            section = section.child(rows);
            if field == "variants" && self.model.snapshot.filling {
                section = section.child(
                    quiet("Finding other wordings…", colors)
                        .id("in-flow-variants-status")
                        .role(Role::Status),
                );
            }
            body = body.child(section);
        }
        body.child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.8))
                .child(label_element("Working copy", colors))
                .child(
                    div()
                        .id("in-flow-working-field")
                        .test_support()
                        .w_full()
                        .child(input_frame(
                            InputBase::new("in-flow-working")
                                .accessibility_label("Working copy")
                                .role(Role::MultilineTextInput)
                                .styles(|styles| {
                                    styles.focused(|style| style.border_color(rgb(colors.cobalt)))
                                })
                                .w_full()
                                .h(px(78.3))
                                .px(px(8.))
                                .py(px(5.6))
                                .border_1()
                                .border_color(rgb(colors.rule))
                                .rounded(px(2.))
                                .bg(rgb(colors.paper_soft))
                                .font_family(SERIF_FONT)
                                .text_size(px(14.))
                                .line_height(relative(1.55))
                                .child(Textarea::new(&self.working)),
                            &self.working,
                            !self.model.writable(),
                            window,
                            cx,
                        )),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(9.6))
                        .mt(px(3.2))
                        .child(
                            chrome::press_button("in-flow-use-this", "Use this", 11.2, cx)
                                .h(px(36.96))
                                .disabled(self.model.variant_to_apply().is_none())
                                .when(self.model.variant_to_apply().is_none(), |button| {
                                    button.opacity(0.4)
                                })
                                .on_click(cx.listener(|view, _, _, cx| {
                                    view.model.working = view.working.read(cx).value().to_string();
                                    if let Some(text) = view.model.variant_to_apply() {
                                        view.emit(ToolAction::ApplyVariant(text), cx);
                                    }
                                })),
                        )
                        .child(quiet("Undo puts yours back.", colors)),
                ),
        )
        .into_any_element()
    }
    fn rhythm_strip(&self, colors: Palette, cx: &mut Context<Self>) -> AnyElement {
        let props = self.model.snapshot.props();
        let min = props["targetMin"].as_f64().unwrap();
        let max = props["targetMax"].as_f64().unwrap();
        let sentences = props["sentences"].as_array().unwrap();
        let scale = sentences
            .iter()
            .map(|s| s["words"].as_f64().unwrap())
            .fold(max * 1.4, f64::max);
        let mut bars = div().flex().flex_col().gap(px(3.));
        for (index, sentence) in sentences.iter().enumerate() {
            let words = sentence["words"].as_f64().unwrap();
            let tone = if words > max {
                colors.vermilion
            } else if words < min {
                colors.cobalt
            } else {
                colors.ink_light
            };
            let count = number_text(&sentence["words"]);
            bars = bars.child(
                Button::new(SharedString::from(format!("in-flow-bar-{index}")))
                    .track_focus(&self.bars[&format!("{index}-{count}")].handle)
                    .accessibility_label(SharedString::from(format!(
                        "Sentence {}: {count} words. Select it in the draft.",
                        index + 1
                    )))
                    .w_full()
                    .h(px(16.))
                    .relative()
                    .justify_start()
                    .p_0()
                    .disabled(!self.model.writable())
                    .child(
                        div()
                            .h_full()
                            .w(relative((words / scale) as f32))
                            .min_w(px(3.))
                            .rounded(px(1.))
                            .bg(rgb(tone)),
                    )
                    .child(
                        div()
                            .ml(px(5.6))
                            .flex_shrink_0()
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(11.))
                            .line_height(px(11.))
                            .text_color(rgb(colors.ink_muted))
                            .child(SharedString::from(count)),
                    )
                    .on_hover(cx.listener(move |view, hovered: &bool, _, cx| {
                        view.emit(ToolAction::HighlightSentence(hovered.then_some(index)), cx)
                    }))
                    .on_click(cx.listener(move |view, _, _, cx| {
                        view.emit(ToolAction::SelectSentence(index), cx)
                    })),
            );
        }
        body()
            .child(rhythm_summary(props))
            .child(bars)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(6.4))
                    .child(label_element("Comfortable length", colors))
                    .child(self.stepper(true, min, 1., max - 1., colors, cx))
                    .child(
                        div()
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(12.))
                            .child("–"),
                    )
                    .child(self.stepper(false, max, min + 1., 120., colors, cx)),
            )
            .child(quiet(
                "Hover a bar to find its sentence; click to select it.",
                colors,
            ))
            .into_any_element()
    }
    fn stepper(
        &self,
        is_min: bool,
        value: f64,
        min: f64,
        max: f64,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = if is_min { "in-flow-min" } else { "in-flow-max" };
        let label = if is_min {
            "Shortest comfortable sentence, in words"
        } else {
            "Longest comfortable sentence, in words"
        };
        let mut row = div()
            .id(id)
            .test_support()
            .role(Role::Group)
            .aria_label(label)
            .flex()
            .items_center()
            .w(px(105.6))
            .h(px(28.8))
            .flex_shrink_0()
            .border_1()
            .border_color(rgb(colors.rule))
            .rounded(px(2.))
            .overflow_hidden()
            .bg(rgb(colors.paper_soft))
            .font_family(TYPEWRITER_FONT)
            .text_color(rgb(colors.ink))
            .when(!self.model.writable(), |row| row.opacity(0.45))
            .hover(move |style| style.border_color(rgb(colors.ink_muted)))
            .capture_key_down(cx.listener(
                move |view, event: &gpui_kit::KeyDownEvent, window, cx| {
                    let input = if is_min { &view.minimum } else { &view.maximum };
                    if !view.model.writable() || !input.read(cx).focus_handle(cx).is_focused(window)
                    {
                        return;
                    }
                    let direction = match event.keystroke.key.as_str() {
                        "up" => 1,
                        "down" => -1,
                        _ => return,
                    };
                    if input.update(cx, |input, cx| {
                        input.marked_text_range(window, cx).is_some()
                    }) {
                        return;
                    }
                    window.prevent_default();
                    cx.stop_propagation();
                    view.step_rhythm(is_min, direction, cx);
                },
            ));
        for direction in [-1, 1] {
            if direction == 1 {
                row = row.child(
                    div()
                        .flex()
                        .flex_1()
                        .min_w_0()
                        .items_center()
                        .px(px(5.6))
                        .gap(px(2.56))
                        .child(
                            field(
                                if is_min { &self.minimum } else { &self.maximum },
                                label,
                                colors,
                                !self.model.writable(),
                            )
                            .numeric(min, max)
                            .accessibility_id(if is_min {
                                "in-flow-min-input"
                            } else {
                                "in-flow-max-input"
                            })
                            .flex_1()
                            .min_w_0()
                            .h(px(18.6))
                            .p_0()
                            .border_0()
                            .rounded(px(0.))
                            .bg(gpui_kit::transparent_black())
                            .font_family(TYPEWRITER_FONT)
                            .text_size(px(12.))
                            .line_height(relative(1.55)),
                        )
                        .when(!is_min, |field| {
                            field.child(
                                div()
                                    .flex_shrink_0()
                                    .text_size(px(10.4))
                                    .text_color(rgb(colors.ink_muted))
                                    // Source's normal whitespace removes the
                                    // leading space at this flex item's start.
                                    .child("words"),
                            )
                        }),
                );
            }
            row = row.child(
                Button::new(SharedString::from(format!("{id}-step-{direction}")))
                    .accessibility_label(SharedString::from(format!(
                        "{} {label}",
                        if direction < 0 {
                            "Decrease"
                        } else {
                            "Increase"
                        }
                    )))
                    .w(px(27.2))
                    .h_full()
                    .flex_shrink_0()
                    .text_size(px(14.4))
                    .line_height(px(14.4))
                    .text_color(rgb(colors.ink_muted))
                    .when(direction < 0, |button| button.border_r_1())
                    .when(direction > 0, |button| button.border_l_1())
                    .border_color(rgb(colors.rule))
                    .hover(move |style| {
                        style
                            .text_color(rgb(colors.cobalt))
                            .bg(rgb(colors.cobalt).opacity(0.07))
                    })
                    .disabled(
                        !self.model.writable()
                            || if direction < 0 {
                                value <= min
                            } else {
                                value >= max
                            },
                    )
                    .when(
                        !self.model.writable()
                            || if direction < 0 {
                                value <= min
                            } else {
                                value >= max
                            },
                        |button| button.text_color(rgb(colors.ink_muted).opacity(0.45)),
                    )
                    .child(if direction < 0 { "−" } else { "+" })
                    .on_click(
                        cx.listener(move |view, _, _, cx| view.step_rhythm(is_min, direction, cx)),
                    ),
            );
        }
        row.into_any_element()
    }
    fn step_rhythm(&self, is_min: bool, direction: i32, cx: &mut Context<Self>) {
        let props = self.model.snapshot.props();
        let minimum = props["targetMin"].as_f64().unwrap();
        let maximum = props["targetMax"].as_f64().unwrap();
        let next = if is_min {
            (minimum + direction as f64)
                .max(1.)
                .min(maximum - 1.)
                .round()
        } else {
            (maximum + direction as f64)
                .max(minimum + 1.)
                .min(120.)
                .round()
        };
        self.emit(
            ToolAction::SetRhythmBand {
                min: if is_min { next } else { minimum },
                max: if is_min { maximum } else { next },
            },
            cx,
        );
    }
    fn claim_check(&self, colors: Palette, cx: &mut Context<Self>) -> AnyElement {
        let props = self.model.snapshot.props();
        let open = self.model.slots.iter().filter(|s| !s.filled).count();
        let summary = if open == 0 {
            "Every kind of support you asked for is here.".into()
        } else {
            format!(
                "{open} kind{} of support still missing.",
                if open == 1 { "" } else { "s" }
            )
        };
        let mut slots = div().flex().flex_col().gap(px(5.6));
        for (index, slot) in self.model.slots.iter().enumerate() {
            let owner = cx.weak_entity();
            let hint = match slot.label.as_str() {
                "A source" => Some("Who else says so? The Apparatus can look."),
                "An example" => Some("One concrete case, right after the claim."),
                "A number" => Some("A figure, and where it comes from."),
                _ => None,
            };
            let text = support_text(&slot.label, hint, slot.filled, colors);
            let accessible_label = if let Some(hint) = hint.filter(|_| !slot.filled) {
                format!("{} — {hint}", slot.label)
            } else {
                slot.label.clone()
            };
            let mut row = div().flex().items_start().gap(px(8.)).child(
                source_checkbox(
                    format!("in-flow-slot-{index}"),
                    accessible_label,
                    slot.filled,
                    !self.model.writable(),
                    colors,
                )
                .child(text)
                .on_change(move |state, _, _, cx| {
                    let _ = owner.update(cx, |view, cx| {
                        if view.model.writable()
                            && let Some(slot) = view.model.slots.get_mut(index)
                        {
                            slot.filled = state == CheckboxState::Checked;
                            cx.notify();
                        }
                    });
                }),
            );
            if !slot.filled && slot.label == "A source" {
                row = row.child(
                    mini(
                        "in-flow-find",
                        if self.model.researching() {
                            "Looking…"
                        } else {
                            "Find"
                        },
                        colors,
                    )
                    .disabled(!self.model.writable() || self.model.researching())
                    .on_click(cx.listener(|view, _, _, cx| {
                        if let Some((request, claim)) = view.model.begin_research() {
                            view.emit(ToolAction::Research { request, claim }, cx);
                            cx.notify();
                        }
                    })),
                );
            }
            slots = slots.child(row);
        }
        body()
            .child(
                div()
                    .pl(px(9.6))
                    .border_l(px(2.))
                    .border_color(rgb(colors.ink))
                    .italic()
                    .child(SharedString::from(
                        props["claim"].as_str().unwrap().to_owned(),
                    )),
            )
            .child(SharedString::from(summary))
            .child(slots)
            .child(field(
                &self.adding,
                "Add a kind of support",
                colors,
                !self.model.writable(),
            ))
            .when(!self.model.research_message.is_empty(), |this| {
                this.child(
                    quiet(&self.model.research_message, colors)
                        .id("in-flow-research-status")
                        .role(Role::Status),
                )
            })
            .into_any_element()
    }
    fn reader_questions(&self, colors: Palette, cx: &mut Context<Self>) -> AnyElement {
        let props = self.model.snapshot.props();
        let mut questions = div().flex().flex_col().gap(px(4.8));
        for (index, question) in props["questions"].as_array().unwrap().iter().enumerate() {
            let question = question.as_str().unwrap().to_owned();
            let answered = self.model.answered.contains(&question);
            let jotted = self.model.jotted.contains(&question);
            let answer = question.clone();
            let jot = question.clone();
            let owner = cx.weak_entity();
            questions = questions.child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .child(
                        source_checkbox(
                            format!("in-flow-question-{index}"),
                            question.clone(),
                            answered,
                            !self.model.writable(),
                            colors,
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .whitespace_normal()
                                .line_height(relative(1.55))
                                .when(answered, |this| {
                                    this.text_color(rgb(colors.ink_muted)).line_through()
                                })
                                .child(SharedString::from(question)),
                        )
                        .on_change(move |state, _, _, cx| {
                            let _ = owner.update(cx, |view, cx| {
                                if view.model.writable() {
                                    if state == CheckboxState::Checked {
                                        view.model.answered.insert(answer.clone());
                                    } else {
                                        view.model.answered.remove(&answer);
                                    }
                                    cx.notify();
                                }
                            });
                        }),
                    )
                    .child(
                        mini(
                            if index == 0 {
                                "in-flow-jot-0"
                            } else if index == 1 {
                                "in-flow-jot-1"
                            } else if index == 2 {
                                "in-flow-jot-2"
                            } else {
                                "in-flow-jot-3"
                            },
                            if jotted { "Jotted" } else { "Jot" },
                            colors,
                        )
                        .disabled(!self.model.writable() || jotted)
                        .on_click(cx.listener(move |view, _, _, cx| {
                            if let Some(request) = view.model.begin_jot(&jot) {
                                view.emit(
                                    ToolAction::Jot {
                                        request,
                                        question: jot.clone(),
                                    },
                                    cx,
                                );
                            }
                        })),
                    ),
            );
        }
        body()
            .child(label_element("Reading as", colors))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.4))
                    .child(
                        field(&self.angle, "Reading as", colors, !self.model.writable()).flex_1(),
                    )
                    .child(
                        mini("in-flow-ask", "Ask", colors)
                            .disabled(
                                !self.model.writable()
                                    || self.model.snapshot.filling
                                    || self.model.angle == props["angle"].as_str().unwrap(),
                            )
                            .on_click(cx.listener(|view, _, _, cx| {
                                view.emit(
                                    ToolAction::Reask(view.angle.read(cx).value().to_string()),
                                    cx,
                                )
                            })),
                    ),
            )
            .child(questions)
            .when(self.model.snapshot.filling, |this| {
                this.child(
                    quiet("Imagining the reader…", colors)
                        .id("in-flow-questions-status")
                        .role(Role::Status),
                )
            })
            .into_any_element()
    }
}

fn number_text(value: &Value) -> String {
    value.as_f64().map(|n| n.to_string()).unwrap_or_default()
}
fn body() -> gpui_kit::Div {
    div().flex().flex_col().gap(px(11.2))
}
fn label_element(text: &str, colors: Palette) -> gpui_kit::Div {
    div()
        .font_family(TYPEWRITER_FONT)
        .text_size(px(11.))
        .line_height(px(11.))
        .text_color(rgb(colors.ink_muted))
        .child(chrome::tracked_text(
            &text.to_uppercase(),
            gpui_kit::font(TYPEWRITER_FONT),
            11.,
            1.32,
            colors.ink_muted,
            11.,
        ))
}
fn quiet(text: &str, colors: Palette) -> gpui_kit::Div {
    div()
        .text_size(px(12.))
        .text_color(rgb(colors.ink_muted))
        .child(SharedString::from(text.to_owned()))
}
pub(super) fn mini(id: &'static str, label: &'static str, colors: Palette) -> Button {
    Button::new(id)
        .accessibility_label(label)
        .flex_shrink_0()
        .px(px(8.))
        .py(px(2.4))
        .border_1()
        .border_color(rgb(colors.rule))
        .rounded(px(2.))
        .bg(rgb(colors.paper_soft))
        .font_family(theme::BUTTON_FONT)
        .font_weight(gpui_kit::FontWeight::SEMIBOLD)
        .text_size(px(12.))
        .line_height(relative(1.55))
        .child(label)
}
fn source_checkbox(
    id: String,
    label: String,
    checked: bool,
    disabled: bool,
    colors: Palette,
) -> Checkbox {
    Checkbox::new(SharedString::from(id))
        .accessibility_label(SharedString::from(label))
        .checked(checked)
        .disabled(disabled)
        .flex()
        .items_start()
        .flex_1()
        .min_w_0()
        .gap(px(7.2))
        .child(
            div()
                .mt(px(2.))
                .size(px(13.))
                .flex_shrink_0()
                .border_1()
                .border_color(rgb(if checked { colors.cobalt } else { 0x767676 }))
                .rounded(px(2.))
                .bg(rgb(if checked { colors.cobalt } else { 0xffffff }))
                .when(checked, |this| {
                    this.child(
                        canvas(
                            |bounds, _, _| {
                                let mut check = gpui_kit::PathBuilder::stroke(px(1.6));
                                check.move_to(bounds.origin + point(px(2.), px(5.5)));
                                check.line_to(bounds.origin + point(px(4.5), px(8.)));
                                check.line_to(bounds.origin + point(px(9.), px(3.)));
                                check.build().expect("The fixed checkbox mark is valid")
                            },
                            |_, check, window, _| window.paint_path(check, rgb(0xffffff)),
                        )
                        .size_full(),
                    )
                }),
        )
}
impl Render for ToolView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *theme::palette(cx);
        let content = match self.model.snapshot.component() {
            "SentenceLab" => self.sentence_lab(colors, window, cx),
            "RhythmStrip" => self.rhythm_strip(colors, cx),
            "ClaimCheck" => self.claim_check(colors, cx),
            "ReaderQuestions" => self.reader_questions(colors, cx),
            _ => unreachable!(),
        };
        div()
            .id("in-flow-tool-body")
            .test_support()
            .w_full()
            .font_family(SERIF_FONT)
            .text_size(px(14.))
            .line_height(relative(1.55))
            .text_color(rgb(colors.ink))
            .child(content)
    }
}
