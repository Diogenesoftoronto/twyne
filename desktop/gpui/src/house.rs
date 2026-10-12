//! The offline House: the web's metadata, not a second manuscript format.
//! Original string identities and foreign references survive round trips. The
//! application holds its library OS lock while sharing this store handle.

use crate::{
    dossier::{answer, set_answer},
    workspace::{BriefField, DossierAttachment, ExtraFields, Folio, ProjectBrief},
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const HOUSE_FORMAT: &str = "twyne-gpui-house";
pub const HOUSE_VERSION: u64 = 1;
pub const MAX_HOUSE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_LOCAL_LEDGER: usize = 500;
pub fn is_js_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' |
        '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' |
        '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub const DOSSIER_FIELDS: [BriefField; 7] = [
    BriefField::WorkingTitle,
    BriefField::Format,
    BriefField::Audience,
    BriefField::Goal,
    BriefField::Tone,
    BriefField::Constraints,
    BriefField::SuccessSignal,
];
pub const INHERITABLE_FIELDS: [BriefField; 6] = [
    BriefField::Format,
    BriefField::Audience,
    BriefField::Goal,
    BriefField::Tone,
    BriefField::Constraints,
    BriefField::SuccessSignal,
];
pub fn field_key(field: BriefField) -> &'static str {
    match field {
        BriefField::WorkingTitle => "workingTitle",
        BriefField::Format => "format",
        BriefField::Audience => "audience",
        BriefField::Goal => "goal",
        BriefField::Tone => "tone",
        BriefField::Constraints => "constraints",
        BriefField::SuccessSignal => "successSignal",
    }
}
pub fn field_label(field: BriefField) -> &'static str {
    match field {
        BriefField::WorkingTitle => "Working title",
        BriefField::Format => "Form",
        BriefField::Audience => "Reader",
        BriefField::Goal => "Aim",
        BriefField::Tone => "Tone",
        BriefField::Constraints => "Constraints",
        BriefField::SuccessSignal => "Success looks like",
    }
}

// Unknown enum strings are compatible metadata, never a command to execute.
macro_rules! open_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum $name { $($variant,)+ Other(String) }
        impl $name {
            pub fn as_str(&self) -> &str {
                match self { $(Self::$variant => $wire,)+ Self::Other(value) => value }
            }
        }
        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok,S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self,D::Error> {
                let value = String::deserialize(deserializer)?;
                Ok(match value.as_str() { $($wire => Self::$variant,)+ _ => Self::Other(value) })
            }
        }
    };
}
open_enum!(ContextLayer { House => "house", Collection => "collection", Folio => "folio", Amendment => "amendment", Charter => "charter" });
open_enum!(CharterScope { House => "house", Collection => "collection", Folio => "folio" });
open_enum!(CharterSeverity { Must => "must", Prefer => "prefer" });
open_enum!(CharterKind { Length => "length", Citation => "citation", Style => "style", Voice => "voice", General => "other" });
open_enum!(LedgerSource { Interview => "interview", Refine => "refine", Amendment => "amendment", House => "house", Collection => "collection", Charter => "charter", Manual => "manual", Sync => "sync" });
impl ContextLayer {
    pub fn label(&self) -> &str {
        match self {
            Self::House => "The House",
            Self::Collection => "Collection",
            Self::Folio => "Folio dossier",
            Self::Amendment => "Amendment",
            Self::Charter => "Charter",
            Self::Other(value) => value,
        }
    }
}
impl LedgerSource {
    pub fn label(&self) -> &str {
        match self {
            Self::Interview => "Filed at the interview",
            Self::Refine => "Refined by hand",
            Self::Amendment => "Amended from the draft",
            Self::House => "Set at the House",
            Self::Collection => "Set for the collection",
            Self::Charter => "Charter changed",
            Self::Manual => "Edited",
            Self::Sync => "Arrived from another device",
            Self::Other(value) => value,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartialAnswers {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success_signal: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl PartialAnswers {
    pub fn get(&self, field: BriefField) -> Option<&str> {
        match field {
            BriefField::WorkingTitle => &self.working_title,
            BriefField::Format => &self.format,
            BriefField::Audience => &self.audience,
            BriefField::Goal => &self.goal,
            BriefField::Tone => &self.tone,
            BriefField::Constraints => &self.constraints,
            BriefField::SuccessSignal => &self.success_signal,
        }
        .as_deref()
    }
    pub fn set(&mut self, field: BriefField, value: String) {
        *match field {
            BriefField::WorkingTitle => &mut self.working_title,
            BriefField::Format => &mut self.format,
            BriefField::Audience => &mut self.audience,
            BriefField::Goal => &mut self.goal,
            BriefField::Tone => &mut self.tone,
            BriefField::Constraints => &mut self.constraints,
            BriefField::SuccessSignal => &mut self.success_signal,
        } = Some(value);
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct House {
    pub name: String,
    pub dossier: PartialAnswers,
    pub updated_at: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub folio_ids: Vec<String>,
    pub dossier: PartialAnswers,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CharterItem {
    pub id: String,
    pub scope: CharterScope,
    pub owner_ref: String,
    pub text: String,
    pub severity: CharterSeverity,
    pub kind: CharterKind,
    pub order: f64,
    pub updated_at: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    pub at: u64,
    pub layer: ContextLayer,
    pub owner_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub source: LedgerSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HouseState {
    pub house: House,
    pub collections: Vec<Collection>,
    pub charter: Vec<CharterItem>,
    /// Newest first; importing does not truncate history. A new local write
    /// follows the web store's 500-entry bound.
    pub ledger: Vec<LedgerEntry>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl HouseState {
    pub fn collection_for_folio(&self, folio_id: &str) -> Option<&Collection> {
        if folio_id.is_empty() {
            return None;
        }
        self.collections
            .iter()
            .find(|collection| collection.folio_ids.iter().any(|id| id == folio_id))
    }
    pub fn collection(&self, id: &str) -> Option<&Collection> {
        self.collections
            .iter()
            .find(|collection| collection.id == id)
    }
    pub fn ledger_for_folio(&self, folio_id: &str) -> Vec<&LedgerEntry> {
        let collection = self.collection_for_folio(folio_id);
        self.ledger
            .iter()
            .filter(|entry| {
                entry.owner_ref == "house"
                    || entry.owner_ref == folio_id
                    || collection.is_some_and(|collection| collection.id == entry.owner_ref)
            })
            .collect()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HouseRecord {
    pub format: String,
    pub version: u64,
    pub generation: u64,
    pub state: HouseState,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl Default for HouseRecord {
    fn default() -> Self {
        Self::from_state(HouseState::default())
    }
}
impl HouseRecord {
    pub fn from_state(state: HouseState) -> Self {
        Self {
            format: HOUSE_FORMAT.into(),
            version: HOUSE_VERSION,
            generation: 0,
            state,
            extra: ExtraFields::new(),
        }
    }
    /// Accept an exact web HouseState or this native envelope. This is an
    /// explicit import boundary; missing arrays or invalid types are errors.
    pub fn from_value(value: &Value) -> Result<Self> {
        let record = if value.get("format").is_some() {
            serde_json::from_value::<Self>(value.clone())
                .context("This native House file is incomplete.")?
        } else {
            Self::from_state(
                serde_json::from_value(value.clone())
                    .context("This file has no usable House state.")?,
            )
        };
        record.validate()?;
        Ok(record)
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.format == HOUSE_FORMAT,
            "This file belongs to another House format."
        );
        ensure!(
            self.version == HOUSE_VERSION,
            "This native House needs another version of Twyne."
        );
        ensure!(
            self.state.charter.iter().all(|item| item.order.is_finite()),
            "Charter order must be finite."
        );
        // References may belong to folios not imported on this device. They
        // are metadata, not an instruction to discard those identities.
        Ok(())
    }
    pub fn to_web_value(&self) -> Result<Value> {
        Ok(serde_json::to_value(&self.state)?)
    }
}
#[derive(Clone, Debug)]
pub struct HouseLoad {
    pub record: Arc<HouseRecord>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct HouseRequest {
    pub request_id: Uuid,
    pub expected_generation: u64,
    pub base: Arc<HouseRecord>,
    pub candidate: Arc<HouseRecord>,
}

#[derive(Clone, Debug)]
pub struct CharterDraft {
    pub id: Option<String>,
    pub scope: CharterScope,
    pub owner_ref: String,
    pub text: String,
    pub severity: CharterSeverity,
    pub kind: CharterKind,
    pub order: Option<f64>,
}
#[derive(Clone, Debug)]
pub enum HouseEdit {
    Name(String),
    HouseField {
        field: BriefField,
        value: String,
    },
    CreateCollection {
        id: String,
        name: String,
        folio_ids: Vec<String>,
    },
    UpdateCollection {
        id: String,
        name: Option<String>,
        description: Option<String>,
        field: Option<(BriefField, String)>,
    },
    DissolveCollection(String),
    Membership {
        folio_id: String,
        collection_id: Option<String>,
    },
    Charter(CharterDraft),
    WithdrawCharter(String),
    Batch(Vec<HouseEdit>),
}

fn ledger(layer: ContextLayer, owner_ref: &str, source: LedgerSource, now: u64) -> LedgerEntry {
    LedgerEntry {
        id: Uuid::new_v4().to_string(),
        at: now,
        layer,
        owner_ref: owner_ref.into(),
        field: None,
        from: None,
        to: None,
        source,
        reason: None,
        extra: ExtraFields::new(),
    }
}
fn apply_edit(state: &mut HouseState, edit: &HouseEdit, now: u64) -> Result<bool> {
    match edit {
        HouseEdit::Batch(edits) => {
            let mut changed = false;
            for edit in edits {
                changed |= apply_edit(state, edit, now)?;
            }
            Ok(changed)
        }
        HouseEdit::Name(name) => {
            let mut entry = ledger(ContextLayer::House, "house", LedgerSource::House, now);
            entry.field = Some("name".into());
            entry.from = Some(state.house.name.clone());
            state.house.name = name.trim_matches(is_js_whitespace).into();
            entry.to = Some(state.house.name.clone());
            state.ledger.insert(0, entry);
            Ok(true)
        }
        HouseEdit::HouseField { field, value } => {
            let before = state.house.dossier.get(*field).unwrap_or("").to_owned();
            let value = value.trim_matches(is_js_whitespace);
            if before == value {
                return Ok(false);
            }
            state.house.dossier.set(*field, value.into());
            let mut entry = ledger(ContextLayer::House, "house", LedgerSource::House, now);
            entry.field = Some(field_key(*field).into());
            entry.from = Some(before);
            entry.to = Some(value.into());
            state.ledger.insert(0, entry);
            Ok(true)
        }
        HouseEdit::CreateCollection {
            id,
            name,
            folio_ids,
        } => {
            ensure!(
                !id.is_empty() && state.collection(id).is_none(),
                "That collection identity is already in use."
            );
            for collection in &mut state.collections {
                collection
                    .folio_ids
                    .retain(|folio| !folio_ids.contains(folio));
            }
            let name = if name.trim_matches(is_js_whitespace).is_empty() {
                "Untitled collection"
            } else {
                name.trim_matches(is_js_whitespace)
            };
            state.collections.push(Collection {
                id: id.clone(),
                name: name.into(),
                description: String::new(),
                folio_ids: folio_ids.clone(),
                dossier: PartialAnswers::default(),
                created_at: now,
                updated_at: now,
                extra: ExtraFields::new(),
            });
            let mut entry = ledger(ContextLayer::Collection, id, LedgerSource::Collection, now);
            entry.to = Some(name.into());
            entry.reason = Some("Collection founded".into());
            state.ledger.insert(0, entry);
            Ok(true)
        }
        HouseEdit::UpdateCollection {
            id,
            name,
            description,
            field,
        } => {
            let collection = state
                .collections
                .iter_mut()
                .find(|collection| &collection.id == id)
                .context("That collection is no longer in the cabinet.")?;
            let mut entries = Vec::new();
            for (key, before, next) in [
                ("name", &mut collection.name, name),
                ("description", &mut collection.description, description),
            ] {
                if let Some(next) = next {
                    let next = next.trim_matches(is_js_whitespace);
                    if key == "name" && next.is_empty() {
                        continue;
                    }
                    if before != next {
                        let mut entry =
                            ledger(ContextLayer::Collection, id, LedgerSource::Collection, now);
                        entry.field = Some(key.into());
                        entry.from = Some(before.clone());
                        entry.to = Some(next.into());
                        *before = next.into();
                        entries.push(entry);
                    }
                }
            }
            if let Some((field, value)) = field {
                let before = collection.dossier.get(*field).unwrap_or("");
                let value = value.trim_matches(is_js_whitespace);
                if before != value {
                    let mut entry =
                        ledger(ContextLayer::Collection, id, LedgerSource::Collection, now);
                    entry.field = Some(field_key(*field).into());
                    entry.from = Some(before.into());
                    entry.to = Some(value.into());
                    collection.dossier.set(*field, value.into());
                    entries.push(entry);
                }
            }
            // Like the web update, an explicit existing-collection commit
            // stamps the collection even if its fields were already equal.
            collection.updated_at = now;
            for entry in entries.into_iter().rev() {
                state.ledger.insert(0, entry);
            }
            Ok(true)
        }
        HouseEdit::DissolveCollection(id) => {
            let collection = state
                .collection(id)
                .context("That collection is no longer in the cabinet.")?;
            let mut entry = ledger(ContextLayer::Collection, id, LedgerSource::Collection, now);
            entry.from = Some(collection.name.clone());
            entry.reason = Some("Collection dissolved; its folios are now loose".into());
            state.collections.retain(|collection| &collection.id != id);
            state.charter.retain(|item| &item.owner_ref != id);
            state.ledger.insert(0, entry);
            Ok(true)
        }
        HouseEdit::Membership {
            folio_id,
            collection_id,
        } => {
            ensure!(
                !folio_id.is_empty(),
                "A folio needs its original identity to be filed."
            );
            if let Some(id) = collection_id {
                ensure!(
                    state.collection(id).is_some(),
                    "That collection is no longer in the cabinet."
                );
            }
            let mut entry = ledger(ContextLayer::Folio, folio_id, LedgerSource::Collection, now);
            entry.field = Some("collection".into());
            entry.from = state
                .collection_for_folio(folio_id)
                .map(|collection| collection.name.clone());
            entry.to = Some(
                collection_id
                    .as_ref()
                    .and_then(|id| state.collection(id))
                    .map_or("Loose folios", |collection| collection.name.as_str())
                    .into(),
            );
            entry.reason = Some("Collection membership changed".into());
            for collection in &mut state.collections {
                let was_member = collection.folio_ids.contains(folio_id);
                if collection_id.as_deref() == Some(&collection.id) {
                    if !was_member {
                        collection.folio_ids.push(folio_id.clone());
                        collection.updated_at = now;
                    }
                } else if was_member {
                    collection.folio_ids.retain(|id| id != folio_id);
                    collection.updated_at = now;
                }
            }
            state.ledger.insert(0, entry);
            Ok(true)
        }
        HouseEdit::Charter(draft) => {
            ensure!(
                !draft.text.trim_matches(is_js_whitespace).is_empty(),
                "An article needs a standard to file."
            );
            ensure!(
                draft.order.is_none_or(f64::is_finite),
                "Charter order must be finite."
            );
            let existing = draft
                .id
                .as_ref()
                .and_then(|id| state.charter.iter().find(|item| &item.id == id))
                .cloned();
            let mut entry = ledger(
                ContextLayer::Charter,
                &draft.owner_ref,
                LedgerSource::Charter,
                now,
            );
            entry.field = Some(draft.severity.as_str().into());
            entry.from = existing.as_ref().map(|item| item.text.clone());
            entry.to = Some(draft.text.trim_matches(is_js_whitespace).into());
            let item = CharterItem {
                id: draft
                    .id
                    .clone()
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                scope: draft.scope.clone(),
                owner_ref: draft.owner_ref.clone(),
                text: draft.text.trim_matches(is_js_whitespace).into(),
                severity: draft.severity.clone(),
                kind: draft.kind.clone(),
                order: draft
                    .order
                    .or_else(|| existing.as_ref().map(|item| item.order))
                    .unwrap_or_else(|| {
                        state
                            .charter
                            .iter()
                            .filter(|item| item.owner_ref == draft.owner_ref)
                            .count() as f64
                    }),
                updated_at: now,
                extra: existing.map_or_else(ExtraFields::new, |item| item.extra),
            };
            if let Some(previous) = state
                .charter
                .iter_mut()
                .find(|previous| previous.id == item.id)
            {
                *previous = item;
            } else {
                state.charter.push(item);
            }
            state.ledger.insert(0, entry);
            Ok(true)
        }
        HouseEdit::WithdrawCharter(id) => {
            let Some(item) = state.charter.iter().find(|item| &item.id == id) else {
                return Ok(false);
            };
            let mut entry = ledger(
                ContextLayer::Charter,
                &item.owner_ref,
                LedgerSource::Charter,
                now,
            );
            entry.from = Some(item.text.clone());
            entry.reason = Some("Standard withdrawn".into());
            state.charter.retain(|item| &item.id != id);
            state.ledger.insert(0, entry);
            Ok(true)
        }
    }
}

/// Saved metadata is immutable until the matching durable acknowledgement.
/// Failed requests retain the candidate (and its IDs) for an honest retry.
pub struct HouseSession {
    saved: Arc<HouseRecord>,
    pending: Option<HouseRequest>,
    error: Option<String>,
}
impl HouseSession {
    pub fn new(record: Arc<HouseRecord>) -> Self {
        Self {
            saved: record,
            pending: None,
            error: None,
        }
    }
    pub fn saved(&self) -> &Arc<HouseRecord> {
        &self.saved
    }
    pub fn pending(&self) -> Option<&HouseRequest> {
        self.pending.as_ref()
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn busy(&self) -> bool {
        self.pending.is_some() && self.error.is_none()
    }
    pub fn request(&mut self, edit: HouseEdit, now: u64) -> Result<Option<HouseRequest>> {
        ensure!(
            self.pending.is_none(),
            "File or discard the previous House change first."
        );
        let mut candidate = (*self.saved).clone();
        let now = now.max(
            candidate
                .state
                .house
                .updated_at
                .checked_add(1)
                .context("The House clock has exhausted its range.")?,
        );
        if !apply_edit(&mut candidate.state, &edit, now)? {
            return Ok(None);
        }
        candidate.state.house.updated_at = now;
        candidate.state.ledger.truncate(MAX_LOCAL_LEDGER);
        candidate.generation = candidate
            .generation
            .checked_add(1)
            .context("The House has exhausted its save generation.")?;
        candidate.validate()?;
        let request = HouseRequest {
            request_id: Uuid::new_v4(),
            expected_generation: self.saved.generation,
            base: self.saved.clone(),
            candidate: Arc::new(candidate),
        };
        self.pending = Some(request.clone());
        self.error = None;
        Ok(Some(request))
    }
    pub fn acknowledge_saved(&mut self, request_id: Uuid, record: Arc<HouseRecord>) -> bool {
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
    pub fn retry(&mut self) -> Option<HouseRequest> {
        self.error.take()?;
        self.pending.clone()
    }
    pub fn discard_failed(&mut self) -> bool {
        if self.error.is_none() {
            return false;
        }
        self.pending = None;
        self.error = None;
        true
    }
    pub fn replace_record(&mut self, record: Arc<HouseRecord>) -> bool {
        if record.generation < self.saved.generation
            || (record.generation == self.saved.generation && record != self.saved)
        {
            return false;
        }
        if record == self.saved {
            return true;
        }
        self.saved = record;
        self.pending = None;
        self.error = None;
        true
    }
}

#[derive(Clone)]
pub struct HouseStore {
    inner: Arc<StoreInner>,
}
struct StoreInner {
    path: PathBuf,
    writer: Mutex<()>,
}
impl HouseStore {
    /// Root's manuscript Store must retain the library instance OS lock.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root).context("Could not create the House folder.")?;
        Ok(Self {
            inner: Arc::new(StoreInner {
                path: root.join("house.json"),
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn path(&self) -> &Path {
        &self.inner.path
    }
    pub fn load(&self) -> Result<HouseLoad> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The House writer stopped unexpectedly."))?;
        self.load_locked()
    }
    fn load_locked(&self) -> Result<HouseLoad> {
        let backup = self.path().with_extension("json.bak");
        if !self.path().exists() {
            return if backup.exists() {
                Ok(HouseLoad {
                    record: Arc::new(read_record(&backup)?),
                    warnings: vec![
                        "Recovered the House from its previous save. The recovery file is kept."
                            .into(),
                    ],
                })
            } else {
                Ok(HouseLoad {
                    record: Arc::new(HouseRecord::default()),
                    warnings: Vec::new(),
                })
            };
        }
        match read_record(self.path()) {
            Ok(record) => Ok(HouseLoad {
                record: Arc::new(record),
                warnings: Vec::new(),
            }),
            Err(error) => {
                let bytes = read_bounded(self.path())?;
                if serde_json::from_slice::<Value>(&bytes).is_ok() {
                    return Err(error);
                }
                if backup.exists() {
                    return Ok(HouseLoad{record:Arc::new(read_record(&backup).with_context(||format!("Could not recover the House: {error}"))?),
                    warnings:vec!["Recovered the House from its previous save. The damaged file is kept until another save.".into()]});
                }
                // Unlike cosmetic appearance, defaulting here would lose
                // editorial metadata. Offer the error and retain exact bytes.
                Err(error.context("Could not open the House. Its damaged file has been kept."))
            }
        }
    }
    pub fn save_request(&self, request: &HouseRequest) -> Result<Arc<HouseRecord>> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The House writer stopped unexpectedly."))?;
        let current = self.load_locked()?.record;
        ensure!(
            current.generation == request.expected_generation && current == request.base,
            "The House changed before this edit could be filed. Reload it before saving."
        );
        ensure!(
            Some(request.candidate.generation) == current.generation.checked_add(1),
            "The House request has an invalid save generation."
        );
        request.candidate.validate()?;
        let bytes = serde_json::to_vec_pretty(&*request.candidate)?;
        ensure!(
            bytes.len() <= MAX_HOUSE_BYTES,
            "The House exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        if self.path().exists() {
            let previous = read_bounded(self.path())?;
            if read_record(self.path()).is_ok() {
                atomic_write(&self.path().with_extension("json.bak"), &previous)?;
            } else {
                fs::copy(
                    self.path(),
                    self.path()
                        .with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                )?;
            }
        }
        atomic_write(self.path(), &bytes)
            .context("The House could not be saved on this device.")?;
        Ok(request.candidate.clone())
    }
}
fn read_record(path: &Path) -> Result<HouseRecord> {
    HouseRecord::from_value(&serde_json::from_slice(&read_bounded(path)?)?)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_HOUSE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_HOUSE_BYTES,
        "The House is too large to open safely."
    );
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("The House has no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ShadowedField {
    pub layer: ContextLayer,
    pub value: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct StackField {
    pub field: BriefField,
    pub value: String,
    pub layer: Option<ContextLayer>,
    pub shadowed: Vec<ShadowedField>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct StackCharterItem {
    #[serde(flatten)]
    pub item: CharterItem,
    pub inherited: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextStack {
    pub folio_id: String,
    pub house: House,
    pub collection: Option<Collection>,
    pub fields: BTreeMap<String, StackField>,
    pub charter: Vec<StackCharterItem>,
    pub attachments: Vec<DossierAttachment>,
    pub amendments: Vec<LedgerEntry>,
}
pub fn assemble_context_stack(
    state: &HouseState,
    folio_id: &str,
    brief: Option<&ProjectBrief>,
    stand_ins: &PartialAnswers,
) -> ContextStack {
    let collection = state.collection_for_folio(folio_id);
    let amendments = state
        .ledger
        .iter()
        .filter(|entry| entry.source == LedgerSource::Amendment && entry.owner_ref == folio_id)
        .cloned()
        .collect();
    let mut latest = state.ledger.iter().collect::<Vec<_>>();
    latest.sort_by_key(|entry| std::cmp::Reverse(entry.at));
    let mut fields = BTreeMap::new();
    for field in DOSSIER_FIELDS {
        let folio_value = brief
            .map(|brief| answer(&brief.answers, field))
            .unwrap_or("")
            .trim_matches(is_js_whitespace);
        let is_stand_in = !folio_value.is_empty()
            && folio_value
                == stand_ins
                    .get(field)
                    .unwrap_or("")
                    .trim_matches(is_js_whitespace);
        let mut candidates = Vec::new();
        if !folio_value.is_empty() && !is_stand_in {
            let latest = latest.iter().find(|entry| {
                entry.owner_ref == folio_id && entry.field.as_deref() == Some(field_key(field))
            });
            let layer = if latest.is_some_and(|entry| {
                entry.source == LedgerSource::Amendment
                    && entry
                        .to
                        .as_deref()
                        .unwrap_or("")
                        .trim_matches(is_js_whitespace)
                        == folio_value
            }) {
                ContextLayer::Amendment
            } else {
                ContextLayer::Folio
            };
            candidates.push(ShadowedField {
                layer,
                value: folio_value.into(),
            });
        }
        if field != BriefField::WorkingTitle {
            let collection_value = collection
                .and_then(|collection| collection.dossier.get(field))
                .unwrap_or("")
                .trim_matches(is_js_whitespace);
            if !collection_value.is_empty() {
                candidates.push(ShadowedField {
                    layer: ContextLayer::Collection,
                    value: collection_value.into(),
                });
            }
            let house_value = state
                .house
                .dossier
                .get(field)
                .unwrap_or("")
                .trim_matches(is_js_whitespace);
            if !house_value.is_empty() {
                candidates.push(ShadowedField {
                    layer: ContextLayer::House,
                    value: house_value.into(),
                });
            }
        }
        if is_stand_in && candidates.is_empty() {
            candidates.push(ShadowedField {
                layer: ContextLayer::Folio,
                value: folio_value.into(),
            });
        }
        let (value, layer) = candidates
            .first()
            .map_or((String::new(), None), |candidate| {
                (candidate.value.clone(), Some(candidate.layer.clone()))
            });
        fields.insert(
            field_key(field).into(),
            StackField {
                field,
                value,
                layer,
                shadowed: candidates.into_iter().skip(1).collect(),
            },
        );
    }
    let mut charter = state
        .charter
        .iter()
        .filter(|item| {
            item.owner_ref == "house"
                || item.owner_ref == folio_id
                || collection.is_some_and(|collection| collection.id == item.owner_ref)
        })
        .map(|item| StackCharterItem {
            item: item.clone(),
            inherited: item.owner_ref != folio_id,
        })
        .collect::<Vec<_>>();
    fn rank(scope: &CharterScope) -> u8 {
        match scope {
            CharterScope::House => 0,
            CharterScope::Collection => 1,
            _ => 2,
        }
    }
    charter.sort_by(|a, b| {
        rank(&a.item.scope)
            .cmp(&rank(&b.item.scope))
            .then_with(|| {
                (a.item.severity != CharterSeverity::Must)
                    .cmp(&(b.item.severity != CharterSeverity::Must))
            })
            .then_with(|| a.item.order.total_cmp(&b.item.order))
    });
    ContextStack {
        folio_id: folio_id.into(),
        house: state.house.clone(),
        collection: collection.cloned(),
        fields,
        charter,
        attachments: brief.map_or_else(Vec::new, |brief| brief.attachments.clone()),
        amendments,
    }
}
/// Read-only merged consumer view. The filed brief and canonical manuscript
/// are never changed; compatible brief/probe/attachment metadata is retained.
pub fn effective_brief(
    stack: &ContextStack,
    brief: Option<&ProjectBrief>,
    now: u64,
) -> ProjectBrief {
    let mut result = brief.cloned().unwrap_or_else(|| ProjectBrief {
        answers: crate::dossier::default_answers(),
        attachments: Vec::new(),
        probes: None,
        completed_at: now,
        updated_at: now,
        extra: ExtraFields::new(),
    });
    for field in DOSSIER_FIELDS {
        set_answer(
            &mut result.answers,
            field,
            stack.fields[field_key(field)].value.clone(),
        );
    }
    let standards = stack
        .charter
        .iter()
        .map(|item| {
            format!(
                "{}: {}",
                if item.item.severity == CharterSeverity::Must {
                    "Must"
                } else {
                    "Prefer"
                },
                item.item.text
            )
        })
        .collect::<Vec<_>>();
    if !standards.is_empty() {
        result.answers.constraints = std::iter::once(result.answers.constraints.as_str())
            .filter(|value| !value.is_empty())
            .chain(standards.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join("\n");
    }
    result.attachments = stack.attachments.clone();
    result
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ContextLayerCost {
    pub layer: ContextLayer,
    pub chars: usize,
    pub tokens: usize,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ModelContext {
    pub text: String,
    pub layers: Vec<ContextLayerCost>,
}
pub fn context_for_models(stack: &ContextStack) -> ModelContext {
    let mut layers: Vec<ContextLayerCost> = Vec::new();
    let mut lines = Vec::new();
    let mut add = |layer: ContextLayer, line: &str| {
        let count = line.encode_utf16().count();
        if let Some(existing) = layers.iter_mut().find(|entry| entry.layer == layer) {
            existing.chars += count;
            existing.tokens = existing.chars.div_ceil(4);
        } else {
            layers.push(ContextLayerCost {
                layer,
                chars: count,
                tokens: count.div_ceil(4),
            });
        }
    };
    for field in DOSSIER_FIELDS {
        let entry = &stack.fields[field_key(field)];
        if let Some(layer) = &entry.layer
            && !entry.value.is_empty()
        {
            let line = format!("{}: {}", field_label(field), entry.value);
            add(layer.clone(), &line);
            lines.push(line);
        }
    }
    if !stack.charter.is_empty() {
        lines.push("Charter:".into());
        for item in &stack.charter {
            let line = format!(
                "- {}: {}",
                if item.item.severity == CharterSeverity::Must {
                    "Must"
                } else {
                    "Prefer"
                },
                item.item.text
            );
            add(ContextLayer::Charter, &line);
            lines.push(line);
        }
    }
    ModelContext {
        text: lines.join("\n"),
        layers,
    }
}

/// Root supplies previews/counts only after reconciling a projection. A source
/// document can have neither, without pretending its Typst bytes are prose.
#[derive(Clone, Debug, PartialEq)]
pub struct LibraryFolio {
    pub native_id: Uuid,
    pub folio_id: String,
    pub folio: Folio,
    pub brief: Option<ProjectBrief>,
    pub archived: bool,
    pub words: Option<usize>,
    pub preview: Option<String>,
    pub source_only: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LibrarySort {
    #[default]
    Recent,
    Name,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum LibraryScope {
    #[default]
    All,
    Loose,
    Collection(String),
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LibraryQuery {
    pub search: String,
    pub scope: LibraryScope,
    pub sort: LibrarySort,
    pub include_archived: bool,
}
impl LibraryQuery {
    /// `name_order` is an optional web Intl/localeCompare result, supplied by
    /// the existing offline JS bridge. No ICU locale is silently invented.
    pub fn apply<'a>(
        &self,
        folios: &'a [LibraryFolio],
        state: &HouseState,
        name_order: &[String],
    ) -> Vec<&'a LibraryFolio> {
        let mut name_rank = HashMap::with_capacity(name_order.len());
        for (rank, id) in name_order.iter().enumerate() {
            name_rank.entry(id.as_str()).or_insert(rank);
        }
        let query = self.search.trim_matches(is_js_whitespace).to_lowercase();
        let mut result = folios
            .iter()
            .filter(|folio| self.include_archived || !folio.archived)
            .filter(|folio| match &self.scope {
                LibraryScope::All => true,
                LibraryScope::Loose => state.collection_for_folio(&folio.folio_id).is_none(),
                LibraryScope::Collection(id) => state
                    .collection(id)
                    .is_some_and(|collection| collection.folio_ids.contains(&folio.folio_id)),
            })
            .filter(|folio| {
                query.is_empty()
                    || folio.folio.name.to_lowercase().contains(&query)
                    || folio
                        .preview
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&query)
            })
            .collect::<Vec<_>>();
        match self.sort {
            LibrarySort::Recent => {
                result.sort_by_key(|folio| std::cmp::Reverse(folio.folio.updated_at))
            }
            LibrarySort::Name => result.sort_by(|a, b| {
                let a_rank = name_rank.get(a.folio_id.as_str());
                let b_rank = name_rank.get(b.folio_id.as_str());
                match (a_rank, b_rank) {
                    (Some(a), Some(b)) => a.cmp(b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => a
                        .folio
                        .name
                        .to_lowercase()
                        .cmp(&b.folio.name.to_lowercase()),
                }
            }),
        }
        result
    }
}

/// Readable native import errors carry no automatic rewriting/migration.
pub fn parse_house_json(bytes: &[u8]) -> Result<HouseRecord> {
    if bytes.len() > MAX_HOUSE_BYTES {
        bail!("The House is too large to open safely.");
    }
    HouseRecord::from_value(
        &serde_json::from_slice(bytes).context("The House file is not valid JSON.")?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn reference() -> Value {
        serde_json::from_str(include_str!("../fixtures/house/web-reference.json")).unwrap()
    }
    fn base() -> HouseRecord {
        HouseRecord::from_value(&reference()["base"]).unwrap()
    }
    fn text(value: &Value) -> String {
        value.as_str().unwrap().into()
    }
    fn field(value: &Value) -> BriefField {
        serde_json::from_value(value.clone()).unwrap()
    }
    fn operation(case: &Value) -> HouseEdit {
        let args = &case["args"];
        match case["method"].as_str().unwrap() {
            "setHouseName" => HouseEdit::Name(text(&args[0])),
            "setHouseField" => HouseEdit::HouseField {
                field: field(&args[0]),
                value: text(&args[1]),
            },
            "createCollection" => HouseEdit::CreateCollection {
                id: text(&case["nativeId"]),
                name: text(&args[0]),
                folio_ids: serde_json::from_value(args[1].clone()).unwrap(),
            },
            "updateCollection" => HouseEdit::UpdateCollection {
                id: text(&args[0]),
                name: args[1].get("name").map(text),
                description: args[1].get("description").map(text),
                field: args[1]
                    .get("field")
                    .map(|patch| (field(&patch["name"]), text(&patch["value"]))),
            },
            "deleteCollection" => HouseEdit::DissolveCollection(text(&args[0])),
            "setFolioCollection" => HouseEdit::Membership {
                folio_id: text(&args[0]),
                collection_id: args[1].as_str().map(str::to_owned),
            },
            "upsertCharterItem" => HouseEdit::Charter(CharterDraft {
                id: args[0].get("id").map(text),
                scope: serde_json::from_value(args[0]["scope"].clone()).unwrap(),
                owner_ref: text(&args[0]["ownerRef"]),
                text: text(&args[0]["text"]),
                severity: serde_json::from_value(args[0]["severity"].clone()).unwrap(),
                kind: serde_json::from_value(args[0]["kind"].clone()).unwrap(),
                order: args[0].get("order").and_then(Value::as_f64),
            }),
            "removeCharterItem" => HouseEdit::WithdrawCharter(text(&args[0])),
            method => panic!("Unknown fixture operation {method}"),
        }
    }
    #[test]
    fn native_edits_match_executed_current_web_store_operations() {
        for case in reference()["operations"].as_array().unwrap() {
            let before = HouseRecord::from_value(&case["before"]).unwrap();
            let mut session = HouseSession::new(Arc::new(before.clone()));
            let request = session
                .request(operation(case), case["now"].as_u64().unwrap())
                .unwrap();
            let mut actual = request.as_ref().map_or_else(
                || before.state.clone(),
                |request| request.candidate.state.clone(),
            );
            let mut expected: HouseState = serde_json::from_value(case["after"].clone()).unwrap();
            // Generated ledger identities deliberately differ between runtimes;
            // imported identities are tested independently below.
            for entry in actual.ledger.iter_mut().chain(expected.ledger.iter_mut()) {
                entry.id.clear();
            }
            assert_eq!(actual, expected, "{} {:?}", case["method"], case["args"]);
            assert_eq!(
                *session.saved(),
                Arc::new(before),
                "emission must not claim a disk save"
            );
        }
    }
    #[test]
    fn native_context_matches_web_precedence_attribution_and_utf16_costs() {
        for case in reference()["contexts"].as_array().unwrap() {
            let state: HouseState = serde_json::from_value(case["state"].clone()).unwrap();
            let brief: ProjectBrief = serde_json::from_value(case["brief"].clone()).unwrap();
            let stand_ins: PartialAnswers =
                serde_json::from_value(case["standIns"].clone()).unwrap();
            let stack = assemble_context_stack(&state, "web/folio:café", Some(&brief), &stand_ins);
            let expected: ContextStack = serde_json::from_value(case["stack"].clone()).unwrap();
            assert_eq!(stack, expected, "{}", case["name"]);
            assert_eq!(
                context_for_models(&stack),
                serde_json::from_value::<ModelContext>(case["models"].clone()).unwrap()
            );
            let merged = effective_brief(&stack, Some(&brief), 10000);
            assert_eq!(merged.attachments, brief.attachments);
            assert_eq!(merged.probes, brief.probes);
            assert_eq!(merged.completed_at, brief.completed_at);
            assert_eq!(
                brief,
                serde_json::from_value::<ProjectBrief>(case["brief"].clone()).unwrap()
            );
        }
    }
    #[test]
    fn unknown_metadata_and_unimported_string_references_survive_disk_edits() {
        let dir = tempdir().unwrap();
        let store = HouseStore::open(dir.path()).unwrap();
        let mut value = reference()["base"].clone();
        value["futureState"] = json!({"source":"#let secret = [Exact\\r\\n]"});
        value["house"]["futureHouse"] = json!(["retain", 7]);
        value["house"]["dossier"]["futureField"] = json!({"value":"opaque"});
        value["ledger"] = json!([{"id":"foreign:ledger","at":9,"layer":"future-layer","ownerRef":"foreign:folio","source":"future-source","futureLedger":{"untouched":true}}]);
        value["charter"][0]["scope"] = json!("future-scope");
        fs::write(store.path(), serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        let loaded = store.load().unwrap().record;
        let mut session = HouseSession::new(loaded.clone());
        let request = session
            .request(HouseEdit::Name("Changed letterhead".into()), 1000)
            .unwrap()
            .unwrap();
        let saved = store.save_request(&request).unwrap();
        assert!(session.acknowledge_saved(request.request_id, saved.clone()));
        let reloaded = store.load().unwrap().record;
        assert_eq!(reloaded, saved);
        assert_eq!(reloaded.state.extra["futureState"], value["futureState"]);
        assert_eq!(
            reloaded.state.house.extra["futureHouse"],
            value["house"]["futureHouse"]
        );
        assert_eq!(
            reloaded.state.house.dossier.extra["futureField"],
            value["house"]["dossier"]["futureField"]
        );
        assert_eq!(reloaded.state.collections, loaded.state.collections);
        assert!(
            reloaded.state.collections[0]
                .folio_ids
                .contains(&"not-imported:folio".into())
        );
        assert_eq!(reloaded.state.ledger[1], loaded.state.ledger[0]);
        assert_eq!(reloaded.state.charter, loaded.state.charter);
        assert_eq!(
            fs::read(store.path().with_extension("json.bak")).unwrap(),
            serde_json::to_vec_pretty(&value).unwrap()
        );
    }
    #[test]
    fn dissolving_removes_only_that_layer_and_keeps_all_folio_material_external() {
        let mut session = HouseSession::new(Arc::new(base()));
        let request = session
            .request(
                HouseEdit::DissolveCollection("web/collection:letters".into()),
                1000,
            )
            .unwrap()
            .unwrap();
        assert_eq!(request.candidate.state.collections.len(), 1);
        assert_eq!(
            request.candidate.state.collections[0],
            request.base.state.collections[1]
        );
        assert_eq!(request.candidate.state.charter.len(), 1);
        assert_eq!(
            request.candidate.state.charter[0],
            request.base.state.charter[0]
        );
        assert_eq!(
            request.candidate.state.house.dossier,
            request.base.state.house.dossier
        );
        assert_eq!(
            request.candidate.state.ledger[0].reason.as_deref(),
            Some("Collection dissolved; its folios are now loose")
        );
        // This model has no manuscript, content or canonical source mutator.
    }
    #[test]
    fn membership_repairs_only_explicitly_assigned_identity_and_keeps_foreign_refs() {
        let mut record = base();
        record.state.collections[1]
            .folio_ids
            .push("web/folio:café".into());
        let mut session = HouseSession::new(Arc::new(record));
        let request = session
            .request(
                HouseEdit::Membership {
                    folio_id: "web/folio:café".into(),
                    collection_id: Some("collection:essays".into()),
                },
                1000,
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            request.candidate.state.collections[0].folio_ids,
            vec!["not-imported:folio"]
        );
        assert_eq!(
            request.candidate.state.collections[1]
                .folio_ids
                .iter()
                .filter(|id| *id == "web/folio:café")
                .count(),
            1
        );
        assert_eq!(
            request
                .candidate
                .state
                .collection_for_folio("web/folio:café")
                .unwrap()
                .id,
            "collection:essays"
        );
    }
    #[test]
    fn failed_and_stale_save_never_advance_saved_state_or_accept_other_acks() {
        let dir = tempdir().unwrap();
        let store = HouseStore::open(dir.path()).unwrap();
        let loaded = store.load().unwrap().record;
        let mut a = HouseSession::new(loaded.clone());
        let mut b = HouseSession::new(loaded);
        let req_a = a.request(HouseEdit::Name("A".into()), 10).unwrap().unwrap();
        let req_b = b.request(HouseEdit::Name("B".into()), 10).unwrap().unwrap();
        let saved = store.save_request(&req_a).unwrap();
        assert!(!b.acknowledge_saved(req_a.request_id, saved.clone()));
        let error = store.save_request(&req_b).unwrap_err();
        assert!(b.report_error(req_b.request_id, error.to_string()));
        assert_eq!(b.saved().generation, 0);
        assert_eq!(b.saved().state.house.name, "");
        assert_eq!(
            b.retry().unwrap(),
            req_b,
            "retry preserves generated IDs and exact candidate"
        );
        assert!(store.save_request(&req_b).is_err());
        assert_eq!(store.load().unwrap().record, saved);
        // A foreign edit with an unchanged generation is still a conflict.
        let mut foreign = (*saved).clone();
        foreign
            .state
            .extra
            .insert("anotherWriter".into(), json!(true));
        fs::write(store.path(), serde_json::to_vec(&foreign).unwrap()).unwrap();
        let mut next = HouseSession::new(saved);
        let req = next
            .request(HouseEdit::Name("C".into()), 11)
            .unwrap()
            .unwrap();
        assert!(store.save_request(&req).is_err());
        assert_eq!(
            store.load().unwrap().record.state.extra["anotherWriter"],
            json!(true)
        );
    }
    #[test]
    fn failed_atomic_write_retains_candidate_and_retries_after_actual_recovery() {
        let dir = tempdir().unwrap();
        let store = HouseStore::open(dir.path()).unwrap();
        let loaded = store.load().unwrap().record;
        let mut session = HouseSession::new(loaded.clone());
        let request = session
            .request(HouseEdit::Name("Lantern".into()), 1)
            .unwrap()
            .unwrap();
        // An existing primary path must not be replaced by a file if it is a
        // directory. This exercises a real filesystem failure, not a mock flag.
        fs::create_dir(store.path()).unwrap();
        assert!(store.save_request(&request).is_err());
        session.report_error(request.request_id, "Cannot write");
        assert_eq!(session.saved(), &loaded);
        fs::remove_dir(store.path()).unwrap();
        let retry = session.retry().unwrap();
        let saved = store.save_request(&retry).unwrap();
        assert!(session.acknowledge_saved(retry.request_id, saved.clone()));
        assert_eq!(store.load().unwrap().record, saved);
    }
    #[test]
    fn damaged_primary_recovers_without_overwriting_future_version_or_exact_bytes() {
        let dir = tempdir().unwrap();
        let store = HouseStore::open(dir.path()).unwrap();
        let mut session = HouseSession::new(store.load().unwrap().record);
        let first = session
            .request(HouseEdit::Name("First".into()), 1)
            .unwrap()
            .unwrap();
        let saved = store.save_request(&first).unwrap();
        session.acknowledge_saved(first.request_id, saved);
        let second = session
            .request(HouseEdit::Name("Second".into()), 2)
            .unwrap()
            .unwrap();
        store.save_request(&second).unwrap();
        let damaged = b"{the original broken bytes\r\n";
        fs::write(store.path(), damaged).unwrap();
        let recovery = store.load().unwrap();
        assert!(!recovery.warnings.is_empty());
        assert_eq!(recovery.record.state.house.name, "First");
        let mut recovered = HouseSession::new(recovery.record);
        let req = recovered
            .request(HouseEdit::Name("Recovered".into()), 3)
            .unwrap()
            .unwrap();
        store.save_request(&req).unwrap();
        let damaged_copy = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .find(|entry| entry.file_name().to_string_lossy().contains(".damaged-"))
            .unwrap();
        assert_eq!(fs::read(damaged_copy.path()).unwrap(), damaged);
        let mut future = serde_json::to_value(store.load().unwrap().record).unwrap();
        future["version"] = json!(2);
        let future_bytes = serde_json::to_vec(&future).unwrap();
        fs::write(store.path(), &future_bytes).unwrap();
        assert!(store.load().is_err());
        assert!(store.save_request(&req).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), future_bytes);
    }
    fn folio(id: &str, name: &str, updated: u64, source: bool) -> LibraryFolio {
        LibraryFolio {
            native_id: Uuid::new_v4(),
            folio_id: id.into(),
            folio: Folio::draft(id, name, updated),
            brief: None,
            archived: false,
            words: (!source).then_some(4),
            preview: (!source).then_some("A note from the street".into()),
            source_only: source,
        }
    }
    #[test]
    fn library_search_filter_recent_and_exact_supplied_name_order_keep_unknown_ids() {
        let state = base().state;
        let folios = vec![
            folio("web/folio:café", "éclair", 50, true),
            folio("folio:second", "Eclair", 50, false),
            folio("loose:web", "Apple", 70, false),
        ];
        let mut query = LibraryQuery::default();
        let ids = |rows: Vec<&LibraryFolio>| {
            rows.into_iter()
                .map(|folio| folio.folio_id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(query.apply(&folios, &state, &[])),
            vec!["loose:web", "web/folio:café", "folio:second"]
        );
        query.sort = LibrarySort::Name;
        assert_eq!(
            ids(query.apply(
                &folios,
                &state,
                &[
                    "folio:second".into(),
                    "web/folio:café".into(),
                    "missing:web".into(),
                    "loose:web".into()
                ]
            )),
            vec!["folio:second", "web/folio:café", "loose:web"]
        );
        query.scope = LibraryScope::Collection("web/collection:letters".into());
        assert_eq!(
            ids(query.apply(&folios, &state, &[])),
            vec!["web/folio:café"]
        );
        query.scope = LibraryScope::Loose;
        query.search = "STREET".into();
        assert_eq!(ids(query.apply(&folios, &state, &[])), vec!["loose:web"]);
        query.scope = LibraryScope::All;
        query.search = "écl".into();
        assert_eq!(
            ids(query.apply(&folios, &state, &[])),
            vec!["web/folio:café"]
        );
        assert_eq!(folios[0].words, None);
        assert_eq!(folios[0].preview, None);
        assert_eq!(
            state.collections[0].folio_ids,
            vec!["web/folio:café", "not-imported:folio"]
        );
    }
}
