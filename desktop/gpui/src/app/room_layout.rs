//! Writing-room composition. Feature behavior belongs to the sibling coordinators.
use super::*;

impl Render for WritingRoom {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(lifecycle) = &self.dossier_images {
            // Same condition as the actual child mount below. Failed departure
            // still keeps the current form; retained old entities lose leases.
            let keep = self
                .dossier
                .as_ref()
                .filter(|_| !self.standalone_route())
                .and_then(|view| view.read(cx).image_lease().cloned());
            if let Err(error) = lifecycle.retain_only(keep.as_ref(), window, cx) {
                self.error = Some(format!(
                    "Could not update Dossier paper ownership: {error:#}"
                ));
            }
        }
        self.sync_math_source_presence(cx);
        self.sync_research_steering_mount(window, cx);
        self.sync_flow_presence(cx);
        self.sync_flow_chrome(window, cx);
        self.sync_page_ruler(window, cx);
        self.sync_marginalia_capabilities(cx);
        self.sync_cast_surface(window, cx);
        self.sync_rubric_surface(window, cx);
        self.sync_apparatus_surface(window, cx);
        self.sync_note_surface(window, cx);
        self.sync_insert_presence(window, cx);
        self.sync_editor_drag_viewport(window, cx);
        if let Some(editor) = &self.rich {
            editor.update(cx, |editor, cx| {
                editor.set_comments_quiet(self.desk.zen, cx)
            });
        }
        self.sync_margin_rail(window, cx);
        let show_library = self.desk.drawer_open && !self.desk.zen;
        let show_library = show_library && !self.standalone_route() && self.dossier.is_none();
        let show_notebook = self.desk.board_open
            && !self.desk.zen
            && !self.standalone_route()
            && self.dossier.is_none();
        div()
            .id("writing-room")
            .track_focus(&self.focus)
            .key_context("Twyne")
            .size_full()
            .flex()
            .flex_col()
            .relative()
            .bg(rgb(palette(cx).paper))
            .text_color(rgb(palette(cx).ink))
            .font_family("DM Sans")
            .text_size(px(16.))
            .child(twyne_desktop::paper_grain::paper_grain())
            .on_mouse_move(cx.listener(|this, event: &gpui_kit::MouseMoveEvent, _, _| {
                this.flow_pointer_moved(f32::from(event.position.y));
            }))
            .on_action(cx.listener(|this, _: &NewDraft, window, cx| this.new_draft(window, cx)))
            .on_action(cx.listener(|this, _: &ImportDraft, window, cx| this.import(window, cx)))
            .on_action(
                cx.listener(|this, _: &ExportDraft, window, cx| this.export(false, window, cx)),
            )
            .on_action(cx.listener(|this, _: &SaveDraft, window, cx| {
                if this.flush_apparatus(window, cx).is_ok()
                    && this.flush_rubric(window, cx).is_ok()
                    && this.flush_cast(window, cx).is_ok()
                    && this.flush_marginalia(window, cx).is_ok()
                    && this.flush_house(window, cx).is_ok()
                    && this.flush(cx).is_ok()
                {
                    let _ = this.flush_flow(cx);
                }
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &OpenHouse, window, cx| {
                this.open_house(window, cx);
                if this.house_route {
                    let id = this.active_document().id.to_string();
                    if let Some(view) = &this.house_view {
                        view.update(cx, |view, cx| {
                            view.set_selection(
                                twyne_desktop::house_view::HouseSelection::Folio(id),
                                window,
                                cx,
                            )
                        });
                    }
                }
            }))
            .on_action(cx.listener(|this, _: &ToggleFocus, _, cx| this.toggle_focus(cx)))
            .on_action(cx.listener(|this, _: &ToggleLibrary, _, cx| this.toggle_drawer(cx)))
            .on_action(cx.listener(|this, _: &ToggleCompositor, _, cx| this.toggle_compositor(cx)))
            .on_action(cx.listener(|this, _: &CloseCompositor, window, cx| {
                if this.standalone_route() {
                    return;
                }
                if this.release_flow(cx) {
                    return;
                }
                if this.source_go_to_line {
                    this.source_go_to_line = false;
                    this.source.update(cx, |state, cx| state.focus(window, cx));
                } else if this.new_folio_form {
                    this.new_folio_form = false;
                } else {
                    this.desk.close_compositor();
                    this.persist_view();
                }
                cx.notify();
            }))
            .on_action(
                cx.listener(|this, _: &DuplicateDraft, window, cx| this.duplicate(window, cx)),
            )
            .on_action(cx.listener(|this, _: &ArchiveDraft, window, cx| this.archive(window, cx)))
            .on_action(
                cx.listener(|this, _: &ExportNative, window, cx| this.export(true, window, cx)),
            )
            .on_action(
                cx.listener(|this, _: &ToggleNotebook, window, cx| {
                    this.toggle_notebook(window, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &FindInDraft, window, cx| this.show_find(window, cx)))
            .on_action(cx.listener(|this, _: &FindNext, window, cx| this.find_next(window, cx)))
            .on_action(cx.listener(|this, _: &WriteMode, window, cx| this.set_write(window, cx)))
            .on_action(cx.listener(|this, _: &ReadMode, _, cx| this.set_reading(true, cx)))
            .on_action(cx.listener(|this, _: &SourceComment, window, cx| {
                if this.source_mode && !this.standalone_route() {
                    this.toggle_source_comment(window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &SourceGoToLine, window, cx| {
                this.show_source_line_prompt(window, cx)
            }))
            .on_action(cx.listener(|this, _: &ApplySource, window, cx| {
                if this.source_mode && !this.standalone_route() && !this.active_document().archived
                {
                    this.request_proof(true, window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &Quit, window, cx| {
                if this.flush_apparatus(window, cx).is_ok()
                    && this.flush_rubric(window, cx).is_ok()
                    && this.flush_cast(window, cx).is_ok()
                    && this.flush_marginalia(window, cx).is_ok()
                    && this.flush_on_shutdown(cx).is_ok()
                {
                    cx.quit();
                }
            }))
            .when_some(
                self.error
                    .clone()
                    .or(self.proof_error.clone())
                    .or(self.cast.boundary_error.clone())
                    .or(self.rubric.boundary_error.clone())
                    .or(self.apparatus.boundary_error.clone())
                    .or(self.flow.error.clone())
                    .or(self.notice.clone()),
                |this, message| {
                    this.child(
                        div()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap_3()
                            .px_5()
                            .py_2()
                            .flex_shrink_0()
                            .border_b_1()
                            .border_color(rgb(palette(cx).rule))
                            .bg(rgb(palette(cx).sidebar))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_size(px(13.))
                                    .text_color(rgb(
                                        if self.error.is_some()
                                            || self.proof_error.is_some()
                                            || self.cast.boundary_error.is_some()
                                            || self.rubric.boundary_error.is_some()
                                            || self.apparatus.boundary_error.is_some()
                                        {
                                            palette(cx).vermilion
                                        } else {
                                            palette(cx).ink_muted
                                        },
                                    ))
                                    .child(message),
                            )
                            .child(
                                Button::new("dismiss-message")
                                    .ghost()
                                    .small()
                                    .label(if self.error.is_some() {
                                        "Retry save"
                                    } else if self.proof_error.is_some() {
                                        "Retry typesetting"
                                    } else if self.cast.boundary_error.is_some() {
                                        "Retry Cast save"
                                    } else if self.rubric.boundary_error.is_some() {
                                        "Retry Rubric save"
                                    } else if self.apparatus.boundary_error.is_some() {
                                        "Retry Apparatus save"
                                    } else if self.flow.error.is_some() {
                                        "Retry rhythm save"
                                    } else {
                                        "Dismiss"
                                    })
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        if this.error.is_some() {
                                            let _ = this.flush(cx);
                                        } else if this.proof_error.is_some() {
                                            this.request_proof(false, window, cx);
                                        } else if this.cast.boundary_error.is_some() {
                                            let _ = this.flush_cast(window, cx);
                                        } else if this.rubric.boundary_error.is_some() {
                                            let _ = this.flush_rubric(window, cx);
                                        } else if this.apparatus.boundary_error.is_some() {
                                            let _ = this.flush_apparatus(window, cx);
                                        } else if this.flow.error.is_some() {
                                            let _ = this.retry_flow(cx);
                                        } else {
                                            this.notice = None;
                                        }
                                        cx.notify();
                                    })),
                            ),
                    )
                },
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .when(show_library, |this| {
                        this.child(self.flow_chrome(
                            flow_coordinator::RoomPart::Drawer,
                            self.library_panel(cx).into_any_element(),
                            cx,
                        ))
                    })
                    // The original closed sidebar keeps its two-pixel rule.
                    // Preserve that space instead of widening the writing desk.
                    .when(
                        !self.standalone_route() && self.dossier.is_none() && !show_library,
                        |this| {
                            this.child(
                                self.flow_chrome(
                                    flow_coordinator::RoomPart::Drawer,
                                    div()
                                        .id("collapsed-drawer-rail")
                                        .test_support()
                                        .w(px(2.))
                                        .h_full()
                                        .flex_shrink_0()
                                        .bg(rgb(palette(cx).rule)),
                                    cx,
                                ),
                            )
                        },
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .min_h_0()
                            .when(
                                !self.standalone_route()
                                    && !self.desk.zen
                                    && self.dossier.is_none(),
                                |this| {
                                    this.child(self.flow_chrome(
                                        flow_coordinator::RoomPart::Masthead,
                                        self.header(window, cx).into_any_element(),
                                        cx,
                                    ))
                                },
                            )
                            .when(self.settings_route, |this| {
                                this.child(self.settings_page(cx))
                            })
                            .when(self.house_route, |this| this.child(self.house_page(cx)))
                            .when(self.library_route, |this| this.child(self.library_page(cx)))
                            .when(self.cast.route.is_some(), |this| {
                                this.child(self.cast_page(cx))
                            })
                            .when(self.rubric.route, |this| this.child(self.rubric_page(cx)))
                            .when(self.apparatus.route, |this| {
                                this.child(self.apparatus_page(cx))
                            })
                            .when(!self.standalone_route(), |this| {
                                this.when_some(self.dossier.clone(), |this, dossier| {
                                    this.child(dossier)
                                })
                            })
                            .when(!self.standalone_route() && self.dossier.is_none(), |this| {
                                this.child(self.manuscript_panel(window, cx))
                            }),
                    )
                    .when(show_notebook, |this| {
                        this.child(self.flow_chrome(
                            flow_coordinator::RoomPart::Board,
                            self.notebook_panel(window, cx),
                            cx,
                        ))
                    }),
            )
            .when(self.dossier.is_none(), |this| {
                this.when_some(self.margin_rail.view.clone(), |this, rail| this.child(rail))
                    .when_some(self.inline_margin_card(window, cx), |this, card| {
                        this.child(card)
                    })
                    .when_some(self.gen_ui_overlay(window, cx), |this, tools| {
                        this.child(tools)
                    })
                    .when_some(self.insert_overlay(window, cx), |this, menu| {
                        this.child(menu)
                    })
            })
            // Persistent, including after Dossier removal and on every route.
            .when_some(self.dossier_images.as_ref(), |this, lifecycle| {
                this.child(lifecycle.marker())
            })
            .map(|room| self.insert_key_handlers(room, cx))
    }
}
