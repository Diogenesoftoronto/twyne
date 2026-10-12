# Unapplied Dossier layout correction

This is a source-driven proposal against the **current lifecycle-aware**
`src/dossier_view.rs`, not native or browser acceptance. Only this new fixture
directory was written. The older `fixtures/dossier-layout-audit/**` checkpoint
and its observed first-frame/settled centering remain unchanged.

`integration.patch` changes one shared file after Parent review. It preserves
the constructor, durable filing/recovery/import guards, full-viewport prepared
paper, image lease registration/rollback, stamp preparation, fonts, field
entities, disabled capabilities, error/status semantics, and all input/key
callbacks. It does **not** mount product multiply, change assets, or guess the
Source's implicit grid rows below1024px.

## Exact local contracts

| Source declaration | Proposed native behavior | Source pointer |
| --- | --- | --- |
| Viewport-height, `min-h-0`, `overflow-hidden` main | Full-size outer positioned root remains the paper/lease owner and clips overflow | `src/components/onboarding/dossier-folio.tsx:50` |
| Centered `w-full max-w-[92rem]` wrapper | Full-width border-box capped at1472px; root cross-axis centering leaves64px outside it at1600px | `dossier-folio.tsx:52` |
| `px-3 py-3 sm:px-5 sm:py-4` | Below640px:12px on all sides; from640px:20px horizontal and16px vertical, **inside** that1472px cap | `dossier-folio.tsx:52` |
| Frame and leaf grid `min-h-0 ... overflow-hidden` | Explicit frame/body/leaf masks and zero intrinsic minima; independent leaf scrolling retained | `dossier-folio.tsx:54-74` |
| Preview `grid gap-1.5 sm:grid-cols-2` | One column below640px, two from640px;6px gap retained | `src/components/brief/dossier-preview.tsx:163` |
| Surface caption `hidden sm:inline` | Caption absent below640px; both actual surface controls remain, with existing capability gating | `src/components/onboarding/dossier-top-bar.tsx:83` |
| Department `truncate`, counter `shrink-0` | Zero minimum width + clipping on the department; counter nonshrinking | `src/components/onboarding/anti-tabula-rasa.tsx:782-783` |
| Progress `overflow-hidden` | Native3px progress track clips descendants | `anti-tabula-rasa.tsx:788` |
| Roman nav `min-w-0 ... overflow-x-auto`, controls `shrink-0` | Stable keyed horizontal scroll owner; numeral and edge buttons nonshrinking; axis-restricted input preserves vertical wheel routing | `anti-tabula-rasa.tsx:1094-1127` |

The department's custom tracked glyph child still lacks CSS ellipsis. The
proposal supplies its shrink/mask boundary only; it does not claim complete
`text-overflow` parity. Extremely narrow centered-overflow rail reachability
must be compared with the actual Source; no left-alignment workaround or
invented guarantee that every control fits is included.

`geometry-cases.json` contains declaration-derived boxes and explicit
unobserved boundaries. At620×860 the frame is `(12,12,596,836)`; at1600×860 it is
`(84,16,1432,828)`. At1280×860 it keeps `(20,16,1240,828)`. These are **CSS
contract expectations**, not new observed pixels. The Root's earlier actual
1280 receipts remain the visual evidence. The native220px stacked preview is
left in place pending Source used-row measurements below1024px.

New observation IDs are `dossier-folio-wrapper`, `dossier-frame`,
`dossier-leaf-body`, `dossier-preview-grid`, `dossier-surface-caption`, and
`dossier-section-rail`. No existing IDs are renamed. The rail's keyed Div keeps
the existing public GPUI per-element scroll state; no retained view or new
image lease is captured.

## Separate optional same-pass candidate

`optional-same-pass.patch` is relative to the **local presentation proposal**,
not the current shared file. Review/apply it separately. It removes the two
paint-time measurement canvases, `question_height`/`question_leaf_height`
fields and the fixed-height/learned-spacer calculation. The actual question
child, existing ghost controls, and existing input entities enter one native
layout tree once. A `min_h_full()` sheet with two equal `flex_1().min_h_0()`
spacers expresses the Source's split free space without GPUI auto margins.
Natural tall content can grow beyond the minimum instead of being assigned a
height from the previous paint.

This is a **candidate**, not a proven same-pass fix. Parent must prove current
Taffy percentage/min-height resolution, full scroll extent, first-frame input
and caret/IME positions, and tall-content interaction before adoption.
If native flex allocation does not satisfy those gates, keep the existing
centering implementation; do not add a previous-frame estimate to make the
candidate pass.

The native lifecycle comes directly from pinned public implementations:

- `vendor/gpui-pre/src/elements/div.rs:1922-2050`: the same retained children
  request layout, then prepaint with the current layout bounds/scroll offset,
  then paint under the same masks. Production uses the ordinary Div path.
- `vendor/gpui-pre/src/styled.rs:181`: `flex_1` gives equal grow1/shrink1/basis0;
  no duplicate auto-margin free-space assignment is used.
- `vendor/gpui-pre/src/window.rs:5166-5176`: `compute_layout` temporarily takes
  the layout engine. Calling child `layout_as_root` from a measured callback
  would re-enter an absent engine; this proposal never does that.
- `vendor/gpui-pre/src/elements/div.rs:2266-2287,2442-2499`: keyed scrolling is
  retained between frames and clamped against current content bounds.

There is no view-held child or learned-height cache. Each render constructs
one question subtree for that step; GPUI owns it through request-layout,
prepaint and paint in that frame. Existing field entity/history/focus ownership
and folio/session guards remain unchanged. Width, step, input/error-height,
theme/font or DPR changes trigger normal native layout instead of reusing an
incomplete step-only height key. Nothing prepares images, serializes source,
scans the document, calls `draw`, schedules notifications, or computes child
layout from a paint/measured callback. The current full-window texture
preparation and atlas-retirement hooks remain the same in both proposals.

No prior observed centering has been re-goldened. The optional tests derive
the free-space formula from **current actual child bounds** and require the
first draw to match; they must not be turned into settling loops. The same
question must stay fixed in a second draw without a height notification.

## Review and reproduction

`patch-base.json` freezes current source/framework hashes and the proposed
view hashes. The shared Window full-file hash is a historical inspected
snapshot while Parent's scene-lifecycle changes continue. The checker guards
the exact used public layout-method excerpt and reports outside-excerpt drift;
it does not certify those unrelated backend changes. Dossier/Source CSS and
the other used framework files keep strict full-file guards.
`first-inspection.json` retains the earlier view hash that Parent
changed during authoring, before freeze. `authoring-input-history.json` retains
the subsequent shared Window input drift before final source inspection.
Neither is a runtime before/after receipt. `freeze.json` hashes this proposal and distinguishes the checks
actually run from the authored tests/probes.

Read-only static checks (no Cargo, runtime or browser):

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-layout-correction/build-patch.py --check
rtk proxy python3 desktop/gpui/fixtures/dossier-layout-correction/check.py
rtk proxy git apply --check desktop/gpui/fixtures/dossier-layout-correction/integration.patch
```

The builder refuses patch/Source-contract or used layout-API drift. It writes only this fixture directory
when deliberately run without `--check`; it never applies a shared patch.
`check.py` verifies protected lifecycle/filing/control code, explicit Source
contracts, both in-memory patch stages, and Rust syntax through rustfmt. That
is not Rust type checking or a mounted UI result.

After Parent review/apply, suggested **Parent-only** gate:

```sh
rtk proxy devenv shell -- rtk proxy env CARGO_NET_OFFLINE=true cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib dossier_view::tests::layout_correction -- --nocapture
```

The local proposal includes four authored mounted regressions. They use the
existing real form/session and test-platform bounds notification path, actual
input/scroll/navigation, and durable recovery. The optional proposal adds two
cases for first-draw placement and tall-content scroll/input. None have been
compiled or executed by this worker. `parent-probes.json` adds actual isolated
native/browser pixel, clipping, focus, caret/IME, theme/DPR and lifecycle cases;
these are authored requests, not receipts.

Unfinished outside this slice: Source below1024px used auto-row heights;
department ellipsis; narrow rail safe-overflow behavior; exact card caret/full
unclamped active preview; existing title/body typography/textarea baseline;
frame/header/footer background/shadows; filing transform/overlay/press-state
visual behavior; product multiply; full viewport/theme/DPR pixels and actual
IME. Nothing here establishes full Dossier or cross-platform parity.
