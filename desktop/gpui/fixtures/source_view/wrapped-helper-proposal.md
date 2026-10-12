# Source helper display-map contract and evidence

This bounded optional Base API is implemented and gated through the real native
Source entity. It preserves the manuscript, history, and ordinary input path.
It does not claim general Source wrap or glyph-raster parity.

The actual original app is `CSS1Compat` with an HTML doctype. The corrected
zero-network `capture-web.ts` fixture uses that mode, original CSS/Tailwind
preflight and the actual DM Sans response. Its header plus inline disclosure
occupies 21.4375px at ordinary widths, 42.875px at 320px and 85.75px at 160px.
The earlier 40.578125px/80.15625px came from a quirks-mode fixture, archived in
`legacy-quirks/`; they are not the app's geometry.

At 320px, `Document ` remains after the header and `helpers` starts on the next
display row. At 160px the source header itself wraps into two rows, followed
by the two disclosure fragments. Each row remains 21.4375px. The browser uses
CSS inline box slicing: the first fragment has the 7px left border/padding,
the last has the 7px right border/padding, and the 1px inline margins occur
only at the outside ends. The original disclosure's ordinary width is
108.234375px and its box height is 20px.

The existing Base inline-token metric is a nonempty source range replaced by
one object width. It cannot describe an empty trailing source anchor, wrapped
word fragments, or display-only rows. Empty ranges are skipped by the text
wrapper and inline-line offset logic. Adding empty ranges to that API would
also make EOF caret affinity and IME position ambiguous.

Separate immutable, optional presentation seam:

```rust
pub struct FoldPlaceholderPresentation {
    pub source_offset: usize, // UTF-8 boundary; after // twyne-document:1
    pub folded_row: usize,    // requires row 0 to remain folded
    pub fragments: Arc<[FoldPlaceholderFragment]>,
    pub source_break_offsets: Option<Arc<[usize]>>, // Source supplies [3,9]
}
pub struct FoldPlaceholderFragment {
    pub advance: Pixels, // shaped word + applicable sliced box edges
    pub break_after: bool,
}
// Setter compares the bounded metrics; it does not edit Rope/history.
EditorState::set_fold_placeholder_presentation(
    Option<FoldPlaceholderPresentation>, cx
);
// Current-prepaint positions, one bound per fragment, after native wrapping.
EditorState::fold_placeholder_bounds() -> Option<Arc<[Bounds<Pixels>]>>;
```

Only the two constant label words are shaped outside the engine, using a
renamed original DM Sans 4.004 opsz11/wght400 helper face. The Source caller
compares the folded marker byte-for-byte before deriving space/hyphen breaks
from its real UTF-8 characters. The optional engine validates ordered real
byte boundaries, at most 32 breaks and a 512-byte row. It measures this exact
folded row only, restoring upstream ranges when removed. The separate Source-only ASCII policy now handles ordinary/unfolded
printable-ASCII rows; its contract and remaining unsupported-row gaps are
recorded in `hyphen-wrap/README.md`.

Base reserves their real wrapped rows in `WrapMap`/`FoldMap` and line layouts, then returns
their fresh prepaint geometry. A Source sidecar paints the original sliced
boxes/text at those positions and gives them one `folded code` button node.
Both hit areas unfold the same row; read-only Source keeps this navigation
enabled. No placeholder characters enter source, serialization or history.

Caret affinity at the anchor remains **before** the display-only label. The
label's extra rows must not change the source offset returned by caret hit
testing, selection endpoints, keyboard movement, or IME queries. Clicking
label bounds unfolds; clicking elsewhere uses ordinary source hit testing.
The extra visual height must still contribute to scrolling and visible-row
lookup so the next authored source line does not overlap the label.

The optional value is cleared when the header changes, folding changes, or
the source is replaced. A normal width/wrap/font/scroll update invalidates
only display geometry; cached constant fragment metrics do not require a
whole-document scan, serialization or helper process per key.

Acceptance gates: the four measured widths and scroll-off/first-frame cases;
unchanged source, selection and undo/redo; explicit EOF/anchor affinity;
pointer activation of both wrapped fragments; read-only unfolding; actual
caret/IME bounds after reserved rows; absence on ordinary source; removal and
reappearance on real folding and source replacement. Existing ordinary-width
Source tests remain required alongside these new engine tests.

The mounted resize harness sends the actual platform `bounds_changed(cx)`
notification after changing platform window size. GPUI's test platform does
not emit that callback itself; omitting it renders the previous viewport.

Nine mounted Source tests pass, including 1280/640/320/160 widths, real
caret/IME positions, both read-only sliced-fragment clicks, replacement/no-wrap
cleanup, and actual native editing with Ctrl+Z, Ctrl+Y and Source-only
Ctrl+Shift+Z. The installed original CodeMirror `historyKeymap` supplies both
Linux redo bindings; Twyne's application adds the latter alias to actual native
Redo, without changing Base global bindings. Thirteen actual GPU fixtures and
the separate no-helper regular/heading/comment/CJK caret fixture pass. Saved
`native-wrapped/native-reference.json` reports verified fragment geometry,
logical row height and unchanged source/history. Browser DPR1 and native DPR2
are explicit; native pixels are not asserted identical to Chrome's raster.

Upstream provenance remains `vendor/gpui-base.upstream-sha256.json` for the
published Apache 2.0 gpui-base 0.7.0. This slice modifies these existing files:

- `src/input/base/state.rs`: optional immutable request and current-prepaint
  fragment bounds; real native selection/IME data remain authoritative.
- `src/input/base/element.rs`: resolve optional layout before visible-row
  selection, append paint-free presentation rows, skip those rows when building
  source range decoration rectangles, retain fresh child-prepaint geometry.
- `src/input/editor/display_map/display_map.rs`: bounded request validation,
  folding/source guards, actual-layout synchronization and source invalidation.
- `src/input/editor/display_map/text_wrapper.rs`: SumTree row reservation,
  optional measured real marker breaks, restoration of original ranges, and
  source EOF affinity. Authored ranges stay nonempty; no filler tokens exist.
- `src/input/editor/display_map/inline_line.rs`: explicit paint-free
  Presentation row, separate from real text/inline-token content.
- `src/input/editor/display_map/wrap_map.rs`: delegate bounded row-layout
  updates without changing buffer source.
- `src/input/editor/display_map/fold_map.rs`: invalidate optional row
  projection before rebuilding; ordinary identity/fold behavior stays upstream.

The separate previously delivered actual-node disabled metadata adapter is in
`src/button.rs`. No new parser, history, renderer, dependency or manifest edits
are part of the folded-helper slice.
