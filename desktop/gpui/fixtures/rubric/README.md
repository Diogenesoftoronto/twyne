# Offline Rubric model evidence

`generate-reference.ts` imports the current original TypeScript spine,
criteria/history helpers and writer-facing copy directly. Regenerate with:

```
rtk proxy bun desktop/gpui/fixtures/rubric/generate-reference.ts
```

`spine.json` is the exact original shipped order, labels and descriptions.
`source-reference.json` contains the original helpers' actual reconciliation,
quarter-step weights, weighted-score omission/configuration, method comparison,
observed-range sparkline, summary clipping and writer-copy outputs.

The retained Galley and LiveReview examples are **synthetic DTO fixtures**.
They exercise nullable fields, omitted values, unknown nested metadata, complete
rating distributions and row IDs differing from their artifact scope. They are
not provider results or real manuscript judgements. The native module does not
call providers, generate grades, compute freshness/static context, or change
canonical manuscript source or its exports.

`retained-native.json` is the versioned native envelope for host view/routing
fixtures. Its explicit outer scope is `original/path/folio:café`; the additional
`unmounted/foreign` scope and unscoped `legacy` data must remain separate.
Rows deliberately carry different `folioId` values. A capture harness may remap
the explicit outer fixture scope to its owned folio; it must not rewrite row
aliases, discover ownership from them, or infer a destination for legacy data.

Native raw fields remain untouched on load/display. Explicit `localCriteria`
and `localHistory` overlays retain imported values even after a local edit.
Malformed active criteria/history refuse edits/appends. Missing and null values
project to the source defaults; malformed values report an issue and are never
presented as a successfully loaded grade. Unknown scoring-method strings remain
retained; only missing/null methods compare as `room`. History is capped at 50
only when a caller explicitly appends a supplied history entry.

The host must hold the existing library OS lock while cloned RubricStore
handles write. Session requests retain a full immutable base/candidate and
stable request ID through disk failures/retries. Accepted state advances only
after exact candidate ACK. Saves use full-candidate CAS, durable idempotent
retry, atomic primary/backup replacement, and damaged-primary preservation.
Valid future/wrong-schema JSON is never replaced by an older backup.

Focused native gate:

```
rtk proxy devenv shell -- cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml --lib rubric::tests
```

The 11 core checks cover original-helper projections, full retained DTOs and
unknown/null/malformed fields, scoped edits with unchanged grades/history,
uncapped loaded history and explicit append retention, held/failed requests,
idempotent retry and exact/late ACKs, full-candidate CAS, and damaged/future-file
preservation. Strict all-target `ui-tests` Clippy and scoped Rust formatting also
passed. These gates verify the metadata model; host/native UI, capability and
real provider proofs belong to separate integration gates.
