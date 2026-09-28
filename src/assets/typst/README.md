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
