//! Conversational interview session state machine.
//!
//! Manages turn progression, monotonic request generations to guard against
//! provider races, pending text preservation for error recovery, active probe
//! interactions, synthesis review, and author-governed filing transitions.

use crate::{
    dossier::{
        DossierDraft, DossierMode, DossierSubmission, FilingState, PriorMaterial,
        normalized_answers,
    },
    dossier_conversation::{
        amendment::BriefHistory,
        gathering::{GatheringState, count_filled_fields},
        protocol::{
            BriefField, FieldConfidenceMap, InterviewConfidence, InterviewDossierDraft,
            InterviewMessage, InterviewTurnResult, OPENING_QUESTION, PartialAnswers,
            REFINE_OPENING_QUESTION, SYNTHESIZE_NUDGE,
        },
    },
    house::LedgerSource,
    workspace::{DossierAttachment, ProbeAnswer, ProjectBrief, ProjectInterviewAnswers},
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationMode {
    #[default]
    Create,
    Refine,
}

impl From<DossierMode> for ConversationMode {
    fn from(mode: DossierMode) -> Self {
        match mode {
            DossierMode::Create => Self::Create,
            DossierMode::Refine => Self::Refine,
        }
    }
}

impl From<ConversationMode> for DossierMode {
    fn from(mode: ConversationMode) -> Self {
        match mode {
            ConversationMode::Create => Self::Create,
            ConversationMode::Refine => Self::Refine,
        }
    }
}

impl ConversationMode {
    /// Provider wire mode differs from the native filing mode.
    pub const fn provider_mode(self) -> &'static str {
        match self {
            Self::Create => "first-run",
            Self::Refine => "refine",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Synthesis {
    pub brief: ProjectInterviewAnswers,
    pub confidence: FieldConfidenceMap,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationOptions {
    pub mode: ConversationMode,
    pub folio_id: Option<String>,
    pub folio_name: String,
    pub owner: Option<String>,
    pub existing_brief: Option<ProjectBrief>,
    pub initial_material: PriorMaterial,
    pub initial_attachments: Vec<DossierAttachment>,
}

impl Default for ConversationOptions {
    fn default() -> Self {
        Self {
            mode: ConversationMode::Create,
            folio_id: None,
            folio_name: String::new(),
            owner: None,
            existing_brief: None,
            initial_material: PriorMaterial::default(),
            initial_attachments: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConversationSession {
    pub options: ConversationOptions,
    pub messages: Vec<InterviewMessage>,
    pub live_draft: Option<InterviewDossierDraft>,
    pub synthesis: Option<Synthesis>,
    pub editing_field: Option<BriefField>,
    pub draft_input: String,
    pub loading: bool,
    pub error: Option<String>,
    pub pending_writer_text: Option<String>,
    pub request_version: u64,
    pub active_request: Option<u64>,
    pub gathering: GatheringState,
    pub filing_state: FilingState,
    pub history: BriefHistory,
    // Hydration happens at a surface/recovery boundary. Retain its form-only
    // metadata and answer extensions instead of mixing them with brief extras.
    pub(super) handoff_draft: Option<DossierDraft>,
    pending_filing: Option<PendingFiling>,
}

#[derive(Clone, Debug, PartialEq)]
struct PendingFiling {
    token: u64,
    brief: ProjectBrief,
    previous: Option<ProjectBrief>,
    prior_material: Option<PriorMaterial>,
    mode: ConversationMode,
}

impl ConversationSession {
    pub fn new(options: ConversationOptions) -> Self {
        // An absent scope is not an alias for a folio named "new". The host
        // binds newly created folios before committing a submission.
        let history = BriefHistory::new(options.folio_id.clone().unwrap_or_default());

        let mut gathering = GatheringState::new(
            options.initial_material.clone(),
            options.initial_attachments.clone(),
        );

        // Refining an existing dossier retains the probe answers the writer
        // already gave; the Source seeds `answeredProbes` from the brief.
        if let Some(existing) = &options.existing_brief
            && let Some(probes) = &existing.probes
        {
            gathering.answered_probes = probes.clone();
        }

        let live_draft = options
            .existing_brief
            .as_ref()
            .map(|b| InterviewDossierDraft {
                brief: partial_answers(&b.answers),
                confidence: FieldConfidenceMap::new(),
            });

        Self {
            options,
            messages: Vec::new(),
            live_draft,
            synthesis: None,
            editing_field: None,
            draft_input: String::new(),
            loading: false,
            error: None,
            pending_writer_text: None,
            request_version: 0,
            active_request: None,
            gathering,
            filing_state: FilingState::Idle,
            history,
            handoff_draft: None,
            pending_filing: None,
        }
    }

    /// Initializes the conversation with the canonical opening question.
    pub fn start(&mut self) {
        if !self.messages.is_empty() {
            return;
        }
        let opening = match self.options.mode {
            ConversationMode::Create => OPENING_QUESTION,
            ConversationMode::Refine => REFINE_OPENING_QUESTION,
        };
        self.messages
            .push(InterviewMessage::interviewer(opening, None));
    }

    /// Submits a writer message into the conversation thread.
    /// Retires any active probe and begins a new request generation.
    pub fn send_writer_text(&mut self, text: impl Into<String>) -> Result<u64> {
        self.ensure_turn_available()?;
        let raw = text.into();
        let trimmed = js_trim(&raw).to_string();
        ensure!(!trimmed.is_empty(), "Cannot send empty message.");
        let token = self.begin_generation()?;

        // Typing free text supersedes any active probe
        self.gathering.skip_active_probe();

        self.messages
            .push(InterviewMessage::writer(trimmed.clone()));
        self.pending_writer_text = Some(trimmed);
        Ok(token)
    }

    /// Begins a new in-flight request generation, marking it as the only
    /// generation whose provider response may still be accepted.
    fn begin_generation(&mut self) -> Result<u64> {
        let token = self.request_version.checked_add(1).ok_or_else(|| {
            anyhow::anyhow!("This interview has exhausted its request generations.")
        })?;
        self.loading = true;
        self.error = None;
        self.request_version = token;
        self.active_request = Some(token);
        Ok(token)
    }

    fn ensure_turn_available(&self) -> Result<()> {
        ensure!(
            self.filing_state == FilingState::Idle,
            "This dossier is filing or already filed."
        );
        ensure!(!self.loading, "A turn is already in flight.");
        ensure!(
            self.synthesis.is_none(),
            "Review the synthesis or choose Keep talking first."
        );
        Ok(())
    }

    /// Retires any in-flight generation so late provider responses are rejected.
    /// Mirrors Source `handleUseCurrent` (`requestVersion += 1`).
    pub fn retire_inflight(&mut self) {
        self.active_request = None;
        self.loading = false;
        self.request_version = self.request_version.saturating_add(1);
    }

    /// Processes a completed interview turn from an AI provider.
    /// Accepts only the generation token that is currently in flight, so stale
    /// or duplicate responses are dropped; token zero is never in flight.
    pub fn receive_turn_result(
        &mut self,
        token: u64,
        result: Result<InterviewTurnResult, String>,
    ) -> Result<bool> {
        if self.active_request != Some(token) {
            // Outdated, duplicate, or never-in-flight turn dropped cleanly
            return Ok(false);
        }

        self.active_request = None;
        self.loading = false;
        match result {
            Ok(turn) => {
                self.error = None;
                self.pending_writer_text = None;
                match turn {
                    InterviewTurnResult::Question {
                        text, draft, probe, ..
                    } => {
                        if let Some(new_draft) = draft {
                            if let Some(current) = self.live_draft.as_mut() {
                                current.merge(&new_draft);
                            } else {
                                self.live_draft = Some(new_draft);
                            }
                        }
                        self.messages
                            .push(InterviewMessage::interviewer(text, None));
                        self.gathering.active_probe = probe.map(|probe| *probe);
                    }
                    InterviewTurnResult::Synthesis {
                        brief, confidence, ..
                    } => {
                        let mut final_brief = brief;
                        if let Some(existing) = &self.options.existing_brief {
                            for field in crate::dossier_conversation::protocol::BRIEF_FIELDS {
                                // Source uses JS string truthiness here: a
                                // whitespace-only string is still supplied.
                                if crate::dossier::answer(&final_brief, field).is_empty() {
                                    crate::dossier::set_answer(
                                        &mut final_brief,
                                        field,
                                        crate::dossier::answer(&existing.answers, field)
                                            .to_string(),
                                    );
                                }
                            }
                            for (key, value) in &existing.answers.extra {
                                final_brief
                                    .extra
                                    .entry(key.clone())
                                    .or_insert_with(|| value.clone());
                            }
                        }

                        let synth = Synthesis {
                            brief: final_brief.clone(),
                            confidence: confidence.clone(),
                        };
                        self.synthesis = Some(synth);

                        // Also reflect in live draft
                        self.live_draft = Some(InterviewDossierDraft {
                            brief: partial_answers(&final_brief),
                            confidence,
                        });
                    }
                }
                Ok(true)
            }
            Err(err) => {
                self.error = Some(err);
                // Keep pending_writer_text intact so retry_turn can resend
                Ok(false)
            }
        }
    }

    /// Answers the currently active probe, storing the structured answer in
    /// the gathering state, and feeding the readable answer into the transcript.
    pub fn answer_probe(&mut self, answer: ProbeAnswer) -> Result<u64> {
        self.ensure_turn_available()?;
        let mut answered = self
            .gathering
            .active_probe
            .clone()
            .ok_or_else(|| anyhow::anyhow!("No active probe to answer."))?;
        crate::dossier::validate_probe_answer(&answered, Some(&answer))?;
        answered.answer = Some(answer);
        let readable_text = crate::dossier::probe_answer_text(&answered);
        let token = self.send_writer_text(readable_text)?;
        crate::dossier_conversation::gathering::upsert_probe(
            &mut self.gathering.answered_probes,
            answered,
        );
        Ok(token)
    }

    pub fn skip_probe(&mut self) {
        if self.ensure_turn_available().is_ok() {
            self.gathering.skip_active_probe();
        }
    }

    /// Retries the last failed turn using the preserved writer input.
    pub fn retry_turn(&mut self) -> Result<u64> {
        self.ensure_turn_available()?;
        let pending = self
            .pending_writer_text
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("No pending writer message to retry."))?;
        ensure!(!pending.is_empty(), "No pending writer message to retry.");
        self.begin_generation()
    }

    /// Explicitly prompts the model to produce a synthesis of the dossier.
    ///
    /// Matches Source `requestSynthesis`, which runs a turn with the nudge but
    /// does not append it as a writer message in the transcript.
    pub fn request_synthesis(&mut self) -> Result<u64> {
        self.ensure_turn_available()?;
        let token = self.begin_generation()?;
        self.pending_writer_text = Some(SYNTHESIZE_NUDGE.to_string());
        Ok(token)
    }

    /// Begins inline editing of a synthesized brief field.
    pub fn start_editing_field(&mut self, field: BriefField) -> Result<()> {
        ensure!(
            self.filing_state == FilingState::Idle,
            "This dossier is filing or already filed."
        );
        let synth = self
            .synthesis
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Cannot edit field before synthesis is ready."))?;
        self.editing_field = Some(field);
        self.draft_input = crate::dossier::answer(&synth.brief, field).to_string();
        Ok(())
    }

    /// Saves the writer's manual edit to a synthesized brief field, marking
    /// confidence as High to indicate explicit human authorship.
    pub fn save_edited_field(&mut self, field: BriefField, value: String) -> Result<()> {
        ensure!(
            self.filing_state == FilingState::Idle,
            "This dossier is filing or already filed."
        );
        ensure!(!self.loading, "A turn is already in flight.");
        ensure!(
            self.editing_field == Some(field),
            "This is not the field being edited."
        );
        let value = js_trim(&value);
        ensure!(!value.is_empty(), "A reviewed field cannot be empty.");
        let next_generation = self.request_version.checked_add(1).ok_or_else(|| {
            anyhow::anyhow!("This interview has exhausted its request generations.")
        })?;
        let synth = self
            .synthesis
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Cannot save field edit before synthesis is ready."))?;
        crate::dossier::set_answer(&mut synth.brief, field, value.to_string());
        synth.confidence.insert(field, InterviewConfidence::High);
        self.request_version = next_generation;
        self.editing_field = None;
        self.draft_input.clear();
        Ok(())
    }

    /// Dismisses the synthesis and allows the author to continue conversing.
    pub fn dismiss_synthesis(&mut self) {
        if self.filing_state != FilingState::Idle {
            return;
        }
        self.synthesis = None;
        self.editing_field = None;
        self.draft_input.clear();
    }

    /// Prepares authoritative filing for the completed dossier.
    ///
    /// The returned `DossierSubmission` is a request to file, not an
    /// acknowledgement: `filing_state` becomes `Filing` and callers must call
    /// `acknowledge_filed` only after the durable save succeeds. Any in-flight
    /// generation is retired so a late provider response cannot overwrite the
    /// filed brief.
    pub fn prepare_filing(&mut self, now: u64) -> Result<DossierSubmission> {
        ensure!(
            self.filing_state == FilingState::Idle,
            "Dossier is already filing or filed."
        );
        ensure!(!self.loading, "A turn is already in flight.");
        ensure!(
            self.options.mode != ConversationMode::Refine
                || (self.options.existing_brief.is_some()
                    && self
                        .options
                        .folio_id
                        .as_deref()
                        .is_some_and(|id| !id.is_empty())),
            "Refining a dossier requires its existing brief and exact folio scope."
        );
        let synth = self
            .synthesis
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Review a synthesis before filing the conversation."))?;
        let mut normalized = normalized_answers(&synth.brief, &self.options.folio_name);
        if let Some(draft) = &self.handoff_draft {
            for (key, value) in &draft.answers.extra {
                normalized
                    .extra
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
        }
        let token = self.request_version.checked_add(1).ok_or_else(|| {
            anyhow::anyhow!("This interview has exhausted its request generations.")
        })?;

        let probes = (!self.gathering.answered_probes.is_empty())
            .then(|| self.gathering.answered_probes.clone());

        let previous = self.options.existing_brief.as_ref();
        let completed_at = previous.map_or(now, |b| b.completed_at);

        let brief = ProjectBrief {
            answers: normalized,
            attachments: self.gathering.attachments.clone(),
            completed_at,
            updated_at: now,
            probes,
            extra: previous.map_or_else(Default::default, |b| b.extra.clone()),
        };

        let prior_material = (self.options.mode == ConversationMode::Create
            && self.gathering.prior_material.has_material())
        .then(|| self.gathering.prior_material.clone());

        self.pending_filing = Some(PendingFiling {
            token,
            brief: brief.clone(),
            previous: previous.cloned(),
            prior_material: prior_material.clone(),
            mode: self.options.mode,
        });
        self.retire_inflight();
        self.filing_state = FilingState::Filing;

        Ok(DossierSubmission {
            brief,
            prior_material,
            mode: self.options.mode.into(),
        })
    }

    pub fn filing_token(&self) -> Option<u64> {
        if self.filing_state == FilingState::Filing {
            self.pending_filing.as_ref().map(|pending| pending.token)
        } else {
            None
        }
    }

    /// The host must qualify the owning entity/folio/base revision as well as
    /// this full immutable submission before any durable save or recovery clear.
    pub fn filing_matches(&self, token: u64, submission: &DossierSubmission) -> bool {
        self.filing_token() == Some(token)
            && self.pending_filing.as_ref().is_some_and(|pending| {
                pending.brief == submission.brief
                    && pending.prior_material == submission.prior_material
                    && DossierMode::from(pending.mode) == submission.mode
            })
    }

    /// Apply an explicit successful durable ACK. No recovery file is cleared
    /// here; stale/duplicate ACKs return false without changing any state.
    pub fn acknowledge_filed(&mut self, token: u64) -> Result<bool> {
        if self.filing_token() != Some(token) {
            return Ok(false);
        }
        let pending = self.pending_filing.take().expect("matching filing token");
        if let Some(previous) = &pending.previous
            && previous != &pending.brief
        {
            let source = match pending.mode {
                ConversationMode::Create => LedgerSource::Interview,
                ConversationMode::Refine => LedgerSource::Refine,
            };
            self.history
                .archive_edition(previous, source, None, Some(&pending.brief));
        }
        self.options.existing_brief = Some(pending.brief);
        self.filing_state = FilingState::Filed;
        Ok(true)
    }

    pub fn filing_failed(&mut self, token: u64) -> bool {
        if self.filing_token() != Some(token) {
            return false;
        }
        self.pending_filing = None;
        self.filing_state = FilingState::Idle;
        true
    }

    /// Cancels the conversation, retiring any in-flight generation so a late
    /// provider response cannot land after the writer leaves the room.
    pub fn cancel(&mut self) {
        self.retire_inflight();
        self.pending_writer_text = None;
        self.pending_filing = None;
        if self.filing_state != FilingState::Filed {
            self.filing_state = FilingState::Idle;
        }
    }

    pub fn filled_fields(&self) -> usize {
        if let Some(synth) = &self.synthesis {
            count_filled_fields(&synth.brief)
        } else if let Some(live) = &self.live_draft {
            crate::dossier_conversation::protocol::BRIEF_FIELDS
                .iter()
                .filter(|&&field| {
                    live.brief
                        .get(field)
                        .is_some_and(|value| !js_trim(value).is_empty())
                })
                .count()
        } else {
            0
        }
    }
}

pub(super) fn partial_answers(answers: &ProjectInterviewAnswers) -> PartialAnswers {
    // PartialAnswers::set is the provider normalization path. Hydrated/authored
    // answers must keep empty strings and interior/edge whitespace exactly.
    PartialAnswers {
        working_title: Some(answers.working_title.clone()),
        format: Some(answers.format.clone()),
        audience: Some(answers.audience.clone()),
        goal: Some(answers.goal.clone()),
        tone: Some(answers.tone.clone()),
        constraints: Some(answers.constraints.clone()),
        success_signal: Some(answers.success_signal.clone()),
    }
}

pub(super) fn js_trim(value: &str) -> &str {
    value.trim_matches(|ch| {
        matches!(ch,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{DossierProbe, ProbeAnswer, ProbeKind};

    #[test]
    fn conversation_lifecycle_and_opening_question() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        assert_eq!(session.messages.len(), 1);
        assert_eq!(
            session.messages[0].author,
            crate::dossier_conversation::protocol::MessageAuthor::Interviewer
        );
        assert_eq!(session.messages[0].text, OPENING_QUESTION);
    }

    #[test]
    fn writer_message_rejects_overlapping_send() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        let token1 = session.send_writer_text("First answer").unwrap();
        assert_eq!(token1, 1);
        assert!(session.loading);
        assert_eq!(session.active_request, Some(1));
        assert_eq!(session.pending_writer_text.as_deref(), Some("First answer"));

        // A second send while a turn is in flight is refused, not silently
        // queued: the generation token stays at 1 and no second writer message
        // is appended.
        let overlap = session.send_writer_text("Clarified answer");
        assert!(overlap.is_err(), "Overlapping send must be rejected");
        assert_eq!(session.request_version, 1);
        assert_eq!(session.messages.len(), 2);
    }

    #[test]
    fn stale_and_duplicate_responses_are_rejected() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        let token1 = session.send_writer_text("First answer").unwrap();
        // A retire (cancel / switch surface / hydration) supersedes token 1.
        session.retire_inflight();
        assert!(session.active_request.is_none());

        // Turn 1 returns late -> rejected cleanly.
        let stale = session
            .receive_turn_result(
                token1,
                Ok(InterviewTurnResult::Question {
                    text: "Old question".into(),
                    draft: None,
                    probe: None,
                    provider: "test".into(),
                    model: "test".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        assert!(!stale, "Stale token response must be ignored");

        // Token zero is never in flight and must be rejected.
        let zero = session
            .receive_turn_result(
                0,
                Ok(InterviewTurnResult::Question {
                    text: "Ghost".into(),
                    draft: None,
                    probe: None,
                    provider: "test".into(),
                    model: "test".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        assert!(!zero, "Token zero must never be accepted");

        // A fresh turn is accepted exactly once; a duplicate is dropped.
        let token2 = session.send_writer_text("Fresh answer").unwrap();
        let fresh = session
            .receive_turn_result(
                token2,
                Ok(InterviewTurnResult::Question {
                    text: "Fresh question".into(),
                    draft: None,
                    probe: None,
                    provider: "test".into(),
                    model: "test".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        assert!(fresh);
        assert!(!session.loading);

        let duplicate = session
            .receive_turn_result(
                token2,
                Ok(InterviewTurnResult::Question {
                    text: "Duplicate question".into(),
                    draft: None,
                    probe: None,
                    provider: "test".into(),
                    model: "test".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        assert!(!duplicate, "Duplicate completion must be ignored");
        assert_eq!(session.messages.last().unwrap().text, "Fresh question");
    }

    #[test]
    fn request_synthesis_emits_inflight_token_without_writer_bubble() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();
        let before = session.messages.len();

        let token = session.request_synthesis().unwrap();
        assert_eq!(token, 1);
        assert!(session.loading);
        assert_eq!(session.active_request, Some(1));
        assert_eq!(
            session.messages.len(),
            before,
            "Synthesis nudge must not be appended to the transcript"
        );
        assert_eq!(
            session.pending_writer_text.as_deref(),
            Some(SYNTHESIZE_NUDGE)
        );

        // A second synthesis request while in flight is refused.
        assert!(session.request_synthesis().is_err());
    }

    #[test]
    fn reviewed_filing_rejects_late_provider_and_requires_explicit_acknowledgement() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        let token = session.send_writer_text("Ready to file").unwrap();
        session
            .receive_turn_result(
                token,
                Ok(InterviewTurnResult::Synthesis {
                    brief: crate::dossier::default_answers(),
                    confidence: FieldConfidenceMap::default(),
                    provider: "synthetic".into(),
                    model: "synthetic".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        let submission = session.prepare_filing(2000).unwrap();
        let filing_token = session.filing_token().unwrap();
        assert_eq!(submission.mode, crate::dossier::DossierMode::Create);
        assert_eq!(session.filing_state, crate::dossier::FilingState::Filing);
        assert!(session.active_request.is_none());

        // A provider response that lands after filing must not mutate the brief.
        let late = session
            .receive_turn_result(
                token,
                Ok(InterviewTurnResult::Question {
                    text: "Late question".into(),
                    draft: None,
                    probe: None,
                    provider: "test".into(),
                    model: "test".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        assert!(!late, "Late response after filing must be ignored");

        assert!(session.acknowledge_filed(filing_token).unwrap());
        assert_eq!(session.filing_state, crate::dossier::FilingState::Filed);
    }

    #[test]
    fn refine_session_retains_existing_probe_answers() {
        let mut answers = crate::dossier::default_answers();
        answers.format = "Essay".into();
        let existing_probe = DossierProbe {
            id: "probe-1".into(),
            kind: ProbeKind::Choice,
            prompt: "What format?".into(),
            options: Some(vec!["Essay".into(), "Manifesto".into()]),
            template: None,
            min: None,
            max: None,
            min_label: None,
            max_label: None,
            answer: Some(ProbeAnswer::Text("Essay".into())),
            relates_to: Some(BriefField::Format),
            extra: Default::default(),
        };
        let existing_brief = crate::workspace::ProjectBrief {
            answers,
            attachments: Vec::new(),
            completed_at: 1,
            updated_at: 1,
            probes: Some(vec![existing_probe]),
            extra: Default::default(),
        };

        let options = ConversationOptions {
            mode: ConversationMode::Refine,
            folio_id: Some("folio-refine".into()),
            folio_name: "Refined Folio".into(),
            existing_brief: Some(existing_brief),
            ..Default::default()
        };
        let session = ConversationSession::new(options);

        assert_eq!(
            session.gathering.answered_probes.len(),
            1,
            "Refine must retain existing probe answers"
        );
        assert_eq!(session.gathering.answered_probes[0].id, "probe-1");

        // Filing the refine session carries the retained probes through.
        let mut session = session;
        session.synthesis = Some(Synthesis {
            brief: session
                .options
                .existing_brief
                .as_ref()
                .unwrap()
                .answers
                .clone(),
            confidence: FieldConfidenceMap::default(),
        });
        let submission = session.prepare_filing(3000).unwrap();
        assert_eq!(submission.brief.probes.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn error_preserves_pending_text_and_allows_retry() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        let token = session.send_writer_text("Crucial input").unwrap();
        session
            .receive_turn_result(token, Err("Network timeout".into()))
            .unwrap();

        assert_eq!(session.error.as_deref(), Some("Network timeout"));
        assert_eq!(
            session.pending_writer_text.as_deref(),
            Some("Crucial input"),
            "Pending text must be retained for retry"
        );

        let retry_token = session.retry_turn().unwrap();
        assert_eq!(retry_token, token + 1);
        assert!(session.loading);
        assert!(session.error.is_none());
    }

    #[test]
    fn probe_answering_progresses_thread() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        let probe = DossierProbe {
            id: "probe-1".into(),
            kind: ProbeKind::Choice,
            prompt: "What format?".into(),
            options: Some(vec!["Essay".into(), "Manifesto".into()]),
            template: None,
            min: None,
            max: None,
            min_label: None,
            max_label: None,
            answer: None,
            relates_to: Some(BriefField::Format),
            extra: Default::default(),
        };

        session.gathering.active_probe = Some(probe);
        let token = session
            .answer_probe(ProbeAnswer::Text("Manifesto".into()))
            .unwrap();

        assert_eq!(token, 1);
        assert_eq!(session.messages.last().unwrap().text, "Manifesto");
        assert_eq!(session.gathering.answered_probes.len(), 1);
        assert!(session.gathering.active_probe.is_none());
    }

    #[test]
    fn synthesis_review_and_manual_field_edit_with_high_confidence() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();

        let mut conf = FieldConfidenceMap::default();
        conf.insert(BriefField::Goal, InterviewConfidence::Low);

        let synth = InterviewTurnResult::Synthesis {
            brief: crate::dossier::default_answers(),
            confidence: conf,
            provider: "ai".into(),
            model: "model".into(),
            trace_id: None,
        };

        let token = session.send_writer_text("Make the brief").unwrap();
        session.receive_turn_result(token, Ok(synth)).unwrap();

        assert!(session.synthesis.is_some());
        assert_eq!(
            session
                .synthesis
                .as_ref()
                .unwrap()
                .confidence
                .get(&BriefField::Goal),
            Some(&InterviewConfidence::Low)
        );

        // Writer edits Goal
        session.start_editing_field(BriefField::Goal).unwrap();
        session
            .save_edited_field(BriefField::Goal, "My explicit goal".into())
            .unwrap();

        let updated_synth = session.synthesis.as_ref().unwrap();
        assert_eq!(updated_synth.brief.goal, "My explicit goal");
        assert_eq!(
            updated_synth.confidence.get(&BriefField::Goal),
            Some(&InterviewConfidence::High),
            "Writer manual edit must upgrade confidence to High"
        );
    }
}
