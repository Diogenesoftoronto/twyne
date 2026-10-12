//! Contextual amendments and brief history transitions for Twyne dossiers.
//!
//! Contextual amendments compare the evolving manuscript draft against all
//! seven brief fields. Proposed amendments are suggestions that NEVER silently
//! mutate the dossier without explicit author consent. Authors retain full
//! authorship by being able to accept, edit, or dismiss each proposed change.
//!
//! Editions are preserved in a bounded chronological history (max 20),
//! and field diffs are recorded in the shared ledger.

use crate::{
    dossier::{answer, set_answer},
    dossier_conversation::protocol::{DossierCheckResult, DossierObservation},
    house::LedgerSource,
    workspace::{BriefField, ProjectBrief},
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_BRIEF_EDITIONS: usize = 20;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BriefEdition {
    pub id: String,
    pub saved_at: u64,
    pub brief: ProjectBrief,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<LedgerSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BriefChangeRecord {
    pub field: BriefField,
    pub from: String,
    pub to: String,
    pub source: LedgerSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BriefHistory {
    pub folio_id: String,
    pub editions: Vec<BriefEdition>,
}

impl BriefHistory {
    pub fn new(folio_id: impl Into<String>) -> Self {
        Self {
            folio_id: folio_id.into(),
            editions: Vec::new(),
        }
    }

    pub fn latest(&self) -> Option<&BriefEdition> {
        self.editions.first()
    }

    /// Archives a superseded brief edition and optionally computes field changes
    /// if a `next_brief` is provided. Bounded to `MAX_BRIEF_EDITIONS = 20`.
    pub fn archive_edition(
        &mut self,
        brief: &ProjectBrief,
        source: LedgerSource,
        reason: Option<String>,
        next_brief: Option<&ProjectBrief>,
    ) -> Vec<BriefChangeRecord> {
        if self.folio_id.is_empty() {
            return Vec::new();
        }
        let is_identical_to_latest = self
            .editions
            .first()
            .is_some_and(|latest| latest.brief == *brief);

        if !is_identical_to_latest {
            let edition = BriefEdition {
                id: format!("{}-{}", brief.updated_at, Uuid::new_v4()),
                saved_at: if brief.updated_at > 0 {
                    brief.updated_at
                } else {
                    crate::manuscript::timestamp()
                },
                brief: brief.clone(),
                source: Some(source.clone()),
                reason: reason.clone(),
            };
            self.editions.insert(0, edition);
            if self.editions.len() > MAX_BRIEF_EDITIONS {
                self.editions.truncate(MAX_BRIEF_EDITIONS);
            }
        }

        if let Some(next) = next_brief {
            compute_brief_changes(&brief.answers, &next.answers, source, reason)
        } else {
            Vec::new()
        }
    }
}

pub fn compute_brief_changes(
    previous: &crate::workspace::ProjectInterviewAnswers,
    next: &crate::workspace::ProjectInterviewAnswers,
    source: LedgerSource,
    reason: Option<String>,
) -> Vec<BriefChangeRecord> {
    crate::house::DOSSIER_FIELDS
        .iter()
        .filter_map(|&field| {
            let from = answer(previous, field).trim();
            let to = answer(next, field).trim();
            if from != to {
                Some(BriefChangeRecord {
                    field,
                    from: from.to_string(),
                    to: to.to_string(),
                    source: source.clone(),
                    reason: reason.clone(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DossierAmendedEvent {
    pub folio_id: String,
    pub field: BriefField,
    pub from: String,
    pub to: String,
    pub source: LedgerSource,
    pub reason: Option<String>,
    pub updated_brief: ProjectBrief,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AmendmentState {
    pub check_result: Option<DossierCheckResult>,
    pub loading: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AuthoredAmendment {
    pub observation: Option<usize>,
    pub field: BriefField,
    pub text: String,
    pub reason: Option<String>,
}

impl AmendmentState {
    pub fn set_check_result(&mut self, result: DossierCheckResult) {
        self.check_result = Some(result);
        self.loading = false;
        self.error = None;
    }

    pub fn set_error(&mut self, error: String) {
        self.error = Some(error);
        self.loading = false;
    }

    pub fn dismiss_observation(&mut self, index: usize) -> Option<DossierObservation> {
        let result = self.check_result.as_mut()?;
        if index < result.observations.len() {
            Some(result.observations.remove(index))
        } else {
            None
        }
    }

    /// Applies an observation directly to the brief. Retains the previous brief
    /// in the edition history under `LedgerSource::Amendment`.
    pub fn apply_observation(
        &mut self,
        index: usize,
        brief: &mut ProjectBrief,
        history: &mut BriefHistory,
        now: u64,
    ) -> Result<DossierAmendedEvent> {
        let obs = self
            .dismiss_observation(index)
            .ok_or_else(|| anyhow::anyhow!("Observation index out of bounds"))?;

        let old_brief = brief.clone();
        let from = answer(&brief.answers, obs.field).to_string();
        let to = obs.suggested.clone();

        set_answer(&mut brief.answers, obs.field, to.clone());
        brief.updated_at = now;

        history.archive_edition(
            &old_brief,
            LedgerSource::Amendment,
            Some(obs.reason.clone()),
            Some(brief),
        );

        Ok(DossierAmendedEvent {
            folio_id: history.folio_id.clone(),
            field: obs.field,
            from,
            to,
            source: LedgerSource::Amendment,
            reason: Some(obs.reason),
            updated_brief: brief.clone(),
        })
    }

    /// Applies an authored modification to a field based on an observation,
    /// protecting writer intent when the writer edits the suggested text.
    pub fn apply_authored_amendment(
        &mut self,
        amendment: AuthoredAmendment,
        brief: &mut ProjectBrief,
        history: &mut BriefHistory,
        now: u64,
    ) -> Result<DossierAmendedEvent> {
        let AuthoredAmendment {
            observation,
            field,
            text,
            reason,
        } = amendment;
        let to = text.trim().to_string();
        ensure!(!to.is_empty(), "Amended field value cannot be empty.");
        if let Some(i) = observation {
            let _ = self.dismiss_observation(i);
        }

        let old_brief = brief.clone();
        let from = answer(&brief.answers, field).to_string();

        set_answer(&mut brief.answers, field, to.clone());
        brief.updated_at = now;

        history.archive_edition(
            &old_brief,
            LedgerSource::Amendment,
            reason.clone(),
            Some(brief),
        );

        Ok(DossierAmendedEvent {
            folio_id: history.folio_id.clone(),
            field,
            from,
            to,
            source: LedgerSource::Amendment,
            reason,
            updated_brief: brief.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_brief() -> ProjectBrief {
        ProjectBrief {
            answers: crate::dossier::default_answers(),
            attachments: Vec::new(),
            completed_at: 1000,
            updated_at: 1000,
            probes: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn brief_edition_archiving_and_bounding() {
        let mut history = BriefHistory::new("folio-123");
        let mut current = test_brief();

        for i in 1..=25 {
            let previous = current.clone();
            current.answers.tone = format!("Tone edition {i}");
            current.updated_at = 1000 + i;
            history.archive_edition(
                &previous,
                LedgerSource::Refine,
                Some(format!("Reason {i}")),
                Some(&current),
            );
        }

        assert_eq!(history.editions.len(), MAX_BRIEF_EDITIONS);
        // Latest archived is edition 24 (previous to current 25)
        assert_eq!(history.editions[0].brief.answers.tone, "Tone edition 24");
        // Oldest preserved is edition 5
        assert_eq!(history.editions[19].brief.answers.tone, "Tone edition 5");
    }

    #[test]
    fn identical_brief_does_not_create_duplicate_edition() {
        let mut history = BriefHistory::new("folio-123");
        let brief = test_brief();

        history.archive_edition(&brief, LedgerSource::Refine, None, None);
        assert_eq!(history.editions.len(), 1);

        history.archive_edition(&brief, LedgerSource::Refine, None, None);
        assert_eq!(
            history.editions.len(),
            1,
            "Duplicate brief answers should not add edition"
        );
    }

    #[test]
    fn apply_observation_mutates_brief_and_archives_amendment_edition() {
        let mut history = BriefHistory::new("folio-abc");
        let mut brief = test_brief();
        let mut state = AmendmentState::default();

        state.set_check_result(DossierCheckResult {
            provider: "test-ai".into(),
            observations: vec![DossierObservation {
                field: BriefField::Tone,
                current: brief.answers.tone.clone(),
                suggested: "Sharper and more urgent".into(),
                reason: "Draft shows urgent stakes in chapter 1".into(),
            }],
        });

        let event = state
            .apply_observation(0, &mut brief, &mut history, 2000)
            .unwrap();

        assert_eq!(event.field, BriefField::Tone);
        assert_eq!(event.to, "Sharper and more urgent");
        assert_eq!(brief.answers.tone, "Sharper and more urgent");
        assert_eq!(brief.updated_at, 2000);
        assert_eq!(history.editions.len(), 1);
        assert_eq!(history.editions[0].source, Some(LedgerSource::Amendment));
        assert!(state.check_result.as_ref().unwrap().observations.is_empty());
    }

    #[test]
    fn apply_authored_amendment_preserves_writer_modifications() {
        let mut history = BriefHistory::new("folio-abc");
        let mut brief = test_brief();
        let mut state = AmendmentState::default();

        state.set_check_result(DossierCheckResult {
            provider: "test-ai".into(),
            observations: vec![DossierObservation {
                field: BriefField::Tone,
                current: brief.answers.tone.clone(),
                suggested: "Too extreme suggestion".into(),
                reason: "Too extreme".into(),
            }],
        });

        // Writer modifies suggestion before applying
        let event = state
            .apply_authored_amendment(
                AuthoredAmendment {
                    observation: Some(0),
                    field: BriefField::Tone,
                    text: "Writer's preferred nuanced tone".into(),
                    reason: Some("Author chosen phrasing".into()),
                },
                &mut brief,
                &mut history,
                2005,
            )
            .unwrap();

        assert_eq!(event.to, "Writer's preferred nuanced tone");
        assert_eq!(brief.answers.tone, "Writer's preferred nuanced tone");
        assert!(state.check_result.as_ref().unwrap().observations.is_empty());
    }

    #[test]
    fn rejected_authored_amendment_keeps_its_observation_brief_and_history() {
        let mut history = BriefHistory::new("folio-abc");
        let mut brief = test_brief();
        let mut state = AmendmentState::default();
        state.set_check_result(DossierCheckResult {
            provider: "fixture".into(),
            observations: vec![DossierObservation {
                field: BriefField::Tone,
                current: brief.answers.tone.clone(),
                suggested: "Suggested tone".into(),
                reason: "Retain this until accepted".into(),
            }],
        });
        let before = (state.clone(), brief.clone(), history.clone());
        assert!(
            state
                .apply_authored_amendment(
                    AuthoredAmendment {
                        observation: Some(0),
                        field: BriefField::Tone,
                        text: " \t\r\n".into(),
                        reason: None,
                    },
                    &mut brief,
                    &mut history,
                    2_000,
                )
                .is_err()
        );
        assert_eq!((state, brief, history), before);
    }
}
