# Source presentation evidence

These fixtures execute the original `typst-code-editor.ts`, `document.ts`,
`theme.ts`, installed CodeMirror, and `global.css`. The standards-mode browser
probe embeds the original DM Sans response and blocks every external request.
The original app is also CSS1Compat with an HTML doctype. It writes the exact
canonical document, measured CSS geometry, and thirteen browser screenshots.

```sh
rtk proxy env TWYNE_SOURCE_WEB_FONT=original-response bun desktop/gpui/fixtures/source_view/capture-web.ts
```

The native `SourceEditorView` wraps the caller's existing `EditorState`; it does
not create a second document or edit source for presentation. Source colors,
selection, caret, gutter, fold glyph, padding and ribbon metrics come from the
original CSS and current theme. The helper label and footer labels share an
original DM Sans 4.004 opsz11/wght400 face at 11px, exposed as
`SOURCE_HELPER_FONT` and `FOOTER_FONT`. Code uses a Source-only `Twyne Source`
adapter of the exact Noto Sans Mono 2.014 Regular400/SemiBold600 files selected
by the original app's browser. Shared
DejaVu mono/code/Typst fonts are unchanged. The original app selects Regular
for CSS italic comments; native comments use quarter-sheared original outlines
because the pinned native renderer does not synthesize italic. All glyph IDs
and advance widths remain unchanged. The untouched originals, correct OFL
notice, deterministic FontTools4.61.1 reproduction tool and adapter provenance
are packaged together; original autohints are removed only for oblique.
The persistent optional Base presentation override retains native input,
selection, IME, search and undo/redo. Clearing that override retains upstream
defaults.

The presentation seam uses the current child prepaint geometry, so a first
frame after scrolling cannot reuse a stale helper anchor. Source sets the
native soft-wrap safety margin to zero because the original 16px right padding
already supplies the desired text inset; native caret safety remains unchanged.

The measured source row is **21.4375px** (the browser's layout of 13px × 1.65).
Content has 16px top/bottom padding; the code begins 16px after the real gutter.
Numbers use 5px left and 3px right padding with 20px minimum width. Fold glyphs
use the original `›`/`⌄` characters and 1px inline padding. The disclosure uses
the original label, color, 2.2px radius, 1px border, 2px/6px padding, accessible
label `folded code`, and `unfold` tooltip. Its measured fractional text width
avoids GPUI's generic text node rounding the label up to a whole CSS pixel.

The `source_view` native tests mount the actual editor and all thirteen ribbon
controls. They verify source/selection/history neutrality when unfolding,
read-only native input, disabled dispatch, pointer hover, theme overrides,
scroll-off bounds, ordinary-source exclusion, and real Linux font geometry.
Native positions can snap to physical pixels; the actual selected Source faces
and original measured advances are tested independently of the mocked fonts.
Disabled Source controls expose disabled metadata on their actual observed
native button node. Read-only helpers remain an enabled navigation control.

An explicitly selected local GPU renderer runs the thirteen matching native
cases and writes `native-*.png` and `native-reference.json` when
`TWYNE_SOURCE_CAPTURE_DIR` is set. It uses the real Linux text system, not a
mocked text renderer, and verifies exact source bytes, empty presentation
history, measured row height, visible source geometry, and native background
pixels. Browser fixture screenshots are DPR 1; the GPUI headless renderer is
DPR 2. Screenshot glyph raster differences are not a claim of pixel identity.
All thirteen native GPU cases pass, including a single-frame scroll capture;
the 640px paragraph's complete wrap-row strings match the executed browser.

`probe-source-cjk-web.ts` executes original Source markup in a fresh zero-network
Chrome154 and records actual platform faces, regular/heading/comment geometry
and unchanged source/history. The real app's read-only font evidence is saved
in `font-evidence/actual-app-source-fonts.json`; its current authored/comment
rows select NotoSansMono-Regular. The standalone original heading selects
NotoSansMono-SemiBold600. Native selected-face/glyph-ID/advance proof and actual
editor screenshots/caret measurements are saved alongside this browser proof.
The native GPU test retains nonempty read-only comment selection and empty
undo/redo; a separate byte0 capture matches the browser's initial caret.

The explicit original Droid fallback covers CJK/kana. This fixture's original
Hangul selects platform NotoSansCJKjp-Thin, and its emoji selects NotoColorEmoji;
those platform dependencies remain explicit. The native oblique matches the
quarter-shear mechanism documented in current Chromium `CreateSkFont`, but
native Swash hinting/AA versus Chromium synthetic raster is not asserted
pixel-identical. This is separate from unchanged caret/advance geometry.

```sh
rtk proxy python3 desktop/gpui/tools/sync-source-fonts.py --check
rtk proxy bun desktop/gpui/fixtures/source_view/probe-source-cjk-web.ts
```

```sh
rtk proxy env \
  VK_DRIVER_FILES=/nix/store/gqpsfqzgbcbwbh12n3sjxk2x4gqgy8lq-mesa-26.1.3/share/vulkan/icd.d/lvp_icd.x86_64.json \
  WGPU_BACKEND=vulkan XDG_RUNTIME_DIR=/tmp/twyne-paper-grain-native-runtime \
  TWYNE_SOURCE_CAPTURE_DIR=/tmp/twyne-native-source-fixtures \
  CC=/usr/bin/clang CXX=/usr/bin/clang++ \
  LIBRARY_PATH=/nix/store/1jlp4w0mjyyf2byglz9q6vnmnprl4xgn-libxkbcommon-1.4.1/lib \
  RUSTFLAGS='-C linker=/usr/bin/clang' CARGO_BUILD_JOBS=4 \
  cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml \
  --lib --features ui-tests \
  source_view::tests::actual_native_gpu_source_fixture_retains_canonical_bytes_and_geometry \
  -- --ignored --exact --nocapture
```

The wrapped helper is now a separate optional display-map presentation. At
320px its sliced label reserves 42.875px; at 160px its exact marker and label
reserve 85.75px. Nine mounted tests verify the actual bounds notification,
source/caret/IME/history invariance, both enabled read-only fragment clicks,
replacement and no-wrap cleanup. The optional marker-only source breaks are
derived from the verified original marker and use real UTF-8 ranges; no filler
characters or empty inline tokens enter the manuscript. Source-only
Ctrl+Shift+Z and native Ctrl+Y both invoke actual Redo, matching installed
CodeMirror. The contract, upstream modified files and bounds are recorded in
`wrapped-helper-proposal.md`; fresh GPU evidence is in `native-wrapped/`.

Ordinary and unfolded Source now opt into the bounded
`EditorSoftWrapPolicy::CssAsciiBreakSpaces` presentation policy. All 126
printable-ASCII cases from executed original CodeMirror match actual GPU
source rows across six widths, including hyphens, numeric/minus context,
opening punctuation, preserved spaces, leading indentation and emergency
cuts. Thirteen mounted gates plus three GPU gates pass; edits, selection,
caret/IME, real Linux redo and folded-helper rows remain intact. The new
wrapper caches actual per-character advances and only rewraps changed rows.
The API, provenance, reproducible commands and before/after evidence are in
`hyphen-wrap/README.md`; fresh existing GPU fixtures are in
`native-after-ascii/`.

**Pending fidelity:** rows containing Unicode, controls, tabs or inline
metrics retain the upstream wrapper. The executed comparison records 21
remaining Unicode/CJK/tab differences; the ASCII correction does not establish
general Source wrapping parity. Chromium synthetic-italic raster, native
antialiasing, and platform Hangul/emoji faces remain separate from the verified
caret/advance geometry. Earlier quirks-mode 40.578125/80.15625 helper
measurements are archived in `legacy-quirks/`; the original standards-mode app
uses 42.875/85.75.

## File disclosure and page-selector evidence

The actual original File span requests DM Sans 600 at 12px. Its `File` text
selects DM Sans, while U+25BE selects Noto Sans Math Regular 3.000. The native
automatic fallback gave the arrow a 7.2px advance; the exact original Math
glyph gives 5.544px versus the browser's 5.546875px. The original unmodified
font, official OFL notice, SHA-pinned copier and glyph proof are packaged.
`theme::file_disclosure_font()` is restricted to that existing arrow span;
shared Sans and Typst selection stay unchanged.

The browser's requested 600 fallback also synthesizes bold. The zero-network
Chrome 154 probe with the original DM response found 21 changed physical
pixels between the default and `font-synthesis:none` fallback samples; their
summed normalized gray difference is 3.91372549. An explicit Math 400 versus
600 sample does not synthesize that fallback weight. Native keeps the original
Regular glyph and advance; this tiny-glyph raster gap remains pending. See
`font-evidence/file-arrow-synthesis/` and `file-arrow-native-shaping.json`.

The original `Go to page` select uses DM Sans 400 at 11px, no CSS padding or
border, `appearance:auto`, height 28px and maximum width 128px (96px narrow).
Temporary exact-style clones show a 20px UA reserve: disabled `Pages` is 51px
with the UA arrow and 31px with `appearance:none`; `Page 1 of 1` gives 71px
and 51px respectively. The original optical-size face shapes `Pages` at
30.019px natively versus 30.03125px in the browser. This supports intrinsic
sizing from the ceiling of the widest actual option plus the UA reserve.
All temporary probes were removed without changing the original page.

The paired disabled-control screenshots isolate an open V arrow: path
`M39 12 L43 16 L47 12` within the 51×28 control, 2px stroke, butt caps and
antialiasing. Its physical painted bounds are x38/y11/w10/h7; fully covered
pixels use the select's CSS `ink_light` color, rgb(74,63,51). In the last
20px slot, the same path is `M8 12 L12 16 L16 12`. This matches the exact
Chrome 154.0.8037.57 implementation of
[NativeThemeBase::PaintMenuList](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.57/ui/native_theme/native_theme_base.cc)
and
[ThemePainterDefault::SetupMenuListArrow](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.57/third_party/blink/renderer/core/paint/theme_painter_default.cc).
The fixture records geometry and source attribution; a native arrow adapter
is separate from the completed font handoff. See `font-evidence/footer-*`
and `twyne-pages-painted-{auto,none}.png`.

```sh
rtk proxy python3 desktop/gpui/tools/sync-file-arrow-font.py --check
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
```
