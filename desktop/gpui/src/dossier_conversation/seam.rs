//! Non-destructive integration seam connecting the conversational interview
//! to Twyne's existing native offline dossier storage, recovery, and filing.
//!
//! Existing modules (`crate::dossier` and `crate::dossier_filing`) remain
//! untouched. This seam provides bidirectional conversion, disk recovery
//! synchronization, and surface handoff between the ten-step form and the
//! conversational room.

use crate::{
    dossier::{DossierDraft, DossierRecovery, default_answers, material_word_count},
    dossier_conversation::{
        protocol::{FieldConfidenceMap, InterviewDossierDraft},
        session::{ConversationSession, partial_answers},
    },
};
use anyhow::Result;

pub struct DossierConversationSeam;

impl DossierConversationSeam {
    /// Converts a conversational session's gathered state into a standard
    /// `DossierDraft` compatible with the offline form and recovery store.
    pub fn session_to_dossier_draft(session: &ConversationSession) -> DossierDraft {
        let defaults = default_answers();
        let fallback = session
            .handoff_draft
            .as_ref()
            .map(|draft| &draft.answers)
            .or_else(|| {
                session
                    .options
                    .existing_brief
                    .as_ref()
                    .map(|brief| &brief.answers)
            })
            .unwrap_or(&defaults);
        let answers = if let Some(synth) = &session.synthesis {
            let mut answers = synth.brief.clone();
            for (key, value) in &fallback.extra {
                answers
                    .extra
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
            answers
        } else if let Some(live) = &session.live_draft {
            live.brief.fill_with_defaults(Some(fallback))
        } else {
            fallback.clone()
        };

        DossierDraft {
            answers,
            attachments: session.gathering.attachments.clone(),
            probes: session.gathering.answered_probes.clone(),
            prior_material: session.gathering.prior_material.clone(),
            reference: session.gathering.reference_draft.clone(),
            step: session.handoff_draft.as_ref().map_or(0, |draft| draft.step),
            generation: session.request_version.max(
                session
                    .handoff_draft
                    .as_ref()
                    .map_or(0, |draft| draft.generation),
            ),
            extra: session
                .handoff_draft
                .as_ref()
                .map_or_else(Default::default, |draft| draft.extra.clone()),
        }
    }

    /// Hydrates a conversational session from an existing form draft or recovery copy.
    ///
    /// Any previous in-flight generation is retired first so a stale provider
    /// response cannot overwrite the recovered edits.
    pub fn hydrate_session_from_draft(
        session: &mut ConversationSession,
        draft: DossierDraft,
    ) -> Result<()> {
        draft.validate()?;
        session.request_version = session.request_version.max(draft.generation);
        session.cancel();
        session.filing_state = crate::dossier::FilingState::Idle;
        session.synthesis = None;
        session.editing_field = None;
        session.draft_input.clear();
        session.error = None;
        session.gathering.active_probe = None;
        session.handoff_draft = Some(draft.clone());

        session.live_draft = Some(InterviewDossierDraft {
            brief: partial_answers(&draft.answers),
            confidence: FieldConfidenceMap::new(),
        });

        session.gathering.attachments = draft.attachments;
        session.gathering.answered_probes = draft.probes;
        session.gathering.material_words = material_word_count(&draft.prior_material.text);
        session.gathering.prior_material = draft.prior_material;
        session.gathering.reference_draft = draft.reference;
        Ok(())
    }

    /// Persists the conversational session's recovery copy to disk using the
    /// shared `DossierRecovery` writer.
    pub fn persist_recovery(
        session: &ConversationSession,
        recovery: &DossierRecovery,
        now: u64,
    ) -> Result<()> {
        let draft = Self::session_to_dossier_draft(session);
        recovery.save(&draft, now)?;
        Ok(())
    }

    /// Loads an existing recovery copy from disk if available and usable.
    pub fn load_recovery(recovery: &DossierRecovery, now: u64) -> Result<Option<DossierDraft>> {
        recovery.load(now)
    }

    /// Low-level cleanup only. The host must first qualify the live owning
    /// entity/folio/base revision and an accepted filing token. The recovery
    /// identity alone cannot distinguish a reopened same-scope form.
    pub fn clear_recovery(recovery: &DossierRecovery) -> Result<()> {
        recovery.clear()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dossier::RecoveryIdentity;
    use crate::dossier_conversation::protocol::{BriefField, InterviewConfidence};
    use crate::dossier_conversation::session::{ConversationMode, ConversationOptions, Synthesis};
    use tempfile::tempdir;

    #[test]
    fn round_trip_between_session_and_dossier_draft() {
        let options = ConversationOptions {
            mode: ConversationMode::Create,
            folio_id: Some("folio-xyz".into()),
            folio_name: "The Living Draft".into(),
            ..Default::default()
        };
        let mut session = ConversationSession::new(options);
        session
            .gathering
            .set_prior_material_text("Pasted starting thoughts.".into());

        let mut conf = FieldConfidenceMap::default();
        conf.insert(BriefField::Format, InterviewConfidence::High);

        let mut answers = default_answers();
        answers.working_title = "The Living Draft".into();
        answers.format = "Newsletter".into();

        session.synthesis = Some(Synthesis {
            brief: answers.clone(),
            confidence: conf,
        });

        let draft = DossierConversationSeam::session_to_dossier_draft(&session);
        assert_eq!(draft.answers.working_title, "The Living Draft");
        assert_eq!(draft.answers.format, "Newsletter");
        assert_eq!(draft.prior_material.text, "Pasted starting thoughts.");

        // Hydrate a clean session from draft
        let fresh_options = ConversationOptions {
            mode: ConversationMode::Create,
            folio_id: Some("folio-xyz".into()),
            folio_name: "The Living Draft".into(),
            ..Default::default()
        };
        let mut fresh_session = ConversationSession::new(fresh_options);
        DossierConversationSeam::hydrate_session_from_draft(&mut fresh_session, draft).unwrap();

        assert!(fresh_session.live_draft.is_some());
        assert_eq!(
            fresh_session
                .live_draft
                .as_ref()
                .unwrap()
                .brief
                .format
                .as_deref(),
            Some("Newsletter")
        );
        assert_eq!(
            fresh_session.gathering.prior_material.text,
            "Pasted starting thoughts."
        );
    }

    #[test]
    fn hydration_retires_inflight_generation_so_stale_providers_cannot_land() {
        use crate::dossier_conversation::protocol::InterviewTurnResult;

        let options = ConversationOptions {
            mode: ConversationMode::Create,
            folio_id: Some("folio-hydrate".into()),
            folio_name: "Hydrated Folio".into(),
            ..Default::default()
        };
        let mut session = ConversationSession::new(options);
        session.start();

        let token = session.send_writer_text("Answer in flight").unwrap();
        assert!(session.loading);
        assert_eq!(session.active_request, Some(token));

        let mut answers = default_answers();
        answers.working_title = "Recovered title".into();
        let draft = DossierDraft {
            answers,
            attachments: Vec::new(),
            probes: Vec::new(),
            prior_material: Default::default(),
            reference: Default::default(),
            step: 0,
            generation: 0,
            extra: Default::default(),
        };

        DossierConversationSeam::hydrate_session_from_draft(&mut session, draft).unwrap();

        assert!(!session.loading, "Hydration must clear loading");
        assert!(session.active_request.is_none());

        // The provider response for the retired token must not overwrite the
        // recovered draft.
        let accepted = session
            .receive_turn_result(
                token,
                Ok(InterviewTurnResult::Question {
                    text: "Stale question".into(),
                    draft: None,
                    probe: None,
                    provider: "test".into(),
                    model: "test".into(),
                    trace_id: None,
                }),
            )
            .unwrap();
        assert!(!accepted, "Retired token must be rejected after hydration");
        assert_eq!(
            session
                .live_draft
                .as_ref()
                .unwrap()
                .brief
                .working_title
                .as_deref(),
            Some("Recovered title")
        );
    }

    #[test]
    fn recovery_save_load_and_clear_lifecycle() {
        let dir = tempdir().unwrap();
        let identity = RecoveryIdentity {
            scope: "create:folio-1".into(),
            owner: Some("alice".into()),
            base: "0".into(),
        };
        let recovery = DossierRecovery::new(dir.path(), identity);

        let options = ConversationOptions {
            mode: ConversationMode::Create,
            folio_id: Some("folio-1".into()),
            owner: Some("alice".into()),
            ..Default::default()
        };
        let mut session = ConversationSession::new(options);
        session
            .gathering
            .set_prior_material_text("Recovery candidate prose".into());

        // Save recovery
        DossierConversationSeam::persist_recovery(&session, &recovery, 1000).unwrap();

        // Load recovery
        let loaded = DossierConversationSeam::load_recovery(&recovery, 1001)
            .unwrap()
            .expect("Recovery copy must be found");
        assert_eq!(loaded.prior_material.text, "Recovery candidate prose");

        // Clear recovery
        DossierConversationSeam::clear_recovery(&recovery).unwrap();
        let after_clear = DossierConversationSeam::load_recovery(&recovery, 1002).unwrap();
        assert!(after_clear.is_none());
    }
}
