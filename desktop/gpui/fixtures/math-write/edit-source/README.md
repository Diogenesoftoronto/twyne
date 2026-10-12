# Guarded raw math source transaction

This slice changes only `src/editor/command.rs`, `src/editor/transaction.rs` and this fixture directory. It does not install a KaTeX renderer, change Source/CSS, add a native source form, alter app integration or generate authored Typst. No Cargo, Devenv, direct rustc, browser process, provider, network, installation or commit was run by this worker.

## Contract

```rust
Command::UpdateMathSource {
    path: NodePath,
    expected: Node,
    source: String,
}
```

The current node must be a math atom and share storage with `expected`. Missing, non-math, stale and detached equal-value targets refuse before document, selection, marks, revision or history changes. Read-only is refused by the existing transaction owner. The host still qualifies folio/editor/revision/selection and runs canonical preflight; node identity is not proof of account or host scope.

On an accepted edit the command clones the existing shell, patches the four original portable math attributes (`data-type`, `data-latex`, `data-math-display`, `aria-label`) and replaces the atom's text payload with exactly the submitted raw source. Unknown attributes, style/class additions, surrounding marks and unrelated subtrees remain retained. Rendered/form DOM is not canonical source; old descendant payload is replaced only by an explicit source commit, and Undo restores it exactly.

Raw input is not trimmed or validated as LaTeX. Empty, whitespace-only, invalid syntax, Unicode and final newlines are authored source; a later renderer can report their presentation errors independently. The current HTML/tree/text bounds validate the candidate before publishing it. This does not bypass Root's separate original canonical-source budget.

Math remains one scalar/UTF-16 object unit. Actual Source `setNodeMarkup` maps a selected inline atom to a caret at its start; a selected block stays selected. Unrelated native selections remain unchanged. Undo restores the exact prior tree, marks and selection; Redo restores the accepted state. A source edit reports no prose `EditDelta`. An identical raw submit with unchanged canonical metadata/payload does not create document history. As with other typed commands, an explicitly open core history group is caller-owned; the existing `RichEditorView::execute` closes typing/note groups for this new command before dispatch.

`Command::from_id` now recognizes the exact Source `insert.math-inline` and `insert.math-block` IDs and returns the existing empty-source typed inline/block insertions. Existing IDs remain intact. Native math controls/catalogue surfaces are still separate host work.

## Executed Source evidence

`generate-reference.ts` imports the **actual** MathExtensions, project Tiptap test harness and installed ProseMirror; it does not copy the command implementation. It executed nine raw source cases and their real Undo/Redo in isolated JSDOM. `source-reference.json` retains original HTML/JSON, PM selections, one-pass native UTF-16 selection projections and source hashes. Cases include the actual previously observed authored fraction spaces/final block newline, marked Unicode, empty/whitespace-only/invalid source, and block atoms at either document end. The block selection distinction was measured by this execution rather than inferred from the Note command.

Executed:

```sh
rtk proxy bun desktop/gpui/fixtures/math-write/edit-source/generate-reference.ts
rtk proxy bun test desktop/gpui/fixtures/math-write/edit-source/source.test.ts
```

Result: the original Source generator completed **9 cases**; the Source replay/catalogue/hash gate passed **3 tests / 161 assertions**. This executes original commands and history again; it is not a test that only checks authored expected vectors. JSDOM has no real layout engine, so none of this establishes browser/native geometry, keyboard focus, source-form preview timing, pixels or KaTeX parity.

## Parent Rust gate

`transaction.rs` declares the private cfg(test) module from this owned fixture file; no shared module registration is needed. Eight native tests are authored and formatted, **not run by this worker**:

1. Differential raw payload/HTML/selection/one-commit Undo/Redo over all nine executed Source cases.
2. Unknown attributes, enclosing marks/comment wrappers, neighboring note/tail identity and backward-selection Undo.
3. Stale/missing/non-math/detached/read-only refusal preserving undo/redo, stored marks and an open pending group.
4. Oversized source refusal before publishing any document/selection/history/revision state.
5. Identical source history neutrality and unrelated selection preservation.
6. Imported text-fallback/old descendant payload consistency, with exact Undo.
7. An unrelated typed paragraph retains the math descriptor; source commit and typing burst have independent undo steps.
8. Original insertion IDs create empty atom types and retain existing intents.

Inside the parent's established native build environment, run:

```sh
rtk proxy cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml --lib editor::transaction::math_source_tests
```

Then include both normal and UI-feature strict all-target Clippy in the parent's scheduled gate. Rustfmt was run only on the two owned runtime files and owned test file with `--edition 2024 --config skip_children=true`.

## Integration boundary

No external exhaustive `editor::Command` match requiring a new arm was found: the exhaustive mutation match lives in the owned `transaction.rs`; existing view dispatch accepts typed commands generically, and other reviewed exhaustive matches use unrelated source/table command enums. There is therefore no necessary unapplied shared-file diff in this transaction slice. Future renderer/source-form/host changes remain the distinct proposal in `../editor-adoption-review/README.md`; they were not applied here.

The native selection model currently uses scalar ranges rather than a distinct public NodeSelection enum. This command follows the existing selected-atom range convention; it does not claim a full ProseMirror selection-type port. No provider/authentication, KaTeX production adoption, canonical reconciliation, actual mounted source-form, complete-app or other-platform proof is implied by these core fixtures.
