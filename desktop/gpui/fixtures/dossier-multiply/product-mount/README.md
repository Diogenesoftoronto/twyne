# Dossier foxing product-mount proposal

Status: **unapplied, uncompiled and unexecuted**. This lane writes only new
fixtures. Root owns applying the patch, Cargo, actual native controls/pixels,
atlas-key observations and Source comparison. No original Source, shared
runtime, vendor, font, earlier receipt or browser state was changed.

## Exact Source and paint order

`source-layers.css` contains exact extracted rules, with full input and block
hashes in `source-pins.json`. Current `src/global.css` SHA256 is
`718d4908aa9c87462cb0b70dabc567708e0f1f531426b671750a51825ef86da2`;
the exact `.paper-foxed::after` block is
`43538cf7cf54783547f0b07e1520bc64e04975d93ceb09864024998795f54d8c`.
`source-contract.json` records all five positions, solid/transparent radii,
color percentages and ordinary DOM order. They are the existing frozen
`FOXING_SPOTS`, not newly chosen artwork.

The actual `DossierFolio` root in
`src/components/onboarding/dossier-folio.tsx` is a viewport-height,
overflow-hidden `main.paper-sheet.paper-foxed`. The seven paper backgrounds
and inset shadows are behind its children. The positioned noninteractive
`::after` has `inset:0`, five backgrounds, `opacity:0.7` and
`mix-blend-mode:multiply`. Its CSS layer list is front-to-back, while the
existing SVG preparation paints it in reverse.

The proposed native root paints its opaque paper fill, prepared background and
shadows, then the entire live frame/controls/text/status descendants, and
finally one clipped multiply canvas. It adds no hitbox, focus/accessibility
node or input handler. The already-reviewed core `paint_layer` DrawOrder
barrier separates the final group from earlier ordinary sprite batches.

Source's positive-z fixed sending/error overlays and `z-index:10` filed
confirmation can paint **above** its auto-z pseudo-element. Current native
inline status strips are ordinary frame descendants and precede foxing. This
proposal does not certify those separate transient-overlay/animation styles
or reorder Root's future higher-z overlays. It mounts the current ordinary
form safely, rather than claiming every Source descendant has identical
stacking behavior.

## Minimal integration and preparation

`integration.patch` changes **only** `src/dossier_view.rs`, pinned after Root's
stable `resume_image_lifecycle` checkpoint. It does not modify
`dossier_multiply.rs`, lifecycle, core, manifest or Source CSS. It requires the
reviewed core/WGPU multiply patch and the new default-false
`Window::supports_destination_multiply()` capability seam first.

The view retains an optional `Arc<DossierMultiply>` and prepares it at existing
constructor, theme, viewport/DPR and explicit resume boundaries. Preparation
is independent of the ordinary paper's early cache-match return. Render and
input only retain/use prepared data; paint performs no parsing, rasterization,
cache insertion or retirement. CPU preparation can exist on an unsupported
backend, but cannot create an atlas key there.

The group joins `prepared_images()` as image **ten** after paper and all eight
stamp variants. Broadsheet retains a transparent preparation with **no group
image**, so its lease set has nine images. Tracked/prepared IDs are not a claim
that all ten keys were uploaded: only images actually painted enter the atlas.

Both normal lease replacement and Settings resume rollback restore foxing and
its receipt along with paper/stamps/lease as appropriate. The receipt commits
only after a successful accepted replacement or attachment; old canvases share
the receipt cell and must match its exact active image ID and accepted window.
A still-current lease alone cannot authorize an older replaced group. A
retired lease cannot upload, and theme observers cannot revive a dormant form.
Resume is Root's explicit new-lease transaction.

The existing `DossierMultiply::prepare` produces one premultiplied BGRA group
with **no group opacity in the SVG**. Its existing
`paint_on_opaque_backdrop` calls `paint_multiply_image` with
`FOXING_GROUP_OPACITY` (`0.7`) **once**. The product canvas adds no opacity and
never uses ordinary `img`/`paint_image` for these premultiplied bytes. This
patch makes no changes to the existing rasterizer or palette/spot values.

## Audit APIs and refusal

```rust
pub fn prepared_multiply(&self) -> Option<&Arc<DossierMultiply>>;
pub fn foxing_paint_status(&self) -> DossierFoxingPaintStatus;
```

Status variants are `Unprepared`, `Transparent`, `Prepared`, `Recorded`,
`Untracked`, `UnsupportedBackend`, `StalePreparation`, `Clipped` and
`PaintRefused`. **Recorded is a scene-primitive receipt, never a GPU completion
or presentation receipt.** Status changes create no paint-triggered entity
notifications or per-frame logs.

Before painting, the callback checks accepted window/image/lease identity,
exact viewport size, current DPR and foxing palette key. It checks actual
backend capability each frame, intersects its rectangular bounds with the
inherited mask, and then delegates to core's opaque-window, ancestor-opacity,
one-frame, exact origin/extents/mask device-grid and 1:1-image requirements.
Refusal skips the overlay and leaves ordinary content/controls paintable;
there is no normal-alpha, stretched image or baked backdrop substitute.

Fractional DPR is not categorically rejected: for example, `620×860` at `1.25`
has integral `775×1075` device extents. `621×861` at `1.25` does not and has no
prepared group. Fractional device origins/masks, nonrectangular isolation,
transparent windows and faded ancestors remain unsupported. Actual layout
must give the overlay the prepared full viewport bounds; a mismatch refuses.

An existing lifecycle boundary remains: failed attachment allocates an empty
consumer before `lease.replace` fails, and the registry has no lease Drop or
abandon hook. Root's subsequent `retain_only` mount boundary cleans it up.
This proposal preserves Root's lifecycle API and does not claim rollback
removes that allocated consumer. Test/host refusal cleanup remains Root-owned.

## Authored checks and Parent acceptance

`tests.patch` registers `product_mount_tests.rs` after the production patch.
Five **uncompiled/unrun** mounted tests use the real Dossier view, prepared
group and retained input entities on the default-false GPUI TestWindow:

1. Group is the exact tenth lease image; unsupported backend uploads no group
   key while typing the final character and Enter still advances the form.
2. Broadsheet has nine images/no overlay; a tinted theme restores ten.
3. A retained old canvas cannot upload or overwrite a newer group receipt
   even when its old lease is still current.
4. Manual DPR staleness refuses until explicit preparation; no stale stretch.
5. Dormant theme changes cannot revive the group; explicit resume prepares the
   current theme and attaches a fresh lease while the old lease stays retired.

`probe-contract.json` adds fourteen authored native acceptance inputs for Root,
including origin/mask/backdrop refusal, foreign-window replay and atomic
rollback. It contains expectations, not invented observed results. Root's
separate actual product lifecycle probe should observe painted group keys,
controls, theme/resize, Settings resume, accepted retirement and clean quit
through normal platform frame/marker boundaries. These headless manual draws
do not establish the production marker's retirement or GPU-fence guarantees.

Parent commands, not executed in this lane:

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-multiply/product-mount/check_contract.py
rtk proxy git apply --check desktop/gpui/fixtures/dossier-multiply/product-mount/integration.patch
# After Parent review/application of the production patch:
rtk proxy git apply --check desktop/gpui/fixtures/dossier-multiply/product-mount/tests.patch
```

The test filter is `product_multiply_mount_tests`. Source extraction and
in-memory patch reconstruction are filesystem checks, not Rust compilation.
Root's prior five-scene multiply results and lifecycle model tests are
prerequisites supplied by Root; they do not certify this new product mount or
Source's radial raster equivalence. SVG/resvg versus Chromium gradients,
quantization/sampling, actual product clipping and Source transient stacking
still require separate measured proof.
