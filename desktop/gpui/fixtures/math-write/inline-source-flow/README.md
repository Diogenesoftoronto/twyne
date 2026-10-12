# Inline math source form: frozen integration candidate

Root reviewed and applied the frozen integration patch, repaired the reservation comparison and actual GPUI element namespace, and ran all six mounted tests: **6 passed, 0 failed**. [parent-gates.json](parent-gates.json) pins the tested files and log. The original worker proposal and freeze receipt remain unchanged. Source files remain untouched.

## Integration contract

- `src/editor/math_source_flow.rs` is a private child of `editor::view`, registered by the patch. It uses the already integrated `math_source_form()` and `math_source_presentation()` host getters; these qualify the retained form by the current host session. It does not choose a preview renderer or implement canonical preflight.
- Render first synchronizes the host target/read-only state, then calls `prepare_inline_math_form(window, cx)` before pagination, fractional paragraph measurement, or any measured callback. This creates and measures the actual retained form `AnyElement` using `layout_as_root`. The same child is subsequently prepainted and painted once at the containing Piece's shared origin. There is no floating overlay or width inferred from equation text.
- `InlineMathReservation` keys the form entity/UUID/generation, captured editor/folio/visit owner, revision, path, scalar position, persistent expected-node identity, measured size, and native baseline. A unchanged measurement reuses its Arc. Only the containing block receives `BlockFormReservation`; its cached layout and the pagination frame include this presentation key. Ordinary paragraphs skip the new baseline aggregation path.
- The saved inline math renderer/fallback is hidden only for that qualified atom. Its source, raw node, marks, neighboring text, and one-scalar range remain unchanged. The form's textarea remains an independent native input subtree; field text never enters the rich-document projection before accepted submission.
- A row with a form uses one font-derived above/below-baseline plan. Painting, normal caret height, selection/IME boxes, comment/note geometry, and the real child consume that plan. Normal text carets retain their intrinsic text height rather than the entire tall form height.
- `RichEditorView::inline_math_form_bounds(&self) -> Option<Bounds<Pixels>>` exposes cached logical surface bounds after fresh prepaint for explicit host scrolling. It neither scans source nor changes selection. Native child outer edges can snap to device pixels; the test compares them with `window.pixel_snap_bounds(logical_bounds)`.
- Preserve the registered host's `math_buttons`, lifecycle/ACK/preflight guards, and `!TwyneMathAnchor` / `!TwyneMathSourceForm` key exclusions. The patch adds a separate `BlockPrepaint.inline_math_form` and does not rewrite host actions. `MathSourceHostContext.inline_form_in_flow` remains false until Parent reviews/applies the patch and passes its gates. No app patch is supplied.

The patch targets only `view.rs`, `paragraph_flow.rs`, `view_comments.rs`, `view_notes.rs`, and `view_pagination.rs`. `freeze-receipt.json` records their inspected base and proposed hashes, Source inputs, and the owned artifacts. A clean patch-application check is a static context check, not a Rust or GPUI acceptance result.

## Source and pinned native evidence

The actual Source NodeView in `src/components/editor/extensions/math.ts:94-115` hides its existing renderer, creates the source editor, appends it inside the same inline node, and focuses its textarea. Closing removes the form and unhides the renderer. The Source contract is a replaced presentation of one existing atom, not inserted manuscript text.

`src/components/editor/math/math.css:8-13` makes the outer inline math node `inline-flex`, `max-width:100%`, `align-items:baseline`, and `vertical-align:baseline`. Lines 61-86 define the form's column layout, 8px gap, 10.4px padding, 1px border, inline minimum `min(352px,70vw)`, and a 12.8px/600 label. These pixel equivalents assume the current 16px root size. The child's `vertical-align:middle` rule does not itself establish the outer flex container's first baseline.

Pinned public `gpui-pre 0.3.7` `AnyElement::layout_as_root` and `prepaint_at` permit retaining a real measured child. GPUI takes its layout engine while measured callbacks execute, so child layout is performed before those callbacks, not recursively inside them. The pinned `ShapedLine::paint` text baseline is `(line_height - ascent - descent)/2 + ascent`; relative native text line height rounds to pixels.

## Explicit proof limits

The following APIs have now compiled and the six mounted gates passed. The original worker identified the private `Piece`/`StyledPiece` additions, the new paragraph-flow/`finish_line` arguments, cached-frame equality, Context-to-App coercions, actual `AnyElement` lifecycle/dispatch/a11y registration, test subscription/next-frame scheduling, and child input-handler priority as execution risks; Root repaired the actual element-identity failure caught by these gates. No provider, browser, or native display proof follows from the mounted tests.

There is no public measured flex first-baseline getter in the inspected GPUI version. This candidate derives a **native** first-label baseline from the actual presentation font, shaped label ascent/descent, rounded inherited line height, and logical 11.4px border-plus-padding. It is not a measured Source browser baseline, and actual control edge snapping can differ. Parent must compare an open original NodeView's baseline, line boxes, and neighboring glyph origins before claiming Source flow parity; existing closed-NodeView paragraph measurements do not establish this.

The registered native form currently fixes its inline width to the Source viewport minimum. Source CSS specifies a minimum plus outer maximum rather than that exact native fixed-width behavior. Intrinsic growth, very narrow containers, native control snapping, manual textarea vertical resize, label weight/style matching, and mixed comment/note/form rows need separate proof or repair. Invalid/nonfinite measured geometry refuses the reservation; it does not manufacture a usable box. The host's optional pagination is a separate engine slice; these fixtures do not certify the currently registered Source route's pagination.

No CurrentSourceCssDiagnostic, engine diagnostic SVG, or MathJax image is adopted as Source Write/preview geometry. Existing KaTeX renderer/paint-frame differences remain outside this lane. The mounted child integration is accepted; actual native input and original-browser baseline checks remain separate gates.

## Parent acceptance filters

After applying the patch, run the focused library filter `editor::view::math_source_flow::tests` with `ui-tests` (six authored checks):

1. Real measured child, one source scalar, exact persistent node/source, unchanged neighboring paragraph Arc, native child box and focus.
2. Viewport resize, surrounding prose reflow, shared source-offset caret/hit/UTF16 IME geometry, text-height carets.
3. Retained field typing without paragraph cache churn; actual missing-preflight error-height reflow; stable idle frames and unrelated Arc identity.
4. Escape cancellation preserving source/selection/history, then real Unicode neighbor editing and Undo.
5. Replaced owner retiring pending raw input without filing or changing history.
6. Optional paginated frame invalidation on measured form-height change, stable unchanged frame/event counts, preserved unrelated layout Arc/source.

Keep the existing `discretionary_hyphens_keep_native_click_clipboard_ime_and_cached_blocks_in_source_offsets` cache-identity regression in the integration gate. Parent can reuse its already passing host/form suites rather than treating these unrun tests as additional proof. Actual native pointer/keyboard input, scroll reveal, drag/comment overlays, child clipping at page boundaries, and original-browser baseline comparisons remain required where the integration affects them.
