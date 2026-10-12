# Native Write KaTeX adoption review

This is a read-only integration audit. No editor, renderer, Source, helper, manifest or host files were changed, and no build, browser, provider or network operation was run. The proposed APIs below are not implemented. Existing native and browser receipts establish their own stated scopes; they do not establish assembled native Write parity.

## Current boundary

The rich document already preserves inline/block math as `NodeKind::Math(MathDisplay)` atoms. Each atom occupies one native scalar and one UTF-16 unit; its raw LaTeX and HTML metadata are separate from that editing projection. `InlineObject::Math` and `BlockObject::Math` create portable `data-type`, `data-latex`, `data-math-display`, `aria-label` and raw text payloads. A renderer swap must retain these atoms and scalar mappings rather than insert formula text, KaTeX DOM or generated SVG into the document.

Native Write currently requests `AtomKind::LatexMath` from `InlineProofRenderer`. Its default backend calls the semantic helper's **MathJax Proof** renderer and labels its output `WebMathJaxProof`. `MathWriteRenderer` is exported but is not consumed by the editor. Typst and Mermaid use their existing separate paths; Proof/PDF must retain their current semantics.

`math_write.rs` provides an explicit packaged-helper/backend interface, exact raw-source request keys, owner/request/generation matching, bounded off-thread execution and validated vector geometry. Its `CurrentSource` profile refuses successful rendering. Its accepted `EngineMatchedDiagnostic` vectors are diagnostics, and `diagnostic_image()` deliberately cannot convert a refused production response into an image.

The concurrent current-CSS lane owns `tools/math-write.ts`, `src/math_write.rs` and new current-CSS fixtures. Its handoff confirms that Source/CSS/editor files remain unchanged; a proposed additive current-CSS diagnostic is not product certification. Do not make adoption depend on that lane's unfinished implementation or promote a diagnostic profile to ordinary Write automatically.

## Concrete gaps

| Boundary | Current native behavior | Required Source behavior / consequence |
| --- | --- | --- |
| Engine and CSS | MathJax Proof renders Write formulas. KaTeX's production profile refuses. | The active Source MathExtensions use KaTeX 0.18.1 with supplied 0.16.47 CSS. That mismatch materially changes scripts, struts and inline boxes. Choosing the engine-matched diagnostic would intentionally change the baseline. |
| Geometry | `AtomRenderImage` has one width/height/baseline. A `Piece` advances by that image width and paints the image at the same origin. | KaTeX vectors distinguish natural advance/ascent/descent from the signed paint frame. Use the chosen renderer profile's approved inline-flow geometry; engine metrics alone do not prove current-CSS line boxes. |
| Font/color inheritance | Math requests use paragraph `base_size` and palette ink after object fallback switches to 13px mono. Effective inline font-size/color marks are not supplied. | Source math inherits its surrounding font size and current color. Obtain that effective style before fallback styling; saved formulas and the 15.2px live preview have different contexts. |
| Import fallback | `shape_block` reads `data-latex` and otherwise displays `◊`; it does not use the preserved math text payload. | Source `parseSource` uses `data-latex ?? textContent`. Missing-attribute imports must project the original raw text without rewriting the document merely to render it. |
| Pending/error UI | Pending formulas show raw source; failures show one mono `source — message` token with a fill. Empty requests use the generic atom error. | Source initially shows `Rendering equation…` or `Empty equation`; its completed invalid/empty state is `Invalid LaTeX` plus raw source/`empty source`, with the actual parser detail in the title. Adapter/profile/transport refusal is not invalid authored LaTeX. |
| Wrapping/overflow | Object fallback is an indivisible token. Block wrapper has the Source margins/padding/centering but no horizontal scroll adapter. | Source error code uses `overflow-wrap:anywhere`. Block math uses `overflow-x:auto`; formulas retain their natural scale. Inline `max-width:100%`/inline-flex behavior needs an actual long-formula row test, not guessed shrinking. |
| Activation | Math pieces have generic caret mouse handling and no math-specific focus/control. Enter dispatches paragraph splitting. | Actual NodeViews are Tab stops; click selects the atom and opens its source editor when editable. Enter/F2 activate. Read-only permits selection but does not open editing. Space is not a math activation binding in this Source. |
| Selected atom | Generic text-range selection paint applies. | Source supplies a 2px current-color outline with 2px offset around the selected math node; it is a node selection, not an enlarged text range. |
| Editing | Only generic `SetAttributes` exists for a source update; it has no expected-node guard and leaves the old text payload. Insert command IDs are not wired to math in the native `Command::from_id` catalogue. | Source updates the current math node through a real transaction, preserves attrs, saves final unblurred raw input, and emits no preview changes into the document. Both empty insert intents need their original catalogue IDs. |
| Async/cache | The view drops the renderer result's source/generation envelope, qualifies completion by a global document-install generation, and stores every error in `atom_ready`. `set_atom_renderer` does not cancel/qualify an already running old renderer. Every completed atom batch invalidates all object-containing paragraph layouts through one revision. | Retain exact tickets, renderer-install generation and current node/style/width/profile guards. Do not let obsolete renderer results replace a newly installed renderer or freeze retryable errors forever. Bound retained images/jobs independently of the renderer's vector cache; preserve unrelated paragraph layout Arcs. |

The present atom generation changes on document replacement, not each ordinary edit. A removed/changed formula's old keyed result therefore need not paint into a different source key, but can still occupy the unbounded view result map and trigger global object-paragraph invalidation. The renderer setter race and error retention are concrete integration concerns; this audit is not claiming that all existing atom completions are already source-corrupting.

## Smallest coherent contract

Use a new `editor/view_math.rs` child module for math-specific descriptors, render tickets, source-form state and dispatch. Keep `InlineProofRenderer` unchanged for Mermaid/Typst and retain its explicit MathJax identity for Proof. Do not erase fidelity metadata through conversion to `AtomRenderImage`.

Proposed descriptor and host installation seam:

```rust
// Proposed only; node/path/range are qualified by the owning view at use time.
pub struct MathReference {
    pub path: NodePath,
    pub expected: Node,
    pub range: Range<usize>, // one scalar, native editing offsets
    pub display: MathDisplay,
    pub source: Arc<str>,
}

pub fn set_math_write_renderer(
    &mut self,
    renderer: MathWriteRenderer,
    profile: MathWriteProfile,
    cx: &mut Context<Self>,
);
```

Installation invalidates the prior renderer generation and outstanding jobs; it does not mutate source, selection or history. Root supplies an absolute packaged helper path using the existing renderer constructor. No PATH discovery, extra browser process, new parser copy or new dependency is needed for this boundary. Diagnostic installation must be explicit and visibly described as diagnostic; ordinary Write cannot silently use it while `CurrentSource` remains refused.

Keep a retained per-atom job ticket containing owner UUID, request UUID, renderer-install generation, native expected node/path, exact raw source, display, effective style, available width, profile and atom generation. Use `MathWriteResult::matches` and revalidate the target before adoption. A view-level revision can reject a prepared source edit, while a pure cached render may be reused after unrelated edits only when that exact atom/context still matches. Queue a bounded set of measured visible atoms with explicit concurrency/cache/image limits. Keep deterministic refusals distinct from busy/transport failures and permit a bounded explicit retry; a retry is not a document edit.

Introduce one small internal atom-visual abstraction, for example `PlacedAtom::{Proof(AtomRenderImage), Math(ResolvedMathVisual)}`, rather than changing the public Proof renderer contract. A resolved math visual needs:

```text
raw source + profile/fidelity/refusal
natural inline advance, ascent and descent
SVG paint width/height + signed x/y offset from natural top
actual image, parser error, bounded unsupported/adapter issue
```

`Piece::width`, line-height calculation, line baseline placement and image prepaint consume the same natural geometry; painting applies only the declared signed frame offset. Cached paragraph/frame layout remains the single source for caret, IME bounds, selection, comment/note anchors, drag targets and pagination. Preserve the currently retained fractional coordinates. Geometry adoption invalidates only paragraphs containing changed visuals and the necessary dependent flow frame; it emits no fake text/history/Flow input sample. A block formula remains an opaque atomic block for pagination and drag, with a measured local horizontal scroller. No paragraph splitting or formula scaling should be invented to fit the sheet.

For source editing add the narrow typed command:

```rust
Command::UpdateMathSource {
    path: NodePath,
    expected: Node,
    source: String,
}
```

It refuses read-only/stale/non-math targets, updates the raw canonical source payload consistently, preserves unknown attrs and enclosing marks, and records one undoable commit. Root's existing canonical validation bounds still apply before live adoption. Rendering and preview never replace authored Typst from cached HTML. Avoid using generic `SetAttributes` as the final editing API.

Keep source-form drafts entity-local. Source renders the form **in place of** the saved formula, so an outer popup alone is not the same flow/layout behavior. The form must contribute its measured geometry through the same block/paragraph plan while keeping the underlying atom one scalar. Inline form: two source rows; block form: three. Preview uses the same selected render profile and its own 300ms debounce/token; it does not commit. Submit reads the current textarea rope after queued events, preserves raw whitespace/newlines and then validates the current descriptor. Inline Enter saves, block Enter inserts a newline, Ctrl/Cmd-Enter saves either, Shift-Enter inserts a newline, and Escape/Cancel restore the atom focus/selection without changing source/history. Node update, deletion, view replacement, hidden Write and destruction cancel the draft/preview. Do not auto-save an unsubmitted form at ordinary manuscript save: Source commits only Render/keyboard submit.

Activation needs real native focus/dispatch/a11y controls around measured atom boxes, not a painted-only click handler. The control owns tooltip/ARIA-equivalent labels, Enter/F2, selected outline and stop-event handling for its source form. Read-only selection remains history-neutral. Closed/canceled editors must return focus to the current atom, or to the editor if the atom vanished. None of these paths needs a whole-document scan per pointer event or keystroke.

## Ownership for a subsequent approved implementation

| Lane | Exclusive files / integration boundary |
| --- | --- |
| KaTeX foundation/current CSS | Existing owner retains `src/math_write.rs`, `tools/math-write.ts`, current-CSS and renderer fixtures. Decide validated response/profile geometry and refuse unsupported structures honestly. Source CSS changes, if ever chosen, require separate authorization and preserved Mermaid baseline. |
| Native math editor | New `src/editor/view_math.rs`, owned math tests/fixtures; narrowly approved `view.rs` declaration/state/Piece geometry/prepaint/dispatch, `command.rs` + `transaction.rs` typed update, and `paragraph_flow.rs` only if the common line geometry requires it. Existing note/comment/drag/clipboard/runtime work remains intact. |
| Root host | App renderer installation, packaged absolute helper location, real viewport/scroller and hidden/replaced-view cancellation; original insert catalogue intents and canonical preflight. Root keeps app/lib/manifests/page furniture. |
| Assets/packaging | Existing original KaTeX fonts/helper artifact packaging and cross-platform clean-install proof; no substitution of system math fonts or changes to Typst's font order. |

The KaTeX response/profile contract must be frozen before the native lane consumes it. First native geometry integration should use explicit injected diagnostic visuals in isolated mounted fixtures while production continues to refuse uncertified Source geometry. Production adoption is a separate accepted profile/baseline decision, not a boolean renderer switch.

## Required bounded acceptance

1. Reuse the actual imported NodeView/source-form corpus and original-font receipts at both widths. Compare inline ordinary/fraction/scripts/radical, block matrix, empty and invalid cases. Keep current-CSS and engine-matched diagnostics separately labeled; no duplicated Source renderer or hand-authored expected geometry.
2. Mount real native mixed prose/formulas at both widths and a wrap threshold. Measure natural advance, paint overhang, surrounding baseline/rows, final extent, caret/selection/IME bounds and Source wrapper scroll. Rendered SVG correctness alone does not prove those boxes.
3. Exercise click/Tab/Enter/F2, read-only selection/refusal, selected outline, source-field IME, exact unblurred submit including final newline, Cancel/Escape, preview races, Undo/Redo and lost-node focus. Copy/paste must retain the raw atom and metadata without form/render DOM.
4. Use a held renderer to prove old owner/node/source/style/width/profile/installation completions are neutral after edit/resize/replacement. Busy/transport failures remain retryable; no perpetual notify cycle or unbounded pending/result/image map. Untouched text and unrelated object paragraphs retain cached layout identity.
5. Keep Source/HTML/Typst roundtrip and unknown attrs/marks exact; preview/cancel/render completion are history-neutral, one accepted source edit undoes exactly, and rejected canonical preflight preserves document/selection/history.

These are future gates. None was run in this audit, and this report does not claim current Write KaTeX, native raster/baseline, source-form, all-formula, other-platform or Proof parity.

## Evidence pointers

- `src/components/editor/extensions/math.ts`: portable source parser/HTML, active atom NodeView, selected source update, click/Enter/F2 and destruction guards.
- `src/components/editor/math/math-renderer.ts`: raw-vs-trimmed input and actual strict/trust/error KaTeX options.
- `src/components/editor/math/math-source-editor.ts`: in-node form, 300ms preview, final input value, submit/cancel/keyboard and stale-node guards.
- `src/components/editor/math/math.css`: inherited style, inline-flex, block wrapper/scroll, error wrapping and selected outline.
- `src/components/editor/twyne-editor.tsx:892` / `:3506` and `src/utils/editor-commands.ts:345`: active registration and original insert intents.
- `desktop/gpui/src/editor/{model,command,transaction}.rs`: preserved math atoms, portable insertion and existing guarded Note precedent.
- `desktop/gpui/src/editor/view.rs:1090`, `:1312`, `:2097`, `:2498`, `:3110`, `:3470`: cache, jobs, image prepaint, block wrapper, current MathJax request and line baseline placement.
- `desktop/gpui/src/editor/paragraph_flow.rs:316` / `:520`: line-height and indivisible object placement; existing shared flow/pagination adapters retain those measured layouts.
- `desktop/gpui/src/inline_proof.rs:244` / `:360` / `:460`: explicit renderer/backend identity and existing one-box SVG geometry. Math is not shrunk to width here; only Mermaid is scaled.
- `desktop/gpui/src/math_write.rs`: exact request/result guards, bounds, profiles, natural/paint vector geometry and diagnostic-only image conversion.
- `desktop/gpui/fixtures/math-write/nodeview/README.md`, `measurements.json`, `original-interactions.json`: retained actual Source NodeView/form/font/geometry/action receipts, with stated scope.
- `desktop/gpui/fixtures/math-write/source-css-assessment.md`, `CONTRACT.md` and concurrent `current-css/browser-glyphs.json`: current mismatch and diagnostic/production distinction. The current-CSS lane's owner handoff is relied on; its implementation was not repeatedly audited.
