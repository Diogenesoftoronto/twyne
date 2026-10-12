//! Unintegrated offline protocol foundation. Pure projections and typed DTOs
//! do not provide live sharing, verified authentication or publishing. Native
//! cursor conversion and transport/session/ACK integration remain unimplemented.

pub mod error;
pub mod identity;
pub mod presence;
pub mod publishing;
pub mod roles;
pub mod sharing;
pub mod transport;

// Re-export common types and constants
pub use error::CollaborationError;
pub use identity::{
    PRESENCE_COLORS, WriterMetadata, account_display_name, account_initials, account_name,
    pick_presence_color,
};
pub use presence::{
    DocumentPresenceRoster, MANUSCRIPT_LINE_HEIGHT_EM, PRESENCE_INTERVAL_MS, PRESENCE_STALE_MS,
    PresenceUser, ProseMirrorContentSize, ProseMirrorPosition, REMOTE_CARET_MAX_HEIGHT_EM,
    RemoteCursor,
};
pub use publishing::{
    AtprotoPublishReceipt, ConvexPublishPlan, ConvexPublishReceipt, PublishKind,
    STANDARD_SITE_DOCUMENT_COLLECTION, STANDARD_SITE_ORIGIN, STANDARD_SITE_PUBLICATION_COLLECTION,
    format_micropub_body, is_atproto_did, is_tid, parse_at_uri, prepare_convex_publish,
    sanitize_html, slugify, standard_site_document_url, standard_site_publication_url,
    validate_micropub_endpoint,
};
pub use roles::{
    Collaborator, CollaboratorRole, CollaboratorStatus, validate_invitation, validate_removal,
    validate_role_update,
};
pub use sharing::{
    InviteCollaboratorPlan, InviteCollaboratorResult, PromoteFolioPlan, SharedSession,
    SharingPhase, prepare_invitation, prepare_promote_folio,
};
pub use transport::{NativeCollaborationTransport, OfflineLoopbackTransport};

#[cfg(test)]
#[path = "../../fixtures/native-collaboration/native-collaboration-tests.rs"]
mod tests;
