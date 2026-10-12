use crate::editor::{Node, NodeData, NodeKind, RichDocument, Selection};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlashQuery {
    pub query: String,
    /// UTF-8 bytes for plain text; native scalar positions for rich documents.
    /// The host retains the editor kind alongside this value.
    pub range: Range<usize>,
}

fn js_whitespace(ch: char) -> bool {
    matches!(ch, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Source's /(?:^|\s)\/([^\s/]*)$/ at a collapsed caret. Detection reads only
/// the current text block, never materializes the whole manuscript.
pub fn detect(before: &str) -> Option<SlashQuery> {
    let slash = before.char_indices().rev().find_map(|(byte, ch)| {
        if ch == '/' {
            Some(Some(byte))
        } else if js_whitespace(ch) {
            Some(None)
        } else {
            None
        }
    })??;
    if slash > 0 && !js_whitespace(before[..slash].chars().next_back()?) {
        return None;
    }
    Some(SlashQuery {
        query: before[slash + 1..].to_owned(),
        range: slash..before.len(),
    })
}

pub fn detect_rich(document: &RichDocument, selection: Selection) -> Option<SlashQuery> {
    if selection.anchor != selection.head {
        return None;
    }
    let block = document.block_at_offset(selection.head)?;
    if !block.node.as_element()?.is_text_block {
        return None;
    }
    let mut remaining = selection.head.checked_sub(block.range.start)?;
    let mut before = String::new();
    fn visit(node: &Node, remaining: &mut usize, output: &mut String) {
        if *remaining == 0 {
            return;
        }
        match node.data() {
            NodeData::Text(text) => {
                for ch in text.chars().take(*remaining) {
                    output.push(ch);
                    *remaining -= 1;
                }
            }
            NodeData::Comment(_) => {}
            NodeData::Element(element) => {
                if element.kind.is_atom() || element.kind == NodeKind::HardBreak {
                    output.push('\0');
                    *remaining -= 1;
                } else if element.kind != NodeKind::NonContent {
                    for child in &element.children {
                        visit(child, remaining, output);
                    }
                }
            }
        }
    }
    visit(&block.node, &mut remaining, &mut before);
    let detected = detect(&before)?;
    let start = block.range.start + before[..detected.range.start].chars().count();
    Some(SlashQuery {
        query: detected.query,
        range: start..selection.head,
    })
}
