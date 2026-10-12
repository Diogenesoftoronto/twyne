# Native writer-comment evidence

The model supports independent overlapping writer marks and exact undo, retaining
unknown span attributes and source atoms. `AddComment` and `RemoveComment { id }`
refuse a read-only document. Selection and explicit anchor queries are
history-neutral; ordinary typing does not enumerate all comment IDs.

The native surface paints writer ink and a source-free end chip. Pointer, Enter,
and Space activation emit `CommentRequested { id, range }` without moving the
manuscript selection or changing its history. Repeated IDs keep separate current
passage ranges. `comment_bounds` and `comment_range_bounds` return cached passage
rectangles from the first marked row through the last, including the inline
border; button hitboxes are independent. Quiet mode preserves layout and geometry
while suppressing ink and interactive chips.

`comment_anchor_bounds(id)` returns cached disjoint passages, each containing its
exact measured line rectangles. `CommentHoverChanged { id }` uses actual native
ink and chip hitboxes, including nested IDs, rather than the multiline union.
An unpainted gap between lines does not peek. Normal occluding popup hitboxes
block underlying mark hover. Real chip focus retains the peek after the pointer
leaves; focus-out clears it. An ordinary manuscript caret inside a mark does not
create chip focus. Readonly, quiet and active drag paths clear/suppress the event.
Neither pointer nor focus paths scan source, change selection or create history.
Root qualifies these events against the current editor/folio and owns the preview.

The mounted precise-hover checks additionally exercise disjoint/nested marks,
actual chip pointer focus and focus-out delivery, the multiline gap, a real
`.occlude()` overlay, and identical quiet geometry:

```sh
rtk proxy devenv shell -- cargo test --locked --offline --features ui-tests --lib --manifest-path desktop/gpui/Cargo.toml precise_comment_hover_ -- --nocapture
```

`current_block_text_content()` resolves only the caret's cached text-block path
and visits that block at an explicit Flow/changed-block boundary. Like the
original ProseMirror `node.textContent`, it omits atom payloads and hard-break
leaf labels; no other block or complete document is projected.

Reproduce the focused interaction checks:

```sh
rtk proxy devenv shell -- cargo test --locked --offline --features ui-tests --lib --manifest-path desktop/gpui/Cargo.toml native_comment -- --nocapture
```

The browser reference uses the original `CommentMark`, `MarkAnchorWidgets`, CSS,
and original Lora 3.008 variable font bytes on an owned headless Chrome, with zero
network requests. Native uses the matching derived 400/700 UI instances through
the source-family mapper; canonical font attributes remain Lora.
The native probe uses actual font assets on a newly allocated Xvfb X11 display;
the driver terminates that display and never reads the user's browser profile.

```sh
rtk proxy env TWYNE_RICH_FIXTURE_ENTRY=comment-web-entry.ts TWYNE_LONG_WORD_OUTPUT=/tmp/twyne-comment-web-3008 bun desktop/gpui/fixtures/editor/capture-long-word-web.ts
rtk proxy devenv shell -- cargo build --locked --offline --example twyne-clipboard-probe --features desktop --manifest-path desktop/gpui/Cargo.toml
rtk proxy env TWYNE_LONG_WORD_REFERENCE=/tmp/twyne-comment-web-3008/reference.json TWYNE_LONG_WORD_NATIVE_OUTPUT=/tmp/twyne-comment-native-current-3008 devenv shell -- python3 desktop/gpui/fixtures/editor/check-long-word-native.py
rtk proxy env TWYNE_RICH_FIXTURE_ENTRY=comment-web-entry.ts TWYNE_RICH_FIXTURE_QUIET=1 TWYNE_LONG_WORD_OUTPUT=/tmp/twyne-comment-web-quiet-3008 bun desktop/gpui/fixtures/editor/capture-long-word-web.ts
rtk proxy env TWYNE_LONG_WORD_REFERENCE=/tmp/twyne-comment-web-quiet-3008/reference.json TWYNE_LONG_WORD_NATIVE_OUTPUT=/tmp/twyne-comment-native-quiet-current-3008 TWYNE_NATIVE_COMMENTS_QUIET=1 devenv shell -- python3 desktop/gpui/fixtures/editor/check-long-word-native.py
```

The measured first passage begins at native `(40, 44.68)` and browser `(40, 44)`;
its horizontal extent agrees within 0.02px. The native border box is 25.04px tall,
versus 25px in the browser. Justified spaces carry their visual advance, so writer
backgrounds and borders remain continuous across them. Normal/quiet captures
retain identical native HTML, row flow, and passage geometry.

This is bounded evidence, not complete browser typography parity: the long
passage fixture still differs in English dictionary breaks (`pas-/sage` versus
the browser's whole-word break), and later paragraph positions show layout
rounding. Arbitrary CSS functional colors, 1.6× hover/focus scaling and transitions,
persona/suggestion chips, and mark-text double-click
dismissal remain separate work. Semantic writer colors and basic/hex colors are
painted without changing their original HTML metadata.

Pixel inspection of the assembled 620px and 1280px actual app captures proves
the opening pending mark's two-pixel aubergine border is present. At 620px it is
native y330–331/x293–587 versus browser y328–329/x294–587; at 1280px it is native
y352–353/x556–931 versus browser y350–351/x558–938. The exact ink is RGB
127,69,96. These retain the measured baseline/row-width gap rather than claiming
identical browser paint. References are Root's
`/tmp/twyne-native-writing-rail-{620,1280}.png`,
`/tmp/twyne-reference-writing-620.png` and
`/tmp/twyne-reference-quiet-original-fonts.png`.
