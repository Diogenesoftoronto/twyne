# Typst export fonts

Copied without modification from `typst/typst-assets` tag `v0.13.1`,
`files/fonts/`. `NOTICE` contains the font-specific licenses and copyright
notices; `LICENSE` is the upstream repository license.

- Libertinus Serif: regular, bold, italic, bold italic (SIL Open Font License).
- DejaVu Sans Mono: regular (Bitstream Vera / DejaVu license).

The worker imports these files with Vite asset URLs. It disables typst.ts's
default CDN font loader. The fonts and compiler ship in the web build. The current
desktop shell opens the hosted app, so it loads these assets from that origin as
well; it does not yet bundle an offline frontend. This change does not add an
offline service worker.

The distribution copy of the notices is `public/licenses/typst-fonts.txt`.
The native `.typ` export names these families; an external Typst installation
needs those fonts installed. PDF export embeds the required font data.

The native proof compiler bundles unmodified static regular, italic, bold,
and bold italic faces for the editor's main font families. Static faces are
needed because the bundled Typst compiler does not support variable font axes:

- Lora: `cyrealtype/Lora-Cyrillic`, commit `2d53b449b60e185b39f671b44fded83e0910ad30`, `fonts/ttf/`.
- Libre Baskerville: `impallari/Libre-Baskerville`, commit `9852edf75ece3af500a5ec61245f94788c3d4633`, `fonts/ttf/`.
- DM Sans: `googlefonts/dm-fonts`, commit `4412393b7d2de9fe7a92064c2dce9b5af5d7fd26`, `Sans/fonts/ttf/`.

Their upstream notices are in the corresponding `*-static-OFL.txt` files.
Fraunces (OFL) and Special Elite (Apache 2.0) come from `google/fonts`;
Fraunces remains a variable font and only its default instance is supported.
Earlier variable assets for the primary families are retained but not loaded.
No font request is sent to Google while compiling a manuscript.

Libertinus Math (7.051) is bundled from alerque/libertinus release v7.051, under the same OFL license as the Libertinus text faces, for native Typst equations.
