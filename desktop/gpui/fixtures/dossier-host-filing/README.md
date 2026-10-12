# Dossier host filing regressions

## Parent gate update

The parent ran all eight host checks: **8 passed, 0 failed**, with 86 other binary tests filtered. The missing `AppContext` trait and the absence assertion were repaired in the fixture. A fresh follow-up gate also passed all eight after disk-writer retirement and import qualification. The Dossier library family passed 58 checks, including the new stale-import and same-scope recovery cases. See `parent-gates.json` for the exact log, digest and proof limits. The worker handoff below is retained as historical context.

The sibling host module `src/app/dossier_filing_tests.rs` uses the real
`app::tests::room` fixture, mounted Dossier title/section/Send controls, the
original local semantic helper, native recovery files and the actual library.
No account, provider or user display is used.

Eight authored checks cover:

- An old, still-live sender after a real folio switch cannot file into the old
  or new manuscript, replace the new form, alter its recovery or move focus.
- A real prepared and durably saved result delivered after same-scope reopening
  cannot acknowledge the retired form or erase the reopened recovery file.
- A late error cannot change the reopened form's state, error display or focus.
- Equal per-view token values do not let a retired success/error acknowledge
  the new form's independently submitted request.
- A later durable base revision rejects the older request before conversion/save.
- A request whose submission mode differs from the captured form is rejected
  while retaining the exact draft and recovery bytes.
- A later live revision refuses adoption/acknowledgement of an older durable
  result while retaining live notes and recovery.
- A real filesystem obstruction makes normal filing fail visibly; retry uses a
  new token, saves through the production subscription and clears recovery only
  after durable acceptance. The same check files a real Refine request and
  verifies unchanged canonical source.

The late-receipt checks remove only the application event subscription and
capture the real `DossierEvent::FilingRequested`. They deliberately control
delivery: real `prepare_document` and `Store::save_if_revision` produce success
receipts; real `finish_dossier_filing` handles those receipts. This is
deterministic host/callback evidence, not an actual thread race or OS acceptance.
The success/retry/refinement check leaves the production subscription installed.

Parent-owned registration:

```rust
#[cfg(all(test, feature = "ui-tests"))]
mod dossier_filing_tests;
```

Parent-scheduled check, from the repository root:

```bash
rtk proxy devenv shell -- rtk proxy cargo test --locked --offline --manifest-path desktop/gpui/Cargo.toml --features ui-tests --bin twyne-desktop app::dossier_filing_tests::
```

The compiled local `twyne-document` helper must be available to
`SemanticBridge::discover`. These tests have been authored and await the parent's
Cargo gate. Source conversation integration, rendered comparisons, live provider
filing and actual OS behavior are not established by this fixture.
