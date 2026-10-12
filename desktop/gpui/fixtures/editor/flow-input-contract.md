The native writer reports `CommandOutcome.edit_delta: Option<EditDelta>` with
`inserted_utf16` and `deleted_utf16` counts from an accepted primitive. A real
same-length replacement retains both counts. UTF-16 conversion uses cached
subtree lengths and the touched text leaf; no HTML serialization or manuscript
diff runs on the keystroke path. Split/join counts distinguish the paragraph's
two structural positions, simple list-item Backspace's four, and a code newline's
single text position. Grouped history sums forward primitives and reverses them
for Undo. IME candidate replacements remain one undo boundary.

`RichEditorEvent::Input { delta }` emits only when the document changed and
the native writer's actual FocusHandle owns focus. Selection, copy, zero-map
formatting, read-only rejection, background/source projection replacement and
unfocused mutations emit no input sample. Root owns the active Flow preference,
sampler, profile and ribbon. This event alone does not enable Flow.

`RichDocument::text_between_blocks()` derives the current web PM document's
space-separated text leaves only at an explicit session start/end boundary.
Current source/image/math/diagram/note atoms and hard breaks have no NodeSpec
`leafText`; Tiptap's separate `toText` serializers are not used by PM
`doc.textBetween`. Root applies the exact original `countWords` separator rules
(space, tab/LF/CR/VT/FF, NBSP), preserving punctuation and other Unicode spaces.
The ordinary `plain_text()` projection intentionally includes source/image
fallbacks and is unsuitable for those session word counts.

`capture-flow-web.ts` executes the current local Tiptap extensions and PM
transactions in fresh Chrome with zero remote requests and no user profile
access. Its generated `flow-web-reference.json` records actual StepMap counts,
HTML and textBetween output. Core comparisons cover equal-length emoji edits,
IME candidates and grouped Undo/Redo, paragraph/list/code split/join, source-note
rich clipboard slices, zero-map formatting and the boundary text. The list
fixture uses the actual StarterKit Backspace keymap: generic PM joinBackward
alone removes two list-item positions and leaves two paragraphs, while the
current keyboard behavior removes four and merges their text.

Native GPUI tests additionally observe real emitted events across IME input,
surrogate ranges, GPUI rich copy/cut/paste, caret/format changes, read-only input,
blur and external source projection. They establish native test-platform input
behavior, not hardware IME/OS clipboard/device proof.

Closed block clipboard slices, table/container restructuring, recasing and
arbitrary metadata commands currently have no PM-equivalent mapping delta.
They still edit/undo their preserved structure but contribute no invented Flow
sample. Full structural StepMap fidelity remains pending. A replacement whose
resulting native tree is identical is a no-op with no input event; an explicitly
dispatched identical PM ReplaceStep can itself have nonzero maps. Normal IME
commit after the same final candidate leaves the native tree unchanged.
