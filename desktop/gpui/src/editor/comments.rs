//! Writer-comment anchors are independent preserved spans, not a mutually
//! exclusive visual MarkKind. Thread bodies and reconciliation live outside
//! the editor. These explicit-boundary queries never serialize the document.
use std::{
    collections::{HashMap, HashSet},
    ops::Range,
    sync::Arc,
};

use super::{
    EditorError, ElementShell, Node, NodeData, NodeKind, RichDocument, RunContent,
    model::{inline_fragments, nodes_from_fragments},
    transaction::split_fragments,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommentAttributes {
    pub id: String,
    pub author: String,
    pub color: String,
}

impl CommentAttributes {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            author: "You".into(),
            color: "var(--color-writer-note)".into(),
        }
    }

    fn shell(&self) -> Result<ElementShell, EditorError> {
        if self.id.is_empty() {
            return Err(EditorError::InvalidStyle("comment id".into()));
        }
        let mut shell = ElementShell::html("span");
        shell.set_attr("data-comment-id", &self.id);
        if !self.author.is_empty() {
            shell.set_attr("data-comment-author", &self.author);
        }
        if !self.color.is_empty() {
            shell.set_attr("data-comment-color", &self.color);
        }
        shell.set_attr("class", "twyne-comment-mark");
        let color = if self.color.is_empty() {
            "var(--color-writer-note)"
        } else {
            &self.color
        };
        shell.set_attr("style", format!("background: color-mix(in srgb, {color} 18%, transparent); border-bottom: 2px solid {color}; cursor: text;"));
        Ok(shell)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommentRange {
    pub id: Arc<str>,
    pub range: Range<usize>,
    pub author: Option<Arc<str>>,
    pub color: Option<Arc<str>>,
}

impl RichDocument {
    /// Current projected ranges, in document scalar offsets. Equal adjacent
    /// ranges merge across bold/italic/unknown wrappers; overlapping IDs each
    /// retain their own range. Opaque source payload text is never traversed.
    pub fn comment_ranges(&self) -> Vec<CommentRange> {
        fn record(
            active: &[&ElementShell],
            range: Range<usize>,
            ranges: &mut Vec<CommentRange>,
            last: &mut HashMap<Arc<str>, usize>,
        ) {
            if range.is_empty() {
                return;
            }
            for shell in active {
                let id: Arc<str> = Arc::from(shell.attr("data-comment-id").expect("comment shell"));
                let author = shell.attr("data-comment-author").map(Arc::from);
                let color = shell.attr("data-comment-color").map(Arc::from);
                if let Some(index) = last.get(&id).copied() {
                    let previous = &mut ranges[index];
                    if previous.author == author
                        && previous.color == color
                        && previous.range.end == range.start
                    {
                        previous.range.end = range.end;
                        continue;
                    }
                    if previous.author == author
                        && previous.color == color
                        && previous.range == range
                    {
                        continue;
                    }
                }
                last.insert(id.clone(), ranges.len());
                ranges.push(CommentRange {
                    id,
                    range: range.clone(),
                    author,
                    color,
                });
            }
        }
        fn visit<'a>(
            node: &'a Node,
            start: usize,
            active: &mut Vec<&'a ElementShell>,
            ranges: &mut Vec<CommentRange>,
            last: &mut HashMap<Arc<str>, usize>,
        ) {
            match node.data() {
                NodeData::Text(_) => {
                    record(active, start..start + node.projection_len(), ranges, last)
                }
                NodeData::Comment(_) => {}
                NodeData::Element(element) => {
                    let comment = is_comment(&element.shell);
                    if comment {
                        active.push(&element.shell);
                    }
                    if element.kind.is_atom() || element.kind == NodeKind::HardBreak {
                        record(active, start..start + node.projection_len(), ranges, last);
                    } else if element.kind != NodeKind::NonContent {
                        let mut cursor = start;
                        for child in &element.children {
                            visit(child, cursor, active, ranges, last);
                            cursor += child.projection_len();
                        }
                    }
                    if comment {
                        active.pop();
                    }
                }
            }
        }
        let mut ranges = Vec::new();
        let mut cursor = 0;
        let mut last = HashMap::new();
        for node in self.nodes() {
            visit(node, cursor, &mut Vec::new(), &mut ranges, &mut last);
            cursor += node.projection_len();
        }
        ranges
    }

    /// Matches the web reconciliation boundary's [data-comment-id] scan,
    /// including preserved unknown element/atom attributes. The tree remains
    /// untouched; an ID with no projected passage has no selectable range.
    pub fn comment_ids(&self) -> Vec<Arc<str>> {
        fn visit(node: &Node, seen: &mut HashSet<Arc<str>>, ids: &mut Vec<Arc<str>>) {
            if let Some(element) = node.as_element() {
                if let Some(id) = element
                    .shell
                    .attr("data-comment-id")
                    .filter(|id| !id.is_empty())
                {
                    let id = Arc::<str>::from(id);
                    if seen.insert(id.clone()) {
                        ids.push(id);
                    }
                }
                for child in &element.children {
                    visit(child, seen, ids);
                }
            }
        }
        let mut seen = HashSet::new();
        let mut ids = Vec::new();
        for node in self.nodes() {
            visit(node, &mut seen, &mut ids);
        }
        ids
    }

    pub fn first_comment_range(&self, id: &str) -> Option<Range<usize>> {
        self.comment_ranges()
            .into_iter()
            .find(|anchor| anchor.id.as_ref() == id)
            .map(|anchor| anchor.range)
    }
}

fn is_comment(shell: &ElementShell) -> bool {
    shell.tag == "span"
        && shell
            .attr("data-comment-id")
            .is_some_and(|id| !id.is_empty())
}

pub(super) fn add(
    document: &RichDocument,
    range: &Range<usize>,
    attributes: CommentAttributes,
) -> Result<RichDocument, EditorError> {
    if range.is_empty() {
        return Err(EditorError::UnsupportedStructure(
            "Select a text passage before adding a margin note",
        ));
    }
    let shell = attributes.shell()?;
    fn visit(
        nodes: &[Node],
        start: usize,
        range: &Range<usize>,
        shell: &ElementShell,
    ) -> Vec<Node> {
        let mut cursor = start;
        nodes
            .iter()
            .map(|node| {
                let end = cursor + node.projection_len();
                let result = if cursor < range.end && end > range.start {
                    if let Some(element) = node.as_element() {
                        if element.is_text_block && element.kind != NodeKind::CodeBlock {
                            let local = range.start.saturating_sub(cursor).min(node.payload_len())
                                ..range.end.saturating_sub(cursor).min(node.payload_len());
                            let fragments = inline_fragments(&element.children);
                            let (mut before, tail) = split_fragments(&fragments, local.start);
                            let (selected, after) = split_fragments(&tail, local.end - local.start);
                            before.extend(selected.into_iter().map(|mut fragment| {
                                if matches!(fragment.content, RunContent::Text(_))
                                    && !fragment.wrappers.iter().any(|existing| {
                                        is_comment(existing)
                                            && existing.attr("data-comment-id")
                                                == shell.attr("data-comment-id")
                                            && existing.attr("data-comment-author")
                                                == shell.attr("data-comment-author")
                                            && existing.attr("data-comment-color")
                                                == shell.attr("data-comment-color")
                                    })
                                {
                                    fragment.wrappers.push(shell.clone());
                                }
                                fragment
                            }));
                            before.extend(after);
                            Node::element(element.shell.clone(), nodes_from_fragments(&before))
                        } else if !element.kind.is_atom() && element.kind != NodeKind::NonContent {
                            Node::element(
                                element.shell.clone(),
                                visit(&element.children, cursor, range, shell),
                            )
                        } else {
                            node.clone()
                        }
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
    Ok(RichDocument::new(visit(document.nodes(), 0, range, &shell)))
}

pub(super) fn remove(document: &RichDocument, id: &str) -> RichDocument {
    fn visit(node: &Node, id: &str) -> Node {
        let Some(element) = node.as_element() else {
            return node.clone();
        };
        if element.kind.is_atom() || element.kind == NodeKind::NonContent {
            return node.clone();
        }
        let children = if element.is_text_block {
            let fragments = inline_fragments(&element.children);
            let changed = fragments.iter().any(|fragment| {
                matches!(fragment.content, RunContent::Text(_))
                    && fragment
                        .wrappers
                        .iter()
                        .any(|shell| is_comment(shell) && shell.attr("data-comment-id") == Some(id))
            });
            if !changed {
                return node.clone();
            }
            let fragments = fragments
                .into_iter()
                .map(|mut fragment| {
                    if matches!(fragment.content, RunContent::Text(_)) {
                        fragment.wrappers = fragment
                            .wrappers
                            .into_iter()
                            .filter_map(|shell| strip_id(shell, id))
                            .collect();
                    }
                    fragment
                })
                .collect::<Vec<_>>();
            nodes_from_fragments(&fragments)
        } else {
            let children = element
                .children
                .iter()
                .map(|child| visit(child, id))
                .collect::<Vec<_>>();
            if children == element.children {
                return node.clone();
            }
            children
        };
        Node::element(element.shell.clone(), children)
    }
    RichDocument::new(
        document
            .nodes()
            .iter()
            .map(|node| visit(node, id))
            .collect(),
    )
}

fn strip_id(mut shell: ElementShell, id: &str) -> Option<ElementShell> {
    if !is_comment(&shell) || shell.attr("data-comment-id") != Some(id) {
        return Some(shell);
    }
    let color = shell
        .attr("data-comment-color")
        .unwrap_or("var(--color-writer-note)")
        .to_owned();
    for attribute in [
        "data-comment-id",
        "data-comment-author",
        "data-comment-color",
    ] {
        shell.remove_attr(attribute);
    }
    if let Some(classes) = shell.attr("class") {
        let retained: Vec<_> = classes
            .split_whitespace()
            .filter(|class| *class != "twyne-comment-mark")
            .collect();
        if retained.is_empty() {
            shell.remove_attr("class");
        } else if retained.len() != classes.split_whitespace().count() {
            shell.set_attr("class", retained.join(" "));
        }
    }
    // Remove only the current extension's own generated decoration. Future
    // attributes and authored/custom style declarations retain their values.
    for (property, expected) in [
        (
            "background",
            format!("color-mix(in srgb, {color} 18%, transparent)"),
        ),
        ("border-bottom", format!("2px solid {color}")),
        ("cursor", "text".into()),
    ] {
        if shell
            .style(property)
            .is_some_and(|value| value.trim() == expected)
        {
            shell.set_style(property, None);
        }
    }
    if shell.attributes.is_empty() {
        None
    } else {
        Some(shell)
    }
}
