# Original Cast symbol fonts

This fixture audits the actual original Twyne Board, with its original Google
font responses and unchanged `.cast-icon` controls, against the native Linux
text system. It does not replace the app's CSS or inject a substitute face.

Source truth is `src/utils/personas.ts` and the `.cast-icon` style in
`src/components/personas/personas-panel.tsx`. The five controls retain ♠ ♥ ♦ ✦ ♣,
normal 400, DM Sans 11.2px/16.8px, a 1px colored border and 1.35rem circle. Actual
Chrome 150 rounds the circle to 21.59375px. Its requested CSS stack is
`"DM Sans", Inter, system-ui, sans-serif`; CDP reports these real selected faces:

| Symbol | Actual original face | Original DOM advance | Old native automatic advance |
| --- | --- | ---: | ---: |
| ♠ | LiberationSans 2.1.5 | 5.953125px | 7.011199951px |
| ♥ | Inter-Regular 4.001 | 11.453125px | 7.772799969px |
| ♦ | LiberationSans 2.1.5 | 5.71875px | 6.664000034px |
| ✦ | Adwaita-Mono 32.4.0 | 6.71875px | 6.742968559px |
| ♣ | LiberationSans 2.1.5 | 7.34375px | 8.691200256px |

Every old native glyph has a real nonzero raster mask; the problem is selected
face/geometry, not tofu. No actual DM Sans primary glyph covers these five.
The old selected FontIds are recorded without assuming their family names.
Adding Inter alone fixes the heart but leaves the other four fallback choices.

`theme::cast_badge_font() -> gpui_kit::Font` keeps the unchanged DM Sans 400
primary and clones a cached explicit `[Inter, Liberation Sans, Adwaita Mono]`
fallback chain. Apply the helper only to the final Cast glyph Font. It does
not set size, line-height, color, circle geometry or accessibility; those remain
the original control's responsibility. Latin primary glyphs/advances are
unchanged. Source/default fallback descriptors, canonical attrs and original
Typst fontbook are untouched.

Three exact faces are packaged/registered by `theme::apply`. Liberation Sans
and Adwaita Mono are byte-identical copies of the original environment files.
Inter is Regular TTC face 0, extracted without name, outline, advance, hint or
weight changes; all original table bytes match except the required standalone
`head.checkSumAdjustment`. Its 13MB multi-face TTC need not ship at runtime.
The original OFL/copyright notices, file/table hashes and pinned FontTools 4.61.1
extraction contract are in `assets/cast-font-provenance.json`,
`assets/licenses/cast-*`, and `tools/sync-cast-fonts.py`. The source package's
Inter version is 4.1 while the executed Regular face's own version is 4.001;
these are recorded separately.

`native-fonts.json` preserves the actual pre-packaging platform audit. The
bundled-only probe starts a new `CosmicTextSystem::new_without_system_fonts`
with an empty database, then runs the shipping `theme::apply` registration.
Its selected IDs 2230/1867/2233/6836/2231, advances and actual raster masks thus
come from the bundled path, independently of installed environment fonts.
`native-bundled-only.json` and `verified-comparison.json` retain the result.
`native-with-bundled-platform.json` also confirms that all five existing Linux
automatic Sans glyph IDs and advances remain unchanged after registration.

Reproduce without dependency resolution or font downloads:

```sh
rtk proxy python3 desktop/gpui/tools/sync-cast-fonts.py --check
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib theme::tests::real_platform_cast_symbols_use_original_glyphs_and_advances
rtk proxy devenv shell -- rtk proxy cargo build --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib
rtk proxy devenv shell -- rtk proxy python3 desktop/gpui/fixtures/fonts/cast-glyphs/run-native-probe.py --embedded-only --output desktop/gpui/fixtures/fonts/cast-glyphs/native-bundled-only.json
rtk proxy python3 desktop/gpui/fixtures/fonts/cast-glyphs/compare.py --check
```

The standalone probe links already-built libraries from the same Rust compiler
fingerprint. FontTools 4.61.1 is needed only for extraction/check tooling. Optional
`--liberation`, `--inter-ttc`, `--adwaita` inputs reproduce the original copies
from files matching the pinned hashes. Supplying `--inter-ttc` during `--check`
also re-extracts and verifies every original TTC table against the packaged TTF.

`probe-actual-app.js` requires permission to use an isolated original-app
Playwriter session with its Board open; it reads the five real controls via CDP
and creates no attached nodes. Restore the original Board/viewport/manuscript
after measuring. The saved session 4 was restored/released after this audit.

Font selection, advances and nonzero Linux masks are verified. Chromium
hinting/GPU pixel identity, actual assembled Cast UI painting, clean packaging
on other operating systems and platform-specific rasterization remain separate
proof boundaries. This audit does not claim those checks.
