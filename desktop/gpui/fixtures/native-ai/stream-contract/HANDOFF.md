# Handoff: stream-contract native-AI fixtures

Root review update: corrected `chunkCase` to send successive character deltas;
the original worker concatenated whole prefixes. Added seven reasoning boundary
cases and all 25 structured-marker prefix cases. Current counts are 32 reasoning,
23 generation (81 push snapshots), 45 interview, and eight each text/record cases.
Fresh Source checks pass 10 tests / 240 assertions. Four standalone Rust
differential tests also pass; see `native-gates.json` and `src/native_ai/stream_tests.rs`.
The full AI runtime and mounted provider consumers remain pending. The counts
and scope below retain the earlier worker handoff checkpoint.

Owned folder: `desktop/gpui/fixtures/native-ai/stream-contract/`. Only these files
were created. No Rust, Source, manifest, lock, or pre-existing file was edited.

## Files

- `generate.ts` (194 lines): direct imports from `src/utils/generation-stream.ts`,
  `src/utils/reasoning-tags.ts`, `src/utils/interview-stream.ts`. Exports the case
  tables and `buildVectors()`; writes `source-vectors.json` only under
  `import.meta.main`.
- `source-vectors.json` (generated, not hand-written): `sourceSha256` map plus
  `reasoning` (25), `generation` (23, 84 push snapshots), `interview` (20),
  `textSnapshots` (8), `snapshotFromRecord` (8).
- `source-contracts.test.ts` (175 lines): re-executes Source and compares to the
  recorded JSON.

## Commands

```
cd desktop/gpui/fixtures/native-ai/stream-contract
rtk bun run generate.ts
rtk bun test source-contracts.test.ts
```

Result: 10 pass / 0 fail, 218 expect() calls.

## Evidence

- `source hashes match the Source files on disk` guards that the JSON came from
  the three Source modules by sha256.
- `whole recorded vector set equals a fresh execution of Source` deep-compares
  `buildVectors()` (live calls) to the recorded JSON, so the vectors cannot be
  hand-authored.
- `every generation snapshot is one accumulator.push result` replays each case
  input-by-input through a fresh accumulator and asserts `initial` plus one
  snapshot per push; total snapshots 84 (< 200 bound).
- Interview, text, and record cases each re-execute their Source function.
- `live Source semantics` asserts behavior independent of the JSON (tag
  stripping, partial-tag withholding, native/tagged dedupe, and that ordinary
  generation keeps DOSSIER/PROBE/SYNTHESIZE text while interview hides it).

Coverage includes empty and whitespace-only, JS BOM/NBSP/NEL, Unicode, think and
thinking in mixed case with attributes, nested/self-closing/stray/malformed tags
(`think42`, `think-x`, `think_foo`, space before slash), newline/indentation
normalization, every prefix of `\u003cthink\u003e` / `\u003c/think\u003e` /
`\u003cthinking\u003e`, finish/error, empty completion, and persisted
reasoning/answer rows.

## Note for future editors

The file-write path drops literal angle brackets in some tag-like sequences.
All tag text in these fixtures is built with `\u003c` / `\u003e` escapes (helper
`tag()`), which survive verbatim. Keep that pattern when adding cases.

Native Rust implementation and comparison are out of scope here and remain with
the root owner.
