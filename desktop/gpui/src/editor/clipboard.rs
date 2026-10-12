//! Bounded rich clipboard slices. GPUI transports this metadata alongside
//! plain text. The optional native platform adapter also carries bounded HTML.

use std::ops::Range;

use serde::{Deserialize, Serialize};

use super::{EditorError, HTML_LIMITS, Node, NodeData, NodeKind, NodePath, RichDocument};

const FORMAT: &str = "twyne.rich-fragment";
const VERSION: u8 = 1;
const MAX_METADATA_BYTES: usize = 64 * 1024 * 1024;

/// A selected visual tree, never the manuscript's authored Typst source.
/// Open block edges merge with the destination's existing inline content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichFragment {
    document: RichDocument,
    inline: bool,
    open_start: bool,
    open_end: bool,
}

#[derive(Serialize, Deserialize)]
struct ClipboardEnvelope {
    format: String,
    version: u8,
    html: String,
    text: String,
    inline: bool,
    open_start: bool,
    open_end: bool,
}

impl RichFragment {
    pub fn document(&self) -> &RichDocument {
        &self.document
    }
    pub fn is_inline(&self) -> bool {
        self.inline
    }
    pub fn open_start(&self) -> bool {
        self.open_start
    }
    pub fn open_end(&self) -> bool {
        self.open_end
    }
    pub fn to_html(&self) -> String {
        self.document.to_html()
    }
    pub fn plain_text(&self) -> String {
        self.document.plain_text()
    }

    /// Interoperable HTML uses PM's transport annotation; the manuscript tree
    /// remains unchanged. The native JSON MIME retains the complete slice.
    pub fn to_external_html(&self) -> Result<String, EditorError> {
        self.document.validate_html_limits()?;
        let mut nodes = if self.inline {
            vec![Node::paragraph(self.document.nodes().to_vec())]
        } else {
            self.document.nodes().to_vec()
        };
        if let Some(index) = nodes.iter().position(|node| node.as_element().is_some()) {
            let element = nodes[index].as_element().expect("element index");
            let mut shell = element.shell.clone();
            shell.set_attr(
                "data-pm-slice",
                format!(
                    "{} {} []",
                    usize::from(self.open_start),
                    usize::from(self.open_end)
                ),
            );
            nodes[index] = Node::element(shell, element.children.clone());
        }
        let external = RichDocument::new(nodes);
        external.validate_html_limits()?;
        Ok(external.to_html())
    }

    /// Browser/word-processor HTML enters through the original bounded parser.
    /// Deep open PM contexts and partial table transport wrappers are rejected
    /// rather than losing their container/source metadata during fitting.
    pub fn from_external_html(html: &str) -> Result<Self, EditorError> {
        let document = RichDocument::from_html(html)?;
        let mut nodes = document.nodes().to_vec();
        let mut slice = None;
        for node in &mut nodes {
            let Some(element) = node.as_element() else {
                continue;
            };
            if let Some(annotation) = element.shell.attr("data-pm-slice") {
                if slice.is_some() {
                    return Err(EditorError::UnsupportedStructure(
                        "The clipboard contains conflicting rich slice annotations",
                    ));
                }
                let mut parts = annotation.splitn(3, ' ');
                let start = parts.next().and_then(|value| value.parse::<usize>().ok());
                let end = parts.next().and_then(|value| value.parse::<usize>().ok());
                let context = parts.next().unwrap_or("");
                if !matches!(start, Some(0 | 1))
                    || !matches!(end, Some(0 | 1))
                    || context.trim() != "[]"
                {
                    return Err(EditorError::UnsupportedStructure(
                        "Copy the complete nested container to preserve its rich clipboard context",
                    ));
                }
                slice = Some((start == Some(1), end == Some(1)));
                let mut shell = element.shell.clone();
                shell.remove_attr("data-pm-slice");
                *node = Node::element(shell, element.children.clone());
            }
        }
        let inline = nodes.iter().all(|node| {
            node.as_element()
                .is_none_or(|element| !element.kind.is_block())
        });
        let (open_start, open_end) = slice.unwrap_or_else(|| {
            (
                nodes
                    .first()
                    .and_then(Node::as_element)
                    .is_some_and(|element| element.is_text_block),
                nodes
                    .last()
                    .and_then(Node::as_element)
                    .is_some_and(|element| element.is_text_block),
            )
        });
        if !inline
            && nodes.len() == 1
            && open_start
            && open_end
            && let Some(element) = nodes[0]
                .as_element()
                .filter(|element| element.is_text_block)
        {
            return Ok(Self {
                document: RichDocument::new(element.children.clone()),
                inline: true,
                open_start: true,
                open_end: true,
            });
        }
        Ok(Self {
            document: RichDocument::new(nodes),
            inline,
            open_start,
            open_end,
        })
    }

    /// Only a user-triggered clipboard boundary serializes the selected tree.
    pub fn to_clipboard_metadata(&self) -> Result<String, EditorError> {
        self.document.validate_html_limits()?;
        let html = self.to_html();
        if html.len() > HTML_LIMITS.bytes {
            return Err(EditorError::HtmlTooLarge);
        }
        let metadata = serde_json::to_string(&ClipboardEnvelope {
            format: FORMAT.into(),
            version: VERSION,
            html,
            text: self.plain_text(),
            inline: self.inline,
            open_start: self.open_start,
            open_end: self.open_end,
        })
        .map_err(|_| {
            EditorError::UnsupportedStructure("The clipboard fragment could not be encoded")
        })?;
        if metadata.len() > MAX_METADATA_BYTES {
            return Err(EditorError::HtmlTooLarge);
        }
        Ok(metadata)
    }

    /// Unrelated, future, or stale metadata falls back to public plain text.
    /// A recognized malformed rich slice is rejected without editing.
    pub fn from_clipboard_metadata(
        metadata: &str,
        clipboard_text: &str,
    ) -> Result<Option<Self>, EditorError> {
        if metadata.len() > MAX_METADATA_BYTES {
            return Err(EditorError::HtmlTooLarge);
        }
        let Ok(envelope) = serde_json::from_str::<ClipboardEnvelope>(metadata) else {
            return Ok(None);
        };
        if envelope.format != FORMAT
            || envelope.version != VERSION
            || envelope.text != clipboard_text
        {
            return Ok(None);
        }
        let document = if envelope.inline {
            RichDocument::from_inline_fragment_html(&envelope.html)?
        } else {
            RichDocument::from_html(&envelope.html)?
        };
        if envelope.inline
            && document.nodes().iter().any(|node| {
                node.as_element()
                    .is_some_and(|element| element.kind.is_block())
            })
        {
            return Err(EditorError::UnsupportedStructure(
                "The inline clipboard fragment contains a block container",
            ));
        }
        if document.plain_text() != envelope.text {
            return Err(EditorError::UnsupportedStructure(
                "The clipboard fragment does not match its plain text",
            ));
        }
        Ok(Some(Self {
            document,
            inline: envelope.inline,
            open_start: envelope.open_start,
            open_end: envelope.open_end,
        }))
    }
}

impl RichDocument {
    pub fn copy_fragment(&self, range: Range<usize>) -> Result<RichFragment, EditorError> {
        if range.start > range.end || range.end > self.text_len() {
            return Err(EditorError::SelectionOutOfBounds {
                position: range.start.max(range.end),
                length: self.text_len(),
            });
        }
        if range.is_empty() {
            return Err(EditorError::UnsupportedStructure(
                "Select text or an object to copy",
            ));
        }
        let blocks: Vec<_> = self
            .blocks_in_range(range.clone())
            .into_iter()
            .filter(|block| {
                range.start < block.range.start + block.node.projection_len()
                    && range.end > block.range.start
            })
            .collect();
        let first = blocks.first().ok_or(EditorError::MissingTextBlock)?;
        let last = blocks.last().ok_or(EditorError::MissingTextBlock)?;
        if first.path == last.path
            && let Some(element) = first
                .node
                .as_element()
                .filter(|element| element.is_text_block)
            && (range.start > first.range.start
                || range.end < first.range.start + first.node.projection_len()
                || matches!(
                    element.kind,
                    NodeKind::TableCell { .. } | NodeKind::ListItem { .. }
                ))
        {
            let nodes = slice_nodes(&element.children, first.range.start, &range);
            if range.start == first.range.end
                && range.end == first.range.end + 1
                && nodes.iter().all(|node| node.projection_len() == 0)
            {
                return Ok(RichFragment {
                    document: RichDocument::new(vec![
                        Node::element(element.shell.clone(), nodes),
                        Node::paragraph(Vec::new()),
                    ]),
                    inline: false,
                    open_start: true,
                    open_end: true,
                });
            }
            return Ok(RichFragment {
                document: RichDocument::new(nodes),
                inline: true,
                open_start: true,
                open_end: true,
            });
        }

        let first_cell = ancestor_kind(self, &first.path, |kind| {
            matches!(kind, NodeKind::TableCell { .. })
        });
        let last_cell = ancestor_kind(self, &last.path, |kind| {
            matches!(kind, NodeKind::TableCell { .. })
        });
        if first_cell != last_cell && (first_cell.is_some() || last_cell.is_some()) {
            let table = ancestor_kind(self, &first.path, |kind| *kind == NodeKind::Table)
                .or_else(|| ancestor_kind(self, &last.path, |kind| *kind == NodeKind::Table));
            let covers_table = table.as_ref().is_some_and(|path| {
                let start = self.offset_of_node(path).expect("known table path");
                let node = self.node(path).expect("known table node");
                range.start <= start && range.end >= start + node.projection_len()
            });
            if !covers_table {
                return Err(EditorError::UnsupportedStructure(
                    "Copy individual table passages or the complete table; partial cross-cell slices are unsupported",
                ));
            }
        }

        let shared = first
            .path
            .iter()
            .zip(&last.path)
            .take_while(|(left, right)| left == right)
            .count();
        let mut parent = first.path[..shared.min(first.path.len() - 1)].to_vec();
        while !parent.is_empty() {
            let node = self.node(&parent).expect("known common ancestor");
            let start = self.offset_of_node(&parent).expect("known ancestor offset");
            if range.start > start || range.end < start + node.projection_len() {
                break;
            }
            parent.pop();
        }
        let start = self.offset_of_node(&parent).expect("known slice scope");
        let siblings = if parent.is_empty() {
            self.nodes()
        } else {
            &self
                .node(&parent)
                .and_then(Node::as_element)
                .expect("ancestor element")
                .children
        };
        let mut nodes = slice_nodes(siblings, start, &range);
        let mut open_start = range.start > first.range.start;
        let mut open_end = range.end < last.range.start + last.node.projection_len();
        if let Some(element) = self.node(&parent).and_then(Node::as_element) {
            if matches!(
                element.kind,
                NodeKind::Table | NodeKind::TableSection | NodeKind::TableRow
            ) {
                return Err(EditorError::UnsupportedStructure(
                    "The clipboard slice needs the complete table context",
                ));
            }
            if matches!(
                element.kind,
                NodeKind::List(_) | NodeKind::BlockQuote | NodeKind::UnknownBlock
            ) {
                nodes = vec![Node::element(element.shell.clone(), nodes)];
                open_start = false;
                open_end = false;
            }
        }
        Ok(RichFragment {
            document: RichDocument::new(nodes),
            inline: false,
            open_start,
            open_end,
        })
    }
}

fn ancestor_kind(
    document: &RichDocument,
    path: &[usize],
    matches: impl Fn(&NodeKind) -> bool,
) -> Option<NodePath> {
    (1..=path.len()).rev().find_map(|end| {
        document
            .node(&path[..end])?
            .as_element()
            .filter(|element| matches(&element.kind))
            .map(|_| path[..end].to_vec())
    })
}

fn slice_nodes(nodes: &[Node], start: usize, range: &Range<usize>) -> Vec<Node> {
    let mut cursor = start;
    let mut result = Vec::new();
    for node in nodes {
        let end = cursor + node.projection_len();
        if node.projection_len() == 0 {
            if cursor >= range.start && cursor < range.end {
                result.push(node.clone());
            }
        } else if cursor < range.end && end > range.start {
            if range.start <= cursor && range.end >= end {
                result.push(node.clone());
            } else {
                match node.data() {
                    NodeData::Text(text) => {
                        let from =
                            super::utf8_offset_for_scalar(text, range.start.saturating_sub(cursor))
                                .expect("bounded slice start");
                        let to = super::utf8_offset_for_scalar(
                            text,
                            range.end.saturating_sub(cursor).min(node.projection_len()),
                        )
                        .expect("bounded slice end");
                        result.push(Node::text(&text[from..to]));
                    }
                    NodeData::Comment(_) => result.push(node.clone()),
                    NodeData::Element(element)
                        if element.kind.is_atom() || element.kind == NodeKind::HardBreak =>
                    {
                        result.push(node.clone())
                    }
                    NodeData::Element(element) => result.push(Node::element(
                        element.shell.clone(),
                        slice_nodes(&element.children, cursor, range),
                    )),
                }
            }
        }
        cursor = end;
    }
    result
}
