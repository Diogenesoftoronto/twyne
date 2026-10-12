//! Local role-policy previews, not authentication or accepted-membership proof.
//!
//! Authoritative source: `convex/collaboration.ts`.
//!
//! Roles:
//!   - `owner`: full control (invite, remove, change roles, unshare/delete)
//!   - `editor`: read + write document access (Lix push/pull)
//!   - `commenter`: read-only document access + presence (no push allowed)

use crate::native_collaboration::error::CollaborationError;

/// Role assigned to a collaborator on a shared document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollaboratorRole {
    Owner,
    Editor,
    Commenter,
}

impl CollaboratorRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Commenter => "commenter",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "owner" => Some(Self::Owner),
            "editor" => Some(Self::Editor),
            "commenter" => Some(Self::Commenter),
            _ => None,
        }
    }

    /// Whether this role permits pushing edits to the canonical manuscript.
    #[inline]
    pub fn can_write(&self) -> bool {
        matches!(self, Self::Owner | Self::Editor)
    }

    /// Whether this role can invite, remove, or modify roles of other collaborators.
    #[inline]
    pub fn can_manage_collaborators(&self) -> bool {
        matches!(self, Self::Owner)
    }

    /// Whether this role can delete the shared document record or unshare it.
    #[inline]
    pub fn can_unshare(&self) -> bool {
        matches!(self, Self::Owner)
    }

    /// Whether this role can leave comments and marginalia.
    #[inline]
    pub fn can_comment(&self) -> bool {
        matches!(self, Self::Owner | Self::Editor | Self::Commenter)
    }
}

/// Invitation / membership status of a collaborator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollaboratorStatus {
    Pending,
    Accepted,
    Rejected,
}

impl CollaboratorStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "pending" => Some(Self::Pending),
            "accepted" => Some(Self::Accepted),
            "rejected" => Some(Self::Rejected),
            _ => None,
        }
    }

    /// Only accepted collaborators participate in active presence and heartbeats.
    #[inline]
    pub fn is_active_participant(&self) -> bool {
        matches!(self, Self::Accepted)
    }
}

/// Record of a collaborator on a shared document.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collaborator {
    pub user_id: String,
    pub role: CollaboratorRole,
    pub status: CollaboratorStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invited_by: Option<String>,
    pub invited_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_at: Option<u64>,
}

/// Local request validation. Server identity, accepted owner membership and
/// subscription entitlement must be independently verified by a real transport.
pub fn validate_invitation(
    actor_role: CollaboratorRole,
    actor_is_pro: bool,
    email: &str,
    target_role: CollaboratorRole,
) -> Result<String, CollaborationError> {
    if !actor_role.can_manage_collaborators() {
        return Err(CollaborationError::PermissionDenied {
            required_role: "owner",
            actual_role: actor_role.as_str().to_string(),
        });
    }

    if !actor_is_pro {
        return Err(CollaborationError::ProRequired);
    }

    if target_role == CollaboratorRole::Owner {
        return Err(CollaborationError::InvalidRoleTransition {
            from: "none".to_string(),
            to: "owner".to_string(),
            reason: "Cannot invite another collaborator as owner.",
        });
    }

    let trimmed = super::identity::trim_js(email).to_lowercase();
    if trimmed.is_empty() || !trimmed.contains('@') {
        return Err(CollaborationError::InvalidEmail(email.to_string()));
    }

    Ok(trimmed)
}

/// Validates removing a collaborator.
pub fn validate_removal(
    actor_role: CollaboratorRole,
    target_role: CollaboratorRole,
) -> Result<(), CollaborationError> {
    if !actor_role.can_manage_collaborators() {
        return Err(CollaborationError::PermissionDenied {
            required_role: "owner",
            actual_role: actor_role.as_str().to_string(),
        });
    }

    if target_role == CollaboratorRole::Owner {
        return Err(CollaborationError::OwnerCannotBeModified);
    }

    Ok(())
}

/// Validates changing a collaborator's role.
pub fn validate_role_update(
    actor_role: CollaboratorRole,
    current_target_role: CollaboratorRole,
    new_target_role: CollaboratorRole,
) -> Result<(), CollaborationError> {
    if !actor_role.can_manage_collaborators() {
        return Err(CollaborationError::PermissionDenied {
            required_role: "owner",
            actual_role: actor_role.as_str().to_string(),
        });
    }

    if current_target_role == CollaboratorRole::Owner {
        return Err(CollaborationError::OwnerCannotBeModified);
    }

    if new_target_role == CollaboratorRole::Owner {
        return Err(CollaborationError::InvalidRoleTransition {
            from: current_target_role.as_str().to_string(),
            to: "owner".to_string(),
            reason: "Cannot promote a collaborator to owner.",
        });
    }

    Ok(())
}

impl Collaborator {
    /// A role projection only for an accepted row. Parsing a caller-authored row
    /// does not make it server-verified or scoped to the active document.
    pub fn accepted_role(&self) -> Option<CollaboratorRole> {
        self.status.is_active_participant().then_some(self.role)
    }
}
