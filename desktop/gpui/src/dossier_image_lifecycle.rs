//! Proposed, unregistered per-window ownership for prepared Dossier images.
//!
//! This retires atlas KEYS after the ordinary pinned GPUI frame path replaces
//! its CPU scene. It does not acknowledge presentation or GPU completion, evict
//! another window's atlas, bound all GPU textures, or rasterize in paint/input.
//! All Dossier consumers of an image in this window must use the same registry.
//! See fixtures/dossier-image-lifecycle/README.md before integrating.

use gpui_kit::prelude::*;
use gpui_kit::{
    App, Canvas, ImageId, RenderImage, Result, Subscription, TextSystem, Window, WindowId, canvas,
};
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::{Rc, Weak},
    sync::{Arc, Weak as SyncWeak},
};

#[cfg(feature = "ui-tests")]
#[path = "../fixtures/dossier-image-lifecycle/native-proof/diagnostic_hooks.rs"]
mod native_proof;

pub const MAX_CONSUMERS: usize = 4;
pub const MAX_IMAGES_PER_CONSUMER: usize = 10; // paper + eight stamps + optional foxing
pub const MAX_TRACKED_IMAGES: usize = 64;
pub const MAX_TRACKED_BYTES: usize = 256 * 1024 * 1024;

struct TrackedImage {
    image: Arc<RenderImage>,
    consumers: BTreeSet<u64>,
}

#[derive(Default)]
struct Ledger {
    next_consumer: u64,
    epoch: u64,
    consumers: BTreeMap<u64, BTreeSet<ImageId>>,
    images: BTreeMap<ImageId, TrackedImage>,
    bytes: usize,
    invalidation_queued: bool,
    invalidated_epoch: Option<u64>,
    retirement_queued: Option<u64>,
    closed: bool,
    exhausted: bool,
}

impl Ledger {
    fn usable(&self) -> Result<()> {
        anyhow::ensure!(!self.closed, "Dossier image window is closed");
        anyhow::ensure!(!self.exhausted, "Dossier image epoch is exhausted");
        Ok(())
    }

    fn allocate(&mut self) -> Result<u64> {
        self.usable()?;
        anyhow::ensure!(
            self.consumers.len() < MAX_CONSUMERS,
            "Too many Dossier image consumers"
        );
        let Some(next) = self.next_consumer.checked_add(1) else {
            self.exhausted = true;
            anyhow::bail!("Dossier image consumer identity is exhausted");
        };
        self.next_consumer = next;
        self.consumers.insert(next, BTreeSet::new());
        Ok(next)
    }

    fn advance(&mut self) -> Result<()> {
        let Some(next) = self.epoch.checked_add(1) else {
            self.exhausted = true;
            self.invalidated_epoch = None;
            self.retirement_queued = None;
            anyhow::bail!("Dossier image epoch is exhausted");
        };
        self.epoch = next;
        self.invalidated_epoch = None;
        Ok(())
    }

    fn replace(
        &mut self,
        consumer: u64,
        incoming: BTreeMap<ImageId, Arc<RenderImage>>,
    ) -> Result<bool> {
        self.usable()?;
        let old = self
            .consumers
            .get(&consumer)
            .ok_or_else(|| anyhow::anyhow!("Dossier image consumer is retired"))?;
        let ids: BTreeSet<_> = incoming.keys().copied().collect();
        let mut added_bytes = 0_usize;
        let mut added_count = 0_usize;
        for (id, image) in &incoming {
            if let Some(existing) = self.images.get(id) {
                anyhow::ensure!(
                    Arc::ptr_eq(&existing.image, image),
                    "Dossier image ID was reused for different bytes"
                );
            } else {
                added_count += 1;
                added_bytes = added_bytes
                    .checked_add(image.as_bytes(0).unwrap().len())
                    .ok_or_else(|| anyhow::anyhow!("Dossier image byte budget overflow"))?;
            }
        }
        anyhow::ensure!(
            fits_count(self.images.len(), added_count),
            "Dossier image retirement queue is full"
        );
        anyhow::ensure!(
            fits_bytes(self.bytes, added_bytes),
            "Dossier image retirement bytes exceed their budget"
        );
        if old == &ids {
            return Ok(false);
        }
        self.advance()?;
        let old = self.consumers.insert(consumer, ids).unwrap();
        for id in old {
            self.images
                .get_mut(&id)
                .unwrap()
                .consumers
                .remove(&consumer);
        }
        for (id, image) in incoming {
            self.images
                .entry(id)
                .or_insert_with(|| TrackedImage {
                    image,
                    consumers: BTreeSet::new(),
                })
                .consumers
                .insert(consumer);
        }
        self.bytes += added_bytes;
        Ok(true)
    }

    fn retain_only(&mut self, keep: Option<u64>) -> Result<bool> {
        self.usable()?;
        anyhow::ensure!(
            keep.is_none_or(|id| self.consumers.contains_key(&id)),
            "The mounted Dossier image consumer is retired"
        );
        let retired: Vec<_> = self
            .consumers
            .keys()
            .copied()
            .filter(|id| Some(*id) != keep)
            .collect();
        if retired.is_empty() {
            return Ok(false);
        }
        self.advance()?;
        for id in retired {
            for image in self.consumers.remove(&id).unwrap() {
                self.images.get_mut(&image).unwrap().consumers.remove(&id);
            }
        }
        Ok(true)
    }

    fn has_pending(&self) -> bool {
        self.images.values().any(|image| image.consumers.is_empty())
    }

    fn paint_receipt(&mut self) -> Option<u64> {
        if self.closed
            || self.exhausted
            || self.invalidation_queued
            || self.invalidated_epoch != Some(self.epoch)
            || self.retirement_queued == Some(self.epoch)
            || !self.has_pending()
        {
            return None;
        }
        self.retirement_queued = Some(self.epoch);
        Some(self.epoch)
    }

    fn retire_after_frame(&mut self, receipt: u64) -> Vec<Arc<RenderImage>> {
        if self.retirement_queued != Some(receipt) {
            return Vec::new();
        }
        self.retirement_queued = None;
        if self.closed
            || self.exhausted
            || self.invalidation_queued
            || self.epoch != receipt
            || self.invalidated_epoch != Some(receipt)
        {
            return Vec::new();
        }
        let retired: Vec<_> = self
            .images
            .iter()
            .filter_map(|(id, image)| image.consumers.is_empty().then_some(*id))
            .collect();
        retired
            .into_iter()
            .map(|id| {
                let image = self.images.remove(&id).unwrap().image;
                self.bytes -= image.as_bytes(0).unwrap().len();
                image
            })
            .collect()
    }

    fn close(&mut self) {
        self.closed = true;
        self.consumers.clear();
        self.images.clear();
        self.bytes = 0;
        self.invalidated_epoch = None;
        self.retirement_queued = None;
        self.invalidation_queued = false;
    }
}

fn fits_count(current: usize, added: usize) -> bool {
    current
        .checked_add(added)
        .is_some_and(|total| total <= MAX_TRACKED_IMAGES)
}
fn fits_bytes(current: usize, added: usize) -> bool {
    current
        .checked_add(added)
        .is_some_and(|total| total <= MAX_TRACKED_BYTES)
}

fn bounded_images(images: &[Arc<RenderImage>]) -> Result<BTreeMap<ImageId, Arc<RenderImage>>> {
    anyhow::ensure!(
        images.len() <= MAX_IMAGES_PER_CONSUMER,
        "Dossier prepared set has too many images"
    );
    let mut incoming = BTreeMap::new();
    for image in images {
        let size = image.size(0);
        anyhow::ensure!(
            image.frame_count() == 1 && size.width.0 > 0 && size.height.0 > 0,
            "Dossier prepared images must have exactly one nonempty frame"
        );
        let bytes = image
            .as_bytes(0)
            .ok_or_else(|| anyhow::anyhow!("Dossier image has no pixels"))?;
        let expected = (size.width.0 as usize)
            .checked_mul(size.height.0 as usize)
            .and_then(|pixels| pixels.checked_mul(4));
        anyhow::ensure!(
            expected == Some(bytes.len()) && bytes.len() <= MAX_TRACKED_BYTES,
            "Invalid or oversized Dossier image bytes"
        );
        if let Some(previous) = incoming.insert(image.id, image.clone()) {
            anyhow::ensure!(
                Arc::ptr_eq(&previous, image),
                "Dossier image ID collides within the prepared set"
            );
        }
    }
    Ok(incoming)
}

struct State {
    window: WindowId,
    text_system: SyncWeak<TextSystem>,
    ledger: Ledger,
    #[cfg(feature = "ui-tests")]
    native_proof: native_proof::Trace,
}
impl State {
    fn matches(&self, window: &Window, cx: &App) -> bool {
        self.window == window.window_handle().window_id()
            && std::ptr::eq(self.text_system.as_ptr(), Arc::as_ptr(cx.text_system()))
    }
}

/// One per WritingRoom/window; do not construct separate registries for
/// consumers of the same prepared images within that window.
#[derive(Clone)]
pub struct DossierImageLifecycle {
    state: Rc<RefCell<State>>,
    _closed_subscription: Rc<Subscription>,
    _quit_subscription: Rc<Subscription>,
}

/// Captured identity, not a strong entity/window/application handle. A lease
/// retired at actual unmount cannot be revived by a retained old Dossier.
#[derive(Clone)]
pub struct DossierImageLease {
    state: Weak<RefCell<State>>,
    consumer: u64,
}

impl DossierImageLifecycle {
    pub fn new(window: &Window, cx: &App) -> Result<Self> {
        anyhow::ensure!(
            cfg!(any(target_os = "linux", target_os = "freebsd")),
            "Dossier atlas ownership is audited only for Linux/FreeBSD WGPU"
        );
        let state = Rc::new(RefCell::new(State {
            window: window.window_handle().window_id(),
            text_system: Arc::downgrade(cx.text_system()),
            ledger: Ledger::default(),
            #[cfg(feature = "ui-tests")]
            native_proof: native_proof::Trace::default(),
        }));
        let weak = Rc::downgrade(&state);
        let subscription = cx.on_window_closed(move |_, window| {
            if let Some(state) = weak.upgrade() {
                let mut state = state.borrow_mut();
                if state.window == window {
                    // The window is already inaccessible. This releases CPU
                    // accounting only; it is not an atlas/GPU-idle receipt.
                    state.ledger.close();
                }
            }
        });
        let weak = Rc::downgrade(&state);
        let quit_subscription = cx.on_app_quit(move |_| {
            if let Some(state) = weak.upgrade() {
                state.borrow_mut().ledger.close();
            }
            // Shutdown may clear App.windows without on_window_closed. This
            // still performs no atlas eviction while a scene can be live.
            async {}
        });
        Ok(Self {
            state,
            _closed_subscription: Rc::new(subscription),
            _quit_subscription: Rc::new(quit_subscription),
        })
    }

    pub fn lease(&self, window: &Window, cx: &App) -> Result<DossierImageLease> {
        let mut state = self.state.borrow_mut();
        anyhow::ensure!(
            state.matches(window, cx),
            "Dossier image registry belongs to a different window/application"
        );
        let consumer = state.ledger.allocate()?;
        #[cfg(feature = "ui-tests")]
        state.proof_record(
            window,
            "lease_allocated",
            serde_json::json!({
                "consumerId": consumer.to_string(),
            }),
        );
        Ok(DossierImageLease {
            state: Rc::downgrade(&self.state),
            consumer,
        })
    }

    /// Actual root mount boundary, including successful cancellation/filing/
    /// route departure. Not called when an attempted departure was refused.
    pub fn retain_only(
        &self,
        keep: Option<&DossierImageLease>,
        window: &Window,
        cx: &mut App,
    ) -> Result<()> {
        if let Some(keep) = keep {
            anyhow::ensure!(
                Weak::ptr_eq(&keep.state, &Rc::downgrade(&self.state)),
                "Dossier lease belongs to another registry"
            );
        }
        let changed = {
            let mut state = self.state.borrow_mut();
            anyhow::ensure!(
                state.matches(window, cx),
                "Dossier image registry belongs to a different window/application"
            );
            let changed = state.ledger.retain_only(keep.map(|lease| lease.consumer))?;
            #[cfg(feature = "ui-tests")]
            if changed {
                state.proof_record(
                    window,
                    "mount_set_accepted",
                    serde_json::json!({
                        "keptConsumerId": keep.map(|lease| lease.consumer.to_string()),
                    }),
                );
            }
            changed
        };
        if changed {
            queue_refresh(&self.state, window, cx);
        }
        Ok(())
    }

    /// Mount persistently at the WritingRoom root, including when no Dossier
    /// exists. Absolute and paint-only: no primitive, hitbox or input handler.
    /// A normal pinned App-controlled frame, not manual/nested Window::draw,
    /// is the production boundary required by this marker's defer guarantee.
    pub fn marker(&self) -> Canvas<()> {
        let state = Rc::downgrade(&self.state);
        canvas(
            |_, _, _| (),
            move |_, (), window, cx| {
                let Some(shared) = state.upgrade() else {
                    return;
                };
                let receipt = {
                    let mut shared = shared.borrow_mut();
                    if !shared.matches(window, cx) {
                        return;
                    }
                    let receipt = shared.ledger.paint_receipt();
                    #[cfg(feature = "ui-tests")]
                    if let Some(receipt) = receipt {
                        shared.proof_record(window, "marker_receipt", serde_json::json!({
                            "receipt": receipt.to_string(),
                        }));
                    }
                    receipt
                };
                let Some(receipt) = receipt else {
                    return;
                };
                // The normal platform handle.update encompasses draw + present +
                // arena clear. Its outer App::finish_update runs this effect only
                // after the old rendered_frame has been swapped out and cleared.
                window.defer(cx, move |window, cx| {
                    let Some(shared) = state.upgrade() else {
                        return;
                    };
                    let images = {
                        let mut shared = shared.borrow_mut();
                        if !shared.matches(window, cx) {
                            return;
                        }
                        let images = shared.ledger.retire_after_frame(receipt);
                        #[cfg(feature = "ui-tests")]
                        shared.proof_record(window, "deferred_retirement", serde_json::json!({
                            "receipt": receipt.to_string(),
                            "removedImageIds": images.iter().map(|image| image.id.0.to_string()).collect::<Vec<_>>(),
                        }));
                        images
                    };
                    for image in images {
                        #[cfg(feature = "ui-tests")]
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
                            // Pinned drop_image currently always returns Ok. Keep
                            // an honest retry should a later implementation fail.
                            let mut state = shared.borrow_mut();
                            state.ledger.bytes += image.as_bytes(0).unwrap().len();
                            state.ledger.images.insert(
                                image.id,
                                TrackedImage {
                                    image,
                                    consumers: BTreeSet::new(),
                                },
                            );
                            drop(state);
                            eprintln!("Could not retire Dossier image atlas key: {error:#}");
                            queue_refresh(&shared, window, cx);
                        }
                    }
                });
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }
}

impl DossierImageLease {
    pub fn is_current(&self) -> bool {
        self.state.upgrade().is_some_and(|state| {
            let state = state.borrow();
            !state.ledger.closed
                && !state.ledger.exhausted
                && state.ledger.consumers.contains_key(&self.consumer)
        })
    }

    /// Preparation boundary only. The caller commits its new retained paper/
    /// stamp/foxing pointers only after this succeeds. Refusal preserves the
    /// old lease; it must never be ignored while painting untracked images.
    pub fn replace(
        &self,
        images: &[Arc<RenderImage>],
        window: &Window,
        cx: &mut App,
    ) -> Result<()> {
        let incoming = bounded_images(images)?;
        let state = self
            .state
            .upgrade()
            .ok_or_else(|| anyhow::anyhow!("Dossier image registry was released"))?;
        let changed = {
            let mut state = state.borrow_mut();
            anyhow::ensure!(
                state.matches(window, cx),
                "Dossier image lease belongs to a different window/application"
            );
            let changed = state.ledger.replace(self.consumer, incoming)?;
            #[cfg(feature = "ui-tests")]
            if changed {
                state.proof_record(
                    window,
                    "prepared_set_accepted",
                    serde_json::json!({
                        "consumerId": self.consumer.to_string(),
                    }),
                );
            }
            changed
        };
        if changed {
            queue_refresh(&state, window, cx);
        }
        Ok(())
    }
}

fn queue_refresh(state: &Rc<RefCell<State>>, window: &Window, cx: &mut App) {
    {
        let mut state = state.borrow_mut();
        if state.ledger.closed || state.ledger.exhausted || state.ledger.invalidation_queued {
            return;
        }
        state.ledger.invalidation_queued = true;
        #[cfg(feature = "ui-tests")]
        state.proof_record(window, "refresh_queued", serde_json::json!({}));
    }
    let weak = Rc::downgrade(state);
    window.defer(cx, move |window, cx| {
        let Some(state) = weak.upgrade() else {
            return;
        };
        let mut state = state.borrow_mut();
        if !state.matches(window, cx) || state.ledger.closed || state.ledger.exhausted {
            return;
        }
        // Runs outside the old draw at the normal outer effect boundary. Full
        // refresh disables cached scene replay in the upcoming normal frame.
        window.refresh();
        state.ledger.invalidation_queued = false;
        state.ledger.invalidated_epoch = Some(state.ledger.epoch);
        #[cfg(feature = "ui-tests")]
        state.proof_record(window, "refresh_applied", serde_json::json!({}));
    });
}

#[cfg(test)]
#[path = "../fixtures/dossier-image-lifecycle/lifecycle_tests.rs"]
mod tests;
