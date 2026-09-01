import { component$, useStore, $, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type {
  AiSettings,
  CitationInsertionDetail,
  CitationInsertionResult,
  DetectedCitation,
  Folio,
} from "../../types";
import { detectCitations } from "../../utils/citations";
import {
  type BibEntry,
  type CitationStyle,
  buildBibEntryFromFormattedCitation,
  bibliographyForFolio,
  loadBibliographyForFolio,
  deleteBibEntry,
  formatCitation,
  footnoteCite,
  mergeBibEntry,
  upsertBibEntry,
} from "../../utils/bibliography";
import {
  retryBackgroundResearch,
  retryResearchTarget,
  snapshot as researchSnapshot,
  type ResearchActivityEntry,
  type ResearchProgressItem,
} from "../../utils/background-research";
import { targetKindLabel } from "../../utils/research-targets";
import {
  loadAiSettingsFromIdb,
  loadApparatusSettingsFromIdb,
  saveApparatusSettingsToIdb,
} from "../../utils/idb";
import {
  hasConfiguredAiProvider,
  runClientCitationFormat,
} from "../../utils/ai-client";

interface CitationsStore {
  citations: DetectedCitation[];
  expandedId: string | null;
  lastScanCount: number | null;
  bibliography: BibEntry[];
  style: CitationStyle;
  embedUrl: string | null;
  embedMarkdown: string | null;
  embedTitle: string;
  embedProvider: string | null;
  embedLoading: boolean;
  /** Live status from the background-research module. */
  research: {
    status: "idle" | "running" | "saving" | "error";
    phase: string;
    passActive: boolean;
    lastQuery: string;
    lastQueryAt: number;
    savedThisSession: number;
    lastTickAt: number;
    error?: string;
    /** Claims being researched right now (or the last pass). */
    progress: ResearchProgressItem[];
    /** Recently-settled claims, newest first. */
    activity: ResearchActivityEntry[];
  };
  /** The most recent background-saved entry, used for a transient toast. */
  lastBackgroundSave: { saved: number; query: string } | null;
  aiSettings: AiSettings | null;
  aiEnhanceCitations: boolean;
  autoInsertFootnotes: boolean;
  autoFormatting: boolean;
  /** Track which detected citations are being formatted/saved. */
  formattingIds: Record<string, boolean>;
  /** Citations already added to the bibliography (by citation id). */
  addedIds: Record<string, boolean>;
  pendingInsertions: Record<string, boolean>;
  citationNotice: string | null;
  signalCollapsed: boolean;
  deepTraceCollapsed: boolean;
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
      style: "mla",
      embedUrl: null,
      embedMarkdown: null,
      embedTitle: "",
      embedProvider: null,
      embedLoading: false,
      research: {
        status: "idle",
        phase: "idle",
        passActive: false,
        lastQuery: "",
        lastQueryAt: 0,
        savedThisSession: 0,
        lastTickAt: 0,
        progress: [],
        activity: [],
      },
      lastBackgroundSave: null,
      aiSettings: null,
      aiEnhanceCitations: false,
      autoInsertFootnotes: false,
      autoFormatting: false,
      formattingIds: {},
      addedIds: {},
      pendingInsertions: {},
      citationNotice: null,
      signalCollapsed: false,
      deepTraceCollapsed: false,
    });

    const requestCitationInsertion = $(
      (entry: BibEntry, allowSelectionFallback = false) => {
        if (store.pendingInsertions[entry.id] || entry.citationInsertedAt)
          return;
        store.pendingInsertions = {
          ...store.pendingInsertions,
          [entry.id]: true,
        };
        const detail: CitationInsertionDetail = {
          sourceId: entry.id,
          text: footnoteCite(entry, store.style),
          anchor: entry.target?.anchor,
          sourceUrl: entry.url || undefined,
          allowSelectionFallback,
        };
        window.dispatchEvent(
          new CustomEvent("twyne:insert-citation", { detail }),
        );
      },
    );

    const autoInsertEntries = $(async (entries: BibEntry[]) => {
      if (!store.autoInsertFootnotes || !activeFolio) return;
      for (const entry of entries) {
        if (
          entry.folioId !== activeFolio.id ||
          !entry.target?.anchor ||
          entry.citationInsertedAt
        ) {
          continue;
        }
        await requestCitationInsertion(entry, false);
      }
    });

    const autoFormatIfEnabled = $(async (citations: DetectedCitation[]) => {
      if (
        store.autoFormatting ||
        !activeFolio ||
        !store.aiSettings ||
        !store.aiEnhanceCitations ||
        !hasConfiguredAiProvider(store.aiSettings)
      ) {
        return;
      }
      store.autoFormatting = true;
      try {
        const seen = new Set(
          store.bibliography.map((entry) => entry.url.replace(/\/+$/, "")),
        );
        let all: BibEntry[] | null = null;
        for (const citation of citations.slice(0, 5)) {
          if (
            citation.lookupUrl &&
            seen.has(citation.lookupUrl.replace(/\/+$/, ""))
          ) {
            continue;
          }
          const result = await runClientCitationFormat(
            {
              rawText: citation.text,
              style: store.style,
              context: activeFolio.name,
            },
            store.aiSettings,
          );
          if (!result) continue;
          all = await mergeBibEntry(
            buildBibEntryFromFormattedCitation(
              citation,
              result,
              activeFolio.id,
            ),
          );
          if (citation.lookupUrl) {
            seen.add(citation.lookupUrl.replace(/\/+$/, ""));
          }
        }
        if (all)
          store.bibliography = bibliographyForFolio(all, activeFolio?.id);
      } finally {
        store.autoFormatting = false;
      }
    });

    const addToBibliography = $(async (citation: DetectedCitation) => {
      if (store.formattingIds[citation.id]) return;
      if (!activeFolio) return;
      store.formattingIds = { ...store.formattingIds, [citation.id]: true };
      try {
        if (store.aiSettings && hasConfiguredAiProvider(store.aiSettings)) {
          const result = await runClientCitationFormat(
            {
              rawText: citation.text,
              style: store.style,
              context: activeFolio.name,
            },
            store.aiSettings,
          );
          if (result) {
            const all = await mergeBibEntry(
              buildBibEntryFromFormattedCitation(
                citation,
                result,
                activeFolio.id,
              ),
            );
            store.bibliography = bibliographyForFolio(all, activeFolio.id);
            store.addedIds = { ...store.addedIds, [citation.id]: true };
            return;
          }
        }
        const all = await mergeBibEntry(
          buildBibEntryFromFormattedCitation(
            citation,
            { title: citation.text, url: citation.lookupUrl },
            activeFolio.id,
          ),
        );
        store.bibliography = bibliographyForFolio(all, activeFolio.id);
        store.addedIds = { ...store.addedIds, [citation.id]: true };
      } finally {
        store.formattingIds = { ...store.formattingIds, [citation.id]: false };
      }
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<DetectedCitation[]>).detail;
        const existingIds = new Set(store.citations.map((c) => c.id));
        const newCitations = detail.filter((c) => !existingIds.has(c.id));
        if (newCitations.length > 0) {
          store.citations = [...store.citations, ...newCitations];
          void autoFormatIfEnabled(newCitations);
        }
      };
      window.addEventListener("twyne:citations", handler);
      return () => window.removeEventListener("twyne:citations", handler);
    });

    // Confirm insertion before marking a bibliography source as cited. An
    // anchor may have been edited since research ran, and a failed lookup must
    // never silently drop the footnote at the current cursor.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      const handler = (event: Event) => {
        const result = (event as CustomEvent<CitationInsertionResult>).detail;
        if (!result?.sourceId) return;
        const pending = { ...store.pendingInsertions };
        delete pending[result.sourceId];
        store.pendingInsertions = pending;

        if (!result.inserted) {
          store.citationNotice =
            result.reason === "anchor-not-found"
              ? "The claim has changed. Select its current wording, then cite again."
              : "Select the passage this source supports, then cite again.";
          return;
        }

        const entry = store.bibliography.find(
          (candidate) => candidate.id === result.sourceId,
        );
        if (!entry) return;
        const updated = { ...entry, citationInsertedAt: Date.now() };
        void upsertBibEntry(updated).then((all) => {
          store.bibliography = bibliographyForFolio(all, activeFolio?.id);
        });
        store.citationNotice = "Footnote placed beside its claim.";
      };
      window.addEventListener("twyne:citation-inserted", handler);
      return () =>
        window.removeEventListener("twyne:citation-inserted", handler);
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      const [bibliography, apparatusSettings, aiSettings] = await Promise.all([
        loadBibliographyForFolio(activeFolio?.id),
        loadApparatusSettingsFromIdb(),
        loadAiSettingsFromIdb(),
      ]);
      store.bibliography = bibliography;
      store.style = apparatusSettings.defaultCitationStyle;
      store.aiEnhanceCitations = apparatusSettings.aiEnhanceCitations;
      store.autoInsertFootnotes = apparatusSettings.autoInsertFootnotes;
      store.aiSettings = aiSettings;
      if (initialCitations?.length) {
        await autoFormatIfEnabled(initialCitations);
      }
      await autoInsertEntries(bibliography);
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
          phase: s.phase,
          passActive: s.passActive,
          lastQuery: s.lastQuery,
          lastQueryAt: s.lastQueryAt,
          savedThisSession: s.savedThisSession,
          lastTickAt: s.lastTickAt,
          error: s.error,
          progress: s.progress,
          activity: s.activity,
        };
      };
      const onSources = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          saved: number;
          query: string;
        };
        if (detail.saved > 0) {
          store.lastBackgroundSave = detail;
          // Drop the toast after a few seconds.
          setTimeout(() => {
            if (store.lastBackgroundSave === detail) {
              store.lastBackgroundSave = null;
            }
          }, 6_000);
        }
        // Refresh the bibliography so newly-saved entries show up.
        void loadBibliographyForFolio(activeFolio?.id).then((entries) => {
          store.bibliography = entries;
          void autoInsertEntries(entries);
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
      const all = await deleteBibEntry(id, activeFolio?.id);
      store.bibliography = bibliographyForFolio(all, activeFolio?.id);
    });

    const citeInDraft = $(async (entry: BibEntry) => {
      const text = footnoteCite(entry, store.style);
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        /* ignore */
      }
      await requestCitationInsertion(entry, !entry.target?.anchor);
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
    const writerCount =
      store.bibliography.filter((b) => b.folioId === activeFolio?.id).length -
      backgroundCount;
    const hasResearchErrors =
      store.research.status === "error" ||
      store.research.progress.some((p) => p.status === "error");
    const researchError =
      store.research.error ||
      store.research.progress.find((item) => item.status === "error")?.error;
    const activeSearchCount = store.research.progress.filter(
      (item) => item.status === "searching" || item.status === "queued",
    ).length;

    return (
      <div class="flex flex-col h-full bg-[var(--color-paper-2)]">
        <div class="flex items-center justify-between gap-3 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-2">
          <div class="flex min-w-0 items-baseline gap-2">
            <p class="dept-label">Sources</p>
            <p class="panel-meta truncate text-[var(--color-ink-muted)]">
              {backgroundCount} agent · {writerCount} saved
            </p>
          </div>
          <Link
            href="/apparatus"
            class="panel-meta flex-shrink-0 uppercase text-[var(--color-vermilion)] hover:text-[var(--color-crimson)]"
          >
            Full view ↗
          </Link>
        </div>

        {/* Signal Desk: the calm overview. The exact calls remain one level
            down in Deep Trace so an active search is legible at a glance. */}
        <section class="apparatus-monitor-card apparatus-signal-desk">
          <header class="apparatus-monitor-card__head">
            <div class="flex min-w-0 items-center gap-2.5">
              <span
                class={[
                  "apparatus-status-dot",
                  { "animate-pulse": store.research.passActive },
                ]}
                style={{
                  background: hasResearchErrors
                    ? "var(--color-vermilion)"
                    : store.research.phase === "saving"
                      ? "var(--color-cobalt)"
                      : store.research.passActive
                        ? "var(--color-mustard)"
                        : "var(--color-accent-green)",
                }}
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="dept-label">Signal</p>
                <p
                  class="apparatus-monitor-card__summary"
                  title={hasResearchErrors ? researchError : undefined}
                >
                  {hasResearchErrors &&
                    (researchError || "Research needs attention")}
                  {!hasResearchErrors &&
                    store.research.phase === "extracting" &&
                    "Reading draft"}
                  {!hasResearchErrors &&
                    store.research.phase === "searching" &&
                    `${activeSearchCount} search${activeSearchCount === 1 ? "" : "es"}`}
                  {!hasResearchErrors &&
                    store.research.phase === "saving" &&
                    "Saving source"}
                  {!hasResearchErrors &&
                    store.research.status === "idle" &&
                    (backgroundCount > 0
                      ? `${backgroundCount} source${backgroundCount === 1 ? "" : "s"} on file`
                      : "Watching draft")}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              {hasResearchErrors && (
                <button
                  type="button"
                  onClick$={() => retryBackgroundResearch()}
                  class="apparatus-retry"
                  title="Re-run the research pass against the current draft."
                >
                  ↻ retry pass
                </button>
              )}
              <button
                type="button"
                class="apparatus-disclosure-toggle focus-ring"
                onClick$={() => {
                  store.signalCollapsed = !store.signalCollapsed;
                }}
                aria-expanded={!store.signalCollapsed}
                aria-label={
                  store.signalCollapsed
                    ? "Expand Signal Desk"
                    : "Collapse Signal Desk"
                }
              >
                {store.signalCollapsed ? "▸" : "▾"}
              </button>
            </div>
          </header>
          {!store.signalCollapsed && store.research.lastQuery && (
            <p
              class="apparatus-monitor-card__query"
              title={store.research.lastQuery}
            >
              {store.research.lastQuery}
            </p>
          )}
        </section>

        {/* Live claims — what the watcher decided needs a source, and how
            each one is resolving. Streams as the pass runs. */}
        {store.research.progress.length > 0 && (
          <section class="apparatus-monitor-card apparatus-deep-trace">
            <header class="apparatus-monitor-card__head">
              <p class="dept-label">
                Deep trace · {store.research.progress.length}
              </p>
              <button
                type="button"
                class="apparatus-disclosure-toggle focus-ring"
                onClick$={() => {
                  store.deepTraceCollapsed = !store.deepTraceCollapsed;
                }}
                aria-expanded={!store.deepTraceCollapsed}
                aria-label={
                  store.deepTraceCollapsed
                    ? "Expand Deep Trace"
                    : "Collapse Deep Trace"
                }
              >
                {store.deepTraceCollapsed ? "▸" : "▾"}
              </button>
            </header>
            {!store.deepTraceCollapsed && (
              <ul class="apparatus-trace-list">
                {store.research.progress.map((item) => {
                  const dot =
                    item.status === "searching"
                      ? {
                          background: "var(--color-mustard)",
                          animation: "pulse 1.4s ease-in-out infinite",
                        }
                      : item.status === "found"
                        ? { background: "var(--color-accent-green)" }
                        : item.status === "missed"
                          ? { background: "var(--color-ink-muted)" }
                          : { background: "var(--color-paper-3)" };
                  return (
                    <li key={item.key}>
                      <details
                        open={
                          item.status === "searching" || item.status === "error"
                        }
                      >
                        <summary>
                          <span
                            class="apparatus-status-dot"
                            style={dot}
                            aria-hidden="true"
                          />
                          <span class="apparatus-trace-list__claim">
                            <strong>{targetKindLabel(item.kind)}</strong>“
                            {item.anchor.slice(0, 90)}
                            {item.anchor.length > 90 ? "…" : ""}”
                          </span>
                          <span
                            class={`apparatus-trace-list__state apparatus-trace-list__state--${item.status}`}
                          >
                            {item.status === "searching"
                              ? "searching"
                              : item.status === "found"
                                ? `${item.count ?? 0} found`
                                : item.status === "missed"
                                  ? "no match"
                                  : item.status === "error"
                                    ? "failed"
                                    : "queued"}
                          </span>
                        </summary>
                        <div class="apparatus-trace-list__detail">
                          <p>
                            <span>Exact query</span>
                            {item.query}
                          </p>
                          {item.error && (
                            <p class="apparatus-trace-list__error">
                              <span>Error</span>
                              {item.error}
                            </p>
                          )}
                          {item.status === "error" && (
                            <button
                              type="button"
                              onClick$={() => retryResearchTarget(item.key)}
                              class="apparatus-retry"
                              title="Retry this claim only."
                            >
                              ↻ retry this search
                            </button>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

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
              class="truncate text-[0.65rem] text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
              title={store.lastBackgroundSave.query}
            >
              Saved {store.lastBackgroundSave.saved} ·{" "}
              {store.lastBackgroundSave.query}
            </p>
          </div>
        )}

        <div class="flex-1 overflow-y-auto">
          {store.bibliography.length === 0 && store.citations.length === 0 && (
            <div class="px-4 py-6 text-center">
              <p
                class="text-sm text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
              >
                Watching for claims that need sources.
              </p>
            </div>
          )}

          {store.bibliography.length > 0 && (
            <div class="px-4 pt-4 pb-2 space-y-2">
              <div class="flex items-center justify-between">
                <p class="dept-label">Sources · {store.bibliography.length}</p>
                <LinkButton href="/apparatus" label="Open ↗" />
              </div>
              <label class="flex items-center justify-between gap-3 text-[0.65rem] text-[var(--color-ink-muted)]">
                <span style={{ fontFamily: "var(--font-typewriter)" }}>
                  Auto-footnote
                </span>
                <input
                  type="checkbox"
                  checked={store.autoInsertFootnotes}
                  onChange$={async (_, el) => {
                    const settings = await loadApparatusSettingsFromIdb();
                    const next = {
                      ...settings,
                      autoInsertFootnotes: el.checked,
                    };
                    await saveApparatusSettingsToIdb(next);
                    store.autoInsertFootnotes = el.checked;
                    if (el.checked) await autoInsertEntries(store.bibliography);
                  }}
                  aria-label="Automatically insert researched sources as footnotes"
                />
              </label>
              {store.citationNotice && (
                <p
                  class="text-[0.65rem] leading-4 text-[var(--color-ink-light)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                  role="status"
                >
                  {store.citationNotice}
                </p>
              )}
            </div>
          )}
          {store.bibliography.map((entry) => {
            const isCited =
              Boolean(entry.citationInsertedAt) ||
              citedUrls.has(entry.url.replace(/\/+$/, ""));
            const isBackground = entry.provenance === "background";
            return (
              <div
                key={entry.id}
                class="desk-card slide-in mx-3 mb-2 bg-[var(--color-paper)] border border-[var(--color-paper-3)] transition-all duration-200 hover:border-[var(--color-vermilion)] hover:shadow-md page-turn"
                style={{
                  ["--card-accent" as never]: isCited
                    ? "var(--color-accent-green)"
                    : isBackground
                      ? "var(--color-mustard)"
                      : "var(--color-ink-muted)",
                }}
              >
                {/* Title against the left margin, provenance stamped
                    against the right; the URL as the byline beneath. */}
                <div class="desk-card__head">
                  <p
                    class="desk-card__name desk-card__name--wrap"
                    title={entry.title}
                  >
                    {entry.title}
                  </p>
                  {(isCited || isBackground) && (
                    <span class="desk-card__stamp">
                      {isCited ? "cited" : "agent"}
                    </span>
                  )}
                  <p class="desk-card__aside desk-card__detail">{entry.url}</p>
                </div>

                <p class="desk-card__body text-[0.8125rem]">
                  {formatCitation(entry, store.style)}
                </p>

                {isBackground && (entry.target || entry.backgroundQuery) && (
                  <div class="desk-card__quote">
                    {entry.target && (
                      <p>
                        for: “{entry.target.anchor.slice(0, 110)}
                        {entry.target.anchor.length > 110 ? "…" : ""}”
                        <span
                          class="uppercase not-italic ml-1 text-[0.6rem]"
                          style="font-family: var(--font-typewriter);"
                        >
                          · {targetKindLabel(entry.target.kind)}
                        </span>
                      </p>
                    )}
                    {entry.backgroundQuery && (
                      <p>
                        why: {entry.backgroundQuery.slice(0, 100)}
                        {entry.backgroundQuery.length > 100 ? "…" : ""}
                      </p>
                    )}
                  </div>
                )}

                <div class="desk-card__foot">
                  <div class="desk-card__foot-start">
                    <button
                      onClick$={() => citeInDraft(entry)}
                      disabled={
                        Boolean(entry.citationInsertedAt) ||
                        Boolean(store.pendingInsertions[entry.id])
                      }
                      class="card-key card-key--on"
                    >
                      {store.pendingInsertions[entry.id]
                        ? "placing…"
                        : entry.citationInsertedAt
                          ? "✓ footnoted"
                          : "✎ cite in draft"}
                    </button>
                    <button onClick$={() => openEmbed(entry)} class="card-key">
                      ⌖ open
                    </button>
                  </div>
                  <div class="desk-card__foot-end desk-card__reveal">
                    <button
                      onClick$={() => dropEntry(entry.id)}
                      class="card-key"
                      aria-label="Remove from the bibliography"
                      title="Remove from the bibliography"
                    >
                      ✕
                    </button>
                  </div>
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
            const isFormatting = !!store.formattingIds[citation.id];
            const isAdded = !!store.addedIds[citation.id];
            const hasAi =
              store.aiSettings && hasConfiguredAiProvider(store.aiSettings);
            return (
              <div
                key={citation.id}
                class="desk-card citation-card slide-in mx-3 mb-2 bg-[var(--color-paper)] border border-[var(--color-paper-3)] transition-all duration-200 hover:border-[var(--color-vermilion)] hover:shadow-md page-turn"
                style={{
                  borderLeftColor: accent,
                  borderLeftWidth: "3px",
                  ["--card-accent" as never]: inkMix(accent),
                }}
              >
                {/* The folio number rides in the gutter the way it does on
                  a printed page; the kind of source is stamped opposite. */}
                <div class="desk-card__head">
                  <span
                    class="desk-card__mark tabular-nums"
                    style="font-family: var(--font-typewriter); font-size: 0.6875rem; letter-spacing: 0.08em; color: var(--color-ink-muted);"
                  >
                    №{String(idx + 1).padStart(2, "0")}
                  </span>
                  <p class="desk-card__name desk-card__name--wrap">
                    {getTypeLabel(citation.type)}
                  </p>
                  {isAdded && (
                    <span
                      class="desk-card__stamp"
                      style="--card-accent: var(--color-accent-green);"
                    >
                      ✓ in bib
                    </span>
                  )}
                </div>

                <p class="desk-card__detail text-[var(--color-ink)]">
                  {citation.text}
                </p>

                {store.expandedId === citation.id && citation.metadata && (
                  <div class="desk-card__quote space-y-1">
                    {Object.entries(citation.metadata).map(([_key, val]) => (
                      <p key={_key} class="not-italic">
                        <span class="dept-label not-italic">{_key}</span> {val}
                      </p>
                    ))}
                  </div>
                )}

                <div class="desk-card__foot">
                  <div class="desk-card__foot-start">
                    <button
                      onClick$={() => addToBibliography(citation)}
                      disabled={isFormatting || isAdded}
                      class="card-key card-key--on"
                      title={
                        hasAi
                          ? "Format this citation with AI and add it to your bibliography."
                          : "Add this citation to your bibliography."
                      }
                    >
                      {isFormatting
                        ? "formatting…"
                        : isAdded
                          ? "✓ added"
                          : hasAi
                            ? "✦ add to bib"
                            : "+ add to bib"}
                    </button>
                    {citation.lookupUrl && (
                      <a
                        href={citation.lookupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="card-key focus-ring"
                      >
                        look up ↗
                      </a>
                    )}
                  </div>
                  <div class="desk-card__foot-end desk-card__reveal">
                    <button
                      onClick$={() => {
                        store.expandedId =
                          store.expandedId === citation.id ? null : citation.id;
                      }}
                      class="card-key"
                      aria-expanded={store.expandedId === citation.id}
                      aria-label={`Details for entry ${idx + 1}`}
                    >
                      {store.expandedId === citation.id ? "▾" : "▸"}
                    </button>
                    <button
                      onClick$={() => removeCitation(citation.id)}
                      class="card-key"
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
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                      }}
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
