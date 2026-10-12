# Actual Dossier atlas-key lifecycle proof

Status: **authored, unapplied, uncompiled and unexecuted**. Parent owns all Cargo,
native/display and provider execution. Python AST parsing, owned Rust syntax
formatting and patch apply-check are the worker's only executable checks.

The earlier `../parent-gates.json` records Root's **13 model tests**. It remains
independent of this product proof. Constructed ledger receipts do not establish
the actual marker, atlas-key removal, scene presentation or GPU completion.
Previous failed probes and that receipt are not rewritten by this fixture.

## Diagnostic seam

`integration.patch` proposes changes only to:

- `src/dossier_image_lifecycle.rs`: a private child module/State trace behind
  `cfg(feature = "ui-tests")`; observations at the **existing** accepted lease,
  prepared-set, mount, refresh, marker, deferred-retirement and `drop_image`
  boundaries. There is still exactly one production `drop_image` per retired
  image, no added eviction or refresh, and no image Arc held by diagnostics.
- `src/app.rs`: one ui-tests-only snapshot getter qualifying the actual window
  and existing retained/mounted Dossier state; it performs no route/input action.
- `src/capture_geometry.rs`: actual WindowId/DPR, a monotonic observation
  sequence and the lifecycle snapshot in the existing capture tool. Its watcher
  still observes ordinary frames and does not force a frame or fake a fence.

`diagnostic_hooks.rs` is compiled as that private child only in a ui-tests
build. The capture snapshot has schema version **1**, 64 image rows maximum and
128 trace rows maximum. `imagesTruncated`, `eventsDropped` and sequence
exhaustion are explicit. Window IDs, image IDs, epochs and counters use decimal
strings to preserve integers in JSON. Image metadata is bounded dimensions,
frame/byte/consumer counts and actual `Window::has_image_atlas_entry` results;
no manuscript, answer, image pixels, credentials or arbitrary error text are
added to the trace. The existing capture tool retains its normal local input
values independently.

For each retired ID, the driver requires this observed chain within the same
real window/epoch, in sequence order:

1. Accepted preparation or mount change leaves the image pending.
2. The existing deferred full `window.refresh()` runs and invalidates that epoch.
3. The **actual persistent marker** returns its qualified receipt, with the old
   uploaded key still present and the pending image no longer active.
4. The existing deferred callback removes that same pending ID from the ledger.
5. The **real existing `drop_image`** is called once; `contains` is observed
   immediately before and after, with `presentAfter == false` and success.

Prepared-only stamp variants are recorded honestly with `presentBefore ==
false`. They are not described as uploaded images that were reclaimed. Active
shared stamp IDs must remain present across a paper-only resize. The driver
retains every observed row in bounded JSONL and fails if the ring drops any
row before it was observed; truncation cannot silently weaken the ordering gate.

This is **atlas-key/CPU-frame-boundary evidence only**. The WGPU `contains`
implementation reads atlas mutex state. Neither it nor this marker acknowledges
presentation, GPU queue completion, tile-coordinate safety in arbitrary paths,
bind-group lifetime, texture/driver reclamation, global VRAM, or a process-wide
CPU/GPU byte bound. Diagnostic queries can affect timing; this is not a race
stress or occlusion/device-recovery test.

## Actual driver and retained evidence

`check-native.py` loads the hash-pinned existing
`fixtures/dossier-native/check-native.py` **as a library**, without running its
main. It reuses its fresh `Xvfb -displayfd -nolisten tcp`, allowlisted private
environment, real XTEST, actual CLI import and clean-exit checks. Caller DISPLAY,
account/provider credentials and user session addresses are not inherited.
Output must be a fresh nonexistent directory. No real provider or fabricated
successful renderer/converter/recovery action is supplied.

The authored scenario uses the existing product controls:

- CLI-import exact `retained.typ`; inspect canonical/source/provenance bytes.
- Real title and multiline reader inputs; existing section buttons **0–7**
  paint every count stamp without replacing the nine prepared image IDs.
- Resize the **owned actual X window** from observed 1280×860 to 1100×780 and
  back at **observed DPR1**; verify only paper replacement, qualified old-key
  retirement and actual same-ImageId CPU-cache reupload. Verify the live answers.
- Cancel the actual File popup; require unchanged mounted lease/keys.
- Deliberately damage **only that private library's identified recovery file**,
  retaining its exact original bytes. Actual Escape and actual File→Dossier &
  House context must refuse departure, preserve keys and retain input. Restore
  that exact owned copy, including on failure; no success response is invented.
- The successful existing House route must unmount and retire keys. Actual
  House→desk→Create Dossier must allocate a new consumer, reuse cache IDs and
  upload the painted keys while recovering exact answers.
- Successful actual Dossier cancellation, then actual drawer→Settings preset
  **Nightpress**→Back→Create Dossier, followed by actual **Editorial** return.
  Verify durable appearance records, distinct palette preparations, honest
  retirement and reuse/reupload of the retained CPU-cache IDs.
- Actual unblurred Ctrl-S, Ctrl-Q, a new process opening the same copied folio,
  exact scoped answers and another clean Ctrl-Q. No cross-process ImageId or
  post-close atlas/GPU claim.

Every click requires two **distinct capture sequences with identical actual
target/question/sheet/window bounds**, a visible enabled target and observed
scroll clipping. Bounded real pointer motion requests ordinary input processing
while waiting; it is not a debug refresh API. Scroll uses actual observed drawer
bounds and at most 18 wheel batches. Each condition has a 20-second deadline;
event retention is capped at 1024 rows. Missing hooks/controls, stale geometry,
unexpected keys, truncation or a timing failure are failures, not skips/passes.

Outputs include `acceptance.json`, actual geometry snapshots for stamp/count,
resize/refusal/route/palette/relaunch states, contiguous
`observed-lifecycle.jsonl`, original and actual manuscript/recovery/appearance
copies and native/display logs. Failures retain observations and the traceback
before stopping only the owned processes. Forced cleanup is never accepted as
a clean quit. The driver does not yet capture or compare screenshots; key
presence and interaction/canonical evidence are independent of raster parity.

## Decisive-control limitation

The current Dossier hides the drawer. Its File menu has **Dossier & House
context**, but no Settings action or keybinding. Therefore this actual driver
does **not** inject an `open_settings` action to manufacture the retained-form
Settings→Back path. Root's new `resume_image_lifecycle` host correction requires
an independent mounted gate: retain the **same** form/input entity through
Settings; retire old keys through real frames; Back must prepare current
palette/DPR and attach a new lease before remount; refusal stays in Settings.
That unexecuted host gate must not be counted as this driver's theme proof.

Other pending boundaries: actual DPR transitions, two windows or shared
consumers, occluded→visible, failed surface/device recovery, WM close and
sustained memory/timing stress. No new product controls are proposed here.

## Parent-only review and execution

`patch-base.json` pins the exact shared-file inputs for this unapplied patch;
`source-pins.json` pins the source/API/helper provenance and independent model
receipt. `freeze.json` and `SHA256SUMS` pin the fixture artifacts. The driver
checks the helper pin and accepts an explicit immutable binary hash. A source
pin is not proof that an arbitrary binary was built from it; Parent must retain
its actual build/source receipt.

Review before applying; do not regenerate a frozen patch against changed files
without re-review. From the project root:

```sh
rtk proxy git apply --check desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/integration.patch
rtk proxy git apply desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/integration.patch
```

Parent formats its shared files, then runs the existing model and the additional
bounded-diagnostic test:

```sh
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib dossier_image_lifecycle -- --test-threads=1
rtk proxy devenv shell -- rtk proxy cargo clippy --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --all-targets -- -D warnings
```

After Parent builds/pins the actual ui-tests executable and bundled document
helper in its normal native environment, run only on the driver's owned display:

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/check-native.py --binary /absolute/parent-reviewed/twyne-desktop --expected-binary-sha256 PARENT_BINARY_SHA256 --output /absolute/fresh/nonexistent/proof-directory
```

No command above has been executed as a native/Cargo gate by this worker.
