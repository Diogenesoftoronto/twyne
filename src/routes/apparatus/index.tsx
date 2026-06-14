import {
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import type { DetectedCitation, Folio, ProjectBrief } from "../../types";
import { detectCitations } from "../../utils/citations";
import {
  type BibEntry,
  type CitationStyle,
  loadBibliography,
  deleteBibEntry,
  formatCitation,
  upsertBibEntry,
} from "../../utils/bibliography";
import { loadFoliosFromIdb, loadFolioContentFromIdb } from "../../utils/idb";
import { snapshot as researchSnapshot } from "../../utils/background-research";
import {
  runClientCitationFormat,
  runClientSourceSummarize,
  runClientMissingSourceDetect,
} from "../../utils/ai-client";
import { loadAiSettingsFromIdb } from "../../utils/idb";
import type { AiSettings, SourceSummarizeResult } from "../../types";

interface ApparatusStore {
  bibliography: BibEntry[];
  citations: DetectedCitation[];
  style: CitationStyle;
  activeFolio: Folio | null;
  brief: ProjectBrief | null;
  embedUrl: string | null;
  embedTitle: string;
  embedMarkdown: string | null;
  embedProvider: string | null;
  embedLoading: boolean;
  research: {
    status: "idle" | "running" | "saving" | "error";
    lastQuery: string;
    lastQueryAt: number;
    savedThisSession: number;
    lastTickAt: number;
    error?: string;
  };
  showResearchLog: boolean;
  /* ── AI-enhanced apparatus ─────────────────────────────────── */
  aiSettings: AiSettings | null;
  aiLoading: Record<string, boolean>;
  aiSummaries: Record<string, SourceSummarizeResult>;
  aiMissingSources: {
    claims: Array<{
      claim: string;
      reason: string;
      suggestedQuery: string;
    }>;
    provider: string;
  } | null;
  aiScanningMissing: boolean;
}

const STYLE_OPTIONS: ReadonlyArray<{ value: CitationStyle; label: string }> = [
  { value: "mla", label: "MLA" },
  { value: "apa", label: "APA" },
  { value: "chicago", label: "Chicago" },
];

export default component$(() => {
  const store = useStore<ApparatusStore>({
    bibliography: [],
    citations: [],
    style: "mla",
    activeFolio: null,
    brief: null,
    embedUrl: null,
    embedTitle: "",
    embedMarkdown: null,
    embedProvider: null,
    embedLoading: false,
    research: {
      status: "idle",
      lastQuery: "",
      lastQueryAt: 0,
      savedThisSession: 0,
      lastTickAt: 0,
    },
    showResearchLog: false,
    aiSettings: null,
    aiLoading: {},
    aiSummaries: {},
    aiMissingSources: null,
    aiScanningMissing: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    store.bibliography = await loadBibliography();
    const folios = await loadFoliosFromIdb();
    store.activeFolio = folios[0] ?? null;
    if (store.activeFolio) {
      const html = await loadFolioContentFromIdb(store.activeFolio.id);
      const text = html.replace(/<[^>]+>/g, " ");
      store.citations = detectCitations(text);
    }
    store.aiSettings = await loadAiSettingsFromIdb();
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const pull = () => {
      const s = researchSnapshot();
      store.research = {
        status: s.status as ApparatusStore["research"]["status"],
        lastQuery: s.lastQuery,
        lastQueryAt: s.lastQueryAt,
        savedThisSession: s.savedThisSession,
        lastTickAt: s.lastTickAt,
        error: s.error,
      };
    };
    const onSources = () => {
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

  useStylesScoped$(`
    .style-toggle {
      display: inline-flex; border: 1px solid var(--color-paper-3);
      border-radius: 2px; overflow: hidden;
    }
    .style-toggle button {
      padding: 0.2rem 0.6rem;
      font-family: var(--font-typewriter);
      font-size: 0.7rem;
      letter-spacing: 0.1em;
      background: var(--color-paper-soft);
      color: var(--color-ink-light);
    }
    .style-toggle button[aria-pressed="true"] {
      background: var(--color-vermilion);
      color: var(--color-paper);
    }
    .card {
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper);
      border-radius: 4px;
    }
    .row {
      padding: 0.85rem 1rem;
      border-bottom: 1px dashed var(--color-paper-3);
    }
    .row:last-child { border-bottom: none; }
    .empty {
      padding: 2rem 1rem;
      text-align: center;
      color: var(--color-ink-muted);
    }
    .agent-pill {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--color-mustard);
      color: var(--color-mustard);
      border-radius: 2px;
      font-family: var(--font-typewriter);
      font-size: 0.6rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .cited-pill {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--color-accent-green);
      color: var(--color-accent-green);
      border-radius: 2px;
      font-family: var(--font-typewriter);
      font-size: 0.6rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .status-dot {
      display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 999px;
    }
  `);

  const setStyle = $((s: CitationStyle) => {
    store.style = s;
  });

  const dropEntry = $(async (id: string) => {
    const all = await deleteBibEntry(id);
    store.bibliography = all;
  });

  const openEmbed = $(async (entry: BibEntry) => {
    store.embedUrl = entry.url;
    store.embedTitle = entry.title;
    store.embedMarkdown = null;
    store.embedProvider = null;
    store.embedLoading = true;
    // The Convex action lives in convex/research; the background-research
    // module is the single source of truth for the embed markdown. For now
    // we show the iframe and let the writer click "Open ↗" for the live
    // preview. The background watcher will refresh the panel once data
    // arrives.
    store.embedProvider = "iframe";
    store.embedLoading = false;
  });

  const closeEmbed = $(() => {
    store.embedUrl = null;
    store.embedMarkdown = null;
    store.embedProvider = null;
  });

  const copyAll = $(async () => {
    const text = store.bibliography
      .map((b) => formatCitation(b, store.style))
      .join("\n\n");
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
  });

  /* ── AI-enhanced apparatus actions ────────────────────────────── */

  const hasAi = store.aiSettings?.advancedMode && store.aiSettings.providers.length > 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const formatCitationAi = $(async (citation: DetectedCitation) => {
    if (!hasAi || !store.aiSettings) return;
    const key = `fmt-${citation.id}`;
    store.aiLoading = { ...store.aiLoading, [key]: true };
    try {
      const result = await runClientCitationFormat(
        { rawText: citation.text, style: store.style, context: store.activeFolio?.title },
        store.aiSettings,
      );
      if (result) {
        // Create a new BibEntry from the formatted result and save it
        const newEntry: BibEntry = {
          id: `ai-fmt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: result.title,
          author: result.author,
          year: result.year,
          url: result.url ?? citation.lookupUrl ?? "",
          doi: result.doi,
          publisher: result.publisher,
          folioId: store.activeFolio?.id ?? "",
          provenance: "writer",
          accessedAt: Date.now(),
          createdAt: Date.now(),
        };
        const all = await upsertBibEntry(newEntry);
        store.bibliography = all;
      }
    } finally {
      store.aiLoading = { ...store.aiLoading, [key]: false };
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const summarizeSourceAi = $(async (entry: BibEntry) => {
    if (!hasAi || !store.aiSettings) return;
    const key = `sum-${entry.id}`;
    store.aiLoading = { ...store.aiLoading, [key]: true };
    try {
      const result = await runClientSourceSummarize(
        { title: entry.title, url: entry.url, author: entry.author },
        store.aiSettings,
      );
      if (result) {
        store.aiSummaries = { ...store.aiSummaries, [entry.id]: result };
      }
    } finally {
      store.aiLoading = { ...store.aiLoading, [key]: false };
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const detectMissingSourcesAi = $(async () => {
    if (!hasAi || !store.aiSettings || !store.activeFolio) return;
    store.aiScanningMissing = true;
    store.aiMissingSources = null;
    try {
      const html = await loadFolioContentFromIdb(store.activeFolio.id);
      const text = html.replace(/<[^>]+>/g, " ");
      const existing = writerEntries.map((e) => e.title);
      const result = await runClientMissingSourceDetect(
        { draftText: text, existingSources: existing },
        store.aiSettings,
      );
      store.aiMissingSources = result;
    } finally {
      store.aiScanningMissing = false;
    }
  });

  const citedUrls = new Set(
    store.citations
      .map((c) => c.lookupUrl)
      .filter((u): u is string => !!u)
      .map((u) => u.replace(/\/+$/, "")),
  );

  const backgroundEntries = store.bibliography.filter(
    (b) => b.provenance === "background",
  );
  const writerEntries = store.bibliography.filter(
    (b) => b.provenance !== "background",
  );

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-5xl mx-auto px-6 py-8">
        <div class="flex items-center justify-between mb-6">
          <div>
            <p
              class="dept-label mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Twyne
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.75rem",
              }}
            >
              The Apparatus
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              Background agents are reading your draft. Sources they
              discover land here automatically.
            </p>
          </div>
          <Link
            href="/"
            class="btn-paper text-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            ← Back to desk
          </Link>
        </div>

        {/* Status card — live snapshot of the background watcher. */}
        <section class="card p-4 mb-6">
          <div class="flex items-center gap-3">
            <span
              class="status-dot"
              style={{
                background:
                  store.research.status === "running"
                    ? "var(--color-mustard)"
                    : store.research.status === "saving"
                      ? "var(--color-cobalt)"
                      : store.research.status === "error"
                        ? "var(--color-vermilion)"
                        : "var(--color-accent-green)",
                animation:
                  store.research.status === "running" || store.research.status === "saving"
                    ? "pulse 1.6s ease-in-out infinite"
                    : "none",
              }}
              aria-hidden="true"
            />
            <div class="flex-1 min-w-0">
              <p
                class="text-sm text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              >
                {store.research.status === "running" && "Apparatus is searching…"}
                {store.research.status === "saving" && "Saving discovered sources…"}
                {store.research.status === "error" &&
                  "Apparatus is offline — sources will resume when the connection is back."}
                {store.research.status === "idle" &&
                  (backgroundEntries.length > 0
                    ? `Agents are watching — ${backgroundEntries.length} source${backgroundEntries.length === 1 ? "" : "s"} found so far.`
                    : "Agents are watching your draft. Sources will appear as they are found.")}
              </p>
              {store.research.lastQuery ? (
                <p
                  class="text-[0.7rem] text-[var(--color-ink-muted)] mt-0.5 truncate"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                  title={store.research.lastQuery}
                >
                  last query: {store.research.lastQuery}
                </p>
              ) : (
                <p
                  class="text-[0.7rem] text-[var(--color-ink-muted)] mt-0.5"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  The query is derived from your brief and the current draft.
                </p>
              )}
            </div>
            <div
              class="text-right"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <p class="text-2xl text-[var(--color-vermilion)] leading-none">
                {backgroundEntries.length}
              </p>
              <p
                class="text-[0.55rem] text-[var(--color-ink-muted)] uppercase tracking-[0.15em] mt-1"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                found
              </p>
            </div>
          </div>
          {store.research.error && (
            <p
              class="text-[0.7rem] text-[var(--color-vermilion)] mt-2"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              {store.research.error}
            </p>
          )}
        </section>

        <div class="grid lg:grid-cols-[1fr_1.4fr] gap-6">
          {/* Left: sources found by the agents. */}
          <section>
            <h2
              class="text-base font-semibold mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Found by the agents
            </h2>
            <div class="card">
              {backgroundEntries.length === 0 ? (
                <div class="empty">
                  <p
                    class="text-3xl"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-mustard)",
                    }}
                  >
                    ✦
                  </p>
                  <p class="text-sm mt-2 italic">
                    {store.activeFolio
                      ? "The agents are reading. Sources will appear as they're discovered."
                      : "No active folio to read."}
                  </p>
                </div>
              ) : (
                backgroundEntries.map((entry) => {
                  const isCited = citedUrls.has(
                    entry.url.replace(/\/+$/, ""),
                  );
                  return (
                    <div key={entry.id} class="row">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2 mb-1 flex-wrap">
                            <p
                              class="text-sm text-[var(--color-ink)]"
                              style={{
                                fontFamily: "var(--font-display)",
                                fontWeight: 600,
                              }}
                            >
                              {entry.title}
                            </p>
                            <span class="agent-pill">agent</span>
                            {isCited && <span class="cited-pill">cited</span>}
                          </div>
                          <p
                            class="text-[0.65rem] text-[var(--color-ink-muted)] mt-0.5 break-all"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {entry.url}
                          </p>
                          <p
                            class="text-xs text-[var(--color-ink-light)] mt-1.5 leading-5"
                            style={{ fontFamily: "var(--font-serif)" }}
                          >
                            {formatCitation(entry, store.style)}
                          </p>
                          {entry.backgroundQuery && (
                            <p
                              class="text-[0.6rem] text-[var(--color-ink-muted)] mt-1 italic"
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              why:{" "}
                              {entry.backgroundQuery.length > 140
                                ? entry.backgroundQuery.slice(0, 140) + "…"
                                : entry.backgroundQuery}
                            </p>
                          )}
                        </div>
                      </div>
                      <div class="mt-2 flex items-center gap-2 flex-wrap">
                        <button
                          onClick$={() => openEmbed(entry)}
                          class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                          style="font-family: var(--font-typewriter);"
                        >
                          ⌖ open
                        </button>
                        <button
                          onClick$={() => dropEntry(entry.id)}
                          class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                          style="font-family: var(--font-typewriter);"
                        >
                          ✕ drop
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right: writer's bibliography + cross-reference. */}
          <section>
            <div class="flex items-center justify-between mb-2">
              <h2
                class="text-base font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Your bibliography
              </h2>
              <div class="flex items-center gap-3">
                <div class="style-toggle" role="group" aria-label="Citation style">
                  {STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      onClick$={() => setStyle(s.value)}
                      aria-pressed={store.style === s.value}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick$={copyAll}
                  class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Copy all
                </button>
              </div>
            </div>
            <div class="card mb-4">
              {writerEntries.length === 0 ? (
                <div class="empty">
                  <p
                    class="text-3xl"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-cobalt)",
                    }}
                  >
                    ✎
                  </p>
                  <p class="text-sm mt-2 italic">
                    Nothing you've saved yet. The agents will keep working in
                    the background.
                  </p>
                </div>
              ) : (
                writerEntries.map((entry) => {
                  const isCited = citedUrls.has(
                    entry.url.replace(/\/+$/, ""),
                  );
                  return (
                    <div key={entry.id} class="row">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0 flex-1">
                          <p
                            class="text-sm text-[var(--color-ink)]"
                            style={{
                              fontFamily: "var(--font-display)",
                              fontWeight: 600,
                            }}
                          >
                            {entry.title}
                          </p>
                          <p
                            class="text-[0.65rem] text-[var(--color-ink-muted)] mt-0.5 break-all"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {entry.url}
                          </p>
                          <p
                            class="text-xs text-[var(--color-ink-light)] mt-1.5 leading-5"
                            style={{ fontFamily: "var(--font-serif)" }}
                          >
                            {formatCitation(entry, store.style)}
                          </p>
                          {isCited && (
                            <span class="cited-pill mt-1.5 inline-block">
                              cited in draft
                            </span>
                          )}
                        </div>
                      </div>
                      <div class="mt-2 flex items-center gap-2 flex-wrap">
                        <button
                          onClick$={() => dropEntry(entry.id)}
                          class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                          style="font-family: var(--font-typewriter);"
                        >
                          ✕ drop
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <h2
              class="text-base font-semibold mb-2"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Detected in the manuscript
            </h2>
            <div class="card">
              {store.citations.length === 0 ? (
                <div class="empty">
                  <p class="text-xs italic">
                    {store.activeFolio
                      ? "No DOI / URL / ISBN / author-year citations detected yet — keep writing."
                      : "No active folio to scan."}
                  </p>
                </div>
              ) : (
                store.citations.map((c) => (
                  <div key={c.id} class="row">
                    <p
                      class="text-xs text-[var(--color-ink)] break-all"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {c.text}
                    </p>
                    <p
                      class="text-[0.6rem] text-[var(--color-ink-muted)] mt-0.5"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      {c.type}
                      {c.lookupUrl ? (
                        <>
                          {" · "}
                          <a
                            href={c.lookupUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="hover:text-[var(--color-accent)]"
                          >
                            look up ↗
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

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
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Apparatus · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Background research + bibliography for the Twyne writer. Discover sources, save what is useful, cite without breaking flow.",
    },
  ],
};
