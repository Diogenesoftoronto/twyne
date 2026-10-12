Root applied the frozen integration patch and repaired the test extension import. All seven Rust checks passed; [parent-gates.json](parent-gates.json) pins that exact gate. Actual native pixels remain a separate comparison.

# Original Dossier reviewed stamp

This is an unapplied, new-module rendering adapter. Source/native/runtime files
outside this fixture and `src/dossier_stamp.rs` remain unchanged. Root owns
integration, compilation, mounted/native execution and pixel comparison.

The source is `.stamp` at `src/global.css:606–620`, overridden by
`src/components/brief/dossier-preview.tsx:112–114`. It requests Special Elite
400 at 8.8px, tracking 1.936px, line height 13.2px, vermilion text/border, a 4%
vermilion background, 2px border/radius, padding 8px×2.4px and center rotation
−3°. Tailwind's inherited line height is 1.5. `source.json` retains those
declarations, source pointers/hashes and Root's existing original-browser box
receipt. That receipt omitted the count label; its width is not assigned to an
invented count.

The actual original quad has content height 13.1875px and vertical
padding 2.390625px: its unrotated border box is 21.96875px tall, despite rounded
`offsetHeight 22`. The adapter retains these measured 1/64px vertical layout
values. Glyph positions and horizontal advance come from the actual platform
shaper; no arbitrary width/position correction is applied. GPUI's fractional
layout snapping and Chrome's font raster/inline advance quantization remain
actual-pixel comparison boundaries.

## Public seam

```rust
// At constructor, palette or DPR changes; original fonts must be registered.
let set = DossierStampSet::prepare(
    theme::palette(cx).vermilion,
    window.scale_factor(),
    window.text_system(),
    cx,
)?;
// Preserve the existing host's count. No new review semantics.
let stamp = set.stamp(reviewed).ok_or_else(|| anyhow::anyhow!("Invalid count"))?;
stamp.element() // fixed unrotated layout, rotated image overflow, no input handler
```

`geometry()`, `shape()`, `svg()` and `raster_image()` expose retained diagnostic
inputs/results. `paint(bounds, window, cx)` refuses stale theme/DPR rather than
stretching or generating artwork. `matches(color, scale)` permits the owning
view to skip preparation. The two-set cache includes TextSystem identity and
font ID; a Weak TextSystem prevents cross-application font-ID reuse without
retaining the application lifetime. The existing fixed original font
registration must remain stable during a retained set's lifetime.

The module prepares all eight supported counts at once. It refuses unknown
glyphs, substituted faces/metrics, invalid RGB/DPR, malformed outlines or
resource bounds. SVG source is capped 256KiB per count, raster dimensions 1024px,
aggregate pixels1,048,576 per set, and retained cache entries 2. Paint contains
only `Window::paint_image`; no file access, shaping, contour generation,
rasterization or manuscript scan occurs in an input/Render/paint callback.

`integration.patch` proposes only the desktop-gated module export and a
retained set in `DossierView`, refreshed at its existing `prepare_paper`
constructor/theme/viewport seam. The existing reviewed count computation is
untouched. Preparation failure keeps the current readable, unrotated count;
that fallback is explicitly not rotated parity. No patch has been applied.

## Framework and original-font provenance

Pinned GPUI 0.3.7's `window.rs` public `paint_glyph` (line 4639) and `paint_image`
(line 4871) have no transformation parameter. `paint_svg` (line 4801), the SVG
element's `with_transformation`, and `TransformationMatrix` support rotation,
but a new SVG sprite's mask rasterizes during its first paint. They do not
rotate a bordered native text box prepared before paint. This adapter uses
the existing `SvgRenderer` at an explicit preparation boundary, with an
original-contour SVG containing no `<text>` or external font/resource URLs.

`extract-font.py` uses the already installed, pinned fontTools 4.61.1 to extract
exact font-unit quadratic/cubic paths with `SVGPathPen`. It never changes
contours, glyph IDs, original font bytes, timestamps, hints or font order.
The original embedded Special Elite 1.001 is
`assets/fonts/specialelite-SpecialElite-Regular.ttf`, SHA256
`a776fcb4ceb8bdf03e2967688ebdad42680de5b91a7e62c17e718ae212d14bc4`.
It is Apache 2.0; the byte-identical original notice is retained as
`Special-Elite-LICENSE.txt` and in the existing font assets. The full copyright
and original metrics are retained in `outlines.json`. No fonts/dependencies
were added or downloaded; approved theme/assets/Source files are unchanged.

Actual shape runs must select the registered Special Elite glyph IDs with the
original 2048 UPEM/hhea metrics and individual advances. Its GPOS pairs do not
alter any adjacent pair in these fourteen-character count labels. SVG
outlines are unhinted and use resvg antialiasing; they are not proof of Chrome
font hinting or identical raster pixels.

## Verification and truthful limits

Executed locally: source Bun 4/4 (148 assertions), exact outline/license
regeneration check, Rustfmt syntax-format, and unapplied patch apply-check.
Seven Rust regressions are authored and **not compiled or run**: source/font
alphabet, original quad rotation, DPR-only raster resolution, invalid bounds,
actual registered Linux font/count/raster/cache, separate font namespaces,
and mounted adjacent-control/focus/layout preservation. The retained browser
receipt predates this task; no new browser/native/GPU run was performed.

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-stamp/extract-font.py --check
rtk proxy bun test desktop/gpui/fixtures/dossier-stamp/source.test.ts
rtk proxy rustfmt --edition 2024 --config skip_children=true --check desktop/gpui/src/dossier_stamp.rs desktop/gpui/fixtures/dossier-stamp/stamp_tests.rs
rtk proxy git apply --check desktop/gpui/fixtures/dossier-stamp/integration.patch
```

Root's focused gate after reviewed integration (not run by this worker):

```sh
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib dossier_stamp::tests
```

Root should compare actual themed stamp pixels at the real count/DPR and
check unclipped rotation, unrotated adjacent bounds, focus/input continuity,
theme changes and all displayed counts before claiming visual parity.
