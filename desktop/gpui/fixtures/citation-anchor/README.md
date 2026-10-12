# Source citation-placement preparation

`src/citation_anchor.rs` adapts a current native `RichDocument` to the exact
original `findTextRange` function extracted from
`src/components/editor/twyne-editor.tsx:3989`. Matching whitespace, case,
punctuation and first-match order stay in that compiled helper. Rust never
normalizes or guesses a quote.

## Evidence

`generate-reference.ts` runs the exact extracted function on actual ProseMirror
documents with Twyne's original extensions in isolated JSDOM. It maps original
PM text-unit positions to native projected UTF-16 positions, recording both.
Seven source documents cover 32 match probes: adjacent marks, emoji, combining
text, NBSP/FEFF/tab whitespace, escaped regular-expression punctuation,
case-sensitive and first-match behavior, omitted notes/source/hard-break gaps,
paragraph separation, lists/quotes/table cells, and block atom captions/source.
It also runs the actual `EndnoteNode.setFootnote` command and records HTML.

`probe-source-edges.ts` separately runs the original same-caret stored-bold and
code-block command cases. The original footnote is an unmarked atom, clears
stored bold for subsequent typing, and lifts code-block placement into a
paragraph. The approved native Note-only transaction corrections reproduce
the first two behaviors without changing other inline-object insertion.

`source-reference.json` and `source-command-edges.json` are executable Source
command/model evidence. JSDOM has no real layout engine; these fixtures are
neither browser interaction/raster proof nor a live-manuscript insertion.
No provider, user browser, bibliography or persisted manuscript is modified.

## Contract

`citation_text_blocks(document)` validates existing rich HTML/resource bounds,
then traverses public nodes once using cached UTF-16 subtree lengths. Marks
flatten into positioned text leaves. Atom payloads, hard breaks and non-content
are omitted from searchable text while their actual projected gaps are kept.
The original matcher intentionally can join text across an omitted inline atom
or hard break; it never joins text across text blocks. Malformed nested blocks
inside inline content refuse before matching rather than inventing a range.

`prepare_citation(document, selection, request, bridge)` checks the original
nonempty source ID/text requirement, then resolves:

1. The anchor through the original helper.
2. The source URL through that helper if the anchor did not match.
3. Only an explicitly allowed nonempty current selection.

Request truthiness is exact: absent/empty anchor yields `select-passage` if
resolution fails; whitespace-only nonempty anchor yields `anchor-not-found`.
Whitespace-only footnote text is nonempty and is accepted like Source.
Fallback uses the ordered selection end, including backward selections.

Confirmed helper UTF-16 endpoints convert through cached native offset APIs.
Empty/reversed ranges, out-of-range positions and surrogate-interior endpoints
refuse; there is no snapping or approximation. Prepared candidates expose the
confirmed range/origin, original selection, end caret, actual
`Command::InsertInline(InlineObject::Note { Footnote, text })`, candidate rich
document and resulting selection. Candidate construction runs that real command
on a disposable core editor and enforces existing HTML/resource bounds.

The note has the original `sup` type/class/text/title attributes. It has no
source-ID or citation-key link. Existing prose, review/unknown attributes,
objects and marks remain intact. Preparation writes no insertion timestamps.
The disposable candidate history never replaces live history. Root owns the
atomic live commit, canonical preflight, entity/folio/revision/selection/IME/
read-only guards and timestamp ACK. One prepared note transaction can restore
the exact prior tree and writer selection on Undo; bibliography timestamps are
an independent policy and are not reconciled by this module.

## Explicit limits

Code-block targets currently refuse before candidate mutation. Original Source
creates paragraph structure for the note; native structural splitting is still
pending. The original table-ending transaction also appends an empty trailing
paragraph; this broader schema normalization remains pending. The candidate
comparison documents that one suffix difference while requiring identical note
placement/attributes and all existing nodes. New-note attribute ordering can
differ in equivalent HTML; original existing attribute order is preserved.

This module does not select a live passage, insert into a view, reconcile
metadata, research sources, format citations or rewrite canonical Typst.

## Commands

Run from repository root:

```sh
rtk proxy devenv shell -- bun desktop/gpui/fixtures/citation-anchor/generate-reference.ts
rtk proxy devenv shell -- bun desktop/gpui/fixtures/citation-anchor/probe-source-edges.ts
rtk proxy devenv shell -- cargo test --offline --locked --lib --manifest-path desktop/gpui/Cargo.toml citation_anchor::tests -- --nocapture
rtk proxy devenv shell -- rustfmt --edition 2024 --check desktop/gpui/src/citation_anchor.rs desktop/gpui/src/editor/transaction.rs
rtk proxy devenv shell -- cargo clippy --offline --locked --all-targets --features ui-tests --manifest-path desktop/gpui/Cargo.toml -- -D warnings
```

The focused native gate checks actual original-helper projections/outputs,
source note candidates, anchor→URL→explicit selection priority, exact missing
reasons, UTF-16/scalar boundaries, no live mutation, unmarked note/comment
boundaries, other atom context, stored-bold/after-typing behavior, one-note Undo,
read-only refusal, nested-block safety and explicit pending code-block behavior.
