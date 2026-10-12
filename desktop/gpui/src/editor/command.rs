use super::{
    EditorError, ElementShell, HtmlAttribute, ListKind, Mark, MarkKind, MathDisplay, Node,
    NodePath, NoteKind,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Alignment {
    Left,
    Center,
    Right,
    Justify,
}

impl Alignment {
    pub fn css(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Center => "center",
            Self::Right => "right",
            Self::Justify => "justify",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ParagraphFormat {
    /// `None` leaves a property unchanged; `Some(None)` restores the theme.
    pub line_height: Option<Option<String>>,
    pub space_before: Option<Option<f64>>,
    pub space_after: Option<Option<f64>>,
    pub keep_with_next: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InlineObject {
    Math {
        source: String,
    },
    RawTypst {
        source: String,
    },
    Note {
        kind: NoteKind,
        text: String,
    },
    HardBreak,
    /// An imported extension atom retains its original subtree/metadata.
    Preserved(Node),
}

impl InlineObject {
    pub fn node(&self) -> Node {
        match self {
            Self::Math { source } => math_node(source, MathDisplay::Inline),
            Self::RawTypst { source } => raw_typst_node(source, MathDisplay::Inline),
            Self::Note { kind, text } => {
                let mut shell = ElementShell::html("sup");
                shell.set_attr(
                    "data-type",
                    if *kind == NoteKind::Footnote {
                        "footnote"
                    } else {
                        "endnote"
                    },
                );
                shell.set_attr("class", "twyne-endnote");
                if !text.is_empty() {
                    shell.set_attr("data-endnote-text", text);
                    shell.set_attr("title", text);
                }
                Node::element(shell, Vec::new())
            }
            Self::HardBreak => Node::element(ElementShell::html("br"), Vec::new()),
            Self::Preserved(node) => node.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum BlockObject {
    Image(ImageAttributes),
    Math {
        source: String,
    },
    RawTypst {
        source: String,
    },
    Mermaid {
        source: String,
    },
    PageBreak,
    HorizontalRule,
    Table {
        rows: usize,
        columns: usize,
        header: bool,
    },
    Preserved(Node),
}

impl BlockObject {
    pub fn node(&self) -> Result<Node, EditorError> {
        Ok(match self {
            Self::Image(attributes) => attributes.node(),
            Self::Math { source } => math_node(source, MathDisplay::Block),
            Self::RawTypst { source } => raw_typst_node(source, MathDisplay::Block),
            Self::Mermaid { source } => {
                let mut shell = ElementShell::html("div");
                shell.set_attr("data-type", "mermaid-diagram");
                shell.set_attr("class", "mermaid twyne-mermaid-diagram");
                if !source.is_empty() {
                    shell.set_attr("data-mermaid-source", source);
                }
                Node::element(shell, vec![Node::text(source.as_str())])
            }
            Self::PageBreak => {
                let mut shell = ElementShell::html("div");
                shell.set_attr("data-type", "page-break");
                shell.set_attr("class", "twyne-page-break");
                shell.set_attr("data-page-break", "true");
                Node::element(shell, Vec::new())
            }
            Self::HorizontalRule => Node::element(ElementShell::html("hr"), Vec::new()),
            Self::Table {
                rows,
                columns,
                header,
            } => {
                if *rows == 0 || *columns == 0 || *rows > 100 || *columns > 100 {
                    return Err(EditorError::InvalidTableSize);
                }
                let row_nodes = (0..*rows)
                    .map(|row| {
                        Node::element(
                            ElementShell::html("tr"),
                            (0..*columns)
                                .map(|_| empty_cell(*header && row == 0))
                                .collect(),
                        )
                    })
                    .collect();
                Node::element(
                    ElementShell::html("table"),
                    vec![Node::element(ElementShell::html("tbody"), row_nodes)],
                )
            }
            Self::Preserved(node) => node.clone(),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageAlignment {
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ImageAttributes {
    pub src: String,
    pub alt: String,
    pub caption: String,
    pub alignment: ImageAlignment,
    pub width: u8,
    pub aspect_ratio: Option<f64>,
    pub image_id: Option<String>,
    pub offline: bool,
    pub upload_id: Option<String>,
    pub upload_status: String,
    pub upload_error: Option<String>,
    pub extra_attributes: Vec<HtmlAttribute>,
}

impl Default for ImageAttributes {
    fn default() -> Self {
        Self {
            src: String::new(),
            alt: String::new(),
            caption: String::new(),
            alignment: ImageAlignment::Center,
            width: 100,
            aspect_ratio: None,
            image_id: None,
            offline: false,
            upload_id: None,
            upload_status: "ready".into(),
            upload_error: None,
            extra_attributes: Vec::new(),
        }
    }
}

impl ImageAttributes {
    pub fn node(&self) -> Node {
        let mut shell = ElementShell::html("figure");
        shell.attributes = self.extra_attributes.clone();
        shell.set_attr("data-type", "image");
        let alignment = match self.alignment {
            ImageAlignment::Left => "left",
            ImageAlignment::Center => "center",
            ImageAlignment::Right => "right",
        };
        shell.set_attr("data-image-align", alignment);
        let width = self.width.clamp(10, 100);
        shell.set_attr("data-image-width", width.to_string());
        if let Some(ratio) = self
            .aspect_ratio
            .filter(|ratio| ratio.is_finite() && *ratio > 0.0)
        {
            shell.set_attr("data-image-aspect-ratio", ratio.to_string());
        }
        if let Some(id) = &self.image_id {
            shell.set_attr("data-image-id", id);
        }
        if self.offline {
            shell.set_attr("data-image-offline", "true");
        }
        if let Some(id) = &self.upload_id {
            shell.set_attr("data-upload-id", id);
        }
        shell.set_attr("data-upload-status", &self.upload_status);
        if let Some(error) = &self.upload_error {
            shell.set_attr("data-upload-error", error);
        }
        shell.set_attr("data-alt-text", &self.alt);
        let margins = match self.alignment {
            ImageAlignment::Left => "margin-left: 0; margin-right: auto;",
            ImageAlignment::Center => "margin-left: auto; margin-right: auto;",
            ImageAlignment::Right => "margin-left: auto; margin-right: 0;",
        };
        shell.set_attr("style", format!("width: {width}%; max-width: 100%; {margins} break-inside: avoid; page-break-inside: avoid;"));
        let mut image_shell = ElementShell::html("img");
        image_shell.set_attr("src", &self.src);
        image_shell.set_attr("alt", &self.alt);
        let ratio = self
            .aspect_ratio
            .filter(|ratio| ratio.is_finite() && *ratio > 0.0)
            .map(|ratio| format!(" aspect-ratio: {ratio};"))
            .unwrap_or_default();
        image_shell.set_attr(
            "style",
            format!("display: block; width: 100%; height: auto;{ratio}"),
        );
        let mut children = vec![Node::element(image_shell, Vec::new())];
        if !self.caption.is_empty() {
            children.push(Node::element(
                ElementShell::html("figcaption"),
                vec![Node::text(self.caption.as_str())],
            ));
        }
        Node::element(shell, children)
    }
}

/// Structural commands address a selected cell by its preserved node path.
/// Merged-cell operations reject inconsistent geometry instead of flattening
/// a table or silently losing unselected cell content.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TableCommand {
    AddRowBefore,
    AddRowAfter,
    DeleteRow,
    AddColumnBefore,
    AddColumnAfter,
    DeleteColumn,
    DeleteTable,
    MergeCells { from: NodePath, to: NodePath },
    SplitCell,
    ToggleHeaderRow,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    InsertText(String),
    ReplaceSelection(String),
    PasteFragment(super::RichFragment),
    DeleteBackward,
    DeleteForward,
    SplitBlock,
    /// Leave the whole code block intact and start a paragraph after it.
    /// This precedes page-break insertion for the Source Mod-Enter binding.
    ExitCodeBlock,
    ToggleMark(Mark),
    SetMark(Mark),
    UnsetMark(MarkKind),
    AddComment(super::CommentAttributes),
    RemoveComment {
        id: String,
    },
    ClearFormatting,
    Recase(TextCase),
    SetParagraph,
    SetHeading(u8),
    SetAlignment(Alignment),
    SetParagraphFormat(ParagraphFormat),
    Indent,
    Outdent,
    ToggleList(ListKind),
    ToggleBlockQuote,
    ToggleCodeBlock,
    InsertInline(InlineObject),
    InsertBlock(BlockObject),
    SetAttributes {
        path: NodePath,
        attributes: Vec<(String, Option<String>)>,
    },
    DeleteNode {
        path: NodePath,
    },
    /// Commit raw LaTeX to the same current math atom. Rendering/preview never
    /// changes this payload, and an old descriptor cannot edit a replacement.
    UpdateMathSource {
        path: NodePath,
        expected: Node,
        source: String,
    },
    /// Patch the actual note atom, refusing an old descriptor rather than
    /// editing whichever node later occupies the same path.
    UpdateNote {
        path: NodePath,
        expected: Node,
        text: Option<String>,
        kind: Option<NoteKind>,
    },
    DeleteNote {
        path: NodePath,
        expected: Node,
    },
    MoveSection {
        source: NodePath,
        target: NodePath,
        placement: super::DropPlacement,
    },
    MoveBlocks {
        parent: NodePath,
        source: std::ops::Range<usize>,
        insert_at: usize,
    },
    Table {
        cell: NodePath,
        command: TableCommand,
    },
    Undo,
    Redo,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextCase {
    Upper,
    Lower,
    Title,
    Sentence,
}

impl Command {
    /// Parameterless intents share the web command catalogue's stable IDs.
    /// Commands requiring a dialog/value use the explicit typed variants.
    pub fn from_id(id: &str) -> Option<Self> {
        Some(match id {
            "format.bold" => Self::ToggleMark(Mark::Bold),
            "format.italic" => Self::ToggleMark(Mark::Italic),
            "format.underline" => Self::ToggleMark(Mark::Underline),
            "format.strike" => Self::ToggleMark(Mark::Strike),
            "format.highlight" => Self::ToggleMark(Mark::Highlight("#faf594".into())),
            "format.superscript" => Self::ToggleMark(Mark::Superscript),
            "format.subscript" => Self::ToggleMark(Mark::Subscript),
            "format.clear" => Self::ClearFormatting,
            "paragraph.heading-1" => Self::SetHeading(1),
            "paragraph.heading-2" => Self::SetHeading(2),
            "paragraph.heading-3" => Self::SetHeading(3),
            "paragraph.bullet-list" => Self::ToggleList(ListKind::Bullet),
            "paragraph.numbered-list" => Self::ToggleList(ListKind::Ordered),
            "paragraph.task-list" => Self::ToggleList(ListKind::Task),
            "paragraph.blockquote" => Self::ToggleBlockQuote,
            "paragraph.code-block" => Self::ToggleCodeBlock,
            "paragraph.align-left" => Self::SetAlignment(Alignment::Left),
            "paragraph.align-center" => Self::SetAlignment(Alignment::Center),
            "paragraph.align-right" => Self::SetAlignment(Alignment::Right),
            "paragraph.justify" => Self::SetAlignment(Alignment::Justify),
            "paragraph.indent" => Self::Indent,
            "paragraph.outdent" => Self::Outdent,
            "insert.horizontal-rule" => Self::InsertBlock(BlockObject::HorizontalRule),
            "insert.page-break" => Self::InsertBlock(BlockObject::PageBreak),
            "insert.math-inline" => Self::InsertInline(InlineObject::Math {
                source: String::new(),
            }),
            "insert.math-block" => Self::InsertBlock(BlockObject::Math {
                source: String::new(),
            }),
            "history.undo" => Self::Undo,
            "history.redo" => Self::Redo,
            _ => return None,
        })
    }
}

pub(crate) fn empty_cell(header: bool) -> Node {
    Node::element(
        ElementShell::html(if header { "th" } else { "td" }),
        vec![Node::paragraph(Vec::new())],
    )
}

fn math_node(source: &str, display: MathDisplay) -> Node {
    let block = display == MathDisplay::Block;
    let mut shell = ElementShell::html(if block { "div" } else { "span" });
    set_math_source_attributes(&mut shell, source, display);
    shell.set_attr(
        "class",
        if block {
            "twyne-math twyne-math-block"
        } else {
            "twyne-math twyne-math-inline"
        },
    );
    if block {
        shell.set_attr("style", "break-inside: avoid; page-break-inside: avoid;");
    }
    Node::element(shell, vec![Node::text(source)])
}

/// Portable math source attributes from Source MathExtensions. A source edit
/// patches these owned fields while retaining unknown attrs and styling.
pub(crate) fn set_math_source_attributes(
    shell: &mut ElementShell,
    source: &str,
    display: MathDisplay,
) {
    let block = display == MathDisplay::Block;
    shell.set_attr(
        "data-type",
        if block { "block-math" } else { "inline-math" },
    );
    shell.set_attr("data-latex", source);
    shell.set_attr("data-math-display", if block { "block" } else { "inline" });
    shell.set_attr(
        "aria-label",
        format!(
            "{} equation: {}",
            if block { "Block" } else { "Inline" },
            if source.is_empty() { "empty" } else { source }
        ),
    );
}

fn raw_typst_node(source: &str, display: MathDisplay) -> Node {
    let block = display == MathDisplay::Block;
    let mut shell = ElementShell::html(if block { "div" } else { "span" });
    shell.set_attr("data-typst-source", source);
    shell.set_attr(
        "data-type",
        if block {
            "raw-typst"
        } else {
            "raw-typst-inline"
        },
    );
    shell.set_attr(
        "class",
        if block {
            "twyne-raw-typst"
        } else {
            "twyne-raw-typst-inline"
        },
    );
    shell.set_attr(
        "title",
        if block {
            "Edit this Typst block in source view"
        } else {
            "Edit this Typst expression in source view"
        },
    );
    shell.set_attr("contenteditable", "false");
    let children = if block {
        vec![Node::element(
            ElementShell::html("pre"),
            vec![Node::text(if source.is_empty() {
                "Typst block"
            } else {
                source
            })],
        )]
    } else {
        vec![Node::text(if source.is_empty() { "Typst" } else { source })]
    };
    Node::element(shell, children)
}
