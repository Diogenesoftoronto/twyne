//! The offline Dossier form and its owner/folio/base-scoped recovery contract.
//!
//! Prose defaults, departments, and local questions mirror the existing web
//! form. Filing produces data; the application persists it and acknowledges
//! success before the form's recovery copy is removed.

use crate::workspace::{
    AttachmentKind, BriefField, DossierAttachment, DossierProbe, ExtraFields, ImportProvenance,
    ProbeAnswer, ProbeKind, ProjectBrief, ProjectInterviewAnswers,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const RECOVERY_MAX_AGE_MS: u64 = 24 * 60 * 60 * 1_000;
pub const MAX_RECOVERY_BYTES: u64 = 64_000_000;
pub const MAX_REFERENCE_UNITS: usize = 2_000;
pub const FORM_PROBE_COUNT: usize = 3;
pub const UNTITLED_FOLIO_NAME: &str = "Untitled folio";

pub fn default_answers() -> ProjectInterviewAnswers {
    ProjectInterviewAnswers {
        working_title: "Untitled project".into(),
        format: "Essay".into(),
        audience: "A thoughtful reader who needs the point made clearly".into(),
        goal: "Make the central argument feel inevitable and worth caring about".into(),
        tone: "Clear, exact, and generous".into(),
        constraints: "Keep the piece grounded in evidence and avoid generic filler".into(),
        success_signal: "A reader should know what this is, who it is for, and why it matters"
            .into(),
        extra: ExtraFields::new(),
    }
}

pub const ANSWER_FIELDS: [BriefField; 7] = [
    BriefField::WorkingTitle,
    BriefField::Format,
    BriefField::Audience,
    BriefField::Goal,
    BriefField::Tone,
    BriefField::Constraints,
    BriefField::SuccessSignal,
];
pub const FIELD_LABELS: [&str; 7] = [
    "Working title",
    "Format",
    "Audience",
    "Goal",
    "Tone",
    "Non-negotiables",
    "Success signal",
];
pub const WRITING_FORMAT_SUGGESTIONS: [&str; 34] = [
    "Essay",
    "Article",
    "Blog post",
    "Newsletter",
    "Op-ed",
    "Feature",
    "Profile",
    "Interview",
    "Review",
    "Memo",
    "Report",
    "Proposal",
    "Case study",
    "White paper",
    "Research paper",
    "Academic paper",
    "Personal statement",
    "Grant application",
    "Speech",
    "Lecture",
    "Tutorial",
    "Documentation",
    "Book chapter",
    "Short story",
    "Novella",
    "Novel",
    "Poem",
    "Screenplay",
    "Stage play",
    "Radio script",
    "Podcast script",
    "Dispatch",
    "Manifesto",
    "Polemic",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepKind {
    Input,
    Textarea,
    Probes,
    Import,
    Attachments,
}

#[derive(Clone, Copy, Debug)]
pub struct DossierStep {
    pub field: Option<BriefField>,
    pub numeral: &'static str,
    pub department: &'static str,
    pub question: &'static str,
    pub hint: &'static str,
    pub placeholder: &'static str,
    pub kind: StepKind,
}

pub const STEPS: [DossierStep; 10] = [
    DossierStep {
        field: Some(BriefField::WorkingTitle),
        numeral: "I",
        department: "Dept. of the Working Title",
        question: "What are we calling it, for now?",
        hint: "Give the piece a working name so the room has something to hold onto.",
        placeholder: "A working title — anything you can carry across a desk",
        kind: StepKind::Input,
    },
    DossierStep {
        field: Some(BriefField::Format),
        numeral: "II",
        department: "Dept. of Form",
        question: "What kind of piece is this?",
        hint: "Essay, memo, chapter, dispatch, proposal, profile, polemic — or something stranger.",
        placeholder: "Essay",
        kind: StepKind::Input,
    },
    DossierStep {
        field: Some(BriefField::Audience),
        numeral: "III",
        department: "Dept. of the Reader",
        question: "Who is this for?",
        hint: "Name the actual reader, not just a demographic label. Picture one face.",
        placeholder: "A skeptical, smart reader who needs the argument made plainly",
        kind: StepKind::Textarea,
    },
    DossierStep {
        field: Some(BriefField::Goal),
        numeral: "IV",
        department: "Dept. of Intent",
        question: "What should the piece accomplish?",
        hint: "This becomes the north star for the draft and the editorial board.",
        placeholder: "Convince them, inform them, move them, or change how they think.",
        kind: StepKind::Textarea,
    },
    DossierStep {
        field: Some(BriefField::Tone),
        numeral: "V",
        department: "Dept. of Voice",
        question: "What tone should the room protect?",
        hint: "Say how the draft should feel, not just how it should sound.",
        placeholder: "Calm, exact, and a little sharp where it matters",
        kind: StepKind::Input,
    },
    DossierStep {
        field: Some(BriefField::Constraints),
        numeral: "VI",
        department: "Dept. of Non-Negotiables",
        question: "What constraints or non-negotiables matter?",
        hint: "Sources, boundaries, forbidden moves, or must-keep material.",
        placeholder: "Keep claims tied to evidence, avoid jargon, preserve the anecdote in the second paragraph.",
        kind: StepKind::Textarea,
    },
    DossierStep {
        field: Some(BriefField::SuccessSignal),
        numeral: "VII",
        department: "Dept. of the Landing",
        question: "How will we know the draft has landed?",
        hint: "Describe the signal of success from the reader's side.",
        placeholder: "A reader can state the thesis back to us and knows why it matters.",
        kind: StepKind::Textarea,
    },
    DossierStep {
        field: None,
        numeral: "VIII",
        department: "Dept. of Particulars",
        question: "A few specifics, drawn from what you just told us.",
        hint: "The room reads your answers and asks the follow-ups that would sharpen them. Skip any that don't fit — they're questions, not a quiz.",
        placeholder: "",
        kind: StepKind::Probes,
    },
    DossierStep {
        field: None,
        numeral: "IX",
        department: "Dept. of Prior Material",
        question: "Already have a draft, notes, or sources to bring in?",
        hint: "Paste or upload existing prose so the editor's room reads from your work instead of an empty page. Skip if you're starting from scratch.",
        placeholder: "Paste an outline, a stalled draft, research notes, source quotes — whatever the room should hold while you write.",
        kind: StepKind::Import,
    },
    DossierStep {
        field: None,
        numeral: "X",
        department: "Dept. of References",
        question: "Anything else the room should know about, and why?",
        hint: "Add as many documents or links as you like, each with a one-line note on why it matters. Skip if there's nothing yet.",
        placeholder: "",
        kind: StepKind::Attachments,
    },
];

pub fn answer(answers: &ProjectInterviewAnswers, field: BriefField) -> &str {
    match field {
        BriefField::WorkingTitle => &answers.working_title,
        BriefField::Format => &answers.format,
        BriefField::Audience => &answers.audience,
        BriefField::Goal => &answers.goal,
        BriefField::Tone => &answers.tone,
        BriefField::Constraints => &answers.constraints,
        BriefField::SuccessSignal => &answers.success_signal,
    }
}

pub fn set_answer(answers: &mut ProjectInterviewAnswers, field: BriefField, value: String) {
    *match field {
        BriefField::WorkingTitle => &mut answers.working_title,
        BriefField::Format => &mut answers.format,
        BriefField::Audience => &mut answers.audience,
        BriefField::Goal => &mut answers.goal,
        BriefField::Tone => &mut answers.tone,
        BriefField::Constraints => &mut answers.constraints,
        BriefField::SuccessSignal => &mut answers.success_signal,
    } = value;
}

/// Whitespace follows JavaScript trim, including the source-file BOM.
fn trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

fn is_js_whitespace(character: char) -> bool {
    matches!(character,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Matches the existing form's material counter. The view computes this at
/// hydration and quiet/explicit boundaries rather than on each text repaint.
pub fn material_word_count(value: &str) -> usize {
    if value.is_empty() {
        return 0;
    }
    trim(value)
        .split(is_js_whitespace)
        .filter(|word| !word.is_empty())
        .count()
        .max(1)
}

pub fn normalized_answers(
    answers: &ProjectInterviewAnswers,
    folio_name: &str,
) -> ProjectInterviewAnswers {
    let defaults = default_answers();
    let mut normalized = answers.clone();
    for field in ANSWER_FIELDS {
        let text = trim(answer(answers, field));
        set_answer(
            &mut normalized,
            field,
            if text.is_empty() {
                answer(&defaults, field)
            } else {
                text
            }
            .to_owned(),
        );
    }
    let folio_title = trim(folio_name);
    if !folio_title.is_empty()
        && folio_title != UNTITLED_FOLIO_NAME
        && (trim(&answers.working_title).is_empty()
            || trim(&answers.working_title) == defaults.working_title)
    {
        normalized.working_title = folio_title.to_owned();
    }
    normalized
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DossierMode {
    #[default]
    Create,
    Refine,
}

impl DossierMode {
    pub fn scope(self, folio_id: Option<&str>) -> String {
        format!(
            "{}:{}",
            if self == Self::Create {
                "create"
            } else {
                "refine"
            },
            folio_id.unwrap_or("new")
        )
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PriorMaterial {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<ImportProvenance>,
    /// A textarea edit does not erase the original import, but it prevents an
    /// application from silently installing that old source as the new text.
    #[serde(default)]
    pub edited: bool,
    #[serde(default)]
    pub carried_from_manuscript: bool,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl PriorMaterial {
    pub fn pasted(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }
    pub fn has_material(&self) -> bool {
        !trim(&self.text).is_empty() || self.html.is_some() || self.typst_source.is_some()
    }
    pub fn original_source(&self) -> Option<&str> {
        self.typst_source.as_deref()
    }
    pub fn imported_filename(&self) -> Option<&str> {
        self.provenance
            .as_ref()
            .map(|origin| origin.file_name.as_str())
    }
    pub fn replace_text(&mut self, text: String) {
        if self.text != text {
            self.edited = self.provenance.is_some()
                || self.html.is_some()
                || self.typst_source.is_some()
                || self.carried_from_manuscript;
            self.text = text;
        }
    }
    pub fn canonical_seed_source(&self) -> Option<&str> {
        (!self.edited).then(|| self.original_source()).flatten()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDraft {
    pub kind: AttachmentKind,
    pub title: String,
    pub url: String,
    pub text: String,
    pub why: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub truncated: bool,
}

impl Default for ReferenceDraft {
    fn default() -> Self {
        Self {
            kind: AttachmentKind::Document,
            title: String::new(),
            url: String::new(),
            text: String::new(),
            why: String::new(),
            file_name: String::new(),
            truncated: false,
        }
    }
}

fn truncate_utf16(value: &str, max: usize) -> (String, bool) {
    let mut units = 0;
    let mut end = value.len();
    for (offset, character) in value.char_indices() {
        units += character.len_utf16();
        if units > max {
            end = offset;
            break;
        }
    }
    (value[..end].to_owned(), end < value.len())
}

impl ReferenceDraft {
    pub fn replace_text(&mut self, value: &str) {
        (self.text, self.truncated) = truncate_utf16(value, MAX_REFERENCE_UNITS);
        self.file_name.clear();
    }
    pub fn import_text(&mut self, value: &str, file_name: &str) {
        (self.text, self.truncated) = truncate_utf16(value, MAX_REFERENCE_UNITS);
        self.file_name = file_name.to_owned();
        if self.title.is_empty() {
            self.title = file_name.to_owned();
        }
    }
    pub fn can_add(&self) -> bool {
        !trim(&self.title).is_empty()
            && !trim(&self.why).is_empty()
            && !trim(if self.kind == AttachmentKind::Link {
                &self.url
            } else {
                &self.text
            })
            .is_empty()
    }
    pub fn attachment(&self, now: u64) -> Result<DossierAttachment> {
        ensure!(!trim(&self.title).is_empty(), "Give the reference a title.");
        ensure!(
            !trim(&self.why).is_empty(),
            "Say why this reference matters to the piece."
        );
        ensure!(
            self.can_add(),
            if self.kind == AttachmentKind::Link {
                "Add a source URL."
            } else {
                "Paste or upload the document text."
            }
        );
        Ok(DossierAttachment {
            id: Uuid::new_v4().to_string(),
            kind: self.kind,
            title: trim(&self.title).into(),
            why: trim(&self.why).into(),
            added_at: now,
            url: (self.kind == AttachmentKind::Link).then(|| trim(&self.url).to_owned()),
            text: (self.kind == AttachmentKind::Document)
                .then(|| truncate_utf16(trim(&self.text), MAX_REFERENCE_UNITS).0),
            extra: ExtraFields::new(),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DossierDraft {
    pub answers: ProjectInterviewAnswers,
    pub attachments: Vec<DossierAttachment>,
    pub probes: Vec<DossierProbe>,
    pub prior_material: PriorMaterial,
    #[serde(default)]
    pub reference: ReferenceDraft,
    pub step: usize,
    #[serde(default)]
    pub generation: u64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl DossierDraft {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.step < STEPS.len(),
            "This recovery copy has an invalid Dossier section."
        );
        Ok(())
    }
    pub fn touch(&mut self) {
        self.generation = self.generation.saturating_add(1);
    }
    pub fn is_section_filed(&self, index: usize) -> bool {
        let Some(step) = STEPS.get(index) else {
            return false;
        };
        match step.kind {
            StepKind::Input | StepKind::Textarea => step
                .field
                .is_some_and(|field| !trim(answer(&self.answers, field)).is_empty()),
            StepKind::Probes => self.probes.iter().any(is_answered),
            StepKind::Import => self.prior_material.has_material(),
            StepKind::Attachments => !self.attachments.is_empty(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryIdentity {
    pub scope: String,
    pub owner: Option<String>,
    pub base: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEnvelope {
    pub version: u32,
    pub identity: RecoveryIdentity,
    pub updated_at: u64,
    pub revision: String,
    pub draft: DossierDraft,
}

impl RecoveryEnvelope {
    fn usable(&self, identity: &RecoveryIdentity, now: u64) -> bool {
        self.version == 1
            && &self.identity == identity
            && self.updated_at <= now
            && now - self.updated_at <= RECOVERY_MAX_AGE_MS
            && self.draft.validate().is_ok()
    }
}

#[derive(Clone, Debug)]
pub struct DossierRecovery {
    directory: PathBuf,
    pub identity: RecoveryIdentity,
    write_lock: Arc<Mutex<()>>,
    active: Arc<AtomicBool>,
}

impl DossierRecovery {
    pub fn new(directory: impl Into<PathBuf>, identity: RecoveryIdentity) -> Self {
        Self {
            directory: directory.into(),
            identity,
            write_lock: Arc::new(Mutex::new(())),
            active: Arc::new(AtomicBool::new(true)),
        }
    }
    pub fn path(&self) -> PathBuf {
        // Every brief base has its own copy, so a still-running older form
        // cannot replace recovery for a newer saved edition. The full identity
        // is also checked in the envelope. No path component comes from input.
        let key = serde_json::to_vec(&self.identity).expect("recovery identity serializes");
        let mut first = 0xcbf29ce484222325_u64;
        let mut second = 0x84222325cbf29ce4_u64;
        for byte in key {
            first = (first ^ u64::from(byte)).wrapping_mul(0x100000001b3);
            second = (second ^ u64::from(byte))
                .rotate_left(7)
                .wrapping_mul(0x100000001b3);
        }
        self.directory
            .join(format!("dossier-{first:016x}{second:016x}.json"))
    }
    fn read_envelope(&self) -> Result<Option<RecoveryEnvelope>> {
        let path = self.path();
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("Could not read the Dossier recovery copy."),
        };
        ensure!(
            metadata.len() <= MAX_RECOVERY_BYTES,
            "The Dossier recovery copy is too large."
        );
        let bytes = fs::read(path).context("Could not read the Dossier recovery copy.")?;
        let envelope = serde_json::from_slice(&bytes)
            .context("The Dossier recovery copy is damaged; the original file was kept.")?;
        Ok(Some(envelope))
    }
    pub fn load(&self, now: u64) -> Result<Option<DossierDraft>> {
        Ok(self
            .read_envelope()?
            .filter(|saved| saved.usable(&self.identity, now))
            .map(|saved| saved.draft))
    }
    pub fn save(&self, draft: &DossierDraft, now: u64) -> Result<RecoveryEnvelope> {
        draft.validate()?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The Dossier recovery writer could not be acquired."))?;
        ensure!(
            self.active.load(Ordering::Acquire),
            "This Dossier form has already left its recovery scope."
        );
        let previous = self.read_envelope()?;
        if let Some(saved) = &previous {
            ensure!(
                saved.identity == self.identity,
                "Another Dossier edition owns this recovery file; its copy was kept."
            );
            if saved.usable(&self.identity, now)
                && (saved.draft == *draft || saved.draft.generation > draft.generation)
            {
                return Ok(saved.clone());
            }
        }
        let envelope = RecoveryEnvelope {
            version: 1,
            identity: self.identity.clone(),
            updated_at: now,
            revision: Uuid::new_v4().to_string(),
            draft: draft.clone(),
        };
        let bytes = serde_json::to_vec(&envelope)
            .context("Could not serialize the Dossier recovery copy.")?;
        ensure!(
            bytes.len() as u64 <= MAX_RECOVERY_BYTES,
            "The Dossier recovery copy exceeds the 64 MB limit."
        );
        fs::create_dir_all(&self.directory)
            .context("Could not create the Dossier recovery directory.")?;
        let mut temporary = NamedTempFile::new_in(&self.directory)
            .context("Could not prepare the Dossier recovery copy.")?;
        temporary
            .write_all(&bytes)
            .context("Could not write the Dossier recovery copy.")?;
        temporary
            .as_file()
            .sync_all()
            .context("Could not flush the Dossier recovery copy.")?;
        temporary
            .persist(self.path())
            .map_err(|error| error.error)
            .context("Could not keep the Dossier recovery copy.")?;
        #[cfg(unix)]
        fs::File::open(&self.directory)?.sync_all()?;
        Ok(envelope)
    }
    pub fn clear(&self) -> Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The Dossier recovery writer could not be acquired."))?;
        if !self.active.load(Ordering::Acquire) {
            // A replacement form can use this path with the same identity.
            // Retired writers must never remove that replacement's copy.
            return Ok(());
        }
        // A debounce writer cannot recreate the copy after filing or handoff.
        self.active.store(false, Ordering::Release);
        if let Some(saved) = self.read_envelope()? {
            ensure!(
                saved.identity == self.identity,
                "A newer Dossier owns this recovery copy; it was kept."
            );
            fs::remove_file(self.path())
                .context("Could not clear the filed Dossier's recovery copy.")?;
        }
        Ok(())
    }
    /// Stop this form and all cloned writers without deleting its saved draft.
    /// The writer lock also waits for an already-running atomic save before a
    /// replacement form can read and reuse this recovery path.
    pub fn retire(&self) -> Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| anyhow::anyhow!("The Dossier recovery writer could not be acquired."))?;
        self.active.store(false, Ordering::Release);
        Ok(())
    }
    pub fn move_scope(&self, scope: String, now: u64) -> Result<Self> {
        let next = Self::new(
            self.directory.clone(),
            RecoveryIdentity {
                scope,
                ..self.identity.clone()
            },
        );
        if next.identity.scope == self.identity.scope {
            return Ok(self.clone());
        }
        if let Some(draft) = self.load(now)? {
            next.save(&draft, now)?;
            self.clear()?;
        }
        Ok(next)
    }
    pub fn prepare_handoff(&self, now: u64) -> Result<Option<RecoveryHandoff>> {
        if self.identity.owner.is_some() {
            return Ok(None);
        }
        Ok(self
            .read_envelope()?
            .filter(|saved| saved.usable(&self.identity, now))
            .map(|saved| RecoveryHandoff {
                revision: saved.revision,
                identity: self.identity.clone(),
            }))
    }
    pub fn claim_handoff(
        &self,
        handoff: &RecoveryHandoff,
        owner: String,
        now: u64,
    ) -> Result<bool> {
        if handoff.identity != self.identity || self.identity.owner.is_some() {
            return Ok(false);
        }
        let Some(saved) = self.read_envelope()?.filter(|saved| {
            saved.usable(&self.identity, now) && saved.revision == handoff.revision
        }) else {
            return Ok(false);
        };
        let next = Self::new(
            self.directory.clone(),
            RecoveryIdentity {
                owner: Some(owner),
                ..self.identity.clone()
            },
        );
        let newer_owned = next.read_envelope()?.is_some_and(|current| {
            current.usable(&next.identity, now) && current.updated_at >= saved.updated_at
        });
        if !newer_owned {
            next.save(&saved.draft, saved.updated_at)?;
        }
        self.clear()?;
        Ok(true)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RecoveryHandoff {
    pub revision: String,
    pub identity: RecoveryIdentity,
}

#[derive(Clone, Debug)]
pub struct DossierOptions {
    pub folio_id: Option<String>,
    pub folio_name: String,
    pub owner: Option<String>,
    pub mode: DossierMode,
    pub existing_brief: Option<ProjectBrief>,
    pub initial_material: PriorMaterial,
    pub recovery: Option<DossierRecovery>,
}

impl Default for DossierOptions {
    fn default() -> Self {
        Self {
            folio_id: None,
            folio_name: String::new(),
            owner: None,
            mode: DossierMode::Create,
            existing_brief: None,
            initial_material: PriorMaterial::default(),
            recovery: None,
        }
    }
}

impl DossierOptions {
    pub fn recovery_identity(&self) -> RecoveryIdentity {
        RecoveryIdentity {
            scope: self.mode.scope(self.folio_id.as_deref()),
            owner: self.owner.clone(),
            base: self
                .existing_brief
                .as_ref()
                .map(|brief| brief.updated_at.to_string())
                .unwrap_or_else(|| "0".into()),
        }
    }
    pub fn with_recovery_directory(mut self, directory: impl Into<PathBuf>) -> Self {
        self.recovery = Some(DossierRecovery::new(directory, self.recovery_identity()));
        self
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FilingState {
    #[default]
    Idle,
    Filing,
    Filed,
}

#[derive(Clone, Debug)]
pub struct DossierSubmission {
    pub brief: ProjectBrief,
    pub prior_material: Option<PriorMaterial>,
    pub mode: DossierMode,
}

impl DossierSubmission {
    pub fn seed_for_empty_manuscript(&self, manuscript_is_empty: bool) -> Option<&PriorMaterial> {
        (manuscript_is_empty && self.mode == DossierMode::Create)
            .then_some(self.prior_material.as_ref())
            .flatten()
    }
}

#[derive(Clone, Debug)]
pub struct DossierSession {
    pub options: DossierOptions,
    pub draft: DossierDraft,
    pub filing: FilingState,
    pub restored: bool,
    pub recovery_error: Option<String>,
    probes_answers_key: Option<String>,
}

impl DossierSession {
    pub fn open(options: DossierOptions, now: u64) -> Result<Self> {
        ensure!(
            options.mode != DossierMode::Refine || options.existing_brief.is_some(),
            "Open an existing Dossier before refining it."
        );
        if let Some(recovery) = &options.recovery {
            ensure!(
                recovery.identity == options.recovery_identity(),
                "The Dossier recovery identity belongs to a different folio, owner, or saved brief."
            );
        }
        let previous = options.existing_brief.as_ref();
        let mut answers = previous
            .map(|brief| brief.answers.clone())
            .unwrap_or_else(default_answers);
        if previous.is_none()
            && !trim(&options.folio_name).is_empty()
            && trim(&options.folio_name) != UNTITLED_FOLIO_NAME
        {
            answers.working_title = trim(&options.folio_name).to_owned();
        }
        let initial = DossierDraft {
            answers,
            attachments: previous
                .map(|brief| brief.attachments.clone())
                .unwrap_or_default(),
            probes: previous
                .and_then(|brief| brief.probes.clone())
                .unwrap_or_default(),
            prior_material: options.initial_material.clone(),
            reference: ReferenceDraft::default(),
            step: 0,
            generation: 0,
            extra: ExtraFields::new(),
        };
        let (draft, restored, recovery_error) =
            match options.recovery.as_ref().map(|recovery| recovery.load(now)) {
                Some(Ok(Some(draft))) => (draft, true, None),
                Some(Err(error)) => (initial, false, Some(error.to_string())),
                _ => (initial, false, None),
            };
        let probes_answers_key = (!draft.probes.is_empty())
            .then(|| serde_json::to_string(&draft.answers).expect("answers serialize"));
        Ok(Self {
            options,
            draft,
            filing: FilingState::Idle,
            restored,
            recovery_error,
            probes_answers_key,
        })
    }
    pub fn go_to(&mut self, step: usize) -> Result<()> {
        ensure!(step < STEPS.len(), "That Dossier section does not exist.");
        ensure!(
            self.filing != FilingState::Filing,
            "The Dossier is being filed."
        );
        if self.draft.step != step {
            self.draft.step = step;
            self.draft.touch();
        }
        if STEPS[step].kind == StepKind::Probes {
            self.prepare_local_probes();
        }
        Ok(())
    }
    pub fn next_section(&mut self) -> Result<bool> {
        if self.draft.step == STEPS.len() - 1 {
            return Ok(false);
        }
        self.go_to(self.draft.step + 1)?;
        Ok(true)
    }
    pub fn previous_section(&mut self) -> Result<()> {
        self.go_to(self.draft.step.saturating_sub(1))
    }
    pub fn edit_answer(&mut self, field: BriefField, value: String) {
        if answer(&self.draft.answers, field) != value {
            set_answer(&mut self.draft.answers, field, value);
            self.draft.touch();
        }
    }
    pub fn edit_prior_material(&mut self, text: String) {
        if self.draft.prior_material.text != text {
            self.draft.prior_material.replace_text(text);
            self.draft.touch();
        }
    }
    pub fn replace_prior_material(&mut self, material: PriorMaterial) {
        self.draft.prior_material = material;
        self.draft.touch();
    }
    pub fn clear_prior_material(&mut self) {
        self.replace_prior_material(PriorMaterial::default());
    }
    pub fn prepare_local_probes(&mut self) {
        let key = serde_json::to_string(&self.draft.answers).expect("answers serialize");
        if self.probes_answers_key.as_deref() == Some(&key) {
            return;
        }
        let answered: Vec<_> = self
            .draft
            .probes
            .iter()
            .filter(|probe| is_answered(probe))
            .cloned()
            .collect();
        self.draft.probes = merge_probes(
            answered.len().max(FORM_PROBE_COUNT),
            &[&answered, &local_form_probes(&self.draft.answers)],
        );
        self.probes_answers_key = Some(key);
        self.draft.touch();
    }
    pub fn answer_probe(&mut self, id: &str, answer: Option<ProbeAnswer>) -> Result<()> {
        let probe = self
            .draft
            .probes
            .iter_mut()
            .find(|probe| probe.id == id)
            .context("This Dossier question is no longer present.")?;
        validate_probe_answer(probe, answer.as_ref())?;
        if probe.answer != answer {
            probe.answer = answer;
            self.draft.touch();
        }
        Ok(())
    }
    pub fn add_reference(&mut self, now: u64) -> Result<()> {
        self.draft
            .attachments
            .push(self.draft.reference.attachment(now)?);
        self.draft.reference = ReferenceDraft::default();
        self.draft.touch();
        Ok(())
    }
    pub fn remove_reference(&mut self, id: &str) {
        self.draft
            .attachments
            .retain(|attachment| attachment.id != id);
        self.draft.touch();
    }
    pub fn persist_recovery(&mut self, now: u64) -> Result<()> {
        let result = self
            .options
            .recovery
            .as_ref()
            .map(|recovery| recovery.save(&self.draft, now))
            .transpose();
        match result {
            Ok(_) => {
                self.recovery_error = None;
                Ok(())
            }
            Err(error) => {
                self.recovery_error = Some(error.to_string());
                Err(error)
            }
        }
    }
    pub fn prepare_filing(&mut self, now: u64) -> Result<DossierSubmission> {
        ensure!(
            self.filing == FilingState::Idle,
            "The Dossier is already being filed or has been filed."
        );
        self.draft.validate()?;
        // A failed recovery write does not destroy the open form or forbid
        // filing the authoritative brief; the warning remains visible.
        let _ = self.persist_recovery(now);
        let previous = self.options.existing_brief.as_ref();
        let probes: Vec<_> = self
            .draft
            .probes
            .iter()
            .filter(|probe| probe.answer.is_some())
            .cloned()
            .collect();
        let brief = ProjectBrief {
            answers: normalized_answers(&self.draft.answers, &self.options.folio_name),
            attachments: self.draft.attachments.clone(),
            probes: (!probes.is_empty()).then_some(probes),
            completed_at: previous.map(|brief| brief.completed_at).unwrap_or(now),
            updated_at: now,
            extra: previous
                .map(|brief| brief.extra.clone())
                .unwrap_or_default(),
        };
        self.filing = FilingState::Filing;
        Ok(DossierSubmission {
            brief,
            prior_material: (self.options.mode == DossierMode::Create
                && self.draft.prior_material.has_material())
            .then(|| self.draft.prior_material.clone()),
            mode: self.options.mode,
        })
    }
    pub fn filing_failed(&mut self) {
        self.filing = FilingState::Idle;
    }
    pub fn acknowledge_filed(&mut self) -> Result<()> {
        ensure!(
            self.filing == FilingState::Filing,
            "This Dossier has not been submitted."
        );
        self.filing = FilingState::Filed;
        if let Some(recovery) = &self.options.recovery {
            recovery.clear()?;
        }
        Ok(())
    }
}

pub fn is_answered(probe: &DossierProbe) -> bool {
    match &probe.answer {
        Some(ProbeAnswer::Text(text)) => !trim(text).is_empty(),
        Some(ProbeAnswer::Texts(texts)) => texts.iter().any(|text| !trim(text).is_empty()),
        Some(ProbeAnswer::Number(number)) => number.is_finite(),
        None => false,
    }
}

pub fn split_template(template: &str) -> Vec<TemplatePiece> {
    let bytes = template.as_bytes();
    let mut pieces = Vec::new();
    let mut cursor = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'_' {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index] == b'_' {
            index += 1;
        }
        if index - start >= 3 {
            if cursor < start {
                pieces.push(TemplatePiece::Text(template[cursor..start].to_owned()));
            }
            pieces.push(TemplatePiece::Blank);
            cursor = index;
        }
    }
    if cursor < template.len() {
        pieces.push(TemplatePiece::Text(template[cursor..].to_owned()));
    }
    pieces
}

#[derive(Clone, Debug, PartialEq)]
pub enum TemplatePiece {
    Text(String),
    Blank,
}

pub fn validate_probe_answer(probe: &DossierProbe, answer: Option<&ProbeAnswer>) -> Result<()> {
    let Some(answer) = answer else {
        return Ok(());
    };
    match (probe.kind, answer) {
        (ProbeKind::Choice, ProbeAnswer::Text(text)) => ensure!(
            probe
                .options
                .as_ref()
                .is_some_and(|options| options.contains(text)),
            "Pick one of this question's options."
        ),
        (ProbeKind::Multi, ProbeAnswer::Texts(texts)) => ensure!(
            probe
                .options
                .as_ref()
                .is_some_and(|options| texts.iter().all(|text| options.contains(text))),
            "Pick from this question's options."
        ),
        (ProbeKind::Blanks, ProbeAnswer::Texts(texts)) => ensure!(
            probe.template.as_ref().is_some_and(|template| texts.len()
                == split_template(template)
                    .iter()
                    .filter(|piece| matches!(piece, TemplatePiece::Blank))
                    .count()),
            "Fill this question's blank slots."
        ),
        (ProbeKind::Scale, ProbeAnswer::Number(number)) => ensure!(
            number.is_finite()
                && *number >= probe.min.unwrap_or(1.0)
                && *number <= probe.max.unwrap_or(5.0),
            "Choose a value within this question's scale."
        ),
        _ => anyhow::bail!("This answer does not match the question's control."),
    }
    Ok(())
}

pub fn probe_answer_text(probe: &DossierProbe) -> String {
    if !is_answered(probe) {
        return String::new();
    }
    match &probe.answer {
        Some(ProbeAnswer::Texts(texts))
            if probe.kind == ProbeKind::Blanks && probe.template.is_some() =>
        {
            let mut answers = texts.iter();
            split_template(probe.template.as_ref().unwrap())
                .into_iter()
                .map(|piece| match piece {
                    TemplatePiece::Text(text) => text,
                    TemplatePiece::Blank => answers
                        .next()
                        .map(|text| trim(text))
                        .filter(|text| !text.is_empty())
                        .unwrap_or("___")
                        .to_owned(),
                })
                .collect()
        }
        Some(ProbeAnswer::Texts(texts)) => texts
            .iter()
            .filter(|text| !text.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(", "),
        Some(ProbeAnswer::Text(text)) => text.clone(),
        Some(ProbeAnswer::Number(number)) => {
            let ends = match (&probe.min_label, &probe.max_label) {
                (Some(min), Some(max)) if !min.is_empty() && !max.is_empty() => format!(
                    " ({}={min}, {}={max})",
                    probe.min.unwrap_or(1.0),
                    probe.max.unwrap_or(5.0)
                ),
                _ => String::new(),
            };
            format!("{number} of {}{ends}", probe.max.unwrap_or(5.0))
        }
        None => String::new(),
    }
}

fn compact(value: &str, fallback: &str, max: usize) -> String {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = if value.is_empty() { fallback } else { &value };
    if value.encode_utf16().count() <= max {
        value.to_owned()
    } else {
        format!("{}…", trim(&truncate_utf16(value, max - 1).0))
    }
}

pub fn local_form_probes(answers: &ProjectInterviewAnswers) -> Vec<DossierProbe> {
    let title = compact(&answers.working_title, "this piece", 54);
    let audience = compact(&answers.audience, "the intended reader", 68);
    let goal = compact(&answers.goal, "the central goal", 68);
    let tone = compact(&answers.tone, "the intended voice", 62);
    let constraints = compact(&answers.constraints, "the promise the draft must keep", 68);
    let base = |id: &str, kind, prompt, relates_to| DossierProbe {
        id: id.into(),
        kind,
        prompt,
        options: None,
        template: None,
        min: None,
        max: None,
        min_label: None,
        max_label: None,
        answer: None,
        relates_to: Some(relates_to),
        extra: ExtraFields::new(),
    };
    let mut reader = base(
        "local-particular-reader-change",
        ProbeKind::Blanks,
        format!("For {audience}, what should change by the end of “{title}”?"),
        BriefField::SuccessSignal,
    );
    reader.template = Some("They begin ___ and leave ___".into());
    let mut goal = base(
        "local-particular-goal",
        ProbeKind::Choice,
        format!("Which result matters most for this goal: {goal}?"),
        BriefField::Goal,
    );
    goal.options = Some(
        [
            "Understand the central idea",
            "Change a belief",
            "Take a specific action",
            "Feel the stakes",
        ]
        .map(str::to_owned)
        .to_vec(),
    );
    let mut protection = base(
        "local-particular-protection",
        ProbeKind::Scale,
        format!("How firmly should the room protect “{tone}” while honoring {constraints}?"),
        BriefField::Tone,
    );
    protection.min = Some(1.0);
    protection.max = Some(5.0);
    protection.min_label = Some("Flexible".into());
    protection.max_label = Some("Non-negotiable".into());
    vec![reader, goal, protection]
}

pub fn merge_probes(limit: usize, groups: &[&[DossierProbe]]) -> Vec<DossierProbe> {
    let identity = |probe: &DossierProbe| {
        probe
            .prompt
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let mut merged: Vec<DossierProbe> = Vec::new();
    for probe in groups.iter().flat_map(|group| group.iter()) {
        let index = merged
            .iter()
            .position(|existing| existing.id == probe.id || identity(existing) == identity(probe));
        if let Some(index) = index {
            if !is_answered(&merged[index]) && is_answered(probe) {
                merged[index] = probe.clone();
            }
        } else if merged.len() < limit {
            merged.push(probe.clone());
        }
    }
    merged
}

/// An upload retains raw bytes and markup/source provenance. This function is
/// deliberately not an HTML, Markdown, or Typst converter.
pub fn read_prior_material(path: &Path) -> Result<PriorMaterial> {
    let metadata = fs::metadata(path).context("Could not open the prior material.")?;
    ensure!(
        metadata.len() <= MAX_RECOVERY_BYTES,
        "The prior material exceeds the 64 MB import limit."
    );
    let bytes = fs::read(path).context("Could not read the prior material.")?;
    let text = std::str::from_utf8(&bytes)
        .context("The prior material is not valid UTF-8.")?
        .to_owned();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported material")
        .to_owned();
    let lower = file_name.to_lowercase();
    let mut material = PriorMaterial {
        text: text.clone(),
        provenance: Some(ImportProvenance {
            file_name,
            original_bytes: bytes.clone(),
            extra: ExtraFields::new(),
        }),
        ..PriorMaterial::default()
    };
    if lower.ends_with(".typ") {
        material.typst_source = Some(text);
    } else if lower.ends_with(".twyne.json") {
        let backup = crate::exchange::parse_backup(&bytes)?;
        material.typst_source = backup.content.typst_source.clone();
        material.html = backup.content.html.clone();
        material.text = material
            .typst_source
            .as_ref()
            .or(material.html.as_ref())
            .cloned()
            .unwrap_or_default();
        material
            .extra
            .insert("twyneBackup".into(), serde_json::to_value(backup)?);
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        material.html = Some(text);
    }
    Ok(material)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn session(directory: &Path, owner: Option<&str>, folio: &str, now: u64) -> DossierSession {
        DossierSession::open(
            DossierOptions {
                folio_id: Some(folio.into()),
                owner: owner.map(str::to_owned),
                ..DossierOptions::default()
            }
            .with_recovery_directory(directory),
            now,
        )
        .unwrap()
    }
    fn old_brief() -> ProjectBrief {
        ProjectBrief {
            answers: default_answers(),
            attachments: Vec::new(),
            probes: None,
            completed_at: 100,
            updated_at: 200,
            extra: ExtraFields::from([("futureBrief".into(), json!({"preserve":true}))]),
        }
    }

    #[test]
    fn defaults_local_questions_and_filing_match_actual_web_generated_contract() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/dossier/web-contract.json")).unwrap();
        assert_eq!(
            serde_json::to_value(default_answers()).unwrap(),
            fixture["defaults"]
        );
        assert_eq!(
            local_form_probes(&default_answers()),
            serde_json::from_value::<Vec<DossierProbe>>(fixture["localProbes"].clone()).unwrap()
        );
        let now = fixture["now"].as_u64().unwrap();
        let mut create = DossierSession::open(
            DossierOptions {
                folio_name: fixture["folioName"].as_str().unwrap().into(),
                ..DossierOptions::default()
            },
            now,
        )
        .unwrap();
        create.draft.answers = serde_json::from_value(fixture["rawAnswers"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(create.prepare_filing(now).unwrap().brief).unwrap(),
            fixture["creation"]
        );
        let mut previous = old_brief();
        previous.completed_at = 42;
        previous.updated_at = 43;
        previous.extra.clear();
        let mut refine = DossierSession::open(
            DossierOptions {
                mode: DossierMode::Refine,
                existing_brief: Some(previous),
                ..DossierOptions::default()
            },
            now,
        )
        .unwrap();
        refine.go_to(7).unwrap();
        refine
            .answer_probe(
                "local-particular-goal",
                Some(ProbeAnswer::Text("Change a belief".into())),
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(refine.prepare_filing(now).unwrap().brief).unwrap(),
            fixture["refinement"]
        );
    }

    #[test]
    fn recoverable_form_preserves_empty_edits_navigation_material_and_unadded_reference() {
        let directory = tempdir().unwrap();
        let mut form = session(directory.path(), Some("alice"), "folio-a", 1_000);
        form.edit_answer(BriefField::Goal, String::new());
        form.replace_prior_material(PriorMaterial {
            text: "Manuscript & marks".into(),
            html: Some("<p>Manuscript &amp; <em>marks</em></p>".into()),
            typst_source: Some("#let unknown(x) = x\r\n".into()),
            carried_from_manuscript: true,
            ..PriorMaterial::default()
        });
        form.draft.reference.title = "Unadded reference".into();
        form.draft.reference.why = "Do not lose me".into();
        form.go_to(9).unwrap();
        form.persist_recovery(1_001).unwrap();
        let restored = session(directory.path(), Some("alice"), "folio-a", 1_002);
        assert!(restored.restored);
        assert_eq!(restored.draft, form.draft);
        assert_eq!(restored.draft.answers.goal, "");
        assert_eq!(
            restored.draft.prior_material.original_source(),
            Some("#let unknown(x) = x\r\n")
        );
    }

    #[test]
    fn recovery_isolated_by_account_folio_mode_and_canonical_brief_base() {
        let directory = tempdir().unwrap();
        let mut form = session(directory.path(), Some("alice"), "a", 1_000);
        form.edit_answer(BriefField::Goal, "Private answer".into());
        form.persist_recovery(1_000).unwrap();
        for (owner, folio) in [(None, "a"), (Some("bob"), "a"), (Some("alice"), "b")] {
            assert!(!session(directory.path(), owner, folio, 1_001).restored);
        }
        let refine = DossierSession::open(
            DossierOptions {
                mode: DossierMode::Refine,
                existing_brief: Some(old_brief()),
                folio_id: Some("a".into()),
                owner: Some("alice".into()),
                ..DossierOptions::default()
            }
            .with_recovery_directory(directory.path()),
            1_001,
        )
        .unwrap();
        assert!(!refine.restored);
        let mut same = form.options.clone();
        same.existing_brief = Some(old_brief());
        same = same.with_recovery_directory(directory.path());
        assert!(!DossierSession::open(same, 1_001).unwrap().restored);
    }

    #[test]
    fn expired_future_and_corrupt_recovery_are_not_installed_or_deleted() {
        let directory = tempdir().unwrap();
        let mut form = session(directory.path(), None, "a", 1_000);
        form.persist_recovery(1_000).unwrap();
        assert!(!session(directory.path(), None, "a", 999).restored);
        assert!(!session(directory.path(), None, "a", 1_000 + RECOVERY_MAX_AGE_MS + 1).restored);
        let path = form.options.recovery.as_ref().unwrap().path();
        fs::write(&path, b"corrupt but retained").unwrap();
        let recovered = session(directory.path(), None, "a", 1_001);
        assert!(!recovered.restored);
        assert!(recovered.recovery_error.is_some());
        assert_eq!(fs::read(path).unwrap(), b"corrupt but retained");
    }

    #[test]
    fn unchanged_flush_preserves_revision_and_late_save_cannot_replace_newer_answers() {
        let directory = tempdir().unwrap();
        let mut form = session(directory.path(), None, "a", 1_000);
        let recovery = form.options.recovery.clone().unwrap();
        let first = recovery.save(&form.draft, 1_000).unwrap();
        let old = form.draft.clone();
        assert_eq!(
            recovery.save(&form.draft, 1_001).unwrap().revision,
            first.revision
        );
        form.edit_answer(BriefField::Goal, "Newer".into());
        recovery.save(&form.draft, 1_002).unwrap();
        recovery.save(&old, 1_003).unwrap();
        assert_eq!(recovery.load(1_004).unwrap().unwrap().answers.goal, "Newer");
    }

    #[test]
    fn retired_writer_cannot_replace_or_clear_a_reopened_same_scope_copy() {
        let directory = tempdir().unwrap();
        let mut old = session(directory.path(), None, "a", 1_000);
        old.edit_answer(BriefField::WorkingTitle, "Before reopening".into());
        old.persist_recovery(1_000).unwrap();
        let retired = old.options.recovery.clone().unwrap();
        retired.retire().unwrap();
        let mut reopened = session(directory.path(), None, "a", 1_001);
        assert!(reopened.restored);
        assert_eq!(reopened.draft, old.draft);
        reopened.edit_answer(BriefField::WorkingTitle, "Reopened final é".into());
        reopened.persist_recovery(1_002).unwrap();
        let bytes = fs::read(retired.path()).unwrap();
        // A late import can have a greater generation than the new form. The
        // retirement guard must reject it before inspecting or mutating disk.
        old.draft.generation = reopened.draft.generation + 100;
        old.draft.answers.working_title = "Late import must stay out".into();
        assert!(retired.save(&old.draft, 1_003).is_err());
        retired.clear().unwrap();
        retired.retire().unwrap();
        assert_eq!(fs::read(retired.path()).unwrap(), bytes);
        assert_eq!(
            reopened
                .options
                .recovery
                .as_ref()
                .unwrap()
                .load(1_004)
                .unwrap(),
            Some(reopened.draft)
        );
    }

    #[test]
    fn a_late_older_edition_cannot_replace_or_clear_newer_edition_recovery() {
        let directory = tempdir().unwrap();
        let mut older = session(directory.path(), Some("alice"), "a", 1_000);
        older.persist_recovery(1_000).unwrap();
        let older_recovery = older.options.recovery.clone().unwrap();
        let mut options = older.options.clone();
        options.existing_brief = Some(old_brief());
        let mut newer =
            DossierSession::open(options.with_recovery_directory(directory.path()), 1_001).unwrap();
        newer.edit_answer(BriefField::Goal, "The newer edition".into());
        newer.persist_recovery(1_001).unwrap();
        older.edit_answer(BriefField::Goal, "Old form still open".into());
        older_recovery.save(&older.draft, 1_002).unwrap();
        older_recovery.clear().unwrap();
        assert_eq!(
            newer
                .options
                .recovery
                .as_ref()
                .unwrap()
                .load(1_003)
                .unwrap()
                .unwrap()
                .answers
                .goal,
            "The newer edition"
        );
        assert!(older_recovery.save(&older.draft, 1_004).is_err());
        assert!(!older_recovery.path().exists());
    }

    #[test]
    fn filing_failure_keeps_recovery_and_acknowledged_save_clears_only_its_scope() {
        let directory = tempdir().unwrap();
        let mut form = session(directory.path(), None, "a", 1_000);
        let mut other = session(directory.path(), None, "b", 1_000);
        other.persist_recovery(1_000).unwrap();
        form.edit_answer(BriefField::WorkingTitle, "My draft".into());
        form.prepare_filing(1_001).unwrap();
        assert!(form.prepare_filing(1_001).is_err());
        form.filing_failed();
        assert!(session(directory.path(), None, "a", 1_002).restored);
        form.prepare_filing(1_003).unwrap();
        let delayed_writer = form.options.recovery.clone().unwrap();
        let delayed_draft = form.draft.clone();
        form.acknowledge_filed().unwrap();
        assert!(delayed_writer.save(&delayed_draft, 1_004).is_err());
        assert!(!session(directory.path(), None, "a", 1_004).restored);
        assert!(session(directory.path(), None, "b", 1_004).restored);
    }

    #[test]
    fn refinement_preserves_completion_unknown_context_and_source_material_without_seeding() {
        let mut form = DossierSession::open(
            DossierOptions {
                mode: DossierMode::Refine,
                existing_brief: Some(old_brief()),
                initial_material: PriorMaterial::pasted("Existing manuscript"),
                ..DossierOptions::default()
            },
            500,
        )
        .unwrap();
        form.edit_answer(BriefField::Tone, "  Plain and precise  ".into());
        let filed = form.prepare_filing(501).unwrap();
        assert_eq!(filed.brief.completed_at, 100);
        assert_eq!(filed.brief.updated_at, 501);
        assert_eq!(filed.brief.answers.tone, "Plain and precise");
        assert_eq!(filed.brief.extra["futureBrief"]["preserve"], true);
        assert_eq!(filed.brief.probes, None);
        assert!(filed.seed_for_empty_manuscript(true).is_none());
        assert_eq!(form.draft.prior_material.text, "Existing manuscript");
    }

    #[test]
    fn filing_normalizes_prose_without_making_blank_sections_a_gate() {
        let mut form = DossierSession::open(
            DossierOptions {
                folio_name: "Named folio".into(),
                ..DossierOptions::default()
            },
            1,
        )
        .unwrap();
        for field in ANSWER_FIELDS {
            form.edit_answer(field, " \n\u{feff}".into());
        }
        form.go_to(9).unwrap();
        let filed = form.prepare_filing(2).unwrap();
        let mut expected = default_answers();
        expected.working_title = "Named folio".into();
        assert_eq!(filed.brief.answers, expected);
        assert_eq!(filed.brief.completed_at, 2);
        assert!(filed.brief.probes.is_none());
    }

    #[test]
    fn prior_material_only_seeds_empty_creation_and_original_source_survives_edits() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("existing.typ");
        let bytes = b"#let custom(x) = x * 2\r\n\r\n= Exact source\r\n";
        fs::write(&path, bytes).unwrap();
        let material = read_prior_material(&path).unwrap();
        assert_eq!(material.provenance.as_ref().unwrap().original_bytes, bytes);
        let mut form = DossierSession::open(
            DossierOptions {
                initial_material: material,
                ..DossierOptions::default()
            },
            1,
        )
        .unwrap();
        form.edit_prior_material("Writer's new words".into());
        let filed = form.prepare_filing(2).unwrap();
        assert!(filed.seed_for_empty_manuscript(false).is_none());
        let seed = filed.seed_for_empty_manuscript(true).unwrap();
        assert!(seed.edited);
        assert!(seed.canonical_seed_source().is_none());
        assert_eq!(seed.original_source().unwrap().as_bytes(), bytes);
    }

    #[test]
    fn local_particulars_retain_answered_questions_when_the_brief_changes() {
        let mut form = DossierSession::open(DossierOptions::default(), 1).unwrap();
        form.go_to(7).unwrap();
        assert_eq!(form.draft.probes.len(), 3);
        form.answer_probe(
            "local-particular-goal",
            Some(ProbeAnswer::Text("Change a belief".into())),
        )
        .unwrap();
        let prompt = form
            .draft
            .probes
            .iter()
            .find(|probe| probe.id == "local-particular-goal")
            .unwrap()
            .prompt
            .clone();
        form.edit_answer(BriefField::Goal, "A different goal".into());
        form.go_to(7).unwrap();
        let carried = form
            .draft
            .probes
            .iter()
            .find(|probe| probe.id == "local-particular-goal")
            .unwrap();
        assert_eq!(carried.prompt, prompt);
        assert_eq!(
            carried.answer,
            Some(ProbeAnswer::Text("Change a belief".into()))
        );
        assert!(
            form.draft
                .probes
                .iter()
                .any(|probe| probe.prompt.contains("How firmly"))
        );
        assert_eq!(form.draft.probes.len(), 3);
    }

    #[test]
    fn probes_validate_their_control_and_filing_omits_unanswered_questions() {
        let mut form = DossierSession::open(DossierOptions::default(), 1).unwrap();
        form.go_to(7).unwrap();
        assert!(
            form.answer_probe("local-particular-goal", Some(ProbeAnswer::Number(3.0)))
                .is_err()
        );
        assert!(
            form.answer_probe(
                "local-particular-protection",
                Some(ProbeAnswer::Number(9.0))
            )
            .is_err()
        );
        form.answer_probe(
            "local-particular-reader-change",
            Some(ProbeAnswer::Texts(vec!["unsure".into(), "ready".into()])),
        )
        .unwrap();
        let filed = form.prepare_filing(2).unwrap();
        let probes = filed.brief.probes.unwrap();
        assert_eq!(probes.len(), 1);
        assert_eq!(
            probe_answer_text(&probes[0]),
            "They begin unsure and leave ready"
        );
    }

    #[test]
    fn references_require_their_reason_and_limit_document_excerpt_without_breaking_unicode() {
        let mut reference = ReferenceDraft {
            title: "  Source  ".into(),
            ..ReferenceDraft::default()
        };
        reference.import_text(&"🧵".repeat(1_200), "notes.txt");
        assert!(reference.truncated);
        assert_eq!(reference.text.encode_utf16().count(), 2_000);
        assert!(reference.attachment(1).is_err());
        reference.why = "  Keep this evidence  ".into();
        let attachment = reference.attachment(2).unwrap();
        assert_eq!(attachment.title, "Source");
        assert_eq!(attachment.why, "Keep this evidence");
        assert_eq!(attachment.text.unwrap().encode_utf16().count(), 2_000);
        reference.kind = AttachmentKind::Link;
        assert!(!reference.can_add());
        reference.url = " https://example.com/source ".into();
        let attachment = reference.attachment(3).unwrap();
        assert_eq!(
            attachment.url.as_deref(),
            Some("https://example.com/source")
        );
        assert!(attachment.text.is_none());
    }

    #[test]
    fn guest_handoff_is_explicit_revision_guarded_and_cannot_replace_newer_account_work() {
        let directory = tempdir().unwrap();
        let mut guest = session(directory.path(), None, "a", 1_000);
        guest.edit_answer(BriefField::Goal, "Guest".into());
        guest.persist_recovery(1_000).unwrap();
        let recovery = guest.options.recovery.clone().unwrap();
        let handoff = recovery.prepare_handoff(1_001).unwrap().unwrap();
        let mut account = session(directory.path(), Some("alice"), "a", 1_001);
        account.edit_answer(BriefField::Goal, "Account".into());
        account.persist_recovery(1_001).unwrap();
        assert!(
            recovery
                .claim_handoff(&handoff, "alice".into(), 1_002)
                .unwrap()
        );
        assert_eq!(
            session(directory.path(), Some("alice"), "a", 1_003)
                .draft
                .answers
                .goal,
            "Account"
        );
        assert!(!session(directory.path(), None, "a", 1_003).restored);
        let mut guest = session(directory.path(), None, "a", 1_004);
        guest.persist_recovery(1_004).unwrap();
        let recovery = guest.options.recovery.clone().unwrap();
        let stale = recovery.prepare_handoff(1_004).unwrap().unwrap();
        guest.edit_answer(BriefField::Goal, "New guest".into());
        guest.persist_recovery(1_005).unwrap();
        assert!(!recovery.claim_handoff(&stale, "bob".into(), 1_006).unwrap());
        assert!(!session(directory.path(), Some("bob"), "a", 1_006).restored);
    }

    #[test]
    fn failed_first_filing_can_move_recovery_to_its_allocated_folio() {
        let directory = tempdir().unwrap();
        let mut form = session(directory.path(), None, "new", 1_000);
        form.edit_answer(BriefField::Goal, "Keep across retry".into());
        form.persist_recovery(1_000).unwrap();
        let next = form
            .options
            .recovery
            .as_ref()
            .unwrap()
            .move_scope("create:allocated".into(), 1_001)
            .unwrap();
        assert_eq!(
            next.load(1_002).unwrap().unwrap().answers.goal,
            "Keep across retry"
        );
        assert!(
            form.options
                .recovery
                .as_ref()
                .unwrap()
                .load(1_002)
                .unwrap()
                .is_none()
        );
    }
}
