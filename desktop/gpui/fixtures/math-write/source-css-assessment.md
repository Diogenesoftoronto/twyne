# Read-only Source stylesheet correction assessment

## Superseding consumer-specific review

The global replacement recommendation below is historical. Actual browser checks
found that replacing the global KaTeX0.16 rules changes legacy Mermaid geometry.
The reviewed candidate instead preserves the original stylesheet and font faces,
then scopes only the installed0.18 non-font rules to `.twyne-math` and
`.twyne-math-source-preview`. Four actual Mermaid cases retained identical SVG
and PNG output under that candidate. See
[the scoped candidate review](mermaid/README.md) and
[the unapplied Source patch](mermaid/source-css-candidate.patch).

The Source stylesheet is still unchanged. The helper now qualifies CSS versions
per consumer, so a matching global marker cannot certify either math equations
or previews. The real original NodeView review is in [nodeview/](nodeview/);
those browser checks do not establish assembled native Write parity.

No Source file, manifest, lock, existing runtime or baseline was changed by this assessment. The original and diagnostic observations remain separately named.

## Ownership and current state

The minimal correction candidate is **only** `src/components/editor/math/katex.min.css`. It is tracked and clean. `math-renderer.ts`, `math.css`, `math-source-editor.ts` and all 60 tracked math font files are also clean. The parent retains Source ownership; this worker owns only the new native math foundation/fixtures. `package.json` and `bun.lock` are already dirty from broader work and must be preserved rather than rewritten to make this correction.

The direct manifest requests `katex: ^0.18.1`, lock/install resolve 0.18.1, and the actually served original build imports the 0.18.1 KaTeX peer. The current published stylesheet still includes supplied CSS 0.16.47. This is confirmed in the real owned browser fixture, not inferred only from source class names: fraction child 21.78 px vs matching-rule diagnostic 15.246 px; strut inline vs matching-rule diagnostic inline-block. The current Source and diagnostic PNG/JSON are both retained.

## Minimal proposed Source patch

Replace the contents of the supplied vendor stylesheet with the **direct installed peer's** `node_modules/katex/dist/katex.min.css` (0.18.1, SHA-256 `0fb711c9c74cb1718661933948b653fbc09a627da5dde8926b4d10585370993e`). This is a one-file, two-line/minified-data replacement; it changes supplied vendor class selectors/rules rather than authored equation data or the original rendering options.

The current CSS is 27,211 bytes; the installed replacement is 24,727 bytes. All 60 `url(fonts/...)` references are identical, in identical order, with no other URLs. `font-provenance.json` records that **all 60 original TTF/WOFF/WOFF2 files are byte-identical to the installed 0.18.1 peer**. No font copy, package upgrade, lock rewrite, raster asset remake or MathJax Proof/PDF change is needed for this minimal correction. The original wrapper CSS and trust/strict/error behavior remain intact.

The lock also contains Mermaid's separate KaTeX 0.16.47 peer. That peer must not be mistaken for the direct math renderer's package when selecting the replacement. Vendor KaTeX selectors are global, so Mermaid formulas/foreign-object labels are a required regression check before calling the one-file replacement safe for all consumers; this assessment has not demonstrated a Mermaid regression or proved its independent CSS isolation. If such a regression exists, scope 0.18 rules to the actual Twyne math wrapper while retaining the other consumer's authority rather than silently changing Mermaid's engine. A global engine upgrade is outside the minimal proposal.

The caret package range can drift on a future dependency update while a retained vendor stylesheet does not. A source-backed version/CSS/font-URI compatibility guard in the math test workflow would prevent recurrence; pinning/changing the already-dirty manifest is a separate parent decision.

## Proof required after the parent's correction

1. Preserve these original-CSS observations and hashes. Build the original web app locally with the one-file correction and serve its freshly generated assets. Capture a newly named current-Source baseline; verify the served module/version, actual served CSS rules/hash and Chrome's chosen custom faces. The present diagnostic was an added 0.18 rule overlay on the old stylesheet, not a fresh-build replacement, so it cannot silently become the corrected Source baseline.
2. Repeat the executable corpus through the actual `renderLatex` wrapper and the original editor NodeView/source-preview surfaces with controlled parent font size/line-height/width. Confirm HTML/error/raw-source identity, fraction scaling, nested vlist baselines, radicals/delimiters, matrices, glyph families, overline, color and trust guards. Retain the explicit unsupported native cases instead of counting them as passes.
3. Re-measure corrected actual Source natural advances and strut metrics. The current diagnostic/native data supplies starting bounds (max 0.148692 px natural-width gap; ascent <0.025 px/depth <0.002 px), not a substitute baseline. Keep natural advance/baseline and actual outline-overflow paint frame separate.
4. Publish native vectors on the real GPUI Write surface only behind the full owner/token/source/display/style/width/revision guard. Compare same-viewport actual Source/GPUI ink, inline-flex/paragraph baselines, block margins/padding/centering/horizontal overflow and font/raster behavior. Native resvg outline replay proves a real self-contained vector backend, not assembled GPUI GPU/pixel equality. Long-formula wrapping, fallback/overlap/tag/arrow refusal and any Mermaid interaction must stay visible in the acceptance record.
5. Exercise selection/caret, source-editing save/cancel, final unblurred character, stale completion after editing/scope/theme/resize, and independent Undo/Redo on the unchanged authored math atom. Rerun existing MathJax Proof/PDF and canonical/source round-trip checks.

The new helper deliberately does not auto-promote CurrentSource after a version match: it changes from `CurrentSourceCssMismatch` to `CurrentSourceUnverified` until the separate native acceptance is implemented. An actual Source CSS repair resolves the reference defect; it does not by itself establish full Write look/feel parity.
