# Atom renderer lifecycle barrier (integrated)

Root reviewed and applied the frozen patch. The focused locked/offline
entity/foreground-completion gate passed **12 tests, zero failures** on the
pinned Source inputs in [parent-gates.json](parent-gates.json). The authored
handoff below records the original proposal and its execution boundaries.

This fixes the inspected renderer-replacement race, without adopting Current
Source math geometry or changing fonts, renderer fidelity, wrapping policy,
canonical commands, Source callbacks or provider capabilities.

The original `set_atom_renderer` clears ready images and increments
`atom_revision`, but leaves the current task/pending/inflight scope alive.
`start_atom_jobs` checks only `atom_generation`, discards the returned
`AtomRenderResult` source/key/generation metadata, then writes its captured
renderer back and clears task/busy keys. A renderer swap alone does not advance
that generation, so an old completion can reinstall the previous renderer and
interfere with a new job. This is source inspection, not an executed async race.
The frozen [current-adoption contract](../current-adoption/CONTRACT.md) remains
authoritative about diagnostic/admission and geometry boundaries.

## Production seam

The new `src/editor/atom_renderer_lifecycle.rs` is a private child of
`editor::view`. The unapplied patch replaces only the old setter/request/job
methods with that module, adds lifecycle/receipt fields and deferred frame
capture, and hooks actual document/read-only/MathSourceHostContext boundaries.
`patch-base.json` records inspected before/proposed-after hashes. Root's
inline-form flow fields, shapes, cache keys, reservation and paragraph geometry
are retained unchanged. No existing shared/runtime file was edited here.

The public setter signature remains:

```rust
RichEditorView::set_atom_renderer(InlineProofRenderer, &mut Context<Self>)
```

Internally `atom_request_ticket()` captures current renderer/owner epoch,
presentation generation and read-only state. `enqueue_atoms` receives that
ticket plus the held visible block. `finish_atom_batch` is the exact foreground
hook used by the real executor callback and deterministic test receipts.
`retire_atom_owner` is called by `set_document`, by an actual read-only value
change, and by the already application-qualified MathSourceHostContext
folio/visit/context transition. Root's app coordinator currently installs and
clears that context at real mount/folio/visit boundaries; no second invented
folio identity API is introduced.

| Boundary | New behavior |
| --- | --- |
| Explicit renderer replacement | Checked renderer epoch advances; task/pending/inflight/ready presentation is retired. |
| Same renderer clone assigned again | Same retirement barrier; immutable renderer cache remains reusable by new qualified requests. |
| Document replacement, including an unchanged document passed to the view | Checked owner epoch advances independently of document equality/revision. |
| Read-only value changes | Old scope retires; fresh read-only rendering remains allowed. Same value is not a barrier. |
| Actual folio/visit/context change or clear | Old scope retires; the same context does not retire jobs. |
| Visible frame deferred across a boundary | Captured epoch/generation/read-only/block identity rejects requeue. |
| Old success, failure or duplicate callback | Refused before renderer, ready, task, busy, revision or notification changes. |
| Current lazy discovery | May initialize a still-None renderer; cannot override an explicit setter. |
| Current successful or failed atom reply | Exact request/result source, key, generation, held node/path/offset and scope must match before ready insertion. |
| Unrelated later prose edit | Does not require whole-document revision equality; unchanged target/path/offset remains eligible. |
| Counter exhaustion | Fails closed; renderer/owner/batch counters never wrap or reset. |
| Entity destruction | Lifecycle Drop cancels its token; weak view callbacks cannot publish to another entity. |

Explicit renderer authority is held in the view. A batch returns no captured
explicit renderer for reinstallation. Only actual lazy discovery returns a
candidate, and completion can initialize it only in its current scope while
the live renderer remains None. Successful and failed payloads use the same
guard and exact batch cleanup. A stale callback cannot clear a newer task or
remove its same-key busy marker.

## Cost, cancellation and remaining boundaries

The two-job batch and existing immutable renderer cache remain. Queued work
holds shared block/nodes and validated requests; there is no HTML projection,
serialization, global document scan or command in these hooks. A node receipt
is prepared only for the at-most-two jobs being dispatched: it finds the
requested object within its held visible block and follows one scalar branch
using cached lengths. Completion checks paths, storage identity, offsets and
metadata. Local writing-cache ranges and document-relative model block ranges
are both normalized to the same local target offset. Sources remain byte
exact, including whitespace; Raw Typst remains source-visible.

Cancellation checks before discovery, after discovery and between jobs. It
cannot abort a synchronous `InlineProofRenderer::render` already executing.
That old immutable cache may finish, but the canceled ticket cannot publish.
Reassigning the same renderer can still observe its existing two-job Busy
behavior while old synchronous work finishes. No retry-policy redesign or
async scheduling/latency acceptance is claimed by this slice.

The original renderer's pending queue/ready-map retention and immutable-cache
policy are unchanged. In particular this does not admit diagnostic Current
Source CSS outputs, certify SVG raster/Source flow parity, update a math font
manifest, change proof/export semantics, or implement live providers.

## Verification

Twelve Rust regressions are authored: two checked lifecycle/cancellation tests
and ten GPUI entity tests calling the actual proposed foreground guard. They
cover old success/error versus new busy/pending/ready state, explicit setter
authority, same-instance/cache reuse and generation wrapping, discovery,
document/read-only/folio/visit/clear boundaries, unchanged scopes, exact
source/style/key/generation mismatch, node storage/offset/unrelated edit,
deferred-frame requeue and fresh read-only rendering.

Constructed image receipts and `Task::ready` markers deliberately isolate
completion decisions. The injected backend is synthetic local SVG transport,
not real MathJax/KaTeX/Typst equation proof. Same-byte new-storage fixtures
construct a new model directly because core replacement short-circuits
structural equality; that bypass isolates the node guard and is not a claim
about a real async document transition. Rendering completion does not execute
an editor command, change selection/history or serialize/persist a manuscript.

Worker checks: Rustfmt syntax-format and unapplied Git patch apply-check only.
No Cargo, Rust compilation, mounted/entity test execution, async race,
native/browser/OS/provider run or Source geometry execution was performed.
Root owns review/apply/format/compile and actual lifecycle/runtime acceptance.

```sh
rtk proxy rustfmt --edition 2024 --config skip_children=true --check desktop/gpui/src/editor/atom_renderer_lifecycle.rs desktop/gpui/fixtures/math-write/renderer-epoch/lifecycle_tests.rs
rtk proxy git apply --check desktop/gpui/fixtures/math-write/renderer-epoch/integration.patch
```

Root's focused gate after review/application (unrun by this worker):

```sh
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib editor::view::atom_lifecycle::tests
```
