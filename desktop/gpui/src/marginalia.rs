//! Writer-authored margin threads. The web format is a flat array; native
//! durability and reply drafts live in a separate envelope, never in source.

use crate::{house::is_js_whitespace, workspace::ExtraFields};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const MARGINALIA_FORMAT: &str = "twyne-gpui-marginalia";
pub const MARGINALIA_VERSION: u64 = 1;
pub const MAX_MARGINALIA_BYTES: usize = 16 * 1024 * 1024;
pub type ReplyDrafts = BTreeMap<String, BTreeMap<String, String>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UserCommentAuthor {
    User,
    Persona,
    Other(String),
}
impl UserCommentAuthor {
    pub fn as_str(&self) -> &str {
        match self {
            Self::User => "user",
            Self::Persona => "persona",
            Self::Other(value) => value,
        }
    }
}
impl Serialize for UserCommentAuthor {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}
impl<'de> Deserialize<'de> for UserCommentAuthor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "user" => Self::User,
            "persona" => Self::Persona,
            _ => Self::Other(value),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserCommentReply {
    pub id: String,
    pub author: String,
    pub author_kind: UserCommentAuthor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub text: String,
    pub created_at: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl UserCommentReply {
    pub fn writer(text: String, now: u64) -> Self {
        Self {
            id: format!("r-{}", Uuid::new_v4()),
            author: "You".into(),
            author_kind: UserCommentAuthor::User,
            persona_id: None,
            color: None,
            text,
            created_at: now,
            extra: ExtraFields::new(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserComment {
    pub id: String,
    pub folio_id: String,
    pub text: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    pub resolved: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub replies: Vec<UserCommentReply>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_duration_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_provider: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl UserComment {
    pub fn reference(&self) -> CommentRef {
        CommentRef {
            folio_id: self.folio_id.clone(),
            id: self.id.clone(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct CommentRef {
    pub folio_id: String,
    pub id: String,
}
impl CommentRef {
    pub fn matches(&self, comment: &UserComment) -> bool {
        self.id == comment.id && self.folio_id == comment.folio_id
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarginaliaRecord {
    pub format: String,
    pub version: u64,
    pub generation: u64,
    pub comments: Vec<UserComment>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub reply_drafts: ReplyDrafts,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl Default for MarginaliaRecord {
    fn default() -> Self {
        Self {
            format: MARGINALIA_FORMAT.into(),
            version: MARGINALIA_VERSION,
            generation: 0,
            comments: Vec::new(),
            reply_drafts: ReplyDrafts::new(),
            extra: ExtraFields::new(),
        }
    }
}
impl MarginaliaRecord {
    pub fn from_comments(comments: Vec<UserComment>) -> Result<Self> {
        let record = Self {
            comments,
            ..Self::default()
        };
        record.validate()?;
        Ok(record)
    }
    pub fn from_value(value: &Value) -> Result<Self> {
        let record = if value.is_array() {
            Self::from_comments(serde_json::from_value(value.clone())?)?
        } else {
            serde_json::from_value(value.clone())
                .context("Could not read the native Marginalia envelope.")?
        };
        record.validate()?;
        Ok(record)
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.format == MARGINALIA_FORMAT && self.version == MARGINALIA_VERSION,
            "This Marginalia format needs a compatible version of Twyne. Its file was kept."
        );
        for comment in &self.comments {
            ensure!(
                comment.audio_duration_ms.is_none_or(f64::is_finite),
                "A voice note duration is not a finite number."
            );
        }
        Ok(())
    }
    pub fn to_web_value(&self) -> Result<Value> {
        self.validate()?;
        Ok(serde_json::to_value(&self.comments)?)
    }
    pub fn comment(&self, target: &CommentRef) -> Option<&UserComment> {
        self.comments.iter().find(|comment| target.matches(comment))
    }
    pub fn scoped_comments(&self, folio: &str) -> Vec<UserComment> {
        self.comments
            .iter()
            .filter(|comment| comment.folio_id == folio)
            .cloned()
            .collect()
    }
}
pub fn parse_marginalia_json(bytes: &[u8]) -> Result<MarginaliaRecord> {
    ensure!(
        bytes.len() <= MAX_MARGINALIA_BYTES,
        "Marginalia exceeds its 16 MiB metadata limit."
    );
    MarginaliaRecord::from_value(&serde_json::from_slice(bytes)?)
}

/// Explicit import of the web's older `/comments.json` shape. Unlike loading a
/// native envelope, this cannot be an implicit fallback after a parse failure.
pub fn parse_legacy_comments_json(bytes: &[u8]) -> Result<Vec<UserComment>> {
    ensure!(
        bytes.len() <= MAX_MARGINALIA_BYTES,
        "The legacy comments file is too large."
    );
    let values: Vec<Value> = serde_json::from_slice(bytes)?;
    values
        .into_iter()
        .map(|value| {
            let mut legacy = value
                .as_object()
                .context("A legacy comment is not an object.")?
                .clone();
            ensure!(
                !legacy.contains_key("folioId") && legacy.contains_key("timestamp"),
                "This is not the legacy comments format."
            );
            let timestamp = legacy
                .remove("timestamp")
                .context("A legacy comment has no timestamp.")?;
            let anchor = legacy.remove("selectedText");
            let replies = match legacy.remove("replies") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(values)) => values,
                _ => bail!("The legacy replies are not an array."),
            };
            let replies = replies
                .into_iter()
                .map(|value| {
                    let mut reply = value
                        .as_object()
                        .context("A legacy reply is not an object.")?
                        .clone();
                    let at = reply
                        .remove("timestamp")
                        .context("A legacy reply has no timestamp.")?;
                    reply.insert("authorKind".into(), Value::String("user".into()));
                    reply.insert("createdAt".into(), at);
                    Ok(Value::Object(reply))
                })
                .collect::<Result<Vec<_>>>()?;
            legacy.insert("folioId".into(), Value::String(String::new()));
            legacy.insert("createdAt".into(), timestamp.clone());
            legacy.insert("updatedAt".into(), timestamp);
            legacy.insert("replies".into(), Value::Array(replies));
            if let Some(Value::String(anchor)) = anchor
                && !anchor.is_empty()
            {
                legacy.insert("anchor".into(), Value::String(anchor));
            }
            Ok(serde_json::from_value(Value::Object(legacy))?)
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReconciledComments {
    pub live: Vec<UserComment>,
    pub ghost: Vec<UserComment>,
    pub headless: Vec<String>,
}
pub fn reconcile_comment_anchors(
    threads: &[UserComment],
    mark_ids: &[String],
) -> ReconciledComments {
    let present = mark_ids.iter().collect::<HashSet<_>>();
    let thread_ids = threads
        .iter()
        .map(|thread| &thread.id)
        .collect::<HashSet<_>>();
    let (live, ghost) = threads
        .iter()
        .cloned()
        .partition(|thread| present.contains(&thread.id));
    let mut seen = HashSet::new();
    let headless = mark_ids
        .iter()
        .filter(|id| seen.insert(*id) && !thread_ids.contains(id))
        .cloned()
        .collect();
    ReconciledComments {
        live,
        ghost,
        headless,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MarginaliaEdit {
    Upsert(UserComment),
    AppendReply {
        target: CommentRef,
        reply: UserCommentReply,
    },
    SetResolved {
        target: CommentRef,
        resolved: bool,
    },
    Erase(Vec<CommentRef>),
    /// Accepted current-folio manuscript mark IDs at an explicit freshness
    /// boundary. Removes orphan metadata without erasing any document mark.
    Reconcile {
        folio_id: String,
        mark_ids: Vec<String>,
    },
    ReplyDrafts(ReplyDrafts),
    Batch(Vec<MarginaliaEdit>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarginaliaEffect {
    Upserted(CommentRef),
    ReplyAppended {
        target: CommentRef,
        reply_id: String,
    },
    Resolved {
        target: CommentRef,
        resolved: bool,
    },
    Erased(CommentRef),
    /// The verified mark is already absent; no source edit follows this ACK.
    Orphaned(CommentRef),
}
#[derive(Clone, Debug, PartialEq)]
pub struct MarginaliaRequest {
    pub request_id: Uuid,
    pub expected_generation: u64,
    pub base: Arc<MarginaliaRecord>,
    pub candidate: Arc<MarginaliaRecord>,
    pub effects: Vec<MarginaliaEffect>,
}

/// Exactly the web upsert's spread/merge semantics: an empty incoming reply
/// list cannot erase replies which arrived before the parent body.
pub fn upsert_user_comment(comments: &mut Vec<UserComment>, incoming: &UserComment) -> Result<()> {
    if let Some(index) = comments
        .iter()
        .position(|comment| comment.id == incoming.id)
    {
        let mut previous = serde_json::to_value(&comments[index])?;
        let incoming_value = serde_json::to_value(incoming)?;
        previous
            .as_object_mut()
            .unwrap()
            .extend(incoming_value.as_object().unwrap().clone());
        let mut merged: UserComment = serde_json::from_value(previous)?;
        if incoming.replies.is_empty() {
            merged.replies = comments[index].replies.clone();
        }
        comments[index] = merged;
    } else {
        comments.push(incoming.clone());
    }
    Ok(())
}
/// The web race bridge is explicit: an early reply may create an empty-scope
/// placeholder. Native scoped UI actions require a real existing thread.
pub fn append_user_comment_reply(
    comments: &mut Vec<UserComment>,
    id: &str,
    reply: &UserCommentReply,
    now: u64,
) {
    if let Some(comment) = comments.iter_mut().find(|comment| comment.id == id) {
        comment.replies.push(reply.clone());
        comment.updated_at = now;
    } else {
        comments.push(UserComment {
            id: id.into(),
            folio_id: String::new(),
            text: String::new(),
            author: if reply.author_kind == UserCommentAuthor::Persona {
                reply.author.clone()
            } else {
                "You".into()
            },
            anchor: None,
            resolved: false,
            created_at: reply.created_at,
            updated_at: now,
            replies: vec![reply.clone()],
            audio_id: None,
            audio_duration_ms: None,
            transcript_provider: None,
            extra: ExtraFields::new(),
        });
    }
}
fn clear_draft(drafts: &mut ReplyDrafts, target: &CommentRef) {
    if let Some(folio) = drafts.get_mut(&target.folio_id) {
        folio.remove(&target.id);
        if folio.is_empty() {
            drafts.remove(&target.folio_id);
        }
    }
}
fn apply_edit(
    record: &mut MarginaliaRecord,
    edit: &MarginaliaEdit,
    now: u64,
    effects: &mut Vec<MarginaliaEffect>,
) -> Result<()> {
    match edit {
        MarginaliaEdit::Batch(edits) => {
            for edit in edits {
                apply_edit(record, edit, now, effects)?;
            }
        }
        MarginaliaEdit::ReplyDrafts(drafts) => record.reply_drafts = drafts.clone(),
        MarginaliaEdit::Upsert(incoming) => {
            if let Some(old) = record
                .comments
                .iter()
                .find(|comment| comment.id == incoming.id)
            {
                ensure!(
                    old.folio_id == incoming.folio_id
                        || (old.folio_id.is_empty() && old.text.is_empty()),
                    "This comment ID belongs to another folio. Its existing thread was kept."
                );
            }
            upsert_user_comment(&mut record.comments, incoming)?;
            effects.push(MarginaliaEffect::Upserted(incoming.reference()));
        }
        MarginaliaEdit::AppendReply { target, reply } => {
            ensure!(
                !reply.text.trim_matches(is_js_whitespace).is_empty(),
                "Write a reply before filing it."
            );
            let comment = record
                .comments
                .iter_mut()
                .find(|comment| target.matches(comment))
                .context(
                    "This note is not available in the active folio. The reply draft was kept.",
                )?;
            comment.replies.push(reply.clone());
            comment.updated_at = now;
            clear_draft(&mut record.reply_drafts, target);
            effects.push(MarginaliaEffect::ReplyAppended {
                target: target.clone(),
                reply_id: reply.id.clone(),
            });
        }
        MarginaliaEdit::SetResolved { target, resolved } => {
            let comment = record
                .comments
                .iter_mut()
                .find(|comment| target.matches(comment))
                .context("This note is not available in the active folio.")?;
            if comment.resolved != *resolved {
                comment.resolved = *resolved;
                comment.updated_at = now;
                effects.push(MarginaliaEffect::Resolved {
                    target: target.clone(),
                    resolved: *resolved,
                });
            }
        }
        MarginaliaEdit::Erase(targets) => {
            let targets = targets.iter().collect::<HashSet<_>>();
            let mut erased = HashSet::new();
            record.comments.retain(|comment| {
                let target = comment.reference();
                if targets.contains(&target) {
                    if erased.insert(target.clone()) {
                        effects.push(MarginaliaEffect::Erased(target));
                    }
                    false
                } else {
                    true
                }
            });
            for target in &erased {
                clear_draft(&mut record.reply_drafts, target);
            }
        }
        MarginaliaEdit::Reconcile { folio_id, mark_ids } => {
            let present = mark_ids.iter().map(String::as_str).collect::<HashSet<_>>();
            let mut orphaned = HashSet::new();
            record.comments.retain(|comment| {
                if comment.folio_id == *folio_id && !present.contains(comment.id.as_str()) {
                    let target = comment.reference();
                    if orphaned.insert(target.clone()) {
                        effects.push(MarginaliaEffect::Orphaned(target));
                    }
                    false
                } else {
                    true
                }
            });
            // Reconciliation can make a thread unreachable while its input
            // still holds the writer's last character. Keep all draft text.
        }
    }
    Ok(())
}

pub struct MarginaliaSession {
    saved: Arc<MarginaliaRecord>,
    pending: Option<MarginaliaRequest>,
    error: Option<String>,
}
impl MarginaliaSession {
    pub fn new(record: Arc<MarginaliaRecord>) -> Self {
        Self {
            saved: record,
            pending: None,
            error: None,
        }
    }
    pub fn saved(&self) -> &Arc<MarginaliaRecord> {
        &self.saved
    }
    pub fn pending(&self) -> Option<&MarginaliaRequest> {
        self.pending.as_ref()
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn request(&mut self, edit: MarginaliaEdit, now: u64) -> Result<Option<MarginaliaRequest>> {
        ensure!(
            self.pending.is_none(),
            "File or discard the previous margin change first."
        );
        let mut candidate = (*self.saved).clone();
        let mut effects = Vec::new();
        apply_edit(&mut candidate, &edit, now, &mut effects)?;
        if candidate == *self.saved {
            return Ok(None);
        }
        candidate.generation = candidate
            .generation
            .checked_add(1)
            .context("Marginalia has exhausted its save generation.")?;
        candidate.validate()?;
        let request = MarginaliaRequest {
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
    pub fn acknowledge_saved(&mut self, id: Uuid, record: Arc<MarginaliaRecord>) -> bool {
        if !self.pending.as_ref().is_some_and(|request| {
            request.request_id == id && request.base == self.saved && request.candidate == record
        }) {
            return false;
        }
        self.saved = record;
        self.pending = None;
        self.error = None;
        true
    }
    pub fn report_error(&mut self, id: Uuid, message: impl Into<String>) -> bool {
        if self.pending.as_ref().map(|request| request.request_id) != Some(id) {
            return false;
        }
        self.error = Some(message.into());
        true
    }
    pub fn retry(&mut self) -> Option<MarginaliaRequest> {
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
    pub fn replace_record(&mut self, record: Arc<MarginaliaRecord>) -> bool {
        if self.pending.is_some()
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
pub struct MarginaliaLoad {
    pub record: Arc<MarginaliaRecord>,
    pub warnings: Vec<String>,
}
#[derive(Clone)]
pub struct MarginaliaStore {
    inner: Arc<StoreInner>,
}
struct StoreInner {
    path: PathBuf,
    writer: Mutex<()>,
}
impl MarginaliaStore {
    /// Root must hold its native library instance lock until every writer ends.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root).context("Could not create the Marginalia folder.")?;
        Ok(Self {
            inner: Arc::new(StoreInner {
                path: root.join("user-comments.json"),
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn path(&self) -> &Path {
        &self.inner.path
    }
    pub fn load(&self) -> Result<MarginaliaLoad> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Marginalia writer stopped unexpectedly."))?;
        self.load_locked()
    }
    fn load_locked(&self) -> Result<MarginaliaLoad> {
        let backup = self.path().with_extension("json.bak");
        if !self.path().exists() {
            return if backup.exists() {
                Ok(MarginaliaLoad {
                    record: Arc::new(read_record(&backup)?),
                    warnings: vec![
                        "Recovered Marginalia from its previous save. The recovery file is kept."
                            .into(),
                    ],
                })
            } else {
                Ok(MarginaliaLoad {
                    record: Arc::new(MarginaliaRecord::default()),
                    warnings: Vec::new(),
                })
            };
        }
        match read_record(self.path()) {
            Ok(record) => Ok(MarginaliaLoad {
                record: Arc::new(record),
                warnings: Vec::new(),
            }),
            Err(error) => {
                let bytes = read_bounded(self.path())?;
                // Valid JSON with a different format/schema must not silently
                // lose compatible or future metadata through backup fallback.
                if serde_json::from_slice::<Value>(&bytes).is_ok() {
                    return Err(error);
                }
                if backup.exists() {
                    Ok(MarginaliaLoad { record: Arc::new(read_record(&backup).with_context(|| format!("Could not recover Marginalia: {error}"))?),
                        warnings: vec!["Recovered Marginalia from its previous save. The damaged file is kept until another save.".into()] })
                } else {
                    Err(error.context("Could not open Marginalia. Its damaged file has been kept."))
                }
            }
        }
    }
    pub fn save_request(&self, request: &MarginaliaRequest) -> Result<Arc<MarginaliaRecord>> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Marginalia writer stopped unexpectedly."))?;
        request.base.validate()?;
        request.candidate.validate()?;
        ensure!(
            request.expected_generation == request.base.generation
                && Some(request.candidate.generation) == request.base.generation.checked_add(1),
            "The Marginalia request has an invalid save generation."
        );
        let bytes = serde_json::to_vec_pretty(&*request.candidate)?;
        ensure!(
            bytes.len() <= MAX_MARGINALIA_BYTES,
            "Marginalia exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        let current = self.load_locked()?.record;
        if current == request.candidate && self.path().exists() && read_record(self.path()).is_ok()
        {
            // The write may have reached disk before its acknowledgement. It
            // is idempotent only against a valid primary, not backup recovery.
            File::open(self.path())?.sync_all()?;
            sync_parent(self.path())?;
            return Ok(request.candidate.clone());
        }
        ensure!(
            current.generation == request.expected_generation && current == request.base,
            "Marginalia changed before this edit could be filed. Reload it before saving."
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
            .context("Marginalia could not be saved on this device.")?;
        Ok(request.candidate.clone())
    }
}
fn read_record(path: &Path) -> Result<MarginaliaRecord> {
    parse_marginalia_json(&read_bounded(path)?)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_MARGINALIA_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_MARGINALIA_BYTES,
        "Marginalia is too large to open safely."
    );
    Ok(bytes)
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().context("Marginalia has no parent folder.")?)?.sync_all()?;
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Marginalia has no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    sync_parent(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../fixtures/marginalia/web-reference.json")).unwrap()
    }
    fn record() -> MarginaliaRecord {
        MarginaliaRecord::from_value(&fixture()["base"]).unwrap()
    }
    fn target() -> CommentRef {
        CommentRef {
            folio_id: "web/folio:café".into(),
            id: "web/comment:café".into(),
        }
    }
    fn reply() -> UserCommentReply {
        UserCommentReply {
            id: "r-native:test".into(),
            author: "You".into(),
            author_kind: UserCommentAuthor::User,
            persona_id: None,
            color: None,
            text: "  Café — exactly typed.  ".into(),
            created_at: 2000,
            extra: ExtraFields::new(),
        }
    }

    #[test]
    fn actual_web_operations_and_early_reply_race_conform() {
        for case in fixture()["cases"].as_array().unwrap() {
            let before: Vec<UserComment> = serde_json::from_value(case["before"].clone()).unwrap();
            let expected: Vec<UserComment> = serde_json::from_value(case["after"].clone()).unwrap();
            let args = case["args"].as_array().unwrap();
            let now = case["now"].as_u64().unwrap();
            let mut session = MarginaliaSession::new(Arc::new(
                MarginaliaRecord::from_comments(before.clone()).unwrap(),
            ));
            let mut pure = before.clone();
            let edit = match case["method"].as_str().unwrap() {
                "upsertUserComment" => Some(MarginaliaEdit::Upsert(
                    serde_json::from_value(args[0].clone()).unwrap(),
                )),
                "appendUserCommentReply" => {
                    let id = args[0].as_str().unwrap();
                    let reply = serde_json::from_value(args[1].clone()).unwrap();
                    if let Some(parent) = before.iter().find(|comment| comment.id == id) {
                        Some(MarginaliaEdit::AppendReply {
                            target: parent.reference(),
                            reply,
                        })
                    } else {
                        append_user_comment_reply(&mut pure, id, &reply, now);
                        None
                    }
                }
                "toggleUserCommentResolved" => {
                    let parent = before
                        .iter()
                        .find(|comment| comment.id == args[0].as_str().unwrap())
                        .unwrap();
                    Some(MarginaliaEdit::SetResolved {
                        target: parent.reference(),
                        resolved: !parent.resolved,
                    })
                }
                "deleteUserComments" => {
                    let ids = args[0]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<HashSet<_>>();
                    Some(MarginaliaEdit::Erase(
                        before
                            .iter()
                            .filter(|comment| ids.contains(comment.id.as_str()))
                            .map(UserComment::reference)
                            .collect(),
                    ))
                }
                other => {
                    panic!("Add the actual source operation {other} to this conformance test.")
                }
            };
            let actual = if let Some(edit) = edit {
                session.request(edit, now).unwrap().map_or_else(
                    || before.clone(),
                    |request| request.candidate.comments.clone(),
                )
            } else {
                pure
            };
            assert_eq!(actual, expected, "source operation {}", case["method"]);
        }
    }

    #[test]
    fn original_anchor_ids_not_similar_quotes_determine_ghosts_and_headless_order() {
        let fixture = fixture();
        let sample = &fixture["reconciliation"];
        let threads: Vec<UserComment> = serde_json::from_value(sample["threads"].clone()).unwrap();
        let marks: Vec<String> = serde_json::from_value(sample["marks"].clone()).unwrap();
        let result = reconcile_comment_anchors(&threads, &marks);
        let expected_live: Vec<UserComment> =
            serde_json::from_value(sample["result"]["live"].clone()).unwrap();
        let expected_ghost: Vec<UserComment> =
            serde_json::from_value(sample["result"]["ghost"].clone()).unwrap();
        assert_eq!(result.live, expected_live);
        assert_eq!(result.ghost, expected_ghost);
        assert_eq!(result.headless, vec!["headless:mark", "second-headless"]);
        assert!(
            result
                .ghost
                .iter()
                .any(|comment| comment.id == "same-quote-no-mark")
        );
    }

    #[test]
    fn original_caller_reconciliation_is_scoped_metadata_and_keeps_orphan_reply_drafts() {
        let fixture = fixture();
        let sample = &fixture["callerReconciliation"];
        let mut base = MarginaliaRecord::from_value(&sample["before"]).unwrap();
        base.reply_drafts = serde_json::from_value(sample["heldDrafts"].clone()).unwrap();
        // Web IDs are globally generated, but imported foreign data must also
        // remain safe if a source ID collides with a current-folio orphan.
        let mut collision = base.comments[1].clone();
        collision.folio_id = "foreign/collision".into();
        collision
            .extra
            .insert("unseenForeign".into(), json!(["keep", 9]));
        base.comments.push(collision.clone());
        let mut expected: Vec<UserComment> =
            serde_json::from_value(sample["after"].clone()).unwrap();
        expected.push(collision);
        let directory = tempfile::tempdir().unwrap();
        let store = MarginaliaStore::open(directory.path()).unwrap();
        let original_bytes = serde_json::to_vec_pretty(&base).unwrap();
        fs::write(store.path(), &original_bytes).unwrap();
        let base = store.load().unwrap().record;
        let mut session = MarginaliaSession::new(base.clone());
        let edit = MarginaliaEdit::Reconcile {
            folio_id: sample["folioId"].as_str().unwrap().into(),
            mark_ids: serde_json::from_value(sample["marks"].clone()).unwrap(),
        };
        let request = session.request(edit.clone(), 2500).unwrap().unwrap();
        assert_eq!(session.saved().comments, base.comments);
        assert_eq!(request.candidate.comments, expected);
        assert_eq!(request.candidate.reply_drafts, base.reply_drafts);
        let ghosts: Vec<UserComment> =
            serde_json::from_value(sample["result"]["ghost"].clone()).unwrap();
        assert_eq!(
            request.effects,
            ghosts
                .iter()
                .map(|note| MarginaliaEffect::Orphaned(note.reference()))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            sample["result"]["headless"],
            json!(["headless:actual-mark"])
        );
        assert!(session.report_error(request.request_id, "Actual save still pending"));
        assert_eq!(session.saved(), &base);
        assert_eq!(session.retry().unwrap(), request);
        let saved = store.save_request(&request).unwrap();
        assert_eq!(
            fs::read(store.path().with_extension("json.bak")).unwrap(),
            original_bytes
        );
        assert!(!session.acknowledge_saved(Uuid::new_v4(), saved.clone()));
        assert!(session.acknowledge_saved(request.request_id, saved.clone()));
        assert_eq!(store.load().unwrap().record, saved);
        assert_eq!(saved.reply_drafts, base.reply_drafts);
        assert!(session.request(edit, 2501).unwrap().is_none());
    }

    #[test]
    fn actual_browser_filed_array_keeps_mark_ids_reply_and_struck_state() {
        let bytes = include_bytes!("../fixtures/marginalia/browser-comments.json");
        let record = parse_marginalia_json(bytes).unwrap();
        let html = include_str!("../fixtures/marginalia/browser-manuscript.html");
        assert_eq!(record.comments.len(), 2);
        for note in &record.comments {
            assert_eq!(note.folio_id, "twyne-gpui-parity");
            assert!(html.contains(&format!("data-comment-id=\"{}\"", note.id)));
        }
        let note = &record.comments[0];
        assert!(!note.resolved);
        assert_eq!(
            note.anchor.as_deref(),
            Some("small enough to carry in a coat pocket.")
        );
        assert_eq!(
            note.text,
            "Keep the opening concrete.\n\nThe notebook should feel **handled**, not described."
        );
        assert_eq!(note.replies.len(), 1);
        assert_eq!(note.replies[0].text, "You can keep the softened corners.");
        assert!(record.comments[1].resolved);
        assert_eq!(record.comments[1].text, "The ending can stay in the room.");
        assert_eq!(
            record.to_web_value().unwrap(),
            serde_json::from_slice::<Value>(bytes).unwrap()
        );
    }

    #[test]
    fn web_round_trip_retains_absence_unknown_authors_voice_and_exact_disk_backup() {
        let directory = tempfile::tempdir().unwrap();
        let store = MarginaliaStore::open(directory.path()).unwrap();
        let mut value = fixture()["base"].clone();
        value[0]["replies"][0]["authorKind"] = json!("collaborator-from-future");
        let bytes = serde_json::to_vec_pretty(&value).unwrap();
        fs::write(store.path(), &bytes).unwrap();
        let base = store.load().unwrap().record;
        let exported = base.to_web_value().unwrap();
        assert!(exported[1].get("anchor").is_none());
        assert!(exported[1].get("audioId").is_none());
        assert_eq!(exported[0]["futureThread"], value[0]["futureThread"]);
        assert_eq!(
            exported[0]["replies"][0]["authorKind"],
            json!("collaborator-from-future")
        );
        assert_eq!(
            exported[0]["replies"][0]["futureReply"],
            value[0]["replies"][0]["futureReply"]
        );
        let mut session = MarginaliaSession::new(base);
        let mut drafts = ReplyDrafts::new();
        drafts
            .entry("not-imported:folio".into())
            .or_default()
            .insert("foreign:note".into(), "Unfiled draft\nCafé".into());
        let request = session
            .request(MarginaliaEdit::ReplyDrafts(drafts.clone()), 2000)
            .unwrap()
            .unwrap();
        assert!(request.effects.is_empty());
        let saved = store.save_request(&request).unwrap();
        assert_eq!(
            fs::read(store.path().with_extension("json.bak")).unwrap(),
            bytes
        );
        assert!(session.acknowledge_saved(request.request_id, saved.clone()));
        assert_eq!(store.load().unwrap().record, saved);
        assert_eq!(saved.reply_drafts, drafts);
        assert_eq!(saved.to_web_value().unwrap(), exported);
    }

    #[test]
    fn scoped_reply_and_erase_keep_foreign_colliding_ids_and_clear_only_filed_draft() {
        let mut base = record();
        let mut foreign = base.comments[0].clone();
        foreign.folio_id = "foreign/collision".into();
        base.comments.push(foreign.clone());
        base.reply_drafts
            .entry(target().folio_id)
            .or_default()
            .insert(target().id, "held here".into());
        base.reply_drafts
            .entry(foreign.folio_id.clone())
            .or_default()
            .insert(foreign.id.clone(), "held elsewhere".into());
        let mut session = MarginaliaSession::new(Arc::new(base.clone()));
        let request = session
            .request(
                MarginaliaEdit::AppendReply {
                    target: target(),
                    reply: reply(),
                },
                2000,
            )
            .unwrap()
            .unwrap();
        assert_eq!(session.saved().comments, base.comments);
        assert_eq!(session.saved().reply_drafts, base.reply_drafts);
        assert_eq!(
            request.candidate.comment(&foreign.reference()).unwrap(),
            &foreign
        );
        assert_eq!(
            request
                .candidate
                .comment(&target())
                .unwrap()
                .replies
                .last()
                .unwrap()
                .text,
            reply().text
        );
        assert!(
            !request
                .candidate
                .reply_drafts
                .contains_key(&target().folio_id)
        );
        assert_eq!(
            request.candidate.reply_drafts[&foreign.folio_id][&foreign.id],
            "held elsewhere"
        );
        assert!(!session.acknowledge_saved(Uuid::new_v4(), request.candidate.clone()));
        assert!(session.acknowledge_saved(request.request_id, request.candidate));
        let erase = session
            .request(MarginaliaEdit::Erase(vec![target(), target()]), 2100)
            .unwrap()
            .unwrap();
        assert_eq!(erase.effects, vec![MarginaliaEffect::Erased(target())]);
        assert!(erase.candidate.comment(&target()).is_none());
        assert_eq!(
            erase.candidate.comment(&foreign.reference()).unwrap(),
            &foreign
        );
        let mut invalid = MarginaliaSession::new(Arc::new(record()));
        assert!(
            invalid
                .request(
                    MarginaliaEdit::AppendReply {
                        target: CommentRef {
                            folio_id: "wrong".into(),
                            ..target()
                        },
                        reply: reply()
                    },
                    2000
                )
                .is_err()
        );
        assert!(
            invalid
                .request(
                    MarginaliaEdit::AppendReply {
                        target: CommentRef {
                            folio_id: "web/folio:café".into(),
                            id: "unplaced-composer".into()
                        },
                        reply: reply()
                    },
                    2000
                )
                .is_err()
        );
        assert_eq!(invalid.saved().comments, record().comments);
    }

    #[test]
    fn durable_ack_idempotence_and_full_base_guard_survive_two_shared_writers() {
        let directory = tempfile::tempdir().unwrap();
        let store = MarginaliaStore::open(directory.path()).unwrap();
        let base = Arc::new(record());
        fs::write(store.path(), serde_json::to_vec(&*base).unwrap()).unwrap();
        let mut a = MarginaliaSession::new(base.clone());
        let mut b = MarginaliaSession::new(base.clone());
        let request_a = a
            .request(
                MarginaliaEdit::SetResolved {
                    target: target(),
                    resolved: true,
                },
                2000,
            )
            .unwrap()
            .unwrap();
        let request_b = b
            .request(
                MarginaliaEdit::AppendReply {
                    target: target(),
                    reply: reply(),
                },
                2001,
            )
            .unwrap()
            .unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let handles = [request_a.clone(), request_b.clone()]
            .into_iter()
            .map(|request| {
                let writer = store.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let result = writer.save_request(&request);
                    (request, result)
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            results.iter().filter(|(_, result)| result.is_ok()).count(),
            1
        );
        let (winner, saved) = results.iter().find(|(_, result)| result.is_ok()).unwrap();
        assert_eq!(store.load().unwrap().record, *saved.as_ref().unwrap());
        assert_eq!(store.save_request(winner).unwrap(), winner.candidate);
        assert!(!a.acknowledge_saved(request_b.request_id, request_b.candidate.clone()));
        let (loser, _) = results.iter().find(|(_, result)| result.is_err()).unwrap();
        assert!(store.save_request(loser).is_err());
        let mut forged = winner.clone();
        forged.base = Arc::new(MarginaliaRecord {
            comments: Vec::new(),
            ..(*base).clone()
        });
        // Exact-primary retries are defined by the candidate, but their base
        // must still be a valid prior-generation record. A forged same-gen
        // stale writer with a new candidate cannot bypass that full base.
        forged.candidate = loser.candidate.clone();
        assert!(store.save_request(&forged).is_err());
        assert_eq!(a.saved(), &base);
        assert_eq!(b.saved(), &base);
    }

    #[test]
    fn real_write_failure_retains_request_and_reply_until_same_candidate_retry() {
        let directory = tempfile::tempdir().unwrap();
        let store = MarginaliaStore::open(directory.path()).unwrap();
        let base = Arc::new(record());
        let original = serde_json::to_vec(&*base).unwrap();
        fs::write(store.path(), &original).unwrap();
        fs::create_dir(store.path().with_extension("json.bak")).unwrap();
        let mut session = MarginaliaSession::new(base.clone());
        let request = session
            .request(
                MarginaliaEdit::AppendReply {
                    target: target(),
                    reply: reply(),
                },
                2000,
            )
            .unwrap()
            .unwrap();
        let error = store.save_request(&request).unwrap_err();
        assert_eq!(fs::read(store.path()).unwrap(), original);
        assert_eq!(session.saved(), &base);
        assert!(!session.report_error(Uuid::new_v4(), "unrelated"));
        assert!(session.report_error(request.request_id, error.to_string()));
        assert!(!session.replace_record(Arc::new(MarginaliaRecord::default())));
        fs::remove_dir(store.path().with_extension("json.bak")).unwrap();
        let retry = session.retry().unwrap();
        assert_eq!(retry, request);
        let saved = store.save_request(&retry).unwrap();
        assert!(session.acknowledge_saved(retry.request_id, saved));
        assert_eq!(
            session
                .saved()
                .comment(&target())
                .unwrap()
                .replies
                .last()
                .unwrap()
                .text,
            reply().text
        );
    }

    #[test]
    fn recovery_preserves_damaged_bytes_and_future_envelope_is_never_legacy() {
        let directory = tempfile::tempdir().unwrap();
        let store = MarginaliaStore::open(directory.path()).unwrap();
        let base = Arc::new(record());
        fs::write(store.path(), serde_json::to_vec(&*base).unwrap()).unwrap();
        let mut session = MarginaliaSession::new(base.clone());
        let request = session
            .request(
                MarginaliaEdit::SetResolved {
                    target: target(),
                    resolved: true,
                },
                2000,
            )
            .unwrap()
            .unwrap();
        store.save_request(&request).unwrap();
        let damaged = b"{ interrupted\n";
        fs::write(store.path(), damaged).unwrap();
        let recovered = store.load().unwrap();
        assert_eq!(recovered.record, base);
        assert_eq!(recovered.warnings.len(), 1);
        assert_eq!(fs::read(store.path()).unwrap(), damaged);
        let mut recovery = MarginaliaSession::new(recovered.record);
        let repair = recovery
            .request(
                MarginaliaEdit::AppendReply {
                    target: target(),
                    reply: reply(),
                },
                2001,
            )
            .unwrap()
            .unwrap();
        store.save_request(&repair).unwrap();
        let preserved = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(|entry| {
                let path = entry.unwrap().path();
                path.to_string_lossy().contains(".damaged-").then_some(path)
            })
            .collect::<Vec<_>>();
        assert_eq!(preserved.len(), 1);
        assert_eq!(fs::read(&preserved[0]).unwrap(), damaged);
        let mut future = serde_json::to_value(record()).unwrap();
        future["version"] = json!(99);
        future["future"] = json!({"keep":true});
        let future_bytes = serde_json::to_vec(&future).unwrap();
        fs::write(store.path(), &future_bytes).unwrap();
        assert!(store.load().is_err());
        assert_eq!(fs::read(store.path()).unwrap(), future_bytes);
        assert!(parse_legacy_comments_json(&future_bytes).is_err());
        assert!(
            parse_marginalia_json(&serde_json::to_vec(&fixture()["legacy"]["before"]).unwrap())
                .is_err()
        );
    }

    #[test]
    fn explicit_legacy_conversion_matches_source_scope_and_retains_available_metadata() {
        let fixture = fixture();
        let legacy = &fixture["legacy"];
        let converted =
            parse_legacy_comments_json(&serde_json::to_vec(&legacy["before"]).unwrap()).unwrap();
        let expected: Vec<UserComment> = serde_json::from_value(legacy["after"].clone()).unwrap();
        assert_eq!(converted[0].folio_id, "");
        assert_eq!(converted[0].created_at, expected[0].created_at);
        assert_eq!(converted[0].updated_at, expected[0].updated_at);
        assert_eq!(converted[0].anchor, expected[0].anchor);
        assert_eq!(converted[0].text, expected[0].text);
        assert_eq!(converted[0].replies[0].author_kind, UserCommentAuthor::User);
        assert_eq!(
            converted[0].replies[0].created_at,
            expected[0].replies[0].created_at
        );
        assert_eq!(
            converted[0].extra["futureLegacy"],
            legacy["before"][0]["futureLegacy"]
        );
        assert_eq!(converted[0].extra["from"], json!(4));
        assert_eq!(converted[0].extra["to"], json!(17));
        assert_eq!(converted[0].replies[0].extra["position"], json!(2));
        assert_eq!(legacy["legacyAfterLoad"], json!([])); // source wipes; native import does not.
    }
}
