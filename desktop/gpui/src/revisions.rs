//! Local version history. This is a native recovery format, not a Lix log.
//!
//! Snapshot timing, labels, word counts and bounded passage comparison follow
//! `src/utils/revision-history.ts`. Native snapshots also retain the complete
//! manuscript: source, projection state, page settings and unknown metadata.
//! No history operation compiles, reserializes, or normalizes canonical source.

use crate::{
    manuscript::Manuscript,
    workspace::{ExtraFields, ProjectionState},
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const MAX_REVISIONS: usize = 50;
pub const AUTO_INTERVAL_MS: u64 = 5 * 60_000;
/// Whole-history reads/writes happen at checkpoint boundaries, never on typing.
pub const MAX_HISTORY_BYTES: usize = 128 * 1024 * 1024;
const FORMAT: &str = "twyne-gpui-revisions";
const VERSION: u32 = 1;
const LOOK_AHEAD: usize = 12;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RevisionSource {
    Automatic,
    #[default]
    Manual,
    Feedback,
    Rubric,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSnapshot {
    pub id: Uuid,
    pub folio_id: Uuid,
    pub created_at: u64,
    pub label: String,
    pub source: RevisionSource,
    pub word_count: usize,
    pub manuscript: Arc<Manuscript>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl RevisionSnapshot {
    pub fn canonical_source(&self) -> Option<&str> {
        canonical_source(&self.manuscript)
    }
    pub fn html(&self) -> Option<&str> {
        self.manuscript
            .workspace
            .as_ref()
            .map(|workspace| workspace.content.html.as_str())
    }
    pub fn validate(&self, folio_id: Uuid) -> Result<()> {
        ensure!(
            self.folio_id == folio_id && self.manuscript.id == folio_id,
            "A checkpoint belongs to another manuscript."
        );
        ensure!(!self.label.trim().is_empty(), "A checkpoint has no label.");
        self.manuscript.validate()
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RevisionTaskSource {
    Feedback,
    Suggestion,
    #[default]
    Manual,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RevisionTaskStatus {
    #[default]
    Open,
    Done,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionTask {
    pub id: Uuid,
    pub folio_id: Uuid,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub source: RevisionTaskSource,
    pub status: RevisionTaskStatus,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RevisionTimeline {
    pub format: String,
    pub version: u32,
    pub folio_id: Uuid,
    pub generation: u64,
    pub revisions: Vec<RevisionSnapshot>,
    #[serde(default)]
    pub tasks: Vec<RevisionTask>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl RevisionTimeline {
    pub fn new(folio_id: Uuid) -> Self {
        Self {
            format: FORMAT.into(),
            version: VERSION,
            folio_id,
            generation: 0,
            revisions: Vec::new(),
            tasks: Vec::new(),
            extra: ExtraFields::new(),
        }
    }
    pub fn validate(&self, folio_id: Uuid) -> Result<()> {
        ensure!(
            self.format == FORMAT && self.version == VERSION,
            "This version history needs another version of Twyne."
        );
        ensure!(
            self.folio_id == folio_id,
            "Version history belongs to another manuscript."
        );
        ensure!(
            self.revisions.len() <= MAX_REVISIONS,
            "Version history has too many checkpoints."
        );
        let mut ids = HashSet::new();
        for snapshot in &self.revisions {
            snapshot.validate(folio_id)?;
            ensure!(
                ids.insert(snapshot.id),
                "Version history repeats a checkpoint ID."
            );
        }
        let mut ids = HashSet::new();
        for task in &self.tasks {
            ensure!(
                task.folio_id == folio_id && !task.title.trim().is_empty(),
                "A revision task does not belong to this manuscript."
            );
            ensure!(
                ids.insert(task.id),
                "Version history repeats a revision task ID."
            );
            ensure!(
                task.status != RevisionTaskStatus::Open || task.completed_at.is_none(),
                "An open revision task has a completion date."
            );
        }
        Ok(())
    }
    pub fn snapshot(&self, id: Uuid) -> Option<&RevisionSnapshot> {
        self.revisions.iter().find(|snapshot| snapshot.id == id)
    }
    pub fn open_task_count(&self) -> usize {
        self.tasks
            .iter()
            .filter(|task| task.status == RevisionTaskStatus::Open)
            .count()
    }
    pub fn add_checkpoint(
        &mut self,
        document: Arc<Manuscript>,
        options: &CheckpointOptions,
    ) -> Result<Option<RevisionSnapshot>> {
        self.validate(document.id)?;
        document.validate()?;
        if !options.force
            && let Some(latest) = self.revisions.first()
        {
            if document.revision < latest.manuscript.revision {
                return Ok(None);
            }
            if same_contents(&latest.manuscript, &document) {
                return Ok(None);
            }
            if options.source == RevisionSource::Automatic
                && options.now.saturating_sub(latest.created_at) < AUTO_INTERVAL_MS
            {
                return Ok(None);
            }
        }
        let word_count = if let Some(html) = verified_html(&document) {
            words_html(html).len()
        } else {
            words_text(document_text(&document)).len()
        };
        let label = options
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .unwrap_or(if options.source == RevisionSource::Automatic {
                "Writing checkpoint"
            } else {
                "Saved revision"
            })
            .to_owned();
        let snapshot = RevisionSnapshot {
            id: Uuid::new_v4(),
            folio_id: document.id,
            created_at: options.now,
            label,
            source: options.source,
            word_count,
            manuscript: document,
            extra: ExtraFields::new(),
        };
        self.revisions.insert(0, snapshot.clone());
        self.revisions.truncate(MAX_REVISIONS);
        self.advance()?;
        Ok(Some(snapshot))
    }
    fn advance(&mut self) -> Result<()> {
        self.generation = self
            .generation
            .checked_add(1)
            .context("Version history has exhausted its generation counter.")?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct CheckpointOptions {
    pub label: Option<String>,
    pub source: RevisionSource,
    pub now: u64,
    pub force: bool,
}
impl CheckpointOptions {
    pub fn manual(now: u64) -> Self {
        Self {
            label: Some("Manual checkpoint".into()),
            source: RevisionSource::Manual,
            now,
            force: false,
        }
    }
    pub fn automatic(now: u64) -> Self {
        Self {
            label: None,
            source: RevisionSource::Automatic,
            now,
            force: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RevisionLoad {
    pub timeline: Arc<RevisionTimeline>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug)]
pub struct CheckpointOutcome {
    pub timeline: Arc<RevisionTimeline>,
    /// A duplicate or coalesced automatic write returns no new checkpoint.
    pub created: Option<RevisionSnapshot>,
}

#[derive(Clone, Debug)]
pub struct RevisionRestorePlan {
    pub request_id: Uuid,
    pub folio_id: Uuid,
    pub snapshot_id: Uuid,
    pub expected_current: Arc<Manuscript>,
    pub replacement: Manuscript,
    pub timeline: Arc<RevisionTimeline>,
}
impl RevisionRestorePlan {
    /// Root must also reject pending/conflicted Source drafts and active-ID
    /// changes. This exact comparison is an additional save-boundary guard.
    pub fn matches_current(&self, current: &Manuscript) -> bool {
        self.expected_current.as_ref() == current
    }
}

#[derive(Clone)]
pub struct RevisionStore {
    state: Arc<StoreState>,
}
struct StoreState {
    directory: PathBuf,
    writer: Mutex<()>,
}

impl RevisionStore {
    /// The application's Store holds the library instance lock. Share this
    /// cloneable handle between background jobs in that same application.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let directory = root.into().join("revisions");
        fs::create_dir_all(&directory)
            .context("Could not create the local version history folder.")?;
        Ok(Self {
            state: Arc::new(StoreState {
                directory,
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn history_path(&self, folio_id: Uuid) -> PathBuf {
        self.state.directory.join(format!("{folio_id}.json"))
    }
    pub fn load(&self, folio_id: Uuid) -> Result<RevisionLoad> {
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The history writer stopped unexpectedly."))?;
        self.load_locked(folio_id)
    }
    fn load_locked(&self, folio_id: Uuid) -> Result<RevisionLoad> {
        let path = self.history_path(folio_id);
        if !path.exists() {
            // A backup is still recovery evidence if the primary was removed.
            if path.with_extension("json.bak").exists() {
                let timeline = read_history(&path.with_extension("json.bak"), folio_id)?;
                return Ok(RevisionLoad { timeline: Arc::new(timeline), warnings: vec![
                    "Recovered version history from its previous save. The recovery file is kept.".into()] });
            }
            return Ok(RevisionLoad {
                timeline: Arc::new(RevisionTimeline::new(folio_id)),
                warnings: Vec::new(),
            });
        }
        match read_history(&path, folio_id) {
            Ok(timeline) => Ok(RevisionLoad {
                timeline: Arc::new(timeline),
                warnings: Vec::new(),
            }),
            Err(primary_error) => {
                let timeline = read_history(&path.with_extension("json.bak"), folio_id)
                    .with_context(|| format!("Could not open version history: {primary_error}. The files were left in place."))?;
                Ok(RevisionLoad { timeline: Arc::new(timeline), warnings: vec![
                    "Recovered version history from its previous save. The damaged file is kept until another checkpoint is saved.".into()] })
            }
        }
    }
    pub fn checkpoint(
        &self,
        document: Arc<Manuscript>,
        options: CheckpointOptions,
    ) -> Result<CheckpointOutcome> {
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The history writer stopped unexpectedly."))?;
        self.checkpoint_locked(document, options)
    }
    fn checkpoint_locked(
        &self,
        document: Arc<Manuscript>,
        options: CheckpointOptions,
    ) -> Result<CheckpointOutcome> {
        let mut timeline = self.load_locked(document.id)?.timeline.as_ref().clone();
        let created = timeline.add_checkpoint(document, &options)?;
        if created.is_some() {
            self.save_locked(&timeline)?;
        }
        Ok(CheckpointOutcome {
            timeline: Arc::new(timeline),
            created,
        })
    }
    /// Saves the complete pre-restore draft durably before returning a plan.
    /// It does not save or mutate the active manuscript; the root owns the CAS.
    pub fn prepare_restore(
        &self,
        request_id: Uuid,
        snapshot_id: Uuid,
        current: Arc<Manuscript>,
        now: u64,
    ) -> Result<RevisionRestorePlan> {
        current.validate()?;
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The history writer stopped unexpectedly."))?;
        let timeline = self.load_locked(current.id)?.timeline;
        let selected = timeline
            .snapshot(snapshot_id)
            .context("This checkpoint is no longer in version history.")?;
        let mut replacement = selected.manuscript.as_ref().clone();
        replacement.id = current.id;
        replacement.created_at = current.created_at;
        replacement.updated_at = now;
        replacement.revision = current
            .revision
            .checked_add(1)
            .context("The manuscript has exhausted its revision counter.")?;
        replacement.archived = current.archived;
        if let Some(workspace) = &mut replacement.workspace {
            let workspace = Arc::make_mut(workspace);
            workspace.folio.id = current.id.to_string();
            workspace.content.folio_id = current.id.to_string();
            workspace.folio.created_at = current
                .workspace
                .as_ref()
                .map(|workspace| workspace.folio.created_at)
                .unwrap_or(current.created_at);
            workspace.folio.updated_at = now;
            workspace.content.updated_at = now;
        }
        replacement.validate()?;
        let outcome = self.checkpoint_locked(
            current.clone(),
            CheckpointOptions {
                label: Some("Before restoring an earlier version".into()),
                source: RevisionSource::Manual,
                now,
                force: true,
            },
        )?;
        Ok(RevisionRestorePlan {
            request_id,
            folio_id: current.id,
            snapshot_id,
            expected_current: current,
            replacement,
            timeline: outcome.timeline,
        })
    }
    pub fn create_task(
        &self,
        folio_id: Uuid,
        options: RevisionTaskOptions,
    ) -> Result<(Arc<RevisionTimeline>, Option<RevisionTask>)> {
        let title = options.title.trim();
        ensure!(!title.is_empty(), "Enter a title for this revision task.");
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The history writer stopped unexpectedly."))?;
        let mut timeline = self.load_locked(folio_id)?.timeline.as_ref().clone();
        if let Some(source_id) = &options.source_id
            && timeline
                .tasks
                .iter()
                .any(|task| task.source_id.as_ref() == Some(source_id))
        {
            return Ok((Arc::new(timeline), None));
        }
        let task = RevisionTask {
            id: Uuid::new_v4(),
            folio_id,
            title: title.into(),
            detail: options
                .detail
                .filter(|detail| !detail.trim().is_empty())
                .map(|detail| detail.trim().into()),
            source_id: options.source_id,
            source: options.source,
            status: RevisionTaskStatus::Open,
            created_at: options.now,
            completed_at: None,
            extra: ExtraFields::new(),
        };
        timeline.tasks.insert(0, task.clone());
        timeline.advance()?;
        self.save_locked(&timeline)?;
        Ok((Arc::new(timeline), Some(task)))
    }
    pub fn set_task_status(
        &self,
        folio_id: Uuid,
        task_id: Uuid,
        status: RevisionTaskStatus,
        now: u64,
    ) -> Result<Arc<RevisionTimeline>> {
        let _guard = self
            .state
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The history writer stopped unexpectedly."))?;
        let mut timeline = self.load_locked(folio_id)?.timeline.as_ref().clone();
        let task = timeline
            .tasks
            .iter_mut()
            .find(|task| task.id == task_id)
            .context("This revision task is no longer in version history.")?;
        if task.status == status {
            return Ok(Arc::new(timeline));
        }
        task.status = status;
        task.completed_at = (status == RevisionTaskStatus::Done).then_some(now);
        timeline.advance()?;
        self.save_locked(&timeline)?;
        Ok(Arc::new(timeline))
    }
    fn save_locked(&self, timeline: &RevisionTimeline) -> Result<()> {
        timeline.validate(timeline.folio_id)?;
        let bytes = serde_json::to_vec(timeline)?;
        ensure!(
            bytes.len() <= MAX_HISTORY_BYTES,
            "Version history exceeds its 128 MiB recovery limit. The existing history was kept."
        );
        let path = self.history_path(timeline.folio_id);
        if path.exists() {
            match read_history(&path, timeline.folio_id) {
                Ok(previous) => {
                    ensure!(
                        previous.generation <= timeline.generation,
                        "Version history changed before this checkpoint could be saved."
                    );
                    atomic_write(
                        &path.with_extension("json.bak"),
                        &serde_json::to_vec(&previous)?,
                    )?;
                }
                Err(_) => {
                    fs::copy(
                        &path,
                        path.with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                    )?;
                }
            }
        }
        atomic_write(&path, &bytes)
            .context("Could not save the checkpoint. The current manuscript was not restored.")
    }
}

#[derive(Clone, Debug)]
pub struct RevisionTaskOptions {
    pub title: String,
    pub detail: Option<String>,
    pub source_id: Option<String>,
    pub source: RevisionTaskSource,
    pub now: u64,
}

fn read_history(path: &Path, folio_id: Uuid) -> Result<RevisionTimeline> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_HISTORY_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_HISTORY_BYTES,
        "Version history is too large to open safely."
    );
    let mut timeline: RevisionTimeline = serde_json::from_slice(&bytes)?;
    timeline.validate(folio_id)?;
    // Older/newer writers may have used insertion order. Stable sorting retains
    // forced checkpoints first when their timestamps are equal.
    timeline
        .revisions
        .sort_by_key(|snapshot| std::cmp::Reverse(snapshot.created_at));
    timeline
        .tasks
        .sort_by_key(|task| std::cmp::Reverse(task.created_at));
    Ok(timeline)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .context("Version history has no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

fn canonical_source(document: &Manuscript) -> Option<&str> {
    match &document.workspace {
        Some(workspace) => workspace.canonical_source(),
        None => Some(&document.body),
    }
}
fn document_text(document: &Manuscript) -> &str {
    canonical_source(document).unwrap_or(&document.body)
}
fn verified_html(document: &Manuscript) -> Option<&str> {
    document.workspace.as_ref().and_then(|workspace| {
        matches!(
            workspace.projection,
            ProjectionState::Verified | ProjectionState::LegacyHtml
        )
        .then_some(workspace.content.html.as_str())
    })
}
fn same_contents(before: &Manuscript, after: &Manuscript) -> bool {
    if before.id != after.id
        || before.title != after.title
        || before.body != after.body
        || before.notes != after.notes
        || before.archived != after.archived
    {
        return false;
    }
    match (&before.workspace, &after.workspace) {
        (None, None) => true,
        (Some(before), Some(after)) => {
            // Transport/save times must not manufacture a new editorial checkpoint.
            let mut before = before.as_ref().clone();
            let mut after = after.as_ref().clone();
            before.folio.updated_at = 0;
            after.folio.updated_at = 0;
            before.content.updated_at = 0;
            after.content.updated_at = 0;
            before == after
        }
        _ => false,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevisionComparisonBasis {
    RichText,
    CanonicalSource,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionComparison {
    pub words_before: usize,
    pub words_after: usize,
    pub words_changed: usize,
    pub paragraphs_before: usize,
    pub paragraphs_after: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionPassageChange {
    pub before: Option<String>,
    pub after: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevisionDiff {
    pub summary: RevisionComparison,
    pub passages: Vec<RevisionPassageChange>,
    pub basis: RevisionComparisonBasis,
    pub canonical_source_changed: bool,
    pub metadata_changed: bool,
}

/// Uses rich text only when both projections are verified or legacy HTML.
/// A stale cache is retained in snapshots but is not presented as current proof.
pub fn compare_manuscripts(before: &Manuscript, after: &Manuscript) -> RevisionDiff {
    let (summary, passages, basis) = match (verified_html(before), verified_html(after)) {
        (Some(before), Some(after)) => (
            compare_revisions(before, after),
            compare_revision_passages(before, after),
            RevisionComparisonBasis::RichText,
        ),
        _ => {
            let before = document_text(before);
            let after = document_text(after);
            let before_passages = source_passages(before);
            let after_passages = source_passages(after);
            (
                compare_words(
                    words_text(before),
                    words_text(after),
                    before_passages.len(),
                    after_passages.len(),
                ),
                compare_passages(&before_passages, &after_passages),
                RevisionComparisonBasis::CanonicalSource,
            )
        }
    };
    let metadata_changed = before.title != after.title
        || before.notes != after.notes
        || match (&before.workspace, &after.workspace) {
            (Some(before), Some(after)) => {
                before.folio.layout != after.folio.layout
                    || before.folio.header != after.folio.header
                    || before.folio.footer != after.folio.footer
                    || before.brief != after.brief
                    || before.extra != after.extra
                    || before.folio.extra != after.folio.extra
                    || before.content.extra != after.content.extra
            }
            (None, None) => false,
            _ => true,
        };
    RevisionDiff {
        summary,
        passages,
        basis,
        canonical_source_changed: canonical_source(before) != canonical_source(after),
        metadata_changed,
    }
}

pub fn compare_revisions(before_html: &str, after_html: &str) -> RevisionComparison {
    compare_words(
        words_html(before_html),
        words_html(after_html),
        paragraphs_html(before_html),
        paragraphs_html(after_html),
    )
}
pub fn compare_revision_passages(
    before_html: &str,
    after_html: &str,
) -> Vec<RevisionPassageChange> {
    compare_passages(&passages_html(before_html), &passages_html(after_html))
}
fn compare_words(
    before: Vec<String>,
    after: Vec<String>,
    paragraphs_before: usize,
    paragraphs_after: usize,
) -> RevisionComparison {
    let mut counts = HashMap::<&str, usize>::new();
    for word in &before {
        *counts.entry(word).or_default() += 1;
    }
    let mut shared = 0;
    for word in &after {
        if let Some(count) = counts.get_mut(word.as_str())
            && *count > 0
        {
            shared += 1;
            *count -= 1;
        }
    }
    RevisionComparison {
        words_before: before.len(),
        words_after: after.len(),
        words_changed: before.len() + after.len() - 2 * shared,
        paragraphs_before,
        paragraphs_after,
    }
}
fn words_text(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && character != '_'
            })
            .to_owned()
        })
        .filter(|word| !word.is_empty())
        .collect()
}
fn words_html(html: &str) -> Vec<String> {
    words_text(
        &strip_html(html, false)
            .replace("&nbsp;", " ")
            .replace("&amp;", "&"),
    )
}
fn paragraphs_html(html: &str) -> usize {
    tags(html)
        .filter(|tag| {
            let name: String = tag[1..]
                .chars()
                .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
                .collect();
            is_paragraph_tag(&name.to_ascii_lowercase())
        })
        .count()
}
fn is_paragraph_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "blockquote"
    )
}
fn tags(html: &str) -> impl Iterator<Item = &str> {
    let mut rest = html;
    std::iter::from_fn(move || {
        let start = rest.find('<')?;
        let end = rest[start..].find('>')? + start + 1;
        let tag = &rest[start..end];
        rest = &rest[end..];
        Some(tag)
    })
}
fn strip_html(html: &str, passages: bool) -> String {
    let mut output = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        let Some(relative_end) = rest[start..].find('>') else {
            break;
        };
        let end = start + relative_end + 1;
        output.push_str(&rest[..start]);
        let tag = rest[start..end].to_ascii_lowercase();
        let inner = &tag[1..tag.len() - 1];
        let closing = inner.strip_prefix('/');
        let line_break = passages
            && (closing
                .is_some_and(|name| is_paragraph_tag(name) || matches!(name, "pre" | "div"))
                || inner
                    .strip_prefix("br")
                    .is_some_and(|suffix| suffix.trim().trim_end_matches('/').trim().is_empty()));
        output.push(if line_break { '\n' } else { ' ' });
        rest = &rest[end..];
    }
    output.push_str(rest);
    output
}
fn decode_entities(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        let Some(relative_end) = rest[start..].find(';') else {
            output.push_str(&rest[start..]);
            return output;
        };
        let end = start + relative_end + 1;
        let code = &rest[start + 1..end - 1];
        let grammar_matches =
            if let Some(number) = code.strip_prefix("#x").or_else(|| code.strip_prefix("#X")) {
                !number.is_empty()
                    && number
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            } else if let Some(number) = code.strip_prefix('#') {
                !number.is_empty() && number.chars().all(|character| character.is_ascii_digit())
            } else {
                !code.is_empty()
                    && code
                        .chars()
                        .all(|character| character.is_ascii_alphabetic())
            };
        if !grammar_matches {
            output.push('&');
            rest = &rest[start + 1..];
            continue;
        }
        let numeric = code
            .strip_prefix("#x")
            .or_else(|| code.strip_prefix("#X"))
            .and_then(|number| u32::from_str_radix(number, 16).ok())
            .or_else(|| {
                code.strip_prefix('#')
                    .and_then(|number| number.parse().ok())
            });
        let decoded = if code.starts_with('#') {
            numeric.and_then(char::from_u32)
        } else {
            match code.to_ascii_lowercase().as_str() {
                "amp" => Some('&'),
                "apos" => Some('\''),
                "gt" => Some('>'),
                "lt" => Some('<'),
                "nbsp" => Some(' '),
                "quot" => Some('"'),
                _ => None,
            }
        };
        if let Some(character) = decoded {
            output.push(character);
        } else {
            output.push_str(&rest[start..end]);
        }
        rest = &rest[end..];
    }
    output.push_str(rest);
    output
}
fn passages_html(html: &str) -> Vec<String> {
    decode_entities(&strip_html(html, true))
        .split('\n')
        .map(|passage| passage.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|passage| !passage.is_empty())
        .collect()
}
fn source_passages(text: &str) -> Vec<String> {
    let mut passages = Vec::new();
    let mut current = String::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                passages.push(std::mem::take(&mut current));
            }
        } else {
            if !current.is_empty() {
                current.push('\n');
            }
            current.push_str(line);
        }
    }
    if !current.is_empty() {
        passages.push(current);
    }
    passages
}
fn nearby(passages: &[String], target: &str, from: usize) -> usize {
    passages
        .iter()
        .enumerate()
        .skip(from + 1)
        .take(LOOK_AHEAD)
        .find_map(|(index, passage)| (passage == target).then_some(index - from))
        .unwrap_or(usize::MAX)
}
fn compare_passages(before: &[String], after: &[String]) -> Vec<RevisionPassageChange> {
    let mut changes = Vec::new();
    let (mut before_index, mut after_index) = (0, 0);
    while before_index < before.len() || after_index < after.len() {
        if before.get(before_index) == after.get(after_index) {
            before_index += 1;
            after_index += 1;
            continue;
        }
        match (before.get(before_index), after.get(after_index)) {
            (None, Some(after)) => {
                changes.push(RevisionPassageChange {
                    before: None,
                    after: Some(after.clone()),
                });
                after_index += 1;
            }
            (Some(before), None) => {
                changes.push(RevisionPassageChange {
                    before: Some(before.clone()),
                    after: None,
                });
                before_index += 1;
            }
            (Some(before_text), Some(after_text)) => {
                let after_distance = nearby(after, before_text, after_index);
                let before_distance = nearby(before, after_text, before_index);
                if after_distance < before_distance {
                    changes.push(RevisionPassageChange {
                        before: None,
                        after: Some(after_text.clone()),
                    });
                    after_index += 1;
                } else if before_distance < after_distance {
                    changes.push(RevisionPassageChange {
                        before: Some(before_text.clone()),
                        after: None,
                    });
                    before_index += 1;
                } else {
                    changes.push(RevisionPassageChange {
                        before: Some(before_text.clone()),
                        after: Some(after_text.clone()),
                    });
                    before_index += 1;
                    after_index += 1;
                }
            }
            _ => break,
        }
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        storage::Store,
        workspace::{
            ContentFormat, Folio, FolioContentSnapshot, LayoutSettings, WorkspaceDocument,
        },
    };
    use serde_json::json;

    fn document() -> Manuscript {
        let mut document = Manuscript::new("A manuscript");
        let id = document.id.to_string();
        document.body = "\u{feff}#let x = 1\r\nAn opening.\r\n".into();
        let mut folio = Folio::draft(id.clone(), document.title.clone(), document.created_at);
        folio.layout = Some(LayoutSettings::default());
        folio.header = Some("Original header".into());
        folio.footer = Some("Original footer".into());
        folio
            .extra
            .insert("futureFolio".into(), json!({"preserve": true}));
        let mut content = FolioContentSnapshot {
            folio_id: id,
            html: "<p>An opening.</p>".into(),
            format: Some(ContentFormat::Typst),
            typst_source: Some(document.body.clone()),
            updated_at: document.updated_at,
            extra: ExtraFields::new(),
        };
        content
            .extra
            .insert("futureContent".into(), json!([1, 2, 3]));
        document.workspace = Some(Arc::new(WorkspaceDocument {
            folio,
            content,
            brief: None,
            projection: ProjectionState::Verified,
            backup_template: None,
            provenance: None,
            extra: ExtraFields::from([("futureWorkspace".into(), json!("kept"))]),
        }));
        document
    }
    fn set_source(document: &mut Manuscript, source: &str) {
        document.body = source.into();
        let workspace = Arc::make_mut(document.workspace.as_mut().unwrap());
        workspace.content.typst_source = Some(source.into());
        document.touch();
    }

    #[test]
    fn source_only_changes_and_metadata_are_real_checkpoints() {
        let mut current = document();
        let mut timeline = RevisionTimeline::new(current.id);
        timeline
            .add_checkpoint(Arc::new(current.clone()), &CheckpointOptions::manual(1))
            .unwrap();
        set_source(&mut current, "#let x = 2\r\nAn opening.\r\n");
        timeline
            .add_checkpoint(Arc::new(current.clone()), &CheckpointOptions::manual(2))
            .unwrap();
        assert_eq!(timeline.revisions.len(), 2);
        Arc::make_mut(current.workspace.as_mut().unwrap())
            .folio
            .footer = Some("A new footer".into());
        timeline
            .add_checkpoint(Arc::new(current.clone()), &CheckpointOptions::manual(3))
            .unwrap();
        assert_eq!(timeline.revisions.len(), 3);
        current.touch();
        assert!(
            timeline
                .add_checkpoint(Arc::new(current), &CheckpointOptions::manual(4))
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn timing_force_and_capacity_follow_web_history() {
        let mut current = document();
        let mut timeline = RevisionTimeline::new(current.id);
        assert!(
            timeline
                .add_checkpoint(Arc::new(current.clone()), &CheckpointOptions::automatic(1))
                .unwrap()
                .is_some()
        );
        set_source(&mut current, "A different source");
        assert!(
            timeline
                .add_checkpoint(Arc::new(current.clone()), &CheckpointOptions::automatic(2))
                .unwrap()
                .is_none()
        );
        assert!(
            timeline
                .add_checkpoint(
                    Arc::new(current.clone()),
                    &CheckpointOptions::automatic(AUTO_INTERVAL_MS + 1)
                )
                .unwrap()
                .is_some()
        );
        for now in 0..60 {
            timeline
                .add_checkpoint(
                    Arc::new(current.clone()),
                    &CheckpointOptions {
                        force: true,
                        ..CheckpointOptions::manual(now)
                    },
                )
                .unwrap();
        }
        assert_eq!(timeline.revisions.len(), MAX_REVISIONS);
        assert_eq!(timeline.revisions[0].created_at, 59);
        assert_eq!(timeline.revisions[0].label, "Manual checkpoint");
    }
    #[test]
    fn compares_actual_web_metrics_and_passage_anchors() {
        assert_eq!(
            compare_revisions(
                "<p>A plain opening.</p><p>Needs evidence.</p>",
                "<p>A stronger opening.</p><p>Evidence now cited.</p>"
            ),
            RevisionComparison {
                words_before: 5,
                words_after: 6,
                words_changed: 5,
                paragraphs_before: 2,
                paragraphs_after: 2
            }
        );
        assert_eq!(
            compare_revision_passages(
                "<p>First.</p><p>Third.</p>",
                "<p>First.</p><p>Second &amp; new.</p><p>Third.</p>"
            ),
            vec![RevisionPassageChange {
                before: None,
                after: Some("Second & new.".into())
            }]
        );
        assert_eq!(
            compare_revision_passages(
                "<h1>Opening</h1><p>A plain claim.</p><p>The ending stays.</p>",
                "<h1>Opening</h1><p>A supported claim.</p><p>The ending stays.</p>"
            ),
            vec![RevisionPassageChange {
                before: Some("A plain claim.".into()),
                after: Some("A supported claim.".into())
            }]
        );
        assert!(compare_revision_passages("<p>&#99999999;</p>", "<p>&#99999999;</p>").is_empty());
    }
    #[test]
    fn unverified_projection_uses_source_and_flags_unchanged_rich_text() {
        let before = document();
        let mut after = before.clone();
        set_source(&mut after, "#let x = 2\r\nAn opening.\r\n");
        let rich_diff = compare_manuscripts(&before, &after);
        assert!(rich_diff.canonical_source_changed);
        assert!(rich_diff.passages.is_empty());
        Arc::make_mut(after.workspace.as_mut().unwrap()).projection =
            ProjectionState::UnverifiedCache;
        let source_diff = compare_manuscripts(&before, &after);
        assert_eq!(source_diff.basis, RevisionComparisonBasis::CanonicalSource);
        assert!(!source_diff.passages.is_empty());
    }
    #[test]
    fn restore_saves_exact_current_draft_before_cas_and_retains_full_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let library = Store::open(directory.path().into()).unwrap();
        let history = RevisionStore::open(directory.path()).unwrap();
        let original = document();
        library.save(&original).unwrap();
        let snapshot = history
            .checkpoint(Arc::new(original.clone()), CheckpointOptions::manual(1))
            .unwrap()
            .created
            .unwrap();
        let mut current = original.clone();
        set_source(&mut current, "A new canonical draft");
        Arc::make_mut(current.workspace.as_mut().unwrap())
            .folio
            .header = Some("Changed header".into());
        library.save(&current).unwrap();
        let plan = history
            .prepare_restore(Uuid::new_v4(), snapshot.id, Arc::new(current.clone()), 100)
            .unwrap();
        let saved_history = history.load(current.id).unwrap().timeline;
        assert_eq!(
            saved_history.revisions[0].label,
            "Before restoring an earlier version"
        );
        assert_eq!(saved_history.revisions[0].manuscript.as_ref(), &current);
        // Preparing a restore is not a manuscript save.
        assert_eq!(library.load().unwrap().documents[0].body, current.body);
        assert!(plan.matches_current(&current));
        assert_eq!(plan.replacement.body.as_bytes(), original.body.as_bytes());
        assert_eq!(
            plan.replacement.workspace.as_ref().unwrap().folio.header,
            original.workspace.as_ref().unwrap().folio.header
        );
        assert_eq!(
            plan.replacement.workspace.as_ref().unwrap().extra,
            original.workspace.as_ref().unwrap().extra
        );
        assert_eq!(
            plan.replacement.workspace.as_ref().unwrap().projection,
            ProjectionState::Verified
        );
        library
            .save_if_revision(&plan.replacement, current.revision)
            .unwrap();
        let restored = library.load().unwrap().documents.remove(0);
        assert_eq!(restored.body.as_bytes(), original.body.as_bytes());
        assert_eq!(restored.revision, current.revision + 1);
    }
    #[test]
    fn stale_restore_fails_cas_but_recovery_checkpoint_stays_durable() {
        let directory = tempfile::tempdir().unwrap();
        let library = Store::open(directory.path().into()).unwrap();
        let history = RevisionStore::open(directory.path()).unwrap();
        let mut current = document();
        library.save(&current).unwrap();
        let snapshot = history
            .checkpoint(Arc::new(current.clone()), CheckpointOptions::manual(1))
            .unwrap()
            .created
            .unwrap();
        let plan = history
            .prepare_restore(Uuid::new_v4(), snapshot.id, Arc::new(current.clone()), 100)
            .unwrap();
        current.touch();
        library.save(&current).unwrap();
        assert!(!plan.matches_current(&current));
        assert!(
            library
                .save_if_revision(&plan.replacement, plan.expected_current.revision)
                .is_err()
        );
        assert_eq!(
            history.load(current.id).unwrap().timeline.revisions[0].label,
            "Before restoring an earlier version"
        );
        assert_eq!(
            library.load().unwrap().documents[0].revision,
            current.revision
        );
    }
    #[test]
    fn executed_web_fixture_matches_native_word_and_passage_comparison() {
        #[derive(Deserialize)]
        struct Fixture {
            cases: Vec<Case>,
        }
        #[derive(Deserialize)]
        struct Case {
            name: String,
            before: String,
            after: String,
            summary: RevisionComparison,
            passages: Vec<RevisionPassageChange>,
        }
        let fixture: Fixture =
            serde_json::from_str(include_str!("../fixtures/revisions/web-reference.json")).unwrap();
        for case in fixture.cases {
            assert_eq!(
                compare_revisions(&case.before, &case.after),
                case.summary,
                "{} word summary",
                case.name
            );
            assert_eq!(
                compare_revision_passages(&case.before, &case.after),
                case.passages,
                "{} passages",
                case.name
            );
        }
    }
    #[test]
    fn storage_recovers_previous_history_without_destroying_damaged_primary() {
        let directory = tempfile::tempdir().unwrap();
        let history = RevisionStore::open(directory.path()).unwrap();
        let mut current = document();
        history
            .checkpoint(Arc::new(current.clone()), CheckpointOptions::manual(1))
            .unwrap();
        set_source(&mut current, "A second source");
        history
            .checkpoint(Arc::new(current.clone()), CheckpointOptions::manual(2))
            .unwrap();
        let path = history.history_path(current.id);
        fs::write(&path, b"interrupted write").unwrap();
        let recovered = history.load(current.id).unwrap();
        assert_eq!(recovered.warnings.len(), 1);
        assert_eq!(recovered.timeline.revisions.len(), 1);
        assert_eq!(fs::read(&path).unwrap(), b"interrupted write");
        history
            .checkpoint(Arc::new(current.clone()), CheckpointOptions::manual(3))
            .unwrap();
        assert_eq!(
            history.load(current.id).unwrap().timeline.revisions.len(),
            2
        );
        assert!(fs::read_dir(path.parent().unwrap()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".damaged-")
        }));
    }
    #[test]
    fn mismatched_ids_and_history_failures_cannot_create_restore_plans() {
        let directory = tempfile::tempdir().unwrap();
        let history = RevisionStore::open(directory.path()).unwrap();
        let original = document();
        let snapshot = history
            .checkpoint(Arc::new(original.clone()), CheckpointOptions::manual(1))
            .unwrap()
            .created
            .unwrap();
        assert!(
            history
                .prepare_restore(
                    Uuid::new_v4(),
                    snapshot.id,
                    Arc::new(Manuscript::new("Other")),
                    2
                )
                .is_err()
        );
        fs::remove_dir_all(directory.path().join("revisions")).unwrap();
        fs::write(directory.path().join("revisions"), b"not a directory").unwrap();
        assert!(
            history
                .prepare_restore(Uuid::new_v4(), snapshot.id, Arc::new(original), 3)
                .is_err()
        );
    }
    #[test]
    fn tasks_deduplicate_source_ids_and_persist_completion() {
        let directory = tempfile::tempdir().unwrap();
        let history = RevisionStore::open(directory.path()).unwrap();
        let folio_id = Uuid::new_v4();
        let options = RevisionTaskOptions {
            title: "Support the central claim".into(),
            detail: Some("Use evidence".into()),
            source_id: Some("note-1".into()),
            source: RevisionTaskSource::Feedback,
            now: 1,
        };
        let (_, task) = history.create_task(folio_id, options.clone()).unwrap();
        assert!(history.create_task(folio_id, options).unwrap().1.is_none());
        let task_id = task.unwrap().id;
        let done = history
            .set_task_status(folio_id, task_id, RevisionTaskStatus::Done, 2)
            .unwrap();
        assert_eq!(done.tasks[0].completed_at, Some(2));
        assert_eq!(done.open_task_count(), 0);
        let reopened = history
            .set_task_status(folio_id, task_id, RevisionTaskStatus::Open, 3)
            .unwrap();
        assert_eq!(reopened.tasks[0].completed_at, None);
        assert_eq!(reopened.open_task_count(), 1);
    }
}
