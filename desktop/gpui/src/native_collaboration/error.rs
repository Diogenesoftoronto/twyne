//! Typed error definitions for Twyne native collaboration, presence, and publishing contracts.
//!
//! Sourced from Source-authoritative behaviors in `src/utils/collaboration.ts`,
//! `convex/collaboration.ts`, `src/utils/standard-site.ts`, and `src/utils/micropub.ts`.

use std::fmt;

/// Strongly-typed failure states for native collaboration, presence, and publishing.
///
/// Invariants:
/// - Explicit failure before network rather than faking connected operation.
/// - Clear attribution of role permission deficiencies.
/// - Unalterable owner privileges.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollaborationError {
    /// Action requires an authenticated user identity, but caller is anonymous or unauthenticated.
    AuthRequired(&'static str),

    /// The requested operation requires a Pro subscription (e.g. promoting a folio to shared).
    ProRequired,

    /// Permission denied: caller role does not have permission for the operation.
    PermissionDenied {
        required_role: &'static str,
        actual_role: String,
    },

    /// Invalid collaborator role transition.
    InvalidRoleTransition {
        from: String,
        to: String,
        reason: &'static str,
    },

    /// The owner record cannot be removed or downgraded.
    OwnerCannotBeModified,

    /// Invalid email address for invitation.
    InvalidEmail(String),

    /// Invalid ATProto DID format.
    InvalidDid(String),

    /// Invalid ATProto Record Key (TID) format.
    InvalidTid(String),

    /// Invalid AT-URI format.
    InvalidAtUri(String),

    /// Insecure Micropub endpoint (HTTPS required, unless localhost / 127.0.0.1).
    InsecureMicropubEndpoint(String),

    /// Missing required bearer token for single-request dispatch.
    MissingToken(&'static str),

    /// Active manuscript draft snapshot is still opening or not ready.
    DraftSnapshotNotReady,

    /// Capability unavailable in the current native runtime or offline slice.
    CapabilityUnavailable {
        capability: &'static str,
        reason: String,
    },

    /// Network operations are not configured or offline; fails before network rather than faking success.
    OfflineBeforeNetwork {
        endpoint: String,
        operation: &'static str,
    },

    /// Operation was cancelled by caller or lifecycle transition.
    Cancelled,
}

impl fmt::Display for CollaborationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AuthRequired(msg) => write!(f, "Authentication required: {msg}"),
            Self::ProRequired => write!(f, "Sharing documents is a Pro feature."),
            Self::PermissionDenied {
                required_role,
                actual_role,
            } => {
                write!(
                    f,
                    "Permission denied: requires {required_role} role, but caller has {actual_role}"
                )
            }
            Self::InvalidRoleTransition { from, to, reason } => {
                write!(f, "Cannot change role from {from} to {to}: {reason}")
            }
            Self::OwnerCannotBeModified => write!(f, "Cannot change or remove the owner's role."),
            Self::InvalidEmail(email) => write!(f, "A valid email is required (got '{email}')."),
            Self::InvalidDid(did) => write!(f, "Invalid ATProto DID: '{did}'"),
            Self::InvalidTid(tid) => write!(f, "Invalid ATProto record key (TID): '{tid}'"),
            Self::InvalidAtUri(uri) => write!(f, "Invalid AT-URI: '{uri}'"),
            Self::InsecureMicropubEndpoint(url) => {
                write!(f, "Micropub endpoints must use HTTPS (got '{url}').")
            }
            Self::MissingToken(what) => write!(f, "Missing required token for {what}."),
            Self::DraftSnapshotNotReady => {
                write!(f, "The manuscript is still opening. Try sharing again.")
            }
            Self::CapabilityUnavailable { capability, reason } => {
                write!(f, "Capability '{capability}' unavailable: {reason}")
            }
            Self::OfflineBeforeNetwork {
                endpoint,
                operation,
            } => {
                write!(
                    f,
                    "Offline guard: cannot perform {operation} against '{endpoint}' without active native transport."
                )
            }
            Self::Cancelled => write!(f, "Operation was cancelled."),
        }
    }
}

impl std::error::Error for CollaborationError {}
