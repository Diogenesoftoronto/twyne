/**
 * The background room — the editors read as you write.
 *
 * Convening is expensive and deliberate: five model calls over the whole
 * manuscript, triggered by a button. That is the right shape for "tell me what
 * you think", and the wrong shape for "keep up with me". So this module runs
 * the same five editors on a much narrower brief — only the material that is
 * new since they last looked, plus a digest of how the draft has been moving —
 * on a trigger tuned to catch the moment a writer finishes a thought.
 *
 * The trigger has two conditions, and both must hold:
 *
 *   1. At least {@link WORD_DELTA_THRESHOLD} net new words since the last pass.
 *      Fiddling with a sentence is not something to interrupt over.
 *   2. Then {@link IDLE_MS} of no typing. This is an *idle* timer, not a
 *      debounce window: every keystroke pushes it back, so the room waits
 *      until the writer has actually stopped rather than firing mid-paragraph.
 *
 * On top of that sit two spend guards — a hard floor between passes and a
 * per-session cap — because this runs without the writer asking, and anything
 * that spends their money unasked should be conservative by construction.
 *
 * Structurally this mirrors `background-research.ts`, which already solved the
 * same watcher problem for the Apparatus.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { toAgentPersona } from "../../convex/agentPrompts";
import type { Persona, PersonaFeedback, ProjectBrief } from "../types";
import {
  MIN_EDITOR_WORDS,
  WORDS_PER_FOLIO,
  countWords,
} from "./draft-thresholds";
import {
  appendTrajectory,
  diffParagraphs,
  entryFromDiff,
  loadTrajectory,
  trajectoryDigest,
} from "./draft-trajectory";
import { hasConfiguredAiProvider, runClientAgent } from "./ai-client";
import { getCachedAiSettings } from "./ai-orchestrator";
import { loadWriterSettingsFromIdb } from "./idb";
import { savePersonaNoteLocally } from "./convex-sync";
import { reportApplicationDiagnostic } from "./application-diagnostics";

/** Wait for another substantive folio before automatically reading again. */
export const WORD_DELTA_THRESHOLD = WORDS_PER_FOLIO;

/** Quiet time required after that threshold is crossed. */
export const IDLE_MS = 120_000;

/**
 * Hard floor between passes, independent of how much gets written. Protects
 * against a fast writer triggering back-to-back five-call passes, and keeps us
 * well inside the server's `agentRoom` rate limit of 6/min.
 */
export const MIN_INTERVAL_MS = 5 * 60_000;

/** Passes allowed per session, so a long day can't run away with spend. */
export const MAX_PASSES_PER_SESSION = 8;

export type BackgroundRoomStatus =
  | "off"
  | "idle"
  | "armed"
  | "reading"
  | "error";

export interface BackgroundRoomSnapshot {
  status: BackgroundRoomStatus;
  /** Net new words accumulated since the last pass. */
  pendingWords: number;
  passesThisSession: number;
  lastPassAt: number;
  lastNoteCount: number;
  folioId: string | null;
  error?: string;
}

interface RoomState {
  status: BackgroundRoomStatus;
  pendingWords: number;
  passesThisSession: number;
  lastPassAt: number;
  lastNoteCount: number;
  error?: string;
}

const state: RoomState = {
  status: "off",
  pendingWords: 0,
  passesThisSession: 0,
  lastPassAt: 0,
  lastNoteCount: 0,
};

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeClient: ConvexClient | null = null;
let activeBrief: ProjectBrief | null = null;
let activeFolioId: string | null = null;
let activePersonas: Persona[] = [];
let enabled = false;
/** Text as of the last completed pass — the baseline for "what is new". */
let lastReadText = "";
/** Most recent draft text seen, so the idle timer has something to work on. */
let latestText = "";
let running = false;

export function snapshot(): BackgroundRoomSnapshot {
  return {
    status: state.status,
    pendingWords: state.pendingWords,
    passesThisSession: state.passesThisSession,
    lastPassAt: state.lastPassAt,
    lastNoteCount: state.lastNoteCount,
    folioId: activeFolioId,
    error: state.error,
  };
}

function notify(): void {
  if (typeof window === "undefined") return;
  if (typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(
    new CustomEvent("twyne:background-room", { detail: snapshot() }),
  );
}

function setStatus(status: BackgroundRoomStatus, error?: string): void {
  state.status = status;
  state.error = error;
  notify();
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Configure the watcher. Safe to call repeatedly — the latest arguments win,
 * which is what the editor route needs when the writer switches folio.
 */
export function startBackgroundRoom(args: {
  /** Undefined when Qwik has not yet resumed the client — treated as absent. */
  client: ConvexClient | null | undefined;
  brief: ProjectBrief | null;
  folioId: string | null;
  personas: Persona[];
  enabled: boolean;
  /** Current draft text, used as the baseline so existing prose isn't "new". */
  baselineText?: string;
}): void {
  const folioChanged = args.folioId !== activeFolioId;
  activeClient = args.client ?? null;
  activeBrief = args.brief;
  activeFolioId = args.folioId;
  activePersonas = args.personas;
  enabled = args.enabled;

  if (folioChanged) {
    // A new folio is a new conversation: everything already on the page has
    // been "read" as far as the background room is concerned, so the writer
    // isn't ambushed by five notes on prose they wrote last week.
    lastReadText = args.baselineText ?? "";
    latestText = lastReadText;
    state.pendingWords = 0;
    clearIdleTimer();
  } else if (args.baselineText !== undefined && !lastReadText) {
    lastReadText = args.baselineText;
    latestText = args.baselineText;
  }

  setStatus(enabled ? "idle" : "off");
}

/**
 * Turn the watcher on or off without tearing down its baseline, so flipping
 * the setting twice does not make the whole draft look new.
 */
export function setBackgroundRoomEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  if (!next) {
    clearIdleTimer();
    setStatus("off");
    return;
  }
  setStatus("idle");
  // Re-evaluate against the text we already have, so switching it back on
  // mid-session picks up work done while it was off rather than waiting for
  // the next keystroke.
  if (latestText) onDraftChanged(latestText);
}

export function stopBackgroundRoom(): void {
  clearIdleTimer();
  enabled = false;
  activeClient = null;
  activeFolioId = null;
  activePersonas = [];
  lastReadText = "";
  latestText = "";
  state.pendingWords = 0;
  state.status = "off";
}

/**
 * The writer convened the room explicitly, so everything currently on the page
 * has now been read. Rebaselines from the watcher's own `latestText` rather
 * than from a caller-supplied string: the caller reads the draft through a
 * different path (`editor.getText()`) than the watcher does
 * (`paragraphTextFromHtml`), and the two must not be allowed to disagree about
 * where paragraphs begin — a mis-aligned baseline would make the next diff
 * report the whole document as new.
 */
export function noteExplicitConvene(): void {
  lastReadText = latestText;
  state.pendingWords = 0;
  state.lastPassAt = Date.now();
  clearIdleTimer();
  setStatus(enabled ? "idle" : "off");
}

/**
 * Notify the watcher that the draft changed. Cheap enough to call on every
 * keystroke: it does a word count and resets a timer.
 */
export function onDraftChanged(draftText: string): void {
  if (!enabled || !activeFolioId) return;
  latestText = draftText;

  const delta = countWords(draftText) - countWords(lastReadText);
  state.pendingWords = delta;

  if (delta < WORD_DELTA_THRESHOLD) {
    // Below the threshold there is nothing to wait for; drop any armed timer
    // so a writer who deletes back down doesn't get a pass on stale material.
    if (state.status === "armed") {
      clearIdleTimer();
      setStatus("idle");
    }
    return;
  }

  // Armed: wait for the writer to stop. Every keystroke pushes this back.
  clearIdleTimer();
  if (state.status !== "armed") setStatus("armed");
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void runPass();
  }, IDLE_MS);
}

/** Reasons a pass may be declined, for tests and diagnostics. */
export type SkipReason =
  | "disabled"
  | "no-folio"
  | "already-running"
  | "session-cap"
  | "too-soon"
  | "too-short"
  | "no-new-material"
  | "no-provider";

export function whyNotReady(now: number = Date.now()): SkipReason | null {
  if (!enabled) return "disabled";
  if (!activeFolioId) return "no-folio";
  if (running) return "already-running";
  if (state.passesThisSession >= MAX_PASSES_PER_SESSION) return "session-cap";
  if (state.lastPassAt > 0 && now - state.lastPassAt < MIN_INTERVAL_MS) {
    return "too-soon";
  }
  if (countWords(latestText) < MIN_EDITOR_WORDS) return "too-short";
  return null;
}

/**
 * Run a pass now, bypassing the idle wait but not the spend guards. Returns
 * the notes produced, or an empty array when the pass was declined.
 */
export async function runPass(): Promise<PersonaFeedback[]> {
  const blocked = whyNotReady();
  if (blocked) {
    if (blocked !== "already-running") setStatus(enabled ? "idle" : "off");
    return [];
  }

  const draftText = latestText;
  const diff = diffParagraphs(lastReadText, draftText);
  if (diff.added.length === 0) {
    // Words moved but no paragraph is genuinely new — nothing to read.
    state.pendingWords = 0;
    setStatus("idle");
    return [];
  }

  running = true;
  setStatus("reading");
  const folioId = activeFolioId!;

  try {
    // Record the movement before the call, so the digest the editors receive
    // includes the material they are about to read.
    const entry = entryFromDiff(diff);
    const history = entry
      ? await appendTrajectory(folioId, entry)
      : await loadTrajectory(folioId);
    const digest = trajectoryDigest(history);
    const newMaterial = diff.added.join("\n\n");

    const responses = await conveneQuietly({
      draftText,
      newMaterial,
      trajectory: digest,
    });
    if (responses.length === 0) {
      setStatus("idle");
      return [];
    }

    const timestamp = Date.now();
    const notes: PersonaFeedback[] = [];
    for (const r of responses) {
      const persona = activePersonas.find((p) => p.id === r.personaId);
      if (!persona || !r.text.trim()) continue;
      const note: PersonaFeedback = {
        folioId: activeFolioId!,
        personaId: r.personaId,
        personaName: persona.name,
        personaColor: persona.color,
        feedback: r.text,
        timestamp,
        type: r.type,
        anchor: r.anchor,
        noteId: `bg-${r.personaId}-${timestamp}`,
        origin: "background",
      };
      notes.push(note);
      await savePersonaNoteLocally(note, activeBrief, activeFolioId!);
    }

    lastReadText = draftText;
    state.pendingWords = 0;
    state.lastPassAt = timestamp;
    state.passesThisSession += 1;
    state.lastNoteCount = notes.length;

    if (typeof window !== "undefined" && notes.length > 0) {
      window.dispatchEvent(
        new CustomEvent("twyne:background-room-notes", { detail: notes }),
      );
    }
    setStatus("idle");
    return notes;
  } catch (err) {
    reportApplicationDiagnostic("twyne:background-room:pass", err, {
      feature: "background-room",
      operation: "pass",
    });
    setStatus("error", (err as Error)?.message);
    return [];
  } finally {
    running = false;
  }
}

interface QuietResponse {
  personaId: string;
  text: string;
  type: PersonaFeedback["type"];
  provider: string;
  anchor?: string;
}

/**
 * Run the five editors over the new material. BYOK first, then the server
 * action — the same order the Cast panel uses, so the background room and the
 * explicit convene never disagree about which provider is in play.
 *
 * Returns an empty array rather than throwing when no provider is reachable:
 * a background pass that quietly does nothing is correct, while an error toast
 * the writer never asked for is not.
 */
async function conveneQuietly(input: {
  draftText: string;
  newMaterial: string;
  trajectory: string;
}): Promise<QuietResponse[]> {
  const settings = await getCachedAiSettings();
  const writerProfile = (await loadWriterSettingsFromIdb()).profile;

  if (hasConfiguredAiProvider(settings)) {
    const results = await Promise.all(
      activePersonas.map(async (p) => {
        const res = await runClientAgent(
          "persona-feedback",
          {
            persona: toAgentPersona(p),
            brief: activeBrief,
            draftText: input.draftText,
            writerProfile,
            newMaterial: input.newMaterial,
            trajectory: input.trajectory,
            instruction: "feedback" as const,
          },
          settings,
        );
        if (!res || !res.text.trim() || res.provider === "local") return null;
        const note: QuietResponse = {
          personaId: p.id,
          text: res.text,
          type: res.type,
          provider: res.provider,
          anchor: res.anchor,
        };
        return note;
      }),
    );
    return results.filter((r): r is QuietResponse => r !== null);
  }

  if (!activeClient) return [];
  const result = (await activeClient.action(api.agents.conveneRoom, {
    personas: activePersonas.map(toAgentPersona),
    brief: activeBrief ?? null,
    draftText: input.draftText,
    writerProfile,
    newMaterial: input.newMaterial,
    trajectory: input.trajectory,
  })) as QuietResponse[];
  return result.filter((r) => r.text.trim() && r.provider !== "local");
}

/**
 * The trajectory digest for the active folio, for the explicit convene and
 * rubric passes to include. Empty string when there is no history.
 */
export async function currentTrajectoryDigest(): Promise<string> {
  if (!activeFolioId) return "";
  return trajectoryDigest(await loadTrajectory(activeFolioId));
}

/** Test seam: reset all module state between cases. */
export function __resetForTests(): void {
  clearIdleTimer();
  state.status = "off";
  state.pendingWords = 0;
  state.passesThisSession = 0;
  state.lastPassAt = 0;
  state.lastNoteCount = 0;
  state.error = undefined;
  activeClient = null;
  activeBrief = null;
  activeFolioId = null;
  activePersonas = [];
  enabled = false;
  lastReadText = "";
  latestText = "";
  running = false;
}
