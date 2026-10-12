//! The source's mount-local steering draft remains editable offline. Only an
//! explicit submission projects manuscript text and asks the original guard;
//! rendering and ordinary typing never inspect the manuscript or start research.

use super::*;
use gpui_kit::EntityInputHandler;

pub(super) struct SteeringState {
    draft: Entity<TextareaState>,
    collapsed: bool,
    error: Option<String>,
    request: Option<Uuid>,
    task: Option<Task<()>>,
    editor_mounted: bool,
}

impl SteeringState {
    pub(super) fn new(window: &mut Window, cx: &mut Context<WritingRoom>) -> Self {
        Self {
            draft: cx.new(|cx| {
                TextareaState::new(window, cx)
                    .placeholder("Prefer primary sources, trace the original quotation…")
                    .submit_on_enter(true)
                    .auto_grow(1, 32)
            }),
            collapsed: false,
            error: None,
            request: None,
            task: None,
            editor_mounted: true,
        }
    }

    pub(super) fn subscribe(
        &self,
        window: &mut Window,
        cx: &mut Context<WritingRoom>,
    ) -> Vec<Subscription> {
        vec![
            cx.subscribe_in(
                &self.draft,
                window,
                |this, _, event, window, cx| match event {
                    InputEvent::Change => {
                        this.steering.error = None;
                        cx.notify();
                    }
                    InputEvent::PressEnter { shift: false, .. } => {
                        let input = this.steering.draft.clone();
                        let composing = input.update(cx, |input, cx| {
                            input.marked_text_range(window, cx).is_some()
                        });
                        if !composing {
                            this.submit_research_steering(window, cx);
                        }
                    }
                    InputEvent::Focus | InputEvent::Blur => cx.notify(),
                    _ => {}
                },
            ),
            cx.observe(&self.draft, |_, _, cx| cx.notify()),
        ]
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{TestAppContext, test::TestWindowExt};

    #[gpui_kit::test]
    fn actual_steering_enter_retains_draft_and_reports_original_offline_guard(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = super::super::tests::room(cx);
        let html = "<p>A manuscript with enough accepted draft text for a directed research pass. This writing stays exactly as authored while the steering draft is edited and its unavailable provider is reported.</p>";
        let path = store.root().join("Steering.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.set_write(window, cx);
                room.open_apparatus(ApparatusSurface::Board, window, cx);
                room.steering.draft.update(cx, |input, cx| {
                    input.set_value(" \u{feff}\u{00a0}", window, cx);
                });
            });
            window.render_frame(cx);
            window.click("steering-input", cx);
            window.press("enter", cx);
            assert!(room.read(cx).steering.request.is_none());
            assert_eq!(
                room.read(cx).steering.draft.read(cx).value(),
                " \u{feff}\u{00a0}"
            );
            window.press("ctrl-a", cx);
            window.input("Trace the original quotation.", cx);
            window.press("shift-enter", cx);
            window.input("Prefer primary sources.", cx);
            assert_eq!(
                room.read(cx).steering.draft.read(cx).value(),
                "Trace the original quotation.\nPrefer primary sources."
            );
            // Source consumes every non-Shift Enter, including modifiers.
            window.press("alt-enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            room.update(cx, |room, cx| {
                assert!(room.steering.request.is_none());
                assert_eq!(
                    room.steering.error.as_deref(),
                    Some("Choose an AI provider in Settings before steering a draft-wide pass.")
                );
                assert_eq!(
                    room.steering.draft.read(cx).value(),
                    "Trace the original quotation.\nPrefer primary sources."
                );
                assert_eq!(
                    room.rich.as_ref().unwrap().read(cx).document().to_html(),
                    html
                );
                let input_id = room.steering.draft.entity_id();
                room.steering.collapsed = true;
                room.open_cast(CastSurface::Board, window, cx);
                room.open_apparatus(ApparatusSurface::Board, window, cx);
                assert_eq!(room.steering.draft.entity_id(), input_id);
                assert!(room.steering.collapsed && room.steering.error.is_some());
                room.open_apparatus(ApparatusSurface::Page, window, cx);
            });
            window.render_frame(cx);
            assert!(room.read(cx).steering.draft.read(cx).value().is_empty());
            assert!(!room.read(cx).steering.collapsed && room.read(cx).steering.error.is_none());
        })
        .unwrap();
    }
    #[gpui_kit::test]
    fn rejected_departure_retains_steering_and_accepted_settings_clears_it(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = super::super::tests::room(cx);
        let active = cx.update(|cx| room.read(cx).active);
        let obstruction = store.document_path(active).with_extension("json.bak");
        std::fs::create_dir(&obstruction).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                room.steering.draft.update(cx, |input, cx| {
                    input.set_value("A retained direction.", window, cx);
                });
                room.steering.error = Some("A retained explanation.".into());
                room.steering.collapsed = true;
                room.title.update(cx, |input, cx| {
                    input.set_value("An unfiled title", window, cx);
                });
                room.open_settings(window, cx);
                assert!(!room.settings_route);
            });
            window.render_frame(cx);
            assert_eq!(
                room.read(cx).steering.draft.read(cx).value(),
                "A retained direction."
            );
            assert_eq!(
                room.read(cx).steering.error.as_deref(),
                Some("A retained explanation.")
            );
            assert!(room.read(cx).steering.collapsed);
            std::fs::remove_dir(&obstruction).unwrap();
            room.update(cx, |room, cx| room.open_settings(window, cx));
            window.render_frame(cx);
            assert!(room.read(cx).settings_route);
            assert!(room.read(cx).steering.draft.read(cx).value().is_empty());
            assert!(!room.read(cx).steering.collapsed && room.read(cx).steering.error.is_none());
            window.click("settings-back", cx);
            window.render_frame(cx);
            assert!(!room.read(cx).settings_route);
            assert!(room.read(cx).steering.draft.read(cx).value().is_empty());
        })
        .unwrap();
        cx.run_until_parked();
    }
}

impl WritingRoom {
    pub(super) fn sync_research_steering_mount(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mounted = !self.standalone_route() && self.dossier.is_none();
        if !mounted && self.steering.editor_mounted {
            self.reset_research_steering(window, cx);
        }
        self.steering.editor_mounted = mounted;
    }

    pub(super) fn reset_research_steering(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.steering.task = None;
        self.steering.request = None;
        self.steering.error = None;
        self.steering.collapsed = false;
        self.steering
            .draft
            .update(cx, |input, cx| input.set_value("", window, cx));
    }

    fn submit_research_steering(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let instructions = self.steering.draft.read(cx).value().to_string();
        if instructions
            .trim_matches(twyne_desktop::house::is_js_whitespace)
            .is_empty()
            || self.steering.request.is_some()
        {
            return;
        }
        let request = Uuid::new_v4();
        let scope = self.marginalia_folio_id();
        let document = self.rich.as_ref().map(|view| view.read(cx).snapshot());
        self.steering.request = Some(request);
        self.steering.error = None;
        self.steering.task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let text = document
                        .as_ref()
                        .map_or_else(String::new, RichDocument::research_text);
                    twyne_desktop::semantic_bridge::SemanticBridge::discover()?
                        .apparatus_steer_offline(&instructions, Some(&scope), &text)
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.steering.request != Some(request) {
                    return;
                }
                this.steering.request = None;
                this.steering.task = None;
                this.steering.error = Some(match result {
                    Ok(result) => result
                        .message
                        .unwrap_or_else(|| "The Apparatus could not start.".into()),
                    Err(error) => format!("The Apparatus could not start: {error:#}"),
                });
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub(super) fn research_steering(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let p = *palette(cx);
        let open = !self.steering.collapsed;
        let focused = self
            .steering
            .draft
            .read(cx)
            .focus_handle(cx)
            .contains_focused(window, cx);
        let sendable = !self
            .steering
            .draft
            .read(cx)
            .value()
            .trim_matches(twyne_desktop::house::is_js_whitespace)
            .is_empty()
            && self.steering.request.is_none();
        let disclosure_label = if open {
            "Collapse research steering"
        } else {
            "Expand research steering"
        };
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .min_h(px(38.4))
            .px(px(10.4))
            .py(px(4.))
            .border_b_1()
            .border_color(rgb(p.rule).opacity(0.72))
            .child(dept_label("Steer search", cx))
            .child(focus_outline(
                gpui_kit::base::Button::new("steering-disclosure")
                    .accessibility_label(disclosure_label)
                    .aria_expanded(open)
                    .size(px(36.))
                    .p_0()
                    .rounded_none()
                    .font_family(TYPEWRITER_FONT)
                    .text_size(px(12.8))
                    .line_height(relative(1.))
                    .text_color(rgb(p.ink_light))
                    .hover(|this| this.text_color(rgb(p.ink)))
                    .child(if open { "▾" } else { "▸" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.steering.collapsed = !this.steering.collapsed;
                        cx.notify();
                    })),
                2.,
                0.,
                p.vermilion,
            ));
        let mut section = div()
            .id("research-steering")
            .test_support()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .bg(rgb(p.mustard).opacity(0.04))
            .border_b_1()
            .border_color(rgb(p.rule))
            .child(header);
        if open {
            let mut bar = div()
                .flex()
                .items_center()
                .gap(px(8.))
                .pt(px(4.8))
                .px(px(8.))
                .pb(px(7.2))
                .child(div().flex_1().min_w_0());
            if f32::from(window.viewport_size().width) > 640. {
                bar = bar.child(tracked_text(
                    "⏎ STEER",
                    font(TYPEWRITER_FONT),
                    9.6,
                    1.152,
                    p.ink_muted,
                    14.4,
                ));
            }
            let send = gpui_kit::base::Button::new("steering-send")
                .accessibility_label("Steer")
                .tooltip(|window, cx| {
                    gpui_kit::component::tooltip::Tooltip::new("Steer").build(window, cx)
                })
                .size(px(29.6))
                .p_0()
                .rounded(px(2.))
                .border_1()
                .disabled(!sendable)
                .border_color(rgb(if sendable { p.ink } else { p.rule }))
                .text_color(rgb(if sendable { p.paper } else { p.ink_muted }))
                .when(sendable, |this| {
                    this.bg(rgb(p.ink))
                        .hover(|this| this.bg(rgb(p.vermilion_deep)))
                })
                .child(assets::composer_send_icon())
                .on_click(
                    cx.listener(|this, _, window, cx| this.submit_research_steering(window, cx)),
                );
            bar = bar.child(focus_outline(send, 2., 0., p.vermilion));
            let composer = div()
                .id("steering-composer")
                .test_support()
                .flex()
                .flex_col()
                .w_full()
                .rounded(px(3.))
                .border_1()
                .border_color(rgb(if focused { p.vermilion } else { p.rule }))
                .bg(rgb(p.paper_soft))
                .shadow(vec![
                    gpui_kit::BoxShadow::new(px(0.), px(1.), rgb(0x201910).opacity(0.04).into())
                        .blur_radius(px(2.)),
                ])
                .when(focused, |this| {
                    this.shadow(vec![
                        gpui_kit::BoxShadow::new(
                            px(0.),
                            px(0.),
                            rgb(p.vermilion).opacity(0.12).into(),
                        )
                        .spread_radius(px(3.)),
                    ])
                })
                .child(
                    div()
                        .id("steering-input")
                        .test_support()
                        .pt(px(11.2))
                        // Kit keeps four pixels of internal horizontal
                        // padding in XSmall, even with appearance disabled.
                        // Together these retain Source's authored 13.6px.
                        .px(px(9.6))
                        .pb(px(2.4))
                        .capture_key_down(cx.listener(
                            |this, event: &gpui_kit::KeyDownEvent, window, cx| {
                                if event.keystroke.key != "enter" || event.keystroke.modifiers.shift
                                {
                                    return;
                                }
                                let input = this.steering.draft.clone();
                                if !input.read(cx).focus_handle(cx).contains_focused(window, cx) {
                                    return;
                                }
                                if input.update(cx, |input, cx| {
                                    input.marked_text_range(window, cx).is_some()
                                }) {
                                    return;
                                }
                                window.prevent_default();
                                cx.stop_propagation();
                                this.submit_research_steering(window, cx);
                            },
                        ))
                        .child(
                            Textarea::new(&self.steering.draft)
                                .xsmall()
                                .accessibility_id("steering-draft")
                                .appearance(false)
                                .bordered(false)
                                .p_0()
                                .max_h(px(f32::from(window.viewport_size().height) * 0.4))
                                .font_family(SERIF_FONT)
                                .text_size(px(15.2))
                                .line_height(px(23.56))
                                .text_color(rgb(p.ink))
                                .aria_label("Research direction"),
                        ),
                )
                .child(bar);
            let mut body = div().pt(px(8.8)).px(px(10.4)).pb(px(10.4)).child(composer);
            if let Some(error) = &self.steering.error {
                body = body.child(
                    div()
                        .id("steering-error")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(error.clone())
                        .mt(px(7.2))
                        .font_family(TYPEWRITER_FONT)
                        .text_size(px(10.4))
                        .line_height(px(14.56))
                        .text_color(rgb(p.vermilion))
                        .child(error.clone()),
                );
            }
            section = section.child(body);
        }
        section.into_any_element()
    }
}
