# Dossier foxing: unapplied destination-multiply proposal

This is a bounded proposal, **not mounted native behavior or browser pixel parity**. Source CSS, the frozen `dossier_paper.rs` background and the actual app/vendor files were not changed. Parent already owns that background's mount and tests.

The supplied new `src/dossier_multiply.rs` is deliberately unregistered. `integration.patch` changes five pinned framework files only after Parent vendors **gpui-pre 0.3.7** and reviews the patch. The existing renderer fork uses **WGPU 29.0.4**. No dependencies were installed. No Cargo, Devenv, rustc, browser, network, provider, audio/device or native GPU operation ran in this lane.

## Source and arithmetic

The current `.paper-foxed::after` rule in `src/global.css:3576` has five global radial backgrounds, `opacity: 0.7`, `mix-blend-mode: multiply`, `inset: 0` and `pointer-events: none`. Rule SHA256: `43538cf7cf54783547f0b07e1520bc64e04975d93ceb09864024998795f54d8c`. `source-vectors.json` retains the exact raw rule, declarations, current complete CSS hash, actual Source theme colors, 252 scalar pairs and proof limits. `generate.ts` reads the real CSS via installed PostCSS; its theme extraction reuses the frozen paper fixture's read-only extractor.

All five layers are composited Source-over into **one transparent group**, in reverse CSS list order. Group opacity is applied once AFTER that composition. A transparent group sample is premultiplied color `p = A*C` with alpha `A`. For group opacity `g = .7`, an opaque backdrop `D` needs

```text
F = (1 - g*A) + g*p
D' = D*F
alpha' = alpha_D
```

The fragment emits `F`. Fixed-function WGPU blend is color `(src Zero, dst Src, op Add)` and alpha `(src Zero, dst One, op Add)`. It requires neither a destination copy nor a sampled screenshot. The fragment does **not** call GPUI `blend_color`: that would incorrectly premultiply the factor for a premultiplied-alpha surface.

This result equals CSS multiply + Source-over over an **already opaque backdrop**, including translucent live descendants previously composited onto that opaque paper. Black stays black. Ordinary-alpha brown paint lifts black and is observably wrong. Baking brown under an opaque field loses the overlay and is also wrong. Independently multiplying five spots with .7 opacity is wrong where they overlap.

For a nonopaque backdrop, CSS additionally contributes `g*p*(1-alpha_D)` and changes alpha to `g*A + alpha_D*(1-g*A)`. Preserving its alpha is deliberately **not** general CSS compositing. The core API refuses transparent windows; the Parent must also guarantee the actual Dossier region has an opaque fill. This proposal does not inspect/capture destination pixels to manufacture that guarantee.

## Exact seams and preparation

New unregistered module API:

```rust
DossierMultiply::prepare(Palette, DossierPaperMetrics) -> Result<Arc<DossierMultiply>>
prepared.matches(Palette, DossierPaperMetrics) -> bool
prepared.metrics() -> DossierPaperMetrics
prepared.is_transparent() -> bool
prepared.group_svg() -> &str
prepared.premultiplied_group() -> Option<&Arc<RenderImage>>
prepared.overlay() -> Canvas<()> // LAST child, positioned root, no handlers/hitbox
prepared.paint_on_opaque_backdrop(Bounds<Pixels>, &mut Window, &App) -> Result<()>
prepared.release_atlas_group_after_invalidation(&mut Window) -> Result<()>

foxing_group_svg(Palette, DossierPaperMetrics) -> Result<String>
validate_premultiplied_bgra(&[u8]) -> Result<()>
PremultipliedGroupPixel { rgb: [f64;3], alpha: f64 }
pixel.destination_factor(group_opacity: f64) -> Result<[f64;3]>
```

The new core preparation method is

```rust
SvgRenderer::render_parsed_premultiplied(&ParsedSvg, Size<DevicePixels>)
    -> Result<Arc<RenderImage>, usvg::Error>
```

It returns the original resvg premultiplied pixels with only RGBA→BGRA channel swap. GPUI's existing `render_parsed` unpremultiplies with truncation; converting those bytes back can lose a color unit. Ordinary image/SVG preparation remains unchanged. The new group must never go through ordinary `img` or `paint_image`.

Constructor/theme/resize boundaries call `prepare`, retain the Arc and verify `matches` before publishing an asynchronous result. No raster generation occurs on input, render or paint. Existing `DossierPaperMetrics` bounds apply: CSS dimension 1..4096, DPR .5..4, each raster dimension ≤8192, total ≤8,388,608 pixels. Two CPU group preparations are cached (maximum 64 MiB pixels; SVG/intermediate preparation is additional transient memory). A zero-alpha Broadsheet preparation skips rasterization.

The initial lane refuses nonintegral device extents/origins/content masks instead of stretching tiny spots across an unproved device phase. Exact 1280×860 and 620×860 at 1, 1.25, 1.5 and 2 DPR fit this constraint; e.g. 621×861 at1.25 refuses. Parent must reprepare at actual DPR transitions, including same-CSS-size transitions. `paint_on_opaque_backdrop` refuses stale size/DPR/palette data. Ancestor opacity must be1; there is no general offscreen group-isolation API here.

The CPU cache does **not** evict GPUI atlas entries. Parent must invalidate every old scene consumer, then release retired uploaded groups through `release_atlas_group_after_invalidation` at a quiescent accepted replacement/close boundary. A retained CPU preparation can upload again. Multiple windows sharing a preparation need owner/refcount coordination before retiring an atlas entry. Render/typing must not perform that cleanup. No GPU memory-bound claim is made before Parent verifies this lifecycle.

## Painter order, batching, atlas and color format

Public core method (Linux/FreeBSD cfg only):

```rust
Window::paint_multiply_image(bounds, premultiplied_group: Arc<RenderImage>, group_opacity: f32)
    -> Result<()>
```

The method uploads/caches the prepared image, uses the full tile at exactly1:1 device scale, retains the real content mask and wraps insertion in a **fresh overlapping `paint_layer`**. That assigns an order after prior images, quads, text and fields even when the caller is inside a parent's shared layer. Appending an image without this barrier is insufficient because the original scene sorts equal orders by primitive kind/tile. Mount the overlay last; a portal drawn later is outside that guarantee, as with Source's pseudo-element stacking context.

`PolychromeSpriteBlend` reuses the former32-bit padding word, preserving the96-byte transport layout. Every ordinary-only DrawOrder retains the exact original tile ordering, including ordinary orders in a scene containing a later overlay. Mixed-blend orders retain insertion order. The existing `PrimitiveBatch::PolychromeSprites` shape remains unchanged; the iterator splits at blend transitions, and WGPU chooses the matching pipeline. Existing ordinary fragment/blend behavior stays SourceOver. Three proposed real-core tests cover the later barrier, mixed mode/texture ordering and unchanged ordinary tile sorting/ABI; they are authored, **not executed here**.

WGPU's polychrome atlas uses non-sRGB BGRA8/RGBA8 UNORM and swaps BGRA upload bytes when the backend requires RGBA. Surface selection prefers the same non-sRGB formats. The patch explicitly refuses multiply if target or atlas is another format; it does not treat a linearized/sRGB target as byte-channel Source parity. The normal-image linear sampler is reused; the new fragment clamps UVs to its tile's first/last pixel centers because the atlas has no padding. Clipped fragments return identity `(1,1,1,1)`, not zero. The alpha blend preserves destination alpha regardless of the shader's returned alpha.

Only the pinned Linux/FreeBSD WGPU path is proposed. **No Metal, Windows, WebGL/browser or mobile native multiply support/proof** is claimed. The transport layout is unchanged, but that does not establish cross-platform visual support. No new public method is exposed on those platforms.

## Reproduction and receipts

From repository root, using already installed tools:

```sh
rtk proxy bun test desktop/gpui/fixtures/dossier-multiply/contract.test.ts
rtk proxy bun desktop/gpui/fixtures/dossier-multiply/generate.ts
rtk proxy rustfmt --edition 2024 --check desktop/gpui/src/dossier_multiply.rs
rtk proxy python3 desktop/gpui/fixtures/dossier-multiply/build-patch.py
rtk proxy python3 desktop/gpui/fixtures/dossier-multiply/check-patch.py
```

Current check: **11/11 Bun tests,63 assertions**; **252 scalar reference pairs and12 group SVGs**; standalone new module formatted; all five patch files checked with clean `git apply --check --verbose` in a unique owned staging tree. The patch is never applied by that script. `patch-receipt.json` lists exact pinned before/proposed hashes and `apply-check.json` retains the full clean check receipt; shared originals and staged baselines are verified unchanged. Rustfmt is syntax/format only, not type checking.

Parent review/application requirements:

1. Vendor the cached exact `gpui-pre`0.3.7 package with its provenance/licenses and add the corresponding crates-io override. This is needed because `Window.next_frame.scene` is private and there is no public blend selector; WGPU-only changes cannot expose a correct canvas API.
2. Review/apply the five-file `integration.patch`; add a cfg-desktop `pub mod dossier_multiply` only after the patched core is selected. Parent owns the manifest/lock/export changes; none are hidden in this lane.
3. Add a retained multiply preparation to Dossier's constructor/theme/bounds callbacks beside the background preparation. Check both keys independently: the existing background's early `matches` return must not skip first-time foxing preparation. Mount `paper.background()` FIRST, live frame next and `multiply.overlay()` LAST. Keep the root's real opaque fill. Implement explicit old-scene/atlas retirement above.
4. Parent Cargo/type/Clippy gates: new module's five tests (`dossier_multiply::tests`) and patched core's three tests (`destination_multiply_tests`). **No compiled Rust/shader/GPU proof exists yet.**
5. Actual GPUI pixels: compare cached raw group BGRA with the prepared shader factor over black, white, mixed RGB, opaque live fields, text and translucent descendants; check alpha preservation, clip edges, atlas neighbours, later paint order, theme/size/DPR changes and old-image retirement. Then compare actual Source radial raster pixels separately, without declaring SVG/resvg raster equivalence from scalar algebra.

Remaining genuine boundaries: Chromium versus resvg radial raster/antialiasing;8-bit premultiplied image quantization and f32 blend rounding; actual DPR/rendering behavior; general transparent-backdrop/group isolation; nonintegral device phase/masks; other platforms; actual app interactions/pixels and GPU cache lifetime. The Source inset shadows/background are the previously delivered separate lane, unchanged here.
