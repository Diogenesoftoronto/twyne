# Native block and section drag evidence

The source contract is `section-reorder.ts`, `section-reorder.ts`'s tests,
`src/utils/section-reorder.ts` and `document-outline.ts`. A heading's closed
section ends before the next peer or ancestor heading. Dropping after a target
places that complete section after the target's complete section. Self,
descendant and already-adjacent destinations do not mutate the document.
Original image, block-math and Mermaid nodes are draggable; Raw Typst and page
breaks are not. This native slice does not add paragraph handles or OS file drop.

## Model boundary

`RichDocument::plan_section_move` and `plan_block_move` return an optional
`BlockMovePlan`. `Command::MoveSection` and `MoveBlocks` execute a freshly
validated plan as one undo transaction. They move the existing shared nodes,
retaining inline marks, note/comment metadata, authored atom source, image bytes,
future attributes and zero-content metadata siblings. Source remains independent
from visual HTML. Root's existing semantic reconciliation owns canonical Typst.

Sections are currently closed, top-level headings. Complete block moves remain
inside one root, block quote, list item or table cell. Structural list/table
containers and cross-cell/container destinations are guarded. Ordinary readonly
command gating and cached HTML/resource limits still apply before publication.

Section selection uses the original delete-and-insert mapping: a caret deleted
with the source collapses at the deletion boundary; it does not silently follow
the section. Atomic native drops select their new complete range. Undo restores
the exact prior tree and selection. Complex structural moves do not emit an
invented primitive `EditDelta` or Flow typing sample.

## Native interaction boundary

The surface uses real GPUI drag payloads and measured block rectangles. Pickup
captures the editor identity, revision, selection and shared source node. Pointer
previews use cached sibling prefix metadata and current measured geometry; a
drop revalidates all captured guards before executing. Cancel, outside drop,
self-drop, stale revision/selection, readonly and host removal preserve source,
selection and history. Pointer cancellation also clears the platform drag.

The original heading widget text is `⋮⋮`, body 18px/32.4px, opacity 0.55 and
translate(-24px, 3.2px). It is drawn without wrapping. Heading margins determine
the pre-heading handle position; source IDs and labels remain metadata rather
than native DOM replacements. Complete image, equation and diagram wrappers are
real draggable hit targets. The native ghost is a lightweight source label,
which differs visually from the browser's captured drag image.

Focused handles support Enter/Space pickup, Up/Down preview, Enter commit and
Escape cancellation. The handle owns an Escape action context so a host binding
cannot accidentally close furniture while leaving a drag alive. Accepted moves
focus the writing input so native Ctrl-Z works. Root dismisses transient furniture
while retaining its real draft, and owns bounded scrolling at the current
scroller edge.

The host integration is:

```rust
RichEditorEvent::DragStarted { source: NodePath }
RichEditorEvent::DragFinished { moved: bool }
RichEditorEvent::DragAutoScrollRequested { position: Point<Pixels> }

view.set_drag_viewport(Some(current_viewport));
view.cancel_block_drag(window, cx); // idempotent before hiding/replacing
view.is_dragging();
view.block_bounds(&path); // current measured complete-block surface rectangle
```

## Acceptance

The scoped core and mounted input tests cover closed nested sections, exact
one-step undo, Unicode selection mapping, shared object/source metadata,
keyboard cancellation, stale edit rejection, readonly gating and cross-cell
refusal. The mounted tests use actual GPUI pointer/key dispatch rather than
calling only the move helper.

```sh
rtk proxy devenv shell -- cargo test --locked --offline --features ui-tests --lib --manifest-path desktop/gpui/Cargo.toml editor:: -- --test-threads=1
rtk proxy devenv shell -- cargo build --locked --offline --example twyne-clipboard-probe --features desktop --manifest-path desktop/gpui/Cargo.toml
rtk proxy devenv shell -- python3 desktop/gpui/fixtures/editor/check-block-drag-native.py
```

The Python driver allocates a new Xvfb display and sends real OS pointer/key input
from a separate XTEST process. The Rust probe asserts the explicit owned display
and the actual X11 compositor. Both processes and the display are terminated.
No user desktop or browser profile is accessed. The output directory defaults to
`/tmp/twyne-block-drag-native`, with `acceptance.json`, `before.png`, `preview.png`
and `moved.png`. Actual original 3.008-derived UI fonts and native image pixels are
rendered; equation source is retained even when this small probe has no proof
renderer configured.

This slice does not implement editable gap-cursor positions between atomic
blocks, arbitrary cross-container ProseMirror moves, external application block
drag MIME negotiation, auto-expanding collapsed sections, or OS file insertion.
Those remain explicit parity gaps. Browser and native glyph baselines and the
drag grip's fallback face remain separate measured typography gaps; a
successful native move is not full UI pixel parity. The wide opening paragraph's
`remem-/ber` flow now matches after preserving the source's fractional initial
size; see `notebook-typography-contract.md` for the measured cause and limits.
