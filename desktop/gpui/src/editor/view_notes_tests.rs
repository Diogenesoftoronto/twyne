use super::*;
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../fixtures/editor/notes/source-reference.json"
    ))
    .unwrap()
}
fn references(editor: &RichEditor) -> Arc<[NoteReference]> {
    NoteCatalog::default().references(editor.document(), editor.revision())
}

#[test]
fn original_note_update_conversion_empty_delete_and_history_keep_exact_tree_and_unicode_selection()
{
    let fixture = fixture();
    let steps = fixture["steps"].as_array().unwrap();
    let mut editor =
        RichEditor::new(RichDocument::from_html(steps[0]["html"].as_str().unwrap()).unwrap());
    for step in steps.iter().skip(1) {
        let before = editor.document().clone();
        let before_selection = editor.selection();
        let reference = references(&editor)[0].clone();
        match step["action"].as_str().unwrap() {
            "selected" => editor
                .set_selection(Selection::new(reference.position, reference.position + 1))
                .unwrap(),
            "updated" => {
                editor
                    .execute(Command::UpdateNote {
                        path: reference.path,
                        expected: reference.node,
                        text: Some("A & \"B\" — 東京 🦊".into()),
                        kind: None,
                    })
                    .unwrap();
            }
            "converted" => {
                editor
                    .execute(Command::UpdateNote {
                        path: reference.path,
                        expected: reference.node,
                        text: None,
                        kind: Some(NoteKind::Footnote),
                    })
                    .unwrap();
            }
            "empty" => {
                editor
                    .execute(Command::UpdateNote {
                        path: reference.path,
                        expected: reference.node,
                        text: Some(String::new()),
                        kind: None,
                    })
                    .unwrap();
            }
            "deleted" => {
                editor
                    .execute(Command::DeleteNote {
                        path: reference.path,
                        expected: reference.node,
                    })
                    .unwrap();
            }
            action => panic!("Unexpected Source command {action}"),
        }
        assert_eq!(
            editor.document().to_html(),
            step["html"].as_str().unwrap(),
            "{}",
            step["action"]
        );
        let current = references(&editor);
        for (note, original) in current.iter().zip(step["notes"].as_array().unwrap()) {
            assert_eq!(
                editor.document().scalar_to_utf16(note.position).unwrap() + 1,
                original["pos"].as_u64().unwrap() as usize
            );
            assert_eq!(note.number, original["number"].as_u64().unwrap() as usize);
            assert_eq!(&*note.text, original["text"].as_str().unwrap());
        }
        if step["action"] == "selected" {
            assert!(!editor.can_undo());
            continue;
        }
        let after = editor.document().clone();
        let after_selection = editor.selection();
        assert_eq!(after_selection, Selection::caret(3));
        assert!(editor.execute(Command::Undo).unwrap().document_changed);
        assert_eq!(editor.document(), &before);
        assert_eq!(editor.selection(), before_selection);
        assert!(editor.execute(Command::Redo).unwrap().document_changed);
        assert_eq!(editor.document(), &after);
        assert_eq!(editor.selection(), after_selection);
    }
}

#[test]
fn note_commands_preserve_unknown_metadata_wrappers_and_refuse_stale_or_readonly_targets() {
    let html = "<p><span data-comment-id=\"keep\"><strong data-future=\"bold\">前🦊<sup data-type=\"endnote\" data-endnote-text=\"old\" data-future=\"atom\" title=\"old\"></sup>後</strong></span><span data-type=\"raw-typst-inline\" data-typst-source=\"#authored[東京]\"></span></p><p>untouched</p>";
    let document = RichDocument::from_html(html).unwrap();
    let mut editor = RichEditor::new(document.clone());
    editor.set_selection(Selection::new(4, 1)).unwrap();
    let reference = references(&editor)[0].clone();
    let command = Command::UpdateNote {
        path: reference.path.clone(),
        expected: reference.node.clone(),
        text: Some("new 🦊 é".into()),
        kind: Some(NoteKind::Footnote),
    };
    editor.execute(command.clone()).unwrap();
    assert!(editor.document().to_html().contains("data-future=\"atom\""));
    assert!(editor.document().nodes()[1].shares_storage_with(&document.nodes()[1]));
    assert_eq!(
        editor.document().comment_ranges(),
        document.comment_ranges()
    );
    let updated = editor.document().clone();
    let selection = editor.selection();
    assert!(editor.execute(command).is_err());
    assert_eq!(editor.document(), &updated);
    assert_eq!(editor.selection(), selection);
    editor.execute(Command::Undo).unwrap();
    assert_eq!(editor.document(), &document);
    assert_eq!(editor.selection(), Selection::new(4, 1));
    editor.set_read_only(true);
    assert_eq!(
        editor
            .execute(Command::DeleteNote {
                path: reference.path,
                expected: reference.node
            })
            .unwrap_err(),
        EditorError::ReadOnly
    );
    assert_eq!(editor.document(), &document);
}

#[test]
fn note_catalog_reuses_unchanged_subtrees_and_updates_only_derived_positions_and_ordinals() {
    let document = RichDocument::from_html("<p>前🦊</p><blockquote><p>A<sup data-type=\"endnote\" data-endnote-text=\"one\"></sup>B<sup data-type=\"footnote\" data-endnote-text=\"two\"></sup></p></blockquote><p>C<sup data-type=\"endnote\" data-endnote-text=\"three\"></sup></p>").unwrap();
    let mut editor = RichEditor::new(document);
    let mut catalog = NoteCatalog::default();
    let first = catalog.references(editor.document(), editor.revision());
    let rebuilt = catalog.rebuilt;
    assert!(Arc::ptr_eq(
        &first,
        &catalog.references(editor.document(), editor.revision())
    ));
    editor.set_selection(Selection::caret(0)).unwrap();
    editor.execute(Command::InsertText("🦊é".into())).unwrap();
    let second = catalog.references(editor.document(), editor.revision());
    assert_eq!(
        catalog.rebuilt, rebuilt,
        "Unchanged note-bearing subtrees must not be projected again"
    );
    assert!(first.iter().zip(second.iter()).all(|(before, after)| {
        before.node.shares_storage_with(&after.node)
            && before.number == after.number
            && after.position == before.position + 3
    }));
    let reference = second[0].clone();
    editor
        .execute(Command::UpdateNote {
            path: reference.path,
            expected: reference.node,
            text: None,
            kind: Some(NoteKind::Footnote),
        })
        .unwrap();
    let third = catalog.references(editor.document(), editor.revision());
    assert_eq!(
        third
            .iter()
            .map(|note| (note.kind, note.number))
            .collect::<Vec<_>>(),
        [
            (NoteKind::Footnote, 1),
            (NoteKind::Footnote, 2),
            (NoteKind::Endnote, 1)
        ]
    );
    assert!(second[2].node.shares_storage_with(&third[2].node));
}

#[test]
fn source_top_level_whitespace_is_ignored_without_losing_prose_nbsp_or_pre_code_bytes() {
    let fixture = fixture();
    for case in fixture["parser"].as_array().unwrap().iter().take(2) {
        let document = RichDocument::from_html(case["html"].as_str().unwrap()).unwrap();
        assert_eq!(document.to_html(), case["htmlAfterParse"].as_str().unwrap());
        let mut editor = RichEditor::new(document);
        let end = editor.document().text_len().saturating_sub(1);
        editor.set_selection(Selection::caret(end)).unwrap();
        editor
            .execute(Command::InsertInline(InlineObject::Note {
                kind: NoteKind::Footnote,
                text: "citation".into(),
            }))
            .unwrap();
        assert!(!editor.document().to_html().contains("<p>\n</p>"));
    }
    for case in fixture["parser"].as_array().unwrap().iter().skip(2) {
        let document = RichDocument::from_html(case["html"].as_str().unwrap()).unwrap();
        match case["name"].as_str().unwrap() {
            "meaningful top-level text" => assert_eq!(document.to_html(), "before<p>A</p>after"),
            "inside prose and pre" => assert_eq!(
                document.to_html(),
                "<p> A\n B \t</p><pre><code> A\n B \t</code></pre>"
            ),
            "top-level NBSP is meaningful" => {
                assert_eq!(document.nodes().last().unwrap().as_text(), Some("\u{00a0}"))
            }
            _ => unreachable!(),
        }
    }
}

#[test]
fn source_get_text_projection_uses_exact_schema_serializers_and_nested_block_separators() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../fixtures/editor/notes/research-text-reference.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let document = RichDocument::from_html(case["html"].as_str().unwrap()).unwrap();
        assert_eq!(
            document.research_text(),
            case["text"].as_str().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[cfg(feature = "ui-tests")]
mod mounted {
    use super::*;
    use gpui_kit::{AppContext, TestAppContext, test::TestWindowExt};

    const HTML: &str = "<p>A 🦊<sup data-type=\"endnote\" data-endnote-text=\"Alpha\" data-future=\"keep\"></sup> B é<sup data-type=\"footnote\" data-endnote-text=\"Beta\"></sup> C<sup data-type=\"endnote\" data-endnote-text=\"Gamma\"></sup></p><p>Untouched prose.</p>";
    struct NotePaper(Entity<RichEditorView>);
    impl gpui_kit::Render for NotePaper {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().w_full().p(px(40.)).child(self.0.clone())
        }
    }
    fn room(cx: &mut TestAppContext) -> (gpui_kit::AnyWindowHandle, Entity<RichEditorView>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            crate::theme::apply(cx).unwrap();
            let (window, paper) = gpui_kit::open_window(
                gpui_kit::WindowOptions {
                    window_bounds: Some(gpui_kit::WindowBounds::Windowed(Bounds::new(
                        Point::default(),
                        size(px(720.), px(600.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    cx.new(|cx| {
                        NotePaper(cx.new(|cx| {
                            let mut view =
                                RichEditorView::new(RichDocument::from_html(HTML).unwrap(), cx);
                            view.set_opening_initial(
                                OpeningInitial {
                                    mode: InitialMode::Off,
                                    ..Default::default()
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

    #[gpui_kit::test]
    fn native_marker_keyboard_edit_convert_escape_and_undo_redo_keep_source_and_prose(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = room(cx);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let before = view.read(cx).snapshot();
            let first = view.read(cx).note_references()[0].clone();
            assert_eq!(
                window.find("twyne-note-reference-0-1").label(),
                Some(first.accessible_label().as_str())
            );
            let marker = view
                .read(cx)
                .notes
                .focus
                .borrow()
                .get(&first.path)
                .unwrap()
                .clone();
            window.focus(&marker, cx);
            window.press("enter", cx);
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
            assert!(view.read(cx).notes.popup.is_some());
            assert_eq!(view.read(cx).document(), &before);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("ctrl-a", cx);
            window.input("Changed 東京 🦊 é", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                &*view.read(cx).note_references()[0].text,
                "Changed 東京 🦊 é"
            );
            assert!(
                view.read(cx)
                    .document()
                    .to_html()
                    .contains("data-future=\"keep\"")
            );
            window.click("twyne-note-kind", cx);
            assert_eq!(window.find("twyne-note-kind").expanded(), Some(true));
            window.press("up", cx);
            assert_eq!(
                view.read(cx)
                    .notes
                    .popup
                    .as_ref()
                    .unwrap()
                    .kind
                    .read(cx)
                    .selected_index(cx),
                Some(IndexPath::new(0)),
            );
            window.press("enter", cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(view.read(cx).note_references()[0].kind, NoteKind::Footnote);
            assert_eq!(view.read(cx).note_references()[1].number, 2);
            window.press("escape", cx);
            window.render_frame(cx);
            assert!(view.read(cx).notes.popup.is_none());
            let first = view.read(cx).note_references()[0].clone();
            assert_eq!(
                view.read(cx).selection(),
                Selection::new(first.position, first.position + 1)
            );
            assert!(
                view.read(cx)
                    .notes
                    .focus
                    .borrow()
                    .get(&first.path)
                    .unwrap()
                    .is_focused(window)
            );
            let focus = view.read(cx).focus.clone();
            window.focus(&focus, cx);
            window.press("ctrl-z", cx);
            window.render_frame(cx);
            assert_eq!(view.read(cx).note_references()[0].kind, NoteKind::Endnote);
            assert_eq!(
                &*view.read(cx).note_references()[0].text,
                "Changed 東京 🦊 é"
            );
            window.press("ctrl-z", cx);
            window.render_frame(cx);
            assert_eq!(&*view.read(cx).note_references()[0].text, "Alpha");
            window.press("ctrl-shift-z", cx);
            window.render_frame(cx);
            assert_eq!(
                &*view.read(cx).note_references()[0].text,
                "Changed 東京 🦊 é"
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn native_note_navigation_reference_delete_and_stale_readonly_jump_are_guarded(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = room(cx);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let before = view.read(cx).snapshot();
            window.click("twyne-note-reference-0-1", cx);
            window.render_frame(cx);
            assert_eq!(window.find("twyne-note-previous").disabled(), Some(true));
            window.click("twyne-note-next", cx);
            window.render_frame(cx);
            assert_eq!(
                view.read(cx).notes.popup.as_ref().unwrap().reference.kind,
                NoteKind::Footnote
            );
            window.click("twyne-note-next", cx);
            window.render_frame(cx);
            assert_eq!(window.find("twyne-note-next").disabled(), Some(true));
            assert_eq!(
                view.read(cx).notes.popup.as_ref().unwrap().reference.number,
                2
            );
            window.click("twyne-note-return", cx);
            window.render_frame(cx);
            assert!(view.read(cx).notes.popup.is_none());
            assert_eq!(view.read(cx).snapshot(), before);
            assert!(!view.read(cx).can_undo());
            window.press("space", cx);
            window.render_frame(cx);
            assert!(view.read(cx).notes.popup.is_some());
            let selected = view.read(cx).selection();
            window.click("twyne-note-delete", cx);
            window.render_frame(cx);
            assert_eq!(view.read(cx).note_references().len(), 2);
            window.press("ctrl-z", cx);
            window.render_frame(cx);
            assert_eq!(view.read(cx).document(), &before);
            assert_eq!(view.read(cx).selection(), selected);
            let stale = view.read(cx).note_references()[0].clone();
            view.update(cx, |view, cx| {
                view.set_selection(Selection::caret(0), cx).unwrap();
                view.execute(Command::InsertText("prefix ".into()), window, cx)
                    .unwrap();
            });
            let updated = view.read(cx).snapshot();
            let selection = view.read(cx).selection();
            assert!(
                !view
                    .update(cx, |view, cx| view.jump_note(&stale, window, cx))
                    .unwrap()
            );
            assert_eq!(view.read(cx).document(), &updated);
            assert_eq!(view.read(cx).selection(), selection);
            view.update(cx, |view, cx| view.set_read_only(true, cx));
            window.render_frame(cx);
            let current = view.read(cx).note_references()[0].clone();
            assert!(
                view.update(cx, |view, cx| view.jump_note(&current, window, cx))
                    .unwrap()
            );
            window.press("enter", cx);
            window.render_frame(cx);
            assert!(view.read(cx).notes.popup.is_some());
            assert_eq!(window.find("twyne-note-delete").disabled(), Some(true));
            assert_eq!(view.read(cx).document(), &updated);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn retained_note_input_burst_and_atomic_citation_have_independent_exact_undo_entries(
        cx: &mut TestAppContext,
    ) {
        use crate::citation_anchor::{CitationTarget, CitationTargetOrigin, PreparedCitation};
        use crate::semantic_bridge::CitationUtf16Range;
        let (handle, view) = room(cx);
        let before = cx
            .update_window(handle, |_, window, cx| {
                view.update(cx, |view, cx| {
                    view.set_selection(Selection::new(8, 5), cx).unwrap()
                });
                window.render_frame(cx);
                let before = view.read(cx).snapshot();
                window.click("twyne-note-reference-0-1", cx);
                window.render_frame(cx);
                window.simulate_next_frame(cx);
                window.render_frame(cx);
                window.press("ctrl-a", cx);
                window.input("Retained note 🦊 é", cx);
                before
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let edited = view.read(cx).snapshot();
            assert_ne!(edited, before);
            assert!(view.read(cx).note_edit_group_open());
            let selection_before = view.read(cx).selection();
            assert_eq!(selection_before, Selection::new(8, 5));
            let range = 5..9;
            let insert_at = Selection::caret(range.end);
            let command = Command::InsertInline(InlineObject::Note {
                kind: NoteKind::Footnote,
                text: "Original citation.".into(),
            });
            let mut candidate = RichEditor::new(edited.clone());
            candidate.set_selection(insert_at).unwrap();
            candidate.execute(command.clone()).unwrap();
            let prepared = PreparedCitation {
                source_id: "fixture-citation".into(),
                target: CitationTarget {
                    origin: CitationTargetOrigin::Selection,
                    utf16_range: CitationUtf16Range {
                        from: edited.scalar_to_utf16(range.start).unwrap(),
                        to: edited.scalar_to_utf16(range.end).unwrap(),
                    },
                    range,
                },
                selection_before,
                insert_at,
                command,
                candidate: candidate.document().clone(),
                selection_after: candidate.selection(),
            };
            let revision = view.read(cx).revision();
            view.update(cx, |view, cx| {
                view.commit_prepared_citation(&prepared, revision, window, cx)
            })
            .unwrap();
            assert!(!view.read(cx).note_edit_group_open());
            window.press("ctrl-z", cx);
            assert_eq!(view.read(cx).document(), &edited);
            assert_eq!(view.read(cx).selection(), selection_before);
            window.press("ctrl-z", cx);
            assert_eq!(view.read(cx).document(), &before);
            assert_eq!(view.read(cx).selection(), Selection::new(8, 5));
            assert!(!view.read(cx).can_undo());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn unblurred_note_field_is_captured_at_save_and_close_before_queued_changes(
        cx: &mut TestAppContext,
    ) {
        let (handle, view) = room(cx);
        let before = cx
            .update_window(handle, |_, window, cx| {
                view.update(cx, |view, cx| {
                    view.set_selection(Selection::new(8, 5), cx).unwrap();
                });
                window.render_frame(cx);
                let before = view.read(cx).snapshot();
                window.click("twyne-note-reference-0-1", cx);
                window.render_frame(cx);
                window.simulate_next_frame(cx);
                window.render_frame(cx);
                before
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("ctrl-a", cx);
            window.input("Final note 東京 🦊 é", cx);
            view.update(cx, |view, cx| view.flush_note_input(cx))
                .unwrap();
            assert_eq!(
                &*view.read(cx).note_references()[0].text,
                "Final note 東京 🦊 é"
            );
            assert!(
                !view
                    .update(cx, |view, cx| view.flush_note_input(cx))
                    .unwrap()
            );
            assert_eq!(view.read(cx).selection(), Selection::new(8, 5));
            window.input("!", cx);
            window.click("twyne-note-return", cx);
            assert!(view.read(cx).notes.popup.is_none());
            assert_eq!(
                &*view.read(cx).note_references()[0].text,
                "Final note 東京 🦊 é!"
            );
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                &*view.read(cx).note_references()[0].text,
                "Final note 東京 🦊 é!"
            );
            let focus = view.read(cx).focus.clone();
            window.focus(&focus, cx);
            window.press("ctrl-z", cx);
            assert_eq!(view.read(cx).document(), &before);
            assert_eq!(view.read(cx).selection(), Selection::new(8, 5));
            assert!(!view.read(cx).can_undo());
        })
        .unwrap();
    }
}
