/**
 * Background agents — the Apparatus runs in the background, watching the
 * draft and building an automatic bibliography without the writer having to
 * ask. The model is intentionally simple:
 *
 *   1. Watch the active folio for content changes (debounced).
 *   2. Hand the draft to the writer's AI model, which decides what genuinely
 *      needs a source: a quote to attribute, a named film or book, a
 *      statistic, a checkable claim. Each becomes a ResearchTarget carrying
 *      its own precise search query.
 *   3. Skip targets whose passage already has a saved source or was
 *      researched recently (dedupe), cap the pass at a few targets.
 *   4. Resolve each target through the configured research provider, one
 *      query at a time, and merge the best hit into the bibliography with
 *      `provenance: "background"` so the panel can tell who found them.
 *   5. Stream the pass live: every state change (extract → per-claim search
 *      → save → outcome) updates an in-memory ledger that `snapshot()` hands
 *      to the UI, and each saved claim fires its own `twyne:background-sources`
 *      event so the panel can show sources as they land, not in a lump.
 *
 * The Convex client, a research provider, and an AI model are all required.
 * Missing any of those, the watcher stays a no-op — the writer still sees
 * their manually-saved sources.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Source } from "../../convex/research";
import type {
  ApparatusSettings,
  ProjectBrief,
  ResearchTarget,
  ResearchTargetKind,
  ResearchTargetRef,
} from "../types";
import {
  hasConfiguredAiProvider,
  runClientResearchExtract,
  runClientResearchWebSearch,
} from "./ai-client";
import { searchMcpServers, setMcpConvexClient } from "./mcp-research";
import { runSearchBackend, searchBackend } from "./research-backends";
import { loadAiSettingsFromIdb, loadApparatusSettingsFromIdb } from "./idb";
import {
  type BibEntry,
  loadBibliography,
  saveBibliography,
  normalizeUrl,
} from "./bibliography";
import {
  DEFAULT_TARGETS_PER_PASS,
  buildDossierResearchInstructions,
  buildResearchSearchContext,
  buildResearchSearchInstructions,
  directedResearchTarget,
  selectFreshTargets,
  targetKey,
  rankSourcesForTarget,
  type DirectedResearchTargetInput,
} from "./research-targets";

const DEBOUNCE_MS = 45_000;
const PASS_TTL_MS = 5 * 60_000; // don't chase the same set of claims every pass
const MAX_BACKGROUND_PER_FOLIO = 25; // soft cap so the bib doesn't grow forever
const SNIPPET_MIN_CHARS = 40; // skip throwaway stubs
const MIN_DRAFT_CHARS = 120; // too thin to bother an AI
// The signed-in free hosted tier permits five searches per minute. Extraction
// can queue more targets, but one immediate pass must not make the sixth fail.
const MAX_TARGETS_PER_PASS = 5;

interface ResearchState {
  lastQuery: string;
  lastQueryAt: number;
  savedThisSession: number;
  lastTickAt: number;
  lastProvider?: string;
  lastStatus: "idle" | "running" | "saving" | "error";
  lastError?: string;
  /** What the watcher is doing right now, for an observable headline. */
  phase: "idle" | "extracting" | "searching" | "saving" | "error";
}

export type ResearchTargetStatus =
  | "queued"
  | "searching"
  | "found"
  | "missed"
  | "error";

/** One claim the watcher decided needs a source — the live row in the panel. */
export interface ResearchProgressItem {
  key: string;
  kind: string;
  anchor: string;
  query: string;
  status: ResearchTargetStatus;
  /** How many sources were saved when status is "found". */
  count?: number;
  /** Human-readable reason when the claim hit an error. */
  error?: string;
  at?: number;
}

/** A settlement: the claim matched sources, came back bare, or failed loudly. */
export interface ResearchActivityEntry {
  id: string;
  at: number;
  kind: string;
  anchor: string;
  query: string;
  outcome: "found" | "missed" | "error";
  count: number;
  error?: string;
}

interface ResearchSnapshot {
  lastQuery: string;
  lastQueryAt: number;
  savedThisSession: number;
  lastTickAt: number;
  status: string;
  error?: string;
  activeFolioId: string | null;
  provider?: string;
  /** The citable items the last pass wanted sources for. */
  lastTargets: Array<{ kind: string; anchor: string; query: string }>;
  /** Live per-claim pipeline state for the current/last pass. */
  phase: string;
  passActive: boolean;
  progress: ResearchProgressItem[];
  activity: ResearchActivityEntry[];
}

const state: ResearchState = {
  lastQuery: "",
  lastQueryAt: 0,
  savedThisSession: 0,
  lastTickAt: 0,
  lastStatus: "idle",
  phase: "idle",
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeClient: ConvexClient | null = null;
let activeBrief: ProjectBrief | null = null;
let activeFolioId: string | null = null;
/** Targets researched already this session, by stable key. */
let recentTargetKeys = new Set<string>();
let lastPassFingerprint = "";
let lastPassAt = 0;
/** The most recent draft handed to the watcher, so errors can retry. */
let lastDraftText = "";
let lastTargetSummary: Array<{ kind: string; anchor: string; query: string }> =
  [];
/** The live ledger for the current/most recent pass. */
let progressItems: ResearchProgressItem[] = [];
let activityLog: ResearchActivityEntry[] = [];
let passInFlight = false;
/**
 * Monotonic ownership token for async work. Providers are not all abortable,
 * so a folio switch invalidates an old pass before it may persist anything.
 */
let researchGeneration = 0;

const MAX_PROGRESS_ROWS = 8;
const MAX_ACTIVITY_ROWS = 8;

function setStatus(
  status: ResearchState["lastStatus"],
  phase: ResearchState["phase"] | undefined,
  error?: string,
): void {
  state.lastStatus = status;
  state.lastTickAt = Date.now();
  if (phase !== undefined) state.phase = status === "error" ? "error" : phase;
  if (error) state.lastError = error;
  else if (status !== "error") state.lastError = undefined;
  notify();
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("twyne:background-research", { detail: snapshot() }),
  );
}

export function snapshot(): ResearchSnapshot {
  return {
    lastQuery: state.lastQuery,
    lastQueryAt: state.lastQueryAt,
    savedThisSession: state.savedThisSession,
    lastTickAt: state.lastTickAt,
    status: state.lastStatus,
    error: state.lastError,
    activeFolioId,
    provider: state.lastProvider,
    lastTargets: lastTargetSummary,
    phase: state.phase,
    passActive: passInFlight,
    progress: [...progressItems],
    activity: [...activityLog],
  };
}

/** Human-readable "how long ago" for the activity feed. */
export function formatResearchTime(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

function logActivity(
  kind: string,
  anchor: string,
  query: string,
  outcome: "found" | "missed" | "error",
  count: number,
  error?: string,
): void {
  activityLog.unshift({
    id: crypto.randomUUID(),
    at: Date.now(),
    kind,
    anchor,
    query,
    outcome,
    count,
    error,
  });
  if (activityLog.length > MAX_ACTIVITY_ROWS) {
    activityLog.length = MAX_ACTIVITY_ROWS;
  }
}

function emitSaved(
  target: ResearchTarget,
  saved: number,
  folioId: string,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("twyne:background-sources", {
      detail: {
        saved,
        query: target.query,
        anchor: target.anchor,
        kind: target.kind,
        folioId,
      },
    }),
  );
}

/* ── Outcomes, errors, retry ────────────────────────────────────── */

/** A provider verdict on a single claim's query. */
export type SearchOutcome =
  | { ok: true; provider: string; results: Source[] }
  | { ok: false; message: string };

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

/** Re-run the last pass (extract + resolve) right now — a "try again" for
 *  AI/configuration failures where there's nothing to fix per-claim. Forces
 *  the pass through the idempotency gate so a same-set retry isn't dropped. */
export function retryBackgroundResearch(): void {
  if (!activeFolioId || !lastDraftText) return;
  schedule(lastDraftText, 0, true);
}

/** Re-run exactly one claim against the provider — used for a claim whose
 *  only stumble was a timeout / network error. */
export function retryResearchTarget(key: string): void {
  const row = progressItems.find((p) => p.key === key);
  const folioId = activeFolioId;
  if (!row || passInFlight || !folioId) return;
  const generation = researchGeneration;
  const target: ResearchTarget = {
    id: `retry-${row.key}`,
    kind: row.kind as ResearchTargetKind,
    anchor: row.anchor,
    query: row.query,
    reason: "",
    importance: 1,
  };
  passInFlight = true;
  setStatus("running", "searching");
  void resolveClaim(row, target, { generation, folioId })
    .catch((err) => {
      row.status = "error";
      row.error = errorMessage(err, "Research failed.");
      logActivity(row.kind, row.anchor, row.query, "error", 0, row.error);
    })
    .finally(() => {
      if (generation === researchGeneration) {
        passInFlight = false;
        setStatus("idle", "idle");
      }
    });
}

export interface DirectedResearchRequest extends DirectedResearchTargetInput {
  /** Guards a selection captured immediately before a folio switch. */
  folioId?: string;
}

export interface ResearchCommandResult {
  ok: boolean;
  message?: string;
}

/** Research exactly the passage the writer selected. This bypasses target
 * extraction, while keeping the normal provider, progress, retry, ranking,
 * and bibliography pipeline. */
export async function researchSelection(
  request: DirectedResearchRequest,
): Promise<ResearchCommandResult> {
  const folioId = activeFolioId;
  if (!folioId || (request.folioId && request.folioId !== folioId)) {
    return { ok: false, message: "That selection belongs to another folio." };
  }
  if (passInFlight) {
    return {
      ok: false,
      message:
        "The Apparatus is already searching. Wait for this pass to settle.",
    };
  }
  const target = directedResearchTarget(request);
  if (!target) return { ok: false, message: "Select a passage to research." };

  const generation = researchGeneration;
  const row: ResearchProgressItem = {
    key: targetKey(target),
    kind: target.kind,
    anchor: target.anchor,
    query: target.query,
    status: "queued",
  };
  progressItems = [
    row,
    ...progressItems.filter((item) => item.key !== row.key),
  ].slice(0, MAX_PROGRESS_ROWS);
  lastTargetSummary = [
    { kind: target.kind, anchor: target.anchor, query: target.query },
  ];
  state.lastQuery = target.query;
  state.lastQueryAt = Date.now();
  passInFlight = true;
  setStatus("running", "searching");
  try {
    await resolveClaim(row, target, { generation, folioId });
    if (generation !== researchGeneration) {
      return {
        ok: false,
        message: "The folio changed before research finished.",
      };
    }
    return row.status === "error"
      ? { ok: false, message: row.error ?? "Research failed." }
      : { ok: true };
  } finally {
    if (generation === researchGeneration) {
      passInFlight = false;
      setStatus("idle", "idle");
    }
  }
}

/** Re-run target extraction immediately with a writer-authored direction. */
export async function steerBackgroundResearch(
  instructions: string,
): Promise<ResearchCommandResult> {
  const direction = instructions.trim();
  if (!direction) return { ok: false, message: "Write a direction first." };
  if (!activeFolioId || !lastDraftText) {
    return { ok: false, message: "Open a folio with draft text first." };
  }
  if (lastDraftText.trim().length < MIN_DRAFT_CHARS) {
    return {
      ok: false,
      message:
        "The folio needs a little more draft text before it can be steered.",
    };
  }
  if (passInFlight) {
    return { ok: false, message: "Let the current search settle first." };
  }
  const aiSettings = await loadAiSettingsFromIdb();
  if (!aiSettings || !hasConfiguredAiProvider(aiSettings)) {
    return {
      ok: false,
      message:
        "Choose an AI provider in Settings before steering a draft-wide pass.",
    };
  }
  await runOnce(lastDraftText, true, direction);
  return state.lastStatus === "error"
    ? { ok: false, message: state.lastError ?? "Research failed." }
    : { ok: true };
}

/** Take one claim through search → rank → save, updating its live row and
 *  the activity feed as it goes. Shared by the pass loop and single retries. */
async function resolveClaim(
  row: ResearchProgressItem,
  target: ResearchTarget,
  run: { generation: number; folioId: string },
): Promise<void> {
  if (run.generation !== researchGeneration) return;
  const settings = await loadApparatusSettingsFromIdb();
  row.status = "searching";
  row.error = undefined;
  notify();

  let outcome: SearchOutcome;
  try {
    outcome = await searchForTarget(target, settings);
  } catch (err) {
    outcome = { ok: false, message: errorMessage(err, "Search failed.") };
  }
  if (run.generation !== researchGeneration) return;
  if (outcome.ok) state.lastProvider = outcome.provider;

  let found = 0;
  let failMsg: string | undefined;
  if (outcome.ok) {
    const ranked = rankSourcesForTarget(outcome.results);
    try {
      setStatus("running", "saving");
      found = await persistTarget(target, ranked, run.folioId);
      setStatus("running", "searching");
    } catch (err) {
      found = 0;
      failMsg = errorMessage(err, "Could not save the found sources.");
    }
  } else {
    failMsg = outcome.message;
  }

  row.at = Date.now();
  if (found > 0) {
    row.status = "found";
    row.count = found;
    recentTargetKeys.add(targetKey(target));
    state.savedThisSession += found;
  } else if (failMsg) {
    row.status = "error";
    row.error = failMsg;
  } else {
    row.status = "missed";
    // A miss remains available for explicit retry in Deep Trace, but should
    // not monopolize every automatic pass and starve later dossier targets.
    recentTargetKeys.add(targetKey(target));
  }
  logActivity(
    target.kind,
    target.anchor,
    target.query,
    failMsg ? "error" : found > 0 ? "found" : "missed",
    found,
    failMsg,
  );
  notify();
  emitSaved(target, found, run.folioId);
}

/** Fingerprint of a set of targets — stable identity for the TTL cache. */
function fingerprintOf(targets: ResearchTarget[]): string {
  return targets
    .map((t) => targetKey(t))
    .sort()
    .join("|");
}

/** Re-run research now (used on folio switch and on initial load). */
export function kickBackgroundResearch(draftText: string): void {
  if (!activeFolioId) return;
  lastDraftText = draftText.trim();
  schedule(draftText, 0);
}

/** Notify the watcher that the draft has changed. Debounced. */
export function onDraftChanged(draftText: string): void {
  if (!activeFolioId) return;
  lastDraftText = draftText.trim();
  schedule(draftText, DEBOUNCE_MS);
}

export function stopBackgroundResearch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  researchGeneration += 1;
  passInFlight = false;
  setStatus("idle", "idle");
}

/** Configure the research watcher. Safe to call repeatedly — the latest
 *  args win. */
export function startBackgroundResearch(args: {
  client: ConvexClient | null;
  brief: ProjectBrief | null;
  folioId: string | null;
}): void {
  researchGeneration += 1;
  activeClient = args.client;
  // Share the client with the MCP layer, which also needs it for the relay
  // from call sites that never receive one (the drafting tool loop).
  setMcpConvexClient(args.client);
  activeBrief = args.brief;
  activeFolioId = args.folioId;
  recentTargetKeys = new Set();
  progressItems = [];
  activityLog = [];
  lastTargetSummary = [];
  passInFlight = false;
  setStatus("idle", "idle");
}

function schedule(draftText: string, delay: number, force = false): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runOnce(draftText, force);
  }, delay);
}

async function runOnce(
  draftText: string,
  force = false,
  steeringInstructions?: string,
): Promise<void> {
  if (!activeFolioId) return;
  const generation = researchGeneration;
  const folioId = activeFolioId;
  const trimmed = draftText.trim();
  if (trimmed.length < MIN_DRAFT_CHARS) return;

  // The watcher decides "what needs a source" with AI. No AI, no auto-
  // research; manual Sources still flow through as always.
  const aiSettings = await loadAiSettingsFromIdb();
  if (!aiSettings || !hasConfiguredAiProvider(aiSettings)) {
    setStatus("idle", "idle");
    return;
  }

  const all = await loadBibliography();
  const existingTitles = all
    .filter((e) => e.folioId === activeFolioId && e.provenance !== "background")
    .map((e) => e.title)
    .filter(Boolean);
  const coveredKeys = new Set(
    all
      .filter((e) => e.folioId === activeFolioId && e.target)
      .map((e) =>
        targetKey({ kind: e.target!.kind, anchor: e.target!.anchor }),
      ),
  );

  setStatus("running", "extracting");
  let result: { targets: ResearchTarget[]; provider: string } | null = null;
  try {
    result = await runClientResearchExtract(
      {
        draftText: trimmed,
        existingSources: existingTitles,
        maxTargets: DEFAULT_TARGETS_PER_PASS,
        instructions:
          [buildDossierResearchInstructions(activeBrief), steeringInstructions]
            .filter(Boolean)
            .join("\n") || undefined,
      },
      aiSettings,
    );
  } catch (err) {
    setStatus(
      "error",
      "error",
      `Reading your draft failed — ${errorMessage(err, "the AI call errored")}. Fix your AI settings or retry.`,
    );
    return;
  }
  if (!result?.targets.length) {
    setStatus("idle", "idle");
    return;
  }

  // Don't hammer the provider with a set we just resolved, nor re-resolve
  // anchors the bibliography already covers.
  const now = Date.now();
  if (
    !force &&
    lastPassAt &&
    now - lastPassAt < PASS_TTL_MS &&
    fingerprintOf(result.targets) === lastPassFingerprint
  ) {
    setStatus("idle", "idle");
    return;
  }
  lastPassFingerprint = fingerprintOf(result.targets);
  lastPassAt = now;

  const fresh = selectFreshTargets(result.targets, {
    budget: MAX_TARGETS_PER_PASS,
    coveredKeys,
    recentKeys: recentTargetKeys,
  });
  if (fresh.length === 0) {
    setStatus("idle", "idle");
    return;
  }

  state.lastQuery = fresh[0].query;
  state.lastQueryAt = now;
  lastTargetSummary = fresh.map((t) => ({
    kind: t.kind,
    anchor: t.anchor,
    query: t.query,
  }));
  progressItems = fresh.slice(0, MAX_PROGRESS_ROWS).map((t) => ({
    key: targetKey(t),
    kind: t.kind,
    anchor: t.anchor,
    query: t.query,
    status: "queued",
  }));
  passInFlight = true;
  setStatus("running", "searching");

  try {
    for (const target of fresh) {
      const row = progressItems.find((p) => p.key === targetKey(target));
      if (!row) continue;
      await resolveClaim(row, target, { generation, folioId });
      if (generation !== researchGeneration) return;
    }
  } finally {
    if (generation === researchGeneration) {
      passInFlight = false;
      setStatus("idle", "idle");
    }
  }
}

/* ── Provider routing (search API / model / MCP / hosted) ──────── */

async function searchForTarget(
  target: ResearchTarget,
  settings: ApparatusSettings,
): Promise<SearchOutcome> {
  const query = target.query;
  const context = buildResearchSearchContext(target);
  const instructions = buildResearchSearchInstructions(target);
  const configured = await searchWithConfiguredProvider(
    query,
    context,
    settings,
    instructions,
  );
  if (configured) return configured;
  // Hosted fallback: a locally-configured provider wasn't usable or chosen.
  if (!activeClient) {
    return {
      ok: false,
      message:
        "No research provider is configured — add one in Settings, or sign in for the built-in research service.",
    };
  }
  try {
    const res = (await activeClient.action(api.research.searchSources, {
      query,
      context,
    })) as { results?: Source[]; provider?: string };
    if (res.provider === "local") {
      return {
        ok: false,
        message:
          "Live research is not configured. Choose a research provider in Settings; local placeholder results are not fact-check evidence.",
      };
    }
    return {
      ok: true,
      provider: res.provider ?? "hosted",
      results: Array.isArray(res.results) ? res.results : [],
    };
  } catch (err) {
    return {
      ok: false,
      message: errorMessage(err, "The built-in research service failed."),
    };
  }
}

async function searchWithConfiguredProvider(
  query: string,
  context: string,
  settings: ApparatusSettings,
  instructions: string,
): Promise<SearchOutcome | null> {
  switch (settings.researchProvider) {
    case "search-api":
      return searchViaBackend(query, context, settings);
    case "model-web-search":
      return searchModelEndpoint(query, context, settings, instructions);
    case "web-mcp":
      return searchViaMcp(query, context, settings);
    case "hosted":
    default:
      return null;
  }
}

async function searchViaBackend(
  query: string,
  context: string,
  settings: ApparatusSettings,
): Promise<SearchOutcome | null> {
  const adapter = searchBackend(settings.searchBackend.id);
  try {
    const res = await runSearchBackend(
      { query, context, maxResults: settings.maxResults },
      settings.searchBackend,
    );
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true, provider: `${adapter.id}:byok`, results: res.results };
  } catch (err) {
    return {
      ok: false,
      message: errorMessage(err, `${adapter.label} search failed.`),
    };
  }
}

async function searchModelEndpoint(
  query: string,
  context: string,
  settings: ApparatusSettings,
  instructions: string,
): Promise<SearchOutcome | null> {
  const aiSettings = await loadAiSettingsFromIdb();
  if (!aiSettings) {
    return {
      ok: false,
      message: "No AI provider configured for the search model.",
    };
  }
  try {
    const res = await runClientResearchWebSearch(
      {
        query,
        context,
        maxResults: settings.maxResults,
        instructions,
      },
      aiSettings,
    );
    return {
      ok: true,
      provider: res?.provider ?? "model-web-search",
      results: (res?.results as Source[]) ?? [],
    };
  } catch (err) {
    return {
      ok: false,
      message: errorMessage(err, "Model web search failed."),
    };
  }
}

async function searchViaMcp(
  query: string,
  context: string,
  settings: ApparatusSettings,
): Promise<SearchOutcome | null> {
  if (!settings.mcpServers.some((s) => s.enabled && s.url.trim())) {
    return {
      ok: false,
      message: "No MCP servers in Settings — add one to search claims.",
    };
  }
  try {
    const res = await searchMcpServers(
      { query, context },
      settings,
      activeClient,
    );
    if (!res.results.length) {
      return {
        ok: false,
        message:
          res.warnings[0] ??
          "The MCP servers returned no sources for that claim.",
      };
    }
    return { ok: true, provider: res.provider, results: res.results };
  } catch (err) {
    return { ok: false, message: errorMessage(err, "MCP search failed.") };
  }
}

async function persistTarget(
  target: ResearchTarget,
  results: Source[],
  folioId: string,
): Promise<number> {
  const all = await loadBibliography();
  const seen = new Set(
    all.filter((e) => e.folioId === folioId).map((e) => normalizeUrl(e.url)),
  );
  const existingBgForFolio = all.filter(
    (e) => e.folioId === folioId && e.provenance === "background",
  ).length;
  let budget = Math.max(0, MAX_BACKGROUND_PER_FOLIO - existingBgForFolio);
  const ref: ResearchTargetRef = {
    kind: target.kind,
    anchor: target.anchor,
    query: target.query,
    reason: target.reason,
  };
  let saved = 0;

  for (const src of results) {
    if (budget <= 0) break;
    if (!src.url) continue;
    if (seen.has(normalizeUrl(src.url))) continue;
    if ((src.snippet?.length ?? 0) < SNIPPET_MIN_CHARS) continue;
    const entry: BibEntry = {
      id: crypto.randomUUID(),
      folioId,
      title: src.title || src.url,
      author: src.author,
      publisher: src.publisher,
      date: src.date,
      url: src.url,
      accessedAt: Date.now(),
      snippet: src.snippet,
      why: src.why ?? target.reason,
      provenance: "background",
      backgroundQuery: target.query,
      target: ref,
      accepted: false,
    };
    all.push(entry);
    seen.add(normalizeUrl(src.url));
    saved += 1;
    budget -= 1;
  }
  if (saved > 0) await saveBibliography(all);
  return saved;
}
