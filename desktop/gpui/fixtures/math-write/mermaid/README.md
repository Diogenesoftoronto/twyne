# Mermaid / KaTeX stylesheet decision receipt

**Recommendation: preserve global KaTeX 0.16.47 for Mermaid and append KaTeX 0.18.1's non-font rules scoped to Twyne equations and their source preview. A global replacement is unsafe for supported authored legacy labels. No Source change was applied.**

The smallest ownership change is one existing Source file, `src/components/editor/math/katex.min.css`: retain its current content, including the 20 font faces, then append the installed 0.18.1 non-font rules prefixed with `:is(.twyne-math,.twyne-math-source-preview)`. `scoped-vendor-candidate.css` and `source-css-candidate.patch` are concrete review artifacts. `git apply --check` passes. They need no package/lock/font changes. The second scope is necessary because `math-source-editor.ts` puts renderer HTML in `.twyne-math-source-preview-output` beneath `.twyne-math-source-preview`, without a `.twyne-math` ancestor. This actual preview DOM was inspected in Source; the proposal's added preview selector has not been measured in a newly built real editor.

## Actual renderer and fixture boundary

This separate task-owned localhost page imported the **unmodified published original** `renderTwyneMermaid` and `initializeTwyneMermaid` modules, the actual Mermaid core, and both actual KaTeX peers. It also exercised the original editor's `initialize()+run({nodes})` path. Current versions are Mermaid **11.15.0**, its KaTeX **0.16.47**, and direct equation KaTeX **0.18.1**. The Source wrapper's exact original theme/configuration is preserved. Corpus strings, SVGs, CSS, module hashes, computed styles, exact CDP boxes, chosen glyph font evidence, and PNGs are retained here.

`prepare.ts` uses CSS ASTs to identify the contiguous 0.16.47 vendor block in the actual published stylesheet. The `replacement` profile **removes** that block and inserts the exact installed 0.18.1 rules with the same already-served font URLs. It is not an overlay. Original nonvendor/wrapper styles remain intact. The measured `scoped` profile retains the original stylesheet and appends 0.18.1 non-font rules scoped to `.twyne-math` only. The concrete Source proposal additionally includes the required preview scope.

All requests are restricted to localhost. No provider/auth/Convex/public-font request, Source file edit, app navigation, app metadata mutation, Cargo/Devenv entry, or dependency installation occurred. The original session-4 app tab remains `http://localhost:5180/dossier/create/` at 1280×860. Only the separate fixture tab was closed; remaining tabs and restoration are recorded in `restoration.json`.

## Measured result

Source defaults `legacyMathML=false` and `forceLegacyMathML=false`. This actual Chrome has `MathMLElement`; its default Mermaid math output is **MathML only**. Supported authored frontmatter `config: {forceLegacyMathML:true}` exercises the **HTML+MathML** path using the old peer's `.base`/`.strut`/`.sizing` classes.

| Case | Original global 0.16.47 SVG viewBox | True global 0.18.1 replacement | Retain 0.16.47 + scoped 0.18.1 |
| --- | --- | --- | --- |
| Default flow, six formulas + plain node | `0 0 514.859375 301.0625` | Exact same SVG and PNG bytes | Exact same SVG and PNG bytes |
| Default sequence, three formulas | `-50 -10 450 310` | Exact same SVG and PNG bytes | Exact same SVG and PNG bytes |
| Authored legacy flow | `0 0 553.0859375 380.0625` | `0 0 558.8984375 392.484375`; SVG and PNG differ | Exact same SVG and PNG bytes |
| Authored legacy sequence | `-50 -10 450 407` | `-50 -10 450 422`; SVG and PNG differ | Exact same SVG and PNG bytes |

Under global replacement, legacy `.base` changes from `inline-block` to `inline`, as do old struts; the actual legacy label and diagram geometry change. This is a real supported-input regression, not merely a class-name argument. The default editor `run()` path remains MathML-only with identical viewBox under replacement/scoping.

The direct 0.18.1 equation in `.twyne-math` changes from broken `.katex-strut {display:inline}` and sizing **21.78 px** to `inline-block` and **15.246 px** with both replacement and scoped rules. Its authored LaTeX and exact engine HTML remain unchanged.

## Embedded SVG versus global rules

Returned SVGs embed Mermaid's diagram/theme styles. They **do not** embed KaTeX `@font-face`, `.katex-html`, `.base`, or `.vlist` layout rules. Flow output contains only the limited `.node .katex path {fill:#000;stroke:#000;stroke-width:1px}` rule. Inline SVG foreignObject labels therefore inherit global KaTeX rules; the legacy regression proves this dependency.

Each screenshot places the **same returned SVG** in a data-URL `<img>` on the right. The image's internal document does not inherit the page's global KaTeX CSS/font faces. Existing legacy images show duplicate MathML/HTML text and damaged layout even with original CSS, and default images also have existing clipping/metric differences. Those are pre-existing image-isolation limitations, **not** fixed or introduced by the proposed scoped Source change. Image decode success does not establish valid math-label rendering. These fixtures do not establish Typst/MathJax Proof/PDF or native Mermaid image fidelity.

## Font timing and limits

`first-load/` retains initial captures. Mermaid measures labels before late font loads settle, so first-load legacy flow widths vary between fixture openings even when scopes cannot affect that DOM. They are not used to attribute the CSS regression.

Final captures settle the already-supplied local KaTeX faces before calling the original renderer. All corpus-relevant Main400/MathItalic400/Size1/Size2/Size3 faces load; actual Chrome selects custom `KaTeX_Math-Italic` for the measured glyph. All three profiles have identical successful/failed font-load status. Ten unneeded bold/italic/script/Size4 supplied faces fail loading in this served fixture; their exact failures are retained instead of claiming all 20 browser faces were delivered. No substitute font was injected. These runs isolate the measured CSS effect on one actual Chrome/Linux surface, not a cold-load, full editor, Lora delivery, other OS/browser, or whole-diagram feature parity claim.

The matrix source contains the raw escaping required by Mermaid's label parser. Existing Source matrices/radicals and isolated images are retained as rendered; their appearance is not normalized or repaired by this test.

## Acceptance and next parent boundary

`rtk proxy bun test desktop/gpui/fixtures/math-write/mermaid/verify.test.ts` passes **7 tests / 557 assertions**: immutable Source/build hashes, actual default and legacy branching, global regression, scoped SVG/PNG identity plus direct-equation correction, embedded-style limits, actual loaded glyph faces/no external requests, and the unapplied one-file candidate's scope/font preservation. These are executable saved-browser fixture checks, not a fresh application build or GPUI acceptance.

After a parent applies the reviewed patch, build and serve new actual Source assets and repeat the complete original equation corpus and live NodeView/source-preview interactions. Preserve all current original/diagnostic baselines. The proposed mixed stylesheet intentionally contains both version markers; the native foundation's current first/global-version check will still refuse CurrentSource. Before it can be reconsidered, track **consumer-specific** scoped equation CSS 0.18.1 separately from retained global Mermaid CSS 0.16.47, then record newly corrected Source measurements and actual native Write geometry/selection/history/GPU proof. Engine-matched diagnostic vectors remain diagnostic throughout this decision.

Runtime, math helper, Source CSS and app metadata are frozen and unchanged by this receipt.
