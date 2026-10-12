# Original writing fallback evidence

This evidence records the earlier zero-network writing fixture, which injected
Twyne's bundled static Lora 3.021. It establishes that fixture's CJK fallback,
not actual-app Lora font parity. The later actual-browser font investigation
found Lora 3.008; its native correction is recorded in `../lora-ui-evidence/`.

The writing fixture selects Lora-Regular for Latin text
and DroidSansFallback for its 100 CJK glyphs. `web-fonts.json` records actual
Chrome 154 `CSS.getPlatformFontsForNode` results; `web.png` is its untouched
ProseMirror screenshot. The byte-identical Android Droid font and original
Apache notice are embedded in the application. Their source package and SHA256
hashes are recorded in `../cjk-fallback-provenance.json`.

`native-font-proof.json` is a separate actual Linux text-system test. It shapes
東 as glyph 13577 and 京 as glyph 7236 with the explicitly configured original
fallback, keeps Latin advances/glyphs unchanged, rejects Droid as a primary
font even after loading it as fallback, and successfully reloads fallback after
that rejection. The chain uses a shared cached Arc. This is not an inspector of
the private rich-editor shaped runs.

`native.png` and `native.json` come from the actual rich editor on a newly owned
Xvfb/X11 window using the software Vulkan renderer. Every paragraph's source is
unchanged. CJK, combining marks, emoji, and the repeated Latin word have exactly
the original browser line texts. The long URL remains a separate line-layout
gap. The original fixture's CJK inter-character justification also remains a
gap: intermediate native rows end at 634px versus the browser's 640px.

`raster-comparison.json` measures the four CJK glyphs in the left-aligned final
row, away from those justification differences. The native ink height is 17px,
matching the browser. Pixel darkness relative to the original paper improves
from 0.403/0.356 of browser density in the pre-fix 東/京 captures to 0.939 for both
with the original Droid face. The untouched pre-fix native artifacts are in
`before/`. The 72×33 crops are direct integer crops without resampling.
Chrome and FreeType/WGPU antialiasing/pixel phases still differ: the glyph
pixels are not identical. This evidence covers Lora 18px regular in this fixture;
it does not establish other weights, platforms, Libre Baskerville, or Typst
font-book parity.

Reproduce the browser probe and byte checks from the repository root:

```sh
rtk proxy env TWYNE_CJK_FONT_PROBE_DIR=desktop/gpui/assets/cjk-fallback-evidence bun desktop/gpui/tools/probe-cjk-fonts-web.ts
rtk proxy python3 desktop/gpui/tools/sync-cjk-fallback.py --check
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
```

Build the existing `twyne-clipboard-probe` example with desktop/ui-tests, then
run the existing `fixtures/editor/check-long-word-native.py` in `devenv shell`
with `TWYNE_LONG_WORD_NATIVE_OUTPUT` set to a fresh owned directory and
`TWYNE_GPUI_RENDER_ICD` set to the available software Vulkan ICD. Copy its
`native.png`, `native.json`, and `comparison.json` here. This capture script
terminates its own native app and Xvfb; it never accesses the user's desktop.

```sh
rtk proxy python3 desktop/gpui/tools/compare-cjk-raster.py --evidence desktop/gpui/assets/cjk-fallback-evidence --before desktop/gpui/assets/cjk-fallback-evidence/before
```
