# Native URL wrapping evidence

The writer uses source-scalar UAX14 opportunities, with the measured Chromium
printable-ASCII tailoring after slash, dot, and colon. Natural text segments are
shaped in chunks of at most 256 source scalars; a single extended grapheme remains
indivisible. The same-style context stops at floats, hard breaks, and comment
widgets. An unchanged block retains its layout and break cache.

The pinned Cosmic-text shaper separates UAX14 words even with wrapping disabled.
That loses slash-to-letter kerning which the original browser retains. Bounded
display text therefore adds a default-ignorable U+2060 after slash before an ASCII
URL character. `Piece.display_boundaries` maps that display back to the unchanged
document scalars. Canonical HTML/Typst, plain and rich clipboard content, IME
offsets, and history contain no added control. No platform renderer or dependency
fork is used for this adapter. The original `kern`, `liga`, and `onum` settings
are applied while shaping.

The browser fixture uses original Lora **3.008** variable font bytes at weights
400–700, the actual global CSS, and the original Tiptap editor. Native uses the
corresponding 400/700 UI instances through the source-family mapper, plus the
original Droid fallback for CJK. Each run starts owned Chrome and a newly
allocated Xvfb display, then terminates them; zero network requests occur and no
user browser profile or desktop is accessed.

```sh
rtk proxy env TWYNE_RICH_FIXTURE_ENTRY=url-wrap-web-entry.ts TWYNE_LONG_WORD_OUTPUT=/tmp/twyne-url-wrap-web-3008 bun desktop/gpui/fixtures/editor/capture-long-word-web.ts
rtk proxy devenv shell -- cargo build --locked --offline --example twyne-clipboard-probe --features desktop --manifest-path desktop/gpui/Cargo.toml
rtk proxy env TWYNE_RICH_FIXTURE_HEIGHT=3000 TWYNE_LONG_WORD_REFERENCE=/tmp/twyne-url-wrap-web-3008/reference.json TWYNE_LONG_WORD_NATIVE_OUTPUT=/tmp/twyne-url-wrap-native-joined-3008 devenv shell -- python3 desktop/gpui/fixtures/editor/check-long-word-native.py
rtk proxy env TWYNE_RICH_FIXTURE_ENTRY=url-width-web-entry.ts TWYNE_LONG_WORD_OUTPUT=/tmp/twyne-url-width-web-3008 bun desktop/gpui/fixtures/editor/capture-long-word-web.ts
rtk proxy env TWYNE_LONG_WORD_REFERENCE=/tmp/twyne-url-width-web-3008/reference.json TWYNE_LONG_WORD_NATIVE_OUTPUT=/tmp/twyne-url-width-native-joined-3008 devenv shell -- python3 desktop/gpui/fixtures/editor/check-long-word-native.py
rtk proxy devenv shell -- cargo test --locked --offline --features ui-tests --lib --manifest-path desktop/gpui/Cargo.toml long_words_wrap -- --nocapture
```

All thirteen protocol, bare-domain/path, slash, dot, colon, auto/manual, and mixed
CJK URL cases have the same measured source text in every row as the browser.
Native caret measurements leave the source HTML unchanged and keep every row
inside the 600px writing area. The short unwrapped `ab/` ×5 passage measures
153.4375px in the browser and 153.432px natively; `arriving/` ×4 measures
307.15625px and 307.152px. The explicit-joiner passages in the width fixture are
diagnostic controls; the URL corpus itself contains no joiners.

Mounted native interaction checks cover slash passages across future span
metadata, real measured mouse selection, source-only clipboard content,
surrogate-safe IME candidate/commit, exact Undo, and retention of an unaffected
block's cache. These use GPUI test fonts; the separate X11 capture establishes
actual font width and row evidence.

This establishes the listed contexts, not general browser line layout or raster
identity. The fourteenth case, a repeated `arriving-` compound, still differs in
automatic English dictionary/manual-break preference. Other dictionary choices,
cross-style/chunk kerning, inter-character CJK justification, bidi/script
layout, soft-hyphen/wbr opportunities, and wrap-boundary caret affinity remain
separate work. The comparison driver records these distinctions rather than
declaring every corpus row identical.
