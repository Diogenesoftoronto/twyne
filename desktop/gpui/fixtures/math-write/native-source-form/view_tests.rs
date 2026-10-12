use super::*;
use crate::editor::{BlockObject, InlineObject, RichDocument, RichEditor, Selection};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AnyWindowHandle, AppContext, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size,
};

/// A mounted host using the actual document command. This is a synthetic local
/// host, not canonical-converter, persistence, or KaTeX rendering proof.
struct FormRoom {
    editor: RichEditor,
    form: Entity<MathSourceEditorView>,
    visible: bool,
    auto_commit: bool,
    owner_generation: u64,
    focus: FocusHandle,
    events: Vec<MathSourceEditorEvent>,
    _subscription: Subscription,
}

impl FormRoom {
    fn accept(&mut self, request: &MathSourceSubmission, cx: &mut Context<Self>) -> bool {
        if request.target.owner.editor != cx.entity_id()
            || request.target.owner.folio.as_ref() != "math-form-test"
            || request.target.owner.generation != self.owner_generation
            || request.target.revision != self.editor.revision()
            || self.editor.is_read_only()
            || !self.form.read(cx).accepts_submission(request, cx)
            || !self
                .editor
                .document()
                .node(&request.target.path)
                .is_some_and(|node| node.shares_storage_with(&request.target.expected))
        {
            return false;
        }
        let mut candidate = self.editor.clone();
        candidate.execute(request.command()).unwrap();
        if !self
            .form
            .update(cx, |view, cx| view.acknowledge_submission(request, cx))
        {
            return false;
        }
        self.editor = candidate;
        self.visible = false;
        cx.notify();
        true
    }
    fn last_submission(&self) -> MathSourceSubmission {
        self.events
            .iter()
            .rev()
            .find_map(|event| {
                if let MathSourceEditorEvent::SubmitRequested(request) = event {
                    Some(request.clone())
                } else {
                    None
                }
            })
            .expect("real submit event")
    }
    fn last_preview(&self) -> MathPreviewRequest {
        self.events
            .iter()
            .rev()
            .find_map(|event| {
                if let MathSourceEditorEvent::PreviewRequested(request) = event {
                    Some(request.clone())
                } else {
                    None
                }
            })
            .expect("injected preview request")
    }
}

impl Render for FormRoom {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("math-form-host")
            .test_support()
            .track_focus(&self.focus)
            .size_full()
            .p(px(24.))
            .when(self.visible, |this| this.child(self.form.clone()))
            .when(!self.visible, |this| this.child("Source form closed"))
    }
}

fn room(
    cx: &mut TestAppContext,
    display: MathDisplay,
    raw: &str,
    auto_commit: bool,
    preview: MathPreviewAvailability,
) -> (
    AnyWindowHandle,
    Entity<FormRoom>,
    Entity<MathSourceEditorView>,
) {
    let math = if display == MathDisplay::Inline {
        InlineObject::Math { source: raw.into() }.node()
    } else {
        BlockObject::Math { source: raw.into() }.node().unwrap()
    };
    let (document, path, position) = if display == MathDisplay::Inline {
        (
            RichDocument::new(vec![
                Node::paragraph(vec![Node::text("前🦊"), math.clone(), Node::text("é後")]),
                Node::paragraph(vec![Node::text("untouched")]),
            ]),
            vec![0, 1],
            2,
        )
    } else {
        (
            RichDocument::new(vec![
                math.clone(),
                Node::paragraph(vec![Node::text("untouched")]),
            ]),
            vec![0],
            0,
        )
    };
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply(cx).unwrap();
        init(cx);
        let (window, host) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    Point::default(),
                    size(px(640.), px(600.)),
                ))),
                ..Default::default()
            },
            cx,
            |window, cx| {
                cx.new(|cx| {
                    let owner = MathSourceOwner {
                        editor: cx.entity_id(),
                        folio: Arc::from("math-form-test"),
                        generation: 7,
                    };
                    let target = MathSourceTarget::new(owner, 0, path, position, math).unwrap();
                    let mut editor = RichEditor::new(document);
                    editor
                        .set_selection(Selection::new(position, position + 1))
                        .unwrap();
                    let form = cx.new(|cx| {
                        MathSourceEditorView::new(
                            target,
                            MathSourcePresentation {
                                preview,
                                ..Default::default()
                            },
                            window,
                            cx,
                        )
                    });
                    let _subscription = cx.subscribe_in(
                        &form,
                        window,
                        |host: &mut FormRoom, _, event: &MathSourceEditorEvent, window, cx| {
                            host.events.push(event.clone());
                            match event {
                                MathSourceEditorEvent::SubmitRequested(request)
                                    if host.auto_commit =>
                                {
                                    host.accept(request, cx);
                                }
                                MathSourceEditorEvent::Cancelled(cancelled)
                                    if cancelled.target.owner.editor == cx.entity_id()
                                        && cancelled.target.owner.generation
                                            == host.owner_generation
                                        && cancelled.target.revision == host.editor.revision()
                                        && cancelled.form_id == host.form.read(cx).form_id() =>
                                {
                                    if host
                                        .editor
                                        .document()
                                        .node(&cancelled.target.path)
                                        .is_some_and(|node| {
                                            node.shares_storage_with(&cancelled.target.expected)
                                        })
                                    {
                                        host.editor
                                            .set_selection(Selection::new(
                                                cancelled.target.position,
                                                cancelled.target.position + 1,
                                            ))
                                            .unwrap();
                                    }
                                    host.visible = false;
                                    window.focus(&host.focus, cx);
                                    cx.notify();
                                }
                                _ => {}
                            }
                        },
                    );
                    FormRoom {
                        editor,
                        form,
                        visible: true,
                        auto_commit,
                        owner_generation: 7,
                        focus: cx.focus_handle(),
                        events: Vec::new(),
                        _subscription,
                    }
                })
            },
        )
        .unwrap();
        let form = host.read(cx).form.clone();
        (window, host, form)
    })
}

fn mount(cx: &mut TestAppContext, handle: AnyWindowHandle) {
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.simulate_next_frame(cx);
        window.render_frame(cx);
    })
    .unwrap();
    cx.run_until_parked();
}

#[gpui_kit::test]
fn retained_field_end_caret_inline_enter_and_actual_undo_keep_raw_unicode(cx: &mut TestAppContext) {
    let (handle, host, form) = room(
        cx,
        MathDisplay::Inline,
        " x🦊é\n東京 ",
        true,
        MathPreviewAvailability::Unavailable(Arc::from(PREVIEW_UNAVAILABLE)),
    );
    mount(cx, handle);
    let input = cx.update(|cx| form.read(cx).input().clone());
    let before = cx.update(|cx| host.read(cx).editor.document().clone());
    let selection = cx.update(|cx| host.read(cx).editor.selection());
    cx.update_window(handle, |_, window, cx| {
        assert!(input.focus_handle(cx).is_focused(window));
        assert_eq!(
            input.read(cx).selected_range(),
            " x🦊é\n東京 ".len().." x🦊é\n東京 ".len()
        );
        window.input("\\notACommand{", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(
            &*host.read(cx).last_submission().source,
            " x🦊é\n東京 \\notACommand{"
        );
        assert!(form.read(cx).is_retired());
        assert!(!host.read(cx).visible);
        let after = host.read(cx).editor.document().clone();
        assert!(before.nodes()[1].shares_storage_with(&after.nodes()[1]));
        host.update(cx, |host, _| {
            host.editor.execute(Command::Undo).unwrap();
            assert_eq!(host.editor.document(), &before);
            assert_eq!(host.editor.selection(), selection);
            assert!(!host.editor.can_undo());
            host.editor.execute(Command::Redo).unwrap();
            assert_eq!(host.editor.document(), &after);
        });
        window.render_frame(cx);
    })
    .unwrap();
}

#[gpui_kit::test]
fn block_enter_shift_enter_and_meta_or_ctrl_enter_follow_source_without_extra_newline(
    cx: &mut TestAppContext,
) {
    for submit_key in ["ctrl-enter", "cmd-enter", "ctrl-alt-enter"] {
        let (handle, host, form) = room(
            cx,
            MathDisplay::Block,
            "x",
            false,
            MathPreviewAvailability::Unavailable(Arc::from(PREVIEW_UNAVAILABLE)),
        );
        mount(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            window.press("enter", cx);
            window.input("y", cx);
            window.press("shift-enter", cx);
            window.input("z", cx);
            window.press("ctrl-shift-enter", cx);
            window.input("t", cx);
            assert_eq!(&*form.read(cx).raw_source(cx), "x\ny\nzt");
            assert!(
                host.read(cx)
                    .events
                    .iter()
                    .all(|event| !matches!(event, MathSourceEditorEvent::SubmitRequested(_)))
            );
            window.press(submit_key, cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update(|cx| {
            assert_eq!(
                &*host.read(cx).last_submission().source,
                "x\ny\nzt",
                "{submit_key}"
            );
            assert!(form.read(cx).pending_submission().is_some());
            assert!(!host.read(cx).editor.can_undo());
        });
    }
}

#[gpui_kit::test]
fn modified_enter_preserves_observed_chrome_defaults_and_inline_alt_submit(
    cx: &mut TestAppContext,
) {
    let observed: serde_json::Value =
        serde_json::from_str(include_str!("browser-default-keys.json")).unwrap();
    assert_eq!(observed["canonicalUnchanged"], true);
    for display in [MathDisplay::Inline, MathDisplay::Block] {
        for row in observed["rows"].as_array().unwrap() {
            let source_key = row["key"].as_str().unwrap();
            // Unshifted inline Enter, including Alt+Enter, submits through the
            // Source handler. The remaining rows exercise browser text defaults.
            let submits = display == MathDisplay::Inline && !source_key.contains("Shift");
            let key = source_key
                .replace("Control", "ctrl")
                .replace("Meta", "cmd")
                .replace("Shift", "shift")
                .replace("Alt", "alt")
                .replace("Enter", "enter")
                .replace('+', "-");
            let (handle, host, form) = room(
                cx,
                display,
                "x",
                false,
                MathPreviewAvailability::Unavailable(Arc::from(PREVIEW_UNAVAILABLE)),
            );
            mount(cx, handle);
            cx.update_window(handle, |_, window, cx| {
                window.press(&key, cx);
                let raw = form.read(cx).raw_source(cx);
                if submits {
                    assert_eq!(&*raw, "x", "{display:?}/{source_key}");
                } else {
                    assert_eq!(
                        &*raw,
                        row["after"].as_str().unwrap(),
                        "{display:?}/{source_key}"
                    );
                }
            })
            .unwrap();
            cx.run_until_parked();
            cx.update(|cx| {
                let events = &host.read(cx).events;
                assert_eq!(
                    events
                        .iter()
                        .filter(|event| matches!(event, MathSourceEditorEvent::SubmitRequested(_)))
                        .count(),
                    usize::from(submits),
                    "{display:?}/{source_key}"
                );
                if submits {
                    assert_eq!(&*host.read(cx).last_submission().source, "x");
                }
                assert!(!host.read(cx).editor.can_undo());
                assert!(!form.read(cx).is_retired());
            });
        }
    }
}

#[gpui_kit::test]
fn immediate_unblurred_click_submit_survives_queued_change_and_blank_retry(
    cx: &mut TestAppContext,
) {
    let (handle, host, form) = room(
        cx,
        MathDisplay::Inline,
        "x",
        false,
        MathPreviewAvailability::Unavailable(Arc::from(PREVIEW_UNAVAILABLE)),
    );
    mount(cx, handle);
    let input = cx.update(|cx| form.read(cx).input().clone());
    cx.update_window(handle, |_, window, cx| {
        window.press("ctrl-a", cx);
        window.input("  \n\t \u{feff}", cx);
        window.click("twyne-math-source-save", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let request = host.read(cx).last_submission();
        assert_eq!(&*request.source, "  \n\t \u{feff}");
        assert!(form.read(cx).accepts_submission(&request, cx));
        form.update(cx, |view, cx| {
            assert!(view.reject_submission(&request, "Canonical candidate refused", cx));
            assert!(!view.is_retired());
        });
        assert_eq!(form.read(cx).input().entity_id(), input.entity_id());
        assert_eq!(&*form.read(cx).raw_source(cx), request.source.as_ref());
        window.render_frame(cx);
        window.click("twyne-math-source-save", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let retry = host.read(cx).last_submission();
        assert_eq!(&*retry.source, "  \n\t \u{feff}");
        assert!(host.update(cx, |host, cx| host.accept(&retry, cx)));
        assert!(
            host.read(cx)
                .editor
                .document()
                .to_html()
                .contains("data-latex=\"  \n\t \u{feff}\"")
        );
    });
}

#[gpui_kit::test]
fn escape_and_cancel_button_are_history_neutral_and_ignore_late_submit_ack(
    cx: &mut TestAppContext,
) {
    for escape in [true, false] {
        let (handle, host, form) = room(
            cx,
            MathDisplay::Inline,
            "old",
            false,
            MathPreviewAvailability::Injected,
        );
        mount(cx, handle);
        let before = cx.update(|cx| host.read(cx).editor.document().clone());
        cx.update_window(handle, |_, window, cx| {
            window.input(" unsaved🦊", cx);
            form.update(cx, |view, cx| {
                view.submit(cx);
            });
            window.render_frame(cx);
            if escape {
                window.press("escape", cx);
            } else {
                window.click("twyne-math-source-cancel", cx);
            }
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            let request = host.read(cx).last_submission();
            assert!(!host.update(cx, |host, cx| host.accept(&request, cx)));
            assert_eq!(host.read(cx).editor.document(), &before);
            assert_eq!(host.read(cx).editor.selection(), Selection::new(2, 3));
            assert!(!host.read(cx).editor.can_undo());
            assert!(host.read(cx).focus.is_focused(window));
            let cancelled = host
                .read(cx)
                .events
                .iter()
                .filter(|event| matches!(event, MathSourceEditorEvent::Cancelled(_)))
                .count();
            assert_eq!(cancelled, 1);
            form.update(cx, |view, cx| {
                view.cancel(MathSourceCancelReason::Escape, cx)
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update(|cx| {
            assert_eq!(
                host.read(cx)
                    .events
                    .iter()
                    .filter(|event| matches!(event, MathSourceEditorEvent::Cancelled(_)))
                    .count(),
                1
            )
        });
    }
}

#[gpui_kit::test]
fn preview_debounce_keeps_field_identity_and_rejects_old_source_owner_and_retired_replies(
    cx: &mut TestAppContext,
) {
    let (handle, host, form) = room(
        cx,
        MathDisplay::Inline,
        "x",
        false,
        MathPreviewAvailability::Injected,
    );
    mount(cx, handle);
    let first = cx.update(|cx| host.read(cx).last_preview());
    let input = cx.update(|cx| form.read(cx).input().clone());
    cx.update_window(handle, |_, window, cx| {
        window.input("+東京🦊", cx);
        // Read the actual rope before deferred InputEvent::Change dispatch.
        form.update(cx, |view, cx| {
            assert!(!view.receive_preview(
                &first,
                MathPreviewOutcome::InvalidLatex {
                    message: Arc::from("obsolete")
                },
                cx
            ))
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(299));
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(
            host.read(cx)
                .events
                .iter()
                .filter(|event| matches!(event, MathSourceEditorEvent::PreviewRequested(_)))
                .count(),
            1
        )
    });
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    cx.update(|cx| {
        let current = host.read(cx).last_preview();
        assert_eq!(&*current.source, "x+東京🦊");
        assert_eq!(form.read(cx).input().entity_id(), input.entity_id());
        let mut foreign = current.clone();
        let mut target = (*foreign.target).clone();
        target.owner.generation += 1;
        foreign.target = Arc::new(target);
        form.update(cx, |view, cx| {
            assert!(!view.receive_preview(
                &foreign,
                MathPreviewOutcome::Unavailable {
                    message: Arc::from("foreign")
                },
                cx
            ));
            assert!(view.receive_preview(
                &current,
                MathPreviewOutcome::InvalidLatex {
                    message: Arc::from("Unknown command: \\bad")
                },
                cx
            ));
            assert_eq!(view.preview_status(), MathPreviewStatus::InvalidLatex);
            assert_eq!(&*view.raw_source(cx), "x+東京🦊");
            view.set_preview_availability(MathPreviewAvailability::Injected, cx);
        });
    });
    cx.run_until_parked();
    cx.update(|cx| {
        let last = host.read(cx).last_preview();
        form.update(cx, |view, cx| {
            view.retire(cx);
            assert!(!view.receive_preview(
                &last,
                MathPreviewOutcome::Unavailable {
                    message: Arc::from("late")
                },
                cx
            ));
            assert_eq!(view.preview_status(), MathPreviewStatus::Retired);
        });
        assert!(!host.read(cx).editor.can_undo());
    });
}

#[gpui_kit::test]
fn preview_timeout_is_truthful_unavailable_and_does_not_block_raw_commit(cx: &mut TestAppContext) {
    let (handle, host, form) = room(
        cx,
        MathDisplay::Block,
        "\\notACommand{",
        false,
        MathPreviewAvailability::Injected,
    );
    mount(cx, handle);
    let request = cx.update(|cx| host.read(cx).last_preview());
    cx.executor().advance_clock(PREVIEW_TIMEOUT);
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(
            form.read(cx).preview_status(),
            MathPreviewStatus::Unavailable
        );
        form.update(cx, |view, cx| {
            assert!(!view.receive_preview(
                &request,
                MathPreviewOutcome::InvalidLatex {
                    message: Arc::from("late")
                },
                cx
            ));
            assert!(view.submit(cx).is_some());
        });
    });
    cx.run_until_parked();
    cx.update(|cx| assert_eq!(&*host.read(cx).last_submission().source, "\\notACommand{"));
}

#[gpui_kit::test]
fn readonly_replaced_owner_and_pending_draft_change_refuse_commit(cx: &mut TestAppContext) {
    let (handle, host, form) = room(
        cx,
        MathDisplay::Inline,
        "x",
        false,
        MathPreviewAvailability::Injected,
    );
    mount(cx, handle);
    let before = cx.update(|cx| host.read(cx).editor.document().clone());
    cx.update_window(handle, |_, window, cx| {
        form.update(cx, |view, cx| {
            view.submit(cx);
        });
        window.input("+new", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let stale = host.read(cx).last_submission();
        assert!(!host.update(cx, |host, cx| host.accept(&stale, cx)));
        form.update(cx, |view, cx| {
            view.submit(cx);
        });
    });
    cx.run_until_parked();
    cx.update(|cx| {
        let current = host.read(cx).last_submission();
        host.update(cx, |host, cx| {
            host.owner_generation += 1;
            assert!(!host.accept(&current, cx));
        });
        form.update(cx, |view, cx| {
            view.set_read_only(true, cx);
            assert!(view.submit(cx).is_none());
            assert!(!view.acknowledge_submission(&current, cx));
        });
        assert_eq!(host.read(cx).editor.document(), &before);
        assert!(!host.read(cx).editor.can_undo());
    });
}

#[gpui_kit::test]
fn source_rows_style_and_crlf_assignment_do_not_reset_the_retained_field(cx: &mut TestAppContext) {
    for display in [MathDisplay::Inline, MathDisplay::Block] {
        let (handle, _, form) = room(
            cx,
            display,
            "a\r\nb\rc🦊",
            false,
            MathPreviewAvailability::Unavailable(Arc::from(PREVIEW_UNAVAILABLE)),
        );
        mount(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            let input = form.read(cx).input().clone();
            assert_eq!(&*form.read(cx).raw_source(cx), "a\nb\nc🦊");
            let bounds = window
                .within("twyne-math-source-editor")
                .find(("input", input.entity_id()))
                .bounds();
            let height = form.read(cx).target().textarea_height();
            assert!(
                (f32::from(bounds.size.height) - height).abs() <= 0.5,
                "native snap of {height}px: {bounds:?}"
            );
            // GPUI's TextStyle::line_height_in_pixels rounds Source's logical
            // 19.6px to 20px. Record that actual native limitation explicitly.
            assert_eq!(input.read(cx).line_height(), Some(px(20.)));
            window.render_frame(cx);
            window.render_frame(cx);
            assert_eq!(form.read(cx).input().entity_id(), input.entity_id());
            assert_eq!(
                input.read(cx).selected_range(),
                "a\nb\nc🦊".len().."a\nb\nc🦊".len()
            );
        })
        .unwrap();
    }
}
