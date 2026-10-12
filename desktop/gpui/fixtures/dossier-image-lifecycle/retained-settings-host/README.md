# Retained Dossier → Settings → Back host regression

Status: **authored, unapplied, uncompiled and unexecuted**. Ownership is this NEW
fixture directory only. Existing native-proof files remain frozen and unchanged.
Parent owns patch application, Cargo and native/display execution.

`integration.patch` adds one ui-tests-only Linux/FreeBSD test child to `app.rs`,
using the existing `app::tests::room` helper (`pub(super)`). It changes no normal
production fields, APIs, input, scene handling or route behavior.

The single test
`app::dossier_retained_settings_host::retained_dossier_settings_theme_and_back_keep_actual_title_and_scope`
opens the real manual Dossier through `WritingRoom::open_dossier`, types a
Unicode/combining title through the mounted Kit input and retains:

- the actual `Entity<DossierView>` identity;
- its original public `image_lease()` (weak identity, not extra image Arcs);
- the focused **actual input's** `FocusHandle`, so recreation/hydration of a
  replacement input cannot pass merely by showing the same string;
- the actual public `DossierOptions` and exact `RecoveryIdentity`.

It calls the **actual host `room.open_settings`**, then drives bounded real
headless view draws and App deferred effects. Diagnostics must show the old
consumer/keys retired by the actual persistent marker; no ledger receipt is
constructed and no image or answer callback is mocked. The form entity remains
retained while its Dossier node is unmounted.

The test clicks the actual `settings-preset-nightpress` control and requires the
real appearance store's generation-1 Nightpress record plus the accepted UI
status. That actual palette callback must leave the old lease retired, with an
empty registry and unchanged lifecycle epoch/event sequence. It then clicks
the actual `settings-back` control. The same form must remount with a **new
current lease/consumer**, a current-palette preparation changed from the old
IDs and real painted test-atlas key presence. The old lease must stay retired.

After Back it focuses the actual title control, checks the **same FocusHandle**,
types a suffix, verifies the unblurred accessible field value and calls the
real `flush_recovery`. A separately constructed public `DossierRecovery` loads
the exact scoped disk copy, whose raw identity/title must match. No new product
getter exposes private answer/control state. No provider is connected or
simulated, and the test never files a brief.

## Precise assumptions and proof limits

- Parent first reviews/applies `../native-proof/integration.patch`, providing
  `WritingRoom::capture_dossier_image_lifecycle(window, cx)` with schema version
  1, real marker/drop rows and retained/mounted surface metadata. That proposal
  remains independent and this fixture does not edit or apply it.
- Parent's current `DossierView::resume_image_lifecycle` and actual
  `settings-back` guard are the subject of the regression, not implemented here.
- `tests::room` is `pub(super)`; `session.options` is public; `image_lease`,
  `FocusHandle` equality, actual accessibility snapshots and `DossierRecovery`
  construction/load are the currently read APIs. Type lookup is **uncompiled**.
- Six draw/effect rounds are a bounded scheduling gate. `TestWindowExt` calls
  `draw().clear()` and `simulate_next_frame` delivers scheduled test callbacks;
  there is **no OS/platform frame loop** here. These draws exercise the mounted
  actual marker and deferred implementation but do not prove the ordinary
  production platform frame guarantee or timing/races.
- GPUI TestPlatform uses **HeadlessAtlas**. It records real test key membership
  without uploading pixels. Old-key presence/absence is not GPU upload,
  presentation, queue completion, tile safety or global memory proof. The
  actual isolated native-proof driver is a separate unexecuted gate.
- The source-backed stamp preparation can refuse the test platform's font
  shaper. The test requires an actual nonempty paper preparation/key, observes
  whatever stamps are honestly admitted, and does not fake nine prepared or
  uploaded images. All eight actual WGPU count variants remain the native
  driver's responsibility.
- No observed Dossier control opens Settings, so the entry is intentionally
  the **real host API**, followed by actual mounted Settings controls. This is
  not OS Settings-route navigation evidence.
- No refusal branch is fabricated. Existing image-budget/model refusals are
  independently tested; this retained Settings return test does not mutate a
  ledger, invent invalid image resources or force debug production limits.

`patch-base.json` and `source-pins.json` record current read-only inputs.
`freeze.json`/`SHA256SUMS` pin authored artifacts. Syntax formatting and patch
apply-check are the worker checks; no Cargo/test result is claimed.

Parent-only gate after both reviewed inclusions are applied:

```sh
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --bin twyne-desktop dossier_retained_settings_host -- --test-threads=1
```

Then Parent runs its relevant strict UI Clippy/assembled gates. Do not weaken
entity/focus/lease/retirement/disk assertions to accommodate a discovered bug.
