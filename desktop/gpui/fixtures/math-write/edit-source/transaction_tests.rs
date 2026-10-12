use super::*;
use crate::editor::{HTML_LIMITS, HtmlAttribute, MathDisplay, NodeData};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceState {
    html: String,
    native_utf16_selection: SourceSelection,
    native_utf16_length: usize,
}

#[derive(Deserialize)]
struct SourceCase {
    name: String,
    raw: String,
    before: SourceState,
    after: SourceState,
    undone: SourceState,
    redone: SourceState,
}

#[derive(Deserialize)]
struct SourceCases {
    cases: Vec<SourceCase>,
}

#[derive(Deserialize)]
struct SourceSelection {
    anchor: usize,
    head: usize,
}

fn source_cases() -> Vec<SourceCase> {
    serde_json::from_str::<SourceCases>(include_str!("source-reference.json"))
        .expect("executed original MathExtensions receipts")
        .cases
}

fn native_selection(document: &RichDocument, selection: &SourceSelection) -> Selection {
    Selection::new(
        document.utf16_to_scalar(selection.anchor).unwrap(),
        document.utf16_to_scalar(selection.head).unwrap(),
    )
}

fn first_math(document: &RichDocument) -> (NodePath, Node) {
    fn visit(nodes: &[Node], path: &mut NodePath) -> Option<(NodePath, Node)> {
        for (index, node) in nodes.iter().enumerate() {
            path.push(index);
            if let Some(element) = node.as_element() {
                if matches!(element.kind, NodeKind::Math(_)) {
                    return Some((path.clone(), node.clone()));
                }
                if let Some(found) = visit(&element.children, path) {
                    return Some(found);
                }
            }
            path.pop();
        }
        None
    }
    visit(document.nodes(), &mut Vec::new()).expect("actual math fixture")
}

type EntrySnapshot = (
    RichDocument,
    Selection,
    Option<Vec<Mark>>,
    Option<EditDelta>,
);

#[derive(Debug, PartialEq)]
struct Snapshot {
    document: RichDocument,
    selection: Selection,
    stored_marks: Option<Vec<Mark>>,
    revision: u64,
    read_only: bool,
    undo: Vec<EntrySnapshot>,
    redo: Vec<EntrySnapshot>,
    group_depth: usize,
    group_recorded: bool,
    group_before: Option<EntrySnapshot>,
}

fn snapshot(editor: &RichEditor) -> Snapshot {
    let entry = |entry: &HistoryEntry| {
        (
            entry.document.clone(),
            entry.selection,
            entry.stored_marks.clone(),
            entry.edit_delta,
        )
    };
    Snapshot {
        document: editor.document.clone(),
        selection: editor.selection,
        stored_marks: editor.stored_marks.clone(),
        revision: editor.revision,
        read_only: editor.read_only,
        undo: editor.undo.iter().map(entry).collect(),
        redo: editor.redo.iter().map(entry).collect(),
        group_depth: editor.history_group_depth,
        group_recorded: editor.history_group_recorded,
        group_before: editor.history_group_before.as_ref().map(entry),
    }
}

fn assert_payload(node: &Node, raw: &str) {
    let element = node.as_element().unwrap();
    assert_eq!(element.shell.attr("data-latex"), Some(raw));
    let content = element
        .children
        .iter()
        .map(|child| child.as_text().expect("raw source, never renderer DOM"))
        .collect::<String>();
    assert_eq!(content, raw);
    assert!(element.children.len() <= 1);
}

#[test]
fn original_source_raw_payload_selection_and_single_commit_undo_redo() {
    let cases = source_cases();
    assert_eq!(cases.len(), 9);
    for case in cases {
        let document = RichDocument::from_html(&case.before.html).unwrap();
        let mut editor = RichEditor::new(document.clone());
        let selection = native_selection(&document, &case.before.native_utf16_selection);
        editor.set_selection(selection).unwrap();
        let (path, expected) = first_math(&document);
        let old_length = document.text_len();
        assert_eq!(document.text_len_utf16(), case.before.native_utf16_length);
        let outcome = editor
            .execute(Command::UpdateMathSource {
                path: path.clone(),
                expected: expected.clone(),
                source: case.raw.clone(),
            })
            .unwrap();
        assert!(outcome.document_changed, "{}", case.name);
        assert!(outcome.history_changed, "{}", case.name);
        assert_eq!(outcome.edit_delta, None, "source is not prose input");
        assert_eq!(
            editor.document().to_html(),
            case.after.html,
            "{}",
            case.name
        );
        assert_eq!(editor.document().text_len(), old_length);
        assert_eq!(
            editor.document().text_len_utf16(),
            case.after.native_utf16_length
        );
        assert_eq!(
            editor.selection(),
            native_selection(editor.document(), &case.after.native_utf16_selection),
            "{}",
            case.name
        );
        assert_payload(editor.document().node(&path).unwrap(), &case.raw);
        assert_eq!(editor.undo.len(), 1);

        assert!(editor.execute(Command::Undo).unwrap().document_changed);
        assert_eq!(editor.document(), &document);
        assert_eq!(editor.document().to_html(), case.undone.html);
        assert_eq!(editor.selection(), selection);
        assert_eq!(
            editor.selection(),
            native_selection(editor.document(), &case.undone.native_utf16_selection)
        );
        assert!(
            editor
                .document()
                .node(&path)
                .unwrap()
                .shares_storage_with(&expected)
        );
        assert!(editor.undo.is_empty());
        assert_eq!(editor.redo.len(), 1);

        assert!(editor.execute(Command::Redo).unwrap().document_changed);
        assert_eq!(editor.document().to_html(), case.redone.html);
        assert_eq!(
            editor.selection(),
            native_selection(editor.document(), &case.redone.native_utf16_selection)
        );
        assert_payload(editor.document().node(&path).unwrap(), &case.raw);
        assert_eq!(editor.undo.len(), 1);
        editor.execute(Command::Undo).unwrap();
        assert_eq!(
            editor.execute(Command::Undo).unwrap(),
            CommandOutcome::default()
        );
        assert_eq!(editor.document(), &document);
    }
}

#[test]
fn math_edit_keeps_unknown_attributes_marks_neighbors_and_backward_undo_selection() {
    let document = RichDocument::from_html(
        "<p data-future-paragraph=\"keep\">A 🦊 <span data-future-mark=\"v2\" data-comment-id=\"writer-7\"><strong><span data-type=\"inline-math\" data-latex=\"x+1\" data-math-display=\"inline\" aria-label=\"Inline equation: x+1\" class=\"twyne-math twyne-math-inline extension-class\" style=\"color: #722f37; font-size: 23px;\" data-extension=\"{&quot;future&quot;:[null,7]}\" title=\"authored title\">x+1</span></strong></span> B é<sup data-type=\"endnote\" data-endnote-text=\"Keep note\"></sup></p><p>Untouched tail.</p>",
    )
    .unwrap();
    let (path, expected) = first_math(&document);
    let offset = document.offset_of_node(&path).unwrap();
    let backward = Selection::new(offset + 1, offset);
    let before_runs = document.block(&[0]).unwrap().runs;
    let wrappers = before_runs
        .iter()
        .find(|run| matches!(&run.content, RunContent::Object(node) if node.shares_storage_with(&expected)))
        .unwrap()
        .wrappers
        .clone();
    let future_attrs = |node: &Node| -> Vec<HtmlAttribute> {
        node.as_element()
            .unwrap()
            .shell
            .attributes
            .iter()
            .filter(|attribute| {
                !["data-type", "data-latex", "data-math-display", "aria-label"]
                    .contains(&attribute.name.as_str())
            })
            .cloned()
            .collect()
    };
    let attrs = future_attrs(&expected);
    let tail = document.node(&[1]).unwrap().clone();
    let mut editor = RichEditor::new(document.clone());
    editor.set_selection(backward).unwrap();
    let raw = "  \\text{A < B & \"C\" — 東京 🦊 é}\n ";
    editor
        .execute(Command::UpdateMathSource {
            path: path.clone(),
            expected,
            source: raw.into(),
        })
        .unwrap();
    let edited = editor.document().node(&path).unwrap();
    assert_payload(edited, raw);
    assert_eq!(future_attrs(edited), attrs);
    assert_eq!(editor.selection(), Selection::caret(offset));
    assert!(
        editor
            .document()
            .node(&[1])
            .unwrap()
            .shares_storage_with(&tail)
    );
    let after_runs = editor.document().block(&[0]).unwrap().runs;
    let math = after_runs
        .iter()
        .find(|run| matches!(&run.content, RunContent::Object(node) if node.shares_storage_with(edited)))
        .unwrap();
    assert_eq!(math.wrappers, wrappers);
    assert!(math.marks.contains(&Mark::Bold));
    let note_before = before_runs
        .iter()
        .find_map(|run| match &run.content {
            RunContent::Object(node)
                if node
                    .as_element()
                    .is_some_and(|element| matches!(element.kind, NodeKind::Note(_))) =>
            {
                Some(node)
            }
            _ => None,
        })
        .unwrap();
    let note_after = after_runs
        .iter()
        .find_map(|run| match &run.content {
            RunContent::Object(node)
                if node
                    .as_element()
                    .is_some_and(|element| matches!(element.kind, NodeKind::Note(_))) =>
            {
                Some(node)
            }
            _ => None,
        })
        .unwrap();
    assert!(note_after.shares_storage_with(note_before));
    let accepted = editor.document().clone();
    editor.execute(Command::Undo).unwrap();
    assert_eq!(editor.document(), &document);
    assert_eq!(editor.selection(), backward);
    editor.execute(Command::Redo).unwrap();
    assert_eq!(editor.document(), &accepted);
    assert_eq!(editor.selection(), Selection::caret(offset));
}

#[test]
fn stale_missing_non_math_and_read_only_reject_without_changing_history_or_pending_group() {
    let case = source_cases().remove(0);
    let document = RichDocument::from_html(&case.before.html).unwrap();
    let (path, original) = first_math(&document);
    let mut editor = RichEditor::new(document);
    editor
        .execute(Command::UpdateMathSource {
            path: path.clone(),
            expected: original.clone(),
            source: "y+2".into(),
        })
        .unwrap();
    let obsolete = editor.document().node(&path).unwrap().clone();
    editor.execute(Command::Undo).unwrap();
    editor.set_selection(Selection::caret(0)).unwrap();
    editor.execute(Command::SetMark(Mark::Italic)).unwrap();
    editor.begin_history_group();
    let before = snapshot(&editor);
    let detached_equal = match original.data() {
        NodeData::Element(element) => {
            Node::element(element.shell.clone(), element.children.clone())
        }
        _ => unreachable!(),
    };
    assert_eq!(detached_equal, original);
    assert!(!detached_equal.shares_storage_with(&original));
    let commands = [
        Command::UpdateMathSource {
            path: path.clone(),
            expected: obsolete,
            source: "stale".into(),
        },
        Command::UpdateMathSource {
            path: path.clone(),
            expected: detached_equal,
            source: "detached".into(),
        },
        Command::UpdateMathSource {
            path: vec![99],
            expected: original.clone(),
            source: "missing".into(),
        },
        Command::UpdateMathSource {
            path: vec![0],
            expected: editor.document().node(&[0]).unwrap().clone(),
            source: "not math".into(),
        },
    ];
    for command in commands {
        assert!(matches!(
            editor.execute(command),
            Err(EditorError::UnsupportedStructure(_))
        ));
        assert_eq!(snapshot(&editor), before);
    }
    editor.set_read_only(true);
    let locked = snapshot(&editor);
    assert_eq!(
        editor.execute(Command::UpdateMathSource {
            path,
            expected: original,
            source: "locked".into()
        }),
        Err(EditorError::ReadOnly)
    );
    assert_eq!(snapshot(&editor), locked);
}

#[test]
fn oversized_raw_source_refuses_before_document_selection_marks_history_or_revision() {
    let case = source_cases().remove(0);
    let document = RichDocument::from_html(&case.before.html).unwrap();
    let (path, expected) = first_math(&document);
    let mut editor = RichEditor::new(document);
    editor.set_selection(Selection::caret(0)).unwrap();
    editor.execute(Command::SetMark(Mark::Bold)).unwrap();
    editor.begin_history_group();
    let before = snapshot(&editor);
    let result = editor.execute(Command::UpdateMathSource {
        path,
        expected,
        source: "x".repeat(HTML_LIMITS.scalars + 1),
    });
    assert_eq!(result, Err(EditorError::HtmlTooMuchText));
    assert_eq!(snapshot(&editor), before);
}

#[test]
fn unchanged_raw_submit_is_history_neutral_and_unrelated_selection_stays_put() {
    let case = source_cases().remove(0);
    let document = RichDocument::from_html(&case.before.html).unwrap();
    let (path, expected) = first_math(&document);
    let mut editor = RichEditor::new(document.clone());
    let selected = Selection::new(document.text_len() - 1, document.text_len() - 4);
    editor.set_selection(selected).unwrap();
    let before = snapshot(&editor);
    assert_eq!(
        editor
            .execute(Command::UpdateMathSource {
                path,
                expected,
                source: "x+1".into()
            })
            .unwrap(),
        CommandOutcome::default()
    );
    assert_eq!(snapshot(&editor), before);
    assert!(!editor.can_undo());
}

#[test]
fn text_fallback_import_is_updated_consistently_without_retaining_old_render_children() {
    let document = RichDocument::from_html(
        "<p><span data-type=\"inline-math\" data-future=\"keep\" class=\"extension\"><span class=\"old-render\">old source</span></span></p>",
    )
    .unwrap();
    let (path, expected) = first_math(&document);
    let mut editor = RichEditor::new(document.clone());
    editor
        .execute(Command::UpdateMathSource {
            path: path.clone(),
            expected,
            source: "  z+3\n".into(),
        })
        .unwrap();
    let updated = editor.document().node(&path).unwrap();
    assert_payload(updated, "  z+3\n");
    let shell = &updated.as_element().unwrap().shell;
    assert_eq!(shell.attr("data-future"), Some("keep"));
    assert_eq!(shell.attr("class"), Some("extension"));
    assert_eq!(shell.attr("data-type"), Some("inline-math"));
    assert_eq!(shell.attr("data-math-display"), Some("inline"));
    assert_eq!(shell.attr("aria-label"), Some("Inline equation:   z+3\n"));
    assert!(!editor.document().to_html().contains("old-render"));
    editor.execute(Command::Undo).unwrap();
    assert_eq!(editor.document(), &document);
}

#[test]
fn math_source_commit_after_typing_is_separate_and_descriptor_survives_an_unrelated_block_edit() {
    let case = source_cases().remove(0);
    let mut document = RichDocument::from_html(&case.before.html).unwrap();
    let mut nodes = document.nodes().to_vec();
    nodes.push(Node::paragraph(vec![Node::text("Tail")]));
    document = RichDocument::new(nodes);
    let (path, expected) = first_math(&document);
    let mut editor = RichEditor::new(document.clone());
    let tail = editor.document().blocks().last().unwrap().range.end;
    editor.set_selection(Selection::caret(tail)).unwrap();
    editor.begin_history_group();
    editor.execute(Command::InsertText(" 🦊".into())).unwrap();
    editor.execute(Command::InsertText(" é".into())).unwrap();
    editor.end_history_group();
    assert!(
        editor
            .document()
            .node(&path)
            .unwrap()
            .shares_storage_with(&expected)
    );
    let before_commit = editor.document().clone();
    let selection = editor.selection();
    editor
        .execute(Command::UpdateMathSource {
            path,
            expected,
            source: "z+3\n".into(),
        })
        .unwrap();
    let accepted = editor.document().clone();
    assert_eq!(editor.selection(), selection);
    assert_eq!(editor.undo.len(), 2);
    editor.execute(Command::Undo).unwrap();
    assert_eq!(editor.document(), &before_commit);
    assert_eq!(editor.selection(), selection);
    editor.execute(Command::Undo).unwrap();
    assert_eq!(editor.document(), &document);
    editor.execute(Command::Redo).unwrap();
    assert_eq!(editor.document(), &before_commit);
    editor.execute(Command::Redo).unwrap();
    assert_eq!(editor.document(), &accepted);
}

#[test]
fn original_math_insert_ids_create_empty_atoms_without_changing_existing_intents() {
    let inline = Command::from_id("insert.math-inline").unwrap();
    assert_eq!(
        inline,
        Command::InsertInline(InlineObject::Math {
            source: String::new()
        })
    );
    let block = Command::from_id("insert.math-block").unwrap();
    assert_eq!(
        block,
        Command::InsertBlock(BlockObject::Math {
            source: String::new()
        })
    );
    assert_eq!(
        Command::from_id("insert.page-break"),
        Some(Command::InsertBlock(BlockObject::PageBreak))
    );
    assert_eq!(Command::from_id("history.undo"), Some(Command::Undo));
    assert_eq!(Command::from_id("insert.math"), None);
    for (command, display) in [(inline, MathDisplay::Inline), (block, MathDisplay::Block)] {
        let mut editor = RichEditor::new(RichDocument::from_html("<p>Before after</p>").unwrap());
        editor.set_selection(Selection::caret(7)).unwrap();
        let before = editor.document().clone();
        assert!(editor.execute(command).unwrap().document_changed);
        let (_, atom) = first_math(editor.document());
        assert_eq!(atom.as_element().unwrap().kind, NodeKind::Math(display));
        assert_payload(&atom, "");
        assert_eq!(
            atom.as_element().unwrap().shell.attr("aria-label"),
            Some(if display == MathDisplay::Inline {
                "Inline equation: empty"
            } else {
                "Block equation: empty"
            })
        );
        editor.execute(Command::Undo).unwrap();
        assert_eq!(editor.document(), &before);
    }
}
