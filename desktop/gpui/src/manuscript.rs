use crate::workspace::WorkspaceDocument;
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const FORMAT_VERSION: u32 = 1;
pub const MAX_DOCUMENT_BYTES: usize = 5_000_000;

/// Native recovery envelope. Older prototype text remains readable; imported
/// web material retains its full source-aware workspace alongside that text.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Manuscript {
    pub format: String,
    pub version: u32,
    pub id: Uuid,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub notes: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<Arc<WorkspaceDocument>>,
}

impl Manuscript {
    pub fn new(title: impl Into<String>) -> Self {
        let now = timestamp();
        Self {
            format: "twyne-gpui".into(),
            version: FORMAT_VERSION,
            id: Uuid::new_v4(),
            title: title.into(),
            body: String::new(),
            notes: String::new(),
            created_at: now,
            updated_at: now,
            revision: 0,
            archived: false,
            workspace: None,
        }
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.format == "twyne-gpui",
            "This is not a Twyne GPUI document."
        );
        ensure!(
            self.version == FORMAT_VERSION,
            "This document needs a newer version of Twyne."
        );
        if let Some(workspace) = &self.workspace {
            workspace.validate()?;
            ensure!(
                workspace.folio.id == self.id.to_string(),
                "The workspace belongs to another native document."
            );
        } else {
            ensure!(
                self.body.len() + self.notes.len() + self.title.len() <= MAX_DOCUMENT_BYTES,
                "The manuscript exceeds the 5 MB editing limit."
            );
        }
        Ok(())
    }

    pub fn touch(&mut self) {
        self.updated_at = timestamp();
        self.revision = self.revision.saturating_add(1);
    }

    pub fn display_title(&self) -> &str {
        let title = self.title.trim();
        if title.is_empty() {
            "Untitled manuscript"
        } else {
            title
        }
    }

    pub fn duplicate(&self) -> Self {
        let mut copy = Self::new(format!("{} (copy)", self.display_title()));
        copy.body.clone_from(&self.body);
        copy.notes.clone_from(&self.notes);
        if let Some(workspace) = &self.workspace {
            let mut workspace = workspace.as_ref().clone();
            workspace.folio.id = copy.id.to_string();
            workspace.content.folio_id = workspace.folio.id.clone();
            workspace.folio.name = copy.title.clone();
            workspace.folio.created_at = copy.created_at;
            workspace.folio.updated_at = copy.updated_at;
            workspace.content.updated_at = copy.updated_at;
            copy.workspace = Some(Arc::new(workspace));
        }
        copy
    }

    /// Imported portable documents become independent drafts, so their ID
    /// can never overwrite a local manuscript with the same identity.
    pub fn import_copy(mut self) -> Self {
        self.id = Uuid::new_v4();
        self.created_at = timestamp();
        self.updated_at = self.created_at;
        self.revision = 0;
        self.archived = false;
        if let Some(workspace) = &mut self.workspace {
            let workspace = Arc::make_mut(workspace);
            workspace.folio.id = self.id.to_string();
            workspace.content.folio_id = workspace.folio.id.clone();
            workspace.folio.created_at = self.created_at;
            workspace.folio.updated_at = self.updated_at;
            workspace.content.updated_at = self.updated_at;
        }
        self
    }

    pub fn from_workspace(workspace: WorkspaceDocument) -> Result<Self> {
        workspace.validate()?;
        let mut document = Self::new(workspace.folio.name.clone());
        document.id = Uuid::parse_str(&workspace.folio.id)?;
        document.created_at = workspace.folio.created_at;
        document.updated_at = workspace.folio.updated_at;
        document.body = workspace
            .canonical_source()
            .unwrap_or(&workspace.content.html)
            .to_owned();
        document.workspace = Some(Arc::new(workspace));
        document.validate()?;
        Ok(document)
    }
}

pub fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Statistics {
    pub words: usize,
    pub characters: usize,
    pub paragraphs: usize,
    pub reading_minutes: usize,
}

impl Statistics {
    /// Called on a background executor after typing settles.
    pub fn for_body(body: &str) -> Self {
        let words = body
            .split_whitespace()
            .filter(|word| word.chars().any(char::is_alphanumeric))
            .count();
        let mut paragraphs = 0;
        let mut in_paragraph = false;
        for line in body.lines() {
            if line.trim().is_empty() {
                in_paragraph = false;
            } else if !in_paragraph {
                paragraphs += 1;
                in_paragraph = true;
            }
        }
        Self {
            words,
            characters: body.chars().count(),
            paragraphs,
            reading_minutes: words.div_ceil(225),
        }
    }
}

/// Safe portable filename; the actual title is always preserved in the file.
pub fn export_filename(title: &str) -> String {
    let mut name: String = title
        .chars()
        .take(100)
        .map(|ch| {
            if ch.is_control() || "<>:\"/\\|?*".contains(ch) {
                '_'
            } else {
                ch
            }
        })
        .collect();
    name = name.trim_matches([' ', '.']).to_string();
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name.is_empty() {
        "Untitled manuscript".into()
    } else if reserved {
        format!("_{name}")
    } else {
        name
    }
}
