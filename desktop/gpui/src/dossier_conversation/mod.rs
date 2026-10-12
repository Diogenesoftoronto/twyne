//! Twyne Dossier Conversation, Contextual Amendments, and Gathering State.
//!
//! Provides the conversational interview alternative to the ten-step form,
//! contextual drift observation parsing and author-retained amendments,
//! gathering state (prior material, document/link references, probe progression),
//! brief history transitions, and an unapplied seam into existing offline
//! storage and recovery.

pub mod amendment;
pub mod gathering;
pub mod protocol;
pub mod seam;
pub mod session;

#[cfg(test)]
#[path = "../../fixtures/dossier-host-review/native-lifecycle-tests.rs"]
mod host_lifecycle_tests;

#[cfg(feature = "desktop")]
pub mod view;

pub use crate::workspace::{AttachmentKind, BriefField, DossierProbe, ProbeAnswer, ProbeKind};
pub use amendment::{
    AmendmentState, BriefChangeRecord, BriefEdition, BriefHistory, DossierAmendedEvent,
    MAX_BRIEF_EDITIONS, compute_brief_changes,
};
pub use gathering::{
    GatheringState, build_imported_material_document, build_starter_document, count_filled_fields,
    upsert_probe,
};
pub use protocol::{
    BRIEF_FIELDS, BriefFieldKey, DOSSIER_AMEND_SYSTEM_PROMPT, DossierAmendRequest,
    DossierCheckResult, DossierObservation, FieldConfidenceMap, InterviewConfidence,
    InterviewDossierDraft, InterviewMessage, InterviewTurnResult, MAX_AMEND_CHARS, MessageAuthor,
    OPENING_QUESTION, PartialAnswers, REFINE_OPENING_QUESTION, SYNTHESIZE_NUDGE, TaggedJsonSegment,
    clean_dossier_amend_response, extract_tagged_json, field_key, find_first_balanced_json_object,
    normalize_interview_dossier_draft, parse_brief_field, parse_dossier_check_result,
    parse_interview_turn_response, strip_json_fences, strip_reasoning_tags, strip_tagged_json,
};
pub use seam::DossierConversationSeam;
pub use session::{ConversationMode, ConversationOptions, ConversationSession, Synthesis};

#[cfg(feature = "desktop")]
pub use view::{
    DossierConversationCapabilities, DossierConversationEvent, DossierConversationView,
};
