//! Unapplied ui-tests-only observation hooks. No image owners or evictions.
//!
//! Loaded as a private child of dossier_image_lifecycle only after Parent
//! applies integration.patch. The observations concern atlas KEYS, not GPU
//! completion, successful presentation, texture bytes, or a process-wide cap.

use super::*;
use serde_json::{Value, json};
use std::collections::VecDeque;

pub(super) const EVENT_LIMIT: usize = 128;
pub(super) const IMAGE_LIMIT: usize = MAX_TRACKED_IMAGES;

#[derive(Default)]
pub(super) struct Trace {
    rows: VecDeque<Value>,
    sequence: u64,
    dropped: u64,
    sequence_exhausted: bool,
}

impl Trace {
    fn push(&mut self, mut row: Value) {
        let Some(sequence) = self.sequence.checked_add(1) else {
            self.sequence_exhausted = true;
            return;
        };
        self.sequence = sequence;
        row["sequence"] = json!(sequence.to_string());
        if self.rows.len() == EVENT_LIMIT {
            self.rows.pop_front();
            self.dropped = self.dropped.saturating_add(1);
        }
        self.rows.push_back(row);
    }
}

impl State {
    /// At most IMAGE_LIMIT rows. IDs/metadata only; no extra image Arc owner.
    fn proof_images(&self, window: &Window) -> Vec<Value> {
        self.ledger
            .images
            .iter()
            .take(IMAGE_LIMIT)
            .map(|(id, image)| {
                let dimensions = image.image.size(0);
                json!({
                    "id": id.0.to_string(),
                    "consumerIds": image.consumers.iter().map(u64::to_string).collect::<Vec<_>>(),
                    "active": !image.consumers.is_empty(),
                    "frameCount": image.image.frame_count(),
                    "pixelWidth": dimensions.width.0,
                    "pixelHeight": dimensions.height.0,
                    "bytes": image.image.as_bytes(0).map_or(0, <[u8]>::len),
                    "atlasPresent": window.has_image_atlas_entry(&image.image),
                })
            })
            .collect()
    }

    pub(super) fn proof_record(&mut self, window: &Window, stage: &'static str, details: Value) {
        let pending = self
            .ledger
            .images
            .values()
            .filter(|image| image.consumers.is_empty())
            .count();
        let images = self.proof_images(window);
        self.native_proof.push(json!({
            "stage": stage,
            "registryWindowId": self.window.as_u64().to_string(),
            "windowId": window.window_handle().window_id().as_u64().to_string(),
            "windowQualified": self.window == window.window_handle().window_id(),
            "epoch": self.ledger.epoch.to_string(),
            "consumerCount": self.ledger.consumers.len(),
            "trackedCount": self.ledger.images.len(),
            "activeCount": self.ledger.images.len() - pending,
            "pendingCount": pending,
            "invalidationQueued": self.ledger.invalidation_queued,
            "invalidatedEpoch": self.ledger.invalidated_epoch.map(|epoch| epoch.to_string()),
            "retirementQueued": self.ledger.retirement_queued.map(|epoch| epoch.to_string()),
            "images": images,
            "imagesTruncated": self.ledger.images.len().saturating_sub(IMAGE_LIMIT),
            "details": details,
        }));
    }
}

impl DossierImageLifecycle {
    /// Capture tool only: same real WindowId + App TextSystem qualification as
    /// production ownership. Sampling does not refresh, paint or drop a key.
    pub fn diagnostic_snapshot(&self, window: &Window, cx: &App) -> Option<Value> {
        let state = self.state.borrow();
        if !state.matches(window, cx) {
            return None;
        }
        let pending = state
            .ledger
            .images
            .values()
            .filter(|image| image.consumers.is_empty())
            .count();
        Some(json!({
            "schemaVersion": 1,
            "windowId": state.window.as_u64().to_string(),
            "applicationQualified": true,
            "epoch": state.ledger.epoch.to_string(),
            "consumerIds": state.ledger.consumers.keys().map(u64::to_string).collect::<Vec<_>>(),
            "consumerCount": state.ledger.consumers.len(),
            "trackedCount": state.ledger.images.len(),
            "activeCount": state.ledger.images.len() - pending,
            "pendingCount": pending,
            "trackedBytes": state.ledger.bytes,
            "closed": state.ledger.closed,
            "exhausted": state.ledger.exhausted,
            "invalidationQueued": state.ledger.invalidation_queued,
            "invalidatedEpoch": state.ledger.invalidated_epoch.map(|epoch| epoch.to_string()),
            "retirementQueued": state.ledger.retirement_queued.map(|epoch| epoch.to_string()),
            "images": state.proof_images(window),
            "imageLimit": IMAGE_LIMIT,
            "imagesTruncated": state.ledger.images.len().saturating_sub(IMAGE_LIMIT),
            "eventLimit": EVENT_LIMIT,
            "eventCount": state.native_proof.rows.len(),
            "eventsDropped": state.native_proof.dropped.to_string(),
            "latestEventSequence": state.native_proof.sequence.to_string(),
            "eventSequenceExhausted": state.native_proof.sequence_exhausted,
            "events": state.native_proof.rows,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncation_and_counter_exhaustion_are_explicit() {
        let mut trace = Trace::default();
        for _ in 0..=EVENT_LIMIT {
            trace.push(json!({"stage": "bounded-observation"}));
        }
        assert_eq!(trace.rows.len(), EVENT_LIMIT);
        assert_eq!(trace.dropped, 1);
        assert_eq!(trace.rows.front().unwrap()["sequence"], "2");
        assert_eq!(trace.rows.back().unwrap()["sequence"], "129");
        trace.sequence = u64::MAX;
        trace.push(json!({"stage": "not-emitted"}));
        assert!(trace.sequence_exhausted);
        assert_eq!(trace.rows.len(), EVENT_LIMIT);
        assert_eq!(trace.dropped, 1);
    }
}
