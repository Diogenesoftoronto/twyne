use super::*;

impl WritingRoom {
    pub(super) fn editorial_board_panel(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let colors = *palette(cx);
        let narrow = f32::from(window.viewport_size().width) <= 720.;
        let accent = match self.desk.board_context {
            BoardContext::Tools => colors.vermilion_deep,
            BoardContext::Marginalia => colors.mustard,
            BoardContext::Cast => colors.vermilion,
            BoardContext::Apparatus => colors.periwinkle,
            _ => colors.sage,
        };
        div()
            .id("editorial-board")
            .test_support()
            .flex()
            .flex_col()
            .w(px(self.editorial_board_width(window)))
            .h_full()
            .min_h_0()
            .flex_shrink_0()
            .bg(rgb(colors.paper))
            .border_l_1()
            .border_color(rgb(colors.rule))
            .shadow(vec![
                gpui_kit::BoxShadow::new(px(-5.6), px(0.), rgb(0x201910).opacity(0.12).into())
                    .blur_radius(px(8.)),
            ])
            .child(
                div()
                    .h(px(61.))
                    .px(px(16.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(rgb(colors.rule))
                    .child(dept_label("The Editorial Board", cx))
                    .child(
                        Button::new("close-notebook")
                            .ghost()
                            .size(px(44.))
                            .rounded(px(0.))
                            .border_1()
                            .border_color(rgb(colors.rule))
                            .accessibility_label("Close the Editorial Board")
                            .label("×")
                            .on_click(cx.listener(|this, _, window, cx| {
                                if this.flush_apparatus(window, cx).is_err()
                                    || this.flush_rubric(window, cx).is_err()
                                    || this.flush_cast(window, cx).is_err()
                                {
                                    return;
                                }
                                this.desk.board_open = false;
                                this.focus_writing(window, cx);
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .id("editorial-board-contexts")
                    .test_support()
                    .flex()
                    .flex_col()
                    .flex_shrink_0()
                    .border_t_2()
                    .border_color(rgb(accent))
                    .bg(rgb(colors.paper))
                    .role(Role::Navigation)
                    .aria_label("Board context")
                    .children(
                        BoardContext::ALL
                            .chunks(3)
                            .enumerate()
                            .map(|(row_index, row)| {
                                // Match cumulative source row edges instead of losing
                                // the fractional remainder independently on each row.
                                let top = (row_index as f32 * 49.40625).round();
                                let bottom = ((row_index + 1) as f32 * 49.40625).round();
                                let row_height = bottom - top;
                                div().flex().w_full().h(px(row_height)).children(
                                    row.iter().copied().enumerate().map(|(index, tab)| {
                                        let active = self.desk.board_context == tab;
                                        let ordinal = BoardContext::ALL
                                            .iter()
                                            .position(|item| *item == tab)
                                            .unwrap()
                                            + 1;
                                        gpui_kit::base::Button::new(SharedString::from(format!(
                                            "board-tab-{}",
                                            tab.label()
                                        )))
                                        .relative()
                                        .flex()
                                        .flex_col()
                                        .items_start()
                                        .rounded(px(0.))
                                        .h(px(row_height))
                                        .flex_1()
                                        .min_w_0()
                                        .px(px(5.6))
                                        .pt(px(8.))
                                        .pb(px(7.2))
                                        .justify_start()
                                        .border_b_2()
                                        .border_color(gpui_kit::transparent_black())
                                        .text_color(rgb(if active {
                                            colors.ink
                                        } else {
                                            colors.ink_muted
                                        }))
                                        .accessibility_label(tab.label())
                                        .disabled(!matches!(
                                            tab,
                                            BoardContext::Versions
                                                | BoardContext::Tools
                                                | BoardContext::Marginalia
                                                | BoardContext::Cast
                                                | BoardContext::Rubric
                                                | BoardContext::Apparatus
                                        ))
                                        .when(active, |this| this.bg(rgb(accent).opacity(0.07)))
                                        .child(
                                            div()
                                                .w_full()
                                                .flex()
                                                .flex_col()
                                                .items_start()
                                                .child(
                                                    div()
                                                        .font_family(TYPEWRITER_FONT)
                                                        .text_size(px(8.96))
                                                        .line_height(relative(1.5))
                                                        .child(folio_numeral(ordinal - 1)),
                                                )
                                                .child(
                                                    div()
                                                        .font_family(if narrow {
                                                            TYPEWRITER_FONT
                                                        } else {
                                                            DISPLAY_FONT
                                                        })
                                                        .text_size(px(if narrow {
                                                            9.92
                                                        } else {
                                                            12.
                                                        }))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .line_height(relative(1.5))
                                                        .mt(px(0.8))
                                                        .child(tab.label()),
                                                ),
                                        )
                                        .when(index < 2, |this| {
                                            this.child(
                                                div()
                                                    .absolute()
                                                    .right_0()
                                                    .top_0()
                                                    .h_full()
                                                    .w(px(1.))
                                                    .bg(rgb(colors.rule).opacity(0.6)),
                                            )
                                        })
                                        .when(active, |this| {
                                            this.child(
                                                div()
                                                    .absolute()
                                                    .left_0()
                                                    .right_0()
                                                    .bottom(px(-2.))
                                                    .h(px(2.))
                                                    .bg(rgb(accent)),
                                            )
                                        })
                                        .on_click(
                                            cx.listener(move |this, _, window, cx| match tab {
                                                BoardContext::Tools => {
                                                    this.open_writing_tools(window, cx)
                                                }
                                                BoardContext::Marginalia => {
                                                    this.open_marginalia(window, cx)
                                                }
                                                BoardContext::Versions => {
                                                    this.open_versions(window, cx)
                                                }
                                                BoardContext::Cast => {
                                                    this.open_cast(CastSurface::Board, window, cx)
                                                }
                                                BoardContext::Rubric => this.open_rubric(
                                                    RubricSurface::Board,
                                                    window,
                                                    cx,
                                                ),
                                                BoardContext::Apparatus => this.open_apparatus(
                                                    ApparatusSurface::Board,
                                                    window,
                                                    cx,
                                                ),
                                            }),
                                        )
                                    }),
                                )
                            }),
                    ),
            )
            .child(
                div()
                    .h(px(1.))
                    .flex_shrink_0()
                    .bg(rgb(colors.rule).opacity(0.72)),
            )
            .when(self.desk.board_context == BoardContext::Apparatus, |this| {
                this.child(self.research_steering(window, cx))
            })
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .bg(rgb(colors.sidebar))
                    .when(self.desk.board_context == BoardContext::Versions, |this| {
                        this.when_some(self.revision_view.clone(), |this, view| this.child(view))
                    })
                    .when(self.desk.board_context == BoardContext::Tools, |this| {
                        this.child(self.writing_tools_panel(cx))
                    })
                    .when(self.desk.board_context == BoardContext::Cast, |this| {
                        this.when_some(self.cast.view.clone(), |this, view| this.child(view))
                    })
                    .when(self.desk.board_context == BoardContext::Rubric, |this| {
                        this.when_some(self.rubric.view.clone(), |this, view| this.child(view))
                    })
                    .when(self.desk.board_context == BoardContext::Apparatus, |this| {
                        this.when_some(self.apparatus.view.clone(), |this, view| this.child(view))
                    })
                    .when(
                        self.desk.board_context == BoardContext::Marginalia,
                        |this| {
                            this.when_some(self.marginalia.view.clone(), |this, view| {
                                this.child(view)
                            })
                        },
                    ),
            )
    }

    fn revision_capabilities(&self) -> RevisionCapabilities {
        RevisionCapabilities {
            local_history: self.revision_store.is_some() && self.revision_ready,
            read_only: self.reading || self.active_document().archived,
            source_pending: self.applying_source
                || self
                    .source_session
                    .as_ref()
                    .is_some_and(|session| session.pending),
            source_conflict: self
                .source_session
                .as_ref()
                .is_some_and(|session| session.conflict),
            ..RevisionCapabilities::local()
        }
    }

    pub(super) fn update_revision_capabilities(&self, cx: &mut Context<Self>) {
        if let Some(view) = &self.revision_view {
            let capabilities = self.revision_capabilities();
            view.update(cx, |view, cx| view.set_capabilities(capabilities, cx));
        }
    }

    pub(super) fn ensure_revision_baseline(&mut self, cx: &mut Context<Self>) {
        let Some(history) = &self.revision_store else {
            return;
        };
        // This is a startup/folio-switch boundary. Preserve the starting
        // manuscript before a first keystroke can replace its saved contents.
        match history.checkpoint(
            Arc::new(self.active_document().clone()),
            CheckpointOptions::automatic(timestamp()),
        ) {
            Ok(outcome) => {
                self.revision_timeline = outcome.timeline;
                self.revision_ready = true;
            }
            Err(error) => {
                self.revision_ready = false;
                self.notice = Some(format!(
                    "Your manuscript is saved. Version history needs attention: {error:#}"
                ));
            }
        }
        self.update_revision_capabilities(cx);
    }

    pub(super) fn load_active_revision_history(&mut self, cx: &mut Context<Self>) {
        self.revision_generation = self.revision_generation.saturating_add(1);
        if self
            .revision_view
            .as_ref()
            .is_some_and(|view| view.read(cx).current().id != self.active)
        {
            self.revision_subscription = None;
            self.revision_view = None;
        }
        self.revision_timeline = Arc::new(RevisionTimeline::new(self.active));
        self.revision_ready = self.revision_store.is_some();
        if let Some(history) = &self.revision_store {
            match history.load(self.active) {
                Ok(loaded) => {
                    self.revision_timeline = loaded.timeline;
                    if !loaded.warnings.is_empty() {
                        self.notice = Some(loaded.warnings.join("\n"));
                    }
                }
                Err(error) => {
                    self.revision_ready = false;
                    self.notice = Some(format!("Version history could not be opened: {error:#}"));
                }
            }
        }
        self.ensure_revision_baseline(cx);
    }

    pub(super) fn refresh_revision_view(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let current = Arc::new(self.active_document().clone());
        let timeline = self.revision_timeline.clone();
        let generation = self.revision_generation;
        let capabilities = self.revision_capabilities();
        if let Some(view) = &self.revision_view {
            view.update(cx, |view, cx| {
                view.replace_data(current, timeline, generation, window, cx);
                view.set_capabilities(capabilities, cx);
            });
        } else {
            let view = cx.new(|cx| {
                RevisionView::new(current, timeline, capabilities, generation, window, cx)
            });
            self.revision_subscription =
                Some(
                    cx.subscribe_in(&view, window, |this, _, event, window, cx| {
                        this.handle_revision_event(event.clone(), window, cx);
                    }),
                );
            self.revision_view = Some(view);
        }
    }

    pub(super) fn refresh_versions_if_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.desk.board_open
            && self.desk.board_context == BoardContext::Versions
            && self
                .revision_view
                .as_ref()
                .is_none_or(|view| view.read(cx).pending_request_id().is_none())
        {
            self.refresh_revision_view(window, cx);
        }
    }

    pub(super) fn open_versions(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route()
            || self.dossier.is_some()
            || self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        if !self.revision_ready {
            self.load_active_revision_history(cx);
        }
        self.library_route = false;
        self.desk.open_linked_panel(BoardContext::Versions);
        self.refresh_revision_view(window, cx);
        cx.notify();
    }

    pub(super) fn automatic_revision_after_save(&mut self, cx: &mut Context<Self>) {
        if !self.revision_ready {
            return;
        }
        let Some(history) = self.revision_store.clone() else {
            return;
        };
        let document = Arc::new(self.active_document().clone());
        let id = document.id;
        let generation = self.revision_generation;
        let window_handle = self.window_handle;
        let library_lock = self.store.clone();
        let now = timestamp();
        cx.spawn(async move |this, cx| {
            let result = cx.background_executor().spawn(async move {
                let _library_lock = library_lock;
                history.checkpoint(document, CheckpointOptions::automatic(now))
            }).await;
            let _ = cx.update_window(window_handle, |_, window, cx| this.update(cx, |this, cx| {
                if this.active != id || this.revision_generation != generation { return; }
                match result {
                    Ok(outcome) if outcome.timeline.generation >= this.revision_timeline.generation => {
                        this.revision_timeline = outcome.timeline;
                        this.refresh_versions_if_open(window, cx);
                    }
                    Ok(_) => {}
                    Err(error) => this.notice = Some(format!("Your manuscript is saved. A writing checkpoint could not be saved: {error:#}")),
                }
                cx.notify();
            }));
        }).detach();
    }

    fn revision_request_error(
        &self,
        request_id: Uuid,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) {
        if let Some(view) = &self.revision_view {
            let message = message.into();
            view.update(cx, |view, cx| {
                view.report_error(request_id, message, cx);
            });
        }
    }

    pub(super) fn commit_revision_restore(
        &mut self,
        plan: twyne_desktop::revisions::RevisionRestorePlan,
        source_generation: Option<u64>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<Arc<Manuscript>> {
        anyhow::ensure!(
            self.active == plan.folio_id,
            "The open folio changed. The checkpoint was kept in its original history."
        );
        // Inputs can be newer than their queued Change event. Capture them
        // before comparing the durable restore plan with the current draft.
        self.flush(cx)?;
        if let Some(reason) = self.revision_capabilities().write_blocked_reason() {
            anyhow::bail!(reason);
        }
        anyhow::ensure!(
            plan.matches_current(self.active_document()),
            "The manuscript changed while the checkpoint was being prepared. Your current draft is kept; review it and try again."
        );
        anyhow::ensure!(
            self.source_session
                .as_ref()
                .map(|session| session.generation)
                == source_generation,
            "Source changed while the checkpoint was being prepared. Review the current draft and try again."
        );
        self.store
            .save_if_revision(&plan.replacement, plan.expected_current.revision)?;
        let id = plan.replacement.id;
        *self
            .documents
            .iter_mut()
            .find(|document| document.id == id)
            .unwrap() = plan.replacement;
        self.dirty = false;
        self.error = None;
        self.revision_timeline = plan.timeline;
        self.install_active_document(window, cx);
        Ok(Arc::new(self.active_document().clone()))
    }

    fn handle_revision_event(
        &mut self,
        event: RevisionEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (request_id, folio_id, generation) = match event {
            RevisionEvent::CheckpointRequested {
                request_id,
                folio_id,
                generation,
            }
            | RevisionEvent::RestoreRequested {
                request_id,
                folio_id,
                generation,
                ..
            }
            | RevisionEvent::TaskStatusRequested {
                request_id,
                folio_id,
                generation,
                ..
            } => (request_id, folio_id, generation),
        };
        if self.active != folio_id || self.revision_generation != generation {
            return;
        }
        if let Err(error) = self.flush(cx) {
            self.revision_request_error(
                request_id,
                format!("The current draft could not be saved: {error:#}"),
                cx,
            );
            return;
        }
        if let Some(reason) = self.revision_capabilities().write_blocked_reason() {
            self.revision_request_error(request_id, reason, cx);
            return;
        }
        let Some(history) = self.revision_store.clone() else {
            return;
        };
        let current = Arc::new(self.active_document().clone());
        let library_lock = self.store.clone();
        let now = timestamp();
        self.refresh_revision_view(window, cx);
        match event {
            RevisionEvent::CheckpointRequested { .. } => {
                cx.spawn_in(window, async move |this, cx| {
                    let result = cx
                        .background_executor()
                        .spawn(async move {
                            let _library_lock = library_lock;
                            history.checkpoint(current, CheckpointOptions::manual(now))
                        })
                        .await;
                    let _ = this.update_in(cx, |this, window, cx| {
                        if this.active != folio_id || this.revision_generation != generation {
                            return;
                        }
                        match result {
                            Ok(outcome) => {
                                this.revision_timeline = outcome.timeline.clone();
                                if let Some(view) = &this.revision_view {
                                    view.update(cx, |view, cx| {
                                        view.acknowledge_checkpoint(
                                            request_id, outcome, window, cx,
                                        );
                                    });
                                }
                            }
                            Err(error) => this.revision_request_error(
                                request_id,
                                format!("Checkpoint could not be saved: {error:#}"),
                                cx,
                            ),
                        }
                        cx.notify();
                    });
                })
                .detach();
            }
            RevisionEvent::RestoreRequested { snapshot_id, .. } => {
                let source_generation = self
                    .source_session
                    .as_ref()
                    .map(|session| session.generation);
                cx.spawn_in(window, async move |this, cx| {
                    let result = cx
                        .background_executor()
                        .spawn(async move {
                            let _library_lock = library_lock;
                            history.prepare_restore(request_id, snapshot_id, current, now)
                        })
                        .await;
                    let _ = this.update_in(cx, |this, window, cx| {
                        if this.active != folio_id || this.revision_generation != generation {
                            return;
                        }
                        let restored = result.and_then(|plan| {
                            this.commit_revision_restore(plan, source_generation, window, cx)
                        });
                        match restored {
                            Ok(saved) => {
                                let timeline = this.revision_timeline.clone();
                                let generation = this.revision_generation;
                                if let Some(view) = &this.revision_view {
                                    view.update(cx, |view, cx| {
                                        view.acknowledge_restored(
                                            request_id, saved, timeline, generation, window, cx,
                                        );
                                    });
                                }
                            }
                            Err(error) => this.revision_request_error(
                                request_id,
                                format!("Checkpoint was not restored: {error:#}"),
                                cx,
                            ),
                        }
                        cx.notify();
                    });
                })
                .detach();
            }
            RevisionEvent::TaskStatusRequested {
                task_id, status, ..
            } => {
                cx.spawn_in(window, async move |this, cx| {
                    let result = cx
                        .background_executor()
                        .spawn(async move {
                            let _library_lock = library_lock;
                            history.set_task_status(folio_id, task_id, status, now)
                        })
                        .await;
                    let _ = this.update_in(cx, |this, window, cx| {
                        if this.active != folio_id || this.revision_generation != generation {
                            return;
                        }
                        match result {
                            Ok(timeline) => {
                                this.revision_timeline = timeline.clone();
                                if let Some(view) = &this.revision_view {
                                    view.update(cx, |view, cx| {
                                        view.acknowledge_tasks(request_id, timeline, window, cx);
                                    });
                                }
                            }
                            Err(error) => this.revision_request_error(
                                request_id,
                                format!("Revision task could not be saved: {error:#}"),
                                cx,
                            ),
                        }
                        cx.notify();
                    });
                })
                .detach();
            }
        }
    }
}
