//! Durable sync intent and conservative conflict staging. This is not the web
//! timestamp merge or a Lix CRDT. It retains divergent/deleted values for explicit
//! resolution. No method writes the native manuscript or proves cloud auth.

use super::{
    auth::{AccountIdentity, SessionLease},
    protocol::{MAX_SAFE_INTEGER, PullSnapshot, SyncPayload, content_rows, rows_by_id},
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const JOURNAL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingPush {
    pub id: Uuid,
    pub desired: SyncPayload,
    pub edit_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dispatch {
    pub id: Uuid,
    pub lease: SessionLease,
    pub expected_revision: u64,
    pub desired: SyncPayload,
    pub arguments: Value,
}

/// Parsed successful pushAll receipt. Transport authenticity is parent-owned.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PushAcknowledgement {
    pub ok: bool,
    pub synced_at: u64,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    DivergentChanges,
    PendingSource,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub section: String,
    pub row_id: Option<String>,
    pub base: Option<Value>,
    pub local: Option<Value>,
    pub remote: Option<Value>,
    pub reason: ConflictReason,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedPull {
    pub id: Uuid,
    pub lease: SessionLease,
    pub edit_generation: u64,
    pub remote: PullSnapshot,
    pub merged: SyncPayload,
    pub conflicts: Vec<Conflict>,
    pub pending_source_folios: BTreeSet<String>,
}

/// Root must construct this only after its actual guarded local Store/Source
/// application succeeds. Field equality is a freshness check, not I/O proof.
#[derive(Clone, Debug)]
pub struct ApplyReceipt {
    pub stage_id: Uuid,
    pub edit_generation: u64,
    pub applied: SyncPayload,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountJournal {
    pub version: u32,
    pub account: AccountIdentity,
    /// Atomic store CAS generation, separate from editor and remote revisions.
    pub generation: u64,
    pub edit_generation: u64,
    pub remote_revision: Option<u64>,
    pub acknowledged: Option<SyncPayload>,
    pub outbox: Option<PendingPush>,
    pub in_flight: Option<Dispatch>,
    /// Ambiguous outcome (or conflict) blocks retransmission until a pull.
    pub needs_pull: bool,
    pub staged: Option<StagedPull>,
    pub conflicts: Vec<Conflict>,
    pub last_remote: Option<PullSnapshot>,
    pub last_synced_at: Option<u64>,
    pub remote_ids: BTreeMap<String, Uuid>,
    /// Native projection/import/recovery metadata has no current cloud DTO.
    #[serde(default)]
    pub local_extensions: BTreeMap<String, Value>,
    #[serde(default, flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl AccountJournal {
    pub fn new(account: AccountIdentity) -> Result<Self> {
        account.validate()?;
        Ok(Self {
            version: JOURNAL_VERSION,
            account,
            generation: 0,
            edit_generation: 0,
            remote_revision: None,
            acknowledged: None,
            outbox: None,
            in_flight: None,
            needs_pull: true,
            staged: None,
            conflicts: vec![],
            last_remote: None,
            last_synced_at: None,
            remote_ids: BTreeMap::new(),
            local_extensions: BTreeMap::new(),
            extra: BTreeMap::new(),
        })
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.version == JOURNAL_VERSION,
            "This account journal version is unsupported; its bytes were left untouched."
        );
        self.account.validate()?;
        ensure!(
            self.extra.keys().all(|key| ![
                "version",
                "account",
                "generation",
                "editGeneration",
                "remoteRevision",
                "acknowledged",
                "outbox",
                "inFlight",
                "needsPull",
                "staged",
                "conflicts",
                "lastRemote",
                "lastSyncedAt",
                "remoteIds",
                "localExtensions"
            ]
            .contains(&key.as_str())),
            "Journal extensions overlap known fields."
        );
        ensure!(
            self.remote_revision
                .is_none_or(|revision| revision <= MAX_SAFE_INTEGER),
            "Invalid remote head."
        );
        ensure!(
            self.acknowledged.is_some() == self.remote_revision.is_some(),
            "The cloud head is missing its observed baseline."
        );
        if let Some(payload) = &self.acknowledged {
            payload.validate()?;
        }
        if let Some(outbox) = &self.outbox {
            outbox.desired.validate()?;
            ensure!(
                outbox.edit_generation == self.edit_generation,
                "Invalid outbox edit generation."
            );
        }
        if let Some(dispatch) = &self.in_flight {
            ensure!(
                self.outbox.is_some(),
                "An in-flight operation must retain its durable local intent."
            );
            ensure!(
                dispatch.lease.account == self.account
                    && Some(dispatch.expected_revision) == self.remote_revision,
                "The in-flight operation does not belong to this cloud head."
            );
            let baseline = self
                .acknowledged
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Missing dispatch baseline."))?;
            ensure!(
                dispatch
                    .desired
                    .push_arguments(baseline, dispatch.expected_revision)?
                    .as_ref()
                    == Some(&dispatch.arguments),
                "The stored dispatch does not match its desired snapshot."
            );
        }
        if let Some(stage) = &self.staged {
            ensure!(
                stage.lease.account == self.account
                    && stage.edit_generation == self.edit_generation,
                "The staged pull is stale."
            );
            stage.remote.validate()?;
            stage.merged.validate()?;
        }
        if let Some(remote) = &self.last_remote {
            remote.validate()?;
        }
        let mut native_ids = BTreeSet::new();
        for (remote, native) in &self.remote_ids {
            ensure!(
                !remote.is_empty() && native_ids.insert(native),
                "Invalid remote/native folio mapping."
            );
        }
        Ok(())
    }

    fn require_lease(&self, lease: &SessionLease, active: Option<&SessionLease>) -> Result<()> {
        lease.require_current(active, &self.account)
    }

    /// Explicit account association boundary. Root must never call this to
    /// silently attach a previous account's/anonymous device library at sign-in.
    /// Latest unsent intent coalesces, while in-flight desired bytes stay fixed.
    pub fn enqueue(&mut self, desired: SyncPayload) -> Result<Uuid> {
        let desired = desired.normalized()?;
        self.edit_generation = self
            .edit_generation
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("The local sync generation is exhausted."))?;
        let id = Uuid::new_v4();
        self.outbox = Some(PendingPush {
            id,
            desired,
            edit_generation: self.edit_generation,
        });
        self.staged = None;
        Ok(id)
    }

    /// Returns the existing immutable dispatch on retry in the same live lease.
    /// A new lease cannot retransmit an old attempt without observing the server.
    /// Persist the returned journal BEFORE handing its request to a transport.
    pub fn prepare_dispatch(
        &mut self,
        lease: &SessionLease,
        active: Option<&SessionLease>,
    ) -> Result<Option<Dispatch>> {
        self.require_lease(lease, active)?;
        ensure!(
            !self.needs_pull && self.staged.is_none() && self.conflicts.is_empty(),
            "Observe or resolve the cloud workspace before sending local changes."
        );
        if let Some(dispatch) = &self.in_flight {
            ensure!(
                &dispatch.lease == lease,
                "A previous session's delivery outcome must be observed before retrying."
            );
            return Ok(Some(dispatch.clone()));
        }
        let Some(pending) = &self.outbox else {
            return Ok(None);
        };
        let baseline = self
            .acknowledged
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The account has not been hydrated."))?;
        let head = self
            .remote_revision
            .ok_or_else(|| anyhow::anyhow!("Missing cloud head."))?;
        let Some(arguments) = pending.desired.push_arguments(baseline, head)? else {
            // Nothing was transmitted. This is an exact observed-baseline match,
            // not an invented remote acknowledgement.
            self.outbox = None;
            return Ok(None);
        };
        let dispatch = Dispatch {
            id: pending.id,
            lease: lease.clone(),
            expected_revision: head,
            desired: pending.desired.clone(),
            arguments,
        };
        self.in_flight = Some(dispatch.clone());
        Ok(Some(dispatch))
    }

    pub fn acknowledge_push(
        &mut self,
        dispatch: &Dispatch,
        active: Option<&SessionLease>,
        receipt: &PushAcknowledgement,
    ) -> Result<()> {
        self.require_lease(&dispatch.lease, active)?;
        ensure!(
            self.in_flight.as_ref() == Some(dispatch),
            "This push acknowledgement is stale."
        );
        ensure!(
            receipt.ok
                && receipt.revision
                    == dispatch
                        .expected_revision
                        .checked_add(1)
                        .ok_or_else(|| anyhow::anyhow!("Invalid push revision."))?
                && receipt.revision <= MAX_SAFE_INTEGER
                && receipt.synced_at <= MAX_SAFE_INTEGER,
            "Invalid push acknowledgement."
        );
        self.acknowledged = Some(dispatch.desired.clone());
        self.remote_revision = Some(receipt.revision);
        self.last_synced_at = Some(receipt.synced_at);
        self.in_flight = None;
        self.needs_pull = false;
        if self
            .outbox
            .as_ref()
            .is_some_and(|pending| pending.id == dispatch.id)
        {
            self.outbox = None;
        }
        Ok(())
    }

    /// Use only when the transport can prove no commit occurred (e.g. explicit
    /// server rejection). Socket loss/timeout after send is an unknown outcome.
    pub fn mark_rejected(
        &mut self,
        dispatch: &Dispatch,
        active: Option<&SessionLease>,
        revision_conflict: bool,
    ) -> Result<()> {
        self.require_lease(&dispatch.lease, active)?;
        ensure!(
            self.in_flight.as_ref() == Some(dispatch),
            "This rejected operation is stale."
        );
        self.in_flight = None;
        self.needs_pull |= revision_conflict;
        Ok(())
    }

    pub fn mark_outcome_unknown(
        &mut self,
        dispatch: &Dispatch,
        active: Option<&SessionLease>,
    ) -> Result<()> {
        self.require_lease(&dispatch.lease, active)?;
        ensure!(
            self.in_flight.as_ref() == Some(dispatch),
            "This uncertain operation is stale."
        );
        self.needs_pull = true;
        Ok(())
    }

    /// On restart/sign-out, an in-flight request must be observed even if its
    /// process never recorded the final outcome. Does not alter source/baseline.
    pub fn suspend_session(&mut self) {
        if self.in_flight.is_some() {
            self.needs_pull = true;
        }
        self.staged = None;
    }

    /// Staging does not acknowledge a cloud write or replace a live manuscript.
    /// Legacy dossier and pull metadata are retained in the exact remote object.
    pub fn stage_pull(
        &mut self,
        lease: &SessionLease,
        active: Option<&SessionLease>,
        remote: PullSnapshot,
        pending_source_folios: BTreeSet<String>,
    ) -> Result<StagedPull> {
        self.require_lease(lease, active)?;
        ensure!(
            self.in_flight.is_none() || self.needs_pull,
            "Wait for the in-flight push before applying a reactive pull."
        );
        remote.validate()?;
        ensure!(
            self.remote_revision
                .is_none_or(|head| remote.sync_revision >= head),
            "This remote snapshot predates the observed cloud head."
        );
        let baseline = self.acknowledged.clone().unwrap_or_default();
        let local = self
            .outbox
            .as_ref()
            .map(|pending| pending.desired.clone())
            .unwrap_or_else(|| baseline.clone());
        let (merged, conflicts) = merge_snapshots(
            &baseline.normalized()?,
            &local.normalized()?,
            &remote.payload.normalized()?,
            &pending_source_folios,
        )?;
        let stage = StagedPull {
            id: Uuid::new_v4(),
            lease: lease.clone(),
            edit_generation: self.edit_generation,
            remote,
            merged,
            conflicts,
            pending_source_folios,
        };
        self.staged = Some(stage.clone());
        Ok(stage)
    }

    /// Root needs a guarded, actual local persistence receipt. Constructed receipt
    /// fields alone must never be surfaced as 'saved' or 'authenticated'.
    pub fn commit_pull(
        &mut self,
        active: Option<&SessionLease>,
        receipt: &ApplyReceipt,
        pending_source_folios: &BTreeSet<String>,
    ) -> Result<()> {
        let stage = self
            .staged
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("There is no staged remote snapshot."))?;
        self.require_lease(&stage.lease, active)?;
        ensure!(
            receipt.stage_id == stage.id
                && receipt.edit_generation == self.edit_generation
                && receipt.edit_generation == stage.edit_generation
                && receipt.applied == stage.merged
                && pending_source_folios == &stage.pending_source_folios,
            "The document or Source draft changed before the remote snapshot was applied."
        );
        let stage = stage.clone();
        let acknowledged = stage.remote.payload.normalized()?;
        self.remote_revision = Some(stage.remote.sync_revision);
        self.acknowledged = Some(acknowledged.clone());
        self.last_remote = Some(stage.remote);
        self.conflicts = stage.conflicts;
        self.in_flight = None;
        self.needs_pull = false;
        self.staged = None;
        self.outbox = if stage.merged == acknowledged {
            None
        } else {
            Some(PendingPush {
                id: Uuid::new_v4(),
                desired: stage.merged,
                edit_generation: self.edit_generation,
            })
        };
        Ok(())
    }

    /// Explicit resolution after Root persists the chosen local document. Require
    /// exact conflict set and edit generation to reject a late dialogue result.
    pub fn resolve_conflicts(
        &mut self,
        lease: &SessionLease,
        active: Option<&SessionLease>,
        expected_conflicts: &[Conflict],
        expected_edit_generation: u64,
        candidate: SyncPayload,
    ) -> Result<()> {
        self.require_lease(lease, active)?;
        ensure!(
            !self.conflicts.is_empty()
                && self.conflicts == expected_conflicts
                && self.edit_generation == expected_edit_generation,
            "The conflict or local document changed before resolution."
        );
        self.enqueue(candidate)?;
        self.conflicts.clear();
        Ok(())
    }

    /// Arbitrary remote string IDs remain stable, independent of native UUIDs.
    /// Persist the new mapping before importing/applying any associated folio.
    pub fn native_id_for(&mut self, remote_id: &str) -> Result<Uuid> {
        ensure!(
            !remote_id.is_empty() && remote_id.len() <= 4096,
            "Invalid remote folio identifier."
        );
        Ok(*self
            .remote_ids
            .entry(remote_id.to_owned())
            .or_insert_with(Uuid::new_v4))
    }
}

fn choose(
    section: &str,
    row_id: Option<&str>,
    base: Option<&Value>,
    local: Option<&Value>,
    remote: Option<&Value>,
    pending: bool,
    conflicts: &mut Vec<Conflict>,
) -> Option<Value> {
    if local == remote || remote == base {
        return local.cloned();
    }
    if !pending && local == base {
        return remote.cloned();
    }
    conflicts.push(Conflict {
        section: section.to_owned(),
        row_id: row_id.map(str::to_owned),
        base: base.cloned(),
        local: local.cloned(),
        remote: remote.cloned(),
        reason: if pending {
            ConflictReason::PendingSource
        } else {
            ConflictReason::DivergentChanges
        },
    });
    local.cloned()
}

fn merge_rows(
    section: &str,
    key: &str,
    base: &[Value],
    local: &[Value],
    remote: &[Value],
    pending: &BTreeSet<String>,
    conflicts: &mut Vec<Conflict>,
) -> Result<Vec<Value>> {
    let before = rows_by_id(base, key)?;
    let left = rows_by_id(local, key)?;
    let right = rows_by_id(remote, key)?;
    let mut order = vec![];
    let mut seen = BTreeSet::new();
    for row in remote.iter().chain(local).chain(base) {
        let id = row
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("Missing sync row identifier."))?;
        if seen.insert(id.to_owned()) {
            order.push(id.to_owned());
        }
    }
    Ok(order
        .iter()
        .filter_map(|id| {
            choose(
                section,
                Some(id),
                before.get(id),
                left.get(id),
                right.get(id),
                pending.contains(id),
                conflicts,
            )
        })
        .collect())
}

/// Whole-value fields and ordered replacement collections remain whole-value;
/// row sections support nonoverlapping changes, deletion, and explicit conflicts.
pub fn merge_snapshots(
    base: &SyncPayload,
    local: &SyncPayload,
    remote: &SyncPayload,
    pending_source_folios: &BTreeSet<String>,
) -> Result<(SyncPayload, Vec<Conflict>)> {
    let mut merged = local.clone();
    let mut conflicts = vec![];
    let empty = BTreeSet::new();
    merged.briefs = merge_rows(
        "briefs",
        "folioId",
        &base.briefs,
        &local.briefs,
        &remote.briefs,
        &empty,
        &mut conflicts,
    )?;
    merged.folio_content = merge_rows(
        "folioContent",
        "folioId",
        &content_rows(base)?,
        &content_rows(local)?,
        &content_rows(remote)?,
        pending_source_folios,
        &mut conflicts,
    )?
    .into_iter()
    .map(serde_json::from_value)
    .collect::<std::result::Result<Vec<_>, _>>()?;
    merged.persona_notes = merge_rows(
        "personaNotes",
        "noteId",
        &base.persona_notes,
        &local.persona_notes,
        &remote.persona_notes,
        &empty,
        &mut conflicts,
    )?;
    merged.persona_replies = merge_rows(
        "personaReplies",
        "replyId",
        &base.persona_replies,
        &local.persona_replies,
        &remote.persona_replies,
        &empty,
        &mut conflicts,
    )?;
    merged.rubric_results = merge_rows(
        "rubricResults",
        "folioId",
        &base.rubric_results,
        &local.rubric_results,
        &remote.rubric_results,
        &empty,
        &mut conflicts,
    )?;
    for section in ["folios", "customPersonas", "bibliography", "extra"] {
        let field = |payload: &SyncPayload| match section {
            "folios" => json!(payload.folios),
            "customPersonas" => json!(payload.custom_personas),
            "bibliography" => json!(payload.bibliography),
            _ => json!(payload.extra),
        };
        let value = choose(
            section,
            None,
            Some(&field(base)),
            Some(&field(local)),
            Some(&field(remote)),
            false,
            &mut conflicts,
        )
        .ok_or_else(|| anyhow::anyhow!("Missing collection value."))?;
        match section {
            "folios" => merged.folios = serde_json::from_value(value)?,
            "customPersonas" => merged.custom_personas = serde_json::from_value(value)?,
            "bibliography" => merged.bibliography = serde_json::from_value(value)?,
            _ => merged.extra = serde_json::from_value(value)?,
        }
    }
    merged.validate()?;
    Ok((merged, conflicts))
}
