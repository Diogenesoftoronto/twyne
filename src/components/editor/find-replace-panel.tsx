import {
  $,
  component$,
  sync$,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
  type PropFunction,
} from "@qwik.dev/core";
import type { Editor } from "@tiptap/core";
import { getFindReplaceState } from "./extensions/find-replace";

export interface FindReplacePanelProps {
  /** Live Tiptap editor. The coordinator wires this during central integration. */
  editor?: NoSerialize<Editor> | null;
  onClose$?: PropFunction<() => void>;
  initialQuery?: string;
}

function findSnapshot(editor: Editor) {
  const state = getFindReplaceState(editor.state);
  const count = state?.matches.length ?? 0;
  return {
    count,
    current: count > 0 && state ? state.activeIndex + 1 : 0,
    error: state?.error ?? null,
  };
}

/**
 * Compact, keyboard-friendly Find/Replace surface. Search changes update only
 * plugin metadata and decorations; replacement commands are the sole document
 * mutations, so opening, navigating, or closing the panel cannot dirty HTML or
 * create undo entries.
 */
export const FindReplacePanel = component$<FindReplacePanelProps>((props) => {
  const search = useSignal(props.initialQuery ?? "");
  const replacement = useSignal("");
  const caseSensitive = useSignal(false);
  const wholeWord = useSignal(false);
  const regex = useSignal(false);
  const matchCount = useSignal(0);
  const activeMatch = useSignal(0);
  const searchError = useSignal<string | null>(null);

  // Subscribe to Tiptap transactions so the counter follows navigation and
  // document edits without asking the parent editor to mirror plugin state.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    track(() => props.editor);
    const editor = props.editor;
    if (!editor || editor.isDestroyed) return;
    const refresh = () => {
      const state = findSnapshot(editor);
      matchCount.value = state.count;
      activeMatch.value = state.current;
      searchError.value = state.error;
    };
    editor.on("transaction", refresh);
    if (search.value) {
      editor.commands.setFindQuery(search.value, {
        caseSensitive: caseSensitive.value,
        wholeWord: wholeWord.value,
        regex: regex.value,
      });
    }
    refresh();
    cleanup(() => {
      editor.off("transaction", refresh);
    });
  });

  const updateQuery = $(() => {
    const editor = props.editor;
    if (!editor || editor.isDestroyed) return;
    editor.commands.setFindQuery(search.value, {
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      regex: regex.value,
    });
    const state = findSnapshot(editor);
    matchCount.value = state.count;
    activeMatch.value = state.current;
    searchError.value = state.error;
  });

  const close = $(() => {
    const editor = props.editor;
    if (editor && !editor.isDestroyed) editor.commands.clearFindQuery();
    void props.onClose$?.();
  });

  const onSearchKey = $((event: KeyboardEvent) => {
    if (event.key === "Enter") {
      if (event.shiftKey) props.editor?.commands.findPrevious();
      else props.editor?.commands.findNext();
      const editor = props.editor;
      if (editor) {
        const state = findSnapshot(editor);
        matchCount.value = state.count;
        activeMatch.value = state.current;
        searchError.value = state.error;
      }
    } else if (event.key === "Escape") {
      void close();
    }
  });
  const preventSearchNavigation = sync$((event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
    }
  });
  const preventEscape = sync$((event: KeyboardEvent) => {
    if (event.key === "Escape") event.preventDefault();
  });

  const count = matchCount.value;
  const current = activeMatch.value;
  const hasActive = current > 0;

  return (
    <section
      class="twyne-find-replace-panel"
      role="search"
      aria-label="Find and replace"
      style={{
        display: "grid",
        gap: "0.55rem",
        padding: "0.75rem",
        border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
        borderRadius: "0.65rem",
        background: "var(--color-paper, #fffdf8)",
        boxShadow: "0 12px 32px rgba(27, 22, 15, 0.14)",
        minWidth: "min(34rem, calc(100vw - 2rem))",
      }}
    >
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <label style={{ flex: "1" }}>
          <span class="sr-only">Find</span>
          <input
            type="search"
            value={search.value}
            placeholder="Find"
            autofocus
            aria-invalid={searchError.value ? "true" : undefined}
            aria-describedby={
              searchError.value ? "find-replace-error" : undefined
            }
            onInput$={(event) => {
              search.value = (event.target as HTMLInputElement).value;
              void updateQuery();
            }}
            onKeyDown$={[preventSearchNavigation, onSearchKey]}
            style={{ width: "100%" }}
          />
        </label>
        <output
          aria-live="polite"
          aria-label={`${current} of ${count} matches`}
          style={{
            minWidth: "4.5rem",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {current} / {count}
        </output>
        <button
          type="button"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={count === 0}
          onClick$={() => {
            props.editor?.commands.findPrevious();
            const editor = props.editor;
            if (!editor) return;
            const state = findSnapshot(editor);
            matchCount.value = state.count;
            activeMatch.value = state.current;
          }}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={count === 0}
          onClick$={() => {
            props.editor?.commands.findNext();
            const editor = props.editor;
            if (!editor) return;
            const state = findSnapshot(editor);
            matchCount.value = state.count;
            activeMatch.value = state.current;
          }}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label="Close find and replace"
          onClick$={close}
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <label style={{ flex: "1" }}>
          <span class="sr-only">Replace with</span>
          <input
            type="text"
            value={replacement.value}
            placeholder="Replace with"
            onInput$={(event) => {
              replacement.value = (event.target as HTMLInputElement).value;
            }}
            onKeyDown$={[
              preventEscape,
              $((event: KeyboardEvent) => {
                if (event.key === "Escape") void close();
              }),
            ]}
            style={{ width: "100%" }}
          />
        </label>
        <button
          type="button"
          disabled={!hasActive}
          onClick$={() => {
            props.editor?.commands.replaceCurrent(replacement.value);
            const editor = props.editor;
            if (!editor) return;
            const state = findSnapshot(editor);
            matchCount.value = state.count;
            activeMatch.value = state.current;
          }}
        >
          Replace
        </button>
        <button
          type="button"
          disabled={count === 0}
          onClick$={() => {
            props.editor?.commands.replaceAll(replacement.value);
            const editor = props.editor;
            if (!editor) return;
            const state = findSnapshot(editor);
            matchCount.value = state.count;
            activeMatch.value = state.current;
          }}
        >
          Replace all
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap" }}>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive.value}
            onChange$={(event) => {
              caseSensitive.value = (event.target as HTMLInputElement).checked;
              void updateQuery();
            }}
          />{" "}
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={wholeWord.value}
            onChange$={(event) => {
              wholeWord.value = (event.target as HTMLInputElement).checked;
              void updateQuery();
            }}
          />{" "}
          Whole word
        </label>
        <label>
          <input
            type="checkbox"
            checked={regex.value}
            onChange$={(event) => {
              regex.value = (event.target as HTMLInputElement).checked;
              void updateQuery();
            }}
          />{" "}
          Regular expression
        </label>
      </div>

      {searchError.value && (
        <p
          id="find-replace-error"
          role="alert"
          style={{ margin: 0, color: "var(--color-accent-red)" }}
        >
          {searchError.value}
        </p>
      )}
    </section>
  );
});
