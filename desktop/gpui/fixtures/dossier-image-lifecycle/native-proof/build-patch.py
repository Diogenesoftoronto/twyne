#!/usr/bin/env python3
"""Prepare an unapplied observation patch. Never writes a shared source file."""

import difflib
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]


def once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError(f"Source seam changed; expected one occurrence: {before[:100]!r}")
    return source.replace(before, after, 1)


def lifecycle(source):
    source = once(source, "pub const MAX_CONSUMERS: usize = 4;", '''#[cfg(feature = "ui-tests")]
#[path = "../fixtures/dossier-image-lifecycle/native-proof/diagnostic_hooks.rs"]
mod native_proof;

pub const MAX_CONSUMERS: usize = 4;''')
    source = once(source, "    ledger: Ledger,\n}\nimpl State", '''    ledger: Ledger,
    #[cfg(feature = "ui-tests")]
    native_proof: native_proof::Trace,
}
impl State''')
    source = once(source, "            ledger: Ledger::default(),\n", '''            ledger: Ledger::default(),
            #[cfg(feature = "ui-tests")]
            native_proof: native_proof::Trace::default(),
''')
    source = once(source, '''        Ok(DossierImageLease {
            state: Rc::downgrade(&self.state),
            consumer: state.ledger.allocate()?,
        })''', '''        let consumer = state.ledger.allocate()?;
        #[cfg(feature = "ui-tests")]
        state.proof_record(window, "lease_allocated", serde_json::json!({
            "consumerId": consumer.to_string(),
        }));
        Ok(DossierImageLease {
            state: Rc::downgrade(&self.state),
            consumer,
        })''')
    source = once(source, '''            state.ledger.retain_only(keep.map(|lease| lease.consumer))?
''', '''            let changed = state.ledger.retain_only(keep.map(|lease| lease.consumer))?;
            #[cfg(feature = "ui-tests")]
            if changed {
                state.proof_record(window, "mount_set_accepted", serde_json::json!({
                    "keptConsumerId": keep.map(|lease| lease.consumer.to_string()),
                }));
            }
            changed
''')
    source = once(source, '''                    shared.ledger.paint_receipt()
''', '''                    let receipt = shared.ledger.paint_receipt();
                    #[cfg(feature = "ui-tests")]
                    if let Some(receipt) = receipt {
                        shared.proof_record(window, "marker_receipt", serde_json::json!({
                            "receipt": receipt.to_string(),
                        }));
                    }
                    receipt
''')
    source = once(source, '''                        shared.ledger.retire_after_frame(receipt)
''', '''                        let images = shared.ledger.retire_after_frame(receipt);
                        #[cfg(feature = "ui-tests")]
                        shared.proof_record(window, "deferred_retirement", serde_json::json!({
                            "receipt": receipt.to_string(),
                            "removedImageIds": images.iter().map(|image| image.id.0.to_string()).collect::<Vec<_>>(),
                        }));
                        images
''')
    source = once(source, '''                        if let Err(error) = window.drop_image(image.clone()) {
''', '''                        #[cfg(feature = "ui-tests")]
                        let present_before = window.has_image_atlas_entry(&image);
                        // Exactly the existing production eviction, once.
                        let result = window.drop_image(image.clone());
                        #[cfg(feature = "ui-tests")]
                        shared.borrow_mut().proof_record(window, "atlas_drop", serde_json::json!({
                            "receipt": receipt.to_string(),
                            "imageId": image.id.0.to_string(),
                            "presentBefore": present_before,
                            "presentAfter": window.has_image_atlas_entry(&image),
                            "dropSucceeded": result.is_ok(),
                        }));
                        if let Err(error) = result {
''')
    source = once(source, '''            state.ledger.replace(self.consumer, incoming)?
''', '''            let changed = state.ledger.replace(self.consumer, incoming)?;
            #[cfg(feature = "ui-tests")]
            if changed {
                state.proof_record(window, "prepared_set_accepted", serde_json::json!({
                    "consumerId": self.consumer.to_string(),
                }));
            }
            changed
''')
    source = once(source, '''        state.ledger.invalidation_queued = true;
''', '''        state.ledger.invalidation_queued = true;
        #[cfg(feature = "ui-tests")]
        state.proof_record(window, "refresh_queued", serde_json::json!({}));
''')
    source = once(source, '''        state.ledger.invalidated_epoch = Some(state.ledger.epoch);
''', '''        state.ledger.invalidated_epoch = Some(state.ledger.epoch);
        #[cfg(feature = "ui-tests")]
        state.proof_record(window, "refresh_applied", serde_json::json!({}));
''')
    return source


def app(source):
    return once(source, '''    pub fn open_first_dossier(&mut self, window: &mut Window, cx: &mut Context<Self>) {
''', '''    #[cfg(feature = "ui-tests")]
    pub fn capture_dossier_image_lifecycle(&self, window: &Window, cx: &App) -> Option<serde_json::Value> {
        let mut snapshot = self.dossier_images.as_ref()?.diagnostic_snapshot(window, cx)?;
        snapshot["surface"] = serde_json::json!({
            "dossierRetained": self.dossier.is_some(),
            "dossierMounted": self.dossier.is_some() && !self.standalone_route(),
            "standaloneRoute": self.standalone_route(),
        });
        Some(snapshot)
    }

    pub fn open_first_dossier(&mut self, window: &mut Window, cx: &mut Context<Self>) {
''')


def capture(source):
    source = once(source, "match write_geometry(window, &path, cx, &room)", "match write_geometry(window, &path, cx, &room, 1)")
    source = once(source, '''            if watch {
                observe_next_frame(window, path, room);
            }''', '''            if watch {
                observe_next_frame(window, path, room, 2);
            }''')
    source = once(source, '''fn observe_next_frame(window: &mut Window, path: PathBuf, room: WeakEntity<WritingRoom>) {''', '''fn observe_next_frame(window: &mut Window, path: PathBuf, room: WeakEntity<WritingRoom>, sequence: u64) {''')
    source = once(source, "if let Err(error) = write_geometry(window, &path, cx, &room)", "if let Err(error) = write_geometry(window, &path, cx, &room, sequence)")
    source = once(source, '''        } else {
            observe_next_frame(window, path, room);
        }''', '''        } else if let Some(next) = sequence.checked_add(1) {
            observe_next_frame(window, path, room, next);
        } else {
            eprintln!("TWYNE_CAPTURE_GEOMETRY_ERROR: observation sequence exhausted");
        }''')
    source = once(source, '''    room: &WeakEntity<WritingRoom>,
) -> anyhow::Result<()>''', '''    room: &WeakEntity<WritingRoom>,
    sequence: u64,
) -> anyhow::Result<()>''')
    source = once(source, '''        "viewport": {"width": f32::from(viewport.width), "height": f32::from(viewport.height)},''', '''        "captureSequence": sequence.to_string(),
        "windowId": window.window_handle().window_id().as_u64().to_string(),
        "scaleFactor": window.scale_factor(),
        "dossierImageLifecycle": room.upgrade().and_then(|room| room.read(cx).capture_dossier_image_lifecycle(window, cx)),
        "viewport": {"width": f32::from(viewport.width), "height": f32::from(viewport.height)},''')
    return source


def main():
    changes = {
        "desktop/gpui/src/dossier_image_lifecycle.rs": lifecycle,
        "desktop/gpui/src/app.rs": app,
        "desktop/gpui/src/capture_geometry.rs": capture,
    }
    patch = []
    pins = {}
    for relative, transform in changes.items():
        original = (ROOT / relative).read_text(encoding="utf8")
        candidate = transform(original)
        pins[relative] = hashlib.sha256(original.encode()).hexdigest()
        patch.append(f"diff --git a/{relative} b/{relative}\n")
        patch.extend(difflib.unified_diff(original.splitlines(keepends=True), candidate.splitlines(keepends=True),
            fromfile=f"a/{relative}", tofile=f"b/{relative}", n=3))
    (HERE / "integration.patch").write_text("".join(patch), encoding="utf8")
    (HERE / "patch-base.json").write_text(json.dumps({"schema": 1, "sourceSha256": pins}, indent=2) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
