//! Synthetic native transitions compared with the executed original Source
//! corpus. These do not prove a provider, host commit, or durable disk ACK.
use crate::{
    dossier::{DossierDraft, DossierMode, FilingState, PriorMaterial, default_answers},
    dossier_conversation::{
        BriefHistory, ConversationMode, ConversationOptions, ConversationSession,
        DossierConversationSeam, FieldConfidenceMap, InterviewTurnResult, Synthesis,
        gathering::{GatheringState, upsert_probe},
    },
    house::LedgerSource,
    workspace::{BriefField, DossierProbe, ProbeAnswer, ProjectBrief, ProjectInterviewAnswers},
};
use serde_json::{Value, json};

fn source(name: &str) -> Value {
    let corpus: Value = serde_json::from_str(include_str!("source-vectors.json")).unwrap();
    corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == name)
        .unwrap()["observed"]
        .clone()
}

fn existing() -> ProjectBrief {
    serde_json::from_value(source("refine-probe-context")["requests"][0]["currentBrief"].clone())
        .unwrap()
}

fn probe() -> DossierProbe {
    existing().probes.unwrap().remove(0)
}

fn refine() -> ConversationSession {
    ConversationSession::new(ConversationOptions {
        mode: ConversationMode::Refine,
        folio_id: Some("folio-a".into()),
        folio_name: "The notebook".into(),
        existing_brief: Some(existing()),
        ..Default::default()
    })
}

fn synthesis(brief: ProjectInterviewAnswers) -> InterviewTurnResult {
    InterviewTurnResult::Synthesis {
        brief,
        confidence: FieldConfidenceMap::default(),
        provider: "synthetic-no-transport".into(),
        model: "synthetic".into(),
        trace_id: None,
    }
}

fn reviewed() -> ConversationSession {
    let mut session = refine();
    let token = session
        .send_writer_text("The draft outgrew its old goal")
        .unwrap();
    let mut answers = existing().answers;
    answers.goal = "Writer's explicit goal".into();
    assert!(
        session
            .receive_turn_result(token, Ok(synthesis(answers)))
            .unwrap()
    );
    session
}

#[test]
fn source_probe_identity_retains_prior_answers_and_same_prompt_different_ids() {
    let observed = source("refine-probe-context");
    let mut session = refine();
    assert_eq!(
        session.options.mode.provider_mode(),
        observed["requests"][0]["mode"].as_str().unwrap()
    );
    assert_eq!(
        ConversationMode::Create.provider_mode(),
        source("failure-retry-no-duplicate-writer")["requests"][0]["mode"]
            .as_str()
            .unwrap()
    );
    let next: DossierProbe =
        serde_json::from_value(observed["questionState"]["activeProbe"].clone()).unwrap();
    session.gathering.active_probe = Some(next);
    session
        .answer_probe(ProbeAnswer::Text("General".into()))
        .unwrap();
    assert_eq!(
        serde_json::to_value(&session.gathering.answered_probes).unwrap(),
        observed["answered"]["answeredProbes"]
    );
    assert_eq!(
        session.gathering.answered_probes[0].extra["unknown"],
        json!({"keep":true})
    );
    let mut same_id = session.gathering.answered_probes[1].clone();
    same_id.answer = Some(ProbeAnswer::Text("Specialist".into()));
    upsert_probe(&mut session.gathering.answered_probes, same_id);
    assert_eq!(session.gathering.answered_probes.len(), 2);
    assert_eq!(session.gathering.answered_probes[0].id, "probe-prior");
}

#[test]
fn source_synthesis_string_truthiness_and_blank_review_edit_are_preserved() {
    let mut session = refine();
    let mut answers = existing().answers;
    answers.working_title.clear();
    answers.goal.clear();
    answers.tone = " \u{00a0} ".into();
    let token = session.send_writer_text("Reconsider tone").unwrap();
    session
        .receive_turn_result(token, Ok(synthesis(answers)))
        .unwrap();
    assert_eq!(
        serde_json::to_value(&session.synthesis.as_ref().unwrap().brief).unwrap(),
        source("synthesis-uses-string-truthiness")["state"]["synthesis"]["brief"]
    );
    session.start_editing_field(BriefField::Tone).unwrap();
    let unchanged = session.clone();
    assert!(
        session
            .save_edited_field(BriefField::Tone, "\u{feff} \u{00a0} ".into())
            .is_err()
    );
    assert_eq!(session, unchanged);
    assert!(
        session
            .save_edited_field(BriefField::Goal, "Wrong field".into())
            .is_err()
    );
    assert_eq!(session, unchanged);
}

#[test]
fn source_send_uses_js_trim_including_bom_but_keeps_nel() {
    for row in source("source-send-js-trim")["rows"].as_array().unwrap() {
        let mut session = ConversationSession::new(ConversationOptions::default());
        session.start();
        let sent = session.send_writer_text(row["input"].as_str().unwrap());
        if row["requests"].as_array().unwrap().is_empty() {
            assert!(sent.is_err());
            assert_eq!(session.messages.len(), 1);
        } else {
            sent.unwrap();
            assert_eq!(
                session.messages[1].text,
                row["state"]["messages"][1]["text"].as_str().unwrap()
            );
        }
    }
}

#[test]
fn invalid_or_busy_probe_answer_never_consumes_or_files_the_probe() {
    let mut session = refine();
    session.gathering.active_probe = Some(probe());
    let unchanged = session.clone();
    assert!(
        session
            .answer_probe(ProbeAnswer::Text("Not an option".into()))
            .is_err()
    );
    assert_eq!(session, unchanged);
    let token = session.request_synthesis().unwrap();
    let busy = session.clone();
    assert!(
        session
            .answer_probe(ProbeAnswer::Text("General".into()))
            .is_err()
    );
    session.skip_probe();
    assert_eq!(session, busy);
    session
        .receive_turn_result(token, Err("Synthetic unavailable transport".into()))
        .unwrap();
    let mut gathering = GatheringState {
        active_probe: Some(probe()),
        ..Default::default()
    };
    let unchanged = gathering.clone();
    assert!(
        gathering
            .answer_active_probe(ProbeAnswer::Text("Not an option".into()))
            .is_err()
    );
    assert_eq!(gathering, unchanged);
}

#[test]
fn exhausted_generation_refuses_before_transcript_or_probe_mutation() {
    let mut session = refine();
    session.gathering.active_probe = Some(probe());
    session.request_version = u64::MAX;
    let unchanged = session.clone();
    assert!(session.send_writer_text("Keep this input").is_err());
    assert!(session.request_synthesis().is_err());
    assert!(
        session
            .answer_probe(ProbeAnswer::Text("General".into()))
            .is_err()
    );
    assert_eq!(session, unchanged);
}

#[test]
fn nudge_keeps_active_probe_and_failed_retry_does_not_duplicate_writer() {
    let mut session = ConversationSession::new(ConversationOptions::default());
    session.start();
    session.gathering.active_probe = Some(probe());
    let messages = session.messages.clone();
    let token = session.request_synthesis().unwrap();
    assert_eq!(session.messages, messages);
    assert_eq!(
        serde_json::to_value(&session.gathering.active_probe).unwrap(),
        source("synthesis-nudge-retains-active-probe")["state"]["activeProbe"]
    );
    session
        .receive_turn_result(token, Err("Synthetic failure".into()))
        .unwrap();
    session.retry_turn().unwrap();
    assert_eq!(session.messages, messages);
    session.retire_inflight();
    let retired = session.clone();
    assert!(
        !session
            .receive_turn_result(token, Err("Late synthetic error".into()))
            .unwrap()
    );
    assert_eq!(
        session, retired,
        "Source late-error weakness is intentionally refused"
    );

    let mut writer = ConversationSession::new(ConversationOptions::default());
    writer.start();
    let token = writer
        .send_writer_text("Writer's retained sentence")
        .unwrap();
    writer
        .receive_turn_result(token, Err("Synthetic failure".into()))
        .unwrap();
    writer.retry_turn().unwrap();
    assert_eq!(writer.messages.len(), 2);
    assert_eq!(
        writer.pending_writer_text.as_deref(),
        Some("Writer's retained sentence")
    );
}

#[test]
fn filing_requires_review_and_exact_refine_scope_without_mutating_rejected_session() {
    let mut session = ConversationSession::new(ConversationOptions::default());
    let unchanged = session.clone();
    assert!(session.prepare_filing(1000).is_err());
    assert_eq!(session, unchanged);
    for (scope, brief) in [
        (None, Some(existing())),
        (Some("".into()), Some(existing())),
        (Some("folio-a".into()), None),
    ] {
        let mut session = ConversationSession::new(ConversationOptions {
            mode: ConversationMode::Refine,
            folio_id: scope,
            existing_brief: brief,
            ..Default::default()
        });
        session.synthesis = Some(Synthesis {
            brief: default_answers(),
            confidence: FieldConfidenceMap::default(),
        });
        let unchanged = session.clone();
        assert!(session.prepare_filing(1000).is_err());
        assert_eq!(session, unchanged);
    }
}

#[test]
fn held_candidate_failure_retry_and_full_token_ack_preserve_history_and_review() {
    let mut session = reviewed();
    assert!(
        session.history.editions.is_empty(),
        "Opening a brief is not superseding it"
    );
    let review = session.synthesis.clone();
    let submission = session.prepare_filing(1000).unwrap();
    let token = session.filing_token().unwrap();
    assert_eq!(submission.mode, DossierMode::Refine);
    assert_eq!(submission.brief.completed_at, 100);
    assert_eq!(submission.brief.updated_at, 1000);
    assert!(session.filing_matches(token, &submission));
    let unchanged = session.clone();
    let mut different = submission.clone();
    different.mode = DossierMode::Create;
    assert!(!session.filing_matches(token, &different));
    different = submission.clone();
    different
        .brief
        .extra
        .insert("different".into(), json!(true));
    assert!(!session.filing_matches(token, &different));
    assert!(!session.acknowledge_filed(token + 1).unwrap());
    assert!(!session.filing_failed(token + 1));
    assert!(session.prepare_filing(1001).is_err());
    assert!(session.send_writer_text("Late input").is_err());
    assert!(session.start_editing_field(BriefField::Goal).is_err());
    session.dismiss_synthesis();
    assert_eq!(session, unchanged);
    assert!(session.filing_failed(token));
    assert_eq!(session.synthesis, review);
    assert!(session.history.editions.is_empty());
    let retry = session.prepare_filing(1002).unwrap();
    let retry_token = session.filing_token().unwrap();
    assert!(retry_token > token);
    let held = session.clone();
    assert!(!session.acknowledge_filed(token).unwrap());
    assert!(!session.filing_failed(token));
    assert_eq!(session, held);
    assert!(session.filing_matches(retry_token, &retry));
    // This explicit synthetic ACK is the test input, not a real durable save.
    assert!(session.acknowledge_filed(retry_token).unwrap());
    assert_eq!(session.filing_state, FilingState::Filed);
    assert_eq!(session.history.editions.len(), 1);
    assert_eq!(session.history.editions[0].brief, existing());
    assert_eq!(session.options.existing_brief.as_ref(), Some(&retry.brief));
    let filed = session.clone();
    assert!(!session.acknowledge_filed(retry_token).unwrap());
    assert!(session.prepare_filing(1003).is_err());
    assert_eq!(session, filed);
}

#[test]
fn hydration_replaces_old_synthesis_and_filing_without_losing_form_bytes_or_unknowns() {
    let mut session = reviewed();
    session.prepare_filing(1000).unwrap();
    let old_filing = session.filing_token().unwrap();
    let mut answers = default_answers();
    answers.working_title = "Recovered title".into();
    answers.tone = " \u{00a0} ".into();
    answers.goal.clear();
    answers
        .extra
        .insert("futureAnswer".into(), json!({"keep":true}));
    let draft = DossierDraft {
        answers,
        attachments: existing().attachments,
        probes: existing().probes.unwrap(),
        prior_material: PriorMaterial {
            text: "Exact\nraw prose 東京".into(),
            ..Default::default()
        },
        reference: Default::default(),
        step: 5,
        generation: 50,
        extra: [("futureRecovery".into(), Value::Null)].into(),
    };
    DossierConversationSeam::hydrate_session_from_draft(&mut session, draft.clone()).unwrap();
    assert!(session.synthesis.is_none());
    assert!(session.editing_field.is_none());
    assert!(session.error.is_none());
    assert!(session.active_request.is_none());
    assert!(session.pending_writer_text.is_none());
    assert!(session.gathering.active_probe.is_none());
    assert!(!session.loading);
    assert_eq!(session.filing_state, FilingState::Idle);
    let projected = DossierConversationSeam::session_to_dossier_draft(&session);
    assert!(projected.generation > draft.generation);
    assert_eq!(
        DossierDraft {
            generation: draft.generation,
            ..projected
        },
        draft
    );
    let unchanged = session.clone();
    assert!(!session.acknowledge_filed(old_filing).unwrap());
    assert!(!session.filing_failed(old_filing));
    assert_eq!(session, unchanged);
    assert!(session.prepare_filing(1001).is_err());
    assert_eq!(session, unchanged);
    let mut invalid = draft;
    invalid.step = usize::MAX;
    assert!(DossierConversationSeam::hydrate_session_from_draft(&mut session, invalid).is_err());
    assert_eq!(session, unchanged);
}

#[test]
fn source_history_compares_the_entire_retained_brief() {
    let expected = source("history-compares-entire-brief");
    let mut history = BriefHistory::new("folio-a");
    let original = existing();
    history.archive_edition(&original, LedgerSource::Refine, None, None);
    history.archive_edition(&original, LedgerSource::Refine, None, None);
    assert_eq!(
        history.editions.len(),
        expected["duplicate"].as_array().unwrap().len()
    );
    let mut changed = original;
    changed.extra.insert(
        "unknown".into(),
        json!({"keep":true,"edition":"updated metadata"}),
    );
    history.archive_edition(&changed, LedgerSource::Refine, None, None);
    assert_eq!(
        history.editions.len(),
        expected["changed"].as_array().unwrap().len()
    );
    assert_eq!(
        serde_json::to_value(&history.editions[0].brief).unwrap(),
        expected["changed"][0]["brief"]
    );
}
