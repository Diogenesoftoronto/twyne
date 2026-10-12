# Original inline math form geometry probe

This is an **authored, unexecuted** Parent browser probe. It imports the actual
Source MathExtensions, NodeView, createMathSourceEditor, guarded KaTeX renderer
and installed Tiptap. It serves the unchanged retained original stylesheet and
byte-exact previously captured original font responses. No Source CSS correction,
candidate overlay, MathJax, native callback or successful cached result is supplied.

Only this new directory was edited. Existing Source, servers, browser state,
runtime, previous math fixtures and frozen native-host/inline files are untouched.
The optional integration.patch remains unapplied.

The scaffold is two small Tiptap editors using StarterKit and actual MathExtensions,
not the full product extension stack or route. The explicitly authored differences
are captions/navigation, root rem basis 16px, 24px outer padding, a selected paragraph
width and min-height:0. Math, form, label, textarea, actions and preview CSS remain
original. CJK/emoji use the actual observed platform fallback; captured original
Latin/Greek fonts are replayed, without fetching new faces.

## Source contract being measured

- extensions/math.ts creates an inline span with class twyne-math-inline.
  Opening hides the saved render span and appends the real source form to that
  same atom. The form is not a floating overlay.
- math.css makes the outer atom inline-flex, align-items:baseline,
  vertical-align:baseline and max-width:100%. The inline form is inline-flex
  with min-width:min(22rem,70vw) and vertical-align:middle. Its actual flex
  baseline, width constraint and overflow must be measured; no TeX or SVG box
  supplies them.
- math-source-editor.ts builds a label containing the textarea, followed by the
  preview and actions. Inline rows=2, raw value is retained and focus places the
  end-caret. Its real preview debounce is 300ms. This lane performs no submission:
  geometry, held draft and cancellation must leave canonical HTML unchanged.
- The original global KaTeX CSS/installed engine mismatch remains present.
  Closed ordinary/fraction wrapper geometry is independent of the admitted
  diagnostic fragment's font/paint frame described in current-adoption/CONTRACT.md.

The generated server provenance pins all Source modules, current published CSS,
original font replay/bytes, package versions and actual bundle hashes. Preparation
refuses a changed font replay or CSS that does not match one published stylesheet.

## Baseline and caret evidence

The markers editor adds four zero-width/zero-height Decoration widgets at
prefix-start, before-math, after-math and suffix-end. Their inline-block border
points expose authored baseline locations; the small absolute pink ticks affect
paint only. They never enter Editor.getHTML/getJSON.

The control editor contains identical actual Source content without widgets.
Matched dimensions, text fragments and caret rectangles are retained so Parent
can detect a marker-induced break/selection difference. No result is automatically
admitted as a baseline contract, even when dimensions agree. Before/after markers
can be on different rows; their proximity is not used to guess the atom baseline.

The fixture-only reporter calls actual Editor.view.coordsAtPos at both sides of
the atom and at the actual selection endpoints. It also reports the real textarea
value/end-caret and Editor canonical JSON/HTML. This is explicit fixture measurement
code, not a copied form/controller or an injected product API.

Parent observation reads that reporter through DOM.getAttributes. It uses
getCDPSession({page}), DOM.getBoxModel, CSS.getComputedStyleForNode,
CSS.getMatchedStylesForNode, CSS.getPlatformFontsForNode and DOMSnapshot.captureSnapshot.
There is no page.evaluate, locator.evaluate or Runtime.evaluate. Raw CDP quads,
document-space text fragments and client-space caret rectangles are retained with
layout/scroll metrics rather than silently mixing coordinate spaces.

DOMSnapshot text-box start/length are recorded as raw protocol indices; no guessed
grapheme, scalar or ProseMirror conversion is made. Only actual Editor/marker
positions are qualified as ProseMirror UTF16.

## Parent execution

The worker ran syntax/JSON/hash inspection only. Parent owns browser/server
execution. Read the full current Playwriter skill documentation first, and use a
new task-owned session and page. Do not use an existing application or fixture tab.

Start the independent server from the repository root:

    rtk proxy bun desktop/gpui/fixtures/math-write/source-inline-geometry/serve.ts

It binds only 127.0.0.1:5199 and prints a fresh generated artifact directory.
Alternatively Parent may review/apply integration.patch to its
target/verification/source-nodeview-server.ts and use the same route at port5196.
That patch only adds preparation and an independent /inline-geometry/ handler.
It does not alter the existing root fixture. The independent server option leaves
current servers running; applying the optional patch requires Parent to start a
patched owned server rather than modifying a live process.

Create a separate session through Parent's installed/cached Playwriter CLI.
The following uses the established cached CLI form; replace SESSION and the
server directory with actual values:

    rtk proxy bunx --no-install playwriter -s SESSION -e 'state.inlineGeometryServerArtifacts="/absolute/fresh/server-directory"; state.inlineGeometryScenario="wide-ordinary"'
    rtk proxy bunx --no-install playwriter -s SESSION --timeout 60000 -f desktop/gpui/fixtures/math-write/source-inline-geometry/open.js
    rtk proxy bunx --no-install playwriter -s SESSION --timeout 60000 -f desktop/gpui/fixtures/math-write/source-inline-geometry/observe.js

open.js creates only a new page, installs a localhost-only request allowlist,
sets explicit CDP viewport/DPR, navigates and snapshots before further actions.
Its scripts never read cookies, credentials, user-profile files, providers or
application storage. CSP refuses connections/media/frames; blocked external
requests cause an honest observation failure.

Set one action, execute action.js, then execute observe.js again:

    rtk proxy bunx --no-install playwriter -s SESSION -e 'state.inlineGeometryAction="open"; state.inlineGeometryVariant="markers"'
    rtk proxy bunx --no-install playwriter -s SESSION --timeout 60000 -f desktop/gpui/fixtures/math-write/source-inline-geometry/action.js
    rtk proxy bunx --no-install playwriter -s SESSION --timeout 60000 -f desktop/gpui/fixtures/math-write/source-inline-geometry/observe.js

Every action snapshots before and after, reads fresh reporter frames, and verifies
unchanged canonical HTML. There is no force click, synthetic dispatch or scripted
form submit. Available actions are open, fill-draft, cancel, escape, caret-before,
caret-after, arrow-right and resize. The two caret buttons are explicit scaffold
navigation using actual Editor selection/focus commands. arrow-right requires an
observed plain manuscript TextSelection. No action automatically retries.

Suggested per-scenario sequence:

1. Observe closed; select/observe the actual before and after carets.
2. Open/observe markers, then open/observe control. If Source keeps both forms
   mounted, compare their normalized geometry. If it does not, retain that fact
   and compare separate receipts rather than forcing an open state.
3. fill-draft/observe each variant if preview/input wrapping is needed.
   The script waits for the actual debounced preview markup to change, not merely
   for an old preview to remain visible. Drafts are never submitted.
4. Cancel/observe each form. Canonical source/Unicode prose must remain unchanged.
5. Optionally open again and resize the retained form via the viewport action.

For resize, set a bounded explicit request such as:

    rtk proxy bunx --no-install playwriter -s SESSION -e 'state.inlineGeometryAction="resize"; state.inlineGeometryResize={width:620,height:860,dpr:2}'

This changes only the owned page's viewport/DPR through CDP; it retains the existing
Source form/input. Width must be320..1280, height600..1000, DPR1|2.

The six recommended scenarios in cases.json are wide-ordinary, wide-fraction,
narrow-ordinary, narrow-long, small-ordinary and narrow-ordinary-dpr2. They measure
content widths704/280/240 at viewports1280/620/320. Set another scenario and run
open.js explicitly to reset authored content into a fresh receipt directory.

Optional intrinsic controls use state.inlineGeometryControlWidth="min-content"
or "max-content" before open.js. Only the control editor's authored containing
block changes to that CSS width. Source atom/form CSS stays original. These
contexts are explicitly excluded from matched-control admission and product
width claims. Default "flow" is required for the marker/control comparison.

Close only this owned page:

    rtk proxy bunx --no-install playwriter -s SESSION --timeout 30000 -f desktop/gpui/fixtures/math-write/source-inline-geometry/close.js

Parent then stops only the server process it started. No script closes a browser
context, adopts an existing page, installs anything or shuts down unrelated servers.

## Receipts and limits

Each run gets a fresh target/verification/source-inline-geometry-* directory.
It retains server provenance, snapshots/action reports, two fresh identical box
measurements, a final coherent-frame check, full raw DOMSnapshot data, all actual
content/padding/border/margin quads, matched/computed styles, selected fonts,
canonical HTML/JSON, Source caret rectangles and CSS-pixel screenshots. DPR2 also
retains device-pixel screenshots. Failed actions/observations write a failure
receipt when the owned page is still reachable; they do not manufacture a result.

The reporter heartbeat is bounded to8minutes. Ready/report/preview waits are8/10s,
actions3s, geometry one bounded retry, request logs1000 entries, reporter128KiB,
observation8MiB and raw DOMSnapshot16MiB. Repeated capture/action names are numbered;
raw receipts are never overwritten. Custom Lora must be observed in both
paragraphs, and external request attempts are refused.

Unproven until Parent execution: server bundle/type compatibility, Playwriter/CDP
availability, actual CSS widths/baselines, marker neutrality, UTF16/caret evidence
and DPR screenshots. Empty/invalid preview states, manual textarea resize,
other browsers/OS/fonts and the full app route are outside the six-case corpus.
No fixture result establishes KaTeX native renderer parity or admits a diagnostic
SVG/font box as Source wrapper geometry.
