# Original Manager raw symbol fonts

The original Manager assistance spans inherit Libre Baskerville 16px/24px,
weight 600 and normal style. They differ from the DM Sans circular Cast badges
and from the Lora 20px card headings. The actual original-app CDP evidence is
[`browser-manager-raw-glyphs.json`](../../cast/browser-manager-raw-glyphs.json),
recorded by the Cast view owner with the original Google font responses.

`theme::cast_raw_glyph_font() -> gpui_kit::Font` keeps the original Libre
Baskerville primary, requested weight 600, normal style, and clones a cached
explicit `[Liberation Serif, Adwaita Mono]` fallback chain. Apply it only to
these five raw Manager assistance symbols, preserving their source bytes,
16px size, 24px line-height and persona colors. The circular badge chain,
shared automatic fallback, Source faces and original Typst fontbook are
unchanged.

| Symbol | Actual original selected face | Original DOM advance | Bundled native advance |
| --- | --- | ---: | ---: |
| ♠ | LiberationSerif-Bold 2.1.5 | 8.5px | 8.5px |
| ♥ | LiberationSerif-Bold 2.1.5 | 9.5px | 9.5px |
| ♦ | LiberationSerif-Bold 2.1.5 | 8.171875px | 8.1640625px |
| ✦ | Adwaita-Mono 32.4.0 | 9.609375px | 9.600000381px |
| ♣ | LiberationSerif-Bold 2.1.5 | 10.5px | 10.5px |

The new Liberation Serif Bold file is a byte-identical copy of the actual
original environment's font, with its unchanged OFL/copyright notice. No
download, outline transformation, subsetting, renaming or weight derivation
is involved. `assets/cast-raw-font-provenance.json` records the original and
packaged SHA-256, source path, version, selected glyph IDs and advances;
`tools/sync-cast-raw-font.py` verifies them offline. The existing packaged
Adwaita Mono Regular face is reused.

`raw-native-probe.rs` starts the pinned native Cosmic/Swash renderer with an
empty font database and loads only the declared bundled bytes. The actual
shipping helper selects glyph IDs 2223/2225/2226/6836/2224 without emoji; every
glyph produces a nonzero native raster mask. Suits select the real weight 700
Bold face while the star selects weight 400 Regular under the original 600
request. The maximum difference from the original DOM advance is 0.009375px.
The full saved result is `raw-native-bundled-only.json`; the compact face,
mask and advance evidence is `raw-verified-comparison.json`.

The probe also shapes the same Latin persona text using ordinary Sans,
Display and Body requests before and after registering the two symbol faces.
All glyph IDs, source-byte indices, positions and total advances remain
identical. The library regression separately checks the cached helper, five
glyphs/masks/advances and unchanged primary Latin shaping on the actual native
platform text system.

```sh
rtk proxy python3 desktop/gpui/tools/sync-cast-raw-font.py --check
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
rtk proxy devenv shell -- rtk proxy cargo test --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib theme::tests::real_platform_cast_raw_symbols_use_original_glyphs_and_advances
rtk proxy devenv shell -- rtk proxy cargo build --manifest-path desktop/gpui/Cargo.toml --locked --offline --features ui-tests --lib
rtk proxy devenv shell -- rtk proxy python3 desktop/gpui/fixtures/fonts/cast-glyphs/run-native-probe.py --source-rust desktop/gpui/fixtures/fonts/cast-glyphs/raw-native-probe.rs --output desktop/gpui/fixtures/fonts/cast-glyphs/raw-native-bundled-only.json
```

The standalone runner links existing libraries by their exact compiler and
dependency fingerprints; it performs no Cargo resolution or font fetch.
These are selected-face, advance and real native mask checks. Chromium
synthetic weight, hinting, GPU pixel identity, assembled Manager painting and
other operating-system rendering remain separate proof boundaries. No raster
parity claim is made from matching the font metadata or advances.
