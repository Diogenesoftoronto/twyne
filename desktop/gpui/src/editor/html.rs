use html5ever::tokenizer::{
    BufferQueue, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, states::RawKind,
};
use html5ever::{QualName, local_name, namespace_url, ns, parse_fragment, tendril::TendrilSink};
use markup5ever_rcdom::{Handle, NodeData as DomNodeData, RcDom};

use super::{EditorError, ElementShell, HtmlAttribute, Node, NodeData, RichDocument};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HtmlLimits {
    pub bytes: usize,
    pub nodes: usize,
    pub scalars: usize,
    pub depth: usize,
}

/// One original 10MiB image still fits after the web image extension duplicates
/// its base64 src in the figure's raw metadata and its img child. Text/tree
/// limits remain independent of that larger binary-attribute allowance.
pub const HTML_LIMITS: HtmlLimits = HtmlLimits {
    bytes: 32 * 1024 * 1024,
    nodes: 200_000,
    scalars: 5 * 1024 * 1024,
    depth: 512,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HtmlUsage {
    pub bytes: usize,
    pub nodes: usize,
    /// Text scalars, including preserved non-content/atom descendants. Large
    /// encoded image/source attributes count against bytes, not visible text.
    pub scalars: usize,
    pub depth: usize,
}

#[derive(Clone, Debug)]
pub struct HtmlImport {
    pub document: RichDocument,
    /// HTML5 recovery warnings are visible to the importing application. The
    /// recovered tree follows the same parsing rules as the web editor.
    pub warnings: Vec<String>,
}

impl RichDocument {
    pub fn from_html(html: &str) -> Result<Self, EditorError> {
        Ok(Self::import_html(html)?.document)
    }

    pub fn import_html(html: &str) -> Result<HtmlImport, EditorError> {
        Self::import_html_with_block_whitespace(html, true)
    }

    /// Native inline slices already have authored whitespace and no document
    /// block context. Keep their root text exactly when decoding a rich copy.
    pub(super) fn from_inline_fragment_html(html: &str) -> Result<Self, EditorError> {
        Ok(Self::import_html_with_block_whitespace(html, false)?.document)
    }

    fn import_html_with_block_whitespace(
        html: &str,
        ignore_block_whitespace: bool,
    ) -> Result<HtmlImport, EditorError> {
        if html.len() > HTML_LIMITS.bytes {
            return Err(EditorError::HtmlTooLarge);
        }
        preflight_tokens(html)?;
        let dom = parse_fragment(
            RcDom::default(),
            Default::default(),
            QualName::new(None, ns!(html), local_name!("body")),
            Vec::new(),
        )
        .one(html);
        let mut nodes = Vec::new();
        for child in dom.document.children.borrow().iter() {
            // RcDom's fragment root is an artificial HTML element, not part
            // of the supplied fragment. Keep actual descendants, attributes
            // and namespaces without adding a synthetic wrapper on export.
            if matches!(&child.data, DomNodeData::Element { name, .. } if name.local.as_ref() == "html")
            {
                for node in child.children.borrow().iter() {
                    if let Some(node) = convert_node(node, 0)? {
                        nodes.push(node);
                    }
                }
            } else if let Some(node) = convert_node(child, 0)? {
                nodes.push(node);
            }
        }
        // ProseMirror's document parser ignores whitespace-only DOM text
        // between top-level blocks. Retaining it as an editable text block
        // would manufacture an empty paragraph on the first visual edit.
        // Do not apply this to paragraphs/pre/code, NBSP or meaningful text.
        if ignore_block_whitespace {
            nodes.retain(|node| {
                !node.as_text().is_some_and(|text| {
                    text.chars()
                        .all(|character| matches!(character, ' ' | '\t' | '\r' | '\n' | '\u{000c}'))
                })
            });
        }
        if nodes.is_empty() {
            nodes.push(Node::paragraph(Vec::new()));
        }
        let document = Self::new(nodes);
        document.validate_html_limits()?;
        let mut warnings: Vec<_> = dom
            .errors
            .iter()
            .take(256)
            .map(ToString::to_string)
            .collect();
        if dom.errors.len() > warnings.len() {
            warnings.push(format!(
                "{} further HTML5 recovery warnings omitted",
                dom.errors.len() - warnings.len()
            ));
        }
        Ok(HtmlImport { document, warnings })
    }

    /// Normalized HTML, preserving the visual projection's semantic tree and
    /// all unknown metadata. No Typst source or Markdown is generated here.
    pub fn to_html(&self) -> String {
        let mut result = String::new();
        for node in self.nodes() {
            write_node(node, &mut result, false);
        }
        result
    }
}

fn convert_node(handle: &Handle, depth: usize) -> Result<Option<Node>, EditorError> {
    if depth > HTML_LIMITS.depth {
        return Err(EditorError::HtmlTooDeep);
    }
    match &handle.data {
        DomNodeData::Text { contents } => Ok(Some(Node::text(contents.borrow().to_string()))),
        DomNodeData::Comment { contents } => Ok(Some(Node::comment(contents.to_string()))),
        DomNodeData::Element {
            name,
            attrs,
            template_contents,
            ..
        } => {
            let mut children = Vec::new();
            for child in handle.children.borrow().iter() {
                if let Some(child) = convert_node(child, depth + 1)? {
                    children.push(child);
                }
            }
            if let Some(contents) = template_contents.borrow().as_ref() {
                for child in contents.children.borrow().iter() {
                    if let Some(child) = convert_node(child, depth + 1)? {
                        children.push(child);
                    }
                }
            }
            let attributes = attrs
                .borrow()
                .iter()
                .map(|attribute| HtmlAttribute {
                    name: attribute.name.prefix.as_ref().map_or_else(
                        || attribute.name.local.to_string(),
                        |prefix| format!("{prefix}:{}", attribute.name.local),
                    ),
                    namespace: attribute.name.ns.to_string(),
                    value: attribute.value.to_string(),
                })
                .collect();
            let shell = ElementShell {
                tag: name.prefix.as_ref().map_or_else(
                    || name.local.to_string(),
                    |prefix| format!("{prefix}:{}", name.local),
                ),
                namespace: name.ns.to_string(),
                attributes,
            };
            Ok(Some(Node::element(shell, children)))
        }
        // A fragment doctype has no visual-editor semantics. Browser fragment
        // parsing discards it too; document-level metadata lives in workspace.
        DomNodeData::Document
        | DomNodeData::Doctype { .. }
        | DomNodeData::ProcessingInstruction { .. } => Ok(None),
    }
}

pub(crate) fn validate_usage(usage: HtmlUsage) -> Result<(), EditorError> {
    if usage.bytes > HTML_LIMITS.bytes {
        Err(EditorError::HtmlTooLarge)
    } else if usage.nodes > HTML_LIMITS.nodes {
        Err(EditorError::HtmlTooManyNodes)
    } else if usage.scalars > HTML_LIMITS.scalars {
        Err(EditorError::HtmlTooMuchText)
    } else if usage.depth > HTML_LIMITS.depth {
        Err(EditorError::HtmlTooDeep)
    } else {
        Ok(())
    }
}

pub(crate) fn text_usage(text: &str, scalars: usize) -> HtmlUsage {
    HtmlUsage {
        bytes: escaped_len(text, false),
        nodes: 1,
        scalars,
        depth: 0,
    }
}

pub(crate) fn forest_usage(nodes: &[Node]) -> HtmlUsage {
    nodes.iter().fold(HtmlUsage::default(), |mut total, node| {
        let usage = node.html_usage();
        total.bytes = total.bytes.saturating_add(usage.bytes);
        total.nodes = total.nodes.saturating_add(usage.nodes);
        total.scalars = total.scalars.saturating_add(usage.scalars);
        total.depth = total.depth.max(usage.depth);
        total
    })
}

pub(crate) fn element_usage(shell: &ElementShell, children: &[Node]) -> HtmlUsage {
    let mut usage = forest_usage(children);
    usage.nodes = usage.nodes.saturating_add(1);
    if !children.is_empty() {
        usage.depth = usage.depth.saturating_add(1);
    }
    let mut bytes = shell.tag.len().saturating_add(2);
    for attribute in &shell.attributes {
        bytes = bytes
            .saturating_add(attribute.name.len())
            .saturating_add(4)
            .saturating_add(escaped_len(&attribute.value, true));
    }
    if !void_element(shell) {
        let raw = raw_element(shell);
        for child in children {
            bytes = bytes.saturating_add(child.html_bytes(raw));
        }
        bytes = bytes.saturating_add(shell.tag.len()).saturating_add(3);
    }
    usage.bytes = bytes;
    usage
}

fn escaped_len(value: &str, attribute: bool) -> usize {
    value.chars().fold(0usize, |length, character| {
        length.saturating_add(match (character, attribute) {
            ('&', _) => 5,
            ('<' | '>', false) => 4,
            ('"' | '\u{a0}', true) => 6,
            _ => character.len_utf8(),
        })
    })
}

fn void_element(shell: &ElementShell) -> bool {
    shell.namespace == "http://www.w3.org/1999/xhtml"
        && matches!(
            shell.tag.as_str(),
            "area"
                | "base"
                | "br"
                | "col"
                | "embed"
                | "hr"
                | "img"
                | "input"
                | "link"
                | "meta"
                | "param"
                | "source"
                | "track"
                | "wbr"
        )
}

fn raw_element(shell: &ElementShell) -> bool {
    shell.namespace == "http://www.w3.org/1999/xhtml"
        && matches!(
            shell.tag.as_str(),
            "script" | "style" | "xmp" | "iframe" | "noembed" | "noframes" | "plaintext"
        )
}

#[derive(Default)]
struct TokenBudget {
    nodes: usize,
    scalars: usize,
    in_text: bool,
    error: Option<EditorError>,
}

impl TokenSink for TokenBudget {
    type Handle = ();

    fn process_token(&mut self, token: Token, _: u64) -> TokenSinkResult<()> {
        let mut result = TokenSinkResult::Continue;
        match token {
            Token::TagToken(tag) => {
                self.in_text = false;
                if tag.kind == TagKind::StartTag {
                    self.nodes += 1;
                    result = match tag.name.as_ref() {
                        "script" => TokenSinkResult::RawData(RawKind::ScriptData),
                        "style" | "xmp" | "iframe" | "noembed" | "noframes" => {
                            TokenSinkResult::RawData(RawKind::Rawtext)
                        }
                        "title" | "textarea" => TokenSinkResult::RawData(RawKind::Rcdata),
                        "plaintext" => TokenSinkResult::Plaintext,
                        _ => TokenSinkResult::Continue,
                    };
                }
            }
            Token::CharacterTokens(text) => {
                self.nodes += usize::from(!self.in_text);
                self.in_text = true;
                self.scalars = self.scalars.saturating_add(text.chars().count());
            }
            Token::NullCharacterToken => {
                self.nodes += usize::from(!self.in_text);
                self.in_text = true;
                self.scalars += 1;
            }
            Token::CommentToken(_) => {
                self.in_text = false;
                self.nodes += 1;
            }
            _ => {}
        }
        if self.nodes > HTML_LIMITS.nodes {
            self.error = Some(EditorError::HtmlTooManyNodes);
        } else if self.scalars > HTML_LIMITS.scalars {
            self.error = Some(EditorError::HtmlTooMuchText);
        }
        result
    }
}

fn preflight_tokens(html: &str) -> Result<(), EditorError> {
    let mut input = BufferQueue::default();
    let mut tokenizer = Tokenizer::new(TokenBudget::default(), Default::default());
    let mut offset = 0;
    while offset < html.len() {
        let mut end = (offset + 16 * 1024).min(html.len());
        while !html.is_char_boundary(end) {
            end -= 1;
        }
        input.push_back(html[offset..end].into());
        let _ = tokenizer.feed(&mut input);
        // Character/comment tokens must return Continue. Feeding bounded
        // chunks gives a supported early exit without allocating any DOM.
        if let Some(error) = tokenizer.sink.error.take() {
            return Err(error);
        }
        offset = end;
    }
    tokenizer.end();
    tokenizer.sink.error.map_or(Ok(()), Err)
}

fn write_node(node: &Node, output: &mut String, raw_text: bool) {
    match node.data() {
        NodeData::Text(text) => {
            if raw_text {
                output.push_str(text);
            } else {
                escape_text(text, output);
            }
        }
        NodeData::Comment(comment) => {
            output.push_str("<!--");
            output.push_str(comment);
            output.push_str("-->");
        }
        NodeData::Element(element) => {
            output.push('<');
            output.push_str(&element.shell.tag);
            for attribute in &element.shell.attributes {
                output.push(' ');
                output.push_str(&attribute.name);
                output.push_str("=\"");
                escape_attribute(&attribute.value, output);
                output.push('"');
            }
            output.push('>');
            if void_element(&element.shell) {
                return;
            }
            let raw_text = raw_element(&element.shell);
            for child in &element.children {
                write_node(child, output, raw_text);
            }
            output.push_str("</");
            output.push_str(&element.shell.tag);
            output.push('>');
        }
    }
}

fn escape_text(value: &str, output: &mut String) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(character),
        }
    }
}

fn escape_attribute(value: &str, output: &mut String) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '"' => output.push_str("&quot;"),
            '\u{a0}' => output.push_str("&nbsp;"),
            _ => output.push(character),
        }
    }
}
