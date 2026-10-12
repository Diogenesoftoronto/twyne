# Twyne native assets

These assets preserve Twyne's existing source artwork and typography.
`../tools/sync-assets.ts` rebuilds their embed catalog and
`manifest.json` records the original source, byte hashes, and codec conversion
evidence for every embedded asset.

- Semantic controls come from `src/utils/icon-system.ts`, rendered with its
  actual `renderTwyneIconSvg` function and the installed Reicon 1.2.1 package.
  Both Outline and Filled weights are included. Reicon's upstream MIT notice
  is in `licenses/reicon-LICENSE.txt`.
- Drawer and editorial-board toggles retain the exact inline SVG markup from
  `src/routes/editor/index.tsx`, including its 1.6px stroke.
- The compact idle Speak icon retains `src/components/ui/speak-button.tsx`'s
  filled speaker and two round 1.8px arcs in its original 24px viewport.
- Brand marks, paper textures, rubric grade/workflow stamps, engraved writer
  avatars, illuminated initials, page borders, and manual editorial portraits
  are Twyne's original product artwork from `public/`. The portrait provenance
  is retained in `public/assets/manual/editors/manifest.json`.
- `fonts/` contains the original files from `src/assets/typst/`, together with
  their unmodified font-specific notices. `licenses/typst-fonts.txt` is the
  project's existing distribution notice. Primary native typography registers
  the regular/italic/bold/bold-italic DM Sans and Libre Baskerville faces,
  Special Elite, Fraunces, and the bundled Libertinus/DejaVu export fallbacks.
- The Lora UI faces are deterministic 400/700 upright/italic instances of the
  original bundled 3.008 variable fonts, matching the actual browser's version.
  Their internal family is `Twyne Body` to respect the Reserved Font Name;
  canonical document family names remain `Lora`. `lora-ui-provenance.json`, the
  original OFL/FONTLOG, and `tools/sync-lora-ui.py` record reproduction and
  source hashes. The original variable files and Typst static fontbook remain
  byte-identical, including their original ordering.
- `Twyne Button Sans` is an explicit UI-only instance of original DM Sans 4.004
  at opsz12/wght600 for actual 12px/600 paper buttons. Browser measurements,
  `button-font-provenance.json`, original OFL/FONTLOG and
  `tools/sync-button-font.py` record this narrow projection. The default Sans
  family, canonical document attrs and Typst fontbook are unchanged.
- Palette constants and immutable manuscript text/highlight colors are
  generated directly from `src/global.css`. `theme-tokens.json` records that
  source's SHA-256 alongside all four preset palettes.
- `paper-grain/` contains reusable alpha masks derived from the original
  body's three CSS radial gradients. Their periods, centers, one-pixel radii,
  and light/dark opacities are source-backed in `paper-grain.json` and
  `grain.rs`. These are rendering adapters for existing CSS artwork; native
  tint follows the original theme, and Broadsheet paints no grain.
- The supplemental DejaVu Sans Mono Oblique comes from the official 2.37
  archive. Its regular Mono file is byte-identical to Twyne's existing
  `src/assets/typst/DejaVuSansMono.ttf`; this adds that face's matching italic
  for native Source comments. `mono-oblique-provenance.json` records the
  pinned archive/face hashes and exact regular-file match. The full upstream
  notice is in `licenses/dejavu-LICENSE.txt`; `tools/sync-mono-oblique.py`
  reproduces the extraction without requiring any runtime font download.
- The supplemental Droid Sans Fallback is the byte-identical system face
  selected by the original zero-network Chrome writing fixture for CJK text
  after Lora. It retains the original `DroidSansFallbackFull.ttf` bytes and
  Android Open Source Project Apache notice; `cjk-fallback-provenance.json`
  records the font/notice hashes, Fedora package/source RPM, executed browser
  face/glyph evidence, and native reproduction contract. Its original notice
  is in `licenses/droid-sans-fallback-NOTICE.txt`;
  `tools/sync-cjk-fallback.py --check` verifies the embedded copies offline.
  Native writing opts into this fallback while Latin stays in Lora; source,
  document font attributes, and the Typst export fontbook are unchanged.
- The Cast circles retain their original ♠ ♥ ♦ ✦ ♣ source symbols. Actual
  original-app Chrome selects Liberation Sans 2.1.5, Inter 4.001 Regular and
  Adwaita Mono 32.4.0 after the requested DM Sans 400. The first and last are
  byte-identical copies; Inter is extracted from original TTC face 0, retaining
  every table byte except its standalone checksum adjustment. The cached
  `theme::cast_badge_font()` chain applies only to Cast badges. The original
  OFL notices, `cast-font-provenance.json` and `tools/sync-cast-fonts.py` retain
  hashes, exact glyph IDs/advances and reproducible offline checks. Shared Sans
  and Source descriptors, canonical attrs and Typst fontbook stay unchanged.
  Actual Linux selected glyph masks are verified separately from Chromium
  hinting/GPU pixels and other OS rendering.
- Original Manager assistance raw Cast symbols inherit Libre Baskerville
  16px/600 and select Liberation Serif Bold 2.1.5, with Adwaita Mono for the
  four-point star. `theme::cast_raw_glyph_font()` is a separate cached chain
  for these raw spans; circular badges and Lora card headings retain their
  existing fonts. The Serif Bold TTF is byte-identical to the original browser
  environment; `cast-raw-font-provenance.json`, the original OFL/FONTLOG and
  `tools/sync-cast-raw-font.py` retain hashes and source glyph/advance evidence.
  No shared fallback descriptor, Source or Typst fontbook changes.

GPUI's pinned image decoder supports lossless WebP but does not enable AVIF.
The 52 illuminated initials, four engraved avatars, and nine border assets have native WebP
codec copies. Every converted asset is verified against the source's complete
decoded 8-bit RGBA buffer; no pixels, alpha, crop, or dimensions are changed.
The asset source accepts the original `.avif` URL and returns the verified
native codec bytes. Existing WebP, PNG, and SVG artwork is copied byte for byte.

The font CSS names JetBrains Mono and Fira Code but the web root loads neither.
The native fallback uses Twyne's existing DejaVu Sans Mono file so monospace
text is available even without a separately installed font. This is a fallback
choice to revisit when comparing each platform's resolved web font.
