//! Values supplied by insertion forms, shared by both document adapters.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Parameters {
    None,
    Table {
        rows: usize,
        columns: usize,
        header: bool,
    },
    Link {
        text: String,
        href: String,
    },
    Image {
        src: String,
        alt: String,
    },
    Text(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FormKind {
    Link,
    Image,
    Mermaid,
    Endnote,
    Footnote,
}

impl FormKind {
    pub fn for_command(id: &str) -> Option<Self> {
        Some(match id {
            "insert.link" => Self::Link,
            "insert.image" => Self::Image,
            "insert.mermaid" => Self::Mermaid,
            "insert.endnote" => Self::Endnote,
            "insert.footnote" => Self::Footnote,
            _ => return None,
        })
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Link => "Insert a link",
            Self::Image => "Insert an image",
            Self::Mermaid => "Insert a diagram",
            Self::Endnote => "Insert an endnote",
            Self::Footnote => "Insert a footnote",
        }
    }
    pub fn primary_label(self) -> &'static str {
        match self {
            Self::Link => "Link text",
            Self::Image => "Image URL",
            Self::Mermaid => "Mermaid source",
            Self::Endnote | Self::Footnote => "Note text",
        }
    }
    pub fn secondary_label(self) -> Option<&'static str> {
        match self {
            Self::Link => Some("URL"),
            Self::Image => Some("Alternative text"),
            _ => None,
        }
    }
    pub fn multiline(self) -> bool {
        matches!(self, Self::Mermaid | Self::Endnote | Self::Footnote)
    }
    pub fn values(self, primary: &str, secondary: &str) -> Result<Parameters, &'static str> {
        Ok(match self {
            Self::Link => Parameters::Link {
                text: required(primary, "Enter the link text.")?,
                href: required(secondary, "Enter a URL.")?,
            },
            Self::Image => Parameters::Image {
                src: required(primary, "Enter an image URL.")?,
                alt: secondary.to_owned(),
            },
            _ => Parameters::Text(required(primary.trim(), "Enter the content to insert.")?),
        })
    }
}

fn required(value: &str, message: &'static str) -> Result<String, &'static str> {
    if value.trim().is_empty() {
        Err(message)
    } else {
        Ok(value.to_owned())
    }
}
