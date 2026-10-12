# Actual Source math NodeView fixture

The current Source stylesheet mismatch is present in the **actual math NodeViews and their live source previews**, not just a stand-alone `renderToString` example. Both profiles import `src/components/editor/extensions/math.ts`; that module creates the original `math-source-editor.ts` form and uses the original guarded KaTeX renderer. Source and native runtime files remain unchanged.

The fixture uses installed Tiptap 3.22.4 with StarterKit and the actual MathExtensions, installed KaTeX 0.18.1, and the byte-exact published `dist/assets/CxHd3gM_-style.css` (278,414 bytes). Original global KaTeX CSS is 0.16.47. `provenance.json` records exact hashes. The candidate adds only installed 0.18.1 non-font rules under `:is(.twyne-math,.twyne-math-source-preview)` and retains the entire original stylesheet and its twenty KaTeX font faces. This is a fixture overlay, **not an applied Source patch**.

Root's Google font link lives in `src/root.tsx`, outside the bundled stylesheet. `original-fonts.css` replays the exact previously captured original Google declarations/WOFF2 responses locally, with only URLs remapped and unused, uncached faces omitted. `captured-google-fonts.css` and `font-replay.json` preserve that boundary and all seven byte hashes. No fonts were downloaded during this task. CDP confirms custom **Lora-Regular** for surrounding prose and **KaTeX_Math-Italic** for all six valid formulas and previews in both profiles. The monospace source field/error fallback remains the actual Source platform stack. The initial fixture without the root font link was superseded; its fallback typography is not used as final evidence.

All final observations use an owned localhost tab in a new Playwriter CLI session 5, existing Chrome **150.0.7871.46** headless, and original local assets. There are no external requests, storage, account/provider/Convex calls, user-display operations, audio/device use, browser installation, Cargo or Devenv commands. Session 4 and the app tab were never operated.

## Observations

Eight cases cover ordinary inline math, a fraction, a radical, scripts, a display matrix, Unicode/text, invalid LaTeX and an empty atom. `*-nodes.json` and `*-nodes-620.json` retain actual inspect/CDP boxes, computed styles, selected fonts, rendered NodeView DOM, and canonical Tiptap HTML/JSON. `*-previews*.json` does the same for the **visible preview**, separately from the NodeView's hidden saved render. Paired PNGs show all nodes and every source form at 1280×860 and 620×860. `measurements.json` is a projection of those receipts.

Representative actual 1280px values:

| Measurement | Current published Source CSS | Scoped 0.18.1 candidate |
| --- | ---: | ---: |
| Ordinary NodeView width / height | 49.9375 / 32.390625 | 49.9375 / 32.390625 |
| Fraction NodeView width / height | 57.9375 / 36.90625 | 39.9375 / 32.390625 |
| Radical NodeView width / height | 96.203125 / 34.265625 | 89.671875 / 32.390625 |
| Scripts NodeView width / height | 54.421875 / 34.140625 | 42.171875 / 32.390625 |
| Matrix block NodeView height | 118.390625 | 112.265625 |
| Fraction NodeView `.katex-strut` display | inline | inline-block |
| Fraction/script `.katex-sizing` font | 21.78px | 15.246px |
| Fraction live-preview output width / height | 48.90625 / 31.46875 | 33.71875 / 27.359375 |
| Fraction live-preview script font | 18.392px | 12.8744px |

Prose is Source Lora 18px with 32.4px line height. The saved formula base is 21.78px; the preview base is 18.392px from Source's 15.2px preview font. The script ratio is restored to 0.7 by the candidate. The NodeView rectangles above include Source's inline-flex/line box or block wrapper; they are **not** a standalone TeX advance, paint frame, or baseline. At 620px the inline formula widths are the same; block width follows its container. The original empty atom renders `Invalid LaTeX / empty source`, whereas opening its source form shows `A live preview of the equation appears here.` Neither state invents canonical content.

`original-interactions.json` and `candidate-interactions.json` each record **30 actual actions**: click/open, held typing, live preview, exact-whitespace Render, real Ctrl-Z/Ctrl-Shift-Z, Cancel, F2, Escape, NodeView Enter, inline Enter submission, block Enter newline, Ctrl-Enter submission of the final newline, real Tiptap toolbar Undo/Redo, empty Cancel, and invalid-source Render/error. Unsubmitted preview changes never enter the document. Raw LaTeX, including surrounding spaces and the final block newline, survives submission/history. Rendered KaTeX/form DOM never enters canonical HTML. Untouched cases remain unchanged.

The source code was not copied into fixture view logic. `client.ts` only constructs editors/corpus and exposes the installed Editor's `getHTML`/`getJSON` state. Browser state evaluation is limited to that fixture API/readiness; DOM/styles/fonts are read using Playwriter snapshot/inspect and CDP. NodeView and source-form actions are real click/fill/keyboard operations.

## Executable checks and reproduction

Executed:

```sh
rtk proxy bun desktop/gpui/fixtures/math-write/nodeview/prepare-fonts.ts
rtk proxy bun desktop/gpui/fixtures/math-write/nodeview/serve.ts
rtk proxy bunx --no-install playwriter session new --browser headless
rtk proxy bunx --no-install playwriter -s 5 --timeout 30000 -f desktop/gpui/fixtures/math-write/nodeview/open.js
rtk proxy bunx --no-install playwriter -s 5 --timeout 30000 -f desktop/gpui/fixtures/math-write/nodeview/capture.js
rtk proxy bunx --no-install playwriter -s 5 --timeout 30000 -f desktop/gpui/fixtures/math-write/nodeview/preview.js
rtk proxy bunx --no-install playwriter -s 5 --timeout 30000 -f desktop/gpui/fixtures/math-write/nodeview/interactions.js
rtk proxy bun desktop/gpui/fixtures/math-write/nodeview/summarize.ts
rtk proxy bun test desktop/gpui/fixtures/math-write/nodeview/verify.test.ts
```

The receipt gate passed **9/9 tests, 1,035 assertions**. It validates captured observations and immutable Source/assets, not a newly executed browser run. The separate live browser scripts performed the actions above. Their final logs are empty, no requests left localhost, and both profiles have identical canonical and rendered DOM with different CSS geometry.

For a new run, use the newly printed session ID rather than reusing session 5 or any app session. Read the Playwriter skill/full CLI documentation first. `open.js` creates a new fixture tab and rejects an existing non-fixture tab. Set `state.profile="original"` or `"candidate"` and `state.fixtureWidth=1280` or `620` through a CLI state call before `open.js`; run scripts sequentially after completion. For each 1280px profile run capture → previews → interactions. For each 620px profile run capture → previews. Reload through `open.js` before a fresh profile/width so canonical fixture documents reset. `serve.ts` regenerates its ignored browser bundle; retained local fonts/CSS already make it independent of the original temporary cache. `prepare-fonts.ts` is needed only to reproduce the initial cached-response import, and refuses missing cache rather than fetching.

The owned tab/server are closed at handoff; `cleanup.json` records their scope. Build output is generated/ignored, not a second implementation. The two fixture-only layout concessions are independent captions/cards and `min-height:0` on each editor, replacing the app's 60vh minimum so eight editors can be inspected together. No formula/layout/source-editor CSS is otherwise substituted.

## Proof limits

This establishes actual imported NodeView/source-form behavior and the CSS projection in an isolated Tiptap editor. It does not establish the complete app extension stack/route, native GPUI raster/baseline/selection integration, all formulas/Unicode, other platforms, or MathJax Proof/PDF parity. The candidate makes a measurable intentional geometry change; it is not the current Source baseline. Earlier engine-matched SVG diagnostics and Mermaid receipts remain frozen and distinct. Source retains 0.16.47 globally; the evidence supports scoping newer rules to these consumers if the parent later chooses to change Source, rather than replacing Mermaid's legacy global rules. No stylesheet decision was applied here.

Superseded harness failures: the first CSP omitted data-font allowance; the first empty-hint assertion read only a snapshot diff; and early preview queries selected the hidden saved render. Final fixtures correct those harness issues, and tests require visible-preview boxes/custom font proof. Those failures are not attributed to Source. The initially omitted root Google font link was also corrected with byte-exact cached responses before the final matched captures and interaction runs.
