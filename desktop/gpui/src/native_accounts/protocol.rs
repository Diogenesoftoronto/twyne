//! Source-compatible pushAll DTO/diff. Snapshot timestamps are metadata, not
//! upload fields. Closed row validators refuse unknown wire fields rather than
//! silently erasing them. Whole v.any collections retain their original values.

use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_SOURCE_UTF16: usize = 5_000_000;
/// Conservative JSON-size admission budget below Convex's 1 MB/document limit.
/// Actual Convex encoding/owner/index overhead still requires server validation.
pub const CLOUD_CONTENT_JSON_BUDGET: usize = 950_000;
pub const MAX_SECTION_ROWS: usize = 100_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContentFormat {
    Html,
    Typst,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSnapshot {
    pub folio_id: String,
    pub html: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ContentFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl ContentSnapshot {
    pub fn wire_value(&self) -> Result<Value> {
        ensure!(
            self.extra.is_empty(),
            "This content has unsupported cloud fields; its local metadata is retained."
        );
        let mut row = Map::new();
        row.insert("folioId".into(), json!(self.folio_id));
        row.insert("html".into(), json!(self.html));
        if let Some(format) = &self.format {
            row.insert("format".into(), serde_json::to_value(format)?);
        }
        if let Some(source) = &self.typst_source {
            ensure!(
                source.encode_utf16().count() <= MAX_SOURCE_UTF16,
                "This source exceeds the original converter limit and remains local."
            );
            row.insert("typstSource".into(), json!(source));
        }
        let value = Value::Object(row);
        ensure!(
            serde_json::to_vec(&value)?.len() <= CLOUD_CONTENT_JSON_BUDGET,
            "This manuscript exceeds the current cloud document admission budget and remains local."
        );
        Ok(value)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    #[serde(default)]
    pub briefs: Vec<Value>,
    #[serde(default)]
    pub folios: Vec<Value>,
    #[serde(default)]
    pub folio_content: Vec<ContentSnapshot>,
    #[serde(default)]
    pub custom_personas: Option<Vec<Value>>,
    #[serde(default)]
    pub persona_notes: Vec<Value>,
    #[serde(default)]
    pub persona_replies: Vec<Value>,
    #[serde(default)]
    pub rubric_results: Vec<Value>,
    #[serde(default)]
    pub bibliography: Vec<Value>,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Wire-compatible pullAll result. Timestamp/legacy fields are retained apart
/// from the normalized upload baseline, including future response extensions.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullSnapshot {
    pub sync_revision: u64,
    #[serde(default)]
    pub legacy_brief: Option<Value>,
    #[serde(default)]
    pub legacy_brief_updated_at: u64,
    #[serde(default)]
    pub folios_updated_at: u64,
    #[serde(default)]
    pub custom_personas_updated_at: u64,
    #[serde(default)]
    pub bibliography_updated_at: u64,
    #[serde(flatten)]
    pub payload: SyncPayload,
}

impl PullSnapshot {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.sync_revision <= MAX_SAFE_INTEGER,
            "Invalid remote revision."
        );
        self.payload.validate()
    }
}

pub(crate) fn rows_by_id(rows: &[Value], key: &str) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for row in rows {
        let id = row
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("A sync row is missing its string identifier."))?;
        ensure!(
            result.insert(id.to_owned(), row.clone()).is_none(),
            "A sync section contains duplicate identifiers."
        );
    }
    Ok(result)
}

pub(crate) fn content_rows(payload: &SyncPayload) -> Result<Vec<Value>> {
    payload
        .folio_content
        .iter()
        .map(|row| Ok(serde_json::to_value(row)?))
        .collect()
}

impl SyncPayload {
    /// Strip only source-defined pull timestamps and normalize legacy folio IDs.
    /// Canonical source, HTML, collection order, and future fields are untouched.
    pub fn normalized(&self) -> Result<Self> {
        let mut value = self.clone();
        for row in &mut value.folio_content {
            row.updated_at = None;
        }
        for row in &mut value.briefs {
            if let Some(row) = row.as_object_mut() {
                row.remove("updatedAt");
            }
        }
        for row in &mut value.rubric_results {
            if let Some(row) = row.as_object_mut() {
                row.remove("updatedAt");
                row.entry("folioId").or_insert_with(|| json!(""));
            }
        }
        for row in value
            .persona_notes
            .iter_mut()
            .chain(&mut value.persona_replies)
        {
            if let Some(row) = row.as_object_mut() {
                row.entry("folioId").or_insert_with(|| json!(""));
            }
        }
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.extra.keys().all(|key| ![
                "briefs",
                "folios",
                "folioContent",
                "customPersonas",
                "personaNotes",
                "personaReplies",
                "rubricResults",
                "bibliography"
            ]
            .contains(&key.as_str())),
            "Snapshot extensions overlap known fields."
        );
        for count in [
            self.briefs.len(),
            self.folios.len(),
            self.folio_content.len(),
            self.custom_personas.as_ref().map_or(0, Vec::len),
            self.persona_notes.len(),
            self.persona_replies.len(),
            self.rubric_results.len(),
            self.bibliography.len(),
        ] {
            ensure!(
                count <= MAX_SECTION_ROWS,
                "This sync section exceeds the native admission limit."
            );
        }
        rows_by_id(&self.briefs, "folioId")?;
        rows_by_id(&self.persona_notes, "noteId")?;
        rows_by_id(&self.persona_replies, "replyId")?;
        // Legacy absent folio IDs become an empty ID before validation.
        let rubric = self
            .rubric_results
            .iter()
            .map(|row| {
                let mut row = row.clone();
                if let Some(row) = row.as_object_mut() {
                    row.entry("folioId").or_insert_with(|| json!(""));
                }
                row
            })
            .collect::<Vec<_>>();
        rows_by_id(&rubric, "folioId")?;
        let mut ids = BTreeSet::new();
        for row in &self.folio_content {
            ensure!(
                !row.folio_id.is_empty() && ids.insert(&row.folio_id),
                "Content IDs must be nonempty and unique."
            );
            ensure!(
                row.format != Some(ContentFormat::Typst) || row.typst_source.is_some(),
                "A Typst sync snapshot is missing canonical source."
            );
            ensure!(
                row.extra.keys().all(|key| ![
                    "folioId",
                    "html",
                    "format",
                    "typstSource",
                    "updatedAt"
                ]
                .contains(&key.as_str())),
                "Content extensions overlap known fields."
            );
        }
        Ok(())
    }

    /// Exact omitted-versus-empty protocol. No userId or local updatedAt is sent.
    /// The server still must validate auth, limits, and expectedRevision.
    pub fn push_arguments(&self, baseline: &Self, expected_revision: u64) -> Result<Option<Value>> {
        ensure!(
            expected_revision < MAX_SAFE_INTEGER,
            "Invalid remote revision."
        );
        let next = self.normalized()?;
        let previous = baseline.normalized()?;
        let canonical_ids = previous
            .folio_content
            .iter()
            .filter(|old| old.typst_source.is_some())
            .map(|old| old.folio_id.as_str())
            .collect::<BTreeSet<_>>();
        for content in &next.folio_content {
            if canonical_ids.contains(content.folio_id.as_str()) {
                ensure!(
                    content.typst_source.is_some(),
                    "An existing canonical manuscript cannot be downgraded to HTML-only sync."
                );
            }
        }
        ensure!(
            next.extra == previous.extra,
            "Unknown cloud snapshot fields cannot be uploaded by this client."
        );
        let mut args = Map::new();
        row_diff(
            &mut args,
            "briefs",
            "removedBriefFolioIds",
            "folioId",
            &next.briefs,
            &previous.briefs,
            &["folioId", "brief"],
        )?;
        row_diff(
            &mut args,
            "folioContent",
            "removedFolioContentIds",
            "folioId",
            &content_rows(&next)?,
            &content_rows(&previous)?,
            &["folioId", "html", "format", "typstSource"],
        )?;
        row_diff(
            &mut args,
            "personaNotes",
            "removedPersonaNoteIds",
            "noteId",
            &next.persona_notes,
            &previous.persona_notes,
            &[
                "folioId",
                "noteId",
                "personaId",
                "personaName",
                "personaColor",
                "type",
                "feedback",
                "traceId",
                "anchor",
                "briefTitle",
                "createdAt",
            ],
        )?;
        row_diff(
            &mut args,
            "personaReplies",
            "removedPersonaReplyIds",
            "replyId",
            &next.persona_replies,
            &previous.persona_replies,
            &[
                "folioId",
                "replyId",
                "noteId",
                "author",
                "authorKind",
                "personaId",
                "text",
                "createdAt",
            ],
        )?;
        row_diff(
            &mut args,
            "rubricResults",
            "removedRubricFolioIds",
            "folioId",
            &next.rubric_results,
            &previous.rubric_results,
            &["folioId", "result"],
        )?;
        for (key, after, before) in [
            ("folios", &next.folios, &previous.folios),
            ("bibliography", &next.bibliography, &previous.bibliography),
        ] {
            if after != before {
                args.insert(key.into(), json!(after));
            }
        }
        if next.custom_personas != previous.custom_personas {
            if let Some(personas) = &next.custom_personas {
                args.insert("customPersonas".into(), json!(personas));
            } else {
                ensure!(
                    previous.custom_personas.is_none(),
                    "Use an explicit empty persona array to clear the cloud board."
                );
            }
        }
        // Preflight only changed content; unchanged future/large remote rows are
        // retained without forcing them through the current upload schema.
        if let Some(rows) = args.get("folioContent").and_then(Value::as_array) {
            for row in rows {
                serde_json::from_value::<ContentSnapshot>(row.clone())?.wire_value()?;
            }
        }
        if args.is_empty() {
            return Ok(None);
        }
        args.insert("expectedRevision".into(), json!(expected_revision));
        Ok(Some(Value::Object(args)))
    }
}

fn row_diff(
    args: &mut Map<String, Value>,
    section: &str,
    removals: &str,
    id: &str,
    next: &[Value],
    previous: &[Value],
    allowed: &[&str],
) -> Result<()> {
    let before = rows_by_id(previous, id)?;
    let after = rows_by_id(next, id)?;
    let changed = next
        .iter()
        .filter(|row| {
            row.get(id)
                .and_then(Value::as_str)
                .is_some_and(|id| before.get(id) != Some(*row))
        })
        .cloned()
        .collect::<Vec<_>>();
    for row in &changed {
        let row = row
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("A sync row is not an object."))?;
        ensure!(
            row.keys().all(|key| allowed.contains(&key.as_str())),
            "A changed sync row has unsupported cloud fields; local data is retained."
        );
        let required_strings: &[&str] = match section {
            "briefs" | "rubricResults" => &["folioId"],
            "folioContent" => &["folioId", "html"],
            "personaNotes" => &[
                "folioId",
                "noteId",
                "personaId",
                "personaName",
                "personaColor",
                "type",
                "feedback",
            ],
            "personaReplies" => &[
                "folioId",
                "replyId",
                "noteId",
                "author",
                "authorKind",
                "text",
            ],
            _ => &[],
        };
        ensure!(
            required_strings
                .iter()
                .all(|field| row.get(*field).is_some_and(Value::is_string)),
            "A changed sync row is missing required string fields."
        );
        if section == "briefs" {
            ensure!(
                row.contains_key("brief"),
                "A dossier row is missing its value."
            );
        }
        if section == "rubricResults" {
            ensure!(
                row.contains_key("result"),
                "A rubric row is missing its value."
            );
        }
        if matches!(section, "personaNotes" | "personaReplies") {
            ensure!(
                row.get("createdAt").is_some_and(Value::is_number),
                "A thread row is missing its timestamp."
            );
        }
        for field in ["traceId", "anchor", "briefTitle", "personaId"] {
            if let Some(value) = row.get(field) {
                ensure!(
                    value.is_string(),
                    "A sync row has an invalid optional string."
                );
            }
        }
    }
    let removed = previous
        .iter()
        .filter_map(|row| row.get(id).and_then(Value::as_str))
        .filter(|id| !after.contains_key(*id))
        .collect::<Vec<_>>();
    if !changed.is_empty() {
        args.insert(section.into(), json!(changed));
    }
    if !removed.is_empty() {
        args.insert(removals.into(), json!(removed));
    }
    Ok(())
}
