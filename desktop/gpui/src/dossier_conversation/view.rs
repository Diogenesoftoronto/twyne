//! Proposed GPUI conversation view for Twyne's native dossier port.
//!
//! Unmounted two-leaf conversation view foundation. Layout is Source-derived,
//! not an observed rendered-parity claim. Generation requires a real host
//! request consumer; default capabilities fail closed into the offline form.
//!
//! Current presentation:
//! - Left leaf: seven-field preview, confidence dots and filled-progress gauge.
//! - Right leaf: transcript, composer, error/retry, synthesis filing banner
//!   and form handoff. Typed probe cards, inline review inputs, reference cards,
//!   reasoning/stream display and responsive visual parity are still pending.

#[cfg(feature = "desktop")]
mod desktop_view {
    use crate::{
        dossier::{DossierSubmission, FilingState, default_answers},
        dossier_conversation::{
            amendment::DossierAmendedEvent,
            protocol::{BriefField, InterviewTurnResult, MessageAuthor},
            session::{ConversationMode, ConversationSession, js_trim},
        },
        manuscript::timestamp,
        theme::{DISPLAY_FONT, SERIF_FONT, TYPEWRITER_FONT},
        workspace::ProbeAnswer,
    };
    use anyhow::Result;
    use gpui_kit::component::button::{Button, ButtonVariants};
    use gpui_kit::component::input::{InputEvent, InputState, Textarea, TextareaState};
    use gpui_kit::component::{Disableable, Sizable};
    use gpui_kit::prelude::*;
    use gpui_kit::{
        AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, FontWeight,
        IntoElement, Render, Subscription, Window, div, px, rgb,
    };
    use std::collections::BTreeMap;

    #[derive(Clone, Copy, Debug, Default)]
    pub struct DossierConversationCapabilities {
        pub can_switch_surface: bool,
        pub can_start_over: bool,
        /// Set only with a functioning request consumer. A configured provider
        /// row, account name, or key is not evidence of a connected transport.
        pub can_generate: bool,
    }

    #[derive(Clone, Debug)]
    pub enum DossierConversationEvent {
        /// A request to file the prepared submission. The session is in
        /// `Filing` until the caller durably saves and calls
        /// `ConversationSession::acknowledge_filed`.
        FilingRequested {
            token: u64,
            submission: DossierSubmission,
        },
        Cancelled,
        SwitchToFormRequested,
        StartOverRequested,
        SendMessageRequested {
            token: u64,
            text: String,
        },
        ProbeAnswered {
            token: u64,
            answer: ProbeAnswer,
        },
        RetryRequested {
            token: u64,
        },
        SynthesisRequested {
            token: u64,
        },
        DossierAmended(DossierAmendedEvent),
    }

    pub struct DossierConversationView {
        pub session: ConversationSession,
        pub capabilities: DossierConversationCapabilities,
        pub composer_input: Entity<TextareaState>,
        pub inline_edit_input: Option<Entity<InputState>>,
        pub focus_handle: FocusHandle,
        pub open_reasoning: BTreeMap<usize, bool>,
        pub start_over_confirm: bool,
        _subscriptions: Vec<Subscription>,
    }

    impl EventEmitter<DossierConversationEvent> for DossierConversationView {}

    impl Focusable for DossierConversationView {
        fn focus_handle(&self, _: &App) -> FocusHandle {
            self.focus_handle.clone()
        }
    }

    impl DossierConversationView {
        pub fn new(
            mut session: ConversationSession,
            capabilities: DossierConversationCapabilities,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) -> Self {
            session.start();

            let composer_input = cx.new(|cx| {
                TextareaState::new(window, cx).placeholder("Type your answer here, or press enter…")
            });

            let mut subscriptions = Vec::new();
            subscriptions.push(cx.subscribe_in(
                &composer_input,
                window,
                |this, _, event, window, cx| {
                    if let InputEvent::PressEnter { shift, .. } = event
                        && !*shift
                        && !this.session.loading
                    {
                        this.send_message(window, cx);
                    }
                },
            ));

            Self {
                session,
                capabilities,
                composer_input,
                inline_edit_input: None,
                focus_handle: cx.focus_handle(),
                open_reasoning: BTreeMap::new(),
                start_over_confirm: false,
                _subscriptions: subscriptions,
            }
        }

        pub fn send_message(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
            if self.session.loading || self.session.synthesis.is_some() {
                return;
            }
            let text = self.composer_input.read(cx).text().to_string();
            let trimmed = js_trim(&text);
            if trimmed.is_empty() {
                return;
            }

            match self.session.send_writer_text(trimmed) {
                Ok(token) => {
                    self.emit_generation_or_unavailable(
                        token,
                        DossierConversationEvent::SendMessageRequested {
                            token,
                            text: trimmed.to_string(),
                        },
                        cx,
                    );
                    cx.notify();
                }
                Err(e) => {
                    self.session.error = Some(e.to_string());
                    cx.notify();
                }
            }
        }

        fn emit_generation_or_unavailable(
            &mut self,
            token: u64,
            event: DossierConversationEvent,
            cx: &mut Context<Self>,
        ) {
            if self.capabilities.can_generate {
                cx.emit(event);
            } else {
                let _ = self.session.receive_turn_result(token, Err(
                    "The conversation provider is not connected in this desktop build. Use the form to keep working.".into()));
            }
        }

        /// Adopt only this live generation. Failed turns retain composer text;
        /// an accepted success clears only the input that was actually sent.
        pub fn receive_turn_result(
            &mut self,
            token: u64,
            result: Result<InterviewTurnResult, String>,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) -> Result<bool> {
            if self.session.active_request != Some(token) {
                return Ok(false);
            }
            let pending = self.session.pending_writer_text.clone();
            let succeeded = self.session.receive_turn_result(token, result)?;
            let current_input = self.composer_input.read(cx).text().to_string();
            if succeeded && pending.as_deref() == Some(js_trim(&current_input)) {
                self.composer_input
                    .update(cx, |state, cx| state.set_value("", window, cx));
            }
            cx.notify();
            Ok(succeeded)
        }

        pub fn acknowledge_filed(&mut self, token: u64, cx: &mut Context<Self>) -> Result<bool> {
            let accepted = self.session.acknowledge_filed(token)?;
            if accepted {
                cx.notify();
            }
            Ok(accepted)
        }

        pub fn report_filing_error(
            &mut self,
            token: u64,
            error: impl Into<String>,
            cx: &mut Context<Self>,
        ) -> bool {
            if !self.session.filing_failed(token) {
                return false;
            }
            self.session.error = Some(error.into());
            cx.notify();
            true
        }

        pub fn answer_probe(
            &mut self,
            answer: ProbeAnswer,
            _window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            match self.session.answer_probe(answer.clone()) {
                Ok(token) => {
                    self.emit_generation_or_unavailable(
                        token,
                        DossierConversationEvent::ProbeAnswered { token, answer },
                        cx,
                    );
                    cx.notify();
                }
                Err(e) => {
                    self.session.error = Some(e.to_string());
                    cx.notify();
                }
            }
        }

        pub fn skip_probe(&mut self, cx: &mut Context<Self>) {
            self.session.skip_probe();
            cx.notify();
        }

        pub fn request_synthesis(&mut self, cx: &mut Context<Self>) {
            match self.session.request_synthesis() {
                Ok(token) => {
                    self.emit_generation_or_unavailable(
                        token,
                        DossierConversationEvent::SynthesisRequested { token },
                        cx,
                    );
                    cx.notify();
                }
                Err(e) => {
                    self.session.error = Some(e.to_string());
                    cx.notify();
                }
            }
        }

        pub fn accept_synthesis(&mut self, cx: &mut Context<Self>) {
            match self.session.prepare_filing(timestamp()) {
                Ok(submission) => {
                    let token = self
                        .session
                        .filing_token()
                        .expect("prepared filing has a token");
                    cx.emit(DossierConversationEvent::FilingRequested { token, submission });
                    cx.notify();
                }
                Err(e) => {
                    self.session.error = Some(e.to_string());
                    cx.notify();
                }
            }
        }

        pub fn dismiss_synthesis(&mut self, cx: &mut Context<Self>) {
            self.session.dismiss_synthesis();
            cx.notify();
        }

        pub fn retry_turn(&mut self, cx: &mut Context<Self>) {
            match self.session.retry_turn() {
                Ok(token) => {
                    self.emit_generation_or_unavailable(
                        token,
                        DossierConversationEvent::RetryRequested { token },
                        cx,
                    );
                    cx.notify();
                }
                Err(e) => {
                    self.session.error = Some(e.to_string());
                    cx.notify();
                }
            }
        }

        pub fn switch_to_form(&mut self, cx: &mut Context<Self>) {
            if !self.capabilities.can_switch_surface
                || self.session.filing_state != FilingState::Idle
            {
                return;
            }
            self.session.retire_inflight();
            cx.emit(DossierConversationEvent::SwitchToFormRequested);
        }

        pub fn cancel(&mut self, cx: &mut Context<Self>) {
            self.session.cancel();
            cx.emit(DossierConversationEvent::Cancelled);
        }

        fn render_left_preview(&self, _cx: &Context<Self>) -> AnyElement {
            let answers = if let Some(synth) = &self.session.synthesis {
                synth.brief.clone()
            } else if let Some(live) = &self.session.live_draft {
                live.brief.fill_with_defaults(
                    self.session
                        .options
                        .existing_brief
                        .as_ref()
                        .map(|b| &b.answers),
                )
            } else if let Some(existing) = &self.session.options.existing_brief {
                existing.answers.clone()
            } else {
                default_answers()
            };

            let filled_count = self.session.filled_fields();
            let progress_pct = (filled_count as f32 / 7.0 * 100.0).round() as u32;

            div()
                .w(px(380.0))
                .h_full()
                .border_r_1()
                .border_color(rgb(0xddd0b1)) // --color-paper-3
                .bg(rgb(0xf4ecd8)) // --color-paper
                .flex()
                .flex_col()
                .p(px(20.0))
                .gap(px(16.0))
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .items_center()
                        .child(
                            div()
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(11.0))
                                .text_color(rgb(0x8a7e6c)) // --color-ink-muted
                                .child(if self.session.synthesis.is_some() {
                                    "READY FOR REVIEW"
                                } else {
                                    "FILLING AS YOU TALK"
                                }),
                        )
                        .child(
                            div()
                                .font_family(TYPEWRITER_FONT)
                                .text_size(px(11.0))
                                .text_color(rgb(0x8a7e6c)) // --color-ink-muted
                                .child(format!("{filled_count} of 7 filled")),
                        ),
                )
                .child(
                    // Progress bar
                    div()
                        .w_full()
                        .h(px(3.0))
                        .bg(rgb(0xebe1c9)) // --color-paper-2
                        .child(
                            div()
                                .h_full()
                                .w(px(3.4 * progress_pct as f32))
                                .bg(rgb(0xc1272d)), // --color-vermilion
                        ),
                )
                .child(
                    // 7 Fields Preview
                    div().flex().flex_col().gap(px(12.0)).children(
                        crate::dossier_conversation::protocol::BRIEF_FIELDS
                            .iter()
                            .map(|&field| {
                                let label = match field {
                                    BriefField::WorkingTitle => "WORKING TITLE",
                                    BriefField::Format => "FORMAT",
                                    BriefField::Audience => "AUDIENCE",
                                    BriefField::Goal => "GOAL",
                                    BriefField::Tone => "TONE",
                                    BriefField::Constraints => "NON-NEGOTIABLES",
                                    BriefField::SuccessSignal => "SUCCESS SIGNAL",
                                };
                                let val = crate::dossier::answer(&answers, field).to_string();
                                let is_empty = val.trim().is_empty();
                                let display_value = if is_empty { "—".to_string() } else { val };

                                let dot_color = if is_empty {
                                    rgb(0xddd0b1) // --color-paper-3
                                } else if let Some(synth) = &self.session.synthesis {
                                    match synth.confidence.get(&field) {
                                        Some(conf) => {
                                            let (r, g, b) = conf.rgb();
                                            rgb(((r as u32) << 16) | ((g as u32) << 8) | b as u32)
                                        }
                                        None => rgb(0x5b7a3a),
                                    }
                                } else if let Some(live) = &self.session.live_draft {
                                    match live.confidence.get(&field) {
                                        Some(conf) => {
                                            let (r, g, b) = conf.rgb();
                                            rgb(((r as u32) << 16) | ((g as u32) << 8) | b as u32)
                                        }
                                        None => rgb(0xd4a017),
                                    }
                                } else {
                                    rgb(0xddd0b1)
                                };

                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(6.0))
                                            .child(
                                                div()
                                                    .w(px(6.0))
                                                    .h(px(6.0))
                                                    .rounded_full()
                                                    .bg(dot_color),
                                            )
                                            .child(
                                                div()
                                                    .font_family(TYPEWRITER_FONT)
                                                    .text_size(px(10.0))
                                                    .text_color(rgb(0x8a7e6c))
                                                    .child(label),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .font_family(SERIF_FONT)
                                            .text_size(px(13.0))
                                            .text_color(if is_empty {
                                                rgb(0x8a7e6c)
                                            } else {
                                                rgb(0x1f1b16)
                                            })
                                            .child(display_value),
                                    )
                            }),
                    ),
                )
                .into_any_element()
        }

        fn render_transcript_thread(&self, _cx: &Context<Self>) -> AnyElement {
            div()
                .flex_1()
                .flex()
                .flex_col()
                .p(px(24.0))
                .gap(px(16.0))
                .children(self.session.messages.iter().map(|msg| {
                    let is_writer = msg.author == MessageAuthor::Writer;
                    if is_writer {
                        div().flex().justify_end().child(
                            div()
                                .max_w(px(520.0))
                                .bg(rgb(0xc1272d))
                                .text_color(rgb(0xffffff))
                                .font_family(SERIF_FONT)
                                .text_size(px(14.0))
                                .p(px(12.0))
                                .rounded(px(4.0))
                                .child(msg.text.clone()),
                        )
                    } else {
                        div()
                            .flex()
                            .flex_col()
                            .items_start()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .font_family(TYPEWRITER_FONT)
                                    .text_size(px(10.0))
                                    .text_color(rgb(0x8a7e6c))
                                    .child("THE ROOM"),
                            )
                            .child(
                                div()
                                    .max_w(px(520.0))
                                    .bg(rgb(0xebe1c9))
                                    .border_1()
                                    .border_color(rgb(0xddd0b1))
                                    .text_color(rgb(0x1f1b16))
                                    .font_family(DISPLAY_FONT)
                                    .text_size(px(14.0))
                                    .p(px(12.0))
                                    .rounded(px(4.0))
                                    .child(msg.text.clone()),
                            )
                    }
                }))
                .into_any_element()
        }
    }

    impl Render for DossierConversationView {
        fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let filing = self.session.filing_state != FilingState::Idle;
            let busy = filing || self.session.loading;
            div()
                .size_full()
                .flex()
                .bg(rgb(0xf4ecd8))
                .child(self.render_left_preview(cx))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .h_full()
                        // Right column top bar
                        .child(
                            div()
                                .h(px(48.0))
                                .border_b_1()
                                .border_color(rgb(0xddd0b1))
                                .flex()
                                .items_center()
                                .justify_between()
                                .px(px(20.0))
                                .child(
                                    div()
                                        .font_family(DISPLAY_FONT)
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_size(px(14.0))
                                        .text_color(rgb(0x1f1b16))
                                        .child(match self.session.options.mode {
                                            ConversationMode::Create => "The Interview",
                                            ConversationMode::Refine => "Refine the Dossier",
                                        }),
                                )
                                .child(div().flex().items_center().gap(px(10.0)).when(
                                    self.capabilities.can_switch_surface,
                                    |this| {
                                        this.child(
                                            Button::new("dossier-conversation-use-form")
                                                .ghost()
                                                .small()
                                                .font_family(TYPEWRITER_FONT)
                                                .text_size(px(11.0))
                                                .text_color(rgb(0x8a7e6c))
                                                .label("Use the form")
                                                .disabled(filing)
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    this.switch_to_form(cx)
                                                })),
                                        )
                                    },
                                )),
                        )
                        // Transcript thread
                        .child(self.render_transcript_thread(cx))
                        .when_some(self.session.error.clone(), |this, error| {
                            this.child(div().p(px(16.0)).bg(rgb(0xebe1c9)).child(error).when(
                                self.session.pending_writer_text.is_some() && !busy,
                                |this| {
                                    this.child(
                                        Button::new("dossier-conversation-retry")
                                            .ghost()
                                            .small()
                                            .label("Retry")
                                            .on_click(
                                                cx.listener(|this, _, _, cx| this.retry_turn(cx)),
                                            ),
                                    )
                                },
                            ))
                        })
                        // Synthesis review banner if present
                        .when(self.session.synthesis.is_some(), |this| {
                            this.child(
                                div()
                                    .p(px(16.0))
                                    .bg(rgb(0xebe1c9))
                                    .border_t_1()
                                    .border_color(rgb(0xddd0b1))
                                    .flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .font_family(DISPLAY_FONT)
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_size(px(14.0))
                                            .text_color(rgb(0x1f1b16))
                                            .child("The room has prepared your dossier."),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .gap(px(8.0))
                                            .child(
                                                Button::new("dossier-conversation-file")
                                                    .primary()
                                                    .px(px(16.0))
                                                    .py(px(8.0))
                                                    .rounded(px(20.0))
                                                    .bg(rgb(0xc1272d))
                                                    .text_color(rgb(0xffffff))
                                                    .font_family(DISPLAY_FONT)
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .text_size(px(13.0))
                                                    .label(if filing {
                                                        "Filing…"
                                                    } else {
                                                        "File and open the desk"
                                                    })
                                                    .disabled(busy)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.accept_synthesis(cx)
                                                    })),
                                            )
                                            .child(
                                                Button::new("dossier-conversation-keep-talking")
                                                    .ghost()
                                                    .px(px(12.0))
                                                    .py(px(8.0))
                                                    .font_family(TYPEWRITER_FONT)
                                                    .text_size(px(12.0))
                                                    .text_color(rgb(0x8a7e6c))
                                                    .label("Keep talking")
                                                    .disabled(filing)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.dismiss_synthesis(cx)
                                                    })),
                                            ),
                                    ),
                            )
                        })
                        // Bottom Composer
                        .when(self.session.synthesis.is_none(), |this| {
                            this.child(
                                div()
                                    .p(px(16.0))
                                    .border_t_1()
                                    .border_color(rgb(0xddd0b1))
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.0))
                                    .child(Textarea::new(&self.composer_input).disabled(busy))
                                    .child(
                                        div()
                                            .flex()
                                            .justify_between()
                                            .items_center()
                                            .child(
                                                Button::new("dossier-conversation-synthesize")
                                                    .ghost()
                                                    .small()
                                                    .font_family(TYPEWRITER_FONT)
                                                    .text_size(px(11.0))
                                                    .text_color(rgb(0x8a7e6c))
                                                    .label("→ Show me what you have")
                                                    .disabled(busy)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.request_synthesis(cx)
                                                    })),
                                            )
                                            .child(
                                                Button::new("dossier-conversation-send")
                                                    .primary()
                                                    .small()
                                                    .px(px(14.0))
                                                    .py(px(6.0))
                                                    .rounded(px(3.0))
                                                    .bg(rgb(0xc1272d))
                                                    .text_color(rgb(0xffffff))
                                                    .font_family(TYPEWRITER_FONT)
                                                    .text_size(px(12.0))
                                                    .label("Send")
                                                    .disabled(busy)
                                                    .on_click(cx.listener(
                                                        |this, _, window, cx| {
                                                            this.send_message(window, cx)
                                                        },
                                                    )),
                                            ),
                                    ),
                            )
                        }),
                )
        }
    }
}

#[cfg(feature = "desktop")]
pub use desktop_view::*;
