import { component$, useStore, $, useVisibleTask$ } from "@builder.io/qwik";
import type { DetectedCitation } from "../../types";
import { detectCitations } from "../../utils/citations";

interface CitationsStore {
  citations: DetectedCitation[];
  expandedId: string | null;
}

export const CitationsPanel = component$(() => {
  const store = useStore<CitationsStore>({
    citations: [],
    expandedId: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DetectedCitation[]>).detail;
      const existingIds = new Set(store.citations.map((c) => c.id));
      const newCitations = detail.filter((c) => !existingIds.has(c.id));
      if (newCitations.length > 0) {
        store.citations = [...store.citations, ...newCitations];
      }
    };
    window.addEventListener("twyne:citations", handler);
    return () => window.removeEventListener("twyne:citations", handler);
  });

  const scanNow = $(() => {
    const editorEl = document.querySelector(".twyne-editor .ProseMirror");
    if (editorEl) {
      const text = editorEl.textContent || "";
      window.dispatchEvent(
        new CustomEvent("twyne:citations", {
          detail: detectCitations(text),
        }),
      );
    }
  });

  const removeCitation = $((id: string) => {
    store.citations = store.citations.filter((c) => c.id !== id);
  });

  const getTypeLabel = (type: DetectedCitation["type"]) => {
    switch (type) {
      case "doi":
        return "DOI";
      case "url":
        return "URL";
      case "isbn":
        return "ISBN";
      case "author-year":
        return "Author-Year";
      case "footnote":
        return "Footnote";
    }
  };

  const getTypeColor = (type: DetectedCitation["type"]) => {
    switch (type) {
      case "doi":
        return "bg-purple-100 text-purple-700";
      case "url":
        return "bg-blue-100 text-blue-700";
      case "isbn":
        return "bg-green-100 text-green-700";
      case "author-year":
        return "bg-amber-100 text-amber-700";
      case "footnote":
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div class="flex flex-col h-full">
      <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <h2 class="text-sm font-semibold text-[var(--color-ink)] flex items-center gap-2">
          <span>📚</span> Citations Detected
        </h2>
        <p class="text-xs text-[var(--color-ink-muted)] mt-1">
          {store.citations.length} citation
          {store.citations.length !== 1 ? "s" : ""} found
        </p>
      </div>

      <div class="px-4 py-2 border-b border-[var(--color-surface-3)]">
        <button
          onClick$={scanNow}
          class="w-full py-1.5 px-3 rounded-lg text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          Scan Document for Citations
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        {store.citations.length === 0 && (
          <div class="text-center py-8 text-[var(--color-ink-muted)]">
            <p class="text-3xl mb-3">📖</p>
            <p class="text-sm">No citations detected yet</p>
            <p class="text-xs mt-1">
              Citations (DOI, URLs, ISBNs, author-year) will appear as you write
            </p>
          </div>
        )}

        {store.citations.map((citation) => (
          <div
            key={citation.id}
            class="px-4 py-3 border-b border-[var(--color-surface-3)] hover:bg-[var(--color-surface)]/50 transition-colors"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span
                    class={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getTypeColor(citation.type)}`}
                  >
                    {getTypeLabel(citation.type)}
                  </span>
                </div>
                <p class="text-xs text-[var(--color-ink)] font-mono break-all">
                  {citation.text}
                </p>
                {store.expandedId === citation.id && citation.metadata && (
                  <div class="mt-2 space-y-1">
                    {Object.entries(citation.metadata).map(([key, val]) => (
                      <p
                        key={key}
                        class="text-xs text-[var(--color-ink-muted)]"
                      >
                        <span class="font-medium capitalize">{key}:</span> {val}
                      </p>
                    ))}
                  </div>
                )}
                {citation.lookupUrl && (
                  <a
                    href={citation.lookupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 mt-1.5 text-xs text-[var(--color-brand)] hover:text-[var(--color-brand-dark)]"
                  >
                    Look up ↗
                  </a>
                )}
              </div>
              <div class="flex items-center gap-1 ml-2">
                <button
                  onClick$={() => {
                    store.expandedId =
                      store.expandedId === citation.id ? null : citation.id;
                  }}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  {store.expandedId === citation.id ? "▾" : "▸"}
                </button>
                <button
                  onClick$={() => removeCitation(citation.id)}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent-red)]"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
