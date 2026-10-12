//! ProseMirror paragraph text offsets mapped to the native scalar projection.
//! Inline objects and hard breaks occupy native positions but contribute no
//! characters to `node.textContent`. Marks are native wrappers, not offsets.
use super::seed::{SentenceSpan, split_sentences};
use crate::editor::{Node, NodeData, NodeKind, NodePath, RichDocument};
use std::{fmt, ops::Range, sync::Arc};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PassageError {
    NotParagraph,
    OffsetOutOfBounds,
    SplitSurrogate,
}
impl fmt::Display for PassageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NotParagraph => "The tool's paragraph is no longer available.",
            Self::OffsetOutOfBounds => "The sentence is outside its paragraph.",
            Self::SplitSurrogate => "The sentence boundary splits a Unicode character.",
        })
    }
}
impl std::error::Error for PassageError {}

#[derive(Clone, Debug)]
struct TextSegment {
    units: Range<usize>,
    native_start: usize,
    text: Arc<str>,
}

#[derive(Clone, Debug)]
pub struct Passage {
    pub path: NodePath,
    /// Native content positions; excludes the synthetic terminal newline.
    pub range: Range<usize>,
    pub text: String,
    segments: Vec<TextSegment>,
    units: usize,
}
impl Passage {
    /// Original explicit-open policy: matching passage, current paragraph,
    /// then the first longest paragraph (UTF-16 length breaks no ties).
    pub fn choose(document: &RichDocument, head: usize, hint: Option<&str>) -> Option<Self> {
        let paragraphs = || {
            document
                .blocks()
                .into_iter()
                .filter_map(|block| Self::at_path(document, &block.path).ok())
        };
        if let Some(hint) = hint {
            let needle: Vec<u16> = crate::native_ai::request::js_trim(hint)
                .encode_utf16()
                .take(120)
                .collect();
            if !needle.is_empty()
                && let Some(passage) = paragraphs().find(|passage| {
                    passage
                        .text
                        .encode_utf16()
                        .collect::<Vec<_>>()
                        .windows(needle.len())
                        .any(|slice| slice == needle)
                })
            {
                return Some(passage);
            }
        }
        if let Ok(passage) = Self::at(document, head) {
            return Some(passage);
        }
        let mut longest: Option<Self> = None;
        for passage in paragraphs() {
            if longest
                .as_ref()
                .is_none_or(|previous| passage.units > previous.units)
            {
                longest = Some(passage);
            }
        }
        longest
    }
    pub fn at(document: &RichDocument, offset: usize) -> Result<Self, PassageError> {
        let block = document
            .block_at_offset(offset)
            .ok_or(PassageError::NotParagraph)?;
        Self::at_path(document, &block.path)
    }
    pub fn at_path(document: &RichDocument, path: &[usize]) -> Result<Self, PassageError> {
        let node = document.node(path).ok_or(PassageError::NotParagraph)?;
        let element = node.as_element().ok_or(PassageError::NotParagraph)?;
        if element.kind != NodeKind::Paragraph {
            return Err(PassageError::NotParagraph);
        }
        let start = document
            .offset_of_node(path)
            .ok_or(PassageError::NotParagraph)?;
        let mut result = Self {
            path: path.to_vec(),
            range: start..start + node.projection_len().saturating_sub(1),
            text: String::new(),
            segments: Vec::new(),
            units: 0,
        };
        result.collect(&element.children, start);
        Ok(result)
    }
    fn collect(&mut self, nodes: &[Node], mut cursor: usize) {
        for node in nodes {
            match node.data() {
                NodeData::Text(text) => {
                    let length = text.encode_utf16().count();
                    self.segments.push(TextSegment {
                        units: self.units..self.units + length,
                        native_start: cursor,
                        text: text.clone(),
                    });
                    self.text.push_str(text);
                    self.units += length;
                }
                NodeData::Element(element)
                    if !element.kind.is_atom()
                        && !matches!(element.kind, NodeKind::NonContent | NodeKind::HardBreak) =>
                {
                    self.collect(&element.children, cursor);
                }
                _ => {}
            }
            cursor += node.projection_len();
        }
    }
    /// Endpoint ties deliberately use the preceding text node, as Source's
    /// `posAtOffset` does even when an object follows that text node.
    pub fn position(&self, offset: usize) -> Result<usize, PassageError> {
        if offset > self.units {
            return Err(PassageError::OffsetOutOfBounds);
        }
        for segment in &self.segments {
            if offset <= segment.units.end {
                let target = offset.saturating_sub(segment.units.start);
                let mut units = 0;
                let mut scalars = 0;
                for character in segment.text.chars() {
                    if units == target {
                        return Ok(segment.native_start + scalars);
                    }
                    units += character.len_utf16();
                    scalars += 1;
                    if units > target {
                        return Err(PassageError::SplitSurrogate);
                    }
                }
                return Ok(segment.native_start + scalars);
            }
        }
        Ok(self.range.end)
    }
    pub fn sentence(&self, index: usize) -> Option<(SentenceSpan, Range<usize>)> {
        let span = split_sentences(&self.text).into_iter().nth(index)?;
        let range = self.position(span.from).ok()?..self.position(span.to).ok()?;
        Some((span, range))
    }
    pub fn find_sentence(&self, text: &str) -> Option<Range<usize>> {
        let span = split_sentences(&self.text)
            .into_iter()
            .find(|span| span.text == text)?;
        Some(self.position(span.from).ok()?..self.position(span.to).ok()?)
    }
    /// Like ProseMirror `textBetween` without a leaf-text callback: an inline
    /// object or hard break does not make an otherwise matching sentence stale.
    pub fn text_in_range(&self, range: &Range<usize>) -> Option<String> {
        if range.start > range.end || range.start < self.range.start || range.end > self.range.end {
            return None;
        }
        let mut text = String::new();
        for segment in &self.segments {
            let end = segment.native_start + segment.text.chars().count();
            let from = range.start.max(segment.native_start);
            let to = range.end.min(end);
            if from < to {
                text.extend(
                    segment
                        .text
                        .chars()
                        .skip(from - segment.native_start)
                        .take(to - from),
                );
            }
        }
        Some(text)
    }
}

/// One projection replacement, derived by walking shared trees. Unchanged
/// subtrees skip their cached lengths; this never serializes an entire draft.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionMap {
    pub old: Range<usize>,
    pub inserted: usize,
}

#[derive(Clone, Debug)]
pub struct PassageAnchor {
    pub paragraph: Range<usize>,
    pub sentence: Option<Range<usize>>,
}
impl PassageAnchor {
    pub fn new(passage: &Passage, sentence: Option<Range<usize>>) -> Self {
        Self {
            paragraph: passage.range.clone(),
            sentence,
        }
    }
    /// A paragraph keeps its start when typing or splitting at its first
    /// content position. Removing its block or joining it into its predecessor
    /// retires the tool instead of attaching it to the following paragraph.
    pub fn remap(&mut self, before: &RichDocument, after: &RichDocument) -> bool {
        let map = ProjectionMap::between(before, after);
        if !map.old.is_empty()
            && map.old.start <= self.paragraph.start
            && map.old.end > self.paragraph.end
        {
            return false;
        }
        let start = map.position(self.paragraph.start, -1);
        let Some(block) = after.block_at_offset(start) else {
            return false;
        };
        if block.range.start != start
            || block
                .node
                .as_element()
                .is_none_or(|element| element.kind != NodeKind::Paragraph)
        {
            return false;
        }
        self.paragraph = block.range;
        self.sentence = self.sentence.as_ref().map(|range| map.range(range));
        true
    }
}
impl ProjectionMap {
    pub fn between(before: &RichDocument, after: &RichDocument) -> Self {
        let limit = before.text_len().min(after.text_len());
        let prefix = shared_projection(before, after, false, limit);
        let suffix = shared_projection(before, after, true, limit - prefix);
        Self {
            old: prefix..before.text_len() - suffix,
            inserted: after.text_len() - prefix - suffix,
        }
    }
    pub fn position(&self, position: usize, association: i8) -> usize {
        if position < self.old.start {
            position
        } else if position > self.old.end {
            position - self.old.len() + self.inserted
        } else {
            let side = if self.old.is_empty() {
                association
            } else if position == self.old.start {
                -1
            } else if position == self.old.end {
                1
            } else {
                association
            };
            self.old.start + if side < 0 { 0 } else { self.inserted }
        }
    }
    pub fn range(&self, range: &Range<usize>) -> Range<usize> {
        self.position(range.start, -1)..self.position(range.end, 1)
    }
}

enum Frame<'a> {
    Nodes { nodes: &'a [Node], consumed: usize },
    Text(&'a str),
    Character(char),
}
#[derive(Clone, Copy)]
enum Piece<'a> {
    Node(&'a Node),
    Character(char),
}
struct ProjectionCursor<'a> {
    frames: Vec<Frame<'a>>,
    reverse: bool,
}
impl<'a> ProjectionCursor<'a> {
    fn new(document: &'a RichDocument, reverse: bool) -> Self {
        Self {
            frames: vec![Frame::Nodes {
                nodes: document.nodes(),
                consumed: 0,
            }],
            reverse,
        }
    }
    fn peek(&mut self) -> Option<Piece<'a>> {
        loop {
            match self.frames.last_mut()? {
                Frame::Nodes { nodes, consumed } => {
                    if *consumed == nodes.len() {
                        self.frames.pop();
                        continue;
                    }
                    let index = if self.reverse {
                        nodes.len() - 1 - *consumed
                    } else {
                        *consumed
                    };
                    let node = &nodes[index];
                    if node.projection_len() == 0 {
                        *consumed += 1;
                        continue;
                    }
                    return Some(Piece::Node(node));
                }
                Frame::Text(text) => {
                    let character = if self.reverse {
                        text.chars().next_back()
                    } else {
                        text.chars().next()
                    };
                    if let Some(character) = character {
                        return Some(Piece::Character(character));
                    }
                    self.frames.pop();
                }
                Frame::Character(character) => return Some(Piece::Character(*character)),
            }
        }
    }
    fn advance(&mut self) {
        match self.frames.last_mut().expect("a peeked projection piece") {
            Frame::Nodes { consumed, .. } => *consumed += 1,
            Frame::Text(text) => {
                let character = if self.reverse {
                    text.chars().next_back()
                } else {
                    text.chars().next()
                }
                .unwrap();
                *text = if self.reverse {
                    &text[..text.len() - character.len_utf8()]
                } else {
                    &text[character.len_utf8()..]
                };
            }
            Frame::Character(_) => {
                self.frames.pop();
            }
        }
    }
    fn expand(&mut self, node: &'a Node) {
        self.advance();
        match node.data() {
            NodeData::Text(text) => self.frames.push(Frame::Text(text)),
            NodeData::Comment(_) => {}
            NodeData::Element(element) => {
                if element.kind.is_atom() {
                    self.frames.push(Frame::Character('\u{fffc}'));
                } else if element.kind == NodeKind::HardBreak {
                    self.frames.push(Frame::Character('\n'));
                } else if element.kind != NodeKind::NonContent {
                    if element.is_text_block && !self.reverse {
                        self.frames.push(Frame::Character('\n'));
                    }
                    self.frames.push(Frame::Nodes {
                        nodes: &element.children,
                        consumed: 0,
                    });
                    if element.is_text_block && self.reverse {
                        self.frames.push(Frame::Character('\n'));
                    }
                }
            }
        }
    }
}
fn shared_projection(
    before: &RichDocument,
    after: &RichDocument,
    reverse: bool,
    limit: usize,
) -> usize {
    let mut a = ProjectionCursor::new(before, reverse);
    let mut b = ProjectionCursor::new(after, reverse);
    let mut count = 0;
    while count < limit {
        match (a.peek(), b.peek()) {
            (Some(Piece::Node(a_node)), Some(Piece::Node(b_node)))
                if a_node.shares_storage_with(b_node)
                    && a_node.projection_len() <= limit - count =>
            {
                count += a_node.projection_len();
                a.advance();
                b.advance();
            }
            (Some(Piece::Node(node)), _) => a.expand(node),
            (_, Some(Piece::Node(node))) => b.expand(node),
            (Some(Piece::Character(a_char)), Some(Piece::Character(b_char)))
                if a_char == b_char =>
            {
                count += 1;
                a.advance();
                b.advance();
            }
            _ => break,
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{Command, RichEditor, Selection};
    fn document(html: &str) -> RichDocument {
        RichDocument::from_html(html).unwrap()
    }

    #[test]
    fn utf16_spans_ignore_object_payload_but_native_ranges_include_objects() {
        let doc = document("<p><strong>A😀</strong><br><em>B.</em><img src='x'> C.</p>");
        let passage = Passage::at(&doc, 0).unwrap();
        assert_eq!(passage.text, "A😀B. C.");
        assert_eq!(passage.position(3), Ok(2)); // before the hard break, endpoint tie
        assert_eq!(passage.position(4), Ok(4));
        assert_eq!(passage.position(2), Err(PassageError::SplitSurrogate));
        let (first, range) = passage.sentence(0).unwrap();
        assert_eq!(first.text, "A😀B.");
        assert_eq!(range, 0..5);
        assert_eq!(passage.text_in_range(&range).as_deref(), Some("A😀B."));
        let (second, range) = passage.sentence(1).unwrap();
        assert_eq!(second.text, "C.");
        assert_eq!(range, 7..9);
    }
    #[test]
    fn empty_atom_only_paragraph_uses_content_end_and_other_blocks_are_refused() {
        let doc = document("<h2>Heading.</h2><p><img src='x'></p>");
        assert!(matches!(
            Passage::at(&doc, 0),
            Err(PassageError::NotParagraph)
        ));
        let passage = Passage::at_path(&doc, &[1]).unwrap();
        assert_eq!(passage.text, "");
        assert_eq!(passage.position(0), Ok(passage.range.end));
        assert_eq!(passage.position(1), Err(PassageError::OffsetOutOfBounds));
    }
    #[test]
    fn projection_map_handles_insert_delete_undo_and_mark_changes_without_html_diff() {
        let before = document("<p>First.</p><p>A😀 long sentence.</p><p>Last.</p>");
        let mut editor = RichEditor::new(before.clone());
        editor.set_selection(Selection::caret(10)).unwrap();
        editor.execute(Command::InsertText("é".into())).unwrap();
        let after = editor.document().clone();
        let map = ProjectionMap::between(&before, &after);
        assert_eq!(
            map,
            ProjectionMap {
                old: 10..10,
                inserted: 1
            }
        );
        assert_eq!(map.range(&(7..24)), 7..25);
        let reverse = ProjectionMap::between(&after, &before);
        assert_eq!(
            reverse,
            ProjectionMap {
                old: 10..11,
                inserted: 0
            }
        );
        assert_eq!(reverse.range(&(7..25)), 7..24);
        editor.execute(Command::Undo).unwrap();
        assert_eq!(editor.document(), &before);
        let marked = document("<p><b>First.</b></p><p>A😀 long sentence.</p><p>Last.</p>");
        let same = ProjectionMap::between(&before, &marked);
        assert!(same.old.is_empty());
        assert_eq!(same.inserted, 0);
    }
}
