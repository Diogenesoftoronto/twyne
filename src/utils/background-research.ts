/**
 * Background agents — the Apparatus runs in the background, watching the
 * draft and surfacing sources without the writer having to ask. The model
 * is intentionally simple:
 *
 *   1. Watch the active folio for content changes (debounced, 45s).
 *   2. Derive a research query from the brief + the current draft.
 *   3. Skip the call if the same query was run recently (cache).
 *   4. Call the search provider, merge the top results into the bibliography
 *      with `provenance: "background"` so the panel can tell who found them.
 *   5. Emit `twyne:background-research` so the UI can show what is happening.
 *
 * The Convex client and a brief are required. When the client is absent
 * (offline) the watcher is a no-op — the writer will still see their
 * manually-saved sources.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Source } from "../../convex/research";
import type { ApparatusSettings, ProjectBrief } from "../types";
import { loadAiSettingsFromIdb, loadApparatusSettingsFromIdb } from "./idb";
import { runClientResearchWebSearch } from "./ai-client";
import {
  type BibEntry,
  loadBibliography,
  saveBibliography,
  normalizeUrl,
} from "./bibliography";

const DEBOUNCE_MS = 45_000;
const QUERY_CACHE_TTL_MS = 5 * 60_000; // re-run same query at most every 5m
const MAX_BACKGROUND_PER_FOLIO = 25; // soft cap so the bib doesn't grow forever
const SNIPPET_MIN_CHARS = 60; // skip throwaway stubs

interface ResearchState {
  lastQuery: string;
  lastQueryAt: number;
  /** Total background saves this session. */
  savedThisSession: number;
  /** Last "now researching" indicator. */
  lastTickAt: number;
  lastProvider?: string;
  lastStatus: "idle" | "running" | "saving" | "error";
  lastError?: string;
}

const state: ResearchState = {
  lastQuery: "",
  lastQueryAt: 0,
  savedThisSession: 0,
  lastTickAt: 0,
  lastStatus: "idle",
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeClient: ConvexClient | null = null;
let activeBrief: ProjectBrief | null = null;
let activeFolioId: string | null = null;

function setStatus(status: ResearchState["lastStatus"], error?: string): void {
  state.lastStatus = status;
  state.lastTickAt = Date.now();
  if (error) state.lastError = error;
  notify();
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("twyne:background-research", { detail: snapshot() }),
  );
}

export function snapshot() {
  return {
    lastQuery: state.lastQuery,
    lastQueryAt: state.lastQueryAt,
    savedThisSession: state.savedThisSession,
    lastTickAt: state.lastTickAt,
    status: state.lastStatus,
    error: state.lastError,
    activeFolioId,
    provider: state.lastProvider,
  };
}

/** Derive a research query from the brief + current draft. */
export function deriveQuery(
  brief: ProjectBrief | null,
  draftText: string,
): string {
  const a = brief?.answers;
  const fragments: string[] = [];
  if (a?.workingTitle) fragments.push(a.workingTitle);
  if (a?.audience) fragments.push(`for ${a.audience}`);
  if (a?.goal) fragments.push(a.goal);
  if (a?.tone) fragments.push(`tone: ${a.tone}`);
  if (a?.format) fragments.push(`format: ${a.format}`);
  const trimmed = draftText.trim().slice(0, 280);
  if (trimmed) fragments.push(trimmed);
  return fragments.join(" · ").trim();
}

/** Hash a query to dedupe. */
function hashQuery(q: string): string {
  // Cheap FNV-1a — we don't need crypto, just stable identity.
  let h = 0x811c9dc5;
  for (let i = 0; i < q.length; i++) {
    h ^= q.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function sameAsRecent(q: string): boolean {
  return (
    hashQuery(q) === hashQuery(state.lastQuery) &&
    Date.now() - state.lastQueryAt < QUERY_CACHE_TTL_MS
  );
}

/** Stop any pending or running work. */
export function stopBackgroundResearch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  setStatus("idle");
}

/** Configure the research watcher. Safe to call repeatedly — the latest
 *  args win. */
export function startBackgroundResearch(args: {
  client: ConvexClient | null;
  brief: ProjectBrief | null;
  folioId: string | null;
}): void {
  activeClient = args.client;
  activeBrief = args.brief;
  activeFolioId = args.folioId;
  // No client = no remote research; mark idle but still emit a tick so
  // the UI knows we're listening.
  setStatus(activeClient ? "idle" : "idle");
}

/** Re-run research now (used on folio switch and on initial load). */
export function kickBackgroundResearch(draftText: string): void {
  if (!activeFolioId) return;
  schedule(draftText, 0);
}

/** Notify the watcher that the draft has changed. Debounced. */
export function onDraftChanged(draftText: string): void {
  if (!activeFolioId) return;
  schedule(draftText, DEBOUNCE_MS);
}

function schedule(draftText: string, delay: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runOnce(draftText);
  }, delay);
}

async function runOnce(draftText: string): Promise<void> {
  if (!activeClient || !activeFolioId) return;
  const query = deriveQuery(activeBrief, draftText);
  if (!query || query.length < 20) return; // too thin to be useful
  if (sameAsRecent(query)) return;

  state.lastQuery = query;
  state.lastQueryAt = Date.now();
  setStatus("running");
  notify();

  try {
    const context = activeBrief
      ? `${activeBrief.answers.audience ?? ""} · ${activeBrief.answers.goal ?? ""}`.trim()
      : undefined;
    const apparatusSettings = await loadApparatusSettingsFromIdb();
    const configured = await searchWithConfiguredProvider(
      query,
      context,
      apparatusSettings,
    );
    const res =
      configured ??
      ((activeClient
        ? await activeClient.action(api.research.searchSources, {
            query,
            context,
          })
        : { results: [], provider: "offline" }) as {
        results: Source[];
        provider: string;
      });
    state.lastProvider = res.provider;
    setStatus("saving");
    await persist(res.results ?? [], query);
    setStatus("idle");
  } catch (err) {
    setStatus("error", (err as Error).message);
  }
}

const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai/v1/search";

async function searchWithConfiguredProvider(
  query: string,
  context: string | undefined,
  settings: ApparatusSettings,
): Promise<{ results: Source[]; provider: string } | null> {
  switch (settings.researchProvider) {
    case "tinyfish":
      return searchTinyFishInBrowser(query, context, settings);
    case "model-web-search":
      return searchModelEndpoint(query, context, settings);
    case "web-mcp":
      return searchWebMcp(query, context, settings);
    case "hosted":
    default:
      return null;
  }
}

async function searchTinyFishInBrowser(
  query: string,
  context: string | undefined,
  settings: ApparatusSettings,
): Promise<{ results: Source[]; provider: string } | null> {
  const key = settings.tinyFishApiKey.trim();
  if (!key) return null;
  try {
    const res = await fetch(TINYFISH_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        context: context ?? "",
        num_results: settings.tinyFishMaxResults,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: unknown };
    const results = normalizeSources(data.results, settings.tinyFishMaxResults);
    return results.length ? { results, provider: "tinyfish:byok" } : null;
  } catch {
    return null;
  }
}

async function searchModelEndpoint(
  query: string,
  context: string | undefined,
  settings: ApparatusSettings,
): Promise<{ results: Source[]; provider: string } | null> {
  const aiSettings = await loadAiSettingsFromIdb();
  if (!aiSettings) return null;
  return runClientResearchWebSearch(
    {
      query,
      context,
      maxResults: settings.tinyFishMaxResults,
      instructions:
        "If the selected provider exposes a web-search tool or model-native search mode, use it before answering.",
    },
    aiSettings,
  );
}

async function searchWebMcp(
  query: string,
  context: string | undefined,
  settings: ApparatusSettings,
): Promise<{ results: Source[]; provider: string } | null> {
  const endpoint = settings.mcpEndpointUrl.trim();
  const toolName = settings.mcpToolName.trim() || "search";
  if (!endpoint) return null;
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const token = settings.mcpBearerToken.trim();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `twyne-${Date.now()}`,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: {
            query,
            context,
            max_results: settings.tinyFishMaxResults,
          },
        },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = normalizeMcpSources(data, settings.tinyFishMaxResults);
    return results.length ? { results, provider: `mcp:${toolName}` } : null;
  } catch {
    return null;
  }
}

function normalizeMcpSources(value: unknown, maxResults: number): Source[] {
  const direct = normalizeSources(value, maxResults);
  if (direct.length) return direct;
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  for (const key of ["results", "sources", "data"]) {
    const fromKey = normalizeSources(rec[key], maxResults);
    if (fromKey.length) return fromKey;
  }
  const result = rec.result;
  if (result && typeof result === "object") {
    const fromResult = normalizeMcpSources(result, maxResults);
    if (fromResult.length) return fromResult;
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const text = (item as Record<string, unknown>).text;
        if (typeof text !== "string") continue;
        try {
          const parsed = JSON.parse(text);
          const fromText = normalizeMcpSources(parsed, maxResults);
          if (fromText.length) return fromText;
        } catch {
          // Ignore non-JSON text content.
        }
      }
    }
  }
  return [];
}

function normalizeSources(value: unknown, maxResults: number): Source[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      const url = typeof rec.url === "string" ? rec.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) return null;
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      const source: Source = {
        title: title || url,
        url,
        snippet:
          typeof rec.snippet === "string" && rec.snippet.trim()
            ? rec.snippet.trim()
            : typeof rec.summary === "string" && rec.summary.trim()
              ? rec.summary.trim()
              : "Source returned by the configured research provider.",
      };
      if (typeof rec.author === "string" && rec.author.trim()) {
        source.author = rec.author.trim();
      }
      if (typeof rec.publisher === "string" && rec.publisher.trim()) {
        source.publisher = rec.publisher.trim();
      }
      if (typeof rec.date === "string" && rec.date.trim()) {
        source.date = rec.date.trim();
      }
      if (typeof rec.why === "string" && rec.why.trim()) {
        source.why = rec.why.trim();
      }
      return source;
    })
    .filter((source): source is Source => source !== null)
    .slice(0, maxResults);
}

async function persist(results: Source[], query: string): Promise<void> {
  if (!activeFolioId) return;
  const all = await loadBibliography();
  const seen = new Set(
    all
      .filter((e) => e.folioId === activeFolioId)
      .map((e) => normalizeUrl(e.url)),
  );
  // Soft cap so a long session doesn't grow the bib unbounded.
  const existingBgForFolio = all.filter(
    (e) => e.folioId === activeFolioId && e.provenance === "background",
  ).length;
  let budget = Math.max(0, MAX_BACKGROUND_PER_FOLIO - existingBgForFolio);
  let saved = 0;

  for (const src of results) {
    if (budget <= 0) break;
    if (!src.url) continue;
    if (seen.has(normalizeUrl(src.url))) continue;
    if ((src.snippet?.length ?? 0) < SNIPPET_MIN_CHARS) continue;
    const entry: BibEntry = {
      id: crypto.randomUUID(),
      folioId: activeFolioId,
      title: src.title || src.url,
      author: src.author,
      publisher: src.publisher,
      date: src.date,
      url: src.url,
      accessedAt: Date.now(),
      snippet: src.snippet,
      why: src.why,
      provenance: "background",
      backgroundQuery: query,
      accepted: false,
    };
    all.push(entry);
    seen.add(normalizeUrl(src.url));
    saved += 1;
    budget -= 1;
  }
  if (saved > 0) {
    await saveBibliography(all);
    state.savedThisSession += saved;
    // Surface a passive "found N sources" event for the UI.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("twyne:background-sources", {
          detail: { saved, query, folioId: activeFolioId },
        }),
      );
    }
  }
  notify();
}
