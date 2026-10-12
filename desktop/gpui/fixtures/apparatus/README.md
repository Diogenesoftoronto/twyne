# Retained offline Apparatus model

This corpus belongs to `src/apparatus.rs`. It does not change the manuscript,
insert a citation, research a source, format citations, migrate Lix/IDB, or alter
exports. Detection and formatting are separate host adapters to the original
pure TypeScript functions. Entries here are synthetic retained fixtures, not
provider results.

## Original contract

- `src/utils/bibliography.ts:17`: flat `BibEntry` fields. Original storage is
  `/bibliography.json` inside the Lix blob. Optional/unknown fields are retained.
- `src/utils/bibliography.ts:68`: only exact `entry.folioId === folioId` owns a
  source. Empty/missing owners, `folio_id`, catalog order and current selection
  do not supply ownership. The explicit fixture scope is
  `original/path/folio:café`; foreign scope is `unmounted/foreign`.
- `src/utils/bibliography.ts:91`: upsert replaces the first exact ID/folio row,
  otherwise appends. It is a complete replacement, distinct from URL merge.
- `src/utils/bibliography.ts:102`: scoped Drop removes all exact ID/folio
  matches, keeping the same ID in another folio and every unrelated raw row.
- `src/utils/bibliography.ts:198–245`: URL lookup uses original JS `URL`
  normalization; blank URLs never merge. URL merge spreads the existing row and
  builder output before JSON, retaining the original ID. Enumerable undefined
  builder fields clear earlier optional fields. The matched URL row can differ
  from the first same-ID row that upsert replaces.
- `src/types/index.ts:1112`: global Apparatus settings. The native style edit
  changes only `defaultCitationStyle`; research/MCP/search settings, legacy
  fields and future values remain raw and inactive.

`generate-reference.ts` executes the original functions against an isolated
in-memory Lix adapter in a fresh Bun process. It invokes the actual
`bibliographyForFolio`, builder, URL lookup, merge, upsert and scoped delete.
It does not open Lix, IDB or a browser. `source-reference.json` records the source
SHA-256 and five merge cases; `retained-native.json` adds nullable, malformed,
foreign, unscoped and aliased retained data for preservation checks.

## Native boundary

`ApparatusRecord` is a versioned envelope with original raw bibliography and
settings plus explicit `localBibliography`/`localSettings` overlays. Missing,
null and malformed original or overlay values remain distinct. Unknown envelope
fields are retained. Local edits keep the original raw fields unchanged.

`record.display(explicit_folio_id)` returns safe per-folio rows with their full
raw entry and global array index, projection issues and global style. An array
can be structurally valid while individual rows cannot be displayed; callers
must surface `issues`. A malformed root cannot be edited. Missing/null roots
are explicit empty states. Invalid retained citation style displays the original
MLA fallback with an issue and is not rewritten during projection.

`BibEntry` is a display DTO, including open future style/provenance/target kind
and nullable optional fields. Its timestamp values use the original JS number
type. Use `RetainedBibEntry.raw` for helper input and persistence, retaining
original JSON numbers and avoiding DTO reconstruction.

`ApparatusEdit` supports scoped `Drop`, complete `Upsert`, guarded `AddDetected`,
global `SetCitationStyle`, and atomic `Batch`. `AddDetected` consumes the exact
complete raw candidate produced by the original host helper, plus optional
`UrlMergeTarget { index, expected_raw_row }`. It verifies that row and candidate
identity/folio before the original first-ID upsert. Rust does not duplicate URL
normalization, detection, citation formatting or undefined/spread behavior.
The host must reject an asynchronous helper result unless the whole accepted
record snapshot, current folio and view identity still match; a null merge
target alone is not a freshness guard.

`ApparatusSession` keeps the accepted record unchanged while its immutable
full-base/full-candidate request is held. Request IDs survive failed writes and
retries. ACK requires the exact request ID, current full base and full candidate;
late, partial and foreign ACKs refuse. Replacement refuses while pending or for
older/incompatible records and same-generation differences.

`ApparatusStore` writes `apparatus.json` atomically with fsync and a previous-save
backup, enforces full-record CAS and idempotent lost-ACK retry, and bounds reads
and serialized candidates at 16 MiB. Syntax-damaged primary data is retained
while backup recovery is displayed, then copied to a damaged file before a new
accepted write. Valid future/wrong-schema JSON never falls back to an older
backup. The host must hold its existing library OS lock; the store mutex covers
cloned handles from one opened store, not independent processes.

## Focused verification

Run from repository root:

```sh
rtk proxy devenv shell -- bun desktop/gpui/fixtures/apparatus/generate-reference.ts
rtk proxy devenv shell -- cargo test --offline --locked --lib --manifest-path desktop/gpui/Cargo.toml apparatus::tests -- --nocapture
rtk proxy devenv shell -- rustfmt --edition 2024 --check desktop/gpui/src/apparatus.rs
rtk proxy devenv shell -- cargo clippy --offline --locked --all-targets --features ui-tests --manifest-path desktop/gpui/Cargo.toml -- -D warnings
```

The focused native checks cover exact raw missing/null/unknown retention, safe
malformed projection, exact scope, all executed Source merge/upsert/drop cases,
stale guard rejection and batch rollback, settings preservation, held failed
write/retry/ACK, full-record CAS, concurrent cloned writers, damaged/future files
and metadata/generation bounds. They are model/store proof; they do not establish
Apparatus UI, provider, citation insertion, exchange or canonical-source proof.
