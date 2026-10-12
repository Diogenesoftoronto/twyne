# GPUI adapters

`gpui-base/` is the published Apache-2.0 `gpui-base` 0.7.0 crate from
[GPUI Kit](https://github.com/longbridge/gpui-kit). Original file hashes are
recorded in `gpui-base.upstream-sha256.json`; the original license is retained.

Twyne adds small, read-only or guarded editor APIs:

- `InputBaseState::can_undo()` and `can_redo()` observe the actual native history
  for the Source ribbon. They do not duplicate history or infer it from text.
- `EditorState::set_folded()` sets an existing validated fold candidate.
- `EditorState::is_folded_at()` observes its current state.
- `InputBaseState::replace_range_with_selection()` records a Source command's
  replacement and final selection in one native history transaction. Undo and
  redo restore the real cursor state, including a snippet's selected content.
- `InputBaseState::set_editor_presentation_override()` retains Source colors,
  content padding, exact row height, wrapping space and optional gutter metrics across the component facade's
  presentation projection. The default path preserves upstream geometry.
  Source can measure the native fold glyph, right-align line numbers, retain a
  continuous gutter rule and include the original gap before the code text.
- Optional `EditorSoftWrapPolicy::CssAsciiBreakSpaces` uses cached real-font
  advances for printable ASCII Source rows. It reproduces the original
  CodeMirror/CSS break opportunities, preserves source spaces and keeps
  continuation rows flush. Only changed rows are rewrapped on ordinary edits.
  The default `None`, Unicode/control/tab rows and overlapping inline metrics
  keep the upstream wrapper. The [wrapping contract](../fixtures/source_view/hyphen-wrap/README.md)
  records126 matching ASCII cases, the native input/GPU gates and21 remaining
  unsupported-row differences.
- Folded-helper fragments use validated marker byte boundaries and the
  original measured inline widths. Width changes reflow real helper rows;
  clearing the marker/unfolding removes that projection without source or
  history changes.
- Visible range bounds reject offsets preceding the currently laid-out source
  rows. This prevents a scrolled-off helper header from being clamped onto an
  unrelated visible row; source bytes, selection and history are untouched.
- Styled editor overlays can read the child's current prepaint range geometry,
  including the first frame after a scroll. This read snapshot does not change
  the upstream paint-time input, cursor, scroll or notification commits.
- The final Base Button root forwards its existing element identity, layout,
  event path and accessibility node, adding disabled metadata from the actual
  control state. A read-only Source check observes those same button nodes;
  editing actions are disabled while navigation and helper unfolding remain
  enabled. Returning to writable mode clears the disabled metadata.
- `Tab::track_focus()` binds the provided compound-tab focus handle after
  installing the observation wrapper. Rendering, keyboard dispatch,
  accessibility and UI observations therefore see the same native handle.
  Twyne retains ownership of its roving tab navigation.

Implementation changes are in `src/input/base/state.rs`,
`src/input/base/undo_manager.rs`, `src/input/base/element.rs`,
`src/input/editor/display_map/{display_map,wrap_map,fold_map,text_wrapper,inline_line}.rs`,
`src/button.rs` and `src/tabs.rs`. Editing and parser
behavior remain upstream; the guarded replacement uses the existing native
history. The element changes apply optional presentation metrics to layout and
painting, including the horizontal scrollbar inset. The Source view adds its
helper disclosure beside the actual native first-line bounds, with verified
narrow helper wrapping. Native Source tests exercise these
adapters alongside real typing, selection, undo/redo and read-only behavior.

`gpui-pre-wgpu/` retains the published Apache-2.0 `gpui-pre-wgpu` 0.3.7
renderer. Its [provenance and patch description](gpui-pre-wgpu/README.md)
record a separate font-cache role for explicitly requested fallback faces.
This permits the original Droid Sans Fallback CJK face, which has no Latin
`m`, without accepting it as a primary font. Actual native font checks verify
the original CJK glyph IDs, unchanged Latin shaping, and independent primary
and fallback requests. Shaping and rasterization algorithms remain upstream.

`gpui-pre-linux/` retains the published Apache-2.0 `gpui-pre-linux`0.3.7
platform crate. Its [provenance and narrow patch](gpui-pre-linux/README.md)
release the active X11 text-input handler synchronously when its window is
dropped, after releasing the window-state borrow. Upstream defers its XCB
close cleanup, which can retain a focused textarea entity after the platform
loop has stopped. The patch preserves that deferred close sequence and does
not change input, selection or save behavior. Actual native shutdown evidence
is recorded separately from compilation and mounted view checks.
