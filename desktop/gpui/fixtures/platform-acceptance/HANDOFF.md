# Platform fixture review handoff

Status: frozen for parent review. Ownership was limited to
`fixtures/platform-acceptance/**`; no runtime, packaging, Cargo, Devenv, browser,
OS configuration, install or device operation was performed.

## Corrected verifier contract

[verifyPlatformAcceptance](verify.ts) is a pure, bounded validator over unknown
input. It accepts only explicitly labeled **synthetic-input-consistency** data
and a `build.kind: synthetic-fixture` declaration. [contract.ts](contract.ts)
calls those fields `BuildDeclaration`, not observed build facts. Results expose
`scope`, `ok`, `issues`, and `notChecked`; formatted output says “Synthetic
platform declarations agree,” never that device/platform acceptance passed.

- Required helpers are matched by **ID** and checked for exact platform name,
  flat staged path, required flag, stated build name and an actual matching
  `manifest.files` **declaration** with `kind: executable`. A different ID with
  the same name cannot satisfy the helper. Unknown executable inventory, duplicate
  IDs/names/paths, case aliases and unsafe paths fail.
- Schema-2 manifests must state the flat/unassembled packaging layout. Older or
  overstated inputs, wrong types and malformed structures fail closed with a
  concrete `invalid-input` issue instead of throwing or passing.
- `handlesFileArguments:false` now rejects stated file imports/associations even
  when all extension tokens match. Compound `.twyne.json` uses the final `json`
  dispatcher token. This validates declarations, not OS association dispatch.
- A declared URL scheme **always** needs an implementation and a handler;
  `implementedInGpui:false` no longer permits an unsupported registration. All
  valid native fixtures now declare zero schemes, matching packaging's removal
  of the unimplemented plist registration. Handler claims without schemes fail.
- Microphone capability/usage-key checks remain hypothetical. The positive
  microphone fixture does not claim that the app has a hardware adapter.

All valid/broken JSONs explicitly identify their synthetic origin. Executable
file entries and scaffold paths are coherent with the new packaging layout.
The four original named negative fixtures remain and still fail for their
intended helper-extension, redo-alias, import-token and capability reasons.

## Actual checks in this review

```bash
rtk proxy bun test desktop/gpui/fixtures/platform-acceptance/verify.test.ts
rtk proxy bun node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck \
  --target es2022 --module esnext --moduleResolution bundler --types bun \
  --lib es2022,dom desktop/gpui/fixtures/platform-acceptance/{contract,verify,verify.test}.ts
rtk proxy bun desktop/gpui/fixtures/platform-acceptance/verify.ts \
  desktop/gpui/fixtures/platform-acceptance/valid/linux.json
```

Current result: **23 pass, 0 fail; 80 assertions** using cached Bun1.4.2.
Strict TypeScript passed. Negative cases cover the wrong-ID/equal-name bypass,
missing/wrong-kind/wrong-path executable file records, startup false with correct
tokens, required flag/path/name omissions, duplicate/escaping inventories,
unsupported scheme false/true claims, malformed/older/overstated data and honest
result labeling. No actual build or binary was run by these checks.

## Separate evidence and integration boundary

[matrix.md](matrix.md) now distinguishes source-declared maps/import support,
metadata scaffolds, hypothetical fixtures and actual owned Linux receipts.
It links the established X11 driver/docs without inventing a missing full run
JSON. It cites the narrower assembled-app16 and paginated selected-text8 X11
receipts only at their stated scopes, and the retained Wayland29/29 native and
8/8 ordinary-app clipboard receipts separately. This review read those records;
it did not rerun the drivers or prove rebuilt-binary/device equivalence.

This verifier **does not read staged executable bytes or observe filesystem
presence**. Matching `manifest.files` proves inventory consistency only. Use the
separate [packaging verifier](../../packaging/stage.ts) for current source-backed
on-disk types/bytes/modes/notices. Its aggregate byte budget is not set; bounds
are per file/inventory, not a whole-tree memory guarantee. Neither checker is a
code signature, installer, updater or native OS acceptance adapter.

No integration patch is needed for this new fixture-only scope. The packaging
workflow/package patches remain parent-owned and unapplied. Future actual CI
build/device receipts require a separately reviewed collector rather than
relabelling these synthetic fixtures. Frozen Source/font/platform/editor runtime
and all other worker edits remain unchanged.
