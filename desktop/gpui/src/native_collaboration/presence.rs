//! Presence DTO/projection foundation. No relay, timer, native overlay or editor mapping.
//! Source wire positions are ProseMirror tree/UTF16 units, NOT native scalar offsets.
//! A future host must verify membership/document scope and implement schema-aware
//! position mapping before any cursor is painted in the native editor.

use crate::native_collaboration::identity::{account_display_name, pick_presence_color};
use std::collections::HashMap;

/// Source `v.number()` wire value in ProseMirror tree/UTF16 units. Signed and
/// fractional values are retained in the DTO; nonfinite projection is refused.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct ProseMirrorPosition(pub f64);

/// Must come from an actual ProseMirror schema document's root content.size.
/// Native plain-text/scalar length is not a substitute. Conversion is unimplemented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProseMirrorContentSize(pub usize);

/// Interval between presence heartbeats (3 seconds).
pub const PRESENCE_INTERVAL_MS: u64 = 3_000;

/// Stale peer cutoff timeout (30 seconds). Peers older than this are omitted from active presence.
pub const PRESENCE_STALE_MS: u64 = 30_000;

/// Maximum line-height proportion of a remote caret (1.4em vs 1.8em manuscript line height).
/// Load-bearing invariant: must never exceed the line height so pagination is unaffected.
pub const REMOTE_CARET_MAX_HEIGHT_EM: f32 = 1.4;

/// Manuscript body text line-height for reference.
pub const MANUSCRIPT_LINE_HEIGHT_EM: f32 = 1.8;

/// Peer presence data received from or sent to the collaboration relay.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceUser {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_pos: Option<ProseMirrorPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_anchor: Option<ProseMirrorPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_head: Option<ProseMirrorPosition>,
    pub last_seen_at: u64,
}

impl PresenceUser {
    pub fn new(user_id: impl Into<String>, display_name: impl Into<String>, now_ms: u64) -> Self {
        let uid = user_id.into();
        let color = pick_presence_color(&uid).to_string();
        Self {
            user_id: uid,
            display_name: display_name.into(),
            color,
            cursor_pos: None,
            selection_anchor: None,
            selection_head: None,
            last_seen_at: now_ms,
        }
    }

    /// Whether this user's presence heartbeat is still fresh.
    #[inline]
    pub fn is_fresh(&self, now_ms: u64) -> bool {
        now_ms.saturating_sub(self.last_seen_at) <= PRESENCE_STALE_MS
    }
}

/// Safe public label and bounded *wire* positions; not a native decoration.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCursor {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_pos: Option<ProseMirrorPosition>,
    /// Range `(start, end)` of the active selection, if anchor != head.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_range: Option<(ProseMirrorPosition, ProseMirrorPosition)>,
}

/// Locally retained peer snapshots. Host document-scope/accepted-membership
/// checks and timer scheduling are deliberately not implemented here.
#[derive(Debug, Clone, Default)]
pub struct DocumentPresenceRoster {
    peers: HashMap<String, PresenceUser>,
}

impl DocumentPresenceRoster {
    pub fn new() -> Self {
        Self {
            peers: HashMap::new(),
        }
    }

    /// Updates or inserts a peer's presence state.
    pub fn update_peer(&mut self, peer: PresenceUser) {
        self.peers.insert(peer.user_id.clone(), peer);
    }

    /// Records a heartbeat for a specific user ID.
    pub fn record_heartbeat(
        &mut self,
        user_id: &str,
        display_name: &str,
        cursor_pos: Option<ProseMirrorPosition>,
        selection_anchor: Option<ProseMirrorPosition>,
        selection_head: Option<ProseMirrorPosition>,
        now_ms: u64,
    ) {
        let entry = self
            .peers
            .entry(user_id.to_string())
            .or_insert_with(|| PresenceUser::new(user_id, display_name, now_ms));

        entry.display_name = display_name.to_string();
        entry.cursor_pos = cursor_pos;
        entry.selection_anchor = selection_anchor;
        entry.selection_head = selection_head;
        entry.last_seen_at = now_ms;
    }

    /// Removes a collaborator when they leave or unshare.
    pub fn remove_peer(&mut self, user_id: &str) -> Option<PresenceUser> {
        self.peers.remove(user_id)
    }

    /// Clears all peers (e.g. when unsharing or closing the document).
    pub fn clear(&mut self) {
        self.peers.clear();
    }

    /// Returns all fresh, active peers (filtered by the 30s timeout), sorted deterministically by user ID.
    pub fn active_users(&self, now_ms: u64) -> Vec<&PresenceUser> {
        let mut active: Vec<&PresenceUser> =
            self.peers.values().filter(|p| p.is_fresh(now_ms)).collect();
        active.sort_by(|a, b| a.user_id.cmp(&b.user_id));
        active
    }

    /// Projects fresh peer DTOs using Source PM bounds and safe public account labels.
    /// Does not authorize peers, create native decorations or map local document edits.
    ///
    /// Excludes the local user (via `local_user_id`) so the writer's own caret is not duplicated.
    pub fn generate_remote_cursors(
        &self,
        content_size: ProseMirrorContentSize,
        local_user_id: Option<&str>,
        now_ms: u64,
    ) -> Vec<RemoteCursor> {
        let mut cursors = Vec::new();

        for peer in self.active_users(now_ms) {
            if local_user_id.is_some_and(|local_id| peer.user_id == local_id) {
                continue;
            }

            let root_end = content_size.0 as f64;
            // Source caret allows root end+1 and ignores negative positions.
            let clamped_cursor = peer
                .cursor_pos
                .filter(|p| p.0.is_finite() && p.0 >= 0.0)
                .map(|p| ProseMirrorPosition(p.0.min(root_end + 1.0)));
            let clamped_selection = match (peer.selection_anchor, peer.selection_head) {
                (Some(a), Some(h)) if a.0.is_finite() && h.0.is_finite() && a != h => {
                    let from = a.0.min(h.0).min(root_end).max(0.0);
                    let to = a.0.max(h.0).min(root_end).max(from);
                    // A collapsed projection produces no visible native range.
                    (from < to).then_some((ProseMirrorPosition(from), ProseMirrorPosition(to)))
                }
                _ => None,
            };

            cursors.push(RemoteCursor {
                user_id: peer.user_id.clone(),
                display_name: account_display_name(Some(&peer.display_name), None, None, None),
                color: peer.color.clone(),
                cursor_pos: clamped_cursor,
                selection_range: clamped_selection,
            });
        }

        cursors
    }
}
