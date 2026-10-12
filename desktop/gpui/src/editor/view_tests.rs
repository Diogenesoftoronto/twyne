use super::{InitialMode, MathSourceHostContext, OpeningInitial, RichEditorEvent, RichEditorView};
use crate::editor::{Command, EditDelta, Mark, RichDocument, Selection};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AnyWindowHandle, AppContext, Bounds, ClipboardItem, Entity, EntityInputHandler, Point,
    TestAppContext, WindowBounds, WindowOptions, point, px, size,
};

struct DragPaper(Entity<RichEditorView>);
impl gpui_kit::Render for DragPaper {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        use gpui_kit::{ParentElement, Styled};
        gpui_kit::div().w_full().p(px(40.)).child(self.0.clone())
    }
}

fn drag_room(cx: &mut TestAppContext, html: &str) -> (AnyWindowHandle, Entity<RichEditorView>) {
    let document = RichDocument::from_html(html).unwrap();
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply(cx).unwrap();
        let (window, paper) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    Point::default(),
                    size(px(720.), px(900.)),
                ))),
                ..Default::default()
            },
            cx,
            |_, cx| {
                cx.new(|cx| {
                    DragPaper(cx.new(|cx| {
                        let mut view = RichEditorView::new(document, cx);
                        view.set_opening_initial(
                            OpeningInitial {
                                mode: InitialMode::Off,
                                ..OpeningInitial::default()
                            },
                            cx,
                        );
                        view
                    }))
                })
            },
        )
        .unwrap();
        (window, paper.read(cx).0.clone())
    })
}

fn pointer_drag_start(
    window: &mut gpui_kit::Window,
    position: Point<gpui_kit::Pixels>,
    cx: &mut gpui_kit::App,
) {
    use gpui_kit::{InputEvent, MouseButton, MouseDownEvent, MouseMoveEvent};
    for event in [
        MouseMoveEvent {
            position,
            pressed_button: None,
            modifiers: Default::default(),
        }
        .to_platform_input(),
        MouseDownEvent {
            position,
            button: MouseButton::Left,
            modifiers: Default::default(),
            click_count: 1,
            first_mouse: false,
        }
        .to_platform_input(),
        MouseMoveEvent {
            position: position + point(px(12.), px(0.)),
            pressed_button: Some(MouseButton::Left),
            modifiers: Default::default(),
        }
        .to_platform_input(),
    ] {
        window.dispatch_event(event, cx);
        window.render_frame(cx);
    }
}

fn pointer_drag_move(
    window: &mut gpui_kit::Window,
    position: Point<gpui_kit::Pixels>,
    release: bool,
    cx: &mut gpui_kit::App,
) {
    use gpui_kit::{InputEvent, MouseButton, MouseMoveEvent, MouseUpEvent};
    window.dispatch_event(
        MouseMoveEvent {
            position,
            pressed_button: Some(MouseButton::Left),
            modifiers: Default::default(),
        }
        .to_platform_input(),
        cx,
    );
    window.render_frame(cx);
    if release {
        window.dispatch_event(
            MouseUpEvent {
                position,
                button: MouseButton::Left,
                modifiers: Default::default(),
                click_count: 1,
            }
            .to_platform_input(),
            cx,
        );
        window.render_frame(cx);
    }
}

#[gpui_kit::test]
fn mounted_heading_pointer_drag_moves_the_closed_section_and_native_undo_is_exact(
    cx: &mut TestAppContext,
) {
    use std::{cell::RefCell, rc::Rc};
    let html = "<h1>One</h1><p><span data-comment-id=\"kept\"><strong data-future=\"keep\">東京🦊</strong></span></p><h2>Child</h2><p><span data-type=\"raw-typst-inline\" data-typst-source=\"#authored[原稿]\">Source</span> body</p><h1>Two</h1><p>Second</p><h1>Three</h1><p>Third</p>";
    let (handle, view) = drag_room(cx, html);
    let events = Rc::new(RefCell::new(Vec::new()));
    let received = events.clone();
    cx.update(|cx| {
        cx.subscribe(&view, move |_, event: &RichEditorEvent, _| {
            if matches!(
                event,
                RichEditorEvent::DragStarted { .. }
                    | RichEditorEvent::DragFinished { .. }
                    | RichEditorEvent::Input { .. }
            ) {
                received.borrow_mut().push(event.clone());
            }
        })
        .detach()
    });
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(5, 7), cx).unwrap()
        });
        window.render_frame(cx);
        let before = view.read(cx).snapshot();
        let from = window.find("twyne-section-drag-0").bounds().center();
        assert_eq!(
            window.find("twyne-section-drag-0").bounds().size.width,
            px(8.)
        );
        let target = view.read(cx).placed.borrow().get(&vec![4]).unwrap().bounds;
        pointer_drag_start(window, from, cx);
        assert!(view.read(cx).is_dragging() && cx.has_active_drag());
        let to = point(target.center().x, target.bottom() + px(4.));
        pointer_drag_move(window, to, false, cx);
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(5, 7));
        assert!(!view.read(cx).can_undo());
        pointer_drag_move(window, to, true, cx);
        assert!(!view.read(cx).is_dragging() && !cx.has_active_drag());
        assert_eq!(view.read(cx).document().nodes()[..2], before.nodes()[4..6]);
        assert_eq!(view.read(cx).document().nodes()[2..6], before.nodes()[..4]);
        assert!(before.nodes()[3].shares_storage_with(&view.read(cx).document().nodes()[5]));
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(5, 7));
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
    assert_eq!(
        events.borrow().as_slice(),
        [
            RichEditorEvent::DragStarted { source: vec![0] },
            RichEditorEvent::DragFinished { moved: true }
        ]
    );
}

#[gpui_kit::test]
fn mounted_handle_keyboard_cancel_readonly_and_stale_pointer_drop_are_neutral(
    cx: &mut TestAppContext,
) {
    let (handle, view) = drag_room(
        cx,
        "<h1>One</h1><p>First</p><h1>Two</h1><p>Second</p><h1>Three</h1><p>Third</p>",
    );
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(1, 3), cx).unwrap()
        });
        window.render_frame(cx);
        let before = view.read(cx).snapshot();
        window.click("twyne-section-drag-0", cx);
        window.press("enter", cx);
        window.press("down", cx);
        assert!(view.read(cx).is_dragging());
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(1, 3));
        window.press("escape", cx);
        assert!(!view.read(cx).is_dragging());
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
        window.press("enter", cx);
        window.press("down", cx);
        window.press("enter", cx);
        assert_eq!(view.read(cx).document().nodes()[..2], before.nodes()[2..4]);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(1, 3));
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        window.click("twyne-section-drag-0", cx);
        window.press("enter", cx);
        assert!(!view.read(cx).is_dragging());
        assert_eq!(view.read(cx).document(), &before);
        view.update(cx, |view, cx| view.set_read_only(false, cx));
        window.render_frame(cx);
        let from = window.find("twyne-section-drag-0").bounds().center();
        let target = view
            .read(cx)
            .placed
            .borrow()
            .get(&vec![4])
            .unwrap()
            .bounds
            .center();
        pointer_drag_start(window, from, cx);
        pointer_drag_move(window, target, false, cx);
        view.update(cx, |view, cx| {
            view.execute(Command::InsertText("Changed".into()), window, cx)
                .unwrap()
        });
        let edited = view.read(cx).snapshot();
        pointer_drag_move(window, target, true, cx);
        assert_eq!(view.read(cx).document(), &edited);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
        view.update(cx, |view, cx| {
            view.cancel_block_drag(window, cx);
            view.cancel_block_drag(window, cx);
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn mounted_complete_atom_drag_preserves_source_notes_and_gates_cross_cell_targets(
    cx: &mut TestAppContext,
) {
    let html = "<p>Before</p><div data-type=\"block-math\" data-latex=\"x+東京\" data-future=\"opaque\">Authored</div><p>After<sup data-type=\"endnote\" data-endnote-text=\"Kept\"></sup></p><p>Last</p>";
    let (handle, view) = drag_room(cx, html);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| view.set_selection(Selection::new(0, 2), cx).unwrap());
        window.render_frame(cx);
        let before = view.read(cx).snapshot();
        let from = window.find("twyne-atom-drag-1").bounds().center();
        let target = view.read(cx).placed.borrow().get(&vec![2]).unwrap().bounds;
        pointer_drag_start(window, from, cx);
        assert_eq!(view.read(cx).selection(), Selection::new(0, 2));
        pointer_drag_move(window, point(target.center().x, target.bottom() - px(1.)), true, cx);
        assert_eq!(view.read(cx).document().nodes()[..3], [before.nodes()[0].clone(), before.nodes()[2].clone(), before.nodes()[1].clone()]);
        assert_eq!(view.read(cx).selection().range().len(), 1);
        assert!(before.nodes()[1].shares_storage_with(&view.read(cx).document().nodes()[2]));
        window.press("ctrl-c", cx);
        let copied = cx.read_from_clipboard().unwrap();
        assert_eq!(copied.text().unwrap(), "$$x+東京$$");
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::new(0, 2));
        assert!(!view.read(cx).can_undo());
        view.update(cx, |view, cx| view.set_document(RichDocument::from_html("<table><tbody><tr><td><div data-type=\"block-math\" data-latex=\"kept\">kept</div><p>A</p></td><td><p>B</p></td></tr></tbody></table>").unwrap(), false, cx));
        window.render_frame(cx);
        let before = view.read(cx).snapshot();
        let from = window.find("twyne-atom-drag-0.0.0.0.0").bounds().center();
        let other = view.read(cx).placed.borrow().get(&vec![0, 0, 0, 1, 0]).unwrap().bounds.center();
        pointer_drag_start(window, from, cx);
        pointer_drag_move(window, other, true, cx);
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
    }).unwrap();
}

#[gpui_kit::test]
fn admitted_math_source_clicks_preserve_complete_block_drag_and_history(cx: &mut TestAppContext) {
    let html = "<p>Before</p><div data-type=\"block-math\" data-latex=\"x+東京\" data-future=\"opaque\">Authored</div><p>After</p><p>Last</p>";
    let (handle, view) = drag_room(cx, html);
    let before = cx
        .update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| {
                view.set_math_source_context(Some(MathSourceHostContext::new("drag-folio", 1)), cx);
                view.set_selection(Selection::new(0, 2), cx).unwrap();
            });
            window.render_frame(cx);
            let before = view.read(cx).snapshot();
            let from = window.find("twyne-atom-drag-1").bounds().center();
            let target = view.read(cx).placed.borrow().get(&vec![2]).unwrap().bounds;
            pointer_drag_start(window, from, cx);
            assert_eq!(view.read(cx).selection(), Selection::new(0, 2));
            pointer_drag_move(
                window,
                point(target.center().x, target.bottom() - px(1.)),
                true,
                cx,
            );
            let moved = view.read(cx).snapshot();
            assert_eq!(
                moved.nodes()[..3],
                [
                    before.nodes()[0].clone(),
                    before.nodes()[2].clone(),
                    before.nodes()[1].clone()
                ]
            );
            assert!(view.read(cx).math_source_form().is_none());
            window.render_frame(cx);
            window.click("twyne-math-anchor-2", cx);
            window.render_frame(cx);
            let form = view.read(cx).math_source_form().unwrap();
            assert_eq!(form.read(cx).target().path, vec![2]);
            window.click("twyne-math-source-cancel", cx);
            assert!(form.read(cx).is_retired());
            assert_eq!(view.read(cx).document(), &moved);
            before
        })
        .unwrap();
    // Let the actual emitted cancellation reach its owner, then remove the
    // retired input subtree before sending Undo to restored editor focus.
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).math_source_form().is_none());
        assert!(view.read(cx).focus.is_focused(window));
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn precise_comment_hover_uses_painted_rows_nesting_and_real_chip_focus_without_editing(
    cx: &mut TestAppContext,
) {
    use gpui_kit::{InputEvent, MouseMoveEvent};
    let html = format!(
        "<h1>Scope</h1><p>Before <span data-comment-id=\"outer\">alpha <span data-comment-id=\"inner\">béta 東京</span> {} after.</span> tail.</p><p>Gap</p><p><span data-comment-id=\"outer\">disjoint</span></p>",
        "A long marked passage with ordinary words and measured spaces. ".repeat(5)
    );
    let (handle, view) = drag_room(cx, &html);
    let hover = |window: &mut gpui_kit::Window, position, cx: &mut gpui_kit::App| {
        window.dispatch_event(
            MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        window.render_frame(cx);
    };
    cx.update_window(handle, |_, window, cx| window.render_frame(cx))
        .unwrap();
    cx.run_until_parked(); // Activate retained native chip focus subscriptions.
    let (before, groups, inner) = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let before = view.read(cx).snapshot();
            let selection = view.read(cx).selection();
            let groups = view.read(cx).comment_anchor_bounds("outer").unwrap();
            assert_eq!(groups.len(), 2);
            assert!(groups[0].len() > 2);
            let inner = view
                .read(cx)
                .comment_hits
                .borrow()
                .iter()
                .find(|area| area.ids.last().is_some_and(|id| id.as_ref() == "inner"))
                .unwrap()
                .hitbox
                .bounds
                .center();
            hover(window, inner, cx);
            assert_eq!(view.read(cx).comment_hover.as_deref(), Some("inner"));
            assert_eq!(view.read(cx).selection(), selection);
            assert_eq!(view.read(cx).document(), &before);
            let first = groups[0][0];
            let second = groups[0][1];
            assert!(first.bottom() < second.top());
            // This point is inside the multiline union but outside all ink rows.
            let gap = point(first.center().x, (first.bottom() + second.top()) / 2.);
            assert!(
                view.read(cx)
                    .comment_bounds("outer")
                    .unwrap()
                    .contains(&gap)
            );
            hover(window, gap, cx);
            assert_eq!(view.read(cx).comment_hover, None);
            window.click("twyne-comment-chip-1-0", cx);
            hover(window, point(px(700.), px(20.)), cx);
            assert_eq!(view.read(cx).comment_hover.as_deref(), Some("outer"));
            (before, groups, inner)
        })
        .unwrap();
    cx.update_window(handle, |_, window, cx| {
        let focus = view.read(cx).focus.clone();
        window.focus(&focus, cx);
        window.render_frame(cx);
    })
    .unwrap();
    cx.run_until_parked(); // Actual focus-out events are delivered as App effects.
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(view.read(cx).comment_hover, None);
        view.update(cx, |view, cx| {
            view.set_selection(Selection::caret(14), cx).unwrap()
        });
        window.render_frame(cx);
        assert_eq!(view.read(cx).comment_hover, None); // ordinary caret focus
        hover(window, inner, cx);
        assert_eq!(view.read(cx).comment_hover.as_deref(), Some("inner"));
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        hover(window, inner, cx);
        assert_eq!(view.read(cx).comment_hover, None);
        view.update(cx, |view, cx| {
            view.set_read_only(false, cx);
            view.set_comments_quiet(true, cx);
        });
        hover(window, inner, cx);
        assert_eq!(view.read(cx).comment_hover, None);
        assert_eq!(view.read(cx).comment_anchor_bounds("outer"), Some(groups));
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).revision(), 0);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn current_block_text_content_omits_original_atom_and_hard_break_leaf_labels(
    cx: &mut TestAppContext,
) {
    let (handle, view) = room(
        cx,
        "<p>Hello<br> <strong>東京</strong><span data-type=\"inline-math\" data-latex=\"x+1\">Fallback</span><sup data-type=\"endnote\" data-endnote-text=\"Source note\"></sup><span data-type=\"raw-typst-inline\" data-typst-source=\"#authored[]\">Authored</span> after</p><p>Other</p>",
    );
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            view.read(cx).current_block_text_content().as_deref(),
            Some("Hello 東京 after")
        );
        let original = view.read(cx).snapshot();
        let next = original.offset_of_node(&[1]).unwrap();
        view.update(cx, |view, cx| {
            view.set_selection(Selection::caret(next), cx).unwrap()
        });
        assert_eq!(
            view.read(cx).current_block_text_content().as_deref(),
            Some("Other")
        );
        assert_eq!(view.read(cx).document(), &original);
        assert_eq!(view.read(cx).revision(), 0);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn precise_comment_hover_respects_a_real_occluding_overlay(cx: &mut TestAppContext) {
    use gpui_kit::{InputEvent, InteractiveElement, ParentElement, Render, Styled};
    struct CoveredPaper {
        editor: Entity<RichEditorView>,
        covered: bool,
    }
    impl Render for CoveredPaper {
        fn render(
            &mut self,
            _: &mut gpui_kit::Window,
            _: &mut gpui_kit::Context<Self>,
        ) -> impl gpui_kit::IntoElement {
            let mut page = gpui_kit::div()
                .w_full()
                .h_full()
                .p(px(40.))
                .relative()
                .child(self.editor.clone());
            if self.covered {
                page = page.child(
                    gpui_kit::div()
                        .id("comment-occluder")
                        .absolute()
                        .inset_0()
                        .occlude(),
                );
            }
            page
        }
    }
    let (handle, paper, view) = cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply(cx).unwrap();
        let (handle, paper) = gpui_kit::open_window(WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::new(Point::default(),size(px(720.),px(600.))))),
            ..Default::default()
        },cx,|_,cx|cx.new(|cx|CoveredPaper {
            editor: cx.new(|cx|RichEditorView::new(RichDocument::from_html("<p>Before <span data-comment-id=\"covered\">real marked ink</span> after.</p>").unwrap(),cx)),
            covered:false,
        })).unwrap();
        (handle,paper.clone(),paper.read(cx).editor.clone())
    });
    let position = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            view.read(cx).comment_anchor_bounds("covered").unwrap()[0][0].center()
        })
        .unwrap();
    let move_to = |window: &mut gpui_kit::Window, cx: &mut gpui_kit::App| {
        window.dispatch_event(
            gpui_kit::MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers: Default::default(),
            }
            .to_platform_input(),
            cx,
        );
        window.render_frame(cx);
    };
    cx.update_window(handle, |_, window, cx| {
        move_to(window, cx);
        assert_eq!(view.read(cx).comment_hover.as_deref(), Some("covered"));
        paper.update(cx, |paper, cx| {
            paper.covered = true;
            cx.notify();
        });
        window.render_frame(cx);
        move_to(window, cx);
        assert_eq!(view.read(cx).comment_hover, None);
        assert_eq!(view.read(cx).revision(), 0);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}

fn room(cx: &mut TestAppContext, html: &str) -> (AnyWindowHandle, Entity<RichEditorView>) {
    let document = RichDocument::from_html(html).unwrap();
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply(cx).unwrap();
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(680.), px(700.)),
                })),
                ..Default::default()
            },
            cx,
            |_, cx| {
                cx.new(|cx| {
                    let mut view = RichEditorView::new(document, cx);
                    view.set_opening_initial(
                        OpeningInitial {
                            mode: InitialMode::Off,
                            ..OpeningInitial::default()
                        },
                        cx,
                    );
                    view
                })
            },
        )
        .unwrap()
    })
}

#[gpui_kit::test]
fn input_events_use_accepted_unicode_ime_clipboard_history_and_actual_editor_focus(
    cx: &mut TestAppContext,
) {
    use std::{cell::RefCell, rc::Rc};

    let original = "<p>A🦊中</p>";
    let (handle, view) = room(cx, original);
    let samples = Rc::new(RefCell::new(Vec::new()));
    let received = samples.clone();
    cx.update(|cx| {
        cx.subscribe(&view, move |_, event: &RichEditorEvent, _| {
            if let RichEditorEvent::Input { delta } = event {
                received.borrow_mut().push(*delta);
            }
        })
        .detach();
    });
    let delta = |inserted_utf16, deleted_utf16| EditDelta {
        inserted_utf16,
        deleted_utf16,
    };
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        view.update(cx, |view, cx| {
            assert!(!view.focus.is_focused(window));
            view.execute(Command::InsertText("Unfocused ".into()), window, cx)
                .unwrap();
            view.set_document(RichDocument::from_html(original).unwrap(), false, cx);
        });
    })
    .unwrap();
    assert!(samples.borrow().is_empty());

    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        view.update(cx, |view, cx| {
            assert!(view.focus.is_focused(window));
            view.set_selection(Selection::new(1, 2), cx).unwrap();
            view.replace_text_in_range(None, "🚀", window, cx);
            assert_eq!(view.document().plain_text(), "A🚀中");
        });
    })
    .unwrap();
    assert_eq!(samples.borrow().as_slice(), [delta(2, 2)]);

    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(1, 3), cx).unwrap();
            view.execute(Command::ToggleMark(Mark::Bold), window, cx)
                .unwrap();
            view.execute(Command::Undo, window, cx).unwrap();
            view.set_selection(Selection::caret(2), cx).unwrap();
        });
        window.press("left", cx);
        window.press("right", cx);
    })
    .unwrap();
    assert_eq!(samples.borrow().as_slice(), [delta(2, 2)]);

    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.replace_and_mark_text_in_range(Some(3..3), "に", Some(1..1), window, cx);
            view.replace_and_mark_text_in_range(None, "日本", Some(2..2), window, cx);
            view.replace_text_in_range(None, "日本", window, cx);
            assert_eq!(view.document().plain_text(), "A🚀日本中");
        });
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().plain_text(), "A🚀中");
    })
    .unwrap();
    assert_eq!(
        samples.borrow().as_slice(),
        [delta(2, 2), delta(1, 0), delta(2, 1), delta(1, 3)]
    );

    let fragment = RichDocument::from_html(
        "<p>X<em>🦊</em><sup data-type=\"endnote\" data-endnote-text=\"Kept\"></sup>Y</p>",
    )
    .unwrap()
    .copy_fragment(1..3)
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        cx.write_to_clipboard(ClipboardItem::new_string_with_metadata(
            fragment.plain_text(),
            fragment.to_clipboard_metadata().unwrap(),
        ));
        view.update(cx, |view, cx| {
            view.set_selection(Selection::caret(0), cx).unwrap()
        });
        window.press("ctrl-v", cx);
        assert!(
            view.read(cx)
                .document()
                .to_html()
                .contains("data-endnote-text=\"Kept\"")
        );
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(0, 2), cx).unwrap()
        });
        window.press("ctrl-c", cx);
        window.press("ctrl-x", cx);
        assert_eq!(view.read(cx).document().plain_text(), "A🚀中");
    })
    .unwrap();
    assert_eq!(&samples.borrow()[4..], [delta(3, 0), delta(0, 3)]);
    let count = samples.borrow().len();

    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        window.input("ignored", cx);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().plain_text(), "A🚀中");
        view.update(cx, |view, cx| view.set_read_only(false, cx));
        window.blur(cx);
        view.update(cx, |view, cx| {
            view.execute(Command::ReplaceSelection("Unfocused".into()), window, cx)
                .unwrap();
            view.set_document(RichDocument::from_plain_text("Applied source"), true, cx);
        });
    })
    .unwrap();
    assert_eq!(samples.borrow().len(), count);
}

#[gpui_kit::test]
fn native_keyboard_edits_rich_runs_preserves_unicode_and_undo(cx: &mut TestAppContext) {
    let (handle, view) = room(cx, "<p>Before</p>");
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        window.press("ctrl-end", cx);
        window.input(" 🦊é", cx);
        assert_eq!(view.read(cx).document().plain_text(), "Before 🦊é");
        window.press("shift-left", cx);
        assert_eq!(view.read(cx).selection().range(), 8..10);
        window.press("ctrl-b", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            "<p>Before 🦊<strong>é</strong></p>"
        );
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p>Before 🦊é</p>");
        window.press("ctrl-shift-z", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            "<p>Before 🦊<strong>é</strong></p>"
        );
        window.press("left", cx);
        window.press("backspace", cx);
        assert_eq!(view.read(cx).document().plain_text(), "Before é");
    })
    .unwrap();
}

#[gpui_kit::test]
fn native_comment_selection_is_history_neutral_and_readonly_keeps_overlapping_anchors(
    cx: &mut TestAppContext,
) {
    use crate::editor::CommentAttributes;
    let original = "<p>First <strong data-future=\"keep\">🦊東京</strong> after.</p>";
    let (handle, view) = room(cx, original);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        let first = view.update(cx, |view, cx| {
            view.set_selection(Selection::new(6, 9), cx).unwrap();
            view.execute(
                Command::AddComment(CommentAttributes::new("first")),
                window,
                cx,
            )
            .unwrap();
            let first = view.snapshot();
            view.set_selection(Selection::new(7, 9), cx).unwrap();
            view.execute(
                Command::AddComment(CommentAttributes::new("second")),
                window,
                cx,
            )
            .unwrap();
            first
        });
        window.render_frame(cx);
        view.update(cx, |view, cx| {
            let revision = view.revision();
            view.set_read_only(true, cx);
            assert!(view.select_comment("first", cx).unwrap());
            assert_eq!(view.selection(), Selection::new(6, 9));
            assert!(view.caret_bounds().is_some());
            assert_eq!(view.revision(), revision);
            assert!(!view.select_comment("missing", cx).unwrap());
            assert_eq!(view.selection(), Selection::new(6, 9));
            assert!(
                view.execute(Command::RemoveComment { id: "first".into() }, window, cx)
                    .is_err()
            );
            assert!(
                view.execute(
                    Command::AddComment(CommentAttributes::new("locked")),
                    window,
                    cx
                )
                .is_err()
            );
            assert_eq!(view.document().first_comment_range("first"), Some(6..9));
            assert_eq!(view.document().first_comment_range("second"), Some(7..9));
            view.set_read_only(false, cx);
        });
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document(), &first);
        assert_eq!(view.read(cx).selection(), Selection::new(7, 9));
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), original);
        assert_eq!(view.read(cx).selection(), Selection::new(6, 9));
    })
    .unwrap();
}

#[gpui_kit::test]
fn native_comment_chips_open_exact_passages_without_moving_caret_and_quiet_keeps_layout(
    cx: &mut TestAppContext,
) {
    use std::{cell::RefCell, rc::Rc, sync::Arc};
    let original = format!(
        "<h2>Notes</h2><p><span data-comment-id=\"first\" data-comment-color=\"var(--color-mustard)\" data-future=\"keep\">A<strong>🦊</strong><span data-comment-id=\"second\" data-comment-color=\"red\">東京</span>D</span> gap <span data-comment-id=\"first\">E</span></p><p><span data-comment-id=\"first\">F</span></p><p><span data-comment-id=\"wrapped\">{}</span></p>",
        "words across several rows ".repeat(12)
    );
    let (handle, view) = room(cx, &original);
    let received = Rc::new(RefCell::new(Vec::new()));
    let collected = received.clone();
    cx.update(|cx| {
        cx.subscribe(&view, move |_, event: &RichEditorEvent, _| {
            if let RichEditorEvent::CommentRequested { id, range } = event {
                collected.borrow_mut().push((id.to_string(), range.clone()));
            }
        })
        .detach();
    });
    let (before, layout, second_bounds, chip_bounds, root, selection) = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let before = view.read(cx).snapshot();
            let layout = view
                .read(cx)
                .placed
                .borrow()
                .get(&vec![1])
                .unwrap()
                .layout
                .clone();
            let second_bounds = view
                .read(cx)
                .comment_range_bounds("first", &(16..17))
                .unwrap();
            assert_ne!(
                second_bounds,
                view.read(cx).comment_bounds("first").unwrap()
            );
            let wrapped_range = before.first_comment_range("wrapped").unwrap();
            let wrapped = view
                .read(cx)
                .comment_range_bounds("wrapped", &wrapped_range)
                .unwrap();
            let wrapped_chip = window.find("twyne-comment-chip-3-0").bounds();
            assert!(
                wrapped.top() + px(50.) < wrapped_chip.top(),
                "A wrapped passage anchors at its first row, not its end chip"
            );
            assert!(wrapped.bottom() > wrapped_chip.top());
            assert!(wrapped.size.width > wrapped_chip.size.width * 10.);
            assert_eq!(
                view.read(cx)
                    .comment_geometry
                    .borrow()
                    .get("first")
                    .unwrap()
                    .len(),
                3
            );
            for piece in &layout.pieces {
                if piece.range == (0..1) {
                    assert_eq!(
                        piece.comment_ink.as_ref(),
                        &[gpui_kit::Hsla::from(gpui_kit::rgb(
                            crate::theme::WRITER_NOTE
                        ))]
                    );
                }
                if piece.comment_chip.is_some() {
                    assert!(piece.range.is_empty());
                    assert!((piece.width() - px(16.2)).abs() < px(0.001));
                }
            }
            let text_position = {
                let current = view.read(cx);
                let placed = current.placed.borrow();
                let paragraph = placed.get(&vec![1]).unwrap();
                paragraph.bounds.origin
                    + paragraph.layout.position(1).unwrap()
                    + point(px(0.1), px(5.))
            };
            let root = window.find("twyne-rich-manuscript").bounds().origin;
            window.click_at("twyne-rich-manuscript", text_position - root, cx);
            assert_eq!(view.read(cx).selection(), Selection::caret(7));
            assert!(
                received.borrow().is_empty(),
                "Marked text keeps native caret behavior"
            );
            let selection = view.read(cx).selection();
            let chip_bounds = window.find("twyne-comment-chip-1-2").bounds();
            (before, layout, second_bounds, chip_bounds, root, selection)
        })
        .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.click("twyne-comment-chip-1-1", cx);
        assert_eq!(view.read(cx).selection(), selection);
    })
    .unwrap();
    assert_eq!(
        received.borrow().as_slice(),
        [("second".to_string(), 8..10)]
    );
    cx.update_window(handle, |_, window, cx| {
        window.press("enter", cx);
    })
    .unwrap();
    assert_eq!(
        received.borrow().last(),
        Some(&("second".to_string(), 8..10))
    );
    assert_eq!(received.borrow().len(), 2);
    cx.update_window(handle, |_, window, cx| {
        window.press("space", cx);
        assert_eq!(view.read(cx).selection(), selection);
        assert_eq!(view.read(cx).document(), &before);
    })
    .unwrap();
    assert_eq!(received.borrow().len(), 3);
    cx.update_window(handle, |_, window, cx| {
        window.click("twyne-comment-chip-1-2", cx);
        assert_eq!(view.read(cx).selection(), selection);
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
    assert_eq!(
        received.borrow().last(),
        Some(&("first".to_string(), 16..17))
    );
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| view.set_comments_quiet(true, cx));
        window.render_frame(cx);
        assert!(Arc::ptr_eq(
            &layout,
            &view.read(cx).placed.borrow().get(&vec![1]).unwrap().layout
        ));
        assert_eq!(
            view.read(cx).comment_range_bounds("first", &(16..17)),
            Some(second_bounds)
        );
        assert_eq!(
            view.read(cx)
                .comment_geometry
                .borrow()
                .get("first")
                .unwrap()
                .len(),
            3
        );
        window.click_at("twyne-rich-manuscript", chip_bounds.center() - root, cx);
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).revision(), 0);
        assert!(
            view.read(cx)
                .document()
                .to_html()
                .contains("data-comment-color=\"var(--color-mustard)\"")
        );
    })
    .unwrap();
    assert_eq!(
        received.borrow().len(),
        4,
        "Quiet chips have no pointer hit target"
    );
}

#[gpui_kit::test]
fn discretionary_hyphens_keep_native_click_clipboard_ime_and_cached_blocks_in_source_offsets(
    cx: &mut TestAppContext,
) {
    use gpui_kit::{FontWeight, TextRun, font, rgb};
    use std::sync::Arc;

    let original = "<p>🦊 Before be<strong data-future=\"keep\">gun</strong> <em>arriving</em>.</p><p>Untouched.</p>";
    let (handle, view) = room(cx, original);
    let (width, dictionary) = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let view = view.read(cx);
            let placed = view.placed.borrow();
            let full = &placed.get(&vec![0]).unwrap().layout;
            let prefix: gpui_kit::Pixels = full
                .pieces
                .iter()
                .take_while(|piece| piece.range.end <= 11)
                .map(|piece| piece.width())
                .sum();
            let mut face = font(crate::theme::SERIF_FONT);
            face.weight = FontWeight::NORMAL;
            let hyphen = window.text_system().shape_line(
                "\u{2010}".into(),
                px(18.),
                &[TextRun {
                    len: '\u{2010}'.len_utf8(),
                    font: face,
                    color: rgb(0x000000).into(),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                }],
                None,
            );
            let dictionary = view
                .hyphenation
                .borrow()
                .get(&vec![0])
                .unwrap()
                .opportunities
                .clone();
            (prefix + hyphen.width + px(0.5), dictionary)
        })
        .unwrap();
    cx.simulate_window_resize(handle, size(width, px(700.)));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let (target, untouched) = {
            let view = view.read(cx);
            let cache = view.hyphenation.borrow();
            assert!(Arc::ptr_eq(
                &dictionary,
                &cache.get(&vec![0]).unwrap().opportunities
            ));
            let placed = view.placed.borrow();
            let paragraph = placed.get(&vec![0]).unwrap();
            let broken = paragraph
                .layout
                .pieces
                .iter()
                .find(|piece| piece.discretionary_hyphen)
                .expect("A real measured prefix must fit before the styled suffix");
            assert_eq!(broken.range, 9..11);
            assert_eq!(broken.shape.text.as_ref(), "be\u{2010}");
            assert_eq!(broken.index_for_x(broken.width() - px(0.2)), 2);
            assert_eq!(broken.x_for_offset(2), broken.width());
            for piece in &paragraph.layout.pieces {
                for offset in 0..=piece.range.end - piece.range.start {
                    assert_eq!(piece.index_for_x(piece.x_for_offset(offset)), offset);
                }
            }
            let target =
                paragraph.bounds.origin + broken.origin + point(broken.width() - px(0.2), px(5.));
            let untouched = placed.get(&vec![1]).unwrap().layout.clone();
            (target, untouched)
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", target - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(11));
        view.update(cx, |view, cx| {
            let mut actual = None;
            assert_eq!(
                view.text_for_range(10..15, &mut actual, window, cx),
                Some("begun".into())
            );
            view.set_selection(
                Selection {
                    anchor: 9,
                    head: 14,
                },
                cx,
            )
            .unwrap();
        });
        window.press("ctrl-c", cx);
        assert_eq!(
            cx.read_from_clipboard().unwrap().text().as_deref(),
            Some("begun")
        );
        view.update(cx, |view, cx| {
            view.execute(Command::ToggleMark(Mark::Underline), window, cx)
                .unwrap();
            assert!(view.document().to_html().contains("data-future=\"keep\""));
            assert_eq!(
                view.document().plain_text(),
                "🦊 Before begun arriving.\nUntouched."
            );
            view.execute(Command::Undo, window, cx).unwrap();
            view.set_selection(Selection::caret(11), cx).unwrap();
            view.replace_and_mark_text_in_range(Some(12..12), "に", Some(1..1), window, cx);
            view.replace_text_in_range(None, "日本", window, cx);
            assert!(view.document().plain_text().contains("be日本gun"));
            assert!(view.document().to_html().contains("data-future=\"keep\""));
        });
        window.render_frame(cx);
        assert!(Arc::ptr_eq(
            &untouched,
            &view.read(cx).placed.borrow().get(&vec![1]).unwrap().layout
        ));
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), original);
        assert!(!view.read(cx).document().plain_text().contains('\u{2010}'));
    })
    .unwrap();
}

#[gpui_kit::test]
fn english_word_grouping_keeps_unicode_word_breaks_and_source_text(cx: &mut TestAppContext) {
    let original = "<p>東京京都大阪東京京都大阪東京京都大阪</p>";
    let (handle, view) = room(cx, original);
    cx.simulate_window_resize(handle, size(px(64.), px(700.)));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let view = view.read(cx);
        let placed = view.placed.borrow();
        let layout = &placed.get(&vec![0]).unwrap().layout;
        assert!(layout.lines.len() >= 3);
        assert!(
            layout
                .pieces
                .iter()
                .all(|piece| !piece.discretionary_hyphen)
        );
        assert_eq!(view.document().to_html(), original);
        assert_eq!(view.document().text_len_utf16(), 19);
    })
    .unwrap();
}

#[gpui_kit::test]
fn mounted_multiline_selection_endpoints_are_direction_independent_and_history_neutral(
    cx: &mut TestAppContext,
) {
    let original = format!(
        "<p data-future=\"keep\"><span style=\"font-family: Lora\">A🦊 {}</span></p>",
        "A passage crossing several rows. ".repeat(14)
    );
    let (handle, view) = room(cx, &original);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let end = {
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let layout = &placed.get(&vec![0]).unwrap().layout;
            assert!(layout.lines.len() >= 4);
            layout.lines[3].range.start + 3
        };
        let before = view.read(cx).document().to_html();
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(1, end), cx).unwrap();
        });
        let forward = view.read(cx).selection_endpoint_bounds().unwrap();
        assert!(forward.top() + px(64.) < view.read(cx).caret_bounds().unwrap().top());
        assert!(forward.size.height >= px(32.4 * 4. - 0.001));
        view.update(cx, |view, cx| {
            view.set_read_only(true, cx);
            view.set_selection(Selection::new(end, 1), cx).unwrap();
        });
        window.render_frame(cx);
        assert_eq!(view.read(cx).selection_endpoint_bounds(), Some(forward));
        assert_eq!(view.read(cx).selection(), Selection::new(end, 1));
        assert_eq!(view.read(cx).document().to_html(), before);
        assert_eq!(view.read(cx).revision(), 0);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn long_words_wrap_inside_the_page_with_source_graphemes_and_real_edit_history(
    cx: &mut TestAppContext,
) {
    use std::sync::Arc;
    use unicode_segmentation::UnicodeSegmentation;

    let cases = [
        format!(
            "Prefix <strong data-future=\"keep\">{}</strong> tail.",
            "x".repeat(1_200)
        ),
        format!(
            "Prefix https://twyne.example/{}?query={} tail.",
            "longpath".repeat(30),
            "v".repeat(90)
        ),
        format!(
            "Prefix {}<span data-future=\"keep\">{}</span>ending tail.",
            "ab/".repeat(28),
            "ab/".repeat(27)
        ),
        format!("Prefix {} tail.", "arriving/".repeat(24)),
        format!(
            "Prefix e<span data-future=\"keep\">\u{301}{}</span> tail.",
            "e\u{301}".repeat(120)
        ),
        format!(
            "Prefix 👩<em data-future=\"keep\">🏽‍💻{}</em> tail.",
            "👩🏽‍💻".repeat(40)
        ),
        format!("Prefix {} tail.", "東京".repeat(100)),
    ];
    let (handle, view) = room(cx, "<p>Initial</p><p>Untouched.</p>");
    cx.simulate_window_resize(handle, size(px(180.), px(700.)));
    for content in cases {
        let original = format!("<p style=\"hyphens: none\">{content}</p><p>Untouched.</p>");
        let document = RichDocument::from_html(&original).unwrap();
        let original = document.to_html();
        let block = document.block(&[0]).unwrap();
        let source: String = document
            .editing_text()
            .chars()
            .take(block.range.end)
            .collect();
        let mut scalar = 0;
        let grapheme_ends: Vec<usize> = std::iter::once(0)
            .chain(source.graphemes(true).map(|grapheme| {
                scalar += grapheme.chars().count();
                scalar
            }))
            .collect();
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| view.set_document(document, false, cx));
            window.render_frame(cx);
            let (target, expected, unchanged) = {
                let current = view.read(cx);
                let placed = current.placed.borrow();
                let paragraph = placed.get(&vec![0]).unwrap();
                let layout = &paragraph.layout;
                assert!(layout.lines.len() > 1, "{source}");
                assert!(
                    layout
                        .pieces
                        .iter()
                        .all(|piece| !piece.discretionary_hyphen)
                );
                for line in &layout.lines {
                    assert!(grapheme_ends.contains(&line.range.start));
                    assert!(grapheme_ends.contains(&line.range.end));
                }
                for piece in &layout.pieces {
                    assert!(
                        piece.origin.x + piece.width() <= layout.size.width + px(0.1),
                        "{}..{} exceeds {} by {}",
                        piece.range.start,
                        piece.range.end,
                        layout.size.width,
                        piece.origin.x + piece.width() - layout.size.width
                    );
                }
                // Sample real shaped positions through every wrapped row.
                // Mouse hits must never leave the caret inside a combining or
                // ZWJ grapheme, including clusters split by preserved marks.
                for line in &layout.lines {
                    for x in 0..180 {
                        let offset = layout.index(point(px(x as f32), line.y + px(4.)));
                        assert!(
                            grapheme_ends.contains(&offset),
                            "Hit returned interior scalar {offset}"
                        );
                    }
                }
                let line = &layout.lines[1];
                let candidates: Vec<_> = grapheme_ends
                    .iter()
                    .copied()
                    .filter(|offset| *offset > line.range.start && *offset < line.range.end)
                    .collect();
                let expected = candidates[candidates.len() / 2];
                let position = layout.position(expected).unwrap();
                assert_eq!(
                    layout.index(position + point(px(0.01), px(4.))),
                    expected,
                    "Native caret/hit roundtrip: {source}"
                );
                let target = paragraph.bounds.origin + position + point(px(0.01), px(4.));
                (
                    target,
                    expected,
                    placed.get(&vec![1]).unwrap().layout.clone(),
                )
            };
            let root = window.find("twyne-rich-manuscript").bounds().origin;
            window.click_at("twyne-rich-manuscript", target - root, cx);
            assert_eq!(
                view.read(cx).selection(),
                Selection::caret(expected),
                "Native mouse: {source}"
            );
            view.update(cx, |view, cx| {
                view.set_selection(Selection::new(0, block.range.end), cx)
                    .unwrap()
            });
            window.press("ctrl-c", cx);
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some(source.as_str())
            );
            view.update(cx, |view, cx| {
                view.set_selection(Selection::caret(expected), cx).unwrap();
                let utf16 = view.document().scalar_to_utf16(expected).unwrap();
                view.replace_and_mark_text_in_range(
                    Some(utf16..utf16),
                    "に",
                    Some(1..1),
                    window,
                    cx,
                );
                view.replace_text_in_range(None, "日本", window, cx);
            });
            window.render_frame(cx);
            assert!(Arc::ptr_eq(
                &unchanged,
                &view.read(cx).placed.borrow().get(&vec![1]).unwrap().layout
            ));
            window.press("ctrl-z", cx);
            assert_eq!(view.read(cx).document().to_html(), original);
            window.render_frame(cx);
            let retained = view.read(cx).document().clone();
            assert_eq!(
                retained
                    .editing_text()
                    .chars()
                    .take(block.range.end)
                    .collect::<String>(),
                source
            );
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn native_ime_surrogate_offsets_candidates_and_commit_preserve_marks(cx: &mut TestAppContext) {
    let (handle, view) = room(cx, "<p>🦊 <em>fox</em></p>");
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        view.update(cx, |view, cx| {
            view.set_selection(Selection::caret(4), cx).unwrap();
            view.replace_and_mark_text_in_range(Some(5..5), "に", Some(1..1), window, cx);
            assert_eq!(view.document().to_html(), "<p>🦊 <em>foにx</em></p>");
            assert_eq!(view.marked_text_range(window, cx), Some(5..6));
            view.replace_and_mark_text_in_range(None, "日本", Some(2..2), window, cx);
            assert_eq!(view.marked_text_range(window, cx), Some(5..7));
            view.replace_text_in_range(None, "日本", window, cx);
            assert!(view.marked_text_range(window, cx).is_none());
            assert_eq!(view.document().to_html(), "<p>🦊 <em>fo日本x</em></p>");
            view.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(view.document().to_html(), "<p>🦊 <em>fox</em></p>");
            let mut actual = None;
            assert_eq!(
                view.text_for_range(1..2, &mut actual, window, cx),
                Some("🦊".into())
            );
            assert_eq!(actual, Some(0..2));
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn shaped_blocks_retain_unaffected_layout_and_mouse_selection_maps_to_real_text(
    cx: &mut TestAppContext,
) {
    let (handle, view) = room(
        cx,
        "<h1>The notebook</h1><p>A <strong>concrete</strong> opening.</p><p>Untouched.</p>",
    );
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let cached = view
            .read(cx)
            .layouts
            .borrow()
            .get(&vec![2])
            .unwrap()
            .layout
            .clone();
        let target = {
            let view = view.read(cx);
            let placed = view.placed.borrow();
            let paragraph = placed.get(&vec![1]).unwrap();
            paragraph.bounds.origin + paragraph.layout.position(3).unwrap() + point(px(0.5), px(5.))
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", target - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(16));
        window.input("very ", cx);
        assert!(
            view.read(cx)
                .document()
                .to_html()
                .contains("A <strong>cvery oncrete</strong> opening.")
        );
        let retained = view
            .read(cx)
            .layouts
            .borrow()
            .get(&vec![2])
            .unwrap()
            .layout
            .clone();
        assert!(std::sync::Arc::ptr_eq(&cached, &retained));
        assert!(view.read(cx).active_marks().contains(&Mark::Bold));
    })
    .unwrap();
}

#[gpui_kit::test]
fn illuminated_initial_is_text_and_native_enter_and_readonly_are_real(cx: &mut TestAppContext) {
    let (handle, view) = room(cx, "<p>The notebook was small.</p>");
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.set_opening_initial(OpeningInitial::default(), cx)
        });
        window.render_frame(cx);
        {
            let view = view.read(cx);
            let cached = view.layouts.borrow();
            let layout = &cached.get(&vec![0]).unwrap().layout;
            assert_eq!(layout.pieces[0].range, 0..1);
            assert!(layout.pieces[0].float_initial);
            assert_eq!(view.document().plain_text(), "The notebook was small.");
        }
        window.click_at("twyne-rich-manuscript", point(px(10.), px(10.)), cx);
        window.press("ctrl-end", cx);
        window.press("enter", cx);
        window.input("Another paragraph.", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            "<p>The notebook was small.</p><p>Another paragraph.</p>"
        );
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        window.input("Rejected", cx);
        assert_eq!(
            view.read(cx).document().plain_text(),
            "The notebook was small.\nAnother paragraph."
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn adjacent_typing_and_deletion_coalesce_but_formatting_and_idle_split_undo(
    cx: &mut TestAppContext,
) {
    let (handle, view) = room(cx, "<p></p>");
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        window.input("Hello", cx);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p></p>");
        window.press("ctrl-shift-z", cx);
        window.press("ctrl-b", cx);
        window.input(" 東京.", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            "<p>Hello<strong> 東京.</strong></p>"
        );
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p>Hello</p>");
        window.press("ctrl-shift-z", cx);
        window.press("backspace", cx);
        window.press("backspace", cx);
        assert_eq!(view.read(cx).document().plain_text(), "Hello 東");
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().plain_text(), "Hello 東京.");
        window.input("A", cx);
        view.update(cx, |view, _| {
            view.typing_group.as_mut().unwrap().last_edit -= std::time::Duration::from_millis(501);
        });
        window.input("B", cx);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().plain_text(), "Hello 東京.A");
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().plain_text(), "Hello 東京.");
    })
    .unwrap();
}

#[gpui_kit::test]
fn opening_artwork_flows_across_paragraphs_and_heading_margins_collapse(cx: &mut TestAppContext) {
    let (handle, view) = room(
        cx,
        "<p>The opening.<br>Second line.</p><p>Following paragraph.</p><h2>Heading</h2>",
    );
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| {
            view.set_opening_initial(OpeningInitial::default(), cx)
        });
        window.render_frame(cx);
        let previous = {
            let view = view.read(cx);
            let placed = view.placed.borrow();
            let first = placed.get(&vec![0]).unwrap();
            let second = placed.get(&vec![1]).unwrap();
            let heading = placed.get(&vec![2]).unwrap();
            assert_eq!(first.layout.size.height, px(64.8));
            assert!(second.layout.pieces[0].origin.x > px(90.));
            assert!((f32::from(heading.bounds.top() - second.bounds.bottom()) - 36.).abs() < 0.1);
            second.layout.clone()
        };
        view.update(cx, |view, cx| {
            view.set_selection(Selection::caret(4), cx).unwrap();
            view.execute(
                Command::InsertInline(crate::editor::InlineObject::HardBreak),
                window,
                cx,
            )
            .unwrap();
        });
        window.render_frame(cx);
        let updated = view
            .read(cx)
            .placed
            .borrow()
            .get(&vec![1])
            .unwrap()
            .layout
            .clone();
        assert_eq!(updated.pieces[0].origin.x, px(0.));
        assert!(!std::sync::Arc::ptr_eq(&previous, &updated));
    })
    .unwrap();
}

#[gpui_kit::test]
fn real_math_svg_is_measured_as_an_atomic_inline_image(cx: &mut TestAppContext) {
    let html = "<p>Energy <span data-type=\"inline-math\" data-latex=\"E=mc^2\"></span>.</p>";
    let (handle, view) = room(cx, html);
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let target = {
            let view = view.read(cx);
            let placed = view.placed.borrow();
            let paragraph = placed.get(&vec![0]).unwrap();
            let equation = paragraph
                .layout
                .pieces
                .iter()
                .find(|piece| piece.range == (7..8))
                .unwrap();
            let image = equation
                .image
                .as_ref()
                .expect("Actual local MathJax SVG must reach native layout");
            assert!(image.svg.contains("<svg"));
            assert!(image.width_px > 40. && image.height_px > 15.);
            assert!(image.baseline_is_exact);
            paragraph.bounds.origin + equation.origin + point(equation.width() * 0.75, px(5.))
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", target - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(8));
        window.press("backspace", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p>Energy .</p>");
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), html);
    })
    .unwrap();
}

#[gpui_kit::test]
fn offline_data_image_decodes_native_pixels_and_keeps_original_metadata(cx: &mut TestAppContext) {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = include_bytes!("../../fixtures/editor/offline-landscape.png");
    let data = format!("data:image/png;base64,{}", STANDARD.encode(bytes));
    let html = format!(
        "<figure data-image-id=\"offline-proof\" data-image-offline=\"true\" data-image-width=\"40\"><img src=\"{data}\" alt=\"Offline landscape\"></figure><p>After.</p>"
    );
    let (handle, view) = room(cx, &html);
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let bounds = window.find("twyne-rich-image-0").bounds();
        assert!(bounds.size.width > px(150.));
        assert!(bounds.size.height > px(50.));
        assert_eq!(view.read(cx).document().to_html(), html);
        let view = view.read(cx);
        let cached = view.images.borrow();
        let gpui_kit::ImageSource::Image(image) =
            cached.get(&vec![0]).unwrap().source.as_ref().unwrap()
        else {
            panic!("Offline image should not become an HTTP request");
        };
        assert_eq!(image.bytes, bytes);
    })
    .unwrap();
}

#[gpui_kit::test]
fn word_shortcuts_use_unicode_boundaries_and_measured_caret_is_available(cx: &mut TestAppContext) {
    let (handle, view) = room(cx, "<p>One café résumé.</p>");
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        window.press("ctrl-end", cx);
        window.press("ctrl-left", cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(9));
        window.press("ctrl-shift-left", cx);
        assert_eq!(view.read(cx).selection().range(), 4..9);
        window.press("ctrl-i", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            "<p>One <em>café </em>résumé.</p>"
        );
        window.press("right", cx);
        window.press("ctrl-delete", cx);
        assert_eq!(view.read(cx).document().plain_text(), "One café .");
        window.press("ctrl-z", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            "<p>One <em>café </em>résumé.</p>"
        );
        window.render_frame(cx);
        let caret = view
            .read(cx)
            .caret_bounds()
            .expect("Native layout exposes the current caret to scrolling");
        assert!(caret.size.height > px(30.));
        assert!(caret.origin.x > px(0.));
    })
    .unwrap();
}

#[gpui_kit::test]
fn native_task_checkbox_edits_only_checked_metadata_and_undo_and_lock_work(
    cx: &mut TestAppContext,
) {
    let original = "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\" data-future-item=\"keep\"><p>Write prose.</p></li></ul><p>After.</p>";
    let (handle, view) = room(cx, original);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("twyne-task-0.0", cx);
        assert!(
            view.read(cx)
                .document()
                .to_html()
                .contains("data-checked=\"true\"")
        );
        assert!(
            view.read(cx)
                .document()
                .to_html()
                .contains("data-future-item=\"keep\"")
        );
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), original);
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        window.render_frame(cx);
        window.click("twyne-task-0.0", cx);
        assert_eq!(view.read(cx).document().to_html(), original);
    })
    .unwrap();
}

#[gpui_kit::test]
fn heading_display_casing_tracks_source_carets_and_imported_h4_to_h6_inherit_web_style(
    cx: &mut TestAppContext,
) {
    let original = "<h3 data-future-heading=\"keep\">Straße élan</h3><h4>Mixed Fourth</h4><h5>Fifth</h5><h6>Sixth</h6><p>Body</p>";
    let (handle, view) = room(cx, original);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let target = {
            let view = view.read(cx);
            let placed = view.placed.borrow();
            let heading = placed.get(&vec![0]).unwrap();
            let display: String = heading
                .layout
                .pieces
                .iter()
                .map(|piece| piece.shape.text.as_ref())
                .collect();
            assert_eq!(display, "STRASSE ÉLAN");
            assert_eq!(heading.layout.lines[0].height, px(21.6));
            let expanded = &heading.layout.pieces[0];
            assert_eq!(expanded.range, 0..6);
            assert_eq!(expanded.shape.font_size, px(12.));
            assert_eq!(expanded.tracking.as_ref().unwrap().spacing, px(3.84));
            assert_eq!(
                expanded.x_for_offset(5),
                expanded.shape.x_for_index(6) + px(6. * 3.84)
            );
            for offset in 0..=6 {
                assert_eq!(expanded.index_for_x(expanded.x_for_offset(offset)), offset);
            }
            for index in 1..=3 {
                let imported = placed.get(&vec![index]).unwrap();
                let piece = &imported.layout.pieces[0];
                assert_eq!(piece.shape.font_size, px(18.));
                assert!(piece.display_boundaries.is_none());
                assert!(piece.tracking.is_none());
                assert_eq!(piece.origin.x, px(0.));
                assert_eq!(imported.layout.lines[0].height, px(32.4));
                assert_eq!(
                    piece.shape.runs[0].font_id,
                    placed.get(&vec![4]).unwrap().layout.pieces[0].shape.runs[0].font_id
                );
                if index > 1 {
                    assert_eq!(
                        imported.bounds.top(),
                        placed.get(&vec![index - 1]).unwrap().bounds.bottom()
                    );
                }
            }
            assert_eq!(view.document().to_html(), original);
            heading.bounds.origin + heading.layout.position(5).unwrap() + point(px(0.5), px(5.))
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", target - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(5));
        window.input("x", cx);
        assert!(view.read(cx).document().to_html().contains("Straßxe élan"));
        window.press("shift-left", cx);
        window.press("shift-left", cx);
        assert_eq!(view.read(cx).selection().range(), 4..6);
        window.press("ctrl-b", cx);
        assert!(
            view.read(cx)
                .document()
                .to_html()
                .contains("Stra<strong>ßx</strong>e élan")
        );
        window.press("ctrl-z", cx);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), original);
    })
    .unwrap();
}

#[gpui_kit::test]
fn native_note_ordinals_renumber_independently_after_atomic_delete_and_undo(
    cx: &mut TestAppContext,
) {
    let original = "<p>A<sup data-type=\"endnote\" class=\"twyne-endnote\" data-endnote-text=\"First\" data-future-note=\"keep\"></sup> B<sup data-type=\"footnote\" class=\"twyne-endnote\" data-endnote-text=\"Foot one\"></sup>.</p><p>Untouched.</p><p>C<sup data-type=\"endnote\" class=\"twyne-endnote\" data-endnote-text=\"Second\"></sup> D<sup data-type=\"footnote\" class=\"twyne-endnote\" data-endnote-text=\"Foot two\"></sup>.</p>";
    let (handle, view) = room(cx, original);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let (target, cached) = {
            let view = view.read(cx);
            let placed = view.placed.borrow();
            for (index, expected) in [(0, ["1", "†1"]), (2, ["2", "†2"])] {
                let paragraph = placed.get(&vec![index]).unwrap();
                let notes: Vec<_> = paragraph
                    .layout
                    .pieces
                    .iter()
                    .filter(|piece| piece.object)
                    .collect();
                assert_eq!(notes.len(), 2);
                for (note, text) in notes.iter().zip(expected) {
                    assert_eq!(note.shape.text.as_ref(), text);
                    assert_eq!(note.range.end - note.range.start, 1);
                    assert!((f32::from(note.shape.font_size) - 12.96).abs() < 0.001);
                    assert!((f32::from(note.baseline_shift) + 5.832).abs() < 0.001);
                    assert!(note.width() > note.shape.width);
                }
            }
            let paragraph = placed.get(&vec![0]).unwrap();
            let first = paragraph
                .layout
                .pieces
                .iter()
                .find(|piece| piece.object)
                .unwrap();
            (
                paragraph.bounds.origin + first.origin + point(first.width() * 0.8, px(5.)),
                placed.get(&vec![1]).unwrap().layout.clone(),
            )
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", target - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(2));
        window.press("backspace", cx);
        window.render_frame(cx);
        {
            let view = view.read(cx);
            let placed = view.placed.borrow();
            let notes: Vec<_> = placed
                .get(&vec![2])
                .unwrap()
                .layout
                .pieces
                .iter()
                .filter(|piece| piece.object)
                .map(|piece| piece.shape.text.as_ref())
                .collect();
            assert_eq!(notes, ["1", "†2"]);
            assert!(std::sync::Arc::ptr_eq(
                &cached,
                &placed.get(&vec![1]).unwrap().layout
            ));
            assert!(
                view.document()
                    .to_html()
                    .contains("data-endnote-text=\"Second\"")
            );
        }
        window.press("ctrl-z", cx);
        window.render_frame(cx);
        assert_eq!(view.read(cx).document().to_html(), original);
        let view = view.read(cx);
        let placed = view.placed.borrow();
        let notes: Vec<_> = placed
            .get(&vec![2])
            .unwrap()
            .layout
            .pieces
            .iter()
            .filter(|piece| piece.object)
            .map(|piece| piece.shape.text.as_ref())
            .collect();
        assert_eq!(notes, ["2", "†2"]);
    })
    .unwrap();
}

#[gpui_kit::test]
fn native_rich_copy_cut_paste_uses_gpui_clipboard_and_one_undo_boundary(cx: &mut TestAppContext) {
    let original = "<p>Copy <span data-comment-id=\"comment-1\" data-future-review=\"keep\"><strong>🦊é</strong></span> <span data-type=\"inline-math\" data-latex=\"E=mc^2\" data-future-math=\"keep\"></span><sup data-type=\"footnote\" class=\"twyne-endnote\" data-endnote-text=\"Authored note\" data-future-note=\"keep\"></sup>.</p>";
    let (handle, view) = room(cx, original);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(0, view.document().text_len() - 1), cx)
                .unwrap();
        });
        window.press("ctrl-c", cx);
        let copied = cx
            .read_from_clipboard()
            .expect("Actual GPUI clipboard item");
        assert_eq!(copied.text().as_deref(), Some("Copy 🦊é $E=mc^2$."));
        let metadata = copied.metadata().unwrap().clone();
        assert!(metadata.contains("twyne.rich-fragment"));
        window.press("ctrl-x", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p></p>");
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), original);
        view.update(cx, |view, cx| {
            view.set_document(
                RichDocument::from_html("<p>Destination </p>").unwrap(),
                false,
                cx,
            );
        });
        window.press("ctrl-end", cx);
        window.press("ctrl-v", cx);
        let pasted = view.read(cx).document().to_html();
        assert_eq!(pasted, original.replacen("<p>", "<p>Destination ", 1));
        assert!(pasted.contains("data-future-math=\"keep\""));
        assert!(pasted.contains("data-future-note=\"keep\""));
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p>Destination </p>");
        assert!(!view.read(cx).can_undo());
        window.press("ctrl-shift-z", cx);
        assert_eq!(view.read(cx).document().to_html(), pasted);
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string_with_metadata(
            " public 🦊".into(),
            metadata,
        ));
        window.press("ctrl-v", cx);
        assert_eq!(
            view.read(cx).document().to_html(),
            pasted.replace(".</p>", ". public 🦊</p>")
        );
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), pasted);
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        window.press("ctrl-v", cx);
        assert_eq!(view.read(cx).document().to_html(), pasted);
    })
    .unwrap();
}

#[gpui_kit::test]
fn note_only_rich_clipboard_survives_empty_plain_text_and_cross_cell_cut_preserves_state(
    cx: &mut TestAppContext,
) {
    let note = "<sup data-type=\"endnote\" class=\"twyne-endnote\" data-endnote-text=\"An authored note\" data-future-note=\"keep\"></sup>";
    let (handle, view) = room(cx, &format!("<p>A{note}B</p>"));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click_at("twyne-rich-manuscript", point(px(5.), px(10.)), cx);
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(1, 2), cx).unwrap()
        });
        window.press("ctrl-c", cx);
        let copied = cx.read_from_clipboard().unwrap();
        assert!(copied.text().is_none());
        assert!(copied.metadata().is_some());
        view.update(cx, |view, cx| {
            view.set_document(RichDocument::from_html("<p></p>").unwrap(), false, cx)
        });
        window.press("ctrl-v", cx);
        assert_eq!(view.read(cx).document().to_html(), format!("<p>{note}</p>"));
        assert_eq!(view.read(cx).selection(), Selection::caret(1));
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).document().to_html(), "<p></p>");

        let table = "<table><tbody><tr><td><p>One</p></td><td><p>Two</p></td></tr></tbody></table>";
        view.update(cx, |view, cx| {
            view.set_document(RichDocument::from_html(table).unwrap(), false, cx);
            view.set_selection(Selection::new(1, 6), cx).unwrap();
        });
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(
            "keep previous clipboard".into(),
        ));
        window.press("ctrl-x", cx);
        assert_eq!(view.read(cx).document().to_html(), table);
        assert_eq!(view.read(cx).selection(), Selection::new(1, 6));
        assert!(!view.read(cx).can_undo());
        assert_eq!(
            cx.read_from_clipboard().unwrap().text().as_deref(),
            Some("keep previous clipboard")
        );
        cx.write_to_clipboard(copied);
        window.press("ctrl-v", cx);
        assert_eq!(view.read(cx).document().to_html(), table);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}
