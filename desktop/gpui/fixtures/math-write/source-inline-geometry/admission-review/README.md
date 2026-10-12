# Inline Source baseline admission review

This is a **read-only offline JSON checker**, with thirteen authored synthetic
tests. Worker validation is limited to Python syntax and JSON/hash inspection.
Neither the checker nor tests have been executed by this worker. Parent owns
their execution and every actual browser/native receipt.

`analyze.py` takes two observations and their matching raw DOMSnapshots: select
the **opened markers** variant from one receipt and the **opened control** variant
from the other. Forms may remain concurrently open; they may also be observed
separately if the Source lifecycle requires that. A closed control atom never
qualifies as an opened form baseline control. No UI, source, browser, server,
runtime or existing fixture is changed by this review.

The output is stdout JSON. Exit0 means `PARTIAL_ADMISSION`; exit2 means
`NOT_ADMITTED`. A failure names the exact missing/contradictory contract and emits
no expected baseline number. Output also hashes every supplied input. This checks
provided JSON consistency; hashes and declared frame serials cannot authenticate
execution, prove a scene was painted or certify pixels.

## Admission scope

The independently qualified result is
`proseFirstLabelBaseline.status = ADMITTED_CONSISTENCY`. It requires all of:

- Frozen original Source/CSS/font replay and authored case provenance; loaded
  actual custom Lora; three increasing collector frames; no external requests.
- Unchanged canonical HTML and exact authored JSON, Unicode prose and math
  source. Both selected fields must exist with the same raw value and actual
  UTF-16 logical selection. No normalization is performed.
- Same opened paragraph/atom/form/label/field/actions boxes and computed styles,
  compared relative to each actual paragraph. Raw document-space layout has its
  own measured origin; it is never silently equated to client-space coordinates.
- Reported prose is exactly the raw paragraph's direct text leaves, excluding
  form/KaTeX descendants. Complete text-box ranges, text, normalized positions,
  wrapping rows and paragraph/label selected fonts must agree. Surrogate splits,
  omitted ranges and scalar/grapheme reinterpretation are refused. Combining
  sequences remain unchanged.
- Four authored zero-extent points have exact source-side DOM order and UTF-16
  positions. They must agree with raw quads and the corresponding matched prose
  row/edge. Before/after points must share the first actual label text row and
  the actual atom edges under the original nested flex baseline styles.
- Atom-owned Source caret rectangles must independently match the atom quads in
  both captures. Prose-side marker point versus control text-rectangle differences
  remain explicit. The control rectangle is never treated as a baseline.

The admitted form-relative value comes only from a qualified measured marker
point minus the measured form origin. It is not a TeX/glyph baseline, font ascent,
caret strut, wrapper-height inference or authorization to adopt native geometry.
The first-label claim is a row/baseline consistency contract for this exact
original scaffold and context, not complete form typography certification.

`fieldTypography` and `fieldPaintedCaret` remain independent `NOT_ADMITTED`
sections. In the inspected actual opened receipts, textarea platform-font lists
are empty and no visible field text/caret rows are present in DOMSnapshot. That
does **not** automatically reject independently qualified prose/first-label
evidence. It does block full field typography/caret claims. Even nonempty equal
textarea font lists admit only selected-font identity; visible field row/caret
evidence still needs a separately reviewed protocol.

The checker does not consume screenshots and accepts the same CDP/DOM evidence
schema from a provenance-recorded DOM-only observer. It cannot convert a failed
observation into success. Retained screenshot/action failure receipts remain
failures and are listed in the inspected input inventory. Neither viewport nor
DOM-only collection establishes full-app, native, KaTeX, IME or all-OS parity.

## Parent-only commands

Run from the repository root, using exact retained observations. These paths are
the inspected wide/ordinary checkpoint, not a claim that the checker has passed:

    rtk proxy python3 desktop/gpui/fixtures/math-write/source-inline-geometry/admission-review/analyze.py \
      --markers desktop/gpui/target/verification/source-inline-geometry-wide-ordinary-81c2a7c3-f7be-416e-83a8-669b8a6383cd/02-open-markers.json \
      --markers-snapshot desktop/gpui/target/verification/source-inline-geometry-wide-ordinary-81c2a7c3-f7be-416e-83a8-669b8a6383cd/02-open-markers-dom-snapshot.json \
      --control desktop/gpui/target/verification/source-inline-geometry-wide-ordinary-81c2a7c3-f7be-416e-83a8-669b8a6383cd/03-open-control.json \
      --control-snapshot desktop/gpui/target/verification/source-inline-geometry-wide-ordinary-81c2a7c3-f7be-416e-83a8-669b8a6383cd/03-open-control-dom-snapshot.json \
      --provenance desktop/gpui/target/verification/source-inline-geometry-wide-ordinary-81c2a7c3-f7be-416e-83a8-669b8a6383cd/server-provenance.json

For a later actual batch, supply its corresponding opened observations, raw
snapshots and server provenance. No `--force`, alternate golden or fallback to a
closed control exists. Source/scaffold hash drift is a refusal requiring Parent
review, rather than automatic contract regeneration. The fixed case hash includes
the six authored widths/DPR/content contexts; a single admitted pair does not
admit the other five.

Run the synthetic tests separately:

    rtk proxy python3 -B -m unittest discover \
      -s desktop/gpui/fixtures/math-write/source-inline-geometry/admission-review \
      -p test_analyze.py -v

These tests intentionally use authored geometry and a browser label explicitly
marked synthetic. They cover independent partial admission, closed controls,
contradictory equal-dimension wrapping/markers, exact raw ownership/style/font
checks, UTF-16 boundaries, held input mismatch, stale/failure receipts and strict
JSON refusal. They are deterministic guard tests, not actual execution proof.

Inputs are bounded8MiB per observation/provenance,16MiB per raw snapshot,
200k raw nodes/layout/text boxes,32 selected faces per role,4096 fragments per run,
512KiB individual text and64 levels/1m JSON items. Numeric coordinates must be
finite and bounded. Comparisons permit only1e-6 arithmetic noise, without a
golden/pixel tolerance. The checker writes no files and launches no processes.

## Source and evidence pointers

- `source-inline-geometry/client.ts:61-110` constructs the exact two editors and
  four empty Decoration widgets; `:145-211` reports original caret, canonical
  and unblurred field/logical-selection state.
- `source-inline-geometry/observe.js:130-200` records direct raw paragraph text
  leaves and deliberately unadmitted dimensions; `:231-290` records coherent
  frames, actual selected fonts, quads and raw snapshot ownership.
- `math/math.css:8-14,61-100` specifies the inline baseline/flex/label/field
  contract. `math-source-editor.ts:59-98` places the label text before the real
  textarea and makes the label the first form child.
- `source-inputs.json` pins original Source/CSS/font replay and the case corpus.
  `reviewed-inputs.json` hashes the inspected successful/failed raw artifacts and
  distinguishes the original collector from Parent's viewport adapter.
- `field-evidence-proposal.md` is a bounded **unapplied** follow-up. It provides
  no field baseline expected number and changes no original observer.
- `freeze.json` hashes only the newly authored output files. No new actual
  browser, app-route, native or pixel receipt is created by this worker.
