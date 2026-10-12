//! Bounded citation-placement preparation. The original helper locates text;
//! this adapter supplies native UTF-16 leaf positions and prepares one footnote
//! at the confirmed target end. It never commits a live view or metadata.

use crate::{
    editor::{
        Command, InlineObject, Node, NodeData, NodeKind, NoteKind, RichDocument, RichEditor,
        Selection,
    },
    semantic_bridge::{CitationTextBlock, CitationTextChild, CitationUtf16Range, SemanticBridge},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::ops::Range;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CitationPlacementRequest {
    pub source_id: String,
    pub text: String,
    #[serde(default)]
    pub anchor: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub allow_selection_fallback: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CitationTargetOrigin {
    Anchor,
    SourceUrl,
    Selection,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CitationMissingReason {
    AnchorNotFound,
    SelectPassage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CitationMissing {
    pub source_id: String,
    pub reason: CitationMissingReason,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CitationTarget {
    pub origin: CitationTargetOrigin,
    pub range: Range<usize>,
    pub utf16_range: CitationUtf16Range,
}

#[derive(Clone, Debug)]
pub struct PreparedCitation {
    pub source_id: String,
    pub target: CitationTarget,
    pub selection_before: Selection,
    pub insert_at: Selection,
    pub command: Command,
    pub candidate: RichDocument,
    pub selection_after: Selection,
}

#[derive(Clone, Debug)]
pub enum CitationPreparation {
    Prepared(Box<PreparedCitation>),
    Missing(CitationMissing),
}

/// Traverse the current structured tree once. Mark wrappers flatten into text
/// leaves; atoms, hard breaks and non-content payloads are omitted while their
/// cached native projected UTF-16 lengths still advance offsets. The original
/// matcher joins those leaves within one text block, including its Source
/// behavior of matching across an omitted inline atom or hard break.
pub fn citation_text_blocks(document: &RichDocument) -> Result<Vec<CitationTextBlock>> {
    document.validate_html_limits()?;
    let mut blocks = Vec::new();
    let mut cursor = 0;
    collect_blocks(document.nodes(), &mut cursor, &mut blocks)?;
    Ok(blocks)
}

fn collect_blocks(
    nodes: &[Node],
    cursor: &mut usize,
    blocks: &mut Vec<CitationTextBlock>,
) -> Result<()> {
    for node in nodes {
        if let NodeData::Element(element) = node.data()
            && !element.kind.is_atom()
            && element.kind != NodeKind::NonContent
        {
            if element.is_text_block {
                let mut children = Vec::new();
                let mut local = 0;
                collect_text_children(&element.children, &mut local, &mut children)?;
                blocks.push(CitationTextBlock {
                    position: isize::try_from(*cursor)
                        .context("Citation text position is too large.")?
                        - 1,
                    children,
                });
            } else {
                let mut nested = *cursor;
                collect_blocks(&element.children, &mut nested, blocks)?;
            }
        }
        *cursor += node.projection_len_utf16();
    }
    Ok(())
}

fn collect_text_children(
    nodes: &[Node],
    cursor: &mut usize,
    children: &mut Vec<CitationTextChild>,
) -> Result<()> {
    for node in nodes {
        match node.data() {
            NodeData::Text(text) if !text.is_empty() => children.push(CitationTextChild {
                offset: *cursor,
                text: text.to_string(),
            }),
            NodeData::Element(element)
                if !element.kind.is_atom()
                    && element.kind != NodeKind::NonContent
                    && element.kind != NodeKind::HardBreak =>
            {
                ensure!(
                    !element.is_text_block && !element.kind.is_block(),
                    "The retained nested text-block structure cannot be matched safely for citation placement."
                );
                let mut nested = *cursor;
                collect_text_children(&element.children, &mut nested, children)?;
            }
            _ => {}
        }
        *cursor += node.projection_len_utf16();
    }
    Ok(())
}

/// An explicit background/open boundary, never an ordinary typing operation.
/// Root must guard folio/entity/revision/selection/read-only and canonical
/// conversion before committing the prepared command at its target end.
pub fn prepare_citation(
    document: &RichDocument,
    selection: Selection,
    request: &CitationPlacementRequest,
    bridge: &SemanticBridge,
) -> Result<CitationPreparation> {
    prepare_with_matcher(document, selection, request, |quote, blocks| {
        Ok(bridge.citation_find_range(quote, blocks)?.range)
    })
}

fn prepare_with_matcher(
    document: &RichDocument,
    selection: Selection,
    request: &CitationPlacementRequest,
    mut matcher: impl FnMut(&str, &[CitationTextBlock]) -> Result<Option<CitationUtf16Range>>,
) -> Result<CitationPreparation> {
    ensure!(
        !request.source_id.is_empty() && !request.text.is_empty(),
        "A citation needs its source ID and footnote text."
    );
    ensure!(
        selection.anchor <= document.text_len() && selection.head <= document.text_len(),
        "The selected passage is outside the current document."
    );
    let blocks = citation_text_blocks(document)?;
    let mut matched = None;
    if let Some(anchor) = request.anchor.as_deref().filter(|value| !value.is_empty()) {
        matched = matcher(anchor, &blocks)?.map(|range| (CitationTargetOrigin::Anchor, range));
    }
    if matched.is_none()
        && let Some(url) = request
            .source_url
            .as_deref()
            .filter(|value| !value.is_empty())
    {
        matched = matcher(url, &blocks)?.map(|range| (CitationTargetOrigin::SourceUrl, range));
    }
    let target = if let Some((origin, utf16_range)) = matched {
        ensure!(
            utf16_range.from < utf16_range.to,
            "The original citation matcher returned an empty or reversed range."
        );
        let from = document
            .utf16_to_scalar(utf16_range.from)
            .context("The citation start is not a valid native Unicode boundary.")?;
        let to = document
            .utf16_to_scalar(utf16_range.to)
            .context("The citation end is not a valid native Unicode boundary.")?;
        CitationTarget {
            origin,
            range: from..to,
            utf16_range,
        }
    } else if request.allow_selection_fallback && !selection.is_empty() {
        let range = selection.range();
        let utf16_range = CitationUtf16Range {
            from: document
                .scalar_to_utf16(range.start)
                .context("The selected passage has an invalid start.")?,
            to: document
                .scalar_to_utf16(range.end)
                .context("The selected passage has an invalid end.")?,
        };
        CitationTarget {
            origin: CitationTargetOrigin::Selection,
            range,
            utf16_range,
        }
    } else {
        return Ok(CitationPreparation::Missing(CitationMissing {
            source_id: request.source_id.clone(),
            reason: if request
                .anchor
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            {
                CitationMissingReason::AnchorNotFound
            } else {
                CitationMissingReason::SelectPassage
            },
        }));
    };
    let insert_at = Selection::caret(target.range.end);
    // Source's schema lifts an inline note out of a code block into paragraph
    // structure. The generic native inline command does not yet perform that
    // split. Refuse before candidate/history mutation instead of creating a
    // source atom inside authored code.
    ensure!(
        document
            .block_at_offset(insert_at.head)
            .is_none_or(|block| block.kind != NodeKind::CodeBlock),
        "Citation placement in a code block needs Source-compatible paragraph splitting. The draft was kept."
    );
    let command = Command::InsertInline(InlineObject::Note {
        kind: NoteKind::Footnote,
        text: request.text.clone(),
    });
    // A disposable core editor proves the actual command and HTML/resource
    // bounds. Its history never replaces the live editor's accepted history.
    let mut candidate = RichEditor::new(document.clone());
    candidate.set_selection(selection)?;
    candidate.begin_history_group();
    candidate.set_selection(insert_at)?;
    let outcome = candidate.execute(command.clone())?;
    candidate.end_history_group();
    ensure!(
        outcome.document_changed,
        "The footnote command did not change the current document."
    );
    Ok(CitationPreparation::Prepared(Box::new(PreparedCitation {
        source_id: request.source_id.clone(),
        target,
        selection_before: selection,
        insert_at,
        command,
        candidate: candidate.document().clone(),
        selection_after: candidate.selection(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{EditorError, ElementShell, MathDisplay};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    fn bridge() -> &'static SemanticBridge {
        static BRIDGE: OnceLock<SemanticBridge> = OnceLock::new();
        BRIDGE.get_or_init(|| {
            SemanticBridge::discover().expect(
                "Build the real document helper before these executable Source anchor checks.",
            )
        })
    }
    fn reference() -> Value {
        serde_json::from_slice(include_bytes!(
            "../fixtures/citation-anchor/source-reference.json"
        ))
        .unwrap()
    }
    fn detail(anchor: Option<&str>) -> CitationPlacementRequest {
        CitationPlacementRequest {
            source_id: "fixture-source-id".into(),
            text: "A & \"B\" — 東京 🦊".into(),
            anchor: anchor.map(str::to_string),
            source_url: None,
            allow_selection_fallback: false,
        }
    }
    fn prepared(outcome: CitationPreparation) -> PreparedCitation {
        match outcome {
            CitationPreparation::Prepared(prepared) => *prepared,
            CitationPreparation::Missing(missing) => {
                panic!("Expected a confirmed target: {missing:?}")
            }
        }
    }
    fn missing(outcome: CitationPreparation) -> CitationMissing {
        match outcome {
            CitationPreparation::Missing(missing) => missing,
            CitationPreparation::Prepared(prepared) => {
                panic!("Expected a missing target: {:?}", prepared.target)
            }
        }
    }
    fn range_json(range: Option<CitationUtf16Range>) -> Value {
        range
            .map(|range| json!({"from":range.from,"to":range.to}))
            .unwrap_or(Value::Null)
    }
    // Attribute order of a newly authored note is not semantic HTML. All
    // preexisting nodes/attrs retain exact original order and are compared.
    fn normalize_new_note_attributes(document: &RichDocument, text: &str) -> RichDocument {
        fn normalize(node: &Node, text: &str) -> Node {
            let NodeData::Element(element) = node.data() else {
                return node.clone();
            };
            let mut shell = element.shell.clone();
            if element.kind == NodeKind::Note(NoteKind::Footnote)
                && shell.attr("data-endnote-text") == Some(text)
            {
                shell
                    .attributes
                    .sort_by(|left, right| left.name.cmp(&right.name));
            }
            Node::element(
                shell,
                element
                    .children
                    .iter()
                    .map(|node| normalize(node, text))
                    .collect(),
            )
        }
        RichDocument::new(
            document
                .nodes()
                .iter()
                .map(|node| normalize(node, text))
                .collect(),
        )
    }

    #[test]
    fn adapter_and_actual_helper_match_original_pm_marks_unicode_whitespace_gaps_and_order() {
        let source = reference();
        let mut probes = 0;
        for case in source["cases"].as_array().unwrap() {
            let document = RichDocument::from_html(case["html"].as_str().unwrap()).unwrap();
            let blocks = citation_text_blocks(&document).unwrap();
            assert_eq!(
                serde_json::to_value(&blocks).unwrap(),
                case["blocks"],
                "{}",
                case["name"]
            );
            assert_eq!(
                document.text_len_utf16(),
                case["lengthUtf16"].as_u64().unwrap() as usize
            );
            for probe in case["matches"].as_array().unwrap() {
                let found = bridge()
                    .citation_find_range(probe["quote"].as_str().unwrap(), &blocks)
                    .unwrap();
                assert_eq!(
                    range_json(found.range),
                    probe["nativeUtf16Range"],
                    "{} / {}",
                    case["name"],
                    probe["quote"]
                );
                probes += 1;
            }
        }
        assert_eq!(probes, 32);
    }

    #[test]
    fn actual_source_footnote_candidates_preserve_prose_marks_atoms_and_exact_note_attributes() {
        let source = reference();
        for case in source["cases"].as_array().unwrap() {
            let note = &case["footnote"];
            let document = RichDocument::from_html(case["html"].as_str().unwrap()).unwrap();
            let before = document.to_html();
            let insertion = prepared(
                prepare_citation(
                    &document,
                    Selection::new(3, 1),
                    &detail(note["quote"].as_str()),
                    bridge(),
                )
                .unwrap(),
            );
            assert_eq!(document.to_html(), before); // No live mutation.
            assert_eq!(insertion.target.origin, CitationTargetOrigin::Anchor);
            assert_eq!(
                insertion.target.utf16_range.from,
                note["from"].as_u64().unwrap() as usize
            );
            assert_eq!(
                insertion.target.utf16_range.to,
                note["to"].as_u64().unwrap() as usize
            );
            assert_eq!(insertion.candidate.text_len(), document.text_len() + 1);
            assert_eq!(
                insertion.selection_after,
                Selection::caret(insertion.target.range.end + 1)
            );
            let mut source_candidate =
                RichDocument::from_html(note["html"].as_str().unwrap()).unwrap();
            if case["name"] == "container order and nested cell" {
                // Actual StarterKit adds an empty trailing paragraph after a
                // table on transaction. This preparation intentionally changes
                // only the note; that broader schema normalization is pending.
                assert_eq!(source_candidate.nodes().len(), document.nodes().len() + 1);
                assert_eq!(
                    source_candidate.nodes().last().unwrap(),
                    &Node::paragraph(Vec::new())
                );
                source_candidate = RichDocument::new(
                    source_candidate.nodes()[..source_candidate.nodes().len() - 1].to_vec(),
                );
            }
            assert_eq!(
                normalize_new_note_attributes(&insertion.candidate, &insertion_text()),
                normalize_new_note_attributes(&source_candidate, &insertion_text()),
                "{}",
                case["name"]
            );
            let html = insertion.candidate.to_html();
            assert!(!html.contains("fixture-source-id"));
            assert!(!html.contains("data-source-id") && !html.contains("citationKey"));
        }
    }
    fn insertion_text() -> String {
        detail(None).text
    }

    #[test]
    fn anchor_precedes_url_then_only_explicit_nonempty_selection_can_fallback() {
        let document = RichDocument::from_html(
            "<p>https://example.invalid/item first. Anchor 🦊 passage later.</p>",
        )
        .unwrap();
        let selection = Selection::new(6, 2);
        let mut request = detail(Some("Anchor 🦊 passage"));
        request.source_url = Some("https://example.invalid/item".into());
        request.allow_selection_fallback = true;
        let anchor = prepared(prepare_citation(&document, selection, &request, bridge()).unwrap());
        assert_eq!(anchor.target.origin, CitationTargetOrigin::Anchor);
        assert_eq!(
            document.text_in_range(anchor.target.range).unwrap(),
            "Anchor 🦊 passage"
        );
        request.anchor = Some("absent quote".into());
        let url = prepared(prepare_citation(&document, selection, &request, bridge()).unwrap());
        assert_eq!(url.target.origin, CitationTargetOrigin::SourceUrl);
        assert_eq!(
            document.text_in_range(url.target.range).unwrap(),
            "https://example.invalid/item"
        );
        request.source_url = Some("https://different.invalid/absent".into());
        let fallback =
            prepared(prepare_citation(&document, selection, &request, bridge()).unwrap());
        assert_eq!(fallback.target.origin, CitationTargetOrigin::Selection);
        assert_eq!(fallback.target.range, 2..6);
        assert_eq!(fallback.insert_at, Selection::caret(6)); // Ordered end, never backward head.
        request.allow_selection_fallback = false;
        assert_eq!(
            missing(prepare_citation(&document, selection, &request, bridge()).unwrap()).reason,
            CitationMissingReason::AnchorNotFound
        );
        request.allow_selection_fallback = true;
        assert_eq!(
            missing(prepare_citation(&document, Selection::caret(6), &request, bridge()).unwrap())
                .reason,
            CitationMissingReason::AnchorNotFound
        );
    }

    #[test]
    fn source_truthiness_distinguishes_absent_empty_and_whitespace_only_anchor() {
        let document = RichDocument::from_plain_text("A real passage.");
        for (anchor, reason) in [
            (None, CitationMissingReason::SelectPassage),
            (Some(""), CitationMissingReason::SelectPassage),
            (
                Some("\u{a0}\u{feff}\t "),
                CitationMissingReason::AnchorNotFound,
            ),
        ] {
            let request = detail(anchor);
            let outcome = missing(
                prepare_citation(&document, Selection::caret(0), &request, bridge()).unwrap(),
            );
            assert_eq!(outcome.reason, reason);
            assert_eq!(outcome.source_id, request.source_id);
            assert_eq!(
                serde_json::to_value(reason).unwrap(),
                if reason == CitationMissingReason::AnchorNotFound {
                    json!("anchor-not-found")
                } else {
                    json!("select-passage")
                }
            );
        }
        let mut request = detail(None);
        request.text = " ".into(); // Source accepts any nonempty footnote text.
        request.allow_selection_fallback = true;
        assert!(matches!(
            prepare_citation(&document, Selection::new(0, 1), &request, bridge()).unwrap(),
            CitationPreparation::Prepared(_)
        ));
        for field in ["source", "text"] {
            let mut invalid = detail(Some("passage"));
            if field == "source" {
                invalid.source_id.clear();
            } else {
                invalid.text.clear();
            }
            assert!(prepare_citation(&document, Selection::caret(0), &invalid, bridge()).is_err());
        }
    }

    #[test]
    fn confirmed_utf16_ranges_keep_native_scalars_and_reject_invalid_boundaries_without_guessing() {
        let document =
            RichDocument::from_html("<p>Before <strong>🦊 é</strong> after.</p>").unwrap();
        let insertion = prepared(
            prepare_citation(
                &document,
                Selection::caret(0),
                &detail(Some("🦊 é")),
                bridge(),
            )
            .unwrap(),
        );
        assert_eq!(insertion.target.range, 7..11);
        assert_eq!(
            insertion.target.utf16_range,
            CitationUtf16Range { from: 7, to: 12 }
        );
        assert_eq!(
            document.text_in_range(insertion.target.range).unwrap(),
            "🦊 é"
        );
        for invalid in [
            CitationUtf16Range { from: 8, to: 12 },
            CitationUtf16Range { from: 7, to: 8 },
            CitationUtf16Range { from: 0, to: 0 },
            CitationUtf16Range { from: 4, to: 2 },
            CitationUtf16Range {
                from: 0,
                to: document.text_len_utf16() + 1,
            },
        ] {
            assert!(
                prepare_with_matcher(
                    &document,
                    Selection::caret(0),
                    &detail(Some("present")),
                    |_, _| Ok(Some(invalid.clone()))
                )
                .is_err()
            );
        }
        assert!(
            prepare_citation(
                &document,
                Selection::new(0, document.text_len() + 1),
                &detail(None),
                bridge()
            )
            .is_err()
        );
    }

    #[test]
    fn note_command_has_one_undo_restoring_exact_tree_and_original_backward_selection() {
        let document = RichDocument::from_html("<p data-future=\"keep\" style=\"line-height: 1.7;\"><span data-comment-id=\"writer\" data-unknown=\"opaque\"><strong>Support 🦊 é</strong></span> remains.</p><p>Untouched.</p>").unwrap();
        let selection = Selection::new(5, 1);
        let insertion = prepared(
            prepare_citation(
                &document,
                selection,
                &detail(Some("Support 🦊 é")),
                bridge(),
            )
            .unwrap(),
        );
        let mut candidate = RichEditor::new(document.clone());
        candidate.set_selection(selection).unwrap();
        candidate.begin_history_group();
        candidate.set_selection(insertion.insert_at).unwrap();
        let outcome = candidate.execute(insertion.command.clone()).unwrap();
        candidate.end_history_group();
        assert!(outcome.document_changed && outcome.history_changed);
        assert_eq!(candidate.document(), &insertion.candidate);
        assert_eq!(candidate.selection(), insertion.selection_after);
        assert!(candidate.document().nodes()[1].shares_storage_with(&document.nodes()[1]));
        assert_eq!(
            candidate.document().nodes()[0].as_element().unwrap().shell,
            document.nodes()[0].as_element().unwrap().shell
        );
        assert!(candidate.execute(Command::Undo).unwrap().document_changed);
        assert_eq!(candidate.document(), &document);
        assert_eq!(candidate.selection(), selection);
        assert!(!candidate.can_undo());
        assert!(candidate.execute(Command::Redo).unwrap().document_changed);
        assert_eq!(candidate.document(), &insertion.candidate);
        candidate.set_read_only(true);
        let before = candidate.document().clone();
        assert_eq!(
            candidate.execute(insertion.command).unwrap_err(),
            EditorError::ReadOnly
        );
        assert_eq!(candidate.document(), &before);
    }

    #[test]
    fn unmarked_note_does_not_extend_comments_and_other_inline_objects_keep_context() {
        let document = RichDocument::from_html("<p><span data-comment-id=\"writer\" data-future=\"opaque\"><strong>support</strong></span> remains.</p>").unwrap();
        for object in [
            InlineObject::Note {
                kind: NoteKind::Footnote,
                text: "Source note".into(),
            },
            InlineObject::Note {
                kind: NoteKind::Endnote,
                text: "Source note".into(),
            },
            InlineObject::Math {
                source: "x^2".into(),
            },
            InlineObject::RawTypst {
                source: "#custom()".into(),
            },
        ] {
            let mut editor = RichEditor::new(document.clone());
            editor.set_selection(Selection::caret(7)).unwrap();
            editor
                .execute(Command::InsertInline(object.clone()))
                .unwrap();
            let inserted = editor
                .document()
                .block_at_offset(7)
                .unwrap()
                .runs
                .into_iter()
                .find(|run| run.range == (7..8))
                .unwrap();
            if matches!(object, InlineObject::Note { .. }) {
                assert!(inserted.marks.is_empty());
                assert!(inserted.wrappers.is_empty());
                assert_eq!(
                    editor.document().comment_ranges(),
                    document.comment_ranges()
                );
            } else {
                assert!(inserted.marks.contains(&crate::editor::Mark::Bold));
                assert!(
                    inserted
                        .wrappers
                        .iter()
                        .any(|shell| shell.attr("data-comment-id") == Some("writer"))
                );
                let kind = match object {
                    InlineObject::Math { .. } => NodeKind::Math(MathDisplay::Inline),
                    _ => NodeKind::RawTypst(MathDisplay::Inline),
                };
                assert!(
                    matches!(&inserted.content,crate::editor::RunContent::Object(node) if node.as_element().unwrap().kind==kind)
                );
            }
        }
    }

    #[test]
    fn nested_block_corruption_and_noncontent_atom_payloads_cannot_invent_a_match() {
        let nested = RichDocument::new(vec![Node::paragraph(vec![
            Node::text("before"),
            Node::element(
                ElementShell::html("span"),
                vec![Node::paragraph(vec![Node::text("nested")])],
            ),
            Node::text("after"),
        ])]);
        assert!(citation_text_blocks(&nested).is_err());
        let document = RichDocument::from_html("<script>hidden-script</script><p>visible<span data-type=\"raw-typst-inline\" data-typst-source=\"hidden-source\">hidden-payload</span><br>passage</p>").unwrap();
        let blocks = citation_text_blocks(&document).unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].children[0].text, "visible");
        assert_eq!(blocks[0].children[1].offset, 9);
        assert_eq!(blocks[0].children[1].text, "passage");
        for quote in [
            "hidden-script",
            "hidden-source",
            "hidden-payload",
            "visible passage",
        ] {
            assert!(
                bridge()
                    .citation_find_range(quote, &blocks)
                    .unwrap()
                    .range
                    .is_none()
            );
        }
        let target = bridge()
            .citation_find_range("visiblepassage", &blocks)
            .unwrap()
            .range
            .unwrap();
        assert_eq!(target, CitationUtf16Range { from: 0, to: 16 });
    }

    #[test]
    fn original_code_block_placement_is_reported_as_pending_without_creating_an_inline_code_atom() {
        let source: Value = serde_json::from_slice(include_bytes!(
            "../fixtures/citation-anchor/source-command-edges.json"
        ))
        .unwrap();
        let case = &source["cases"][0];
        assert_eq!(case["inserted"], true);
        assert!(case["after"].as_str().unwrap().contains("</pre><p><sup"));
        let document = RichDocument::from_html(case["before"].as_str().unwrap()).unwrap();
        let before = document.clone();
        let error = prepare_citation(
            &document,
            Selection::caret(0),
            &detail(Some("Supporting code passage.")),
            bridge(),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("Source-compatible paragraph splitting")
        );
        assert_eq!(document, before);
    }

    #[test]
    fn note_clears_same_caret_stored_marks_for_source_after_typing_and_undo_preserves_prior_state()
    {
        let source: Value = serde_json::from_slice(include_bytes!(
            "../fixtures/citation-anchor/source-command-edges.json"
        ))
        .unwrap();
        let case = &source["cases"][1];
        assert_eq!(case["marksBefore"], json!(["bold"]));
        assert_eq!(case["marksAfter"], Value::Null);
        let document = RichDocument::from_html(case["before"].as_str().unwrap()).unwrap();
        let original_selection = Selection::caret(document.text_len() - 1);
        let mut editor = RichEditor::new(document.clone());
        editor.set_selection(original_selection).unwrap();
        editor
            .execute(Command::SetMark(crate::editor::Mark::Bold))
            .unwrap();
        assert_eq!(editor.active_marks(), vec![crate::editor::Mark::Bold]);
        editor.begin_history_group();
        editor.set_selection(original_selection).unwrap(); // Same caret keeps stored marks until the note command.
        editor
            .execute(Command::InsertInline(InlineObject::Note {
                kind: NoteKind::Footnote,
                text: "Source edge note".into(),
            }))
            .unwrap();
        editor.end_history_group();
        assert!(editor.active_marks().is_empty());
        let note_only = editor.document().clone();
        let source_note = RichDocument::from_html(case["after"].as_str().unwrap()).unwrap();
        assert_eq!(
            normalize_new_note_attributes(&note_only, "Source edge note"),
            normalize_new_note_attributes(&source_note, "Source edge note")
        );
        editor.execute(Command::InsertText("X".into())).unwrap();
        let source_typed = RichDocument::from_html(case["afterTyping"].as_str().unwrap()).unwrap();
        assert_eq!(
            normalize_new_note_attributes(editor.document(), "Source edge note"),
            normalize_new_note_attributes(&source_typed, "Source edge note")
        );
        editor.execute(Command::Undo).unwrap();
        assert_eq!(editor.document(), &note_only);
        editor.execute(Command::Undo).unwrap();
        assert_eq!(editor.document(), &document);
        assert_eq!(editor.selection(), original_selection);
        assert_eq!(editor.active_marks(), vec![crate::editor::Mark::Bold]);
        assert!(!editor.can_undo());
    }
}
