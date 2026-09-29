# Illuminated initials artwork

Fifty-two original image-generated illustrations: two complete A–Z alphabets. Generated with the built-in `image_gen` tool on September 29, 2026, one call per illustration. The original A supplies the first collection's style reference; alternate A supplies the second collection's reference.

## Files

- [Contact sheet](../public/assets/illuminated-initials/contact-sheet.webp): all 52 illustrations, paired for comparison on the editorial paper color.
- [Alternate alphabet](../public/assets/illuminated-initials/alternates-contact-sheet.webp): the complete alternate A–Z collection.
- [Asset manifest](../public/assets/illuminated-initials/manifest.json): filenames, dimensions, alpha verification, byte sizes, and SHA-256 checksums.
- [Exact generation prompts](../public/assets/illuminated-initials/generation-prompts.json): all 52 complete prompts and original source checksums.
- Runtime URL convention: `/assets/illuminated-initials/{a-z}.webp`; alternatives use `/assets/illuminated-initials/{a-z}-alt.webp`.

Each final WebP is 1024 × 1024 with genuine alpha transparency preserved from the generated source. There is no baked-in paper or checkerboard. The original collection uses quality 92 and the expanded alternates use quality 94; the glyph artwork has not been traced or redrawn. Originals remain in Codex's generated-images storage, but all project-referenced deliverables are self-contained in this repository.

Every illustration also has an SVG companion. These SVGs embed the optimized WebP in a 1024-square viewBox and provide a title. They behave as self-contained SVG image assets, but the illustration is raster artwork rather than vector paths. Use the WebP directly in the editor to avoid base64 overhead.

## Art direction

A dominant, immediately legible vermilion Roman serif capital with an ivory inner highlight and dark sepia engraving. Ivory acanthus, fine ink vines, and antique-gold botanical details form a coherent Renaissance book-engraving family. Transparent counters and margins retain the letter silhouette against the editor's paper.

The alternates retain the same letter family while changing the ornament arrangement for each glyph: curling acanthus, flowers, seed stems, and small gold accents. Every letter has its own separately generated alternate illustration.

## Manuscript controls

Open **View → Page layout** in the compositor. Each folio remembers its own settings:

- **Opening initial:** Off, Plain, or Illustrated; three sizes; two complete original and alternate botanical alphabets. Unsupported letters retain a readable plain initial.
- **Page border:** None, Plain, Botanical, Engraved, or Illuminated. Ornate frames reserve space around the manuscript.
- **Columns:** One, two, or three, with adjustable spacing. Narrow writing surfaces use one column for editing; proof and PDF retain the chosen page layout.

The editor decoration preserves the original text, selection, and undo history. Proof, native Typst PDF, and browser Print PDF honor the same ornament and column choices. Native proof and PDF use a raised initial so narrow columns remain readable. Standalone Typst exports embed the selected artwork. Browser Print PDF waits for artwork to load and includes it even when background graphics are disabled.

Filed, Revised, and new rubric grades use the physical walnut-stamp press animation. Existing impressions stay still; reduced-motion preferences show the completed ink impression directly.

## Validation

All 52 source images and WebPs have an alpha channel. Final alpha ranges include both 0 and 255. Each final asset is square at 1024 pixels; the SVGs embed their corresponding WebPs without external references. The contact sheets were visually inspected for correct glyphs, consistent style, and unclipped artwork.

## Ornate borders

The three border styles were regenerated with larger corner ornaments and richer engraved bands. Their native 1024 × 1536 PNG masters retain alpha transparency; runtime WebPs use quality 97. There is no artificial upscaling. [Preview the three styles](../public/assets/page-borders/paper-preview.webp); exact prompts are in the [border manifest](../public/assets/page-borders/manifest.json).

Editor, browser print, and native PDF repeat edge motifs at their natural proportions instead of stretching one motif across a whole page. The native PDF uses lossless corner and edge crops; browser print uses real images so borders survive disabled background graphics.
