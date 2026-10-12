# Fractional native text flow

Status: approved candidate implemented in `src/editor/view_flow.rs`. The scoped
35-test rich-view gate, strict UI library/desktop probe Clippy and final isolated
actual-X11 geometry/drag reruns pass. The assembled app gate is coordinator-owned.
The source-exact initial geometry remains unchanged; no baseline offset, CSS
metric quantization or GPUI vendor change accompanies the flow implementation.

## Implemented geometry and cache contract

Ordinary top-level paragraph/H1–H6 groups retain one immutable frame plan at the
final measured logical width. The plan's fractional content/outer bounds and
rows drive text paint, hit testing, caret/selection, UTF-16 IME, comment passages
and block-drag geometry. Real native children still run their normal layout,
dispatch, focus and accessibility traversal outside the measured callback.
Chip hit targets use their real snapped native control rectangles. Opaque
containers and imported nonstandard indentation/spacing remain on their prior
renderer paths.

The final native wrapper can differ from the measured logical width by up to
one device pixel because GPUI rounds absolute near/far edges. That difference is
validated in prepaint. It does **not** trigger paragraph reflow after Taffy has
allocated the height. The child rich block consumes the measured plan directly.
An adversarial first-frame test exposed the need for this rule: twenty words
just below a wrap threshold measured two rows each, then the rounded width
painted one row each while retaining a 1,138px scroll extent instead of 490px.
The fixed path retains the correct logical-width two-row layout and its exact
1,138px extent. The gate keeps its strict row, width and outer-extent checks.

Paragraph shaping retains at most two widths sharing the full existing context
key: immutable node, ink, initial, opening settings, atom generation, float
carry, typography, note ordinals and language. This preserves unchanged Arc
identity when native measurement visits alternate widths; node/style/context
changes discard both variants. The unchanged discretionary-hyphen cache test
remains intact. No document text projection, HTML serialization or dictionary
rebuild was added to ordinary typing.

## Scoped acceptance checkpoint

- All 35 `editor::view::` checks pass, including four new flow gates. They cover
  first frame and 704→554→704 resize, real heading controls, the wrap-threshold
  extent, 51-block fractional scroll/last-block mouse and UTF-16 IME, clipboard,
  undo and unchanged layout reuse, plus opaque quote/task/table controls.
- Existing exact comment hover/chip keyboard focus/occlusion, multiline backward
  selection, image/math editing geometry and heading/atom drag/cancellation
  checks pass under the new frame path.
- `cargo clippy --features ui-tests --lib -- -D warnings` passes.
- Actual isolated X11 704/554 original-font Notebook measurements and nine OS
  drag checks pass after the logical-width correction. Both PNG captures are
  retained as `fractional-text-flow-native-{704,554}.png` alongside the JSON.

At 704px, native H2 is now y378.5 against original y378.4375, and the closing
paragraph is y418.100006 against original y418.03125. At 554px, H2 is y443.300018
against original y443.21875, and the closing paragraph is y482.900024 against
original y482.8125. The former accumulated whole-pixel drift is removed while
the small explicit CSS-used-metric/native-fraction difference remains.

`fractional-text-flow-evidence.json` retains measured native and original Chrome
geometry, rows and provenance. The owned browser still lacks an English
hyphenation dictionary; retained real-app break evidence is used for the
`remem-`/`ber` and narrow opening-row assertions. Whole-UI pixel identity is not
claimed. The approved proposal and public API findings below explain the scope
and remaining native/browser metric differences.

## Public API findings

The pinned `gpui-pre 0.3.7` exposes `AnyElement::layout_as_root`, `prepaint_at`,
`prepaint_as_root` and `paint` in `src/element.rs:634–664`. These keep normal GPUI
dispatch, keyed state, focus and accessibility traversal. The existing native
comment buttons and atom images already use this public child-placement path.

There are two limits:

1. `Window::layout_bounds` in `src/window.rs:5089` pixel-snaps the absolute
   element offset. Ordinary `AnyElement::prepaint_at(fractional_origin)` therefore
   delivers snapped child bounds. It cannot by itself preserve fractional rich
   text origins. `layout_as_root` also returns the snapped size.
2. `Window::compute_layout` at `src/window.rs:5074` temporarily takes the layout
   engine out of the window. A measured-layout callback must not call
   `layout_as_root`/`request_layout`/`compute_layout` for a child: that is a
   reentrant layout-engine access. Child root layout belongs in prepaint, after
   the enclosing layout has completed.

The exact native paragraph heights already exist independently in
`Arc<ParagraphLayout>`. Before this candidate, the parent handed each text leaf
and margin to Taffy separately, losing those fractions before the next block was
positioned.

## Bounded implementation candidate

Add a custom `TextFlowElement` for each contiguous top-level sequence of ordinary
paragraphs and H1–H6 headings. Keep the current root manuscript Div, focus/action
bindings and host scrolling. A code block, image, equation, list, quote, table or
other container is an opaque barrier that continues through its existing native
renderer; this first slice does not rewrite nested/table/object layout.

At measurement time, the flow uses the existing cached rich blocks and
`layout_block` results to build an immutable frame plan: path, global scalar
start, exact content bounds, collapsed source margins, optional H1 ornament and
total extent. It sums the actual fractional heights and margins before giving
one final extent to Taffy. No child `AnyElement` layout occurs inside this
callback. Existing float-carry, font, atom, note and comment shaping caches remain
the measurement authority; source text/HTML is not regenerated or diffed.

At prepaint time, ordinary child elements use `layout_as_root`/`prepaint_at`
outside the callback. A narrow shared frame-placement record supplies the rich
`BlockElement` with the exact logical content rectangle. Its prepaint and paint
both use that same rectangle rather than the snapped wrapper bounds. The exact
rectangle also populates `PlacedBlock`, comment ink geometry and per-node drag
geometry. This is a complete layout-boundary change, not a paint-only baseline
shift. A cached decorative H1 star uses its source line-height/top gap in the
same frame plan, avoiding its separately rounded text Div height.

The native chip buttons, heading handles, artwork and images remain real
`AnyElement` children with their existing IDs, focus, roles, click/key handlers
and platform input dispatch. Their actual snapped control rectangles are used
for control hit targets. Marked text, caret, selection, IME rectangles and drag
drop boundaries use the exact rich-text frame rectangles. Ordinary opaque
objects retain their current measured/dispatch paths.

No Root event or coordinator API needs to change. Existing `caret_bounds`,
`selection_endpoint_bounds`, comment line-rectangle APIs, `block_bounds`, drag
events, viewport cancellation and UTF-16 input callbacks consume the refreshed
same-frame caches. The total flow extent remains an ordinary measured child of
the host manuscript/scroller; the final outer extent may be rounded once.

## Precision and tradeoffs

The first implementation would preserve the current native fractional source
metrics. It would remove cumulative per-block rounding, while retaining a final
outer extent rounding and normal native control/image edge snapping. It would
not claim every nested container or every browser's pixel raster matches.

Chrome's measured used line height is 32.390625px for computed CSS 32.4px, and its
H1 ornament/gap are 17.59375px/4.796875px for 17.6px/4.8px. The current native
metrics remain 32.4px/17.6px/4.8px. Summing these native fractions would place the
704px H2 at about y378.5 rather than the source y378.4375, eliminating the current
integer y380 accumulation while leaving a small explicit used-metric gap.
Source-compatible 1/64px metric quantization needs a separate verified policy,
especially for authored line-height/spacing and mixed inline sizes; it must not
be smuggled in as a guessed baseline offset.

The flow groups add a small frame-placement abstraction and grouped extent
calculation. Unchanged block shaping still returns its existing Arc cache.
Render already walks top-level nodes; the candidate adds no whole-document
serialization, text projection or dictionary rebuild per key. A changed block
height necessarily repositions later blocks, but does not reshape their text.

The main implementation risk is disagreement between normal snapped control
geometry and exact rich text geometry. The bridge must be authoritative in both
prepaint and paint, keep control hitboxes tied to their real native bounds, and
never use a previous frame's placement for caret/IME/drag/comment APIs. Another
risk is an incorrect extent on the first frame or width change; the frame plan
must use the final measured logical width and validate that prepaint differs
only by the documented native wrapper edge snap. It must not reflow afterward.

## Required gate before claiming the remedy

- First-frame and resized 704/554px measured text bounds; original Notebook
  widths, body rows, floats and source-exact H1/H2 source margins.
- A long sequence of fractional-height paragraphs, validating the host scroll
  extent and selection/IME bounds at the final block, including scrolling.
- Real mouse placement/selection across blocks, backward/multiline selection,
  grapheme and UTF-16 IME replacement, rich clipboard and one-step undo.
- Exact comment line hover/chip focus and occlusion; actual heading/atom drag,
  section boundaries, cancellation and host viewport autoscroll.
- Existing native control accessibility IDs/roles/focus ordering, and unchanged
  opaque image, equation, quote, list and table interaction paths.
- Fresh owned X11 actual-font Notebook screenshots at both room widths, followed
  by the coordinator's integrated app gate. No user profile/display is accessed.

If those paths cannot share one coherent geometry record, retain the current
bounded rounding gap. A global GPUI snap change or Cosmic shaping fork is not
part of this proposal.
