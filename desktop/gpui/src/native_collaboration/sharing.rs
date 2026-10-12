//! Sharing request/snapshot foundation only. No blob promotion, accepted membership,
//! remote merge, local-draft arbitration, canonical reconciliation or ACK lifecycle.
//! Role/Pro checks use caller-supplied metadata and are local policy previews.

use crate::native_collaboration::error::CollaborationError;
use crate::native_collaboration::identity::WriterMetadata;
use crate::native_collaboration::presence::DocumentPresenceRoster;
use crate::native_collaboration::roles::{
    Collaborator, CollaboratorRole, validate_invitation, validate_removal, validate_role_update,
};

/// Phase of a document in the sharing lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SharingPhase {
    /// Purely local manuscript, not shared on any server.
    Local,
    /// Promotion to shared document is currently in progress.
    Promoting,
    /// Host-supplied shared configuration; the enum is not connection evidence.
    Shared {
        lix_id: String,
        server_url: String,
        my_role: CollaboratorRole,
    },
    /// Teardown / unsharing is currently in progress.
    Unsharing,
}

/// Prepared plan for promoting a local folio to a shared Lix document.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteFolioPlan {
    pub folio_id: String,
    pub folio_name: String,
    pub lix_id: String,
    pub server_url: String,
    pub draft_html: String,
}

/// Prepared plan for inviting a collaborator.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCollaboratorPlan {
    pub lix_id: String,
    pub folio_name: String,
    pub email: String,
    pub role: CollaboratorRole,
}

/// Result returned from an invitation action.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCollaboratorResult {
    pub already_invited: bool,
    pub role: CollaboratorRole,
    pub email_delivered: bool,
}

/// Prepares a request preview from an already captured snapshot, retaining exact
/// scope/content. Pro metadata is unverified and no server blob is constructed.
pub fn prepare_promote_folio(
    writer: &WriterMetadata,
    folio_id: &str,
    folio_name: &str,
    draft_html: &str,
    lix_id: &str,
    convex_site_url: &str,
) -> Result<PromoteFolioPlan, CollaborationError> {
    if !writer.is_pro {
        return Err(CollaborationError::ProRequired);
    }

    // Source readiness tests missing HTML, not blank prose. A supplied empty
    // string is a valid captured draft; the host must obtain the explicit snapshot.
    if folio_id.is_empty() || lix_id.is_empty() {
        return Err(CollaborationError::CapabilityUnavailable {
            capability: "sharing_scope",
            reason: "Exact folio and Lix IDs are required; no active-document alias is inferred."
                .into(),
        });
    }
    let server_url = format!("{convex_site_url}/lsp");

    Ok(PromoteFolioPlan {
        folio_id: folio_id.to_string(),
        folio_name: folio_name.to_string(),
        lix_id: lix_id.to_string(),
        server_url,
        draft_html: draft_html.to_string(),
    })
}

/// Prepares and validates an invitation for a collaborator.
pub fn prepare_invitation(
    actor: &WriterMetadata,
    actor_role: CollaboratorRole,
    lix_id: &str,
    folio_name: &str,
    email: &str,
    target_role: CollaboratorRole,
) -> Result<InviteCollaboratorPlan, CollaborationError> {
    let sanitized_email = validate_invitation(actor_role, actor.is_pro, email, target_role)?;

    Ok(InviteCollaboratorPlan {
        lix_id: lix_id.to_string(),
        folio_name: folio_name.to_string(),
        email: sanitized_email,
        role: target_role,
    })
}

/// Retained host configuration and local observations, not an active session.
#[derive(Debug, Clone)]
pub struct SharedSession {
    pub lix_id: String,
    pub folio_id: String,
    pub folio_name: String,
    pub server_url: String,
    pub my_role: CollaboratorRole,
    pub collaborators: Vec<Collaborator>,
    pub presence: DocumentPresenceRoster,
    pub last_polled_html: Option<String>,
    pub last_polled_source: Option<String>,
}

impl SharedSession {
    pub fn new(
        lix_id: impl Into<String>,
        folio_id: impl Into<String>,
        folio_name: impl Into<String>,
        server_url: impl Into<String>,
        my_role: CollaboratorRole,
    ) -> Self {
        Self {
            lix_id: lix_id.into(),
            folio_id: folio_id.into(),
            folio_name: folio_name.into(),
            server_url: server_url.into(),
            my_role,
            collaborators: Vec::new(),
            presence: DocumentPresenceRoster::new(),
            last_polled_html: None,
            last_polled_source: None,
        }
    }

    /// Adds or updates a collaborator in the roster.
    pub fn upsert_collaborator(&mut self, collab: Collaborator) {
        if let Some(existing) = self
            .collaborators
            .iter_mut()
            .find(|c| c.user_id == collab.user_id)
        {
            *existing = collab;
        } else {
            self.collaborators.push(collab);
        }
    }

    /// Removes a collaborator, ensuring owner validation.
    pub fn remove_collaborator(
        &mut self,
        actor_role: CollaboratorRole,
        target_user_id: &str,
    ) -> Result<bool, CollaborationError> {
        let Some(pos) = self
            .collaborators
            .iter()
            .position(|c| c.user_id == target_user_id)
        else {
            return Ok(false);
        };

        let target_role = self.collaborators[pos].role;
        validate_removal(actor_role, target_role)?;

        self.collaborators.remove(pos);
        self.presence.remove_peer(target_user_id);
        Ok(true)
    }

    /// Updates a collaborator's role, ensuring owner validation.
    pub fn update_collaborator_role(
        &mut self,
        actor_role: CollaboratorRole,
        target_user_id: &str,
        new_role: CollaboratorRole,
    ) -> Result<bool, CollaborationError> {
        let Some(target) = self
            .collaborators
            .iter_mut()
            .find(|c| c.user_id == target_user_id)
        else {
            return Ok(false);
        };

        validate_role_update(actor_role, target.role, new_role)?;
        target.role = new_role;
        Ok(true)
    }

    /// Evaluates whether an incoming remote draft snapshot contains new remote changes.
    ///
    /// Returns `Some((html, source))` if the incoming content differs from the last polled snapshot.
    /// This only deduplicates observations. It never applies to the editor and
    /// does not protect pending local drafts or reconcile canonical Source.
    pub fn observe_remote_snapshot(
        &mut self,
        incoming_html: &str,
        incoming_source: Option<&str>,
    ) -> Option<(String, Option<String>)> {
        let html_differs = self
            .last_polled_html
            .as_deref()
            .is_none_or(|h| h != incoming_html);
        let source_differs = self.last_polled_source.as_deref() != incoming_source;

        if !html_differs && !source_differs {
            return None;
        }

        self.last_polled_html = Some(incoming_html.to_string());
        self.last_polled_source = incoming_source.map(str::to_string);

        Some((
            incoming_html.to_string(),
            incoming_source.map(str::to_string),
        ))
    }
}
