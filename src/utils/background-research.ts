import { cancelAccountResearchReview } from "./account-knowledge";
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
 *   4. Research each target as a loop (`resolveClaim`): search, read the
 *      best pages, judge each passage against the claim, and try another
 *      query when nothing supports it. Supporting sources are saved with the
 *      passage that backs them; contradicting ones are saved and flagged.
 *      Both carry `provenance: "background"` so the panel can tell who
 *      found them.
 *   5. Stream the pass live: every state change (extract → per-claim search
 *      → save → outcome) updates an in-memory ledger that `snapshot()` hands
 *      to the UI, and each saved claim fires its own `twyne:background-sources`
 *      event so the panel can show sources as they land, not in a lump.
 *
 * Reading the draft needs the writer's model or a signed-in account (Jev).
 * Searching needs a route (`research-route.ts`): the account when signed in,
 * otherwise the writer's own search or AI key. Missing either, the watcher
 * goes idle and says which — the writer still sees their saved sources.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Source } from "../../convex/research";
import type {
  AiSettings,
  ApparatusSettings,
  ProjectBrief,
  ResearchTarget,
  ResearchTargetKind,
  ResearchTargetRef,
} from "../types";
import {
  hasConfiguredAiProvider,
  nativeWebSearchKind,
  resolveFeatureConfig,
  runClientResearchExtract,
  runClientResearchWebSearch,
  runClientSourceSupport,
} from "./ai-client";
import {
  NO_ROUTE_MESSAGE,
  describeResearchRoute,
  resolveResearchRoute,
  type ResearchRoute,
} from "./research-route";
import { searchMcpServers, setMcpConvexClient } from "./mcp-research";
import { askJudgement } from "./judgement-client";
import {
  candidateRequest,
  claimCandidates,
  confirmedTargets,
} from "./research-candidates";
import {
  fetchPageWithBackend,
  runSearchBackend,
  searchBackend,
} from "./research-backends";
import {
  CANDIDATES_PER_QUERY,
  evidencePassage,
  isRateLimited,
  researchQueries,
  settledVerdict,
  supportReadings,
  supportRequest,
  type SupportCandidate,
  type SupportReading,
} from "./research-verify";
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
  dossierResearchMode,
  selectFreshTargets,
  targetKey,
  rankSourcesForTarget,
  type DirectedResearchTargetInput,
} from "./research-targets";

const DEBOUNCE_MS = 45_000;
const PASS_TTL_MS = 5 * 60_000; // don't chase the same set of claims every pass
const MAX_BACKGROUND_PER_FOLIO = 25; // soft cap so the bib doesn't grow forever
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
  /** Why the watcher is idle, so the panel never just says "watching". */
  idleReason: ResearchIdleReason;
  /** When a failed pass will try again on its own. */
  nextRetryAt?: number;
  /** Where searches go right now. */
  route?: ResearchRoute;
}

/**
 * Why no research is running. Each one is a different thing for the writer
 * to know: waiting for them, nothing to do, a setup step, or a finished pass.
 */
export type ResearchIdleReason =
  | "waiting"
  | "too-short"
  | "no-provider"
  | "no-search"
  | "no-claims"
  | "covered"
  | "pass-done";

/** The same states, short enough for a status line. */
export const RESEARCH_IDLE_LABEL: Record<ResearchIdleReason, string> = {
  waiting: "Waiting for a pause",
  "too-short": "Draft too short",
  "no-provider": "Sign in to research",
  "no-search": "Nothing to search with",
  "no-claims": "No claims to source",
  covered: "Claims covered",
  "pass-done": "Pass finished",
};

export const RESEARCH_IDLE_COPY: Record<ResearchIdleReason, string> = {
  waiting: "Waiting for you to pause. Research runs after a quiet moment.",
  "too-short": "The draft is too short to check for claims yet.",
  "no-provider":
    "Automatic research starts when you sign in or add an AI key in Settings.",
  "no-search":
    "Your AI key can read the draft but cannot search the web. Sign in, add a search key, or choose an OpenAI, Anthropic or Google model for web search in Settings.",
  "no-claims":
    "Read the draft and found no claims that need a source right now.",
  covered: "Every claim it found already has a source or was just checked.",
  "pass-done": "Finished the last pass. Results are below.",
};

export type ResearchTargetStatus =
  | "queued"
  | "searching"
  | "found"
  | "contradicted"
  | "missed"
  | "error";

/** One claim the watcher decided needs a source — the live row in the panel. */
export interface ResearchProgressItem {
  key: string;
  kind: string;
  anchor: string;
  query: string;
  status: ResearchTargetStatus;
  /** How many supporting sources were saved when status is "found". */
  count?: number;
  /** How many sources were saved because they contradict the claim. */
  contradicted?: number;
  /** What the loop is doing for this claim right now. */
  step?: string;
  /** Searches run and pages read, once the claim settles. */
  searches?: number;
  read?: number;
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
  outcome: ResearchOutcome;
  count: number;
  error?: string;
}

export type ResearchOutcome = "found" | "contradicted" | "missed" | "error";

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
  /** Why the watcher is idle, when it is. */
  idleReason: ResearchIdleReason;
  /** When a failed pass retries on its own, if one is scheduled. */
  nextRetryAt?: number;
  /** Who is doing the searching, for the status line. */
  route?: { kind: ResearchRoute["kind"]; label: string };
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
  idleReason: "waiting",
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeClient: ConvexClient | null = null;
/** A Convex client exists signed out too; only a signed-in one can search. */
let signedIn = false;
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

/** Failed passes retry on their own, further apart each time. */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000];
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/**
 * Try a failed pass again later without being asked. Gives up after the
 * last delay and leaves the error and its retry button on screen.
 */
function scheduleRetry(): void {
  clearRetry();
  const delay = RETRY_DELAYS_MS[retryAttempt];
  if (delay === undefined || !lastDraftText) return;
  retryAttempt += 1;
  state.nextRetryAt = Date.now() + delay;
  const generation = researchGeneration;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    state.nextRetryAt = undefined;
    if (generation !== researchGeneration) return;
    void runOnce(lastDraftText, true);
  }, delay);
}

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

/** Go idle and say why. */
function settle(reason: ResearchIdleReason): void {
  state.idleReason = reason;
  setStatus("idle", "idle");
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
    idleReason: state.idleReason,
    nextRetryAt: state.nextRetryAt,
    route: state.route && {
      kind: state.route.kind,
      label: describeResearchRoute(state.route),
    },
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
  outcome: ResearchOutcome,
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
      settle("pass-done");
      // Claims whose search broke are tried again later on their own.
      const failed = progressItems.filter((p) => p.status === "error");
      for (const row of failed) recentTargetKeys.delete(row.key);
      if (failed.length) scheduleRetry();
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

/** Wait out a rate limit instead of failing the claim. */
function retryAfter(message: string): number {
  const seconds = Number(message.match(/try again in (\d+)\s*s/i)?.[1]);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(90, seconds + 1) * 1000
    : 30_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a hosted call, pausing once if the account's per-minute budget is
 * spent. A background pass has time; a rate limit is a reason to wait.
 */
async function paced<T>(
  row: ResearchProgressItem,
  generation: number,
  call: () => Promise<T>,
  failed: (value: T) => string | null,
): Promise<T> {
  const first = await call();
  const message = failed(first);
  if (!message || !isRateLimited(message)) return first;
  if (generation !== researchGeneration) return first;
  const wait = retryAfter(message);
  row.step = `waiting ${Math.round(wait / 1000)}s for the search budget`;
  notify();
  await sleep(wait);
  if (generation !== researchGeneration) return first;
  return call();
}

interface CheckedSource {
  source: Source;
  passage: string;
  verdict: "supports" | "contradicts";
  confidence: number;
}

/**
 * Take one claim through the research loop and settle its live row:
 *
 *   search → read the best pages → judge each passage → save what supports
 *
 * A query that turns up nothing supporting is followed by the next way of
 * asking (`researchQueries`). Contradicting sources are kept and flagged.
 * Shared by the pass loop, directed research and single retries.
 */
async function resolveClaim(
  row: ResearchProgressItem,
  target: ResearchTarget,
  run: { generation: number; folioId: string },
): Promise<void> {
  if (run.generation !== researchGeneration) return;
  const settings = await loadApparatusSettingsFromIdb();
  const aiSettings = await loadAiSettingsFromIdb();
  row.status = "searching";
  row.error = undefined;
  row.contradicted = undefined;
  notify();

  const queries = researchQueries(target);
  const onFile = new Set(
    (await loadBibliography())
      .filter((e) => e.folioId === run.folioId)
      .map((e) => normalizeUrl(e.url)),
  );
  const judged = new Set<string>();
  const kept: CheckedSource[] = [];
  let searches = 0;
  let read = 0;
  let failMsg: string | undefined;

  for (const [i, query] of queries.entries()) {
    row.query = query;
    row.step = `search ${i + 1} of ${queries.length}`;
    state.lastQuery = query;
    notify();
    let outcome: SearchOutcome;
    try {
      outcome = await paced(
        row,
        run.generation,
        () => searchForTarget(target, settings, query),
        (o) => (o.ok ? null : o.message),
      );
    } catch (err) {
      outcome = { ok: false, message: errorMessage(err, "Search failed.") };
    }
    if (run.generation !== researchGeneration) return;
    searches += 1;
    if (!outcome.ok) {
      // A later query may still get through; the claim fails only if none do.
      failMsg = outcome.message;
      continue;
    }
    failMsg = undefined;
    state.lastProvider = outcome.provider;

    const candidates = rankSourcesForTarget(outcome.results)
      .filter((src) => {
        const key = src.url && normalizeUrl(src.url);
        return key && !judged.has(key) && !onFile.has(key);
      })
      .slice(0, CANDIDATES_PER_QUERY);
    if (!candidates.length) continue;
    for (const src of candidates) judged.add(normalizeUrl(src.url));

    const passages: SupportCandidate[] = [];
    for (const src of candidates) {
      row.step = `reading ${hostOf(src.url)}`;
      notify();
      const page = await readPage(src.url, settings, row, run.generation);
      if (run.generation !== researchGeneration) return;
      if (page) read += 1;
      passages.push({
        url: src.url,
        title: src.title || src.url,
        passage: evidencePassage(
          target.anchor,
          [src.snippet, page].filter(Boolean).join("\n\n"),
        ),
      });
    }

    row.step = `checking ${passages.length} source${passages.length === 1 ? "" : "s"}`;
    notify();
    const readings = await judgeSupport(target.anchor, passages, aiSettings);
    if (run.generation !== researchGeneration) return;
    if (!readings) {
      failMsg = "The sources could not be checked against the claim.";
      continue;
    }
    readings.forEach((reading, j) => {
      const verdict = settledVerdict(reading);
      if (verdict)
        kept.push({
          source: candidates[j],
          passage: passages[j].passage,
          verdict,
          confidence: reading.confidence,
        });
    });
    if (kept.some((k) => k.verdict === "supports")) break;
  }

  let supported = 0;
  let contradicted = 0;
  if (kept.length) {
    try {
      setStatus("running", "saving");
      ({ supported, contradicted } = await persistTarget(
        target,
        kept,
        run.folioId,
      ));
      setStatus("running", "searching");
      failMsg = undefined;
    } catch (err) {
      failMsg = errorMessage(err, "Could not save the found sources.");
    }
  }

  row.at = Date.now();
  row.step = undefined;
  row.searches = searches;
  row.read = read;
  row.contradicted = contradicted || undefined;
  let outcome: ResearchOutcome;
  if (supported > 0) {
    outcome = "found";
    row.count = supported;
    state.savedThisSession += supported;
  } else if (contradicted > 0) {
    outcome = "contradicted";
  } else if (failMsg) {
    outcome = "error";
    row.error = failMsg;
  } else {
    outcome = "missed";
  }
  row.status = outcome;
  // A settled claim, sourced or not, stays settled for this session; Deep
  // Trace still offers an explicit retry. Errors are retried on their own.
  if (outcome !== "error") recentTargetKeys.add(targetKey(target));
  logActivity(
    target.kind,
    target.anchor,
    row.query,
    outcome,
    supported || contradicted,
    row.error,
  );
  notify();
  emitSaved(target, supported + contradicted, run.folioId);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the page";
  }
}

/** Read a page through the route that searched for it, when it can read. */
async function readPage(
  url: string,
  settings: ApparatusSettings,
  row: ResearchProgressItem,
  generation: number,
): Promise<string | null> {
  const route = state.route;
  if (route?.kind === "search-api")
    return fetchPageWithBackend(url, settings.searchBackend);
  if (route?.kind !== "account" || !activeClient) return null;
  const client = activeClient;
  try {
    const res = await paced(
      row,
      generation,
      async () => {
        try {
          return (await client.action(api.research.fetchSource, { url })) as {
            markdown?: string;
            provider?: string;
          };
        } catch (err) {
          return { error: errorMessage(err, "fetch failed") };
        }
      },
      (r) => ("error" in r ? (r.error as string) : null),
    );
    if ("error" in res || res.provider === "local") return null;
    return res.markdown?.trim() ? res.markdown : null;
  } catch {
    return null;
  }
}

/** Jev for a signed-in writer (or their own judgement endpoint), else their model. */
async function judgeSupport(
  claim: string,
  candidates: SupportCandidate[],
  aiSettings: AiSettings | null,
): Promise<SupportReading[] | null> {
  if (!candidates.length) return [];
  const ownJudge = aiSettings?.judgement?.source;
  if ((signedIn && activeClient) || (ownJudge && ownJudge !== "twyne")) {
    const result = await askJudgement(
      activeClient,
      supportRequest(claim, candidates),
    );
    if (result.ok) return supportReadings(candidates.length, result);
  }
  if (aiSettings && hasConfiguredAiProvider(aiSettings)) {
    try {
      return await runClientSourceSupport(claim, candidates, aiSettings);
    } catch {
      return null;
    }
  }
  return null;
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
  cancelAccountResearchReview();
  clearRetry();
  retryAttempt = 0;
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
  cancelAccountResearchReview();
  clearRetry();
  retryAttempt = 0;
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
  settle("waiting");
}

/** Signing in or out changes who searches, so the draft is read again. */
export function setResearchSignedIn(value: boolean): void {
  if (signedIn === value) return;
  signedIn = value;
  if (activeFolioId && lastDraftText) schedule(lastDraftText, 0, true);
}

/** The route for these settings and the current sign-in. */
function routeFor(
  settings: ApparatusSettings,
  aiSettings: AiSettings | null,
): ResearchRoute {
  const resolved =
    aiSettings && hasConfiguredAiProvider(aiSettings)
      ? resolveFeatureConfig(aiSettings, "research-web-search")
      : null;
  return resolveResearchRoute({
    provider: settings.researchProvider,
    searchBackend: settings.searchBackend,
    signedIn: signedIn && !!activeClient,
    searchModel: resolved
      ? {
          name: resolved.provider.name || resolved.provider.type,
          live: !!nativeWebSearchKind(resolved.provider),
        }
      : null,
  });
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
  if (trimmed.length < MIN_DRAFT_CHARS) {
    settle("too-short");
    return;
  }

  // The watcher decides "what needs a source" with the writer's model when
  // they have one, and otherwise with the text itself and Jev on Twyne's
  // service. Only a signed-out writer with no model has no automatic path.
  const [aiSettings, apparatus] = await Promise.all([
    loadAiSettingsFromIdb(),
    loadApparatusSettingsFromIdb(),
  ]);
  const ownModel = !!aiSettings && hasConfiguredAiProvider(aiSettings);
  if (!ownModel && !(signedIn && activeClient)) {
    state.route = undefined;
    settle("no-provider");
    return;
  }
  // Nothing is read until something can search for what it finds.
  state.route = routeFor(apparatus, aiSettings);
  if (state.route.kind === "none") {
    settle("no-search");
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
    result = ownModel
      ? await runClientResearchExtract(
          {
            draftText: trimmed,
            existingSources: existingTitles,
            maxTargets: DEFAULT_TARGETS_PER_PASS,
            instructions:
              [
                buildDossierResearchInstructions(activeBrief),
                steeringInstructions,
              ]
                .filter(Boolean)
                .join("\n") || undefined,
          },
          aiSettings!,
        )
      : await extractOnService(trimmed);
  } catch (err) {
    scheduleRetry();
    setStatus(
      "error",
      "error",
      `Reading your draft failed — ${errorMessage(err, "the AI call errored")}. ${
        retryTimer
          ? "It will try again on its own."
          : "It stopped retrying; check your AI settings or sign-in, then retry."
      }`,
    );
    return;
  }
  retryAttempt = 0;
  if (!result?.targets.length) {
    settle("no-claims");
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
    settle("covered");
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
    settle("covered");
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

/** Claims found by text rules and confirmed by Jev, for hosted writers. */
async function extractOnService(
  draft: string,
): Promise<{ targets: ResearchTarget[]; provider: string } | null> {
  const candidates = claimCandidates(draft);
  if (!candidates.length) return null;
  const result = await askJudgement(
    activeClient,
    candidateRequest(candidates, dossierResearchMode(activeBrief)),
  );
  if (!result.ok) {
    throw new Error(result.error || "the claim check could not run");
  }
  const targets = confirmedTargets(candidates, result);
  return targets.length ? { targets, provider: "hosted" } : null;
}

/* ── Provider routing (search API / model / MCP / hosted) ──────── */

async function searchForTarget(
  target: ResearchTarget,
  settings: ApparatusSettings,
  query = target.query,
): Promise<SearchOutcome> {
  const context = buildResearchSearchContext(target);
  const instructions = buildResearchSearchInstructions(target);
  const route = routeFor(settings, await loadAiSettingsFromIdb());
  state.route = route;
  switch (route.kind) {
    case "search-api":
      return searchViaBackend(query, context, settings);
    case "model-web-search":
      return searchModelEndpoint(query, context, settings, instructions);
    case "mcp":
      return searchViaMcp(query, context, settings);
    case "none":
      return { ok: false, message: NO_ROUTE_MESSAGE };
    case "account":
      return searchViaAccount(query, context);
  }
}

/** Twyne's own search, through the signed-in writer's account. */
async function searchViaAccount(
  query: string,
  context: string,
): Promise<SearchOutcome> {
  if (!activeClient) return { ok: false, message: NO_ROUTE_MESSAGE };
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

async function searchViaBackend(
  query: string,
  context: string,
  settings: ApparatusSettings,
): Promise<SearchOutcome> {
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
): Promise<SearchOutcome> {
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
): Promise<SearchOutcome> {
  try {
    const { searchAccountKnowledge, accountKnowledgeGeneration } = await import(
      "./account-knowledge"
    );
    const accountGeneration = accountKnowledgeGeneration();
    const account = await searchAccountKnowledge({
      query,
      context,
      maxResults: settings.maxResults,
    });
    const local = await searchMcpServers(
      { query, context },
      settings,
      activeClient,
    );
    if (accountGeneration !== accountKnowledgeGeneration())
      return {
        ok: false,
        message: "Account changed. Research results were discarded.",
      };
    const res = {
      results: [...account.results, ...local.results].slice(
        0,
        settings.maxResults,
      ),
      warnings: [...account.warnings, ...local.warnings],
      provider: [account.provider, local.provider].join(";"),
    };
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

/** Save the checked sources for one claim; returns how many of each landed. */
async function persistTarget(
  target: ResearchTarget,
  checked: CheckedSource[],
  folioId: string,
): Promise<{ supported: number; contradicted: number }> {
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
  let supported = 0;
  let contradicted = 0;

  // Support first, so a full folio still keeps the sources that back a claim.
  const ordered = [...checked].sort(
    (a, b) =>
      Number(b.verdict === "supports") - Number(a.verdict === "supports") ||
      b.confidence - a.confidence,
  );
  for (const { source: src, passage, verdict, confidence } of ordered) {
    if (budget <= 0) break;
    if (!src.url || seen.has(normalizeUrl(src.url))) continue;
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
      support: verdict,
      supportConfidence: confidence,
      evidence: passage,
      accepted: false,
    };
    all.push(entry);
    seen.add(normalizeUrl(src.url));
    if (verdict === "supports") supported += 1;
    else contradicted += 1;
    budget -= 1;
  }
  if (supported + contradicted > 0) await saveBibliography(all);
  return { supported, contradicted };
}
