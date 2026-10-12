//! The web copy-desk rules, applied to each selected text leaf in place.
//! Source atoms, marks, review anchors, spacing and unknown shells stay intact.

use std::ops::Range;

use super::{Node, NodeKind, RichDocument, Selection, TextCase, utf8_offset_for_scalar};

const MINOR_WORDS: &[&str] = &[
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on",
    "onto", "or", "over", "per", "the", "to", "up", "via", "with",
];

pub(crate) fn apply(
    document: &RichDocument,
    selection: Selection,
    mode: TextCase,
) -> (RichDocument, Selection) {
    if selection.is_empty() {
        return (document.clone(), selection);
    }
    let range = selection.range();
    let mut segments = Vec::new();
    collect(document.nodes(), 0, &range, &mut segments);
    if segments.is_empty() {
        return (document.clone(), selection);
    }
    let replacements = match mode {
        TextCase::Upper => segments.iter().map(|text| text.to_uppercase()).collect(),
        TextCase::Lower => segments.iter().map(|text| text.to_lowercase()).collect(),
        TextCase::Title | TextCase::Sentence => {
            // Match recaseTextSegments: marks do not reset a title or sentence.
            // The separator is retained by casing and whitespace tokenization.
            recase(&segments.join("\0"), mode)
                .split('\0')
                .map(str::to_owned)
                .collect::<Vec<_>>()
        }
    };
    let mut replacements = replacements.into_iter();
    let changed = rewrite(document.nodes(), 0, &range, &mut replacements);
    let document = RichDocument::new(changed);
    // The existing web editor restores its original ordered selection, even
    // when a Unicode case expansion (for example ß -> SS) changes its length.
    let selection = Selection::new(range.start, range.end.min(document.text_len()));
    (document, selection)
}

fn collect(nodes: &[Node], start: usize, range: &Range<usize>, segments: &mut Vec<String>) {
    let mut cursor = start;
    for node in nodes {
        let end = cursor + node.projection_len();
        if cursor < range.end && end > range.start {
            if let Some(text) = node.as_text() {
                let from = range.start.saturating_sub(cursor);
                let to = range.end.saturating_sub(cursor).min(node.projection_len());
                let from = utf8_offset_for_scalar(text, from).expect("bounded selected leaf");
                let to = utf8_offset_for_scalar(text, to).expect("bounded selected leaf");
                segments.push(text[from..to].to_owned());
            } else if let Some(element) = node.as_element()
                && !element.kind.is_atom()
                && element.kind != NodeKind::NonContent
            {
                collect(&element.children, cursor, range, segments);
            }
        }
        cursor = end;
    }
}

fn rewrite(
    nodes: &[Node],
    start: usize,
    range: &Range<usize>,
    replacements: &mut impl Iterator<Item = String>,
) -> Vec<Node> {
    let mut cursor = start;
    nodes
        .iter()
        .map(|node| {
            let end = cursor + node.projection_len();
            let result = if cursor < range.end && end > range.start {
                if let Some(text) = node.as_text() {
                    let from = range.start.saturating_sub(cursor);
                    let to = range.end.saturating_sub(cursor).min(node.projection_len());
                    let from = utf8_offset_for_scalar(text, from).expect("bounded selected leaf");
                    let to = utf8_offset_for_scalar(text, to).expect("bounded selected leaf");
                    let replacement = replacements.next().expect("one recased segment per leaf");
                    if replacement == text[from..to] {
                        node.clone()
                    } else {
                        Node::text(format!("{}{}{}", &text[..from], replacement, &text[to..]))
                    }
                } else if let Some(element) = node.as_element()
                    && !element.kind.is_atom()
                    && element.kind != NodeKind::NonContent
                {
                    Node::element(
                        element.shell.clone(),
                        rewrite(&element.children, cursor, range, replacements),
                    )
                } else {
                    node.clone()
                }
            } else {
                node.clone()
            };
            cursor = end;
            result
        })
        .collect()
}

fn recase(text: &str, mode: TextCase) -> String {
    match mode {
        TextCase::Upper => text.to_uppercase(),
        TextCase::Lower => text.to_lowercase(),
        TextCase::Sentence => {
            let lower = text.to_lowercase();
            let mut result = String::with_capacity(lower.len());
            let mut initial = true;
            let mut after_punctuation = false;
            let mut had_whitespace = false;
            for character in lower.chars() {
                let capitalize =
                    character.is_alphabetic() && (initial || (after_punctuation && had_whitespace));
                if capitalize {
                    result.extend(character.to_uppercase());
                } else {
                    result.push(character);
                }
                if !character.is_whitespace() {
                    initial = false;
                    after_punctuation = matches!(character, '.' | '!' | '?');
                    had_whitespace = false;
                } else if after_punctuation {
                    had_whitespace = true;
                }
            }
            result
        }
        TextCase::Title => {
            let mut parts = Vec::<&str>::new();
            let mut start = 0;
            let mut whitespace = None;
            for (byte, character) in text.char_indices() {
                if whitespace.is_some_and(|value| value != character.is_whitespace()) {
                    parts.push(&text[start..byte]);
                    start = byte;
                }
                whitespace = Some(character.is_whitespace());
            }
            parts.push(&text[start..]);
            let words = parts
                .iter()
                .enumerate()
                .filter_map(|(index, part)| {
                    (!part.chars().all(char::is_whitespace)).then_some(index)
                })
                .collect::<Vec<_>>();
            let first = words.first().copied();
            let last = words.last().copied();
            parts
                .iter()
                .enumerate()
                .map(|(index, part)| {
                    if part.chars().all(char::is_whitespace) {
                        return part.to_string();
                    }
                    let lower = part.to_lowercase();
                    let bare = lower
                        .chars()
                        .filter(|character| character.is_alphanumeric())
                        .collect::<String>();
                    if Some(index) != first
                        && Some(index) != last
                        && MINOR_WORDS.contains(&bare.as_str())
                    {
                        return lower;
                    }
                    let mut result = String::with_capacity(lower.len());
                    let mut first_letter = true;
                    for character in lower.chars() {
                        if first_letter && character.is_alphabetic() {
                            result.extend(character.to_uppercase());
                            first_letter = false;
                        } else {
                            result.push(character);
                        }
                    }
                    result
                })
                .collect::<String>()
        }
    }
}
