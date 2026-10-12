use super::*;
use crate::app::tests::expanded_room;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{TestAppContext, size};

#[gpui_kit::test]
fn slash_note_modal_preserves_newlines_trims_commit_and_undoes(cx: &mut TestAppContext) {
    let (handle, view, store, _dir) = expanded_room(cx);
    cx.simulate_window_resize(handle, size(px(948.), px(640.)));
    let html = "<p>café 🦊 /endnote</p><p>After.</p>";
    let path = store.root().join("Notes.html");
    std::fs::write(&path, html).unwrap();
    let document =
        twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            let rich = room.rich.as_ref().unwrap();
            let end = rich.read(cx).document().blocks()[0].range.end;
            rich.update(cx, |rich, cx| {
                rich.set_selection(Selection::caret(end), cx).unwrap()
            });
            window.focus(&rich.read(cx).focus_handle(cx), cx);
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("enter", cx);
        window.render_frame(cx);
        assert_eq!(
            f32::from(window.find("slash-insert-form").bounds().size.width),
            512.
        );
        assert_eq!(window.find("slash-insert-form").label(), Some("Endnote"));
        assert_eq!(window.find("slash-insert-confirm").disabled(), Some(true));
        window.input("  東京", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.form.is_some());
        window.input(" café 🦊  ", cx);
        assert!(view.read(cx).insert.form.is_some());
        assert_eq!(
            view.read(cx)
                .insert
                .form
                .as_ref()
                .unwrap()
                .read(cx)
                .current_values(cx)
                .unwrap(),
            Parameters::Text("東京\n café 🦊".into())
        );
        window.press("ctrl-enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.form.is_none());
        let rich = view.read(cx).rich.as_ref().unwrap().clone();
        let rendered = rich.read(cx).document().to_html();
        assert!(rendered.contains("data-type=\"endnote\""), "{rendered}");
        assert!(rendered.contains("東京") && rendered.contains("café 🦊"));
        assert!(rendered.ends_with("<p>After.</p>"));
        window.press("ctrl-z", cx);
        assert_eq!(
            rich.read(cx).document().to_html(),
            "<p>café 🦊 </p><p>After.</p>"
        );
        window.press("ctrl-z", cx);
        assert_eq!(rich.read(cx).document().to_html(), html);
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_note_empty_submit_tab_and_backdrop_keep_the_removed_query(cx: &mut TestAppContext) {
    let (handle, view, _store, _dir) = expanded_room(cx);
    cx.simulate_window_resize(handle, size(px(948.), px(640.)));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("Before.\n\n/footnote", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("enter", cx);
        window.render_frame(cx);
        window.press("ctrl-enter", cx);
        assert!(view.read(cx).insert.form.is_some());
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("slash-insert-cancel").focused(), Some(true));
        window.click_at("slash-insert-scrim", point(px(8.), px(8.)), cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.form.is_none());
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "Before.\n\n");
        assert!(
            view.read(cx)
                .body
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_equations_insert_blank_atoms_immediately_without_a_form(cx: &mut TestAppContext) {
    for (id, kind) in [
        ("insert.math-inline", "inline-math"),
        ("insert.math-block", "block-math"),
    ] {
        let (handle, view, store, _dir) = expanded_room(cx);
        let html = "<p>café 🦊 /math</p><p>After.</p>";
        let path = store.root().join("Equations.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                let rich = room.rich.as_ref().unwrap();
                let end = rich.read(cx).document().blocks()[0].range.end;
                rich.update(cx, |rich, cx| {
                    rich.set_selection(Selection::caret(end), cx).unwrap()
                });
                window.focus(&rich.read(cx).focus_handle(cx), cx);
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click(format!("slash-command-{}", id.replace('.', "-")), cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(view.read(cx).insert.form.is_none() && view.read(cx).insert.target.is_none());
            let rich = view.read(cx).rich.as_ref().unwrap().clone();
            let rendered = rich.read(cx).document().to_html();
            assert!(
                rendered.contains(&format!("data-type=\"{kind}\""))
                    && rendered.contains("data-latex=\"\""),
                "{rendered}"
            );
            assert!(rendered.ends_with("<p>After.</p>"));
            window.press("ctrl-z", cx);
            assert_eq!(rich.read(cx).document().to_html(), html);
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn slash_menu_filters_inserts_and_undoes_through_markdown_controls(cx: &mut TestAppContext) {
    let (handle, view, store, _dir) = expanded_room(cx);
    cx.simulate_window_resize(handle, size(px(1000.), px(860.)));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("/h2", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("slash-command-menu").visible());
        assert_eq!(
            view.read(cx)
                .insert
                .menu
                .as_ref()
                .unwrap()
                .read(cx)
                .selected(),
            Some("paragraph.heading-2")
        );
        let selection = view.read(cx).body.read(cx).selected_range();
        window.press("down", cx);
        window.press("up", cx);
        assert_eq!(view.read(cx).body.read(cx).selected_range(), selection);
        window.press("enter", cx);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "## ");
        window.input("café 🦊", cx);
        window.press("ctrl-s", cx);
        assert_eq!(store.load().unwrap().documents[0].body, "## café 🦊");
        window.press("ctrl-z", cx);
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "/h2");
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_escape_preserves_query_and_form_cancel_keeps_it_removed(cx: &mut TestAppContext) {
    let (handle, view, _store, _dir) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("/link", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("escape", cx);
        window.render_frame(cx);
        assert!(view.read(cx).insert.target.is_none());
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "/link");
        assert_eq!(view.read(cx).body.read(cx).selected_range(), 5..5);
        window.render_frame(cx);
        assert!(view.read(cx).insert.target.is_none());
        window.input("x", cx);
        window.press("backspace", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.target.is_some());
        window.press("enter", cx);
        window.render_frame(cx);
        assert!(window.find("slash-insert-form").visible());
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "");
        window.press("escape", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.form.is_none());
        assert!(
            view.read(cx)
                .body
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "");
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_link_form_inserts_real_values_and_preserves_undo(cx: &mut TestAppContext) {
    let (handle, view, _store, _dir) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("café 🦊 /link", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("enter", cx);
        window.render_frame(cx);
        window.input("The paper", cx);
        window.press("tab", cx);
        window.input("https://example.test/paper", cx);
        window.click("slash-insert-confirm", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.form.is_none());
        assert!(
            view.read(cx)
                .body
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        assert_eq!(
            view.read(cx).body.read(cx).value().as_ref(),
            "café 🦊 [The paper](<https://example.test/paper>)"
        );
        window.press("ctrl-z", cx);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "café 🦊 ");
        window.press("ctrl-z", cx);
        assert_eq!(
            view.read(cx).body.read(cx).value().as_ref(),
            "café 🦊 /link"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_queued_menu_activation_cannot_cross_document_boundaries(cx: &mut TestAppContext) {
    let (handle, view, _store, _dir) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("/h2", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let (menu, old_binding) = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let held = (
                view.read(cx).insert.menu.as_ref().unwrap().clone(),
                view.read(cx).insert.menu_binding,
            );
            view.update(cx, |room, cx| {
                assert!(room.add_document(Manuscript::new("Another manuscript"), window, cx))
            });
            window.render_frame(cx);
            window.click("body-field", cx);
            window.input("/h2", cx);
            held
        })
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_ne!(view.read(cx).insert.menu_binding, old_binding);
        menu.update(cx, |_, cx| {
            cx.emit(MenuEvent::Choose {
                id: "paragraph.heading-2".into(),
                binding: old_binding,
            })
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "/h2");
        window.press("enter", cx);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "## ");
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_menu_closes_when_reading_or_selecting_text(cx: &mut TestAppContext) {
    let (handle, view, _store, _dir) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("/table", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.target.is_some());
        view.read(cx)
            .body
            .clone()
            .update(cx, |body, cx| body.set_selected_range(0..6, cx));
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.target.is_none());
        view.read(cx)
            .body
            .clone()
            .update(cx, |body, cx| body.set_selected_range(6..6, cx));
        view.update(cx, |room, cx| room.set_reading(true, cx));
        window.render_frame(cx);
        assert!(view.read(cx).insert.target.is_none());
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "/table");
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_rich_grid_commits_table_and_undo_keeps_activation_separate(cx: &mut TestAppContext) {
    let (handle, view, store, _dir) = expanded_room(cx);
    let path = store.root().join("Rich slash.html");
    let html = "<p>Before.</p><p></p><p>After.</p>";
    std::fs::write(&path, html).unwrap();
    let document =
        twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            let editor = room.rich.as_ref().unwrap();
            editor.update(cx, |editor, cx| {
                editor.set_selection(Selection::caret(8), cx).unwrap()
            });
            window.focus(&editor.read(cx).focus_handle(cx), cx);
        });
        window.render_frame(cx);
        window.input("/table", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("slash-command-menu").visible());
        window.press("enter", cx);
        window.render_frame(cx);
        assert!(window.find("slash-table-grid").visible());
        assert!(
            !view
                .read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html()
                .contains("/table")
        );
        window.press("down", cx);
        for _ in 0..3 {
            window.press("right", cx);
        }
        assert_eq!(
            view.read(cx)
                .insert
                .table
                .as_ref()
                .unwrap()
                .read(cx)
                .selected(),
            insert_menu::table_grid::Dimensions {
                rows: 2,
                columns: 4
            }
        );
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let editor = view.read(cx).rich.as_ref().unwrap();
        let html = editor.read(cx).document().to_html();
        assert_eq!(
            html.matches("<tr>").count(),
            2,
            "{html}; notice {:?}; current {:?}; form {:?}; expected {:?}",
            view.read(cx).notice,
            view.read(cx).current_insert_target(false, window, cx),
            view.read(cx)
                .insert
                .form
                .as_ref()
                .map(|f| f.read(cx).current_values(cx)),
            view.read(cx).insert.form_target
        );
        assert_eq!(html.matches("<th>").count(), 4, "{html}");
        assert_eq!(html.matches("<td>").count(), 4, "{html}");
        window.press("ctrl-z", cx);
        let html = view
            .read(cx)
            .rich
            .as_ref()
            .unwrap()
            .read(cx)
            .document()
            .to_html();
        assert!(!html.contains("<table"));
        assert!(!html.contains("/table"));
        assert!(html.contains("Before.") && html.contains("After."));
        window.press("ctrl-z", cx);
        assert!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html()
                .contains("/table")
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_table_grid_limits_pointer_and_cancel_preserve_other_writing(cx: &mut TestAppContext) {
    let (handle, view, store, _dir) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("Before.\n\n/table", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("enter", cx);
        window.render_frame(cx);
        window.press("end", cx);
        assert_eq!(
            view.read(cx)
                .insert
                .table
                .as_ref()
                .unwrap()
                .read(cx)
                .selected(),
            insert_menu::table_grid::Dimensions {
                rows: 8,
                columns: 10
            }
        );
        window.press("down", cx);
        window.press("right", cx);
        assert_eq!(
            view.read(cx)
                .insert
                .table
                .as_ref()
                .unwrap()
                .read(cx)
                .selected(),
            insert_menu::table_grid::Dimensions {
                rows: 8,
                columns: 10
            }
        );
        window.press("escape", cx);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "Before.\n\n");
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.table.is_none());
        window.input("/table", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.press("enter", cx);
        window.render_frame(cx);
        window.click("slash-table-cell-2-4", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).insert.table.is_none());
        let body = view.read(cx).body.read(cx).value().to_string();
        assert!(body.starts_with("Before.\n\n"));
        assert!(!body.contains("/table"));
        assert_eq!(
            body.matches("| --- | --- | --- | --- |").count(),
            1,
            "{body}"
        );
        window.press("ctrl-s", cx);
        assert_eq!(store.load().unwrap().documents[0].body, body);
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_table_queued_choice_cannot_edit_a_new_document(cx: &mut TestAppContext) {
    let (handle, view, _store, _dir) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("/table", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let picker = cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("enter", cx);
            let picker = view.read(cx).insert.table.as_ref().unwrap().clone();
            view.update(cx, |room, cx| {
                assert!(room.add_document(Manuscript::new("Another manuscript"), window, cx))
            });
            picker
        })
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, _window, cx| {
        picker.update(cx, |_, cx| {
            cx.emit(TablePickerEvent::Insert(
                insert_menu::table_grid::Dimensions {
                    rows: 8,
                    columns: 10,
                },
            ))
        });
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), "");
        assert!(view.read(cx).insert.table.is_none());
    })
    .unwrap();
}

#[gpui_kit::test]
fn slash_shortcut_hints_correspond_to_native_rich_commands(cx: &mut TestAppContext) {
    let (handle, view, store, _dir) = expanded_room(cx);
    let path = store.root().join("Shortcuts.html");
    let html = "<p>café 🦊 exact writing</p>";
    std::fs::write(&path, html).unwrap();
    let document =
        twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            window.focus(&room.rich.as_ref().unwrap().read(cx).focus_handle(cx), cx);
        });
        window.render_frame(cx);
        window.press("ctrl-alt-2", cx);
        assert!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html()
                .contains("<h2>café 🦊 exact writing</h2>")
        );
        window.press("ctrl-z", cx);
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            html
        );
        window.press("ctrl-shift-8", cx);
        assert!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html()
                .contains("<ul>")
        );
        window.press("ctrl-z", cx);
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            html
        );
        window.press("ctrl-alt-c", cx);
        let code = view
            .read(cx)
            .rich
            .as_ref()
            .unwrap()
            .read(cx)
            .document()
            .to_html();
        assert!(code.contains("<pre>"));
        window.press("ctrl-enter", cx);
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            format!("{code}<p></p>")
        );
        window.press("ctrl-z", cx);
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            code
        );
    })
    .unwrap();
}
