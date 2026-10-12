//! Authored, unrun real-form/host regressions. Explicit late receipts below
//! deterministically call the actual host completion method; they are not OS
//! input or asynchronous race acceptance. Fixture preflight is HTML-only, not
//! the application's canonical converter and never a render/save certificate.
use super::*;
use crate::editor::HTML_LIMITS;
use crate::editor::math_source_editor::MathSourceCancelReason;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AnyWindowHandle, AppContext, Point, TestAppContext, WindowBounds, WindowOptions};
use std::sync::atomic::{AtomicUsize, Ordering};

const HTML: &str = "<div data-type=\"block-math\" data-latex=\" x \" data-future=\"keep\"> x </div><p data-future=\"prose\">前🦊 untouched é</p>";

#[cfg(not(target_os = "macos"))]
#[gpui_kit::test]
fn focused_source_field_redo_and_drag_keys_preserve_the_manuscript_redo_stack(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, true);
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| {
            let original = view.document().node(&[0]).unwrap().clone();
            view.execute(
                Command::UpdateMathSource {
                    path: vec![0],
                    expected: original,
                    source: "committed source".into(),
                },
                window,
                cx,
            )
            .unwrap();
            view.execute(Command::Undo, window, cx).unwrap();
            assert!(view.can_redo());
        });
    })
    .unwrap();
    let before = cx.update(|cx| view.read(cx).snapshot());
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        assert!(form.focus_handle(cx).is_focused(window));
        window.input("!", cx);
        assert_eq!(&*form.read(cx).raw_source(cx), " x !");
        window.press("ctrl-z", cx);
        assert_eq!(&*form.read(cx).raw_source(cx), " x ");
        window.press("ctrl-shift-z", cx);
        assert_eq!(&*form.read(cx).raw_source(cx), " x !");
        window.press("ctrl-b", cx);
        assert_eq!(&*form.read(cx).raw_source(cx), " x !");
        window.press("space", cx);
        assert!(!view.read(cx).drag.is_active());
        assert_eq!(view.read(cx).document(), &before);
        assert!(view.read(cx).can_redo());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        window.press("escape", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).math_source_form().is_none());
        assert!(view.read(cx).focus.is_focused(window));
        window.press("ctrl-shift-z", cx);
        assert_eq!(
            view.read(cx)
                .document()
                .node(&[0])
                .unwrap()
                .as_element()
                .unwrap()
                .shell
                .attr("data-latex"),
            Some("committed source")
        );
    })
    .unwrap();
}

struct HostPaper(Entity<RichEditorView>);
impl Render for HostPaper {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().p(px(24.)).child(self.0.clone())
    }
}

fn room(
    cx: &mut TestAppContext,
    connected: bool,
) -> (AnyWindowHandle, Entity<RichEditorView>, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let prepare_calls = calls.clone();
    let preflight: MathSourcePreflight = Arc::new(move |candidate| {
        prepare_calls.fetch_add(1, Ordering::SeqCst);
        candidate
            .validate_html_limits()
            .map_err(|error| error.to_string())
    });
    let (window, view) = cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply(cx).unwrap();
        let (window, paper) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    Point::default(),
                    size(px(720.), px(800.)),
                ))),
                ..Default::default()
            },
            cx,
            |_, cx| {
                cx.new(|cx| {
                    HostPaper(cx.new(|cx| {
                        let mut view =
                            RichEditorView::new(RichDocument::from_html(HTML).unwrap(), cx);
                        view.set_opening_initial(
                            OpeningInitial {
                                mode: InitialMode::Off,
                                ..Default::default()
                            },
                            cx,
                        );
                        let mut context = MathSourceHostContext::new("owned-math-folio", 7);
                        context.preflight = connected.then_some(preflight);
                        view.set_math_source_context(Some(context), cx);
                        view
                    }))
                })
            },
        )
        .unwrap();
        (window, paper.read(cx).0.clone())
    });
    (window, view, calls)
}

fn open(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    view: &Entity<RichEditorView>,
) -> Entity<MathSourceEditorView> {
    let form = cx
        .update_window(window, |_, window, cx| {
            view.update(cx, |view, cx| {
                assert!(view.open_math_source_at(vec![0], window, cx).unwrap());
            });
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            view.read(cx).math_source_form().unwrap()
        })
        .unwrap();
    cx.run_until_parked();
    form
}

/// Obtain a real request from the retained native field, dispatch its actual
/// host handler, and stop only the test's task before releasing App effects.
/// This lets a later exact receipt be delivered without claiming OS scheduling.
fn retained_request(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    view: &Entity<RichEditorView>,
    form: &Entity<MathSourceEditorView>,
    source: &str,
) -> MathSourceSubmission {
    cx.update_window(window, |_, window, cx| {
        let input = form.read(cx).input().clone();
        input.update(cx, |input, cx| input.set_value(source, window, cx));
        let request = form.update(cx, |form, cx| form.submit(cx).unwrap());
        view.update(cx, |view, cx| {
            view.math_source_event(
                form,
                &MathSourceEditorEvent::SubmitRequested(request.clone()),
                window,
                cx,
            );
            view.math_source.task = None;
        });
        request
    })
    .unwrap()
}

#[gpui_kit::test]
fn real_unblurred_submit_changes_only_math_source_and_is_independently_undoable(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, true);
    let before = cx.update(|cx| view.read(cx).snapshot());
    let form = open(cx, window, &view);
    let raw = " \\notACommand{🦊 é\n東京  ";
    cx.update_window(window, |_, window, cx| {
        assert!(form.read(cx).input().focus_handle(cx).is_focused(window));
        window.press("secondary-a", cx);
        window.input(raw, cx);
        assert_eq!(&*form.read(cx).raw_source(cx), raw);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "Typing must not prepare or scan the document"
        );
        window.press("ctrl-enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(form.read(cx).is_retired());
        assert!(view.read(cx).math_source_form().is_none());
        assert!(view.read(cx).focus.is_focused(window));
        let after = view.read(cx).snapshot();
        let element = after.node(&[0]).unwrap().as_element().unwrap();
        assert_eq!(element.shell.attr("data-latex"), Some(raw));
        assert_eq!(element.shell.attr("data-future"), Some("keep"));
        assert_eq!(element.children, vec![Node::text(raw)]);
        assert!(before.nodes()[1].shares_storage_with(&after.nodes()[1]));
        view.update(cx, |view, cx| {
            view.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(view.document(), &before);
            assert_eq!(view.selection(), Selection::new(0, 1));
            view.execute(Command::Redo, window, cx).unwrap();
            assert_eq!(view.document(), &after);
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn cancel_restores_original_selected_node_focus_without_committing_unblurred_input(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, true);
    let before = cx.update(|cx| view.read(cx).snapshot());
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        window.press("secondary-a", cx);
        window.input("unsubmitted 🦊 final!", cx);
        window.press("escape", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(form.read(cx).is_retired());
        assert!(view.read(cx).math_source_form().is_none());
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(0, 1));
        assert!(view.read(cx).focus.is_focused(window));
        assert!(!view.read(cx).can_undo());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    })
    .unwrap();
}

#[gpui_kit::test]
fn unavailable_preflight_retains_exact_input_and_truthful_error_without_document_or_history_change(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, false);
    let before = cx.update(|cx| view.read(cx).snapshot());
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        window.press("secondary-a", cx);
        window.input(" \\invalid{\n  authored! ", cx);
        window.click("twyne-math-source-save", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(&*form.read(cx).raw_source(cx), " \\invalid{\n  authored! ");
        assert!(!form.read(cx).is_retired());
        assert!(form.read(cx).pending_submission().is_none());
        assert!(window.find("twyne-math-source-submit-error").visible());
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    })
    .unwrap();
}

#[gpui_kit::test]
fn canonical_refusal_and_late_old_receipt_keep_authored_input_for_a_fresh_retry(
    cx: &mut TestAppContext,
) {
    let (window, view, _) = room(cx, true);
    let form = open(cx, window, &view);
    let before = cx.update(|cx| view.read(cx).snapshot());
    let old = retained_request(cx, window, &view, &form, "first raw!\n  ");
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.finish_math_source(
                &form,
                &old,
                Err("Original canonical converter rejected the source budget".into()),
                window,
                cx,
            )
        });
        assert!(!form.read(cx).is_retired());
        assert_eq!(&*form.read(cx).raw_source(cx), "first raw!\n  ");
        assert_eq!(view.read(cx).document(), &before);
    })
    .unwrap();
    let fresh = retained_request(cx, window, &view, &form, "second raw!\n  ");
    assert_ne!(old.request_id, fresh.request_id);
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.finish_math_source(&form, &old, Ok(old.command()), window, cx)
        });
        assert_eq!(view.read(cx).document(), &before);
        assert!(form.read(cx).accepts_submission(&fresh, cx));
        assert_eq!(&*form.read(cx).raw_source(cx), "second raw!\n  ");
    })
    .unwrap();
}

#[gpui_kit::test]
fn changed_unblurred_rope_rejects_prepared_receipt_before_queued_change(cx: &mut TestAppContext) {
    let (window, view, _) = room(cx, true);
    let form = open(cx, window, &view);
    let request = retained_request(cx, window, &view, &form, "queued source");
    let before = cx.update(|cx| view.read(cx).snapshot());
    cx.update_window(window, |_, window, cx| {
        let input = form.read(cx).input().clone();
        input.update(cx, |input, cx| {
            input.set_value("new final raw! ", window, cx)
        });
        assert!(!form.read(cx).accepts_submission(&request, cx));
        view.update(cx, |view, cx| {
            view.finish_math_source(&form, &request, Ok(request.command()), window, cx)
        });
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(&*form.read(cx).raw_source(cx), "new final raw! ");
    })
    .unwrap();
}

#[gpui_kit::test]
fn old_folio_and_visit_receipts_are_neutral(cx: &mut TestAppContext) {
    for (folio, generation) in [("different-folio", 7), ("owned-math-folio", 8)] {
        let (window, view, _) = room(cx, true);
        let old_form = open(cx, window, &view);
        let request = retained_request(cx, window, &view, &old_form, "old visit raw!");
        let before = cx.update(|cx| view.read(cx).snapshot());
        cx.update_window(window, |_, window, cx| {
            view.update(cx, |view, cx| {
                view.set_math_source_context(
                    Some(MathSourceHostContext::new(folio, generation)),
                    cx,
                );
                assert!(old_form.read(cx).is_retired());
                view.open_math_source_at(vec![0], window, cx).unwrap();
            });
            let new_form = view.read(cx).math_source_form().unwrap();
            let input = new_form.read(cx).input().clone();
            input.update(cx, |input, cx| {
                input.set_value("new scope unsubmitted!", window, cx)
            });
            let sentinel = cx.focus_handle();
            window.focus(&sentinel, cx);
            view.update(cx, |view, cx| {
                view.finish_math_source(&old_form, &request, Ok(request.command()), window, cx)
            });
            assert_eq!(view.read(cx).document(), &before);
            assert_eq!(&*new_form.read(cx).raw_source(cx), "new scope unsubmitted!");
            assert!(sentinel.is_focused(window));
            assert!(!new_form.read(cx).is_retired());
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn readonly_and_equal_replacement_node_refuse_old_requests_without_losing_raw_field(
    cx: &mut TestAppContext,
) {
    for readonly in [true, false] {
        let (window, view, _) = room(cx, true);
        let form = open(cx, window, &view);
        let request = retained_request(cx, window, &view, &form, "retained raw!");
        let before = cx.update(|cx| view.read(cx).snapshot());
        cx.update_window(window, |_, window, cx| {
            view.update(cx, |view, cx| {
                if readonly {
                    view.set_read_only(true, cx);
                } else {
                    view.editor =
                        RichEditor::new(RichDocument::from_html(&before.to_html()).unwrap());
                }
                view.finish_math_source(&form, &request, Ok(request.command()), window, cx);
                assert_eq!(view.document(), &before);
                assert_eq!(&*form.read(cx).raw_source(cx), "retained raw!");
                assert!(!view.can_undo());
            });
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn actual_command_budget_refusal_preserves_field_selection_and_history(cx: &mut TestAppContext) {
    let (window, view, calls) = room(cx, true);
    let form = open(cx, window, &view);
    let before = cx.update(|cx| view.read(cx).snapshot());
    let raw = "x".repeat(HTML_LIMITS.scalars + 1);
    let request = retained_request(cx, window, &view, &form, &raw);
    cx.update_window(window, |_, window, cx| {
        assert!(
            prepare_submission(
                view.read(cx).editor.clone(),
                &request,
                view.read(cx)
                    .math_source
                    .context
                    .as_ref()
                    .unwrap()
                    .preflight
                    .as_ref()
                    .unwrap()
            )
            .is_err()
        );
        // An incorrectly claimed prepared receipt still cannot bypass the
        // actual live command's cached HTML-budget refusal.
        view.update(cx, |view, cx| {
            view.finish_math_source(&form, &request, Ok(request.command()), window, cx)
        });
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(0, 1));
        assert!(!view.read(cx).can_undo());
        assert!(!form.read(cx).is_retired());
        assert_eq!(&*form.read(cx).raw_source(cx), raw);
        assert!(form.read(cx).pending_submission().is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    })
    .unwrap();
}

#[gpui_kit::test]
fn unimplemented_inline_slot_and_active_ime_fail_closed_without_mutating_math(
    cx: &mut TestAppContext,
) {
    let (window, view, _) = room(cx, true);
    let inline = RichDocument::from_html(
        "<p>前🦊<span data-type=\"inline-math\" data-latex=\"x\">x</span>後</p>",
    )
    .unwrap();
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.set_document(inline.clone(), false, cx);
            assert!(view.open_math_source_at(vec![0, 1], window, cx).is_err());
            assert_eq!(view.document(), &inline);
            assert!(view.math_source_form().is_none());
            assert_eq!(view.selection(), Selection::new(2, 3));
            view.marked_range = Some(0..1);
            assert!(view.open_math_source_at(vec![0, 1], window, cx).is_err());
            assert_eq!(view.marked_range, Some(0..1));
            assert_eq!(view.document(), &inline);
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn retired_cancel_cannot_select_replacement_or_steal_current_focus(cx: &mut TestAppContext) {
    let (window, view, _) = room(cx, true);
    let old_form = open(cx, window, &view);
    let cancellation = cx.update(|cx| MathSourceCancellation {
        target: Arc::new(old_form.read(cx).target().clone()),
        form_id: old_form.read(cx).form_id(),
        generation: old_form.read(cx).generation(),
        reason: MathSourceCancelReason::Escape,
    });
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| view.retire_math_source(cx));
        let sentinel = cx.focus_handle();
        window.focus(&sentinel, cx);
        let before = view.read(cx).selection();
        view.update(cx, |view, cx| {
            view.cancel_math_source(&old_form, &cancellation, window, cx)
        });
        assert_eq!(view.read(cx).selection(), before);
        assert!(sentinel.is_focused(window));
    })
    .unwrap();
}

#[gpui_kit::test]
fn actual_equation_click_and_cancel_controls_keep_node_selection_and_fresh_field(
    cx: &mut TestAppContext,
) {
    let (window, view, _) = room(cx, true);
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("twyne-math-anchor-0").visible());
        window.click("twyne-math-anchor-0", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let form = cx
        .update_window(window, |_, window, cx| {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            let form = view.read(cx).math_source_form().unwrap();
            assert_eq!(view.read(cx).selection(), Selection::new(0, 1));
            assert!(form.read(cx).input().focus_handle(cx).is_focused(window));
            window.press("secondary-a", cx);
            window.input("unblurred cancelled click! ", cx);
            window.click("twyne-math-source-cancel", cx);
            form
        })
        .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(form.read(cx).is_retired());
        assert!(view.read(cx).math_source_form().is_none());
        assert_eq!(view.read(cx).selection(), Selection::new(0, 1));
        assert!(view.read(cx).focus.is_focused(window));
        assert_eq!(
            view.read(cx)
                .document()
                .node(&[0])
                .unwrap()
                .as_element()
                .unwrap()
                .shell
                .attr("data-latex"),
            Some(" x ")
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn opening_ends_real_native_typing_group_before_independent_math_undo(cx: &mut TestAppContext) {
    let (window, view, _) = room(cx, true);
    let original = cx
        .update_window(window, |_, window, cx| {
            let original = view.read(cx).snapshot();
            let start = original.offset_of_node(&[1]).unwrap();
            view.update(cx, |view, cx| {
                view.set_selection(Selection::caret(start + 2), cx).unwrap()
            });
            window.focus(&view.read(cx).focus.clone(), cx);
            window.render_frame(cx);
            window.input("typed", cx);
            window.input(" burst", cx);
            assert!(view.read(cx).typing_group.is_some());
            original
        })
        .unwrap();
    let typed = cx.update(|cx| view.read(cx).snapshot());
    assert_ne!(typed, original);
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        assert!(view.read(cx).typing_group.is_none());
        window.press("secondary-a", cx);
        window.input("new math source", cx);
        window.press("ctrl-enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(form.read(cx).is_retired());
        let edited = view.read(cx).snapshot();
        view.update(cx, |view, cx| {
            view.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(view.document(), &typed, "Math is one independent edit");
            view.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(
                view.document(),
                &original,
                "The preceding contiguous typing is its own edit"
            );
            view.execute(Command::Redo, window, cx).unwrap();
            assert_eq!(view.document(), &typed);
            view.execute(Command::Redo, window, cx).unwrap();
            assert_eq!(view.document(), &edited);
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn same_scope_reopened_form_ignores_old_success_error_and_cancel(cx: &mut TestAppContext) {
    let (window, view, _) = room(cx, true);
    let old_form = open(cx, window, &view);
    let request = retained_request(cx, window, &view, &old_form, "old same-scope source");
    let cancellation = MathSourceCancellation {
        target: request.target.clone(),
        form_id: request.form_id,
        generation: request.generation,
        reason: MathSourceCancelReason::CancelButton,
    };
    cx.update_window(window, |_, _window, cx| {
        view.update(cx, |view, cx| view.retire_math_source(cx));
    })
    .unwrap();
    let new_form = open(cx, window, &view);
    assert_ne!(old_form, new_form);
    cx.update_window(window, |_, window, cx| {
        let before = view.read(cx).snapshot();
        let input = new_form.read(cx).input().clone();
        input.update(cx, |input, cx| {
            input.set_value("new unsubmitted final! ", window, cx)
        });
        let sentinel = cx.focus_handle();
        window.focus(&sentinel, cx);
        view.update(cx, |view, cx| {
            view.finish_math_source(&old_form, &request, Ok(request.command()), window, cx);
            view.finish_math_source(
                &old_form,
                &request,
                Err("late failed preparation".into()),
                window,
                cx,
            );
            view.cancel_math_source(&old_form, &cancellation, window, cx);
        });
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(
            &*new_form.read(cx).raw_source(cx),
            "new unsubmitted final! "
        );
        assert!(!new_form.read(cx).is_retired());
        assert!(sentinel.is_focused(window));
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn retained_field_undo_and_delete_do_not_dispatch_manuscript_actions(cx: &mut TestAppContext) {
    let (window, view, calls) = room(cx, true);
    let before = cx.update(|cx| view.read(cx).snapshot());
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        window.press("secondary-a", cx);
        window.input("changed field!", cx);
        assert_eq!(&*form.read(cx).raw_source(cx), "changed field!");
        window.press("secondary-z", cx);
        // The retained Kit field owns its native undo grouping. This gate
        // checks that the keystroke edits the field and cannot undo the
        // manuscript; it makes no claim about Source's browser grouping.
        assert_ne!(&*form.read(cx).raw_source(cx), "changed field!");
        window.press("secondary-a", cx);
        window.press("delete", cx);
        assert_eq!(&*form.read(cx).raw_source(cx), "");
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(0, 1));
        assert!(!view.read(cx).can_undo());
        assert!(!form.read(cx).is_retired());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    })
    .unwrap();
}

// Authored focused-field audit; Source global button exceptions are separate.
#[path = "../keyboard-isolation-audit/native_tests.rs"]
mod keyboard_isolation_audit;
