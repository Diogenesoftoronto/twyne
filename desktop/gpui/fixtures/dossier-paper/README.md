# Original Dossier paper foundation

Root integrated `src/dossier_paper.rs` into the Dossier view at explicit
constructor, theme and bounds changes. Source and the existing body paper
grain remain unchanged. `integration.patch` and its dry-run hashes retain the
original proposal. [parent-gates.json](parent-gates.json) records **5 mounted
native tests passing**, including native SVG image preparation. This proves
the paper module boundary; descendant multiply and pixel parity remain open.

## Exact Source contract

`source.json` retains the original `.paper-sheet` and `.paper-foxed::after`
rule bytes, line bounds, SHA256, front-to-back gradient order, background sizes,
shadow order, five global spot positions/stops, group opacity and blend mode.
`reference.ts` extracts the actual Source rules with installed PostCSS; it
does not copy an approximate noise texture or modify the Source stylesheet.

- `.paper-sheet`: seven layers; the first three circles default to
  **farthest-corner** and end at38%,42%,60% of that radius. The135deg repeating
  linear gradient has2px ink and4px transparent runs; projection phase is
  `(x+y)/sqrt(2)`. The last three circles repeat within5px,7px,9px tiles.
- CSS image lists are topmost-first. The SVG reverses paint order. All
  gradients interpolate premultiplied sRGB color; transparent SVG stops retain
  the same color at alpha0 to preserve the Source color-mix endpoint.
- The inset60px/8% foxing shadow is above the1px/4% shade shadow. GPUI receives
  those original inputs in back-to-front order.
- `.paper-foxed::after` is a last-painted, pointer-transparent group over the
  **live descendants**, with5 untiled circles, opacity0.7, multiply.
- Broadsheet makes foxing transparent. It does **not** disable the explicitly
  mixed sheet ink dots/stripes or the paper-soft wash. The body's `--grain-*`
  tokens are a different primitive.
- All four preset paper/soft/ink/foxing/shade values come from Source. Native
  preparation takes the actual resolved `Palette`, preserving custom colors
  and Nightpress's black shadow base rather than substituting its light ink.

Rule hashes:

- sheet: `87212b07026e139b98eee9d13f9b3e363b6ace39383e63775c3af2bbfc4417a1`
- foxed: `43538cf7cf54783547f0b07e1520bc64e04975d93ceb09864024998795f54d8c`

## Native API and preparation

```rust
DossierPaperMetrics::new(width_css_px: f32, height_css_px: f32,
    device_scale: f32) -> anyhow::Result<DossierPaperMetrics>
DossierPaper::prepare(palette: Palette, metrics: DossierPaperMetrics)
    -> anyhow::Result<Arc<DossierPaper>>
paper.matches(palette, metrics) -> bool
paper.background() -> Canvas<()> // Arc receiver; first root child
paper.paint_background(bounds, window, cx) -> anyhow::Result<()>
paper.metrics() -> DossierPaperMetrics
paper.svg() -> &str
paper.raster_image() -> &Arc<RenderImage> // backgrounds only
paper.foxing_status() -> DossierFoxingStatus
paper_sheet_svg(palette, metrics) -> anyhow::Result<String>
foxing_svg(palette, metrics) -> anyhow::Result<String>
```

The pure metrics constructor rejects nonfinite/nonpositive values, CSS
dimensions over4096px, device scales outside0.5..4, raster dimensions over8192
or more than8,388,608 pixels. Preparation caches2 full key entries (resolved
paper/soft/ink/foxing/foxing-alpha/shade + exact width/height/scale). Each raster
is at most32MiB; caller-retained Arcs have ordinary explicit lifetime.

Preparation is the only SVG parsing/rasterization path. The canvas contributes
no layout size, focus or input surface. Paint only blits the prepared image
and adds the two inset-shadow primitives. It rejects a stale palette, size or
device scale rather than stretching, changing tile phase, rebuilding on paint
or doing work on manuscript keystrokes. A Parent background job can call
`prepare`, then install its Arc only if palette/metrics/generation still match.

The proposed integration uses constructor, NativePalette-change and window
resize callbacks, not `render` or `InputEvent::Change`. It retains the existing
opaque paper fill as a truthful fallback while unprepared. Parent may coalesce
resize work on its background executor. The minimal patch is rebased onto
Parent's equal explicit centering spacers and focused input underline; those
layouts are preserved. An identical preparation key returns before notifying.

Read-only scale inspection found that GPUI's platform resize callback calls
`bounds_changed`, which reads both actual content size and device scale before
notifying `observe_window_bounds`. Wayland `rescale` calls `set_size_and_scale`
and emits that resize even when the CSS size stays unchanged. Thus this actual
Wayland path is covered. The test-only `Window::set_scale_factor` refreshes
without notifying bounds observers; the proposed public `prepare_paper` is
an explicit seam for that override or a host/platform transition lacking a
resize event. This is Source/API inspection, not an executed monitor/device
transition. `subscription-contract.json` records the exact inspected files.

## Supported boundary and remaining proof

This is CSS-backed native background groundwork, **not full Source pixel
parity**. No product/PORT_PLAN completion claim is made.

GPUI's current WGPU target supports ordinary/premultiplied alpha, not
destination multiply. A normal-alpha sprite cannot multiply arbitrary
descendant colors: multiplication of black stays black while a colored
foxing source has three different channel factors. Baking spots below opaque
leaves would also change Source's last-painted behavior. Consequently:

- `Transparent` is returned only when the actual foxing base is transparent.
- Other themes return `UnsupportedDestinationMultiply`; five spots are
  retained in `FOXING_SPOTS` and `foxing_svg` but **not painted through a fake
  normal-alpha or below-content substitute**.
- The exported foxing SVG explicitly needs a multiply-capable destination.
  It is never passed to the native ordinary image canvas.
- Inset shadows use Source inputs, but GPUI's four-sample Gaussian shader and
  Chromium's60px CSS shadow have no measured raster equivalence in this slice.
  Gradient/pattern antialiasing, DPR sampling and GPU raster comparison also
  remain Parent's actual pixel gates. A source-input match is not that proof.

`raster/receipt.json` identifies the installed ImageMagick/Librsvg version,
eight standalone SVG/PNG hashes (1280/620 by four palettes), and the supplied
Source/native-before capture hashes. The PNGs contain **seven backgrounds
only**, excluding inset shadows and descendant multiply. They are diagnostic
projections, not captured browser/native paper parity. The old `/tmp` baseline
paths are historical after the environment's temporary-state loss;
`raster/receipt-historical.json` retains the previous hashes unchanged. The
current receipt records restored Parent-owned `target/verification` evidence
when present. This slice does not recapture the browser or assert a pixel match.

## Executed checks

```sh
rtk proxy bun desktop/gpui/fixtures/dossier-paper/reference.ts
rtk proxy bun test desktop/gpui/fixtures/dossier-paper/contract.test.ts
rtk proxy bun desktop/gpui/fixtures/dossier-paper/raster.ts
rtk proxy rustfmt --edition 2024 --check desktop/gpui/src/dossier_paper.rs
rtk proxy git apply --check desktop/gpui/fixtures/dossier-paper/integration.patch
```

The Source layer gate passes5 tests. Standalone raster preparation produced8
PNG receipts. Native module formatting and unapplied patch dry-run pass.
No Cargo/Devenv/rustc/browser/provider/device/network/install action was taken
by this slice, except the explicitly requested Sakana worker route below.

Five native tests are authored for Parent's registered module gate:
`dossier_paper::tests` (bounds/budget rejection, independent Source fixture
geometry, Source/Broadsheet distinctions, layer ordering, shared preparation
and native SVG image dimensions/alpha). They are **not executed here**. Parent
owns Cargo, all-targets Clippy, real GPUI pixels and final view integration.

## Requested independent model lane

`external-worker.json` records the new `dossier_paper_layers` launcher lane
using Sakana/fugu-max through Crush. Skate was read by the existing launcher;
the credential existed only in the child environment and was never printed,
copied into fixtures or persisted by this work. After~17min with no files,
the owned worker group was stopped. Its sole53-byte output says it had the
Source data and was building a fixture; there is no reviewable model artifact
or passing model gate. The executed extraction above is locally authored and
reviewed, not falsely attributed to that worker.
