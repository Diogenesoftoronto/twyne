//! Standalone test harness for the native dossier conversation slice.
//!
//! Re-exports existing twyne_desktop crate modules at the root crate so that
//! `crate::workspace`, `crate::dossier`, etc. resolve cleanly when compiling
//! `dossier_conversation` standalone with rustc against cached target deps.

extern crate anyhow;
extern crate serde;
extern crate serde_json;
extern crate twyne_desktop;
extern crate uuid;

pub use twyne_desktop::dossier;
pub use twyne_desktop::house;
pub use twyne_desktop::manuscript;
pub use twyne_desktop::workspace;

#[path = "../../src/dossier_conversation/mod.rs"]
pub mod dossier_conversation;

use dossier_conversation::{
    BriefField,
    protocol::{
        FieldConfidenceMap, InterviewConfidence, InterviewTurnResult, clean_dossier_amend_response,
        parse_dossier_check_result, parse_interview_turn_response,
    },
    seam::DossierConversationSeam,
    session::{ConversationMode, ConversationOptions, ConversationSession},
};

fn main() {
    println!("=== Testing Dossier Conversation Protocol ===");

    // 1. Tagged JSON parsing
    let sample = r#"I love that direction. Who is the specific reader?

DOSSIER: {
  "brief": {
    "workingTitle": "The Anatomy of Attention",
    "format": "Essay",
    "tone": "Sharp and lucid"
  },
  "confidence": {
    "workingTitle": "high",
    "format": "high",
    "tone": "medium"
  }
}

PROBE: {
  "id": "probe-reader-type",
  "kind": "choice",
  "prompt": "Which reader should the opening target first?",
  "options": ["Architect", "Worker", "Generalist"]
}"#;

    let turn = parse_interview_turn_response(sample, "test-ai", "test-model", None, None)
        .expect("turn should parse");

    match turn {
        InterviewTurnResult::Question {
            text, draft, probe, ..
        } => {
            assert_eq!(text, "I love that direction. Who is the specific reader?");
            let d = draft.expect("draft should be present");
            assert_eq!(
                d.brief.working_title.as_deref(),
                Some("The Anatomy of Attention")
            );
            assert_eq!(
                d.confidence.get(&BriefField::Tone),
                Some(&InterviewConfidence::Medium)
            );
            let p = probe.expect("probe should be present");
            assert_eq!(p.id, "probe-reader-type");
        }
        _ => panic!("Expected Question"),
    }
    println!("✓ Tagged JSON protocol parsing passed");

    // 2. Contextual Amendment cleaning
    let uncleaned = "   \"\"“A sharp personal essay on focus.””`   \n";
    let cleaned = clean_dossier_amend_response(uncleaned);
    assert_eq!(cleaned.as_deref(), Some("A sharp personal essay on focus."));

    let overlong = "A".repeat(300);
    let clamped = clean_dossier_amend_response(&overlong).unwrap();
    assert_eq!(clamped.len(), 240);
    println!("✓ Amendment response normalization passed");

    // 3. Drift check parsing
    let drift_json = r#"{
        "observations": [
            {
                "field": "tone",
                "suggested": "Direct and urgent",
                "reason": "The draft moves with immediate stakes."
            },
            {
                "field": "tone",
                "suggested": "Duplicate ignored",
                "reason": "Dup"
            }
        ]
    }"#;
    let brief = twyne_desktop::dossier::default_answers();
    let drift = parse_dossier_check_result(drift_json, "test-ai", &brief)
        .expect("drift check should parse");
    assert_eq!(drift.observations.len(), 1);
    assert_eq!(drift.observations[0].field, BriefField::Tone);
    assert_eq!(drift.observations[0].suggested, "Direct and urgent");
    println!("✓ Drift check report parsing passed");

    // 4. Session state machine & monotonic request generations
    let opts = ConversationOptions {
        mode: ConversationMode::Create,
        folio_name: "Attention Folio".into(),
        ..Default::default()
    };
    let mut session = ConversationSession::new(opts);
    session.start();
    assert_eq!(session.messages.len(), 1);

    let token1 = session.send_writer_text("First concept").unwrap();
    assert_eq!(token1, 1);
    assert!(session.loading);

    // A second send while a turn is in flight is refused (overlapping send).
    assert!(session.send_writer_text("Refined concept").is_err());

    // Retire the in-flight turn (as cancel / switch-surface / hydration would),
    // then start a fresh generation. Retiring bumps the version, so the fresh
    // token is token1 + 2.
    session.retire_inflight();
    let token2 = session.send_writer_text("Refined concept").unwrap();
    assert_eq!(token2, token1 + 2);

    // Stale token response should be rejected
    let stale_accepted = session
        .receive_turn_result(
            token1,
            Ok(InterviewTurnResult::Question {
                text: "Old question".into(),
                draft: None,
                probe: None,
                provider: "ai".into(),
                model: "m".into(),
                trace_id: None,
            }),
        )
        .unwrap();
    assert!(!stale_accepted, "Stale token must be dropped");

    // Token zero is never in flight.
    let zero_accepted = session
        .receive_turn_result(
            0,
            Ok(InterviewTurnResult::Question {
                text: "Ghost".into(),
                draft: None,
                probe: None,
                provider: "ai".into(),
                model: "m".into(),
                trace_id: None,
            }),
        )
        .unwrap();
    assert!(!zero_accepted, "Token zero must be dropped");

    // Fresh token accepted
    let fresh_accepted = session
        .receive_turn_result(
            token2,
            Ok(InterviewTurnResult::Question {
                text: "Target question".into(),
                draft: None,
                probe: None,
                provider: "ai".into(),
                model: "m".into(),
                trace_id: None,
            }),
        )
        .unwrap();
    assert!(fresh_accepted);

    // Duplicate completion of the same token is dropped.
    let duplicate_accepted = session
        .receive_turn_result(
            token2,
            Ok(InterviewTurnResult::Question {
                text: "Duplicate question".into(),
                draft: None,
                probe: None,
                provider: "ai".into(),
                model: "m".into(),
                trace_id: None,
            }),
        )
        .unwrap();
    assert!(!duplicate_accepted, "Duplicate completion must be dropped");
    assert_eq!(session.messages.last().unwrap().text, "Target question");
    println!("✓ Request generation & race prevention passed");

    // 5. Synthesis review & author inline edits
    let synth = InterviewTurnResult::Synthesis {
        brief: twyne_desktop::dossier::default_answers(),
        confidence: FieldConfidenceMap::from([(BriefField::Tone, InterviewConfidence::Low)]),
        provider: "ai".into(),
        model: "m".into(),
        trace_id: None,
    };
    let token3 = session.send_writer_text("Synthesize").unwrap();
    session.receive_turn_result(token3, Ok(synth)).unwrap();
    assert!(session.synthesis.is_some());

    session.start_editing_field(BriefField::Tone).unwrap();
    session
        .save_edited_field(BriefField::Tone, "Exact author tone".into())
        .unwrap();
    assert_eq!(
        session.synthesis.as_ref().unwrap().brief.tone,
        "Exact author tone"
    );
    assert_eq!(
        session
            .synthesis
            .as_ref()
            .unwrap()
            .confidence
            .get(&BriefField::Tone),
        Some(&InterviewConfidence::High)
    );
    println!("✓ Synthesis review & author edit with High confidence passed");

    // 6. Filing transition
    let submission = session.prepare_filing(2000).unwrap();
    assert_eq!(submission.brief.answers.tone, "Exact author tone");
    assert_eq!(submission.brief.answers.working_title, "Attention Folio");
    assert_eq!(
        session.history.editions.len(),
        0,
        "No history is filed before durable ACK"
    );
    let token = session.filing_token().unwrap();
    assert!(session.filing_matches(token, &submission));
    assert!(session.acknowledge_filed(token).unwrap());
    println!("✓ Explicit filing ACK boundary passed (synthetic durable acknowledgement only)");

    // 7. Seam round-trip
    let draft = DossierConversationSeam::session_to_dossier_draft(&session);
    assert_eq!(draft.answers.tone, "Exact author tone");
    println!("✓ Offline dossier seam round-trip passed");

    println!("\nAll native tests passed successfully!");
}
