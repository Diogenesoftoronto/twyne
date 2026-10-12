use super::*;
use crate::editor::{Command, RichDocument, RichEditor, Selection};
use parameters::Parameters;

#[test]
fn filter_matches_actual_source_registry_and_scores() {
    let cases: serde_json::Value = serde_json::from_str(include_str!(
        "../../fixtures/insert-menu/source-filter-cases.json"
    ))
    .unwrap();
    for case in cases.as_array().unwrap() {
        let query = case["query"].as_str().unwrap();
        let actual = candidates(query)
            .into_iter()
            .filter(|r| r.command.id != "insert.link")
            .map(|r| serde_json::json!({ "id": r.command.id, "score": r.score }))
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::json!(actual),
            case["results"],
            "query {query:?}"
        );
    }
    assert_eq!(commands().len(), 18);
    assert_eq!(candidates("link")[0].command.id, "insert.link");
}

#[test]
fn table_grid_matches_executed_source_helpers() {
    use table_grid::{Dimensions, Direction};
    #[derive(serde::Deserialize)]
    struct Case {
        current: Dimensions,
        limits: Dimensions,
        expected: Dimensions,
        direction: Option<Direction>,
    }
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../fixtures/insert-menu/source-table-grid-cases.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["constants"],
        serde_json::json!({ "defaultRows": table_grid::DEFAULT_ROWS, "defaultColumns": table_grid::DEFAULT_COLUMNS, "maxRows": table_grid::MAX_ROWS, "maxColumns": table_grid::MAX_COLUMNS })
    );
    for entry in fixture["moves"]
        .as_array()
        .unwrap()
        .iter()
        .chain(fixture["clamps"].as_array().unwrap())
    {
        let case: Case = serde_json::from_value(entry.clone()).unwrap();
        let actual = if let Some(direction) = case.direction {
            case.current.moved(direction, case.limits)
        } else {
            case.current.clamped(case.limits)
        };
        assert_eq!(actual, case.expected, "{entry}");
    }
    let selection = Dimensions {
        rows: 2,
        columns: 4,
    };
    assert_eq!(
        (1..=8)
            .flat_map(|rows| (1..=10).map(move |columns| Dimensions { rows, columns }))
            .filter(|cell| selection.contains(*cell))
            .count(),
        8
    );
}

#[test]
fn retained_parameter_cursor_rejects_stale_input_and_undoes_only_its_commit() {
    let original = RichDocument::from_html("<p>café 🦊 /table</p><p>After.</p>").unwrap();
    let mut editor = RichEditor::new(original);
    editor.set_selection(Selection::caret(13)).unwrap();
    let query = detect_rich(editor.document(), editor.selection()).unwrap();
    let revision = editor.revision();
    rich::remove_query(&mut editor, &query, revision).unwrap();
    assert!(!editor.document().to_html().contains("/table"));
    let activated = editor.document().to_html();
    let selection = editor.selection();
    let revision = editor.revision();
    let values = Parameters::Table {
        rows: 2,
        columns: 4,
        header: true,
    };
    assert!(
        rich::apply_at(
            &mut editor,
            revision.saturating_sub(1),
            selection,
            "insert.table",
            &values
        )
        .is_err()
    );
    assert_eq!(editor.document().to_html(), activated);
    rich::apply_at(&mut editor, revision, selection, "insert.table", &values).unwrap();
    editor.execute(Command::Undo).unwrap();
    assert_eq!(editor.document().to_html(), activated);
    editor.execute(Command::Undo).unwrap();
    assert!(editor.document().to_html().contains("/table"));
    let text = "café 🦊 \nAfter.";
    let position = "café 🦊 ".len();
    let edit = markdown::plan_at(text, position, "insert.table", &values).unwrap();
    assert!(edit.text.contains("|"));
    assert!(markdown::plan_at(text, 4, "insert.table", &values).is_err());
}

#[test]
fn detection_matches_source_boundaries_and_utf8_ranges() {
    for (text, expected) in [
        ("/", Some("")),
        ("/hea", Some("hea")),
        ("café 🦊 /table", Some("table")),
        ("\u{feff}/math", Some("math")),
        ("x\u{a0}/", Some("")),
        ("http://x", None),
        ("word/", None),
        ("//", None),
        ("/two words", None),
        ("/one/", None),
        ("x\u{85}/", None),
        ("/東京", Some("東京")),
    ] {
        let found = detect(text);
        assert_eq!(
            found.as_ref().map(|q| q.query.as_str()),
            expected,
            "{text:?}"
        );
        if let Some(found) = found {
            assert_eq!(&text[found.range], format!("/{}", found.query));
        }
    }
}

#[test]
fn rich_detection_retains_scalar_offsets_marks_and_atom_boundaries() {
    let document =
        RichDocument::from_html("<p>First.</p><p>café 🦊 <strong>/hea</strong></p>").unwrap();
    let caret = document.text_len() - 1;
    let query = detect_rich(&document, Selection::caret(caret)).unwrap();
    assert_eq!(query.query, "hea");
    assert_eq!(document.text_in_range(query.range.clone()).unwrap(), "/hea");
    assert!(detect_rich(&document, Selection::new(caret - 1, caret)).is_none());
    for html in [
        "<p>x<br>/hea</p>",
        "<p><span data-type=\"inline-math\" data-latex=\"x\"></span>/hea</p>",
    ] {
        let document = RichDocument::from_html(html).unwrap();
        assert!(
            detect_rich(&document, Selection::caret(document.text_len() - 1)).is_none(),
            "{html}"
        );
    }
}

fn markdown_insert(
    text: &str,
    needle: &str,
    id: &str,
    values: &Parameters,
) -> (String, std::ops::Range<usize>) {
    let start = text.find(needle).unwrap();
    let query = SlashQuery {
        query: needle[1..].into(),
        range: start..start + needle.len(),
    };
    let edit = markdown::plan(text, &query, id, values).unwrap();
    let mut result = text.to_owned();
    result.replace_range(edit.range, &edit.text);
    assert!(
        result.is_char_boundary(edit.selection.start)
            && result.is_char_boundary(edit.selection.end)
    );
    assert!(edit.selection.end <= result.len());
    (result, edit.selection)
}

#[test]
fn markdown_heading_retains_unicode_suffix_and_other_lines() {
    let text = "Before  \r\n- café 🦊 /h2 after\r\nUntouched.  ";
    let (after, caret) = markdown_insert(text, "/h2", "paragraph.heading-2", &Parameters::None);
    assert_eq!(after, "Before  \r\n## café 🦊  after\r\nUntouched.  ");
    assert_eq!(&after[..caret.start], "Before  \r\n## café 🦊 ");
}

#[test]
fn markdown_inputs_are_real_content_and_notes_have_unique_references() {
    let values = Parameters::Link {
        text: "the [paper] 🦊".into(),
        href: "https://example.test/a b?q=1".into(),
    };
    let (after, _) = markdown_insert("café /link suffix", "/link", "insert.link", &values);
    assert_eq!(
        after,
        "café [the \\[paper\\] 🦊](<https://example.test/a b?q=1>) suffix"
    );
    let (note, _) = markdown_insert(
        "/note\n\n[^footnote-1]: existing",
        "/note",
        "insert.footnote",
        &Parameters::Text("New note.\nContinuation.".into()),
    );
    assert!(note.starts_with("[^footnote-2]"));
    assert!(note.ends_with("[^footnote-2]: New note.\n    Continuation.\n"));
    for (id, values) in [
        (
            "insert.table",
            Parameters::Table {
                rows: 3,
                columns: 2,
                header: true,
            },
        ),
        (
            "insert.image",
            Parameters::Image {
                src: "https://example.test/p.png".into(),
                alt: "A plate".into(),
            },
        ),
        (
            "insert.mermaid",
            Parameters::Text("flowchart TD\n A --> B".into()),
        ),
        ("insert.math-block", Parameters::Text("x^2".into())),
        ("insert.math-inline", Parameters::Text("α + β".into())),
        ("paragraph.code-block", Parameters::None),
    ] {
        let (after, _) = markdown_insert("before\n\n/\n\nafter", "/", id, &values);
        assert!(
            after.starts_with("before\n\n") && after.ends_with("\n\nafter"),
            "{id}: {after}"
        );
    }
}

#[test]
fn markdown_suffix_markers_and_fences_preserve_authored_content() {
    let (heading, _) = markdown_insert(
        "/heading - item",
        "/heading",
        "paragraph.heading-1",
        &Parameters::None,
    );
    assert_eq!(heading, "#  - item");
    let (code, _) = markdown_insert(
        "/code ````",
        "/code",
        "paragraph.code-block",
        &Parameters::None,
    );
    assert_eq!(code, "`````\n ````\n`````");
    let (diagram, _) = markdown_insert(
        "/diagram",
        "/diagram",
        "insert.mermaid",
        &Parameters::Text("graph TD\n```\nA --> B".into()),
    );
    assert!(diagram.starts_with("````mermaid\ngraph TD\n```\nA --> B\n````"));
    let (math, _) = markdown_insert(
        "/math",
        "/math",
        "insert.math-inline",
        &Parameters::Text("x$y".into()),
    );
    let parsed = RichDocument::from_html(&format!("<p>{math}</p>")).unwrap();
    assert_eq!(parsed.to_html().matches("data-latex=\"x$y\"").count(), 1);
    // Source permits a caret inside a token: only the text before that caret
    // is the query. The host binds revision/selection, not a token end guess.
    let (inline, _) = markdown_insert(
        "/hello",
        "/he",
        "insert.link",
        &Parameters::Link {
            text: "paper".into(),
            href: "https://example.test".into(),
        },
    );
    assert!(inline.ends_with(")llo"));
}

#[test]
fn every_command_is_atomic_in_rich_history_and_preserves_other_content() {
    for command in commands() {
        let values = match command.id.as_str() {
            "insert.table" => Parameters::Table {
                rows: 3,
                columns: 3,
                header: true,
            },
            "insert.image" => Parameters::Image {
                src: "https://example.test/p.png".into(),
                alt: "A plate".into(),
            },
            "insert.link" => Parameters::Link {
                text: "A paper 🦊".into(),
                href: "https://example.test/p".into(),
            },
            "insert.mermaid" => Parameters::Text("flowchart TD\n A --> B".into()),
            "insert.math-inline" | "insert.math-block" => Parameters::Text("x^2 + α".into()),
            "insert.endnote" | "insert.footnote" => Parameters::Text("café 🦊 exact note".into()),
            _ => Parameters::None,
        };
        let before =
            RichDocument::from_html("<p>Before.</p><p>café 🦊 /</p><p>After.</p>").unwrap();
        let caret = before
            .editing_text()
            .chars()
            .position(|c| c == '/')
            .unwrap()
            + 1;
        let mut editor = RichEditor::new(before.clone());
        editor.set_selection(Selection::caret(caret)).unwrap();
        let query = detect_rich(editor.document(), editor.selection()).unwrap();
        rich::apply(&mut editor, &query, 0, &command.id, &values).unwrap();
        assert!(
            !editor.document().editing_text().contains('/'),
            "{}",
            command.id
        );
        assert!(
            editor.document().plain_text().contains("Before.")
                && editor.document().plain_text().contains("After.")
        );
        let inserted = editor.document().clone();
        editor.execute(Command::Undo).unwrap();
        assert_eq!(editor.document(), &before, "{}", command.id);
        assert_eq!(
            editor.selection(),
            Selection::caret(caret),
            "{}",
            command.id
        );
        editor.execute(Command::Redo).unwrap();
        assert_eq!(editor.document(), &inserted, "{}", command.id);
    }
}

#[test]
fn stale_readonly_or_invalid_insertions_never_delete_the_query() {
    let mut editor = RichEditor::new(RichDocument::from_html("<p>/table</p>").unwrap());
    editor.set_selection(Selection::caret(6)).unwrap();
    let query = detect_rich(editor.document(), editor.selection()).unwrap();
    let before = editor.document().clone();
    for (id, values, revision) in [
        (
            "insert.table",
            Parameters::Table {
                rows: 0,
                columns: 3,
                header: true,
            },
            0,
        ),
        (
            "insert.table",
            Parameters::Table {
                rows: 3,
                columns: 3,
                header: true,
            },
            1,
        ),
        ("history.undo", Parameters::None, 0),
    ] {
        assert!(rich::apply(&mut editor, &query, revision, id, &values).is_err());
        assert_eq!(editor.document(), &before);
        assert!(!editor.can_undo());
    }
    editor.set_read_only(true);
    assert!(
        rich::apply(
            &mut editor,
            &query,
            0,
            "insert.table",
            &Parameters::Table {
                rows: 3,
                columns: 3,
                header: true
            }
        )
        .is_err()
    );
    assert_eq!(editor.document(), &before);
    let invalid = SlashQuery {
        query: "".into(),
        range: 1..2,
    };
    assert!(markdown::plan("🦊 /", &invalid, "paragraph.heading-1", &Parameters::None).is_err());
}
