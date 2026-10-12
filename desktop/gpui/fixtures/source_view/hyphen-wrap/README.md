# Bounded Source ASCII wrapping

This optional presentation slice preserves the original native input entity,
rope, byte offsets, selection, IME, history and folded-helper projection.
`SourceEditorView` sets the policy; other inputs retain `None` by default.

```rust
pub enum EditorSoftWrapPolicy {
    CssAsciiBreakSpaces,
}
// Optional field on the existing presentation struct:
InputEditorPresentation { soft_wrap_policy: Some(EditorSoftWrapPolicy::CssAsciiBreakSpaces), .. }
// No new document or mutation API:
EditorState::set_editor_presentation_override(Some(presentation));
```

Only rows containing printable ASCII bytes 32..126 and no overlapping inline
metrics use this path. Rows containing any Unicode, control or tab retain the
upstream wrapper. Clearing the optional policy restores the upstream path.
The Source-only caller continues using the verified original Mono, font size
13px, exact row height 21.4375px and original body/gutter padding.

Normal opportunities precede nonempty emergency cuts at actual source byte
boundaries. Spaces are preserved, including trailing spaces. Continuation rows
remain flush-left; the original indentation stays real source text. The narrow
ASCII compatibility rules include the browser's three-character minus/digit
context; default Unicode UAX14 alone does not reproduce it. These are a
functional projection verified against the executed original Source, with no
Chromium tables or implementation copied into the native renderer.

Each wrapper caches at most 128 actual-font advance widths. Font or size
changes invalidate that cache; ordinary edits rewrap only the affected rows.
Only changing the policy or existing viewport/font configuration invalidates
the complete display projection. No source serialization, subprocess, added
source characters, filler tokens or history changes are used for wrapping.

The read-only browser fixture executes original `typst-code-editor.ts`, current
CodeMirror and original CSS/Tailwind in standards mode with the actual Noto
Sans Mono system face. It blocks all network requests. Plain CSS clones return
the same rows, separating browser CSS behavior from highlighting markup. The
pinned primary implementations inspected are Chromium 154.0.8037.57's
[ASCII line-break data](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.57/third_party/blink/renderer/platform/text/character_property_data_generator.cc)
and [fast three-character context](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.57/third_party/blink/renderer/platform/text/text_break_iterator.cc).

`web-hyphen-wrap.json` has 28 cases × six widths
1280/640/320/200/160/130. All 126 printable-ASCII results match the real Linux
text system and native WGPU renderer in `native-fixed-hyphen-wrap.json`.
`verified-comparison.json` retains 21 Unicode/CJK/tab differences from the
42 unsupported-row results. Those are explicit remaining gaps. The historic
20-case native baseline and `comparison.json` remain available under their
original names; `proposed-ascii-model.json` is an earlier fixed-advance
proposal, not the current actual-font/rendering evidence.

At 160px the original ordinary hyphen example now has rows
`opening-`, `concrete-`, `after-`, `midnight` in both implementations.
`web-*.png` uses DPR 1 and `native-fixed-*.png` uses DPR 2. The checked geometry
is logical pixels; the glyph raster is not asserted identical.

All 16 Source tests pass, including 13 mounted gates and three explicitly
enabled actual-GPU gates. They cover exact source rows, nonempty read-only
selection/IME, genuine native typing and Linux Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z,
resize with real platform bounds notification, first-frame scroll/caret,
existing four-width helper fragments/unfolding, no-wrap/replacement cleanup,
restoring None and unchanged unsupported rows. A real textarea token verifies
inline-metric fallback with its measured narrower object width; code-editor
states deliberately reject `InputContent` tokens and cannot prove that path.

```sh
rtk proxy bun desktop/gpui/fixtures/source_view/probe-hyphen-wrap-web.ts
rtk proxy env \
  VK_DRIVER_FILES=/nix/store/gqpsfqzgbcbwbh12n3sjxk2x4gqgy8lq-mesa-26.1.3/share/vulkan/icd.d/lvp_icd.x86_64.json \
  WGPU_BACKEND=vulkan XDG_RUNTIME_DIR=/tmp/twyne-paper-grain-native-runtime \
  TWYNE_SOURCE_CAPTURE_DIR=/tmp/twyne-source-after-ascii \
  TWYNE_SOURCE_HYPHEN_REFERENCE=/tmp/twyne-source-hyphen-web/web-hyphen-wrap.json \
  TWYNE_SOURCE_HYPHEN_CAPTURE_DIR=/tmp/twyne-source-hyphen-native-fixed \
  CC=/usr/bin/clang CXX=/usr/bin/clang++ \
  LIBRARY_PATH=/nix/store/1jlp4w0mjyyf2byglz9q6vnmnprl4xgn-libxkbcommon-1.4.1/lib \
  RUSTFLAGS='-C linker=/usr/bin/clang' CARGO_BUILD_JOBS=4 \
  cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml \
  --lib --features ui-tests source_view::tests \
  -- --include-ignored --test-threads=1
rtk proxy python3 desktop/gpui/fixtures/source_view/hyphen-wrap/compare.py \
  --web /tmp/twyne-source-hyphen-web/web-hyphen-wrap.json \
  --native /tmp/twyne-source-hyphen-native-fixed/native-hyphen-wrap.json
```

Published upstream provenance stays in
`vendor/gpui-base.upstream-sha256.json` with its Apache 2.0 license/notices.
This slice changes five already-vendored files:

- `src/input/base/state.rs`: optional field and public policy enum.
- `src/input/base/element.rs`: resolve the optional policy before native wrapping.
- `src/input/editor/display_map/display_map.rs`: rebuild folding projection only
  when the policy changes.
- `src/input/editor/display_map/wrap_map.rs`: delegate the optional setter.
- `src/input/editor/display_map/text_wrapper.rs`: ASCII eligibility/rules,
  bounded actual metrics and changed-row wrapping; the None/fallback branch
  retains the upstream line-wrapper/inline-fragment logic.

No parser, source history, native renderer, dependency, manifest or source
font change belongs to this slice. The previous source-only font and separate
folded-helper seam retain their existing provenance and measured limits.
