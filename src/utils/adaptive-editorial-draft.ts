import {
  bestAttempt,
  MAX_REWRITES,
  noteAction,
  rewriteInstruction,
  type NoteVerdict,
} from "./note-gate";
import type { EditorialOperation } from "./editorial-policy";

/** Provider-neutral reasoning levels used by the adaptive drafting loop. */
export type EditorialReasoningLevel = "off" | "low" | "medium" | "high";

export type EditorialDraftPhase =
  | "drafting"
  | "checking"
  | "revising"
  | "released"
  | "unreviewed"
  | "withheld";

export interface EditorialDraftCandidate<T> {
  /** The value that will be returned if this candidate is selected. */
  value: T;
  /** Visible text used by the reviewer and returned to the caller. */
  text: string;
  /** Exact passage selected by the quote tool, when one was found. */
  anchor?: string;
}

export interface EditorialDraftAttempt {
  attempt: number;
  reasoning: EditorialReasoningLevel;
  status: "pass" | "fail" | "unknown" | "generation-error" | "unreviewed";
  overall: number | null;
  vetoed: boolean | null;
  rewriteKind: NoteVerdict["rewriteKind"] | null;
  generationMs: number;
  reviewMs: number;
}

/** Content-free progress that is safe to show while candidates stay private. */
export interface EditorialDraftSnapshot {
  phase: EditorialDraftPhase;
  attempt: number;
  maxAttempts: number;
  reasoning: EditorialReasoningLevel;
  attempts: readonly EditorialDraftAttempt[];
  selectedAttempt: number | null;
  reason: string | null;
}

export interface AdaptiveEditorialDraftOptions<T> {
  operation?: EditorialOperation;
  initialReasoning?: EditorialReasoningLevel;
  maxReasoning?: EditorialReasoningLevel;
  maxAttempts?: number;
  /** Generate privately. Rejected candidate text must never be emitted here. */
  generate: (input: {
    attempt: number;
    reasoning: EditorialReasoningLevel;
    repair: readonly string[];
  }) => Promise<EditorialDraftCandidate<T>>;
  /** Return null for unavailable/malformed judgement, never a synthetic pass. */
  review: (
    candidate: EditorialDraftCandidate<T>,
  ) => Promise<NoteVerdict | null>;
  onProgress?: (snapshot: EditorialDraftSnapshot) => void;
  now?: () => number;
}

export interface AdaptiveEditorialDraftResult<T> {
  status: "released" | "unreviewed" | "withheld";
  candidate?: EditorialDraftCandidate<T>;
  verdict?: NoteVerdict | null;
  receipt: EditorialDraftSnapshot;
}

const LEVELS: readonly EditorialReasoningLevel[] = [
  "off",
  "low",
  "medium",
  "high",
];

function clampLevel(
  level: EditorialReasoningLevel,
  ceiling: EditorialReasoningLevel,
): EditorialReasoningLevel {
  return LEVELS[Math.min(LEVELS.indexOf(level), LEVELS.indexOf(ceiling))]!;
}

function defaultReasoning(
  operation: EditorialOperation | undefined,
): EditorialReasoningLevel {
  switch (operation) {
    case "analyze":
      return "high";
    case "elaborate":
    case "rewrite-suggestion":
      return "medium";
    case "feedback":
    case "riff":
    default:
      return "low";
  }
}

/**
 * A failed evidence or substance check benefits from more computation. A
 * voice/preference failure is a different problem: more hidden thinking does
 * not fix a mismatch of register, so it keeps the current level and changes
 * only the repair direction.
 */
function nextReasoning(
  current: EditorialReasoningLevel,
  verdict: NoteVerdict,
): EditorialReasoningLevel {
  if (verdict.rewriteKind === "voice" || verdict.rewriteKind === "preference") {
    return current;
  }
  return LEVELS[Math.min(LEVELS.indexOf(current) + 1, LEVELS.length - 1)]!;
}

function emit(
  snapshot: EditorialDraftSnapshot,
  onProgress: ((snapshot: EditorialDraftSnapshot) => void) | undefined,
): void {
  try {
    onProgress?.(structuredClone(snapshot));
  } catch {
    // Progress is observational. A view must not change publication.
  }
}

/**
 * Generate and review private editorial candidates.
 *
 * This is intentionally provider-agnostic. It owns the adaptive control loop;
 * callers own model construction, provider routing, context assembly, and the
 * Jev transport. A missing reviewer releases the first candidate as
 * `unreviewed`, preserving Twyne's existing graceful degradation without
 * inventing a passing judgement.
 */
export async function runAdaptiveEditorialDraft<T>(
  options: AdaptiveEditorialDraftOptions<T>,
): Promise<AdaptiveEditorialDraftResult<T>> {
  const maxAttempts = Math.min(
    MAX_REWRITES + 1,
    Math.max(1, Math.floor(options.maxAttempts ?? MAX_REWRITES + 1)),
  );
  const ceiling = options.maxReasoning ?? "high";
  let reasoning = clampLevel(
    options.initialReasoning ?? defaultReasoning(options.operation),
    ceiling,
  );
  const attempts: EditorialDraftAttempt[] = [];
  const reviewed: Array<{
    candidate: EditorialDraftCandidate<T>;
    verdict: NoteVerdict;
  }> = [];
  let selectedAttempt: number | null = null;
  let reason: string | null = null;
  let repair: string[] = [];
  const now = options.now ?? (() => performance.now());

  const snapshot = (
    phase: EditorialDraftPhase,
    attempt: number,
  ): EditorialDraftSnapshot => ({
    phase,
    attempt,
    maxAttempts,
    reasoning,
    attempts: structuredClone(attempts),
    selectedAttempt,
    reason,
  });

  const finish = (
    status: AdaptiveEditorialDraftResult<T>["status"],
    attempt: number,
    candidate?: EditorialDraftCandidate<T>,
    verdict?: NoteVerdict | null,
  ): AdaptiveEditorialDraftResult<T> => {
    emit(snapshot(status, attempt), options.onProgress);
    return {
      status,
      ...(candidate ? { candidate } : {}),
      ...(verdict !== undefined ? { verdict } : {}),
      receipt: snapshot(status, attempt),
    };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = now();
    emit(
      snapshot(repair.length > 0 ? "revising" : "drafting", attempt),
      options.onProgress,
    );

    let candidate: EditorialDraftCandidate<T>;
    try {
      candidate = await options.generate({
        attempt,
        reasoning,
        repair: [...repair],
      });
    } catch {
      attempts.push({
        attempt,
        reasoning,
        status: "generation-error",
        overall: null,
        vetoed: null,
        rewriteKind: null,
        generationMs: now() - started,
        reviewMs: 0,
      });
      reason = "generation-unavailable";
      continue;
    }

    const checkingAt = now();
    emit(snapshot("checking", attempt), options.onProgress);
    let verdict: NoteVerdict | null;
    try {
      verdict = await options.review(candidate);
    } catch {
      verdict = null;
    }

    // A transport failure is not a failed candidate. Preserve the original
    // runtime contract and identify the result as unreviewed.
    if (!verdict) {
      attempts.push({
        attempt,
        reasoning,
        status: "unreviewed",
        overall: null,
        vetoed: null,
        rewriteKind: null,
        generationMs: checkingAt - started,
        reviewMs: now() - checkingAt,
      });
      reason = "review-unavailable";
      selectedAttempt = attempt;
      return finish("unreviewed", attempt, candidate, null);
    }

    const status = verdict.pass ? "pass" : verdict.vetoed ? "fail" : "unknown";
    attempts.push({
      attempt,
      reasoning,
      status,
      overall: verdict.overall,
      vetoed: verdict.vetoed,
      rewriteKind: verdict.rewriteKind,
      generationMs: checkingAt - started,
      reviewMs: now() - checkingAt,
    });

    if (verdict.pass && !verdict.vetoed) {
      reviewed.push({ candidate, verdict });
      selectedAttempt = attempt;
      reason = null;
      return finish("released", attempt, candidate, verdict);
    }

    reviewed.push({ candidate, verdict });
    const action = noteAction(verdict, "filter", attempt - 1);
    if (!action.rewrite) {
      reason = verdict.vetoed ? "policy-veto" : "quality-bar";
      break;
    }

    repair = [rewriteInstruction(verdict)];
    reasoning = clampLevel(nextReasoning(reasoning, verdict), ceiling);
    reason = "candidate-needs-repair";
  }

  const nonVetoed = reviewed.filter(({ verdict }) => !verdict.vetoed);
  const best = bestAttempt(
    nonVetoed.map(({ candidate, verdict }) => ({ note: candidate, verdict })),
  );
  if (best) {
    selectedAttempt =
      attempts.find((attempt) => attempt.overall === best.verdict.overall)
        ?.attempt ?? null;
    reason = "best-available-candidate";
    return finish(
      "released",
      selectedAttempt ?? maxAttempts,
      best.note,
      best.verdict,
    );
  }

  reason = reason ?? "no-acceptable-candidate";
  return finish("withheld", maxAttempts);
}
