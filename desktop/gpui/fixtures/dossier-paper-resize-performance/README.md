# Dossier paper resize preparation: source diagnosis

Status: **read-only source diagnosis; diagnostic patch authored, unapplied,
uncompiled and unexecuted**. This NEW fixture directory is the entire write
scope. No shared/runtime/Source/vendor file, reviewed raster, existing fixture
or cache was modified. No Cargo, Devenv, native, browser or profiling command
was run. Root's reported four passing layout tests and slow width loops are
external observations; this inspection neither reproduces nor times them.

## What the current source establishes

1. **Preparation runs synchronously in the actual resize callback path.**
   `vendor/gpui-pre/src/window.rs` registers `platform_window.on_resize`, which
   directly updates the window and calls `bounds_changed`. That method refreshes
   viewport/DPR and invokes the current bounds observers. `app/context.rs` runs
   each observer through `view.update`; `DossierView::new` registers a callback
   which calls `prepare_paper` without a task, idle timer or background executor.
   The same window callback is invoked on moves. A same-metrics move should
   match retained images, while a changed DPR/viewport can require preparation.

2. **Current nontransparent misses prepare two full-viewport images.**
   `DossierView::prepare_paper_candidate` checks stamps, derives actual viewport
   metrics, calls `prepare_multiply_candidate`, then prepares paper. The newly
   current view retains/mounts the destination-multiply group; an earlier read
   snapshot was unmounted and is not the final contract used by this proposal.
   The module's historical “unregistered” comments are not current host truth.
   Multiply preparation occurs before backend paint admission, including on
   HeadlessAtlas/unsupported-backend test paths. Broadsheet's alpha-zero group
   deliberately avoids the group raster; this proposal preserves that behavior.

3. **Each exact-key miss holds a process cache lock while rasterizing.**
   `DossierPaper::prepare` and `DossierMultiply::prepare` use exact CSS width,
   height and DPR float bits plus their actual color inputs. Each is a separate
   two-entry MRU. The lock covers lookup, SVG construction, renderer/parse,
   raster, final object construction and truncation. More than two distinct
   widths churn the ready cache; returning to a discarded width can miss again.
   An unchanged retained key avoids both preparation functions. This is an
   exact-size cache contract, not an unbounded “warm after one pass” guarantee.

4. **The raster paths contain viewport-sized CPU work independently of text.**
   `SvgRenderer::render_parsed` allocates an exact-size pixmap, invokes resvg,
   then converts every RGBA premultiplied pixel to straight BGRA. Multiply uses
   the same exact-size resvg allocation, swaps red/blue on every pixel, and then
   `validate_premultiplied_bgra` scans all channels again. The SVG backgrounds
   are font-free; `SvgRenderer::new`'s lazy font database should not be blamed
   for every paper miss merely because the renderer supports text.

5. **Stamp retries are a separate possible test cost.**
   A successfully retained set matches on color/DPR, independent of viewport
   width. A failed preparation leaves `reviewed_stamps=None`; the next bounds
   callback tries again. The Noop shaper may refuse actual original-glyph/metric
   checks. The proposed stamp-boundary duration distinguishes that retry from
   paper/group raster work without fabricating admitted stamps or caching an
   error which could suppress later valid font availability.

6. **Preparation and atlas retirement are different work.**
   `prepare_paper` replaces the actual accepted lease after preparation and
   rolls back pointers on refusal. `DossierImageLease::replace` has an unchanged
   set fast path; its CPU-cache retention does not establish GPU residency or
   atlas eviction. Existing lease/marker/retirement hooks remain untouched.
   The layout helper creates a DossierView without the application host lease;
   those tests are not assembled native lifecycle or platform-frame proof.

## Arithmetic workload, not a timing receipt

The two current layout sweeps are respectively:

- widths `[320,620,639,640,1023,1024,1472,1600,1280]`, height860;
- widths `[620,639,640,641,1280,620]`, height860.

At DPR2, **if each listed width misses**, those sweeps request29,645,920 and
15,273,600 paper pixels. Current nontransparent multiply independently requests
the same numbers. At1280×860@2, one four-channel image is17,612,800 bytes;
paper plus group is35,225,600 bytes before any other allocations/retained refs.
These are dimension-derived buffer sizes, not RSS/VRAM bounds or elapsed costs.
The helper's initial1280×1040 window adds a separate possible cold preparation.
Process-global test ordering/cache state can change which operations actually
miss. Noop, DPR2, debug/dependency optimization, real platform and GPU upload
must be recorded separately. Three minutes/~100% CPU does **not** establish a
hang, a native latency number or a single causal bottleneck.

## Bounded diagnostic proposal

`instrumentation.patch` modifies only the existing preparation boundaries in
`dossier_paper.rs`, `dossier_multiply.rs`, `dossier_view.rs`, plus the explicit
ui-tests capture tool. It loads this fixture's `diagnostics.rs` only with
`feature="ui-tests"`. There is no product field, new scheduling, notification,
paint/input handler, image Arc, full SVG/raw answer or error-message retention.

The process trace retains at most64 completion rows and seven bounded call
counters. Every row includes exact metric bits, validated raster dimensions
when available, numeric WindowId for view boundaries, outcome, cache entries
before lookup/evictions, `rasterReturned`, CPU total microseconds and completed
phase durations. Sequences/counters/times are decimal strings; truncation and
sequence exhaustion are explicit. A poisoned diagnostic lock reports
unavailability instead of altering preparation results. Rows never claim that
an image was uploaded or presented.

Paper/group phases distinguish validation, cache lock wait, lookup/MRU update,
SVG construction, renderer construction/parse, raster **plus existing channel
conversion**, group validation and cache install/eviction. The renderer phase
does not separate resvg from the conversion loop; that would need a separately
reviewed renderer diagnostic. The host row measures real prepared-vector/lease
replacement. Bounds/palette/host/candidate/stamp rows intentionally overlap;
**never sum nested totals**. `returned` only means that function returned;
`errorOrIncomplete` includes a failed or unfinished phase. `rasterReturned`
means the raster call returned, not successful atlas admission. Process-scoped
paper/group rows have no invented window ownership; Parent must isolate its
single window or qualify concurrent work separately.

The read-only `DossierPaper::resize_diagnostic_snapshot` free-function seam
returns the trace at an explicit capture boundary. The proposed capture tool
field is `dossierPreparationCpu`. Existing lifecycle diagnostics remain
independent. Instrumentation and capture JSON can perturb a test process;
these numbers are an attribution aid, not an uninstrumented interaction SLO.

## Parent-only measurement and gate

After review/application, Parent typechecks the ui-tests build and runs its
existing paper/multiply/source-order/cache and layout regressions. Suggested
existing filters: `dossier_paper::tests`, `dossier_multiply::tests`,
`dossier_view::tests::layout_correction`, and `product_multiply_mount_tests`.
Source CSS/SVG helpers and reviewed native pixel receipts must remain exact;
there is no proposed regeneration/regolden of those inputs.

For actual attribution, use an owned isolated native window with unchanged
local answers. Retain binary/source/profile hashes, actual viewport/DPR/backend
and fresh trace sequences. Observe cold open, a two-size warm return, a
greater-than-two-size sweep, same-size moves, and the actual transparent theme
separately. Read fresh capture data after each explicit boundary before64 rows
are lost. Require typed values/recovery/lease ownership unchanged. Report
completed observer time, child parse/raster/cache/stamp/lease durations and
first subsequent native frame independently; no diagnostic here measures
input-to-presentation or GPU completion. Keep failed and truncated receipts.

## Optimization decision

No optimization patch is offered before those measurements. Increasing cache
capacity is not a native continuous-resize solution and changes memory bounds.
Changing keys, downscaling/stretching, clipping to the1472px folio wrapper,
sampling tiles or skipping current multiply admission would alter the reviewed
full-viewport gradients/phase or existing capability/resource contract.

If synchronous raster dominates in actual native evidence, the smallest next
reviewable host change is one bounded serial background preparation with a
latest-pending viewport key. Completion must verify the same form/lease,
window/application, palette, exact viewport/DPR and generation before the
existing replace/rollback commit; dormant Settings must never revive a lease.
Keep opaque current-palette fallback and existing stale-paint refusal while a
new exact raster is pending. That scheduling/lifecycle change is a separate
unimplemented task; it must not weaken the current first-frame or byte gates.

`patch-base.json` pins the actual shared inputs read by the patch builder;
`source-pins.json` also pins framework/Source/raster-contract inputs. Parent
continues to own all compilation, profiling, execution and integration.
