# Original body paper grain

The web reference executes the current `src/utils/theme.ts` normalization and
`applyTheme`, then applies the actual `src/global.css` in local Chromium. It
does not substitute a designed texture. `web-reference.json` records the source
hash, computed colors, three gradient opacities, repeat periods, body origins,
and zero external network requests.

The native fixture paints the source-derived masks through the pinned GPUI WGPU
headless renderer at the same 440 × 390 CSS pixels and 2× device scale. The
13 `native-*.png` and `web-*.png` pairs cover every preset, System light/dark,
custom ink/paper, invalid preference normalization, clipped paint, and a body
scrolled 27 pixels. `native-metrics.json` contains the measured RGB comparison.

All 13 actual GPU cases pass. Broadsheet and custom Broadsheet are pixel-identical
flat paper. The other cases have mean absolute channel error at most 0.0448
on a 0–255 byte scale (0.0176%); maximum single-channel error is 3. These small
rasterization differences are retained rather than claiming byte identity.
This verifies the isolated Linux software-Vulkan paint path at 2× scale, not
every physical GPU, device scale, or supported OS.

The native `paper_grain()` Canvas is an absolute first child of the positioned,
paper-colored body root. It inserts no hitbox, focus target, pointer listener,
keyboard listener, or flow size. `paper_grain_at(anchor)` supplies a translated
body origin; clipping and resizing never restart the pattern. Opaque descendants,
including the original House and Library paper-soft roots, cover body grain.

The three gradients use their original 7/11/13-pixel periods, centers and
one-pixel radii. Light grain follows ink at 2.5/2/1.5%; Nightpress uses black at
18/14/10% even with custom light ink; Broadsheet uses transparent layers. Two
periodic source masks per light/dark treatment combine the outer gradients and
middle gradient without changing their compositing. Masks rasterize once at
4×; theme application prepares ready tinted images in a bounded two-tint cache.
The paint and typing paths only clone those images. The GPU fixture confirms
that repeated frames do not rasterize or tint any asset.

Polychrome `paint_image` preserves the CSS alpha. GPUI's monochrome SVG path
applies font contrast/gamma correction, which changed custom white grain on dark
paper; it is therefore not the rendering adapter used here.

The interaction fixture deliberately places the Canvas above a button and a
native Input. Before/after control bounds are identical; clicks, Unicode input,
cursor movement, and retained keyboard focus all pass with the overlay present.

Reproduce the references and verify the embedded source masks:

```sh
rtk proxy bun desktop/gpui/fixtures/paper-grain/capture-web.ts
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
```

Run the isolated native fixture with a working local Vulkan ICD and private
runtime directory. This machine's verified software ICD is Mesa lavapipe; no
user desktop or browser session is used:

```sh
rtk proxy env \
  CC=/usr/bin/clang CXX=/usr/bin/clang++ \
  LIBRARY_PATH=/nix/store/1jlp4w0mjyyf2byglz9q6vnmnprl4xgn-libxkbcommon-1.4.1/lib \
  RUSTFLAGS='-C linker=/usr/bin/clang' CARGO_BUILD_JOBS=4 \
  VK_DRIVER_FILES=/nix/store/gqpsfqzgbcbwbh12n3sjxk2x4gqgy8lq-mesa-26.1.3/share/vulkan/icd.d/lvp_icd.x86_64.json \
  WGPU_BACKEND=vulkan XDG_RUNTIME_DIR=/tmp/twyne-paper-grain-native-runtime \
  TWYNE_PAPER_GRAIN_CAPTURE_DIR=/tmp/twyne-paper-grain-native \
  cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml \
  --lib --features ui-tests paper_grain::ui_tests::actual_native_gpu \
  -- --ignored --nocapture --test-threads=1
```

The supplemental matching Mono Oblique face is independently verified by
`theme::tests::real_platform_selects_the_matching_mono_oblique_without_changing_advances`:
the real Linux shaping system resolves regular and italic to different font
IDs, selects those same IDs during shaping, and preserves Source monospace
advances and exact text. Its pinned official archive and full notice are in
`assets/mono-oblique-provenance.json` and `assets/licenses/dejavu-LICENSE.txt`.
