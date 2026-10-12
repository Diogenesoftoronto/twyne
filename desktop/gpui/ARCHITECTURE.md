# Native module map

The original Electrobun-hosted Twyne is the behavioral and visual reference.
Rust owns the native UI, local manuscripts, rich transactions, and Typst rendering.
The Bun document helper reuses the existing source converters. The connected SDK
is a separate prepared boundary; its presence does not mean account sync is mounted.

This is currently one Rust crate with a library and desktop binary, plus Bun
helpers for reused document semantics and the prepared connected transport.
Pure document code can run without the `desktop` feature. Stable ownership and
testable boundaries come first; turning each feature into a crate would add build
and API overhead while these contracts are still being established.

## Package boundaries and ownership

| Package or module                                                                | Owns                                                                                | Keep outside it                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/app.rs`                                                                     | Writing-room state, startup, active document, save/navigation orchestration         | New feature rendering, command catalogs, document algorithms |
| `src/app/room_layout.rs`                                                         | Room composition and mounting existing surfaces                                     | Insertion algorithms, provider calls, persistence            |
| `src/app/*_coordinator.rs`                                                       | One feature's host state, subscriptions, focus and document identity                | Another feature's implementation                             |
| `src/editor/{model,transaction,command}.rs`                                      | Structured document tree, scalar selections, transactions, history                  | GPUI, account state, file/network access                     |
| `src/editor/view*.rs`                                                            | Native input, layout, pagination and editor interaction                             | Authored Typst reconciliation, room routing                  |
| `src/insert_menu/`                                                               | Source catalog/search, query detection, insertion adapters, retained list and forms | Active manuscript ownership and saving                       |
| `workspace`, `source_session`, `semantic_bridge`, `source_editor`, `source_view` | Authored Typst, recoverable source drafts and verified visual projection            | Treating cached HTML as canonical authored source            |
| `storage`, `manuscript`, `revisions`                                             | Local files, manuscript metadata and revision persistence                           | UI focus and popup state                                     |
| `native_accounts/`, `tools/connected/`                                           | Native account contracts and Bun SDK transport/session boundary                     | Implicit attachment of guest writing to an account           |
| `native_collaboration/`                                                          | Sharing roles, presence and publishing contracts                                    | Claiming prepared requests are live collaborative editing    |
| `native_ai/`, `gen_ui/`                                                          | AI request/stream/freshness rules and retained writing-tool cards                   | Network calls or document mutation from a card renderer      |
| `native_audio/`                                                                  | Optional audio state, PCM, segment and transport rules                              | Claiming synthetic checks establish device/provider behavior |
| `theme`, `assets`, `chrome`                                                      | Shared original colors, fonts, artwork and controls                                 | Feature-specific document behavior                           |

`app.rs` is still larger than intended. Move coherent responsibilities into sibling
modules as they are worked on, keeping the host entry points small. Do not split a
file solely to meet a line count or add a second owner of document state.

The next coherent host extractions are Source/Proof coordination, library/file
actions, and room chrome rendering. Their existing host methods and feature
tests provide the boundary; extraction must preserve flush and departure order.

## Investigate a feature

| Native entry point                                                      | Original reference                                                                                                                     | Focused verification                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app/manuscript_coordinator.rs`                                         | `components/editor/manuscript-panel.tsx`, `global.css`                                                                                 | `app/manuscript_tests.rs`                                                                                      |
| `app/slash_coordinator.rs`, `insert_menu/`                              | `components/editor/extensions/slash-command.ts`, `slash-command-menu.tsx`, `utils/editor-commands.ts`, `utils/slash-command-filter.ts` | `insert_menu/tests.rs`, `app/slash_tests.rs`, `fixtures/insert-menu/`                                          |
| `editor/view_insert.rs`                                                 | `components/editor/twyne-editor.tsx` registry dispatch                                                                                 | Pure rich transaction tests and mounted slash tests                                                            |
| `insert_menu/table_grid.rs`, `insert_menu/table_picker.rs`              | `components/editor/table-insertion-grid.tsx`                                                                                           | Executed Source vectors, mounted pointer/key tests, actual-font captures                                       |
| `insert_menu/{form,text_modal_view,modal_spec}.rs`                      | `components/editor/insert-panels.tsx`, `components/ui/text-modal.tsx`                                                                  | Extracted copy/field specifications, mounted newline/submit/cancel tests, focused and initial browser captures |
| `insert_menu/modal_preview.rs`, `inline_proof.rs`, `semantic_bridge.rs` | `components/editor/mermaid-theme.ts`, `components/ui/text-modal.tsx`                                                                   | Actual renderer capability and stale-result checks; a mounted empty preview does not prove diagram rendering   |
| `editor/view_shortcuts.rs`                                              | `utils/keybindings.ts` and command priority                                                                                            | Mounted rich shortcuts; code-block exit/undo in `editor/tests.rs`                                              |
| `compositor.rs`                                                         | `components/editor/compositor-panel.tsx`, `utils/compositor-toolbar.ts`                                                                | `fixtures/chrome/`, `fixtures/editor/`                                                                         |
| `app/account_coordinator.rs`                                            | `components/auth/{account-menu,auth-panel}.tsx`                                                                                        | `app/tests.rs`, `fixtures/connected-work/`                                                                     |
| `source_view.rs`, `source_editor.rs`                                    | `components/editor/typst-code-editor.ts`                                                                                               | `fixtures/source_view/`                                                                                        |
| `gen_ui/`, `app/gen_ui_coordinator.rs`                                  | Writing-tool cards and tool contracts                                                                                                  | `fixtures/gen-ui/`                                                                                             |

Original paths in this table are relative to the repository's `src/` directory.
Start with the feature's coordinator, then its package and original counterpart:

```bash
rtk proxy rg -n 'insert_from_slash|refresh_insert_menu' desktop/gpui/src
rtk proxy rg -n 'insert.table|runRegistryCommand' src/components/editor/twyne-editor.tsx
```

## Editor contracts

- Plain-text input offsets are **UTF-8 bytes**. Rich document offsets are
  **Unicode scalars**. Source ProseMirror offsets are **UTF-16 positions**.
  Convert at the adapter boundary, never guess from string length.
- Detect a slash from the current line/text block before the collapsed caret.
  Opening or dismissing the menu does not modify the document.
- Activation binds the manuscript, selection/query and revision. Immediate
  commands remove the query and insert the element in one native history group.
- Parameter commands remove the query when activated, as the original editor
  does. Cancel leaves that removal intact. The retained picker/form must validate
  its manuscript, editor, post-removal caret and revision before committing;
  plain input also compares the retained post-removal body at that boundary.
  Failed or stale commits leave the document at its current state.
- Native parameter removal and commit are separate undo steps. Original
  ProseMirror time grouping is a separate comparison gate. IME confirmation
  belongs to the composing input.
- Equation commands insert blank editable atoms immediately. Note and diagram
  dialogs accept ordinary Enter as a newline and Ctrl/Cmd+Enter as confirmation;
  blank confirmation is disabled. Diagram syntax is a preview concern, not a
  confirmation gate in the original editor.
- Feature surfaces emit intent; the active-document host accepts it. Each surface
  has an explicit owner and clears its pending work on document departure.
- Keep keystroke work local. Whole-document conversion and serialization happen
  at explicit freshness boundaries, not as a side effect of showing a menu.

## Fast checks and evidence

One owner runs Cargo commands to avoid competing for the build lock. Other agents
can work on independent pure modules, fixtures, or original behavior in parallel.
Give weaker external agents bounded inputs and inspect their output before adoption.

The crate gates GPUI behind `desktop`; document rules can be checked without
loading a UI. `tools/sync-insert-menu.ts --check` executes the original catalog,
search and extracted pure table helpers, so reference drift is detected before
native adapter work. A displayed shortcut must also have a mounted behavior
check; a matching label alone is insufficient.

```bash
rtk proxy devenv shell -- rtk proxy cargo test --locked --offline --no-default-features --lib --manifest-path desktop/gpui/Cargo.toml insert_menu
rtk proxy devenv shell -- rtk proxy cargo test --locked --offline --features ui-tests --bin twyne-desktop --manifest-path desktop/gpui/Cargo.toml slash_
rtk proxy devenv shell -- rtk proxy cargo test --locked --offline --features ui-tests --bin twyne-desktop --manifest-path desktop/gpui/Cargo.toml manuscript_title_
```

Mounted tests exercise controls and history using GPUI's test text system. Check
fonts, clipping and actual pixels separately with `tools/capture-native.py`, an
immutable binary, a known fixture, window size and scale, and an isolated library.
Record the binary and source hashes with that observation. Do not use the user's
open writing session as a test fixture.

Builds, pure tests, mounted controls, native GPU captures, browser comparisons,
real account/provider use, and distribution/device checks are separate evidence.
Current feature status belongs in `PORT_PLAN.md`; do not infer readiness from
the existence of a module or a prepared contract.

## Reproduce an issue quickly

1. Identify the owning coordinator and original counterpart in the table above.
2. Reduce the issue to an isolated manuscript and explicit route, view, selection,
   window size and scale. Reuse an existing fixture when possible.
3. Check document rules with a pure test, focus/events with a mounted test, and
   clipping or spacing with original-browser and actual-native captures.
4. Record the exact binary, helper and source hashes. Keep historical receipts
   intact so an old successful build is never mistaken for the current one.

For parallel work, assign one package or fixture with an explicit input/output
contract. The host retains document ownership; workers emit intent. Small
external-model tasks work best for reference extraction and bounded review,
with root validation of every proposed behavioral change. Cargo stays serial.

The highest-value investigation improvements are further Source/Proof and
library host extraction, a current build identity beside diagnostic captures,
and automated comparisons that preserve initial focus before explicitly
focusing a control. A source catalog match, a mounted interaction and an actual
font capture answer different questions; start with the smallest check that
can reproduce the reported symptom.
