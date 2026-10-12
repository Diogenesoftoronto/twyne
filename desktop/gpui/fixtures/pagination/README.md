# Native rich pagination: isolated implementation checkpoint

The two new Rust modules implement atomic top-level block pagination and one
shared native frame. The isolated phase left existing runtime files untouched;
Root has now applied `integration.patch` and integrated its host. The current
parent gates passed four core tests, one workspace test, all eight mounted
editor checks and all three assembled host checks. `integrated-gates.json`
records the actual logs and source hashes. Original-font native GPU/page/input
comparisons and full-route registration parity remain open.

Root acceptance update: the actual private X11 window now passes eight physical
page/input checks, including original bundled fonts, later-page typing, durable
Save, focused Undo/Redo, cross-page clipboard selection, and physical sheet
width at a 620px viewport. See `native-acceptance.json`; current paginated Wayland
and full Source-route/raster parity remain open. The manual label is deliberately
centred in the entire forced spacer because that is what the actual
`src/global.css` `::after { top: 50% }` implements. Nearby Source comments that
describe a label in the page gap do not reflect that stylesheet behavior.

## Source and retained behavior

The arithmetic authority is `src/components/editor/pagination-geometry.ts`.
The runtime authority is `src/components/editor/extensions/pagination.ts`;
page shape and surrounding behavior come from `page-chrome.tsx`,
`manuscript-panel.tsx`, `extensions/page-break-node.ts`, and `src/global.css`.

The current `twyne-editor.tsx` extension array includes `PageBreakNode` but has
no `Pagination` import/configuration, `onPaginate`, or `getTailElement`
registration. The engine and its UI/CSS contracts exist, but the current full
route does not activate that engine. This native optional slice therefore
implements the declared Source engine contract; it is not proof of matching
an observed active current-route pagination experience. Root must resolve
that registration/UI distinction before making an overall parity claim.

- Physical paper uses 96 CSS px/in. Letter, A4, Legal and orientation resolve
  through the retained `LayoutSettings`. Rem margins use the current native
  root of 16px; the gap is 1.5rem. The pure resolver also accepts another root.
- Heights are whole top-level border boxes. Adjacent margins collapse with
  Source's `max`, and forced breaks truncate the following top margin.
- Headings and an explicit `data-keep-with-next="true"` move with the next
  block when Source's backwalk permits it. Source implements no separate
  paragraph splitting, keep-together command, or widow/orphan layout here.
  Its CSS orphans/widows declarations belong to its column flow.
- Oversized blocks remain visible and may span sheets. They are not clipped,
  divided into invented paragraphs, or declared to fit. Images receive the
  Source content-height cap and contain fit through the proposed integration.
- A page-break node is weightless and invisible in both modes. A forced
  spacer carries its visible label. Spacers create no text, marks, scalar or
  UTF16 offsets, clipboard content, undo records or canonical source.
- Source retains the first block's top margin. Thus a heading's first 48px
  margin also remains in the placement of later runs. The port does not
  silently replace this with a different sheet-grid rule.
- The block ceiling is 20,000. Above it Source returns inactive continuous
  flow. The 2,000-page limit is different: Source stops the scan and caps the
  count while reporting active pagination. An overflowing suffix remains
  possible. `page_limit_reached` makes that boundary explicit.

`source-geometry.json` contains 98 authored measured-block cases and eight
layout/geometry cases, obtained by running those unchanged original pure
functions. It includes empty and terminal breaks, consecutive/manual breaks,
oversized blocks, heading chains, margin collapse/truncation, first margin,
tail height and page caps. These are executable arithmetic observations, not
browser-derived prose heights or native rendered comparisons.

## Native interface and frame

`editor::pagination` is dependency-free apart from existing serde/workspace
types and exposes `BlockMetric`, `PageGeometry`, `paginate`, `same_breaks`, and
`StackPlacement`. A block/local-coordinate transform never converts a spacer
into a document offset.

The child module `editor::view::paginated` exports these public view APIs:

```rust
set_pagination_layout(
    layout: Option<LayoutSettings>,
    content_width_px: f32,
    tail_height_px: f32,
    cx: &mut Context<RichEditorView>,
)
refresh_pagination(cx: &mut Context<RichEditorView>)
pagination_info() -> Option<PaginationInfo>
pagination_placement() -> Option<Arc<StackPlacement>>
pagination_scroll_anchor(generation: u64) -> Option<PaginationScrollAnchor>
```

The event is `RichEditorEvent::PaginationChanged { generation: u64 }`.
`PaginationInfo::chrome_geometry()` exposes the measured page count, physical
height, gap and margins to the existing native chrome. A fallback is explicit:
`Continuous`, `TooManyBlocks`, `UnsupportedColumns`, `InvalidMeasurement`, or
`UnstableFloatGeometry`.
The event contains only a generation so the existing event's `Eq` contract
does not contain floating-point geometry.

Ordinary paragraphs/H1–H6 retain their cached fractional paragraph layouts.
Opaque roots (table/list/quote/code/image/source/math/diagram/native controls)
are measured using their real `AnyElement` children, outside measured-layout
callbacks. One accepted frame supplies text bounds and outer block bounds.
Children consume that plan during layout and prepaint at its shifted origins.
Native dispatch, accessibility, focus, note/comment buttons and hit targets
are real children. Paint, caret/selection/IME, comment/note geometry and drag
all consume those same bounds. No painted-only baseline offset or copied
read-only manuscript is used. Final wrapper edge snapping is limited to the
existing one-device-pixel frame contract; paragraph metrics are retained.

A pure text/page-break document reuses the entire frame `Arc` when revision,
configuration, opening initial, language, atom revision, ink and explicit
refresh generation are unchanged. A changed document runs the bounded
top-level stack scan and reuses unchanged paragraph layout `Arc`s. Opaque
roots are measured each frame because an image/native control can change
height without a document edit. The adapter adds no HTML serialization,
scalar flattening or full-descendant clone to the input path; its node copies
are existing shared persistent handles. Ordinary text cache/event tests check
that caret-only frames neither repaginate nor emit a notification loop.
Retained configuration uses an `Arc<LayoutSettings>`; per-frame keys and
deferred publication do not repeatedly clone unknown layout metadata.

### Initial float and spacer feedback

The proposed `layout_block_with_carry` helper delegates to the existing
paragraph cache and shaper. Continuous flow still computes its natural carry
and calls the same helper. The page frame computes remaining float height
from real updated paragraph tops plus accepted spacer heights. Adjacent
paragraphs retain carry, while a spacer that consumes the artwork height
clears it. Changed carry refreshes only the affected cached paragraph layouts;
all consumers receive the corrected common frame, including hit testing and
IME. A guarded persistent opening-prefix seed reuses previously accepted
spacers after an unrelated edit, preserving an untouched cleared paragraph's
layout `Arc`. Width, initial, font/atom refresh, prefix or relevant shape
changes invalidate that seed. No authored text or history changes.

The engine's atomic-height decision can feed back into CSS float layout:
clearing the float makes a paragraph shorter, which can remove the break and
restore the float. `source-float-observations.json` demonstrates an actual
alternating case with original CSS, Lora 3.008 and original arithmetic. The
adapter allows at most eight candidate measurements, detects repeated plans,
then restores natural carry with **inactive `UnstableFloatGeometry`** and no
spacers. The natural restore is one additional bounded shape walk. It does
not invent a forced break to make the algorithm appear convergent. Unchanged
pure-text fallback frames are cached and emit no repeated pagination event.
Numerical stack/pagination walks remain bounded by 20,000 top-level blocks;
real typing and opaque-heavy performance still require Root's profiling.

## Root integration

1. Review/apply `integration.patch` while all shared runtime inputs are frozen.
   It declares the new modules/event/state, introduces the shared placement
   wrapper at the existing text/drag seams, uses the native page frame, fixes
   Source's invisible page-break node, adds the shared carry/cache delegation
   and page-canvas helpers. It has
   **no app.rs or Changed-event rewrite**. New modules already exist separately.
2. At the host's accepted layout/view boundary, resolve
   `PageCanvasGeometry::resolve_paginated(layout, viewport_px, zen)` for the
   single-column sheet candidate. Supply its exact `content_width_px()` to
   `set_pagination_layout`. Width follows the physical sheet even when the
   drawer/Board/split pane is smaller. Keep the actual writing scroller's
   horizontal overflow. Do not reintroduce `max_w_full` or `min_h_full` on the
   active `page_canvas_paginated` wrapper.
3. Measure the real collected `manuscript-notes` **border-box height** at the
   accepted layout boundary. Source's `getTailElement().offsetHeight` includes
   its padding/border/content and excludes its outer `margin-top:40px`. Pass
   that height (zero if absent) as `tail_height_px`, and update only on a real
   height/configuration change. Keep the list as one real sibling after the
   editor. It is not a `BlockMetric` and does not become a spacer. Do not also
   append this height to the editor extent: the engine uses it once for final
   page count; the real sibling supplies its ordinary layout height. The
   Source count's omission of the outer tail margin is retained, not repaired
   by double accounting. In pages, avoid the host's continuous `60vh` text
   wrapper minimum; the editor already has the content-height minimum.
4. Initial page chrome can use one sheet from the resolved geometry. On
   `PaginationChanged`, guard the current editor entity, folio and visit, read
   `pagination_info()` and its `chrome_geometry()`, and cache/notify only when
   accepted info actually changes. Active pages use `page_canvas_paginated`
   and the measured count. It preserves physical width and the final blank
   sheet's minimum extent. Page header/footer text remains Root-owned.
5. `active:false` uses the existing continuous `page_canvas` and continuous
   width/padding. Do not paint sheet chrome on an inactive fallback. Preserve
   the requested layout settings, and visibly explain unsupported columns or
   limits rather than changing the manuscript's settings. Native columns are
   unsupported, including Source's responsive single-column container case.
   For disabled/unsupported configurations, continue to supply
   `Some(current_layout)` with the real continuous content width so inactive
   info and restoration anchors are published. For a measured
   `UnstableFloatGeometry` or invalid-measurement fallback, latch the rejected
   sheet candidate (owner/revision/layout/width/refresh) and its reason until a
   genuine document/layout/viewport/font refresh. Render continuous chrome
   with a **presentation-only layout clone** whose pagination is Continuous;
   pass that clone and the continuous width to the view. Keep the requested
   persisted layout unchanged. Do not immediately retry the failed physical
   sheet from its own pagination event: changing the width can otherwise
   alternate host modes even when each view frame itself is cached. Passing
   `None` removes instrumentation and clears info without a pagination event;
   the host clears its own cached chrome at that removal boundary.
6. After the fresh host frame, obtain
   `pagination_scroll_anchor(generation)`. Verify the same entity/generation,
   revision and selection again. For native negative scroll offsets apply
   `offset.y -= anchor.delta_y`, clamp to `[-max_offset.y, 0]`, and set the
   real writing `ScrollHandle`. Do not select another passage to anchor.
   Ordinary Root caret reveal remains independent. Discard stale callbacks.
7. Font/image/diagram/tail changes call `refresh_pagination` at their explicit
   presentation boundary. A notes-height observer should retain the last
   measured value and defer the guarded host update; it must not run child
   layout or issue an unconditional notify from a measured callback.

`create-integration-patch.py` only reads existing files and writes this patch.
It asserts each seam and will stop if concurrent code changed it. It never
applies the patch or modifies the frozen runtime.

## Checks and executable commands

Actually run at this isolated checkpoint:

```sh
rtk proxy bun desktop/gpui/fixtures/pagination/generate-reference.ts
rtk proxy bun test src/components/editor/pagination-geometry.test.ts
rtk proxy bun desktop/gpui/fixtures/pagination/measure-reference.ts
rtk proxy bun desktop/gpui/fixtures/pagination/probe-tail-web.ts
rtk proxy bun desktop/gpui/fixtures/pagination/probe-float-web.ts
rtk proxy python3 desktop/gpui/fixtures/pagination/create-integration-patch.py
rtk proxy git apply --check desktop/gpui/fixtures/pagination/integration.patch
rtk proxy rustfmt --edition 2024 --config skip_children=true desktop/gpui/src/editor/pagination.rs desktop/gpui/src/editor/view_pagination.rs
```

The unchanged Source suite passed **40 tests/159 expectations**. The generator
produced **98 block cases/eight geometry cases**. Patch applicability and owned
Rust formatting passed. **No Cargo, Devenv, native mounted test, or browser/GPU
pagination acceptance was run by this worker.** The fresh browser tail and
float probes below measure isolated declared CSS paths, not full-route
pagination.
Rustfmt is not a type check.

Root's scheduled focused filters after integration are `editor::pagination::tests`
and `editor::view::paginated::tests`, using the established rtk/Devenv wrapper.
The authored native gates cover:

- Mixed text/quote/table/manual-break placement, real Unicode click and UTF16
  IME, source-only copy and undo, unchanged paragraph layout identity, measured
  comment/note bounds and actual heading keyboard-drag cancellation.
- Width reflow and continuous restore without authored tree/history changes;
  final-block reachability and once-rounded native scroll extent.
- Terminal/manual empty final sheet and read-only reflow.
- Real page-canvas/chrome physical width at 840/620px viewports, two sheets,
  horizontal overflow and the blank final sheet's reachable bottom.
- Short ink with an actually measured 85px notes sibling retains one sheet,
  Source's full content-height minimum, and its 1181px actual canvas extent.
  This checks the retained Source overflow instead of inventing a second page
  or silently consuming the tail twice in the model.
- A 1,000-paragraph cold frame, unchanged frame/layout `Arc`s over four caret
  frames, one initial pagination event, and 20 accepted input/frame samples
  retaining the untouched first paragraph. It prints its timing boundary.
- Short opening ink plus adjacent text, an actual manual break, and automatic
  spacer reflow at 320/240/320px: shared float/caret/UTF16 IME coordinates,
  untouched cleared-paragraph `Arc` after unrelated tail input, exact undo,
  retained mark/unknown fields and no layout-created history. The synthetic
  test-platform font's real wrap threshold is selected from a bounded setup
  corpus, then that authored fixture remains fixed through resize and input.
- An actual native-shaper float feedback threshold publishes one inactive
  fallback with natural coherent input geometry; three caret-only frames
  neither change source/history nor republish pagination.

`source-timing.json` records 20 samples of unchanged original TypeScript
stack+paginate arithmetic at 1,000 and 20,000 authored finite blocks, with Bun
1.4.2. Current ranges are approximately 0.14–0.37ms and 1.02–4.23ms. Those
exclude DOM/native measurement, font shaping, serialization, GPU, and editor
latency percentiles. The native timing probe is test-platform work, not an
X11/Wayland cold/warm or long-session memory proof. Root must profile real
mounted typing and opaque-heavy/large documents before claiming performance.

`probe-tail-web.ts` opens a fresh owned headless Chrome, blocks all network,
uses unchanged original global CSS (imports removed, theme variables lowered
to plain `:root`) and the original `paginate` on actual DOM `offsetHeight`.
It manually activates `.is-paginated`, preserving Source's declared CSS
specificity, and does not touch a user tab or manuscript. The retained
`source-tail-observation.json` shows zero attempted network requests, a
1056px sheet, 1024px editor minimum, 85px measured notes border box, 40px outer
notes margin, one reported page, and an **1181px actual canvas**. The 125px
overflow follows the Source minimum plus tail margin/height; the arithmetic
does not count the minimum's unused area. Root explicitly approved preserving
and disclosing this limitation rather than changing Source's rules. This
observation establishes that declared CSS boundary only, not full-route
registration, Tiptap pagination behavior, or native visual acceptance.

`probe-float-web.ts` uses the same fresh owned, zero-network boundary, original
global CSS and the original Lora 3.008 variable font. It records the font path
and SHA256 and asserts four measured cases. At a 320px text column:

- Adjacent text retains an approximately 98.265625px float inset.
- A manual spacer clears that inset, shortening the next paragraph from
  65px to 32px and stabilizing at one forced break.
- An automatic stable case shortens from 97px to 65px and stabilizes at one
  break with 100px content height.
- With 90px content height and shorter text, the paragraph alternates
  65px/32px, positive/zero inset and one/no break over six passes. This is
  demonstrated Source CSS/arithmetic feedback, not an invented native
  widow/orphan rule or proof of the inactive current route's behavior.

The corresponding native correction and eight mounted gates are authored
but **not compiled or run** at this checkpoint. Root must validate the shared
cache delegation, actual original-font spacers and input/drag behavior after
applying the integration patch.

## Remaining limits before full parity

- Rust compilation, mounted interaction, actual original-font X11/Wayland
  pages and assembled app behavior remain pending Root's integration gates.
- Source schedules typing measurement after 90ms quiet and resize/font/layout
  after 100ms while mapping old spacers. This first native adapter measures
  accepted frames immediately; matching that quiet scheduler remains work.
- Initial float/spacer feedback now has a shared-layout correction and a
  bounded explicit non-convergence fallback. Its authored mounted/native
  original-font proof remains pending; opaque float barriers retain the
  established native contract rather than inventing cross-container flow.
- Native fractional rich metrics intentionally remain native; Source reads
  integer `offsetHeight`. Original-font threshold and raster differences do
  not become identical merely because the pure arithmetic corpus matches.
- Column balancing, Source widow/orphan column rules, oversized-block warning
  decoration, multi-page repeated table furniture and line-level splitting
  are not implemented by this slice. Source itself uses atomic blocks here.
- Short-tail minimum/margin overflow and oversized suffix limitations are preserved as described;
  a capped sheet count must not be presented as proof that every object fits.

Root can freeze these two modules after the checkpoint while integrating its
guarded page/scroll/tail coordinator. Other editor, note, clipboard, app,
provider and export modules remain outside this worker's changes.

## Parent-mounted follow-up: exact three failures

Parent retained `/tmp/twyne-gpui-pagination-mounted-gate.log`. No Cargo, rustc
or tests were run by this worker during the repair; only code inspection and
owned-file formatting. The `integration.patch` is now historical/applied and
was not regenerated against the integrated runtime.

1. **Actual cache invalidation bug:** `opening_scope` included the first
   paragraph whose natural top was already beyond the initial artwork. The
   unrelated tail edit changed that node and rejected the accepted-spacer
   seed, reshaping an untouched cleared paragraph through the natural carry
   variant. Scope now stops before including that already-clear node. All
   preceding node dependencies remain guarded; current margins/type are
   still measured, followed by bounded float/pagination reconciliation. The
   exact untouched-paragraph `Arc::ptr_eq` assertion is retained.
2. **First-event subscription timing:** pinned GPUI `App::open_window`
   (`gpui-pre` 0.3.7 `src/app.rs`) explicitly calls `window.draw` before
   returning and flushes deferred effects at the update boundary. The test
   subscribed afterward and missed the first publication. Its fixture now
   subscribes during window construction before that draw. It still requires
   exactly one initial event, identical frame `Arc`s, and no new events over
   four caret-only frames; production publication was not changed.
3. **Definite-height rounding assumption:** `PageFlowElement::request_layout`
   uses `Style.size.height`, whose pinned `AbsoluteLength::to_taffy` calls
   `round_to_device_pixel`. `snap_measured_size_to_device_pixels` uses outward
   ceil for a different measured-layout path. The fixture had incorrectly
   expected ceil, producing 13818px versus an actual 13817.5px scroll maximum
   on the 2x test display. It now requires exact nearest-device-pixel extent
   with the same strict numeric comparison; the final-block reachability,
   resize widths, source tree and empty history assertions remain.

Only `src/editor/view_pagination.rs` and this owned evidence were changed by
the follow-up. Shared runtime, host, Source, notes, math and clipboard edits
remain Root-owned. All three fixes require Root's scheduled mounted rerun;
the first failing run is retained as evidence rather than reported as passing.
