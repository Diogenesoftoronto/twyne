//! Authored/unrun deterministic lease/receipt protocol tests. Constructing a
//! matching receipt here is not an actual GPUI draw, presentation or GPU fence.
use super::*;
use image::{Frame, Rgba, RgbaImage};

fn image() -> Arc<RenderImage> {
    Arc::new(RenderImage::new(vec![Frame::new(RgbaImage::from_pixel(
        1,
        1,
        Rgba([0, 0, 0, 255]),
    ))]))
}

fn install(ledger: &mut Ledger, consumer: u64, images: &[Arc<RenderImage>]) {
    assert!(
        ledger
            .replace(consumer, bounded_images(images).unwrap())
            .unwrap()
    );
}

// Model ONLY the qualified full-refresh + marker-paint inputs, not execution
// of those GPUI operations. The production marker does not expose this seam.
fn receipt(ledger: &mut Ledger) -> u64 {
    ledger.invalidation_queued = false;
    ledger.invalidated_epoch = Some(ledger.epoch);
    ledger
        .paint_receipt()
        .expect("A refreshed pending group needs a receipt")
}

#[test]
fn removal_waits_for_full_refresh_and_marker() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    let old = image();
    install(&mut ledger, owner, std::slice::from_ref(&old));
    install(&mut ledger, owner, &[]);
    assert!(ledger.paint_receipt().is_none());
    assert!(ledger.retire_after_frame(ledger.epoch).is_empty());
    ledger.invalidated_epoch = Some(ledger.epoch);
    ledger.invalidation_queued = true;
    assert!(ledger.paint_receipt().is_none());
    let ready = receipt(&mut ledger);
    assert!(
        ledger.images.contains_key(&old.id),
        "Marker itself must not evict during paint"
    );
    let retired = ledger.retire_after_frame(ready);
    assert_eq!(retired.len(), 1);
    assert!(Arc::ptr_eq(&retired[0], &old));
    assert!(ledger.images.is_empty());
    assert!(
        ledger.retire_after_frame(ready).is_empty(),
        "Duplicate receipts are neutral"
    );
}

#[test]
fn stale_receipt_cannot_evict_newer_generation_or_clear_its_marker() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    let first = image();
    install(&mut ledger, owner, std::slice::from_ref(&first));
    install(&mut ledger, owner, &[]);
    let late = receipt(&mut ledger);
    let second = image();
    install(&mut ledger, owner, std::slice::from_ref(&second));
    install(&mut ledger, owner, &[]);
    let current = receipt(&mut ledger);
    assert!(ledger.retire_after_frame(late).is_empty());
    assert_eq!(ledger.retirement_queued, Some(current));
    let retired: BTreeSet<_> = ledger
        .retire_after_frame(current)
        .iter()
        .map(|image| image.id)
        .collect();
    assert_eq!(retired, [first.id, second.id].into_iter().collect());
}

#[test]
fn cache_reuse_before_retirement_keeps_current_image() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    let cached = image();
    install(&mut ledger, owner, std::slice::from_ref(&cached));
    install(&mut ledger, owner, &[]);
    let late = receipt(&mut ledger);
    install(&mut ledger, owner, std::slice::from_ref(&cached));
    assert!(ledger.retire_after_frame(late).is_empty());
    assert!(ledger.images.contains_key(&cached.id));
    assert!(!ledger.has_pending());
}

#[test]
fn shared_same_window_image_waits_for_last_consumer() {
    let mut ledger = Ledger::default();
    let first = ledger.allocate().unwrap();
    let second = ledger.allocate().unwrap();
    let shared = image();
    install(&mut ledger, first, std::slice::from_ref(&shared));
    install(&mut ledger, second, std::slice::from_ref(&shared));
    assert_eq!(ledger.images.len(), 1);
    assert_eq!(ledger.bytes, 4);
    ledger.retain_only(Some(second)).unwrap();
    assert!(!ledger.has_pending());
    assert!(
        ledger
            .replace(
                first,
                bounded_images(std::slice::from_ref(&shared)).unwrap()
            )
            .is_err(),
        "Retained old form cannot revive a retired lease"
    );
    ledger.retain_only(None).unwrap();
    let ready = receipt(&mut ledger);
    assert_eq!(ledger.retire_after_frame(ready).len(), 1);
}

#[test]
fn distinct_window_ledgers_retire_independently_even_with_same_arc() {
    let mut first = Ledger::default();
    let mut second = Ledger::default();
    let a = first.allocate().unwrap();
    let b = second.allocate().unwrap();
    let shared = image();
    install(&mut first, a, std::slice::from_ref(&shared));
    install(&mut second, b, std::slice::from_ref(&shared));
    first.retain_only(None).unwrap();
    let ready = receipt(&mut first);
    assert_eq!(first.retire_after_frame(ready).len(), 1);
    assert_eq!(second.images.len(), 1);
    assert!(!second.has_pending());
}

#[test]
fn paper_all_eight_stamps_and_optional_multiply_retire_together() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    let old: Vec<_> = (0..10).map(|_| image()).collect();
    let current: Vec<_> = (0..10).map(|_| image()).collect();
    install(&mut ledger, owner, &old);
    install(&mut ledger, owner, &current);
    assert_eq!(ledger.images.len(), 20);
    let ready = receipt(&mut ledger);
    let retired: BTreeSet<_> = ledger
        .retire_after_frame(ready)
        .iter()
        .map(|image| image.id)
        .collect();
    assert_eq!(retired, old.iter().map(|image| image.id).collect());
    assert_eq!(ledger.images.len(), 10);
    assert_eq!(ledger.bytes, 40);
    // Transparent foxing removes its optional image without changing the stamp
    // set; model it as the last slot absent, preserving the other nine IDs.
    install(&mut ledger, owner, &current[..9]);
    let ready = receipt(&mut ledger);
    let retired = ledger.retire_after_frame(ready);
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].id, current[9].id);
}

#[test]
fn unchanged_preparation_does_not_create_invalidation_or_epoch_churn() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    let current = image();
    install(&mut ledger, owner, std::slice::from_ref(&current));
    let epoch = ledger.epoch;
    assert!(
        !ledger
            .replace(owner, bounded_images(&[current]).unwrap())
            .unwrap()
    );
    assert_eq!(ledger.epoch, epoch);
    assert!(!ledger.has_pending());
}

#[test]
fn queue_limit_refuses_before_changing_active_preparation() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    let mut current = image();
    install(&mut ledger, owner, std::slice::from_ref(&current));
    for _ in 1..MAX_TRACKED_IMAGES {
        current = image();
        install(&mut ledger, owner, std::slice::from_ref(&current));
    }
    let epoch = ledger.epoch;
    let refused = image();
    assert!(
        ledger
            .replace(
                owner,
                bounded_images(std::slice::from_ref(&refused)).unwrap()
            )
            .is_err()
    );
    assert_eq!(ledger.epoch, epoch);
    assert_eq!(ledger.consumers[&owner], [current.id].into_iter().collect());
    assert!(!ledger.images.contains_key(&refused.id));
    let ready = receipt(&mut ledger);
    assert_eq!(
        ledger.retire_after_frame(ready).len(),
        MAX_TRACKED_IMAGES - 1
    );
    install(&mut ledger, owner, &[refused]); // retry after a real qualified boundary
}

#[test]
fn byte_and_key_budget_arithmetic_is_bounded_and_overflow_safe() {
    assert!(fits_count(MAX_TRACKED_IMAGES - 1, 1));
    assert!(!fits_count(MAX_TRACKED_IMAGES, 1));
    assert!(!fits_count(usize::MAX, 1));
    assert!(fits_bytes(MAX_TRACKED_BYTES - 4, 4));
    assert!(!fits_bytes(MAX_TRACKED_BYTES - 3, 4));
    assert!(!fits_bytes(usize::MAX, 4));
}

#[test]
fn consumer_budget_retires_without_identity_reuse() {
    let mut ledger = Ledger::default();
    let owners: Vec<_> = (0..MAX_CONSUMERS)
        .map(|_| ledger.allocate().unwrap())
        .collect();
    assert!(ledger.allocate().is_err());
    ledger.retain_only(Some(owners[0])).unwrap();
    let next = ledger.allocate().unwrap();
    assert!(next > *owners.last().unwrap());
    assert!(ledger.replace(owners[1], BTreeMap::new()).is_err());
    assert!(ledger.retain_only(Some(owners[1])).is_err());
}

#[test]
fn malformed_duplicate_or_excessive_sets_are_refused() {
    let empty = Arc::new(RenderImage::new(vec![Frame::new(RgbaImage::new(0, 1))]));
    assert!(bounded_images(&[empty]).is_err());
    let many: Vec<_> = (0..11).map(|_| image()).collect();
    assert!(bounded_images(&many).is_err());
    let original = image();
    assert_eq!(
        bounded_images(&[original.clone(), original.clone()])
            .unwrap()
            .len(),
        1
    );
    let mut changed = RenderImage::new(vec![Frame::new(RgbaImage::from_pixel(
        1,
        1,
        Rgba([2, 3, 4, 255]),
    ))]);
    changed.id = original.id;
    let changed = Arc::new(changed);
    assert!(bounded_images(&[original.clone(), changed.clone()]).is_err());
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    install(&mut ledger, owner, &[original]);
    assert!(
        ledger
            .replace(owner, bounded_images(&[changed]).unwrap())
            .is_err()
    );
}

#[test]
fn close_refuses_late_marker_and_releases_cpu_accounting_only() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    install(&mut ledger, owner, &[image()]);
    ledger.retain_only(None).unwrap();
    let late = receipt(&mut ledger);
    ledger.close();
    assert!(ledger.retire_after_frame(late).is_empty());
    assert!(ledger.paint_receipt().is_none());
    assert_eq!(ledger.bytes, 0);
    assert!(ledger.allocate().is_err());
    assert!(ledger.replace(owner, BTreeMap::new()).is_err());
}

#[test]
fn epoch_and_consumer_exhaustion_fail_closed_without_aba() {
    let mut ledger = Ledger::default();
    let owner = ledger.allocate().unwrap();
    install(&mut ledger, owner, &[image()]);
    install(&mut ledger, owner, &[]);
    let late = receipt(&mut ledger);
    ledger.epoch = u64::MAX;
    assert!(
        ledger
            .replace(owner, bounded_images(&[image()]).unwrap())
            .is_err()
    );
    assert!(ledger.retire_after_frame(late).is_empty());
    assert!(ledger.exhausted);
    let mut ledger = Ledger {
        next_consumer: u64::MAX,
        ..Ledger::default()
    };
    assert!(ledger.allocate().is_err());
    assert!(ledger.exhausted);
}
