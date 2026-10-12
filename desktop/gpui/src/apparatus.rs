//! Retained offline Apparatus metadata. Detection, citation formatting,
//! provider activity and manuscript insertion belong to explicit host adapters.
//! The original flat bibliography and global settings remain raw; local edits
//! are overlays rather than silent repairs of imported data.

use crate::{exchange::OptionalField, house::is_js_whitespace, workspace::ExtraFields};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const APPARATUS_FORMAT: &str = "twyne-gpui-apparatus";
pub const APPARATUS_VERSION: u64 = 1;
pub const MAX_APPARATUS_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApparatusRecord {
    pub format: String,
    pub version: u64,
    pub generation: u64,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub bibliography: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub settings: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub local_bibliography: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub local_settings: OptionalField<Value>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl Default for ApparatusRecord {
    fn default() -> Self {
        Self {
            format: APPARATUS_FORMAT.into(),
            version: APPARATUS_VERSION,
            generation: 0,
            bibliography: OptionalField::Missing,
            settings: OptionalField::Missing,
            local_bibliography: OptionalField::Missing,
            local_settings: OptionalField::Missing,
            extra: ExtraFields::new(),
        }
    }
}
impl ApparatusRecord {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.format == APPARATUS_FORMAT && self.version == APPARATUS_VERSION,
            "This Apparatus format needs a compatible version of Twyne. Its file was kept."
        );
        Ok(())
    }
    pub fn effective_bibliography(&self) -> &OptionalField<Value> {
        if self.local_bibliography.is_missing() {
            &self.bibliography
        } else {
            &self.local_bibliography
        }
    }
    pub fn effective_settings(&self) -> &OptionalField<Value> {
        if self.local_settings.is_missing() {
            &self.settings
        } else {
            &self.local_settings
        }
    }
}

/// The original JS URL lookup supplies this guard against its exact full-array
/// snapshot. URL normalization and spread-before-JSON remain in that adapter.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UrlMergeTarget {
    pub index: usize,
    pub expected_raw_row: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ApparatusEdit {
    /// Remove only exact ID/scope matches, including duplicate rows in that
    /// scope. Foreign, unscoped and aliased rows remain untouched.
    Drop {
        folio_id: String,
        id: String,
    },
    /// A complete original entry; replaces the first exact ID/scope match or
    /// appends. It does not perform the Source URL merge operation.
    Upsert {
        folio_id: String,
        entry: Value,
    },
    /// A complete entry produced by the original helper, after any actual JS
    /// `{...existing, ...entry, id: existing.id}` spread and JSON serialization.
    /// A merge target verifies the original lookup result before applying the
    /// same first-ID/scope upsert. No Rust URL or undefined-field emulation.
    AddDetected {
        folio_id: String,
        entry: Value,
        merge: Option<UrlMergeTarget>,
    },
    SetCitationStyle(CitationStyle),
    Batch(Vec<ApparatusEdit>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApparatusEffect {
    BibliographyChanged { folio_id: String },
    CitationStyleChanged,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ApparatusRequest {
    pub request_id: Uuid,
    pub expected_generation: u64,
    pub base: Arc<ApparatusRecord>,
    pub candidate: Arc<ApparatusRecord>,
    pub effects: Vec<ApparatusEffect>,
}

fn bibliography_rows(record: &ApparatusRecord) -> Result<Vec<Value>> {
    match record.effective_bibliography() {
        OptionalField::Missing | OptionalField::Null => Ok(Vec::new()),
        OptionalField::Value(Value::Array(rows)) => Ok(rows.clone()),
        OptionalField::Value(_) => anyhow::bail!(
            "This retained bibliography cannot be edited safely. Its raw data was kept."
        ),
    }
}

fn exact_identity(raw: &Value, id: &str, scope: &str) -> bool {
    raw.get("id").and_then(Value::as_str) == Some(id)
        && raw.get("folioId").and_then(Value::as_str) == Some(scope)
}

fn validated_entry(raw: &Value, scope: &str) -> Result<BibEntry> {
    ensure!(!scope.is_empty(), "A source needs an explicit folio scope.");
    let entry: BibEntry = serde_json::from_value(raw.clone())
        .context("The complete source entry cannot be filed safely.")?;
    entry.validate()?;
    ensure!(
        entry.folio_id == scope,
        "This source belongs to a different folio. Its owner was not changed."
    );
    Ok(entry)
}

fn apply_edit(
    record: &mut ApparatusRecord,
    edit: &ApparatusEdit,
    effects: &mut Vec<ApparatusEffect>,
) -> Result<()> {
    match edit {
        ApparatusEdit::Batch(edits) => {
            for edit in edits {
                apply_edit(record, edit, effects)?;
            }
        }
        ApparatusEdit::SetCitationStyle(style) => {
            let mut settings = match record.effective_settings() {
                OptionalField::Missing | OptionalField::Null => serde_json::Map::new(),
                OptionalField::Value(Value::Object(settings)) => settings.clone(),
                OptionalField::Value(_) => anyhow::bail!(
                    "These retained settings cannot be edited safely. Their raw data was kept."
                ),
            };
            let value = Value::String(style.as_str().into());
            if settings.get("defaultCitationStyle") != Some(&value) {
                settings.insert("defaultCitationStyle".into(), value);
                record.local_settings = OptionalField::Value(Value::Object(settings));
                effects.push(ApparatusEffect::CitationStyleChanged);
            }
        }
        ApparatusEdit::Drop { folio_id, id } => {
            ensure!(
                !folio_id.is_empty(),
                "Dropping a source needs an explicit folio scope."
            );
            ensure!(!id.is_empty(), "Dropping a source needs its original ID.");
            let mut rows = bibliography_rows(record)?;
            let previous_len = rows.len();
            rows.retain(|raw| !exact_identity(raw, id, folio_id));
            if rows.len() != previous_len {
                record.local_bibliography = OptionalField::Value(Value::Array(rows));
                effects.push(ApparatusEffect::BibliographyChanged {
                    folio_id: folio_id.clone(),
                });
            }
        }
        ApparatusEdit::Upsert { folio_id, entry }
        | ApparatusEdit::AddDetected {
            folio_id, entry, ..
        } => {
            let parsed = validated_entry(entry, folio_id)?;
            let mut rows = bibliography_rows(record)?;
            if let ApparatusEdit::AddDetected {
                merge: Some(target),
                ..
            } = edit
            {
                ensure!(
                    rows.get(target.index) == Some(&target.expected_raw_row),
                    "The source URL match changed before it could be filed. Detect it again."
                );
                ensure!(
                    exact_identity(&target.expected_raw_row, &parsed.id, folio_id)
                        && !parsed.url.trim_matches(is_js_whitespace).is_empty(),
                    "The source URL match has a different identity or owner. It was not filed."
                );
            }
            if let Some(index) = rows
                .iter()
                .position(|raw| exact_identity(raw, &parsed.id, folio_id))
            {
                if rows[index] == *entry {
                    return Ok(());
                }
                rows[index] = entry.clone();
            } else {
                rows.push(entry.clone());
            }
            record.local_bibliography = OptionalField::Value(Value::Array(rows));
            effects.push(ApparatusEffect::BibliographyChanged {
                folio_id: folio_id.clone(),
            });
        }
    }
    Ok(())
}

/// The accepted record remains visible until its entire immutable candidate
/// has been acknowledged. Failed requests retain ID, base, candidate and scope.
pub struct ApparatusSession {
    saved: Arc<ApparatusRecord>,
    pending: Option<ApparatusRequest>,
    error: Option<String>,
}
impl ApparatusSession {
    pub fn new(record: Arc<ApparatusRecord>) -> Self {
        Self {
            saved: record,
            pending: None,
            error: None,
        }
    }
    pub fn saved(&self) -> &Arc<ApparatusRecord> {
        &self.saved
    }
    pub fn pending(&self) -> Option<&ApparatusRequest> {
        self.pending.as_ref()
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn request(&mut self, edit: ApparatusEdit) -> Result<Option<ApparatusRequest>> {
        ensure!(
            self.pending.is_none(),
            "Finish the previous Apparatus save before filing another change."
        );
        self.saved.validate()?;
        let mut candidate = (*self.saved).clone();
        let mut effects = Vec::new();
        apply_edit(&mut candidate, &edit, &mut effects)?;
        if candidate == *self.saved {
            return Ok(None);
        }
        candidate.generation = candidate
            .generation
            .checked_add(1)
            .context("Apparatus has exhausted its save generation.")?;
        candidate.validate()?;
        ensure!(
            serde_json::to_vec_pretty(&candidate)?.len() <= MAX_APPARATUS_BYTES,
            "Apparatus exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        let request = ApparatusRequest {
            request_id: Uuid::new_v4(),
            expected_generation: self.saved.generation,
            base: self.saved.clone(),
            candidate: Arc::new(candidate),
            effects,
        };
        self.pending = Some(request.clone());
        self.error = None;
        Ok(Some(request))
    }
    pub fn acknowledge_saved(&mut self, request_id: Uuid, record: Arc<ApparatusRecord>) -> bool {
        if !self.pending.as_ref().is_some_and(|request| {
            request.request_id == request_id
                && request.base == self.saved
                && request.candidate == record
        }) {
            return false;
        }
        self.saved = record;
        self.pending = None;
        self.error = None;
        true
    }
    pub fn report_error(&mut self, request_id: Uuid, message: impl Into<String>) -> bool {
        if self.pending.as_ref().map(|request| request.request_id) != Some(request_id) {
            return false;
        }
        self.error = Some(message.into());
        true
    }
    pub fn retry(&mut self) -> Option<ApparatusRequest> {
        self.error.take()?;
        self.pending.clone()
    }
    pub fn replace_record(&mut self, record: Arc<ApparatusRecord>) -> bool {
        if self.pending.is_some()
            || record.validate().is_err()
            || record.generation < self.saved.generation
            || (record.generation == self.saved.generation && record != self.saved)
        {
            return false;
        }
        self.saved = record;
        self.error = None;
        true
    }
}

#[derive(Clone, Debug)]
pub struct ApparatusLoad {
    pub record: Arc<ApparatusRecord>,
    pub warnings: Vec<String>,
}
#[derive(Clone)]
pub struct ApparatusStore {
    inner: Arc<StoreInner>,
}
struct StoreInner {
    path: PathBuf,
    writer: Mutex<()>,
}
impl ApparatusStore {
    /// The host must hold the existing library OS lock while detached writers
    /// use cloned handles. This mutex serializes clones of this opened store.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root).context("Could not create the Apparatus folder.")?;
        Ok(Self {
            inner: Arc::new(StoreInner {
                path: root.join("apparatus.json"),
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn path(&self) -> &Path {
        &self.inner.path
    }
    pub fn load(&self) -> Result<ApparatusLoad> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Apparatus writer stopped unexpectedly."))?;
        self.load_locked()
    }
    fn load_locked(&self) -> Result<ApparatusLoad> {
        let backup = self.path().with_extension("json.bak");
        if !self.path().exists() {
            return if backup.exists() {
                Ok(ApparatusLoad {
                    record: Arc::new(read_record(&backup)?),
                    warnings: vec![
                        "Recovered Apparatus from its previous save. The recovery file is kept."
                            .into(),
                    ],
                })
            } else {
                Ok(ApparatusLoad {
                    record: Arc::new(ApparatusRecord::default()),
                    warnings: Vec::new(),
                })
            };
        }
        match read_record(self.path()) {
            Ok(record) => Ok(ApparatusLoad {
                record: Arc::new(record),
                warnings: Vec::new(),
            }),
            Err(error) => {
                let bytes = read_bounded(self.path())?;
                // A valid future/wrong-shape JSON file is never replaced by an
                // older backup or treated as original web metadata.
                if serde_json::from_slice::<Value>(&bytes).is_ok() {
                    return Err(error);
                }
                if backup.exists() {
                    Ok(ApparatusLoad {
                        record: Arc::new(read_record(&backup)
                            .with_context(|| format!("Could not recover Apparatus: {error}"))?),
                        warnings: vec!["Recovered Apparatus from its previous save. The damaged file is kept until another save.".into()],
                    })
                } else {
                    Err(error.context("Could not open Apparatus. Its damaged file has been kept."))
                }
            }
        }
    }
    pub fn save_request(&self, request: &ApparatusRequest) -> Result<Arc<ApparatusRecord>> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Apparatus writer stopped unexpectedly."))?;
        request.base.validate()?;
        request.candidate.validate()?;
        ensure!(
            request.expected_generation == request.base.generation
                && Some(request.candidate.generation) == request.base.generation.checked_add(1),
            "The Apparatus request has an invalid save generation."
        );
        let bytes = serde_json::to_vec_pretty(request.candidate.as_ref())?;
        ensure!(
            bytes.len() <= MAX_APPARATUS_BYTES,
            "Apparatus exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        let current = self.load_locked()?.record;
        if current == request.candidate
            && read_record(self.path()).ok().as_ref() == Some(request.candidate.as_ref())
        {
            File::open(self.path())?.sync_all()?;
            sync_parent(self.path())?;
            return Ok(request.candidate.clone());
        }
        ensure!(
            current.generation == request.expected_generation && current == request.base,
            "Apparatus changed before this edit could be filed. Reload it before saving."
        );
        if self.path().exists() {
            let previous = read_bounded(self.path())?;
            if read_record(self.path()).is_ok() {
                atomic_write(&self.path().with_extension("json.bak"), &previous)?;
            } else {
                atomic_write(
                    &self
                        .path()
                        .with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                    &previous,
                )?;
            }
        }
        atomic_write(self.path(), &bytes)
            .context("Apparatus could not be saved on this device.")?;
        Ok(request.candidate.clone())
    }
}
fn read_record(path: &Path) -> Result<ApparatusRecord> {
    parse_apparatus_json(&read_bounded(path)?)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_APPARATUS_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_APPARATUS_BYTES,
        "Apparatus is too large to open safely."
    );
    Ok(bytes)
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().context("Apparatus has no parent folder.")?)?.sync_all()?;
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Apparatus has no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    sync_parent(path)
}

pub fn parse_apparatus_json(bytes: &[u8]) -> Result<ApparatusRecord> {
    ensure!(
        bytes.len() <= MAX_APPARATUS_BYTES,
        "Apparatus exceeds its 16 MiB metadata limit."
    );
    let record: ApparatusRecord = serde_json::from_slice(bytes)?;
    record.validate()?;
    Ok(record)
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CitationStyle {
    #[default]
    Mla,
    Apa,
    Chicago,
}
impl CitationStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mla => "mla",
            Self::Apa => "apa",
            Self::Chicago => "chicago",
        }
    }
}

/// Kind is open retained data: a future extractor's kind is not rewritten.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTargetRef {
    pub kind: String,
    pub anchor: String,
    pub query: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub reason: OptionalField<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// A safe display DTO. Timestamp projections use the Source JS number type;
/// persistence and helper inputs use RetainedBibEntry::raw instead of rebuilding
/// entries from this DTO, preserving the original JSON numbers and all fields.
pub struct BibEntry {
    pub id: String,
    pub folio_id: String,
    pub title: String,
    pub url: String,
    pub accessed_at: f64,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub author: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub publisher: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub date: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub year: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub doi: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub note: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub citation_key: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub style: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub formatted_citation: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub snippet: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub why: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub page_hint: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub provenance: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub background_query: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub accepted: OptionalField<bool>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub target: OptionalField<ResearchTargetRef>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub created_at: OptionalField<f64>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub citation_inserted_at: OptionalField<f64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl BibEntry {
    fn validate(&self) -> Result<()> {
        ensure!(
            !self.id.is_empty(),
            "A bibliography entry needs its original ID."
        );
        ensure!(
            self.accessed_at.is_finite(),
            "Source access time must be finite."
        );
        for timestamp in [self.created_at.as_ref(), self.citation_inserted_at.as_ref()]
            .into_iter()
            .flatten()
        {
            ensure!(timestamp.is_finite(), "Source timestamps must be finite.");
        }
        Ok(())
    }
    pub fn is_background(&self) -> bool {
        self.provenance
            .as_ref()
            .is_some_and(|value| value == "background")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectionState {
    Missing,
    Null,
    Valid,
    Malformed,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionIssue {
    pub path: String,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct RetainedBibEntry {
    /// Index in the complete effective flat bibliography, not this folio view.
    pub index: usize,
    pub raw: Value,
    pub entry: BibEntry,
}
#[derive(Clone, Debug, PartialEq)]
pub struct BibliographyProjection {
    pub state: ProjectionState,
    pub entries: Vec<RetainedBibEntry>,
    pub issues: Vec<ProjectionIssue>,
    pub editable: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct SettingsProjection {
    pub state: ProjectionState,
    pub citation_style: CitationStyle,
    pub issues: Vec<ProjectionIssue>,
    pub editable: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ApparatusDisplay {
    pub folio_id: String,
    pub bibliography: BibliographyProjection,
    pub settings: SettingsProjection,
}

fn issue(path: impl Into<String>, message: impl Into<String>) -> ProjectionIssue {
    ProjectionIssue {
        path: path.into(),
        message: message.into(),
    }
}
fn project_bibliography(raw: &OptionalField<Value>, scope: &str) -> BibliographyProjection {
    let mut projection = BibliographyProjection {
        state: ProjectionState::Valid,
        entries: Vec::new(),
        issues: Vec::new(),
        editable: true,
    };
    let rows = match raw {
        OptionalField::Missing => {
            projection.state = ProjectionState::Missing;
            return projection;
        }
        OptionalField::Null => {
            projection.state = ProjectionState::Null;
            return projection;
        }
        OptionalField::Value(Value::Array(rows)) => rows,
        OptionalField::Value(_) => {
            projection.state = ProjectionState::Malformed;
            projection.editable = false;
            projection.issues.push(issue(
                "bibliography",
                "Retained bibliography is not an array. Its raw value was kept.",
            ));
            return projection;
        }
    };
    for (index, raw) in rows.iter().enumerate() {
        match serde_json::from_value::<BibEntry>(raw.clone()).and_then(|entry| {
            entry.validate().map_err(serde::de::Error::custom)?;
            Ok(entry)
        }) {
            Ok(entry) if entry.folio_id == scope => {
                projection.entries.push(RetainedBibEntry {
                    index,
                    raw: raw.clone(),
                    entry,
                });
            }
            Ok(_) => {}
            Err(error) => projection.issues.push(issue(
                format!("bibliography[{index}]"),
                format!(
                    "Retained entry cannot be displayed safely: {error}. Its raw value was kept."
                ),
            )),
        }
    }
    projection
}
fn project_settings(raw: &OptionalField<Value>) -> SettingsProjection {
    let mut projection = SettingsProjection {
        state: ProjectionState::Valid,
        citation_style: CitationStyle::Mla,
        issues: Vec::new(),
        editable: true,
    };
    match raw {
        OptionalField::Missing => projection.state = ProjectionState::Missing,
        OptionalField::Null => projection.state = ProjectionState::Null,
        OptionalField::Value(Value::Object(settings)) => {
            if let Some(style) = settings.get("defaultCitationStyle") {
                match serde_json::from_value::<CitationStyle>(style.clone()) {
                    Ok(style) => projection.citation_style = style,
                    Err(_) => projection.issues.push(issue("settings.defaultCitationStyle", "Retained citation style is not MLA, APA or Chicago. The source display default is MLA; its raw value was kept.")),
                }
            }
        }
        OptionalField::Value(_) => {
            projection.state = ProjectionState::Malformed;
            projection.editable = false;
            projection.issues.push(issue(
                "settings",
                "Retained settings are not an object. Their raw value was kept.",
            ));
        }
    }
    projection
}
impl ApparatusRecord {
    /// The caller supplies the original outer folio scope. Only a row's exact
    /// original `folioId` participates; aliases, catalog order and unscoped
    /// entries are never assigned to the active folio.
    pub fn display(&self, folio_id: &str) -> Result<ApparatusDisplay> {
        self.validate()?;
        ensure!(
            !folio_id.is_empty(),
            "Apparatus needs an explicit folio scope."
        );
        Ok(ApparatusDisplay {
            folio_id: folio_id.into(),
            bibliography: project_bibliography(self.effective_bibliography(), folio_id),
            settings: project_settings(self.effective_settings()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCOPE: &str = "original/path/folio:café";
    const FOREIGN: &str = "unmounted/foreign";
    fn retained() -> ApparatusRecord {
        parse_apparatus_json(include_bytes!("../fixtures/apparatus/retained-native.json")).unwrap()
    }
    fn reference() -> Value {
        serde_json::from_slice(include_bytes!(
            "../fixtures/apparatus/source-reference.json"
        ))
        .unwrap()
    }
    fn record_with_rows(rows: Value) -> Arc<ApparatusRecord> {
        Arc::new(ApparatusRecord {
            bibliography: OptionalField::Value(rows),
            ..ApparatusRecord::default()
        })
    }
    fn rows(record: &ApparatusRecord) -> &Value {
        record.effective_bibliography().as_ref().unwrap()
    }
    fn request(session: &mut ApparatusSession, edit: ApparatusEdit) -> ApparatusRequest {
        session.request(edit).unwrap().unwrap()
    }

    #[test]
    fn raw_missing_null_malformed_and_unknown_fields_roundtrip_without_display_repair() {
        let source: Value =
            serde_json::from_slice(include_bytes!("../fixtures/apparatus/retained-native.json"))
                .unwrap();
        let record = retained();
        assert_eq!(serde_json::to_value(&record).unwrap(), source);
        assert!(record.local_bibliography.is_missing());
        let display = record.display(SCOPE).unwrap();
        let first = &display.bibliography.entries[0].entry;
        assert_eq!(first.note, OptionalField::Null);
        assert_eq!(first.accepted, OptionalField::Null);
        assert_eq!(first.target, OptionalField::Null);
        assert!(first.background_query.is_missing());
        assert_eq!(
            first.extra["futureSource"],
            source["bibliography"][0]["futureSource"]
        );
        assert_eq!(
            display.bibliography.entries[0].raw,
            source["bibliography"][0]
        );
        assert_eq!(
            first.accessed_at,
            source["bibliography"][0]["accessedAt"].as_f64().unwrap()
        );
        let second = &display.bibliography.entries[1].entry;
        assert!(second.is_background());
        let target = second.target.as_ref().unwrap();
        assert_eq!(target.kind, "future-kind");
        assert_eq!(target.reason, OptionalField::Null);
        assert_eq!(target.extra["futureTarget"], true);
        assert_eq!(serde_json::to_value(&record).unwrap(), source);

        for (key, value) in [
            ("bibliography", Value::Null),
            ("settings", Value::Null),
            ("localBibliography", json!({"future":null})),
            ("localSettings", json!([null, "opaque"])),
        ] {
            let mut raw =
                json!({"format":APPARATUS_FORMAT,"version":1,"generation":0,"unknown":null});
            raw[key] = value;
            let parsed = parse_apparatus_json(&serde_json::to_vec(&raw).unwrap()).unwrap();
            assert_eq!(serde_json::to_value(parsed).unwrap(), raw);
        }
    }

    #[test]
    fn projection_uses_exact_original_scope_and_surfaces_unsafe_rows() {
        let record = retained();
        let source = reference();
        let display = record.display(SCOPE).unwrap();
        assert_eq!(display.bibliography.state, ProjectionState::Valid);
        assert!(display.bibliography.editable);
        let displayed: Vec<_> = display
            .bibliography
            .entries
            .iter()
            .map(|row| row.entry.id.clone())
            .collect();
        assert_eq!(displayed, ["source-existing", "background-retained"]);
        let original_ids = source["scopedIds"].as_array().unwrap();
        assert!(original_ids.contains(&json!("bad-title"))); // Source's scope filter alone is not safe display validation.
        assert!(
            display
                .bibliography
                .issues
                .iter()
                .any(|issue| issue.path == "bibliography[9]")
        );
        assert_eq!(display.bibliography.entries[1].index, 1);
        let foreign: Vec<_> = record
            .display(FOREIGN)
            .unwrap()
            .bibliography
            .entries
            .into_iter()
            .map(|row| row.entry.id)
            .collect();
        assert_eq!(serde_json::to_value(foreign).unwrap(), source["foreignIds"]);
        assert!(record.display("").is_err());
        assert!(
            record
                .display("folio:café")
                .unwrap()
                .bibliography
                .entries
                .is_empty()
        );
        assert!(
            record
                .display("original/path/folio:cafe")
                .unwrap()
                .bibliography
                .entries
                .is_empty()
        );
        assert_eq!(
            record
                .display("unused/folio")
                .unwrap()
                .settings
                .citation_style,
            CitationStyle::Chicago
        );
    }

    #[test]
    fn malformed_roots_refuse_edits_and_missing_or_null_are_explicit_empty_states() {
        let mut record = ApparatusRecord::default();
        for raw in [OptionalField::Missing, OptionalField::Null] {
            record.bibliography = raw.clone();
            record.settings = raw.clone();
            let display = record.display(SCOPE).unwrap();
            assert!(display.bibliography.entries.is_empty());
            assert_eq!(display.settings.citation_style, CitationStyle::Mla);
            assert_eq!(
                display.bibliography.state,
                if raw.is_missing() {
                    ProjectionState::Missing
                } else {
                    ProjectionState::Null
                }
            );
            let base = Arc::new(record.clone());
            let mut session = ApparatusSession::new(base.clone());
            assert!(
                session
                    .request(ApparatusEdit::Drop {
                        folio_id: SCOPE.into(),
                        id: "absent".into()
                    })
                    .unwrap()
                    .is_none()
            );
            assert_eq!(session.saved(), &base);
        }
        record.bibliography = OptionalField::Value(json!({"wrong":"array","keep":null}));
        record.settings = OptionalField::Value(json!(["not", "settings", null]));
        let base = Arc::new(record);
        let display = base.display(SCOPE).unwrap();
        assert_eq!(display.bibliography.state, ProjectionState::Malformed);
        assert_eq!(display.settings.state, ProjectionState::Malformed);
        assert!(!display.bibliography.editable && !display.settings.editable);
        let mut session = ApparatusSession::new(base.clone());
        for edit in [
            ApparatusEdit::Drop {
                folio_id: SCOPE.into(),
                id: "source-existing".into(),
            },
            ApparatusEdit::Upsert {
                folio_id: SCOPE.into(),
                entry: reference()["builder"].clone(),
            },
            ApparatusEdit::SetCitationStyle(CitationStyle::Apa),
        ] {
            assert!(session.request(edit).is_err());
            assert!(session.pending().is_none());
            assert_eq!(session.saved(), &base);
        }
    }

    #[test]
    fn guarded_detected_add_matches_executed_original_merge_and_undefined_clearing() {
        let source = reference();
        for case in source["cases"].as_array().unwrap() {
            let base = record_with_rows(case["before"].clone());
            let merge =
                serde_json::from_value::<Option<UrlMergeTarget>>(case["mergeTarget"].clone())
                    .unwrap();
            let mut session = ApparatusSession::new(base.clone());
            let edit = request(
                &mut session,
                ApparatusEdit::AddDetected {
                    folio_id: SCOPE.into(),
                    entry: case["candidate"].clone(),
                    merge,
                },
            );
            assert_eq!(rows(&edit.candidate), &case["after"], "{}", case["name"]);
            assert_eq!(edit.candidate.bibliography, base.bibliography);
            assert_eq!(session.saved(), &base);
            assert!(session.acknowledge_saved(edit.request_id, edit.candidate.clone()));
            assert_eq!(session.saved(), &edit.candidate);
        }
        let merged = &source["cases"][0]["candidate"];
        for key in ["author", "publisher", "date", "year", "doi"] {
            assert!(
                merged.get(key).is_none(),
                "Original builder cleared {key} before JSON."
            );
        }
        for key in [
            "id",
            "note",
            "citationKey",
            "target",
            "citationInsertedAt",
            "futureSource",
        ] {
            assert_eq!(merged[key], source["cases"][0]["before"][0][key]);
        }
        assert_eq!(source["cases"][3]["mergeTarget"]["index"], 1);
        assert_eq!(
            source["cases"][3]["after"][1],
            source["cases"][3]["before"][1]
        );
    }

    #[test]
    fn exact_drop_and_complete_upsert_match_source_and_preserve_other_raw_rows() {
        let source = reference();
        let mut session = ApparatusSession::new(record_with_rows(source["drop"]["before"].clone()));
        let drop = request(
            &mut session,
            ApparatusEdit::Drop {
                folio_id: SCOPE.into(),
                id: source["drop"]["id"].as_str().unwrap().into(),
            },
        );
        assert_eq!(rows(&drop.candidate), &source["drop"]["after"]);
        assert!(
            rows(&drop.candidate)
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["id"] == "source-existing" && row["folioId"] == FOREIGN)
        );
        let mut session =
            ApparatusSession::new(record_with_rows(source["upsert"]["before"].clone()));
        let upsert = request(
            &mut session,
            ApparatusEdit::Upsert {
                folio_id: SCOPE.into(),
                entry: source["upsert"]["candidate"].clone(),
            },
        );
        assert_eq!(rows(&upsert.candidate), &source["upsert"]["after"]);

        let base = Arc::new(retained());
        let mut session = ApparatusSession::new(base.clone());
        assert!(
            session
                .request(ApparatusEdit::Upsert {
                    folio_id: SCOPE.into(),
                    entry: rows(&base)[0].clone()
                })
                .unwrap()
                .is_none()
        );
        let drop = request(
            &mut session,
            ApparatusEdit::Drop {
                folio_id: SCOPE.into(),
                id: "source-existing".into(),
            },
        );
        assert_eq!(
            rows(&drop.candidate).as_array().unwrap(),
            &rows(&base).as_array().unwrap()[1..]
        );
        assert_eq!(drop.candidate.bibliography, base.bibliography);
        assert_eq!(drop.candidate.settings, base.settings);
    }

    #[test]
    fn stale_merge_foreign_identity_and_failed_batch_never_stage_a_candidate() {
        let source = reference();
        let case = &source["cases"][0];
        let base = record_with_rows(case["before"].clone());
        let target: UrlMergeTarget = serde_json::from_value(case["mergeTarget"].clone()).unwrap();
        let mut changed_target = target.clone();
        changed_target.expected_raw_row["futureSource"] = json!({"late":"change"});
        let mut changed_id = case["candidate"].clone();
        changed_id["id"] = json!("other-id");
        let mut changed_scope = case["candidate"].clone();
        changed_scope["folioId"] = json!(FOREIGN);
        let mut blank_url = case["candidate"].clone();
        blank_url["url"] = json!("\u{a0}\u{feff} ");
        let mut session = ApparatusSession::new(base.clone());
        for edit in [
            ApparatusEdit::AddDetected {
                folio_id: SCOPE.into(),
                entry: case["candidate"].clone(),
                merge: Some(changed_target),
            },
            ApparatusEdit::AddDetected {
                folio_id: SCOPE.into(),
                entry: changed_id,
                merge: Some(target.clone()),
            },
            ApparatusEdit::AddDetected {
                folio_id: SCOPE.into(),
                entry: blank_url,
                merge: Some(target),
            },
            ApparatusEdit::Batch(vec![
                ApparatusEdit::SetCitationStyle(CitationStyle::Apa),
                ApparatusEdit::Upsert {
                    folio_id: SCOPE.into(),
                    entry: changed_scope,
                },
            ]),
            ApparatusEdit::Drop {
                folio_id: "".into(),
                id: "source-existing".into(),
            },
        ] {
            assert!(session.request(edit).is_err());
            assert!(session.pending().is_none());
            assert_eq!(session.saved(), &base);
        }
    }

    #[test]
    fn global_style_change_preserves_unrelated_settings_sources_and_timestamps() {
        let base = Arc::new(retained());
        let mut session = ApparatusSession::new(base.clone());
        let edit = request(
            &mut session,
            ApparatusEdit::SetCitationStyle(CitationStyle::Apa),
        );
        let mut expected = base.effective_settings().as_ref().unwrap().clone();
        expected["defaultCitationStyle"] = json!("apa");
        assert_eq!(
            edit.candidate.effective_settings().as_ref(),
            Some(&expected)
        );
        assert_eq!(edit.candidate.settings, base.settings);
        assert_eq!(edit.candidate.bibliography, base.bibliography);
        assert_eq!(edit.candidate.local_bibliography, base.local_bibliography);
        assert_eq!(edit.candidate.extra, base.extra);
        assert_eq!(
            edit.candidate
                .display(FOREIGN)
                .unwrap()
                .settings
                .citation_style,
            CitationStyle::Apa
        );
        assert!(session.acknowledge_saved(edit.request_id, edit.candidate));
        assert!(
            session
                .request(ApparatusEdit::SetCitationStyle(CitationStyle::Apa))
                .unwrap()
                .is_none()
        );

        for raw in [
            OptionalField::Missing,
            OptionalField::Null,
            OptionalField::Value(json!({"defaultCitationStyle":"future","opaque":null})),
        ] {
            let base = Arc::new(ApparatusRecord {
                settings: raw.clone(),
                ..ApparatusRecord::default()
            });
            let mut session = ApparatusSession::new(base.clone());
            assert_eq!(
                base.display(SCOPE).unwrap().settings.citation_style,
                CitationStyle::Mla
            );
            let edit = request(
                &mut session,
                ApparatusEdit::SetCitationStyle(CitationStyle::Mla),
            );
            assert_eq!(edit.candidate.settings, raw);
            assert_eq!(
                edit.candidate.effective_settings().as_ref().unwrap()["defaultCitationStyle"],
                "mla"
            );
            if raw.as_ref().is_some() {
                assert_eq!(
                    edit.candidate.effective_settings().as_ref().unwrap()["opaque"],
                    Value::Null
                );
                assert!(!base.display(SCOPE).unwrap().settings.issues.is_empty());
            }
        }
    }

    #[test]
    fn failed_write_holds_request_retry_is_identical_and_late_or_partial_ack_refuses() {
        let folder = tempfile::tempdir().unwrap();
        let store = ApparatusStore::open(folder.path()).unwrap();
        let original = serde_json::to_vec_pretty(&retained()).unwrap();
        fs::write(store.path(), &original).unwrap();
        let base = store.load().unwrap().record;
        let mut session = ApparatusSession::new(base.clone());
        let edit = request(
            &mut session,
            ApparatusEdit::SetCitationStyle(CitationStyle::Apa),
        );
        assert_eq!(session.saved(), &base);
        assert!(
            session
                .request(ApparatusEdit::Drop {
                    folio_id: SCOPE.into(),
                    id: "source-existing".into()
                })
                .is_err()
        );
        assert!(!session.replace_record(base.clone()));
        assert!(session.retry().is_none());
        fs::create_dir(store.path().with_extension("json.bak")).unwrap();
        assert!(store.save_request(&edit).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), original);
        assert_eq!(store.load().unwrap().record, base);
        assert!(!session.report_error(Uuid::new_v4(), "foreign error"));
        assert!(session.report_error(edit.request_id, "disk failure"));
        let retry = session.retry().unwrap();
        assert_eq!(retry, edit);
        assert!(session.error().is_none());
        fs::remove_dir(store.path().with_extension("json.bak")).unwrap();
        let accepted = store.clone().save_request(&retry).unwrap();
        assert_eq!(store.save_request(&retry).unwrap(), accepted); // Durable write whose first ACK was lost.
        assert!(!session.acknowledge_saved(Uuid::new_v4(), accepted.clone()));
        assert!(!session.acknowledge_saved(retry.request_id, base));
        let mut partial = (*accepted).clone();
        partial.extra.clear();
        assert!(!session.acknowledge_saved(retry.request_id, Arc::new(partial)));
        assert!(session.acknowledge_saved(retry.request_id, accepted.clone()));
        assert!(!session.report_error(retry.request_id, "late error"));
        let next = request(
            &mut session,
            ApparatusEdit::Drop {
                folio_id: SCOPE.into(),
                id: "source-existing".into(),
            },
        );
        assert!(!session.acknowledge_saved(retry.request_id, accepted.clone()));
        assert_eq!(session.pending().unwrap(), &next);
        assert_eq!(
            ApparatusStore::open(folder.path())
                .unwrap()
                .load()
                .unwrap()
                .record,
            accepted
        );
    }

    #[test]
    fn full_raw_candidate_cas_and_replacement_reject_same_generation_differences() {
        let folder = tempfile::tempdir().unwrap();
        let store = ApparatusStore::open(folder.path()).unwrap();
        let base = store.load().unwrap().record;
        let mut a = ApparatusSession::new(base.clone());
        let mut b = ApparatusSession::new(base);
        let first = request(&mut a, ApparatusEdit::SetCitationStyle(CitationStyle::Apa));
        let stale = request(
            &mut b,
            ApparatusEdit::SetCitationStyle(CitationStyle::Chicago),
        );
        let saved = store.save_request(&first).unwrap();
        assert!(store.save_request(&stale).is_err());
        assert!(a.acknowledge_saved(first.request_id, saved.clone()));
        let mut altered = (*saved).clone();
        altered
            .extra
            .insert("sameGenerationChange".into(), json!(null));
        assert!(!a.replace_record(Arc::new(altered.clone())));
        let mut mismatched = ApparatusSession::new(Arc::new(altered));
        let mismatch = request(
            &mut mismatched,
            ApparatusEdit::SetCitationStyle(CitationStyle::Mla),
        );
        assert!(store.save_request(&mismatch).is_err());
        assert!(!a.replace_record(Arc::new(ApparatusRecord::default())));
        let mut future = (*saved).clone();
        future.version += 1;
        future.generation += 1;
        assert!(!a.replace_record(Arc::new(future)));
        let mut invalid = stale;
        invalid.expected_generation += 1;
        assert!(store.save_request(&invalid).is_err());
        assert_eq!(store.load().unwrap().record, saved);
    }

    #[test]
    fn cloned_store_writers_serialize_full_candidate_cas() {
        let folder = tempfile::tempdir().unwrap();
        let store = ApparatusStore::open(folder.path()).unwrap();
        let base = store.load().unwrap().record;
        let mut a = ApparatusSession::new(base.clone());
        let mut b = ApparatusSession::new(base);
        let requests = [
            request(&mut a, ApparatusEdit::SetCitationStyle(CitationStyle::Apa)),
            request(
                &mut b,
                ApparatusEdit::SetCitationStyle(CitationStyle::Chicago),
            ),
        ];
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = requests
            .iter()
            .cloned()
            .map(|request| {
                let store = store.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.save_request(&request)
                })
            })
            .collect();
        let outcomes: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        let saved = store.load().unwrap().record;
        assert!(requests.iter().any(|request| request.candidate == saved));
        assert_eq!(saved.generation, 1);
    }

    #[test]
    fn damaged_backup_recovery_and_future_files_are_preserved_exactly() {
        let folder = tempfile::tempdir().unwrap();
        let store = ApparatusStore::open(folder.path()).unwrap();
        let base = retained();
        fs::write(
            store.path().with_extension("json.bak"),
            serde_json::to_vec(&base).unwrap(),
        )
        .unwrap();
        assert!(!store.load().unwrap().warnings.is_empty());
        assert!(!store.path().exists());
        let damaged = b"{ damaged Apparatus";
        fs::write(store.path(), damaged).unwrap();
        let recovered = store.load().unwrap();
        assert_eq!(*recovered.record, base);
        assert!(!recovered.warnings.is_empty());
        assert_eq!(fs::read(store.path()).unwrap(), damaged);
        let mut session = ApparatusSession::new(recovered.record);
        let edit = request(
            &mut session,
            ApparatusEdit::SetCitationStyle(CitationStyle::Apa),
        );
        store.save_request(&edit).unwrap();
        let preserved = fs::read_dir(folder.path())
            .unwrap()
            .find_map(|entry| {
                let entry = entry.unwrap();
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("json.damaged-")
                    .then(|| fs::read(entry.path()).unwrap())
            })
            .unwrap();
        assert_eq!(preserved, damaged);
        let mut future = base;
        future.version += 1;
        for bytes in [
            serde_json::to_vec(&future).unwrap(),
            b"[]".to_vec(),
            b"{\"bibliography\":null}".to_vec(),
        ] {
            fs::write(store.path(), &bytes).unwrap();
            assert!(store.load().is_err());
            assert!(store.save_request(&edit).is_err());
            assert_eq!(fs::read(store.path()).unwrap(), bytes);
        }
    }

    #[test]
    fn explicit_size_and_generation_boundaries_reject_before_staging() {
        assert!(parse_apparatus_json(&vec![b' '; MAX_APPARATUS_BYTES + 1]).is_err());
        let exhausted = Arc::new(ApparatusRecord {
            generation: u64::MAX,
            ..ApparatusRecord::default()
        });
        let mut session = ApparatusSession::new(exhausted.clone());
        assert!(
            session
                .request(ApparatusEdit::SetCitationStyle(CitationStyle::Apa))
                .is_err()
        );
        assert!(session.pending().is_none());
        assert_eq!(session.saved(), &exhausted);
        let mut huge = ApparatusRecord::default();
        huge.extra.insert(
            "retainedHuge".into(),
            json!("x".repeat(MAX_APPARATUS_BYTES)),
        );
        let base = Arc::new(huge);
        let mut session = ApparatusSession::new(base.clone());
        assert!(
            session
                .request(ApparatusEdit::SetCitationStyle(CitationStyle::Apa))
                .is_err()
        );
        assert!(session.pending().is_none());
        assert_eq!(session.saved(), &base);
    }
}
