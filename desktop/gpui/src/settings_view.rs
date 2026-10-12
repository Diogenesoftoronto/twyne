//! The original Appearance section in native controls. Selecting a preference
//! requests an application preview and save; success follows a durable ack.

use crate::{
    settings::{AppearanceRecord, AppearanceRequest},
    theme::{
        self, DISPLAY_FONT, MONO_FONT, SANS_FONT, SERIF_FONT, TYPEWRITER_FONT, ThemePreference,
        ThemePreset,
    },
};
use gpui_kit::component::{
    Disableable, Sizable, ThemeMode,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    color_picker::{ColorPickerEvent, ColorPickerState},
    input::Input,
    popover::Popover,
    slider::Slider,
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, BoxShadow, Context, Entity, EventEmitter, FocusHandle, Focusable, FontWeight,
    Hsla, Render, Role, ScrollHandle, SharedString, Subscription, Task, TestSupportExt, Window,
    div, px, rgb,
};
use std::{collections::BTreeMap, time::Duration};
use uuid::Uuid;

const APPEARANCE_DESCRIPTION: &str = "The palette the room is printed in. This changes the app only — colours you apply to your own prose are written into the document and stay exactly as you set them, in Twyne and in anything you export.";
const OVERRIDES_DESCRIPTION: &str = "Overrides sit on top of whichever preset is selected, so changing preset keeps your edits. Anything you leave alone follows the preset.";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AppearanceCapabilities {
    pub persist: bool,
}
impl AppearanceCapabilities {
    pub fn local() -> Self {
        Self { persist: true }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum SettingsEvent {
    AppearanceRequested(AppearanceRequest),
}

pub struct SettingsView {
    saved: AppearanceRecord,
    requested: ThemePreference,
    capabilities: AppearanceCapabilities,
    prefers_dark: bool,
    custom_open: bool,
    embedded: bool,
    pending: Option<AppearanceRequest>,
    message: Option<String>,
    error: Option<String>,
    colors: BTreeMap<&'static str, Entity<ColorPickerState>>,
    focus_handle: FocusHandle,
    scroll_handle: ScrollHandle,
    message_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<SettingsEvent> for SettingsView {}
impl Focusable for SettingsView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl SettingsView {
    pub fn new(
        record: AppearanceRecord,
        capabilities: AppearanceCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let prefers_dark = ThemeMode::from(cx.window_appearance()).is_dark();
        let resolved = theme::resolved_token_values(&record.preference, prefers_dark);
        let mut colors = BTreeMap::new();
        let mut subscriptions = Vec::new();
        for token in theme::THEME_TOKENS {
            let color = hex_color(&resolved[token.id]);
            let state = cx.new(|cx| ColorPickerState::new(window, cx).default_value(color));
            let id = token.id;
            subscriptions.push(cx.subscribe_in(
                &state,
                window,
                move |this, _, event: &ColorPickerEvent, window, cx| {
                    if let ColorPickerEvent::Change(Some(color)) = event {
                        this.request_override(id, &opaque_hex(*color), window, cx);
                    }
                },
            ));
            colors.insert(id, state);
        }
        Self {
            requested: record.preference.clone(),
            saved: record,
            capabilities,
            prefers_dark,
            custom_open: false,
            embedded: false,
            pending: None,
            message: None,
            error: None,
            colors,
            focus_handle: cx.focus_handle(),
            scroll_handle: ScrollHandle::new(),
            message_task: None,
            _subscriptions: subscriptions,
        }
    }
    pub fn saved_record(&self) -> &AppearanceRecord {
        &self.saved
    }
    pub fn requested_preference(&self) -> &ThemePreference {
        &self.requested
    }
    pub fn pending_request(&self) -> Option<&AppearanceRequest> {
        self.pending.as_ref()
    }
    pub fn pending_request_id(&self) -> Option<Uuid> {
        self.pending.as_ref().map(|request| request.request_id)
    }
    /// The Settings route owns the page scroll, including its original header.
    /// Standalone panels retain their own scroll for isolated consumers/tests.
    pub fn set_embedded(&mut self, embedded: bool, cx: &mut Context<Self>) {
        self.embedded = embedded;
        cx.notify();
    }
    pub fn set_capabilities(
        &mut self,
        capabilities: AppearanceCapabilities,
        cx: &mut Context<Self>,
    ) {
        self.capabilities = capabilities;
        cx.notify();
    }
    /// The application observes actual OS appearance. A stored System choice
    /// remains System; only the resolved controls and contrast change.
    pub fn set_prefers_dark(&mut self, dark: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.prefers_dark != dark {
            self.prefers_dark = dark;
            self.sync_colors(window, cx);
            cx.notify();
        }
    }
    /// Accept an externally loaded saved record without moving backwards over
    /// newer native saves. A newer record invalidates a pending old request.
    pub fn replace_record(
        &mut self,
        record: AppearanceRecord,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if record.generation < self.saved.generation
            || (record.generation == self.saved.generation && record != self.saved)
        {
            return false;
        }
        if record == self.saved {
            return true;
        }
        self.requested = record.preference.clone();
        self.saved = record;
        self.pending = None;
        self.message = None;
        self.error = None;
        self.message_task = None;
        self.sync_colors(window, cx);
        cx.notify();
        true
    }
    pub fn acknowledge_saved(
        &mut self,
        request_id: Uuid,
        record: AppearanceRecord,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(request) = self.pending.as_ref() else {
            return false;
        };
        if request.request_id != request_id
            || request.generation != self.saved.generation
            || Some(record.generation) != request.generation.checked_add(1)
            || record.preference != request.preference
        {
            return false;
        }
        self.requested = record.preference.clone();
        self.saved = record;
        self.pending = None;
        self.error = None;
        self.message = Some("Appearance saved".into());
        self.sync_colors(window, cx);
        let generation = self.saved.generation;
        let timer = cx.background_executor().timer(Duration::from_millis(1800));
        self.message_task = Some(cx.spawn_in(window, async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |this, cx| {
                if this.saved.generation == generation {
                    this.message = None;
                    cx.notify();
                }
            });
        }));
        cx.notify();
        true
    }
    /// The requested palette stays visible for inspection and retry, while the
    /// durable saved record remains unchanged. No success message is produced.
    pub fn report_error(
        &mut self,
        request_id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.pending_request_id() != Some(request_id) {
            return false;
        }
        self.pending = None;
        self.message = None;
        self.message_task = None;
        self.error = Some(message.into());
        cx.notify();
        true
    }
    fn writable(&self) -> bool {
        self.capabilities.persist && self.pending.is_none()
    }
    fn request_preference(
        &mut self,
        preference: ThemePreference,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.writable() {
            self.sync_colors(window, cx);
            return false;
        }
        let preference = theme::normalize_preference(
            &serde_json::to_value(&preference).expect("a theme preference serializes"),
        );
        // As in the web control, clicking even the active preset saves it.
        // This also retries a failed preview or returns to the saved palette.
        self.requested = preference.clone();
        self.message = None;
        self.message_task = None;
        self.error = None;
        let request = AppearanceRequest {
            request_id: Uuid::new_v4(),
            generation: self.saved.generation,
            preference,
        };
        self.pending = Some(request.clone());
        self.sync_colors(window, cx);
        cx.emit(SettingsEvent::AppearanceRequested(request));
        cx.notify();
        true
    }
    fn request_preset(
        &mut self,
        preset: ThemePreset,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let mut preference = self.requested.clone();
        preference.preset = preset;
        self.request_preference(preference, window, cx)
    }
    fn request_override(
        &mut self,
        token: &str,
        value: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !theme::THEME_TOKENS.iter().any(|entry| entry.id == token) {
            return false;
        }
        let Some(value) = theme::normalize_hex(value) else {
            self.sync_colors(window, cx);
            return false;
        };
        let mut preference = self.requested.clone();
        preference.custom.insert(token.into(), value);
        self.request_preference(preference, window, cx)
    }
    fn request_reset(
        &mut self,
        token: Option<&str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let mut preference = self.requested.clone();
        if let Some(token) = token {
            preference.custom.remove(token);
        } else {
            preference.custom.clear();
        }
        self.request_preference(preference, window, cx)
    }
    fn sync_colors(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let resolved = theme::resolved_token_values(&self.requested, self.prefers_dark);
        for (id, state) in &self.colors {
            state.update(cx, |state, cx| {
                state.set_value(hex_color(&resolved[*id]), window, cx);
                state.set_open(false, cx);
            });
        }
    }
    fn preset_card(&self, preset: ThemePreset, cx: &mut Context<Self>) -> AnyElement {
        let colors = *theme::palette(cx);
        let active = self.requested.preset == preset;
        // The web deliberately shows Editorial swatches for System, even when
        // the machine currently asks for Nightpress.
        let swatch = preset.palette(false);
        let background: Hsla = rgb(colors.vermilion)
            .opacity(if active { 0.06 } else { 0. })
            .into();
        Button::new(SharedString::from(format!(
            "settings-preset-{}",
            preset.id()
        )))
        .custom(
            ButtonCustomVariant::new(cx)
                .color(background)
                .foreground(rgb(colors.ink).into())
                .hover(background)
                .active(background),
        )
        .disabled(!self.writable())
        .toggled(active)
        .accessibility_label(preset.label())
        .w_full()
        .h_auto()
        .p(px(12.))
        .rounded(px(2.))
        .border_1()
        .bg(background)
        .border_color(rgb(if active {
            colors.vermilion
        } else {
            colors.rule
        }))
        .child(
            div()
                .w_full()
                .flex()
                .flex_col()
                .items_start()
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .font_family(DISPLAY_FONT)
                                .text_size(px(14.))
                                .line_height(px(20.))
                                .text_color(rgb(colors.ink))
                                .child(preset.label()),
                        )
                        .when(active, |this| {
                            this.child(
                                tracked_label("IN USE", 9.6, 1.44)
                                    .text_color(rgb(colors.vermilion)),
                            )
                        })
                        .child(
                            div().ml_auto().flex().gap(px(4.)).children(
                                [swatch.paper, swatch.rule, swatch.ink, swatch.vermilion]
                                    .into_iter()
                                    .map(|color| {
                                        div()
                                            .size(px(16.))
                                            .flex_shrink_0()
                                            .border_1()
                                            .border_color(rgb(colors.rule))
                                            .bg(rgb(color))
                                    }),
                            ),
                        ),
                )
                .child(
                    div()
                        .mt(px(4.))
                        .w_full()
                        .min_w_0()
                        .whitespace_normal()
                        .font_family(SERIF_FONT)
                        .text_size(px(10.4))
                        .line_height(px(15.6))
                        .text_color(rgb(colors.ink_muted))
                        .child(preset.description()),
                ),
        )
        .on_click(cx.listener(move |this, _, window, cx| {
            this.request_preset(preset, window, cx);
        }))
        .into_any_element()
    }
    fn token_row(&self, index: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let token = theme::THEME_TOKENS[index];
        let colors = *theme::palette(cx);
        let resolved = theme::resolved_token_values(&self.requested, self.prefers_dark);
        let value = &resolved[token.id];
        let id = token.id;
        let mut row = div()
            .id(SharedString::from(format!("settings-token-{id}")))
            .test_support()
            .flex()
            .items_center()
            .gap(px(12.))
            .py(px(6.))
            .when(index + 1 < theme::THEME_TOKENS.len(), |this| {
                this.border_b_1().border_color(rgb(colors.rule))
            });
        let picker = div()
            .id(SharedString::from(format!("settings-color-{id}")))
            .test_support()
            .w(px(36.))
            .h(px(28.))
            .flex_shrink_0();
        row = row.child(picker.child(self.native_picker(index, window, cx)));
        row = row
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .child(
                        div()
                            .font_family(SERIF_FONT)
                            .text_size(px(12.))
                            .line_height(px(18.))
                            .text_color(rgb(colors.ink))
                            .child(token.label),
                    )
                    .child(
                        div()
                            .font_family(SERIF_FONT)
                            .text_size(px(9.92))
                            .line_height(px(14.88))
                            .text_color(rgb(colors.ink_muted))
                            .child(token.description),
                    ),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .font_family(MONO_FONT)
                    .text_size(px(9.92))
                    .line_height(px(14.88))
                    .text_color(rgb(colors.ink_muted))
                    .child(value.clone()),
            );
        if self.requested.custom.contains_key(id) {
            row = row.child(
                text_button(
                    SharedString::from(format!("settings-reset-{id}")),
                    format!("Reset {}", token.label),
                    "reset",
                    (SERIF_FONT, 9.92, colors.ink_muted),
                    cx,
                )
                .disabled(!self.writable())
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.request_reset(Some(id), window, cx);
                })),
            );
        }
        row.into_any_element()
    }
    /// Browser `<input type=color>` opens a platform chooser. The native
    /// equivalent uses Kit's controlled picker state and opaque RGB controls;
    /// the Settings trigger retains its exact 36-by-28 source dimensions.
    fn native_picker(
        &self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let token = theme::THEME_TOKENS[index];
        let colors = *theme::palette(cx);
        let state = &self.colors[token.id];
        state.update(cx, |state, cx| state.sync_pending_value(window, cx));
        let picker = state.read(cx);
        let open = self.writable() && picker.is_open();
        let value = picker
            .value()
            .expect("Appearance pickers have resolved RGB values");
        let focus = state.focus_handle(cx);
        let input = picker.hex_input().clone();
        let sliders = picker.sliders().clone();
        let open_state = state.clone();
        let popup_state = state.clone();
        let trigger = Button::new(SharedString::from(format!(
            "settings-color-trigger-{}",
            token.id
        )))
        .custom(
            ButtonCustomVariant::new(cx)
                .color(value)
                .foreground(rgb(colors.ink).into())
                .hover(value)
                .active(value),
        )
        .disabled(!self.writable())
        .accessibility_label(token.label)
        .w(px(36.))
        .h(px(28.))
        .p_0()
        .rounded_none()
        .bg(value)
        .border_1()
        .border_color(rgb(colors.rule));
        let mut popup = Popover::new(("appearance-color-popup", state.entity_id()))
            .open(open)
            .w(px(288.))
            .trigger(trigger)
            .on_open_change(move |open, _, cx| {
                popup_state.update(cx, |state, cx| state.set_open(*open, cx))
            });
        if open {
            let mut controls = div()
                .id(SharedString::from(format!(
                    "settings-color-chooser-{}",
                    token.id
                )))
                .test_support()
                .font_family(SANS_FONT)
                .text_size(px(12.))
                .flex()
                .flex_col()
                .gap(px(12.));
            controls = controls.child(
                Input::new(&input)
                    .id(SharedString::from(format!(
                        "settings-color-hex-{}",
                        token.id
                    )))
                    .aria_label(format!("{} hex color", token.label))
                    .small()
                    .font_family(MONO_FONT)
                    .text_size(px(12.)),
            );
            for (name, slider) in [
                ("Hue", sliders.hue()),
                ("Saturation", sliders.saturation()),
                ("Lightness", sliders.lightness()),
            ] {
                controls = controls.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .w(px(72.))
                                .flex_shrink_0()
                                .text_color(rgb(colors.ink_light))
                                .child(name),
                        )
                        .child(Slider::new(slider).flex_1()),
                );
            }
            popup = popup.child(controls);
        }
        gpui_kit::base::ColorPicker::new(("appearance-color", state.entity_id()))
            .accessibility_label(token.label)
            .disabled(!self.writable())
            .open(open)
            .track_focus(&focus)
            .on_open_change(move |open, _, cx| {
                open_state.update(cx, |state, cx| state.set_open(open, cx))
            })
            .w(px(36.))
            .h(px(28.))
            .child(popup)
            .into_any_element()
    }
}

impl Render for SettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = *theme::palette(cx);
        let mut section = div()
            .id("settings-appearance-section")
            .test_support()
            .w_full()
            .p(px(20.))
            .border_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.paper_soft))
            .shadow(vec![
                BoxShadow::new(px(0.), px(1.), rgb(colors.emboss).opacity(0.6).into()).inset(),
                BoxShadow::new(px(0.), px(14.), rgb(colors.shade).opacity(0.4).into())
                    .blur_radius(px(32.))
                    .spread_radius(px(-22.)),
                BoxShadow::new(px(0.), px(2.), rgb(colors.shade).opacity(0.05).into()),
            ])
            .font_family(SERIF_FONT)
            .text_color(rgb(colors.ink))
            .child(
                div()
                    .font_family(DISPLAY_FONT)
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(16.))
                    .line_height(px(24.))
                    .child("Appearance"),
            )
            .child(
                div()
                    .mt(px(4.))
                    .max_w(px(672.))
                    .font_family(SERIF_FONT)
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .text_color(rgb(colors.ink_light))
                    .child(APPEARANCE_DESCRIPTION),
            )
            .child(
                div()
                    .mt(px(16.))
                    .grid()
                    .grid_cols(if f32::from(window.viewport_size().width) >= 640. {
                        2
                    } else {
                        1
                    })
                    .gap(px(12.))
                    .children(
                        ThemePreset::APPEARANCE_ORDER
                            .iter()
                            .map(|preset| self.preset_card(*preset, cx)),
                    ),
            )
            .child(
                div().mt(px(16.)).flex().items_start().child(
                    text_button(
                        "settings-customise-palette".into(),
                        "Customise palette".into(),
                        if self.custom_open {
                            "▾ Customise palette"
                        } else {
                            "▸ Customise palette"
                        },
                        (TYPEWRITER_FONT, 12., colors.ink_light),
                        cx,
                    )
                    .toggled(self.custom_open)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.custom_open = !this.custom_open;
                        cx.notify();
                    })),
                ),
            );
        if self.custom_open {
            let ratio = theme::theme_contrast(&self.requested, self.prefers_dark);
            let passes = ratio >= theme::WCAG_AA_CONTRAST;
            let contrast = format!(
                "{} Ink on paper: {ratio:.1}:1{}",
                if passes { "✓" } else { "⚠" },
                if passes {
                    " — clears WCAG AA."
                } else {
                    " — below the 4.5:1 needed for body text."
                }
            );
            let mut custom = div()
                .id("settings-custom-palette")
                .test_support()
                .mt(px(12.))
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    div()
                        .max_w(px(672.))
                        .text_size(px(10.4))
                        .line_height(px(15.6))
                        .text_color(rgb(colors.ink_muted))
                        .child(OVERRIDES_DESCRIPTION),
                )
                .children(
                    (0..theme::THEME_TOKENS.len()).map(|index| self.token_row(index, window, cx)),
                )
                .child(
                    div()
                        .id("settings-palette-contrast")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(contrast.clone())
                        .pt(px(4.))
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(10.4))
                        .line_height(px(15.6))
                        .text_color(rgb(if passes {
                            colors.ink_muted
                        } else {
                            colors.danger
                        }))
                        .child(contrast),
                );
            if !self.requested.custom.is_empty() {
                let label = format!(
                    "Reset to {}",
                    self.requested.preset.resolve(self.prefers_dark).label()
                );
                custom = custom.child(
                    Button::new("settings-reset-palette")
                        .custom(
                            ButtonCustomVariant::new(cx)
                                .color(rgb(colors.paper_soft).into())
                                .foreground(rgb(colors.ink).into())
                                .hover(rgb(colors.sidebar).into())
                                .active(rgb(colors.sidebar).into()),
                        )
                        .disabled(!self.writable())
                        .accessibility_label(label.clone())
                        .h_auto()
                        .px(px(12.))
                        .py(px(6.))
                        .mt(px(4.))
                        .rounded(px(2.))
                        .border_1()
                        .border_color(rgb(colors.rule))
                        .child(
                            div()
                                .font_family(SERIF_FONT)
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_size(px(12.))
                                .line_height(px(16.))
                                .child(label),
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.request_reset(None, window, cx);
                        })),
                );
            }
            section = section.child(custom);
        }
        if !self.capabilities.persist {
            section = section.child(status(
                "settings-capability-status",
                "Appearance cannot be saved on this device.",
                colors.ink_muted,
                Role::Status,
            ));
        }
        if self.pending.is_some() {
            section = section.child(status(
                "settings-pending-status",
                "Saving appearance…",
                colors.ink_muted,
                Role::Status,
            ));
        }
        if let Some(message) = &self.message {
            section = section.child(status(
                "settings-saved-status",
                message,
                colors.success,
                Role::Status,
            ));
        }
        if let Some(error) = &self.error {
            section = section.child(status("settings-error", error, colors.danger, Role::Alert));
        }
        div()
            .id("settings-appearance-panel")
            .test_support()
            .track_focus(&self.focus_handle)
            .w_full()
            .when(!self.embedded, |this| {
                this.h_full()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll_handle)
            })
            .child(section)
    }
}

fn text_button(
    id: SharedString,
    label: String,
    text: &str,
    typography: (&'static str, f32, u32),
    cx: &App,
) -> Button {
    let (font, size, color) = typography;
    let hover_color = theme::palette(cx).vermilion;
    let transparent: Hsla = rgb(0).opacity(0.).into();
    Button::new(id)
        .custom(
            ButtonCustomVariant::new(cx)
                .color(transparent)
                .foreground(rgb(color).into())
                .hover(transparent)
                .active(transparent),
        )
        .accessibility_label(label)
        .h_auto()
        .p_0()
        .rounded_none()
        .child(
            div()
                .font_family(font)
                .text_size(px(size))
                .line_height(px(size * 1.5))
                .text_color(rgb(color))
                .hover(move |this| this.text_color(rgb(hover_color)))
                .child(text.to_owned()),
        )
}
fn tracked_label(text: &str, size: f32, tracking: f32) -> gpui_kit::Div {
    div()
        .flex()
        .items_center()
        .gap(px(tracking))
        .pr(px(tracking))
        .font_family(TYPEWRITER_FONT)
        .text_size(px(size))
        .line_height(px(size * 1.5))
        .children(text.chars().map(|character| {
            div().flex_shrink_0().child(if character == ' ' {
                "\u{a0}".into()
            } else {
                character.to_string()
            })
        }))
}
fn status(id: &'static str, message: &str, color: u32, role: Role) -> AnyElement {
    div()
        .id(id)
        .test_support()
        .role(role)
        .aria_label(message.to_owned())
        .mt(px(12.))
        .font_family(TYPEWRITER_FONT)
        .text_size(px(10.4))
        .line_height(px(15.6))
        .text_color(rgb(color))
        .child(message.to_owned())
        .into_any_element()
}
fn hex_color(value: &str) -> Hsla {
    rgb(u32::from_str_radix(value.trim_start_matches('#'), 16)
        .expect("resolved colors are validated RGB"))
    .into()
}
fn opaque_hex(value: Hsla) -> String {
    let rgba = value.to_rgb();
    let channel = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(rgba.r),
        channel(rgba.g),
        channel(rgba.b)
    )
}

#[cfg(all(test, feature = "ui-tests"))]
mod ui_tests {
    use super::*;
    use crate::settings::AppearanceStore;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size,
    };
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn panel(
        cx: &mut TestAppContext,
        preference: ThemePreference,
    ) -> (
        AnyWindowHandle,
        Entity<SettingsView>,
        AppearanceStore,
        TempDir,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let store = AppearanceStore::open(directory.path()).unwrap();
        let record = if preference == ThemePreference::default() {
            store.load().unwrap().record
        } else {
            store.save(0, preference, 1).unwrap()
        };
        let (handle, view) = cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(880.), px(1200.)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| {
                    cx.new(|cx| {
                        SettingsView::new(record, AppearanceCapabilities::local(), window, cx)
                    })
                },
            )
            .unwrap()
        });
        (handle, view, store, directory)
    }
    fn events(
        cx: &mut TestAppContext,
        view: &Entity<SettingsView>,
    ) -> Arc<Mutex<Vec<AppearanceRequest>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let handler = received.clone();
        cx.update(|cx| {
            cx.subscribe(view, move |_, event: &SettingsEvent, _| {
                let SettingsEvent::AppearanceRequested(request) = event;
                handler.lock().unwrap().push(request.clone());
            })
            .detach()
        });
        received
    }
    fn acknowledge(
        cx: &mut TestAppContext,
        handle: AnyWindowHandle,
        view: &Entity<SettingsView>,
        store: &AppearanceStore,
        request: &AppearanceRequest,
    ) {
        let saved = store
            .save(request.generation, request.preference.clone(), 20)
            .unwrap();
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                assert!(view.acknowledge_saved(request.request_id, saved, window, cx))
            });
            window.render_frame(cx);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn preset_preview_is_not_saved_until_matching_durable_ack_and_failure_retries(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, store, _directory) = panel(cx, ThemePreference::default());
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                window.find("settings-preset-editorial").label(),
                Some("Editorial")
            );
            window.click("settings-preset-nightpress", cx);
            assert_eq!(
                view.read(cx).requested_preference().preset,
                ThemePreset::Nightpress
            );
            assert_eq!(
                view.read(cx).saved_record().preference.preset,
                ThemePreset::Editorial
            );
            assert!(view.read(cx).message.is_none());
            window.render_frame(cx);
            assert_eq!(
                window.find("settings-pending-status").label(),
                Some("Saving appearance…")
            );
            let pending = view.read(cx).pending_request_id();
            window.click("settings-preset-foolscap", cx);
            assert_eq!(view.read(cx).pending_request_id(), pending);
            assert_eq!(
                view.read(cx).requested_preference().preset,
                ThemePreset::Nightpress
            );
        })
        .unwrap();
        assert_eq!(store.load().unwrap().record.generation, 0);
        let request = received.lock().unwrap()[0].clone();
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                assert!(!view.acknowledge_saved(
                    Uuid::new_v4(),
                    AppearanceRecord::default(),
                    window,
                    cx
                ));
                assert!(view.report_error(request.request_id, "Disk unavailable", cx));
            });
            window.render_frame(cx);
            assert_eq!(
                window.find("settings-error").label(),
                Some("Disk unavailable")
            );
            assert!(window.try_find("settings-saved-status").is_none());
            window.click("settings-preset-nightpress", cx);
        })
        .unwrap();
        let retry = received.lock().unwrap()[1].clone();
        assert_ne!(retry.request_id, request.request_id);
        assert_eq!(retry.generation, request.generation);
        acknowledge(cx, handle, &view, &store, &retry);
        cx.update_window(handle, |_, window, cx| {
            assert_eq!(
                window.find("settings-saved-status").label(),
                Some("Appearance saved")
            );
            assert_eq!(view.read(cx).saved_record(), &store.load().unwrap().record);
            view.update(cx, |view, cx| {
                assert!(!view.report_error(request.request_id, "Late error", cx))
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn native_color_chooser_commits_an_opaque_rgb_override_from_real_input(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, store, _directory) = panel(cx, ThemePreference::default());
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click("settings-customise-palette", cx);
            window.render_frame(cx);
            let bounds = window.find("settings-color-trigger-ink").bounds();
            assert_eq!(bounds.size, size(px(36.), px(28.)));
            window.click("settings-color-trigger-ink", cx);
            window.render_frame(cx);
            window.click("settings-color-hex-ink", cx);
            window.press("secondary-a", cx);
            window.input("#ABC", cx);
            window.press("enter", cx);
        })
        .unwrap();
        let request = received.lock().unwrap().last().unwrap().clone();
        assert_eq!(request.preference.custom.get("ink").unwrap(), "#aabbcc");
        assert_eq!(
            view.read_with(cx, |view, _| view.saved_record().generation),
            0
        );
        acknowledge(cx, handle, &view, &store, &request);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("settings-reset-ink").label(), Some("Reset Ink"));
            assert!(
                window
                    .find("settings-palette-contrast")
                    .label()
                    .unwrap()
                    .contains("below the 4.5:1")
            );
            assert!(!view.read(cx).colors["ink"].read(cx).is_open());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn system_os_changes_keep_overrides_and_resets_preserve_the_selected_preset(
        cx: &mut TestAppContext,
    ) {
        let preference = ThemePreference {
            preset: ThemePreset::System,
            custom: BTreeMap::from([
                ("paper".into(), "#eeeeee".into()),
                ("ink".into(), "#123456".into()),
            ]),
        };
        let (handle, view, store, _directory) = panel(cx, preference.clone());
        let received = events(cx, &view);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| view.set_prefers_dark(true, window, cx));
            window.render_frame(cx);
            window.click("settings-customise-palette", cx);
            window.render_frame(cx);
            assert_eq!(
                window.find("settings-reset-palette").label(),
                Some("Reset to Nightpress")
            );
            assert_eq!(view.read(cx).requested_preference(), &preference);
            window.click("settings-reset-paper", cx);
        })
        .unwrap();
        let first = received.lock().unwrap()[0].clone();
        assert_eq!(first.preference.preset, ThemePreset::System);
        assert!(!first.preference.custom.contains_key("paper"));
        assert_eq!(first.preference.custom["ink"], "#123456");
        acknowledge(cx, handle, &view, &store, &first);
        cx.update_window(handle, |_, window, cx| {
            window.click("settings-preset-foolscap", cx);
        })
        .unwrap();
        let second = received.lock().unwrap()[1].clone();
        assert_eq!(second.preference.custom["ink"], "#123456");
        acknowledge(cx, handle, &view, &store, &second);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                window.find("settings-reset-palette").label(),
                Some("Reset to Foolscap")
            );
            window.click("settings-reset-palette", cx);
        })
        .unwrap();
        let third = received.lock().unwrap()[2].clone();
        assert_eq!(third.preference.preset, ThemePreset::Foolscap);
        assert!(third.preference.custom.is_empty());
        acknowledge(cx, handle, &view, &store, &third);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                view.set_capabilities(AppearanceCapabilities::default(), cx)
            });
            window.render_frame(cx);
            window.click("settings-preset-system", cx);
            assert!(view.read(cx).pending_request_id().is_none());
            assert_eq!(
                window.find("settings-capability-status").label(),
                Some("Appearance cannot be saved on this device.")
            );
        })
        .unwrap();
        assert_eq!(received.lock().unwrap().len(), 3);
    }
}
