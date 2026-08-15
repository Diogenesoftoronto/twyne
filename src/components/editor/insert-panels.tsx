import { component$, type PropFunction } from "@builder.io/qwik";
import { TextModal } from "../ui/text-modal";

type NoteKind = "endnote" | "footnote";

const NOTE_MODAL_COPY = {
  footnote: {
    title: "Footnote",
    description:
      "Footnote text appears at the foot of the page on the same sheet as the marker — for asides the reader needs on the same page as the line that prompted them.",
    inputLabel: "Footnote text",
    placeholder: "e.g. See Smith 2019, p. 142, for the original formulation.",
    submitLabel: "Insert footnote",
  },
  endnote: {
    title: "Endnote",
    description:
      "Endnote text collects under Notes at the end of the manuscript — for sourcing, citations, and longer remarks.",
    inputLabel: "Endnote text",
    placeholder:
      "e.g. The name 'Eleanor' surfaces across the archive in nine distinct hands.",
    submitLabel: "Insert endnote",
  },
} as const satisfies Record<
  NoteKind,
  {
    title: string;
    description: string;
    inputLabel: string;
    placeholder: string;
    submitLabel: string;
  }
>;

interface InsertPanelsProps {
  noteKind: NoteKind | null;
  mermaidOpen: boolean;
  imageOpen: boolean;
  imageUrl: string;
  imageUploadAvailable: boolean;
  imageUploadError: string | null;
  commentOpen: boolean;
  commentText: string;
  onCancelNote$: PropFunction<() => void>;
  onConfirmNote$: PropFunction<(value: string) => void>;
  onCancelMermaid$: PropFunction<() => void>;
  onConfirmMermaid$: PropFunction<(value: string) => void>;
  onChooseImage$: PropFunction<() => void>;
  onImageUrlChange$: PropFunction<(value: string) => void>;
  onInsertImage$: PropFunction<(url: string) => void>;
  onCancelImage$: PropFunction<() => void>;
  onCommentChange$: PropFunction<(value: string) => void>;
  onAddComment$: PropFunction<() => void>;
  onCancelComment$: PropFunction<() => void>;
}

/**
 * Temporary insert flows opened by the compositor. These panels collect input
 * and return intents; the editor orchestrator still owns document mutation.
 */
export const InsertPanels = component$<InsertPanelsProps>((props) => {
  const noteKind = props.noteKind;
  const noteCopy = NOTE_MODAL_COPY[noteKind ?? "endnote"];
  const imageUrl = props.imageUrl;
  const commentText = props.commentText;
  const onInsertImage$ = props.onInsertImage$;
  const onCancelImage$ = props.onCancelImage$;
  const onAddComment$ = props.onAddComment$;
  const onCancelComment$ = props.onCancelComment$;

  return (
    <>
      <TextModal
        open={noteKind !== null}
        kicker="Insert"
        title={noteCopy.title}
        description={noteCopy.description}
        inputLabel={noteCopy.inputLabel}
        placeholder={noteCopy.placeholder}
        helpText="Cmd/Ctrl + Enter to insert · Esc to cancel"
        rows={4}
        minHeightRem={8}
        submitLabel={noteCopy.submitLabel}
        onCancel$={props.onCancelNote$}
        onConfirm$={props.onConfirmNote$}
      />

      <TextModal
        open={props.mermaidOpen}
        kicker="Insert"
        title="Mermaid diagram"
        description="Write a Mermaid diagram spec. It will render in-line where the cursor sits."
        inputLabel="Diagram source"
        placeholder="graph TD; A[Manuscript] --> B{Reviewed?}; B -->|Yes| C[Publish]; B -->|No| D[Revise]; D --> A"
        helpText="Cmd/Ctrl + Enter to insert · Esc to cancel. See mermaid.js.org for syntax."
        rows={8}
        minHeightRem={14}
        submitLabel="Insert diagram"
        onCancel$={props.onCancelMermaid$}
        onConfirm$={props.onConfirmMermaid$}
      />

      {props.imageOpen && (
        <div
          class="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
          style="z-index: var(--z-sticky);"
        >
          <span
            class="text-xs text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            Plate URL:
          </span>
          <button
            type="button"
            onClick$={props.onChooseImage$}
            disabled={!props.imageUploadAvailable}
            class="tool-btn text-xs"
          >
            Choose file…
          </button>
          <span class="text-xs text-[var(--color-ink-muted)]">or</span>
          <input
            autoFocus
            value={imageUrl}
            onInput$={(_, element) => props.onImageUrlChange$(element.value)}
            onKeyDown$={(event) => {
              if (event.key === "Enter" && imageUrl.trim()) {
                onInsertImage$(imageUrl.trim());
              }
              if (event.key === "Escape") onCancelImage$();
            }}
            placeholder="https://…"
            class="flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
            style="font-family: var(--font-typewriter); border-radius: 2px;"
          />
          <button
            onClick$={() => onInsertImage$(imageUrl.trim())}
            class="tool-btn text-xs"
          >
            Insert
          </button>
          <button onClick$={onCancelImage$} class="tool-btn text-xs">
            Cancel
          </button>
          {props.imageUploadError && (
            <span role="alert" class="text-xs text-[var(--color-vermilion)]">
              {props.imageUploadError}
            </span>
          )}
        </div>
      )}

      {props.commentOpen && (
        <div
          class="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
          style="z-index: var(--z-sticky);"
        >
          <span
            class="text-xs text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            Comment:
          </span>
          <input
            autoFocus
            value={commentText}
            onInput$={(_, element) => props.onCommentChange$(element.value)}
            onKeyDown$={(event) => {
              if (event.key === "Enter" && commentText.trim()) onAddComment$();
              if (event.key === "Escape") onCancelComment$();
            }}
            placeholder="Type your editorial note…"
            class="flex-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
            style="font-family: var(--font-typewriter); border-radius: 2px;"
          />
          <button onClick$={onAddComment$} class="tool-btn text-xs">
            Add
          </button>
          <button onClick$={onCancelComment$} class="tool-btn text-xs">
            Cancel
          </button>
        </div>
      )}
    </>
  );
});
