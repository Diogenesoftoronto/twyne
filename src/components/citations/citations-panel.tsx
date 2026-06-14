import { component$, useStore, $, useVisibleTask$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { DetectedCitation, Folio } from "../../types";
import { detectCitations } from "../../utils/citations";
import {
  type BibEntry,
  loadBibliography,
  deleteBibEntry,
  formatCitation,
  footnoteCite,
} from "../../utils/bibliography";
import { snapshot as researchSnapshot } from "../../utils/background-research";

interface CitationsStore {
  citations: DetectedCitation[];
  expandedId: string | null;
  lastScanCount: number | null;
  bibliography: BibEntry[];
  embedUrl: string | null;
  embedMarkdown: string | null;
  embedTitle: string;
  embedProvider: string | null;
  embedLoading: boolean;
  /** Live status from the background-research module. */
  research: {
    status: "idle" | "running" | "saving" | "error";
    lastQuery: string;
    lastQueryAt: number;
    savedThisSession: number;
    lastTickAt: number;
    error?: string;
  };
  /** The most recent background-saved entry, used for a transient toast. */
  lastBackgroundSave: { saved: number; query: string } | null;
}

interface CitationsPanelProps {
  initialCitations?: DetectedCitation[];
  activeFolio?: Folio | null;
}

export const CitationsPanel = component$(
  ({ initialCitations, activeFolio }: CitationsPanelProps) => {
    const store = useStore<CitationsStore>({
      citations: initialCitations ?? [],
      expandedId: null,
      lastScanCount: null,
      bibliography: [],
      embedUrl: null,
      embedMarkdown: null,
      embedTitle: "",
      embedProvider: null,
      embedLoading: false,
      research: {
        status: "idle",
        lastQuery: "",
        lastQueryAt: 0,
        savedThisSession: 0,
        lastTickAt: 0,
      },
      lastBackgroundSave: null,
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

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      store.bibliography = await loadBibliography();
    });

    // Background-research status — render the live state from the
    // module-level watcher. Updates whenever twyne:background-research
    // or twyne:background-sources fires.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      const pull = () => {
        const s = researchSnapshot();
        store.research = {
          status: s.status as CitationsStore["research"]["status"],
          lastQuery: s.lastQuery,
          lastQueryAt: s.lastQueryAt,
          savedThisSession: s.savedThisSession,
          lastTickAt: s.lastTickAt,
          error: s.error,
        };
      };
      const onSources = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          saved: number;
          query: string;
        };
        store.lastBackgroundSave = detail;
        // Drop the toast after a few seconds.
        setTimeout(() => {
          if (store.lastBackgroundSave === detail) {
            store.lastBackgroundSave = null;
          }
        }, 6_000);
        // Refresh the bibliography so the new entries show up.
        void loadBibliography().then((all) => {
          store.bibliography = all;
        });
      };
      pull();
      window.addEventListener("twyne:background-research", pull);
      window.addEventListener("twyne:background-sources", onSources);
      return () => {
        window.removeEventListener("twyne:background-research", pull);
        window.removeEventListener("twyne:background-sources", onSources);
      };
    });

    const scanNow = $(() => {
      const editorEl = document.querySelector(".twyne-editor .ProseMirror");
      const text = editorEl?.textContent || "";
      const found = detectCitations(text);
      store.lastScanCount = found.length;
      if (found.length > 0) {
        window.dispatchEvent(
          new CustomEvent("twyne:citations", { detail: found }),
        );
      }
    });

    const removeCitation = $((id: string) => {
      store.citations = store.citations.filter((c) => c.id !== id);
    });

    const dropEntry = $(async (id: string) => {
      const all = await deleteBibEntry(id);
      store.bibliography = all;
    });

    const citeInDraft = $(async (entry: BibEntry) => {
      const text = footnoteCite(entry, entry.style ?? "mla");
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(
        new CustomEvent("twyne:insert-text", { detail: text }),
      );
    });

    const openEmbed = $(async (entry: BibEntry) => {
      store.embedUrl = entry.url;
      store.embedTitle = entry.title;
      store.embedMarkdown = "";
      store.embedLoading = true;
      store.embedProvider = null;
      // Lazy import to avoid a circular dep risk and to keep the panel
      // bundle lean — the fetch is via the Convex action exposed by
      // convex/research. We go through the global window so the
      // research module is the single source of truth for the action.
      try {
        const mod = await import("../../../convex/_generated/api");
        // Get the Convex client from the context via the global we
        // expose for the background watcher is too invasive; instead we
        // re-use the existing emit-and-forget pattern: the background
        // module will refresh once data is available. For now, show
        // the iframe and let the writer click "Open ↗" for the live
        // markdown preview.
        store.embedProvider = "iframe";
        void mod;
      } catch {
        store.embedProvider = null;
      } finally {
        store.embedLoading = false;
      }
    });

    const closeEmbed = $(() => {
      store.embedUrl = null;
      store.embedMarkdown = "";
      store.embedProvider = null;
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

    const getTypeAccent = (type: DetectedCitation["type"]) => {
      switch (type) {
        case "doi":
          return "var(--color-periwinkle)";
        case "url":
          return "var(--color-cobalt)";
        case "isbn":
          return "var(--color-sage)";
        case "author-year":
          return "var(--color-mustard)";
        case "footnote":
          return "var(--color-ink-muted)";
      }
    };

    const inkMix = (accent: string) =>
      `color-mix(in srgb, ${accent} 45%, var(--color-ink))`;

    const citedUrls = new Set(
      store.citations
        .map((c) => c.lookupUrl)
        .filter((u): u is string => !!u)
        .map((u) => u.replace(/\/+$/, "")),
    );

    const backgroundCount = store.bibliography.filter(
      (b) => b.provenance === "background" && b.folioId === activeFolio?.id,
    ).length;
    const writerCount = store.bibliography.filter(
      (b) => b.folioId === activeFolio?.id,
    ).length - backgroundCount;

    return (
      <div class="flex flex-col h-full bg-[var(--color-paper-2)]">
        <div class="px-5 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
          <p class="dept-label">Sources & Sourcerers</p>
          <h2
            class="mt-0.5 text-xl text-[var(--color-ink)]"
            style="font-family: var(--font-display); font-weight: 600;"
          >
            The Apparatus
          </h2>
          <div class="flex items-center justify-between mt-2">
            <p
              class="text-[11px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter);"
            >
              {backgroundCount} found by agents · {writerCount} saved
            </p>
            <Link
              href="/apparatus"
              class="text-[0.65rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:text-[var(--color-crimson)] transition-colors"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Open the full Apparatus →
            </Link>
          </div>
        </div>

        {/* Background-agent status — passive, no click required */}
        <div
          class="px-4 py-2.5 border-b border-[var(--color-paper-3)] flex items-center gap-2.5"
          style="background: var(--color-paper-2);"
        >
          <span
            class={`inline-block w-2 h-2 rounded-full ${
              store.research.status === "running"
                ? "animate-pulse"
                : store.research.status === "error"
                  ? ""
                  : ""
            }`}
            style={{
              background:
                store.research.status === "running"
                  ? "var(--color-mustard)"
                  : store.research.status === "saving"
                    ? "var(--color-cobalt)"
                    : store.research.status === "error"
                      ? "var(--color-vermilion)"
                      : "var(--color-accent-green)",
            }}
            aria-hidden="true"
          />
          <div class="flex-1 min-w-0">
            <p
              class="text-[0.65rem] text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              {store.research.status === "running" && "Apparatus is searching…"}
              {store.research.status === "saving" && "Saving discovered sources…"}
              {store.research.status === "error" && "Apparatus is offline."}
              {store.research.status === "idle" &&
                (backgroundCount > 0
                  ? `Agents are watching — ${backgroundCount} source${backgroundCount === 1 ? "" : "s"} on file.`
                  : "Agents are watching your draft.")}
            </p>
            {store.research.lastQuery && (
              <p
                class="text-[0.6rem] text-[var(--color-ink-muted)] truncate"
                style={{ fontFamily: "var(--font-typewriter)" }}
                title={store.research.lastQuery}
              >
                last query: {store.research.lastQuery}
              </p>
            )}
          </div>
        </div>

        {/* Transient toast when background agents save new sources */}
        {store.lastBackgroundSave && (
          <div
            class="mx-3 mt-3 px-3 py-2 border"
            style={{
              borderColor: "var(--color-mustard)",
              background: "rgba(212, 160, 23, 0.08)",
              borderRadius: "2px",
            }}
            role="status"
          >
            <p
              class="text-xs text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>
                Apparatus found{" "}
                {store.lastBackgroundSave.saved === 1
                  ? "a source"
                  : `${store.lastBackgroundSave.saved} sources`}
              </span>{" "}
              for your draft.
            </p>
            <p
              class="text-[0.6rem] text-[var(--color-ink-muted)] mt-0.5"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              from: {store.lastBackgroundSave.query}
            </p>
          </div>
        )}

        <div class="flex-1 overflow-y-auto">
          {store.bibliography.length === 0 && store.citations.length === 0 && (
            <div class="text-center py-10 px-6">
              <p
                class="text-3xl"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-periwinkle)",
                }}
              >
                ❧
              </p>
              <p
                class="mt-3 text-sm text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
              >
                The agents are reading your draft.
              </p>
              <p
                class="mt-1.5 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] leading-5"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Sources will appear here as they're discovered.
              </p>
            </div>
          )}

          {store.bibliography.length > 0 && (
            <div class="px-4 pt-4 pb-2 flex items-center justify-between">
              <p class="dept-label">Saved Bibliography</p>
              <LinkButton href="/apparatus" label="Expand ↗" />
            </div>
          )}
          {store.bibliography
            .filter((b) => b.folioId === activeFolio?.id || !b.folioId)
            .map((entry) => {
              const isCited = citedUrls.has(entry.url.replace(/\/+$/, ""));
              const isBackground = entry.provenance === "background";
              return (
                <div
                  key={entry.id}
                  class="px-4 py-3 mx-3 mb-2 bg-[var(--color-paper)] border border-[var(--color-paper-3)]"
                  style="border-radius: 2px;"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <p
                          class="text-sm text-[var(--color-ink)] leading-snug"
                          style={{
                            fontFamily: "var(--font-display)",
                            fontWeight: 600,
                          }}
                        >
                          {entry.title}
                        </p>
                        {isBackground && (
                          <span
                            class="text-[0.55rem] tracking-[0.15em] uppercase px-1 py-0.5"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              color: "var(--color-mustard)",
                              border: "1px solid var(--color-mustard)",
                              borderRadius: "1px",
                            }}
                          >
                            agent
                          </span>
                        )}
                        {isCited && (
                          <span
                            class="text-[0.55rem] tracking-[0.15em] uppercase px-1 py-0.5"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              color: "var(--color-accent-green)",
                              border: "1px solid var(--color-accent-green)",
                              borderRadius: "1px",
                            }}
                          >
                            cited
                          </span>
                        )}
                      </div>
                      <p
                        class="text-[10px] text-[var(--color-ink-muted)] mt-0.5 break-all"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {entry.url}
                      </p>
                      <p
                        class="text-xs text-[var(--color-ink-light)] mt-1.5 leading-5"
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        {formatCitation(entry, entry.style ?? "mla")}
                      </p>
                      {isBackground && entry.backgroundQuery && (
                        <p
                          class="text-[0.6rem] text-[var(--color-ink-muted)] mt-1 italic"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          why: {entry.backgroundQuery.slice(0, 100)}
                          {entry.backgroundQuery.length > 100 ? "…" : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div class="mt-2 flex items-center gap-2 flex-wrap">
                    <button
                      onClick$={() => citeInDraft(entry)}
                      class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-vermilion)] hover:text-[var(--color-vermilion-2)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      ✎ cite in draft
                    </button>
                    <button
                      onClick$={() => openEmbed(entry)}
                      class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      ⌖ open
                    </button>
                    <button
                      onClick$={() => dropEntry(entry.id)}
                      class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}

          {store.citations.length > 0 && (
            <div class="px-4 pt-5 pb-2 flex items-center justify-between">
              <p class="dept-label">Detected in the manuscript</p>
              <button
                onClick$={scanNow}
                class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                style="font-family: var(--font-typewriter);"
              >
                ↻ re-scan
              </button>
            </div>
          )}
          {store.citations.map((citation, idx) => {
            const accent = getTypeAccent(citation.type);
            return (
              <div
                key={citation.id}
                class="px-4 py-3 mx-3 mb-2 bg-[var(--color-paper)] border border-[var(--color-paper-3)] hover:bg-[var(--color-paper-soft)] transition-colors"
                style="border-radius: 2px;"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span
                        class="text-[10px] tracking-[0.18em] uppercase"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: "var(--color-ink-muted)",
                        }}
                      >
                        №{String(idx + 1).padStart(2, "0")}
                      </span>
                      <span
                        class="text-[10px] tracking-[0.16em] uppercase px-1.5 py-0.5"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: inkMix(accent),
                          border: `1px solid ${accent}`,
                          borderRadius: "2px",
                        }}
                      >
                        {getTypeLabel(citation.type)}
                      </span>
                    </div>
                    <p
                      class="text-xs text-[var(--color-ink)] break-all"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {citation.text}
                    </p>
                    {store.expandedId === citation.id && citation.metadata && (
                      <div class="mt-2 space-y-1 pl-2 border-l border-dashed border-[var(--color-paper-3)]">
                        {Object.entries(citation.metadata).map(([_key, val]) => (
                          <p
                            key={_key}
                            class="text-xs text-[var(--color-ink-muted)]"
                            style={{ fontFamily: "var(--font-serif)" }}
                          >
                            <span class="dept-label not-italic">{_key}</span>{" "}
                            {val}
                          </p>
                        ))}
                      </div>
                    )}
                    {citation.lookupUrl && (
                      <a
                        href={citation.lookupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1 mt-2 text-[11px] tracking-[0.16em] uppercase hover:text-[var(--color-vermilion)] focus-ring"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: inkMix(accent),
                        }}
                      >
                        Look up ↗
                      </a>
                    )}
                  </div>
                  <div class="flex items-center gap-1 ml-1 flex-shrink-0">
                    <button
                      onClick$={() => {
                        store.expandedId =
                          store.expandedId === citation.id ? null : citation.id;
                      }}
                      class="icon-btn text-xs"
                      aria-expanded={store.expandedId === citation.id}
                      aria-label={`Details for entry ${idx + 1}`}
                    >
                      {store.expandedId === citation.id ? "▾" : "▸"}
                    </button>
                    <button
                      onClick$={() => removeCitation(citation.id)}
                      class="icon-btn text-xs hover:text-[var(--color-vermilion)]"
                      aria-label={`Remove entry ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Embed overlay */}
          {store.embedUrl && (
            <div
              class="fixed inset-0 z-50 flex items-center justify-center p-6"
              style="background: rgba(20, 16, 10, 0.55);"
              role="dialog"
              aria-label={`Preview: ${store.embedTitle}`}
              onClick$={closeEmbed}
            >
              <div
                class="bg-[var(--color-paper)] border border-[var(--color-paper-3)] w-full max-w-3xl max-h-[85vh] flex flex-col"
                style="border-radius: 2px;"
                onClick$={(e) => e.stopPropagation()}
              >
                <div class="px-5 py-3 border-b border-[var(--color-paper-3)] flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p
                      class="text-sm text-[var(--color-ink)] truncate"
                      style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                    >
                      {store.embedTitle}
                    </p>
                    <p
                      class="text-[0.6rem] text-[var(--color-ink-muted)] truncate"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {store.embedUrl}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <a
                      href={store.embedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      Open ↗
                    </a>
                    <button
                      onClick$={closeEmbed}
                      class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div class="flex-1 overflow-auto p-5">
                  {store.embedLoading ? (
                    <p
                      class="text-xs text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Loading…
                    </p>
                  ) : (
                    <iframe
                      src={store.embedUrl}
                      title={store.embedTitle}
                      class="w-full h-[60vh] border border-[var(--color-paper-3)]"
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  )}
                </div>
                {store.embedProvider && (
                  <p
                    class="px-5 py-2 border-t border-[var(--color-paper-3)] text-[0.6rem] text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter); letter-spacing: 0.1em;"
                  >
                    via {store.embedProvider}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);

const LinkButton = component$<{ href: string; label: string }>((p) => {
  return (
    <Link
      href={p.href}
      class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] border border-[var(--color-paper-3)] px-2 py-1"
      style="font-family: var(--font-typewriter); border-radius: 2px;"
    >
      {p.label}
    </Link>
  );
});
