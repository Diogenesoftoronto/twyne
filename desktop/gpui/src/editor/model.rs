use std::{collections::BTreeMap, fmt, ops::Range, sync::Arc};

/// A scalar position in the document's editing projection.
pub type TextOffset = usize;
pub type NodePath = Vec<usize>;
pub const OBJECT_REPLACEMENT_CHARACTER: char = '\u{fffc}';

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Selection {
    pub anchor: TextOffset,
    pub head: TextOffset,
}

impl Selection {
    pub const fn caret(offset: TextOffset) -> Self {
        Self {
            anchor: offset,
            head: offset,
        }
    }

    pub const fn new(anchor: TextOffset, head: TextOffset) -> Self {
        Self { anchor, head }
    }

    pub fn range(self) -> Range<TextOffset> {
        self.anchor.min(self.head)..self.anchor.max(self.head)
    }

    pub fn is_empty(self) -> bool {
        self.anchor == self.head
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListKind {
    Bullet,
    Ordered,
    Task,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteKind {
    Endnote,
    Footnote,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathDisplay {
    Inline,
    Block,
}

/// Typed semantics over the preserved HTML element. Unknown elements remain
/// elements rather than being converted to plain text or discarded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NodeKind {
    Paragraph,
    Heading(u8),
    BlockQuote,
    List(ListKind),
    ListItem { task: bool },
    CodeBlock,
    Table,
    TableSection,
    TableRow,
    TableCell { header: bool },
    Image,
    Math(MathDisplay),
    RawTypst(MathDisplay),
    Mermaid,
    Note(NoteKind),
    PageBreak,
    HorizontalRule,
    HardBreak,
    Inline,
    UnknownBlock,
    UnknownInline,
    Opaque,
    NonContent,
}

pub type BlockKind = NodeKind;

impl NodeKind {
    pub fn is_atom(&self) -> bool {
        matches!(
            self,
            Self::Image
                | Self::Math(_)
                | Self::RawTypst(_)
                | Self::Mermaid
                | Self::Note(_)
                | Self::PageBreak
                | Self::HorizontalRule
                | Self::Opaque
        )
    }

    pub fn is_block(&self) -> bool {
        matches!(
            self,
            Self::Paragraph
                | Self::Heading(_)
                | Self::BlockQuote
                | Self::List(_)
                | Self::ListItem { .. }
                | Self::CodeBlock
                | Self::Table
                | Self::TableSection
                | Self::TableRow
                | Self::TableCell { .. }
                | Self::Image
                | Self::Math(MathDisplay::Block)
                | Self::RawTypst(MathDisplay::Block)
                | Self::Mermaid
                | Self::PageBreak
                | Self::HorizontalRule
                | Self::UnknownBlock
        )
    }
}

/// Attribute order, namespace and qualified names survive import/export.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HtmlAttribute {
    pub name: String,
    pub namespace: String,
    pub value: String,
}

impl HtmlAttribute {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            namespace: String::new(),
            value: value.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ElementShell {
    pub tag: String,
    pub namespace: String,
    pub attributes: Vec<HtmlAttribute>,
}

impl ElementShell {
    pub fn html(tag: impl Into<String>) -> Self {
        Self {
            tag: tag.into(),
            namespace: "http://www.w3.org/1999/xhtml".into(),
            attributes: Vec::new(),
        }
    }

    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|attr| attr.name.eq_ignore_ascii_case(name))
            .map(|attr| attr.value.as_str())
    }

    pub fn set_attr(&mut self, name: &str, value: impl Into<String>) {
        let value = value.into();
        if let Some(attr) = self
            .attributes
            .iter_mut()
            .find(|attr| attr.name.eq_ignore_ascii_case(name))
        {
            attr.value = value;
        } else {
            self.attributes.push(HtmlAttribute::new(name, value));
        }
    }

    pub fn remove_attr(&mut self, name: &str) {
        self.attributes
            .retain(|attr| !attr.name.eq_ignore_ascii_case(name));
    }

    pub fn style(&self, property: &str) -> Option<String> {
        self.attr("style").and_then(|style| {
            style_declarations(style)
                .into_iter()
                .rev()
                .find(|(name, _)| name.eq_ignore_ascii_case(property))
                .map(|(_, value)| value)
        })
    }

    /// Only the requested CSS property changes; unrelated/future declarations
    /// and review metadata remain attached to their original element.
    pub fn set_style(&mut self, property: &str, value: Option<&str>) {
        let mut declarations = self
            .attr("style")
            .map(style_declarations)
            .unwrap_or_default();
        if value.is_none()
            && !declarations
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case(property))
        {
            return;
        }
        declarations.retain(|(name, _)| !name.eq_ignore_ascii_case(property));
        if let Some(value) = value {
            declarations.push((property.to_string(), value.to_string()));
        }
        if declarations.is_empty() {
            self.remove_attr("style");
        } else {
            self.set_attr(
                "style",
                declarations
                    .into_iter()
                    .map(|(name, value)| format!("{name}: {value}"))
                    .collect::<Vec<_>>()
                    .join("; ")
                    + ";",
            );
        }
    }

    pub fn kind(&self) -> NodeKind {
        match self.attr("data-type") {
            Some("raw-typst") => return NodeKind::RawTypst(MathDisplay::Block),
            Some("raw-typst-inline") => return NodeKind::RawTypst(MathDisplay::Inline),
            Some("inline-math") => return NodeKind::Math(MathDisplay::Inline),
            Some("block-math") => return NodeKind::Math(MathDisplay::Block),
            Some("mermaid-diagram") => return NodeKind::Mermaid,
            Some("footnote") => return NodeKind::Note(NoteKind::Footnote),
            Some("endnote") => return NodeKind::Note(NoteKind::Endnote),
            Some("page-break") => return NodeKind::PageBreak,
            Some("image") if self.tag == "figure" => return NodeKind::Image,
            Some("taskList") => return NodeKind::List(ListKind::Task),
            Some("taskItem") => return NodeKind::ListItem { task: true },
            _ => {}
        }
        if self.attr("data-page-break") == Some("true") {
            return NodeKind::PageBreak;
        }
        if self.attr("data-latex").is_some() {
            if self.attr("data-math-display") == Some("block") {
                return NodeKind::Math(MathDisplay::Block);
            }
            if self.attr("data-math-display") == Some("inline") {
                return NodeKind::Math(MathDisplay::Inline);
            }
        }
        match self.tag.as_str() {
            "p" => NodeKind::Paragraph,
            "h1" => NodeKind::Heading(1),
            "h2" => NodeKind::Heading(2),
            "h3" => NodeKind::Heading(3),
            "h4" => NodeKind::Heading(4),
            "h5" => NodeKind::Heading(5),
            "h6" => NodeKind::Heading(6),
            "blockquote" => NodeKind::BlockQuote,
            "ul" => NodeKind::List(ListKind::Bullet),
            "ol" => NodeKind::List(ListKind::Ordered),
            "li" => NodeKind::ListItem { task: false },
            "pre" => NodeKind::CodeBlock,
            "table" => NodeKind::Table,
            "thead" | "tbody" | "tfoot" => NodeKind::TableSection,
            "tr" => NodeKind::TableRow,
            "th" => NodeKind::TableCell { header: true },
            "td" => NodeKind::TableCell { header: false },
            "figure" | "img" => NodeKind::Image,
            "hr" => NodeKind::HorizontalRule,
            "br" => NodeKind::HardBreak,
            "head" | "script" | "style" | "title" | "meta" | "link" | "template" => {
                NodeKind::NonContent
            }
            "div" | "section" | "article" | "aside" | "address" | "header" | "footer" | "main"
            | "nav" | "details" | "summary" | "dl" | "dt" | "dd" | "figcaption" => {
                if self.attr("contenteditable") == Some("false") {
                    NodeKind::Opaque
                } else {
                    NodeKind::UnknownBlock
                }
            }
            "a" | "strong" | "b" | "em" | "i" | "u" | "s" | "del" | "strike" | "mark" | "sub"
            | "sup" | "span" | "code" => {
                if self.attr("contenteditable") == Some("false") {
                    NodeKind::Opaque
                } else {
                    NodeKind::Inline
                }
            }
            _ => {
                if self.attr("contenteditable") == Some("false") {
                    NodeKind::Opaque
                } else {
                    NodeKind::UnknownInline
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Element {
    pub shell: ElementShell,
    pub kind: NodeKind,
    pub children: Vec<Node>,
    pub is_text_block: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NodeData {
    Text(Arc<str>),
    Element(Element),
    Comment(Arc<str>),
}

/// Persistent node with a cached editing-projection length. Cloning a node
/// never copies its text, descendants, or embedded image/source data.
#[derive(Clone, Debug)]
pub struct Node {
    data: Arc<NodeData>,
    projection_len: usize,
    projection_len_utf16: usize,
    note_counts: [usize; 2],
    html_usage: super::HtmlUsage,
    raw_html_bytes: usize,
}

impl PartialEq for Node {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.data, &other.data)
            || (self.projection_len == other.projection_len && self.data == other.data)
    }
}
impl Eq for Node {}

impl Node {
    pub fn text(value: impl Into<Arc<str>>) -> Self {
        let value = value.into();
        let projection_len = value.chars().count();
        let projection_len_utf16 = value.encode_utf16().count();
        let html_usage = super::html::text_usage(&value, projection_len);
        let raw_html_bytes = value.len();
        Self {
            data: Arc::new(NodeData::Text(value)),
            projection_len,
            projection_len_utf16,
            note_counts: [0; 2],
            html_usage,
            raw_html_bytes,
        }
    }

    pub fn comment(value: impl Into<Arc<str>>) -> Self {
        let value = value.into();
        let html_usage = super::HtmlUsage {
            bytes: value.len().saturating_add(7),
            nodes: 1,
            ..Default::default()
        };
        Self {
            data: Arc::new(NodeData::Comment(value)),
            projection_len: 0,
            projection_len_utf16: 0,
            note_counts: [0; 2],
            html_usage,
            raw_html_bytes: html_usage.bytes,
        }
    }

    pub fn element(shell: ElementShell, children: Vec<Node>) -> Self {
        let kind = shell.kind();
        let is_text_block = matches!(
            kind,
            NodeKind::Paragraph | NodeKind::Heading(_) | NodeKind::CodeBlock
        ) || (matches!(
            kind,
            NodeKind::TableCell { .. } | NodeKind::ListItem { .. } | NodeKind::UnknownBlock
        ) && !children.iter().any(|child| {
            child
                .as_element()
                .is_some_and(|element| element.kind.is_block())
        }));
        let projection_len = if matches!(kind, NodeKind::NonContent) {
            0
        } else if kind.is_atom() || matches!(kind, NodeKind::HardBreak) {
            1
        } else {
            children.iter().map(Self::projection_len).sum::<usize>() + usize::from(is_text_block)
        };
        let projection_len_utf16 = if matches!(kind, NodeKind::NonContent) {
            0
        } else if kind.is_atom() || matches!(kind, NodeKind::HardBreak) {
            1
        } else {
            children
                .iter()
                .map(Self::projection_len_utf16)
                .sum::<usize>()
                + usize::from(is_text_block)
        };
        let note_counts = match kind {
            NodeKind::Note(NoteKind::Endnote) => [1, 0],
            NodeKind::Note(NoteKind::Footnote) => [0, 1],
            NodeKind::NonContent => [0; 2],
            _ if kind.is_atom() => [0; 2],
            _ => children.iter().fold([0; 2], |mut counts, child| {
                for (count, child_count) in counts.iter_mut().zip(child.note_counts) {
                    *count += child_count;
                }
                counts
            }),
        };
        let html_usage = super::html::element_usage(&shell, &children);
        Self {
            data: Arc::new(NodeData::Element(Element {
                shell,
                kind,
                children,
                is_text_block,
            })),
            projection_len,
            projection_len_utf16,
            note_counts,
            html_usage,
            raw_html_bytes: html_usage.bytes,
        }
    }

    pub fn paragraph(children: Vec<Node>) -> Self {
        Self::element(ElementShell::html("p"), children)
    }
    pub fn data(&self) -> &NodeData {
        &self.data
    }
    pub(crate) fn html_usage(&self) -> super::HtmlUsage {
        self.html_usage
    }
    pub(crate) fn html_bytes(&self, raw_text: bool) -> usize {
        if raw_text {
            self.raw_html_bytes
        } else {
            self.html_usage.bytes
        }
    }
    pub fn as_element(&self) -> Option<&Element> {
        if let NodeData::Element(element) = self.data() {
            Some(element)
        } else {
            None
        }
    }
    pub fn as_text(&self) -> Option<&str> {
        if let NodeData::Text(text) = self.data() {
            Some(text)
        } else {
            None
        }
    }
    pub fn projection_len(&self) -> usize {
        self.projection_len
    }
    pub fn projection_len_utf16(&self) -> usize {
        self.projection_len_utf16
    }
    /// Counts visible reference atoms without traversing their descendants.
    pub fn note_count(&self, kind: NoteKind) -> usize {
        self.note_counts()[usize::from(kind == NoteKind::Footnote)]
    }
    pub(crate) fn note_counts(&self) -> [usize; 2] {
        self.note_counts
    }
    pub fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.data, &other.data)
    }
    pub fn payload_len(&self) -> usize {
        self.projection_len
            - usize::from(
                self.as_element()
                    .is_some_and(|element| element.is_text_block),
            )
    }

    pub(crate) fn write_editing_text(&self, output: &mut String) {
        match self.data() {
            NodeData::Text(text) => output.push_str(text),
            NodeData::Comment(_) => {}
            NodeData::Element(element) => {
                if element.kind == NodeKind::NonContent {
                    return;
                }
                if element.kind == NodeKind::HardBreak {
                    output.push('\n');
                } else if element.kind.is_atom() {
                    output.push(OBJECT_REPLACEMENT_CHARACTER);
                } else {
                    for child in &element.children {
                        child.write_editing_text(output);
                    }
                    if element.is_text_block {
                        output.push('\n');
                    }
                }
            }
        }
    }

    fn write_plain_text(&self, output: &mut String) {
        match self.data() {
            NodeData::Text(text) => output.push_str(text),
            NodeData::Comment(_) => {}
            NodeData::Element(element) => {
                match &element.kind {
                    NodeKind::NonContent => return,
                    NodeKind::HardBreak => {
                        output.push('\n');
                        return;
                    }
                    NodeKind::Image => {
                        let alt = element
                            .shell
                            .attr("data-alt-text")
                            .or_else(|| find_attribute(&element.children, "img", "alt"));
                        output.push_str("[Image");
                        if let Some(alt) = alt.filter(|value| !value.is_empty()) {
                            output.push_str(": ");
                            output.push_str(alt);
                        }
                        output.push(']');
                    }
                    NodeKind::Math(display) => {
                        let delimiter = if *display == MathDisplay::Inline {
                            "$"
                        } else {
                            "$$"
                        };
                        output.push_str(delimiter);
                        output.push_str(element.shell.attr("data-latex").unwrap_or(""));
                        output.push_str(delimiter);
                    }
                    NodeKind::RawTypst(_) => {
                        output.push_str(element.shell.attr("data-typst-source").unwrap_or(""))
                    }
                    NodeKind::Mermaid => {
                        output.push_str(element.shell.attr("data-mermaid-source").unwrap_or(""))
                    }
                    NodeKind::Note(_) => {}
                    NodeKind::PageBreak | NodeKind::HorizontalRule => output.push('\n'),
                    NodeKind::Opaque => output.push(OBJECT_REPLACEMENT_CHARACTER),
                    _ => {
                        for child in &element.children {
                            child.write_plain_text(output);
                        }
                    }
                }
                if element.is_text_block || (element.kind.is_atom() && element.kind.is_block()) {
                    output.push('\n');
                }
            }
        }
    }
}

fn find_attribute<'a>(nodes: &'a [Node], tag: &str, attribute: &str) -> Option<&'a str> {
    for node in nodes {
        if let Some(element) = node.as_element() {
            if element.shell.tag == tag
                && let Some(value) = element.shell.attr(attribute)
            {
                return Some(value);
            }
            if let Some(value) = find_attribute(&element.children, tag, attribute) {
                return Some(value);
            }
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DocumentRoot {
    nodes: Vec<Node>,
    projection_len: usize,
    projection_len_utf16: usize,
    html_usage: super::HtmlUsage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichDocument {
    root: Arc<DocumentRoot>,
}

impl Default for RichDocument {
    fn default() -> Self {
        Self::new(vec![Node::paragraph(Vec::new())])
    }
}

impl RichDocument {
    pub fn new(nodes: Vec<Node>) -> Self {
        let projection_len = nodes.iter().map(Node::projection_len).sum();
        let projection_len_utf16 = nodes.iter().map(Node::projection_len_utf16).sum();
        let html_usage = super::html::forest_usage(&nodes);
        Self {
            root: Arc::new(DocumentRoot {
                nodes,
                projection_len,
                projection_len_utf16,
                html_usage,
            }),
        }
    }

    pub fn from_plain_text(text: &str) -> Self {
        Self::new(
            text.split('\n')
                .map(|line| Node::paragraph(vec![Node::text(line)]))
                .collect(),
        )
    }

    pub fn nodes(&self) -> &[Node] {
        &self.root.nodes
    }
    pub fn text_len(&self) -> usize {
        self.root.projection_len
    }
    pub fn text_len_utf16(&self) -> usize {
        self.root.projection_len_utf16
    }
    /// Cached exact normalized-HTML size and independent tree/text limits.
    /// Reads do not serialize HTML or walk the manuscript's descendants.
    pub fn html_usage(&self) -> super::HtmlUsage {
        self.root.html_usage
    }
    pub fn validate_html_limits(&self) -> Result<(), EditorError> {
        super::html::validate_usage(self.html_usage())
    }

    /// Converts against cached subtree lengths. Only the text leaf containing
    /// an offset is traversed; no whole-document UTF-16 conversion is needed.
    pub fn scalar_to_utf16(&self, offset: usize) -> Option<usize> {
        if offset > self.text_len() {
            return None;
        }
        convert_offset(self.nodes(), offset, false)
    }

    /// `None` means an invalid UTF-16 surrogate boundary or out-of-range
    /// position. Native adapters may explicitly snap to a valid boundary.
    pub fn utf16_to_scalar(&self, offset: usize) -> Option<usize> {
        if offset > self.text_len_utf16() {
            return None;
        }
        convert_offset(self.nodes(), offset, true)
    }

    pub fn editing_text(&self) -> String {
        let mut result = String::new();
        for node in self.nodes() {
            node.write_editing_text(&mut result);
        }
        result
    }

    pub fn plain_text(&self) -> String {
        let mut result = String::new();
        for node in self.nodes() {
            node.write_plain_text(&mut result);
        }
        if result.ends_with('\n') {
            result.pop();
        }
        result
    }

    /// Explicit-boundary counterpart of the current Twyne Tiptap `getText()`.
    /// Its schema serializers differ from Flow's PM `textBetween`: hard
    /// breaks emit LF, images emit their original alt label, and equations
    /// emit dollar-delimited source. Every PM block (including containers and
    /// empty atoms) contributes two LFs unless it starts at document position
    /// zero. DOM-only table sections and non-content wrappers are omitted.
    /// Unknown extension text serializers are not guessed. Never call this
    /// projection from the ordinary input/layout path.
    pub fn research_text(&self) -> String {
        fn content(node: &Node, at_start: bool, output: &mut String) {
            match node.data() {
                NodeData::Text(text) => output.push_str(text),
                NodeData::Comment(_) => {}
                NodeData::Element(element) => {
                    if element.kind == NodeKind::NonContent {
                        return;
                    }
                    if element.kind.is_block()
                        && element.kind != NodeKind::TableSection
                        && !at_start
                    {
                        output.push_str("\n\n");
                    }
                    match element.kind {
                        NodeKind::HardBreak => output.push('\n'),
                        NodeKind::Image => {
                            let alt = element
                                .children
                                .iter()
                                .find_map(|child| {
                                    child
                                        .as_element()
                                        .filter(|element| element.shell.tag == "img")
                                        .and_then(|element| element.shell.attr("alt"))
                                })
                                .or_else(|| element.shell.attr("data-alt-text"))
                                .unwrap_or("");
                            if alt.is_empty() {
                                output.push_str("[Image]");
                            } else {
                                output.push_str("[Image: ");
                                output.push_str(alt);
                                output.push(']');
                            }
                        }
                        NodeKind::Math(display) => {
                            let delimiter = if display == MathDisplay::Block {
                                "$$"
                            } else {
                                "$"
                            };
                            output.push_str(delimiter);
                            if let Some(source) = element.shell.attr("data-latex") {
                                output.push_str(source);
                            } else {
                                fn text(node: &Node, output: &mut String) {
                                    match node.data() {
                                        NodeData::Text(value) => output.push_str(value),
                                        NodeData::Element(element) => {
                                            for child in &element.children {
                                                text(child, output);
                                            }
                                        }
                                        NodeData::Comment(_) => {}
                                    }
                                }
                                for child in &element.children {
                                    text(child, output);
                                }
                            }
                            output.push_str(delimiter);
                        }
                        _ if element.kind.is_atom() => {}
                        _ => {
                            for child in &element.children {
                                content(child, false, output);
                            }
                        }
                    }
                }
            }
        }
        let mut output = String::new();
        let mut at_start = true;
        for node in self.nodes() {
            if matches!(node.data(), NodeData::Comment(_))
                || node
                    .as_element()
                    .is_some_and(|element| element.kind == NodeKind::NonContent)
            {
                continue;
            }
            content(node, at_start, &mut output);
            at_start = false;
        }
        output
    }

    /// Session-boundary counterpart of the current web PM document's
    /// `textBetween(0, doc.content.size, " ")`. Source/image/note atoms and
    /// hard-break leaves have no `leafText` in that schema and contribute no
    /// fallback labels. This traversal belongs at explicit start/end/save
    /// boundaries, not on the keystroke path.
    pub fn text_between_blocks(&self) -> String {
        fn visit(nodes: &[Node], first_block: &mut bool, output: &mut String) {
            for node in nodes {
                match node.data() {
                    NodeData::Text(text) => output.push_str(text),
                    NodeData::Comment(_) => {}
                    NodeData::Element(element) => {
                        if element.kind.is_atom()
                            || matches!(element.kind, NodeKind::NonContent | NodeKind::HardBreak)
                        {
                            continue;
                        }
                        if element.is_text_block {
                            if *first_block {
                                *first_block = false;
                            } else {
                                output.push(' ');
                            }
                        }
                        visit(&element.children, first_block, output);
                    }
                }
            }
        }
        let mut output = String::new();
        visit(self.nodes(), &mut true, &mut output);
        output
    }

    pub fn node(&self, path: &[usize]) -> Option<&Node> {
        let mut children = self.nodes();
        let mut result = None;
        for &index in path {
            let node = children.get(index)?;
            result = Some(node);
            children = node
                .as_element()
                .map_or(&[], |element| element.children.as_slice());
        }
        result
    }

    /// Native layout gets explicit block semantics, geometry attributes,
    /// annotation wrappers and inline objects, plus stable scalar ranges.
    pub fn blocks(&self) -> Vec<RichBlock> {
        let mut result = Vec::new();
        collect_blocks(self.nodes(), 0, &mut Vec::new(), &mut result);
        result
    }

    /// Cached sibling lengths resolve a path without projecting/scanning text.
    pub fn offset_of_node(&self, path: &[usize]) -> Option<usize> {
        let mut nodes = self.nodes();
        let mut offset = 0;
        for &index in path {
            let node = nodes.get(index)?;
            offset += nodes[..index]
                .iter()
                .map(Node::projection_len)
                .sum::<usize>();
            nodes = node
                .as_element()
                .map_or(&[], |element| element.children.as_slice());
        }
        Some(offset)
    }

    /// Endnote and footnote counter prefixes, in that order, using cached
    /// subtree counts. References renumber without projecting earlier text.
    pub fn note_counts_before_node(&self, path: &[usize]) -> Option<[usize; 2]> {
        let mut nodes = self.nodes();
        let mut counts = [0; 2];
        for &index in path {
            let node = nodes.get(index)?;
            for sibling in &nodes[..index] {
                for (count, sibling_count) in counts.iter_mut().zip(sibling.note_counts) {
                    *count += sibling_count;
                }
            }
            nodes = node
                .as_element()
                .map_or(&[], |element| element.children.as_slice());
        }
        Some(counts)
    }

    /// Rebuild just one native layout block after an edit/format transaction.
    pub fn block(&self, path: &[usize]) -> Option<RichBlock> {
        let node = self.node(path)?;
        let element = node.as_element()?;
        if !element.is_text_block && !element.kind.is_atom() {
            return None;
        }
        Some(rich_block(node, self.offset_of_node(path)?, path.to_vec()))
    }

    pub fn block_at_offset(&self, offset: usize) -> Option<RichBlock> {
        self.block_at(offset)
            .and_then(|location| self.block(&location.path))
    }

    /// Only overlapping subtrees are expanded into native runs. A layout cache
    /// can compare `Node::shares_storage_with` to retain untouched shaping.
    pub fn blocks_in_range(&self, range: Range<usize>) -> Vec<RichBlock> {
        fn visit(
            nodes: &[Node],
            start: usize,
            range: &Range<usize>,
            path: &mut NodePath,
            result: &mut Vec<RichBlock>,
        ) {
            let mut cursor = start;
            for (index, node) in nodes.iter().enumerate() {
                let end = cursor + node.projection_len();
                if cursor <= range.end && end > range.start {
                    path.push(index);
                    if let Some(element) = node.as_element() {
                        if element.is_text_block || element.kind.is_atom() {
                            result.push(rich_block(node, cursor, path.clone()));
                        } else if element.kind != NodeKind::NonContent {
                            visit(&element.children, cursor, range, path, result);
                        }
                    }
                    path.pop();
                }
                cursor = end;
            }
        }
        let mut result = Vec::new();
        visit(self.nodes(), 0, &range, &mut Vec::new(), &mut result);
        result
    }

    /// Native IME/clipboard adapters request a bounded projection slice; this
    /// never serializes HTML or derives the complete document.
    pub fn text_in_range(&self, range: Range<usize>) -> Result<String, EditorError> {
        if range.start > range.end || range.end > self.text_len() {
            return Err(EditorError::SelectionOutOfBounds {
                position: range.start.max(range.end),
                length: self.text_len(),
            });
        }
        fn visit(nodes: &[Node], start: usize, range: &Range<usize>, result: &mut String) {
            let mut cursor = start;
            for node in nodes {
                let end = cursor + node.projection_len();
                if cursor < range.end && end > range.start {
                    match node.data() {
                        NodeData::Text(text) => {
                            let from = range.start.saturating_sub(cursor);
                            let to = range.end.saturating_sub(cursor).min(node.projection_len());
                            let start =
                                utf8_offset_for_scalar(text, from).expect("bounded text range");
                            let end = utf8_offset_for_scalar(text, to).expect("bounded text range");
                            result.push_str(&text[start..end]);
                        }
                        NodeData::Comment(_) => {}
                        NodeData::Element(element) => {
                            if element.kind.is_atom() {
                                result.push(OBJECT_REPLACEMENT_CHARACTER);
                            } else if element.kind == NodeKind::HardBreak {
                                result.push('\n');
                            } else if element.kind != NodeKind::NonContent {
                                visit(&element.children, cursor, range, result);
                                if element.is_text_block && end > range.start && end - 1 < range.end
                                {
                                    result.push('\n');
                                }
                            }
                        }
                    }
                }
                cursor = end;
            }
        }
        let mut result = String::new();
        visit(self.nodes(), 0, &range, &mut result);
        Ok(result)
    }

    pub fn marks_at(&self, position: usize) -> Vec<Mark> {
        let Some(block) = self.block_at(position) else {
            return Vec::new();
        };
        let Some(element) = self.node(&block.path).and_then(Node::as_element) else {
            return Vec::new();
        };
        let relative = position
            .saturating_sub(block.start)
            .min(block.node.payload_len());
        let mut cursor = 0;
        let fragments = inline_fragments(&element.children);
        for fragment in fragments {
            let end = cursor + fragment.len();
            if (relative > cursor && relative <= end) || (relative == 0 && cursor == 0) {
                return fragment.marks();
            }
            cursor = end;
        }
        Vec::new()
    }

    pub(crate) fn block_at(&self, position: usize) -> Option<BlockLocation> {
        locate_block(
            self.nodes(),
            0,
            position.min(self.text_len()),
            &mut Vec::new(),
        )
    }

    pub(crate) fn replace_node(&self, path: &[usize], replacements: Vec<Node>) -> Option<Self> {
        replace_path(self.nodes(), path, &replacements).map(Self::new)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RichBlock {
    pub path: NodePath,
    pub kind: BlockKind,
    pub attributes: Vec<HtmlAttribute>,
    /// Text range excludes the block's synthetic terminal newline.
    pub range: Range<usize>,
    pub runs: Vec<InlineRun>,
    pub node: Node,
}

impl RichBlock {
    pub fn editing_text(&self) -> String {
        let mut text = String::new();
        self.node.write_editing_text(&mut text);
        if self
            .node
            .as_element()
            .is_some_and(|element| element.is_text_block)
        {
            text.pop();
        }
        text
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InlineRun {
    pub range: Range<usize>,
    pub content: RunContent,
    pub marks: Vec<Mark>,
    /// Original wrappers retain review anchors, links and future metadata.
    pub wrappers: Vec<ElementShell>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunContent {
    Text(Arc<str>),
    Object(Node),
    HardBreak,
    Comment(Arc<str>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarkKind {
    Bold,
    Italic,
    Underline,
    Strike,
    Highlight,
    FontFamily,
    FontSize,
    Color,
    Subscript,
    Superscript,
    Link,
    Code,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mark {
    Bold,
    Italic,
    Underline,
    Strike,
    Highlight(String),
    FontFamily(String),
    FontSize(String),
    Color(String),
    Subscript,
    Superscript,
    Link { href: String },
    Code,
}

impl Mark {
    pub fn kind(&self) -> MarkKind {
        match self {
            Self::Bold => MarkKind::Bold,
            Self::Italic => MarkKind::Italic,
            Self::Underline => MarkKind::Underline,
            Self::Strike => MarkKind::Strike,
            Self::Highlight(_) => MarkKind::Highlight,
            Self::FontFamily(_) => MarkKind::FontFamily,
            Self::FontSize(_) => MarkKind::FontSize,
            Self::Color(_) => MarkKind::Color,
            Self::Subscript => MarkKind::Subscript,
            Self::Superscript => MarkKind::Superscript,
            Self::Link { .. } => MarkKind::Link,
            Self::Code => MarkKind::Code,
        }
    }

    pub(crate) fn shell(&self) -> ElementShell {
        let mut shell = ElementShell::html(match self {
            Self::Bold => "strong",
            Self::Italic => "em",
            Self::Underline => "u",
            Self::Strike => "s",
            Self::Highlight(_) => "mark",
            Self::Subscript => "sub",
            Self::Superscript => "sup",
            Self::Link { .. } => "a",
            Self::Code => "code",
            _ => "span",
        });
        match self {
            Self::Highlight(color) => {
                shell.set_attr("data-color", color);
                shell.set_style("background-color", Some(color));
                shell.set_style("color", Some("inherit"));
            }
            Self::FontFamily(family) => shell.set_style("font-family", Some(family)),
            Self::FontSize(size) => shell.set_style("font-size", Some(size)),
            Self::Color(color) => shell.set_style("color", Some(color)),
            Self::Link { href } => {
                shell.set_attr("href", href);
                shell.set_attr("target", "_blank");
                shell.set_attr("rel", "noopener noreferrer");
                shell.set_attr("class", "editor-link");
            }
            _ => {}
        }
        shell
    }
}

/// Maps explicit offsets to UTF-8 only at the native input adapter boundary.
pub fn utf8_offset_for_scalar(text: &str, offset: usize) -> Option<usize> {
    text.char_indices()
        .map(|(byte, _)| byte)
        .chain(std::iter::once(text.len()))
        .nth(offset)
}

pub fn scalar_offset_for_utf8(text: &str, byte: usize) -> Option<usize> {
    if !text.is_char_boundary(byte) {
        return None;
    }
    Some(text.get(..byte)?.chars().count())
}

pub fn utf16_offset_for_scalar(text: &str, offset: usize) -> Option<usize> {
    (offset <= text.chars().count()).then(|| text.chars().take(offset).map(char::len_utf16).sum())
}

pub fn scalar_offset_for_utf16(text: &str, offset: usize) -> Option<usize> {
    let mut utf16 = 0;
    for (scalar, character) in text.chars().enumerate() {
        if utf16 == offset {
            return Some(scalar);
        }
        utf16 += character.len_utf16();
        if utf16 > offset {
            return None;
        }
    }
    (utf16 == offset).then(|| text.chars().count())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditorError {
    SelectionOutOfBounds { position: usize, length: usize },
    HtmlTooLarge,
    HtmlTooDeep,
    HtmlTooManyNodes,
    HtmlTooMuchText,
    InvalidHeading,
    InvalidTableSize,
    InvalidStyle(String),
    Clipboard(String),
    MissingTextBlock,
    UnsupportedStructure(&'static str),
    ReadOnly,
}

impl fmt::Display for EditorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SelectionOutOfBounds { position, length } => write!(
                formatter,
                "Selection offset {position} exceeds document length {length}"
            ),
            Self::HtmlTooLarge => {
                formatter.write_str("The visual HTML projection exceeds the 32 MiB document limit")
            }
            Self::HtmlTooDeep => {
                formatter.write_str("The visual HTML projection is nested too deeply")
            }
            Self::HtmlTooManyNodes => {
                formatter.write_str("The visual HTML projection exceeds the 200,000 node limit")
            }
            Self::HtmlTooMuchText => formatter
                .write_str("The visual HTML projection exceeds the 5,242,880 text scalar limit"),
            Self::InvalidHeading => formatter.write_str("Twyne headings have levels 1, 2, or 3"),
            Self::InvalidTableSize => {
                formatter.write_str("A table must have between 1 and 100 rows and columns")
            }
            Self::InvalidStyle(property) => write!(formatter, "Invalid value for {property}"),
            Self::Clipboard(reason) => formatter.write_str(reason),
            Self::MissingTextBlock => {
                formatter.write_str("The selection does not resolve to an editable text block")
            }
            Self::UnsupportedStructure(reason) => formatter.write_str(reason),
            Self::ReadOnly => formatter.write_str("The document is read-only"),
        }
    }
}
impl std::error::Error for EditorError {}

#[derive(Clone, Debug)]
pub(crate) struct BlockLocation {
    pub path: NodePath,
    pub start: usize,
    pub node: Node,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InlineFragment {
    pub content: RunContent,
    pub wrappers: Vec<ElementShell>,
}

impl InlineFragment {
    pub fn len(&self) -> usize {
        match &self.content {
            RunContent::Text(text) => text.chars().count(),
            RunContent::Comment(_) => 0,
            RunContent::Object(node) => node.projection_len(),
            RunContent::HardBreak => 1,
        }
    }
    pub fn marks(&self) -> Vec<Mark> {
        marks_from_wrappers(&self.wrappers)
    }
}

pub(crate) fn inline_fragments(nodes: &[Node]) -> Vec<InlineFragment> {
    fn visit(node: &Node, wrappers: &mut Vec<ElementShell>, result: &mut Vec<InlineFragment>) {
        let content = match node.data() {
            NodeData::Text(text) => Some(RunContent::Text(text.clone())),
            NodeData::Comment(comment) => Some(RunContent::Comment(comment.clone())),
            NodeData::Element(element) if element.kind == NodeKind::HardBreak => {
                Some(RunContent::HardBreak)
            }
            NodeData::Element(element)
                if element.kind.is_atom()
                    || element.kind.is_block()
                    || element.kind == NodeKind::NonContent =>
            {
                Some(RunContent::Object(node.clone()))
            }
            NodeData::Element(element) => {
                wrappers.push(element.shell.clone());
                if element.children.is_empty() {
                    // An empty custom inline element may carry an anchor. Keep
                    // it as an opaque zero-length fragment instead of losing it.
                    result.push(InlineFragment {
                        content: RunContent::Object(node.clone()),
                        wrappers: wrappers[..wrappers.len() - 1].to_vec(),
                    });
                } else {
                    for child in &element.children {
                        visit(child, wrappers, result);
                    }
                }
                wrappers.pop();
                None
            }
        };
        if let Some(content) = content {
            result.push(InlineFragment {
                content,
                wrappers: wrappers.clone(),
            });
        }
    }
    let mut result = Vec::new();
    for node in nodes {
        visit(node, &mut Vec::new(), &mut result);
    }
    result
}

/// Rebuild shared wrapper prefixes instead of duplicating review spans for
/// each leaf. Unchanged subtrees never pass through this reconstruction.
pub(crate) fn nodes_from_fragments(fragments: &[InlineFragment]) -> Vec<Node> {
    fn append(nodes: &mut Vec<Node>, wrappers: &[ElementShell], leaf: Node) {
        if let Some(shell) = wrappers.first() {
            if let Some(last) = nodes
                .last()
                .and_then(Node::as_element)
                .filter(|element| element.shell == *shell && !element.kind.is_atom())
            {
                let mut children = last.children.clone();
                append(&mut children, &wrappers[1..], leaf);
                let replacement = Node::element(shell.clone(), children);
                *nodes.last_mut().expect("last element exists") = replacement;
            } else {
                let mut children = Vec::new();
                append(&mut children, &wrappers[1..], leaf);
                nodes.push(Node::element(shell.clone(), children));
            }
        } else if let (Some(last), Some(text)) =
            (nodes.last().and_then(Node::as_text), leaf.as_text())
        {
            let combined = format!("{last}{text}");
            *nodes.last_mut().expect("last text exists") = Node::text(combined);
        } else {
            nodes.push(leaf);
        }
    }
    let mut result = Vec::new();
    for fragment in fragments {
        let leaf = match &fragment.content {
            RunContent::Text(text) => {
                if text.is_empty() {
                    continue;
                } else {
                    Node::text(text.clone())
                }
            }
            RunContent::Object(node) => node.clone(),
            RunContent::HardBreak => Node::element(ElementShell::html("br"), Vec::new()),
            RunContent::Comment(comment) => Node::comment(comment.clone()),
        };
        append(&mut result, &fragment.wrappers, leaf);
    }
    result
}

pub(crate) fn marks_from_wrappers(wrappers: &[ElementShell]) -> Vec<Mark> {
    let mut marks = BTreeMap::<u8, Mark>::new();
    for shell in wrappers {
        let mut insert = |mark: Mark| {
            marks.insert(mark.kind() as u8, mark);
        };
        match shell.tag.as_str() {
            "strong" | "b" => insert(Mark::Bold),
            "em" | "i" => insert(Mark::Italic),
            "u" => insert(Mark::Underline),
            "s" | "strike" | "del" => insert(Mark::Strike),
            "sub" => insert(Mark::Subscript),
            "sup" => insert(Mark::Superscript),
            "code" => insert(Mark::Code),
            "a" => {
                if let Some(href) = shell.attr("href") {
                    insert(Mark::Link { href: href.into() });
                }
            }
            "mark" => insert(Mark::Highlight(
                shell
                    .attr("data-color")
                    .map(str::to_string)
                    .or_else(|| shell.style("background-color"))
                    .unwrap_or_else(|| "#faf594".into()),
            )),
            _ => {}
        }
        if let Some(weight) = shell.style("font-weight")
            && (weight == "bold" || weight.parse::<u16>().is_ok_and(|weight| weight >= 600))
        {
            insert(Mark::Bold);
        }
        if shell.style("font-style").as_deref() == Some("italic") {
            insert(Mark::Italic);
        }
        if let Some(decoration) = shell
            .style("text-decoration")
            .or_else(|| shell.style("text-decoration-line"))
        {
            if decoration
                .split_whitespace()
                .any(|word| word == "underline")
            {
                insert(Mark::Underline);
            }
            if decoration
                .split_whitespace()
                .any(|word| word == "line-through")
            {
                insert(Mark::Strike);
            }
        }
        if let Some(value) = shell.style("font-family") {
            insert(Mark::FontFamily(value));
        }
        if let Some(value) = shell.style("font-size") {
            insert(Mark::FontSize(value));
        }
        if let Some(value) = shell.style("color")
            && !(shell.tag == "mark" && value == "inherit")
        {
            insert(Mark::Color(value));
        }
        if shell.tag != "mark"
            && let Some(value) = shell.style("background-color")
        {
            insert(Mark::Highlight(value));
        }
    }
    marks.into_values().collect()
}

pub(crate) fn collect_blocks(
    nodes: &[Node],
    start: usize,
    path: &mut NodePath,
    result: &mut Vec<RichBlock>,
) {
    let mut cursor = start;
    for (index, node) in nodes.iter().enumerate() {
        path.push(index);
        if let Some(element) = node.as_element() {
            if element.kind == NodeKind::NonContent {
                path.pop();
                continue;
            }
            if element.is_text_block || element.kind.is_atom() {
                result.push(rich_block(node, cursor, path.clone()));
            } else {
                collect_blocks(&element.children, cursor, path, result);
            }
        }
        path.pop();
        cursor += node.projection_len();
    }
}

pub(crate) fn rich_block(node: &Node, cursor: usize, path: NodePath) -> RichBlock {
    let element = node.as_element().expect("render block element");
    let mut run_cursor = cursor;
    let runs = if element.kind.is_atom() {
        vec![InlineRun {
            range: cursor..cursor + 1,
            content: RunContent::Object(node.clone()),
            marks: Vec::new(),
            wrappers: Vec::new(),
        }]
    } else {
        inline_fragments(&element.children)
            .into_iter()
            .map(|fragment| {
                let end = run_cursor + fragment.len();
                let run = InlineRun {
                    range: run_cursor..end,
                    marks: fragment.marks(),
                    content: fragment.content,
                    wrappers: fragment.wrappers,
                };
                run_cursor = end;
                run
            })
            .collect()
    };
    RichBlock {
        path,
        kind: element.kind.clone(),
        attributes: element.shell.attributes.clone(),
        range: cursor..cursor + node.payload_len(),
        runs,
        node: node.clone(),
    }
}

fn convert_offset(nodes: &[Node], mut remaining: usize, from_utf16: bool) -> Option<usize> {
    let mut converted = 0;
    for node in nodes {
        let (source_len, target_len) = if from_utf16 {
            (node.projection_len_utf16(), node.projection_len())
        } else {
            (node.projection_len(), node.projection_len_utf16())
        };
        if remaining >= source_len {
            remaining -= source_len;
            converted += target_len;
            continue;
        }
        let local = match node.data() {
            NodeData::Text(text) => {
                if from_utf16 {
                    scalar_offset_for_utf16(text, remaining)?
                } else {
                    utf16_offset_for_scalar(text, remaining)?
                }
            }
            NodeData::Comment(_) => 0,
            NodeData::Element(element) => {
                if element.kind.is_atom() || element.kind == NodeKind::HardBreak {
                    remaining
                } else {
                    convert_offset(&element.children, remaining, from_utf16)?
                }
            }
        };
        return Some(converted + local);
    }
    (remaining == 0).then_some(converted)
}

fn locate_block(
    nodes: &[Node],
    start: usize,
    position: usize,
    path: &mut NodePath,
) -> Option<BlockLocation> {
    let mut cursor = start;
    for (index, node) in nodes.iter().enumerate() {
        let end = cursor + node.projection_len();
        if (position < end || (index + 1 == nodes.len() && position == end))
            && let Some(element) = node.as_element()
        {
            path.push(index);
            let result = if element.is_text_block {
                Some(BlockLocation {
                    path: path.clone(),
                    start: cursor,
                    node: node.clone(),
                })
            } else if element.kind.is_atom() || element.kind == NodeKind::NonContent {
                None
            } else {
                locate_block(&element.children, cursor, position, path)
            };
            path.pop();
            if result.is_some() {
                return result;
            }
        }
        cursor = end;
    }
    None
}

fn replace_path(nodes: &[Node], path: &[usize], replacements: &[Node]) -> Option<Vec<Node>> {
    let (&index, rest) = path.split_first()?;
    let existing = nodes.get(index)?;
    let mut result = nodes.to_vec();
    if rest.is_empty() {
        result.splice(index..=index, replacements.iter().cloned());
    } else {
        let element = existing.as_element()?;
        let children = replace_path(&element.children, rest, replacements)?;
        result[index] = Node::element(element.shell.clone(), children);
    }
    Some(result)
}

/// CSS declarations are split outside quotes/parentheses, so changing a font
/// does not corrupt e.g. a future image/background data URL.
pub(crate) fn style_declarations(style: &str) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut beginning = 0;
    let mut quote = None;
    let mut depth = 0usize;
    let mut escaped = false;
    for (index, character) in style.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(expected) = quote {
            if character == expected {
                quote = None;
            }
            continue;
        }
        match character {
            '\'' | '"' => quote = Some(character),
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ';' if depth == 0 => {
                push_declaration(&style[beginning..index], &mut result);
                beginning = index + 1;
            }
            _ => {}
        }
    }
    push_declaration(&style[beginning..], &mut result);
    result
}

fn push_declaration(raw: &str, declarations: &mut Vec<(String, String)>) {
    if let Some((property, value)) = raw.split_once(':')
        && !property.trim().is_empty()
    {
        declarations.push((property.trim().into(), value.trim().into()));
    }
}
