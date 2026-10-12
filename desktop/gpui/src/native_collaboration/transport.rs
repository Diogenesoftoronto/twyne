//! Transport interface only. The offline adapter cannot dispatch or issue receipts.
//! Caller metadata and requested configuration are never credential or membership proof.

use super::{
    CollaborationError, CollaboratorRole, ProseMirrorPosition, WriterMetadata,
    publishing::{
        AtprotoPublishReceipt, ConvexPublishPlan, ConvexPublishReceipt, is_atproto_did, is_tid,
        validate_micropub_endpoint,
    },
    roles::{validate_removal, validate_role_update},
    sharing::{InviteCollaboratorPlan, InviteCollaboratorResult, PromoteFolioPlan},
};

/// A future connected implementation must verify the server session and accepted
/// document membership independently of every supplied label, role and entitlement.
/// These synchronous signatures do not implement ACK/lifecycle/revision guards.
pub trait NativeCollaborationTransport {
    fn promote_folio(
        &self,
        writer: &WriterMetadata,
        plan: &PromoteFolioPlan,
    ) -> Result<PromoteFolioPlan, CollaborationError>;
    fn invite_collaborator(
        &self,
        writer: &WriterMetadata,
        plan: &InviteCollaboratorPlan,
    ) -> Result<InviteCollaboratorResult, CollaborationError>;
    fn remove_collaborator(
        &self,
        writer: &WriterMetadata,
        actor_role: CollaboratorRole,
        target_role: CollaboratorRole,
    ) -> Result<bool, CollaborationError>;
    fn update_role(
        &self,
        writer: &WriterMetadata,
        actor_role: CollaboratorRole,
        target_role: CollaboratorRole,
        new_role: CollaboratorRole,
    ) -> Result<bool, CollaborationError>;
    #[allow(clippy::too_many_arguments)]
    fn send_heartbeat(
        &self,
        writer: &WriterMetadata,
        lix_id: &str,
        cursor_pos: Option<ProseMirrorPosition>,
        selection_anchor: Option<ProseMirrorPosition>,
        selection_head: Option<ProseMirrorPosition>,
        now_ms: u64,
    ) -> Result<(), CollaborationError>;
    fn unshare_folio(
        &self,
        writer: &WriterMetadata,
        actor_role: CollaboratorRole,
        lix_id: &str,
    ) -> Result<(), CollaborationError>;
    fn publish_convex(
        &self,
        writer: &WriterMetadata,
        plan: &ConvexPublishPlan,
        slug: &str,
        owner_handle: Option<&str>,
        origin: &str,
    ) -> Result<ConvexPublishReceipt, CollaborationError>;
    fn publish_atproto(
        &self,
        writer: &WriterMetadata,
        did: &str,
        pub_rkey: &str,
        doc_rkey: &str,
        origin: Option<&str>,
    ) -> Result<AtprotoPublishReceipt, CollaborationError>;
    /// A borrowed token is not stored by this adapter. This signature cannot
    /// establish how a future caller obtains, retains or protects credentials.
    fn publish_micropub(
        &self,
        endpoint: &str,
        ephemeral_token: &str,
        title: &str,
        html: &str,
    ) -> Result<String, CollaborationError>;
}

/// Offline policy probe. Even `new(true, true)` has no authenticated transport
/// and always refuses dispatch. No method fabricates an invite/send/publish ACK.
#[derive(Debug, Clone)]
pub struct OfflineLoopbackTransport {
    pub requested_auth_connection: bool,
    pub requested_network: bool,
    pub is_cancelled: bool,
}

impl OfflineLoopbackTransport {
    pub fn new(requested_auth_connection: bool, requested_network: bool) -> Self {
        Self {
            requested_auth_connection,
            requested_network,
            is_cancelled: false,
        }
    }

    fn unavailable<T>(
        &self,
        operation: &'static str,
        endpoint: &str,
    ) -> Result<T, CollaborationError> {
        if self.is_cancelled {
            return Err(CollaborationError::Cancelled);
        }
        if !self.requested_auth_connection {
            return Err(CollaborationError::AuthRequired(
                "Native authentication capability is not configured; account labels are not credentials.",
            ));
        }
        if !self.requested_network {
            return Err(CollaborationError::OfflineBeforeNetwork {
                endpoint: endpoint.to_owned(),
                operation,
            });
        }
        Err(CollaborationError::CapabilityUnavailable {
            capability: operation,
            reason: "No native authenticated transport is implemented. Configuration flags cannot verify a session, dispatch a request or accept a receipt.".into(),
        })
    }
}

impl NativeCollaborationTransport for OfflineLoopbackTransport {
    fn promote_folio(
        &self,
        writer: &WriterMetadata,
        plan: &PromoteFolioPlan,
    ) -> Result<PromoteFolioPlan, CollaborationError> {
        if !writer.is_pro {
            return Err(CollaborationError::ProRequired);
        }
        self.unavailable("promote_folio", &plan.server_url)
    }

    fn invite_collaborator(
        &self,
        writer: &WriterMetadata,
        _plan: &InviteCollaboratorPlan,
    ) -> Result<InviteCollaboratorResult, CollaborationError> {
        if !writer.is_pro {
            return Err(CollaborationError::ProRequired);
        }
        self.unavailable("invite_collaborator", "/collaboration/invite")
    }

    fn remove_collaborator(
        &self,
        _writer: &WriterMetadata,
        actor_role: CollaboratorRole,
        target_role: CollaboratorRole,
    ) -> Result<bool, CollaborationError> {
        validate_removal(actor_role, target_role)?;
        self.unavailable("remove_collaborator", "/collaboration/remove")
    }

    fn update_role(
        &self,
        _writer: &WriterMetadata,
        actor_role: CollaboratorRole,
        target_role: CollaboratorRole,
        new_role: CollaboratorRole,
    ) -> Result<bool, CollaborationError> {
        validate_role_update(actor_role, target_role, new_role)?;
        self.unavailable("update_role", "/collaboration/update-role")
    }

    fn send_heartbeat(
        &self,
        _writer: &WriterMetadata,
        lix_id: &str,
        _cursor_pos: Option<ProseMirrorPosition>,
        _selection_anchor: Option<ProseMirrorPosition>,
        _selection_head: Option<ProseMirrorPosition>,
        _now_ms: u64,
    ) -> Result<(), CollaborationError> {
        self.unavailable("heartbeat", lix_id)
    }

    fn unshare_folio(
        &self,
        _writer: &WriterMetadata,
        actor_role: CollaboratorRole,
        lix_id: &str,
    ) -> Result<(), CollaborationError> {
        if !actor_role.can_unshare() {
            return Err(CollaborationError::PermissionDenied {
                required_role: "owner",
                actual_role: actor_role.as_str().into(),
            });
        }
        self.unavailable("unshare_folio", lix_id)
    }

    fn publish_convex(
        &self,
        _writer: &WriterMetadata,
        _plan: &ConvexPublishPlan,
        _slug: &str,
        _owner_handle: Option<&str>,
        origin: &str,
    ) -> Result<ConvexPublishReceipt, CollaborationError> {
        self.unavailable("publish_convex", origin)
    }

    fn publish_atproto(
        &self,
        _writer: &WriterMetadata,
        did: &str,
        pub_rkey: &str,
        doc_rkey: &str,
        _origin: Option<&str>,
    ) -> Result<AtprotoPublishReceipt, CollaborationError> {
        if !is_atproto_did(did) {
            return Err(CollaborationError::InvalidDid(did.into()));
        }
        for key in [pub_rkey, doc_rkey] {
            if !is_tid(key) {
                return Err(CollaborationError::InvalidTid(key.into()));
            }
        }
        self.unavailable("publish_atproto", "atproto://repo")
    }

    fn publish_micropub(
        &self,
        endpoint: &str,
        ephemeral_token: &str,
        _title: &str,
        _html: &str,
    ) -> Result<String, CollaborationError> {
        let valid_endpoint = validate_micropub_endpoint(endpoint)?;
        if super::identity::trim_js(ephemeral_token).is_empty() {
            return Err(CollaborationError::MissingToken("Micropub access"));
        }
        self.unavailable("publish_micropub", &valid_endpoint)
    }
}
