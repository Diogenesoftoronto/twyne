# Raw layout fragmentation parser proposal

The fresh Parent opened pair refused `SNAPSHOT_LAYOUT_OWNER` before any selected
geometry was compared. Read-only inspection of its raw snapshots identifies the
cause: the analyzer assumes that every DOM node in the document has one layout
row, including nodes it never uses for admission.

The exact inspected checkpoint is
`target/verification/source-inline-geometry-wide-ordinary-8430f5ec-4a79-4e9e-865d-6a805e712a07`.
Both `02-open-markers` and `03-open-control` contain four repeated layout owners:

| Raw nodeIndex | Owner | Layout rows | Observed first bounds, CSS px |
| --- | --- | --- | --- |
| 35 | prefix-start marker `::after` | 23,24 | 22,219.390625,4,1 |
| 38 | before-math marker `::after` | 27,28 | 218.9375,219.390625,4,1 |
| 105 | after-math marker `::after` | 66,67 | 570.9375,219.390625,4,1 |
| 108 | suffix-end marker `::after` | 70,71 | 166.859375,417.546875,4,1 |

Each second row has bounds `[0,0,0,0]`. None has text boxes. These are the authored
absolute paint ticks from `source-inline-geometry/fixture-server.ts`, not the
zero-extent marker spans used for the baseline point. They are marker descendants,
but **not selected evidence owners**. All selected paragraph/atom/form/label/
textarea/preview/actions/button/marker-span owners and the direct prose/label
text leaves have exactly one layout row in this pair. Hidden saved output has
no layout; no saved-render geometry is being admitted.

This is a concrete overbroad parser refusal, not observed fragmentation of the
selected evidence. `inspection.json` retains every duplicate row and selected
owner count. It does not claim that a particular Chromium implementation normally
produces these entries, that all contexts behave this way, or that the pair passes
the remaining admission checks. The actual adapter is DOM-only; there is no new
pixel, native or full-app proof.

## Minimal unapplied change

`integration.patch` contains three parser hunks against the unchanged frozen
`analyze.py`. The proposed parser keeps only globally unique layout owners in
`by_node`. Once it encounters a second row, it removes that owner from `by_node`
and retains it in `fragmented_nodes`; subsequent rows never reinstall a chosen
row. It does **not** select first/last/nonempty/identical rows, combine bounds,
merge text fragments or special-case the four fixture node IDs.

Every selected node-bounds request and every selected direct text leaf explicitly
refuses such an owner with `SNAPSHOT_SELECTED_FRAGMENTATION`, even if duplicate
rows are identical. Missing owners keep their prior errors. Invalid global node
indices and invalid raw text-box owners are still refused. Selected exact raw
prose/label equality, UTF-16 coverage, surrogate boundaries, fonts, geometry,
quads, row association, Source pins and all other guards are unchanged.

The change tolerates only unused layout multiplicity. It provides no support for
selected fragmentation. If a later scenario actually fragments a selected owner,
the truthful result remains `NOT_ADMITTED`; a separate observed contract would
be needed, rather than choosing/merging its fragments here.

The original analyzer, tests, source pins, freeze and receipts remain unchanged.
This proposal is **unapplied**. Worker checks cover candidate/emitter/test Python
syntax and exact input/output hashes only; neither the candidate nor tests were
executed. Parent reported the original thirteen tests passed before this proposal.

## Parent review/run

Inspect the minimal patch without applying it:

    rtk proxy git apply --check desktop/gpui/fixtures/math-write/source-inline-geometry/admission-review/raw-fragmentation-adoption/integration.patch

`emit_candidate.py` checks the exact original digest and three unique anchors,
then emits candidate bytes to stdout. It does not import/run the candidate or
write files. Parent may retain that output in a **fresh owned file**, without
overwriting an existing artifact:

    rtk proxy python3 -B desktop/gpui/fixtures/math-write/source-inline-geometry/admission-review/raw-fragmentation-adoption/emit_candidate.py

Use the fresh staged path as `MATH_INLINE_ANALYZER` when running the tests:

    rtk proxy env MATH_INLINE_ANALYZER=/absolute/fresh-parent-directory/analyze.py python3 -B -m unittest discover \
      -s desktop/gpui/fixtures/math-write/source-inline-geometry/admission-review/raw-fragmentation-adoption \
      -p test_fragmentation.py -v

That suite reuses the thirteen frozen original tests unchanged and adds eight
authored synthetic tests. It fails explicitly if the supplied candidate digest
is wrong; there is no skip or return-without-proof. New cases cover unrelated
paint pseudo rows, third fragments with no chosen row, every selected role and
marker span, direct prose/first-label text, control-side fragmentation, invalid
raw node/text owners and unchanged complete UTF-16 coverage.

To analyze the actual pair through the staged candidate, use the original README
CLI with the fresh checkpoint's `02`/`03` observations and raw snapshots. Since a
staged candidate has another filesystem location, also pass explicit originals:

    --cases desktop/gpui/fixtures/math-write/source-inline-geometry/cases.json
    --source-contract desktop/gpui/fixtures/math-write/source-inline-geometry/admission-review/source-inputs.json

The original six contexts, original failure receipts and independent missing
textarea font/painted-caret evidence remain authoritative. No successful result
is promised after this parser change. `input-pins.json` and `freeze.json` pin
the inspected original/fresh bytes and the exact candidate digest separately.
