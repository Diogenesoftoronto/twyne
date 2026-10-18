import { useStore, useVisibleTask$, type ReadonlySignal } from "@qwik.dev/core";
import type { ProjectInterviewAnswers } from "../../types";
import { useAuth } from "../../utils/auth-context";
import { BRIEF_FIELDS } from "../../utils/brief-coach";
import {
  buildBriefStrengthQuestions,
  buildBriefStrengthState,
  readBriefStrengths,
  strengthFor,
  type BriefField,
  type JudgedStrength,
  type StrengthView,
} from "../../utils/brief-strength";
import { useConvexClient } from "../../utils/convex-context";
import { askJudgement } from "../../utils/judgement-client";
import {
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "../../utils/system-one-budget";
import type { SystemOneAnswer } from "../../utils/system-one";

/** Long enough to be a pause, short enough to feel like a reply. */
const PAUSE_MS = 900;

/** Failures that will not fix themselves by retrying on the next pause. */
const UNAVAILABLE = new Set(["signed out", "unconfigured", "unauthorized"]);

export interface BriefStrengthStore {
  judged: Partial<Record<BriefField, JudgedStrength>>;
  /** Fields Jev is reading right now. */
  reading: Partial<Record<BriefField, boolean>>;
  /** Probability a stranger could write the piece from this brief. */
  sufficiency: number | null;
  /** Jev cannot be reached from here; only the quick read is shown. */
  unavailable: boolean;
  /** Bumped by settings or account changes to retry an unavailable Jev. */
  epoch: number;
}

/**
 * Live answer strength for a brief, shared by the form and the conversation.
 *
 * The quick read needs no state — `strengthFor` computes it at render. This
 * hook only owns the Jev side: on a pause it batches every filled field whose
 * text Jev hasn't read yet into one request, and keeps each reading pinned to
 * the text it was made for. It spends from the shared System One budget, so
 * it cannot crowd out the editor's pause-driven callers.
 */
export function useBriefStrength(
  answers: ReadonlySignal<ProjectInterviewAnswers>,
): BriefStrengthStore {
  const client = useConvexClient();
  const auth = useAuth();
  const store = useStore<BriefStrengthStore>({
    judged: {},
    reading: {},
    sufficiency: null,
    unavailable: false,
    epoch: 0,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const retry = () => {
      store.unavailable = false;
      store.epoch++;
    };
    window.addEventListener("twyne:ai-settings-saved", retry);
    cleanup(() => window.removeEventListener("twyne:ai-settings-saved", retry));
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const snapshot = { ...track(() => answers.value) };
    track(() => store.epoch);
    track(() => auth.value.user?.id);
    if (store.unavailable) return;

    const stale = BRIEF_FIELDS.filter((field) => {
      const value = snapshot[field]?.trim();
      return value && store.judged[field]?.value !== value;
    });
    if (stale.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const wait = systemOneWait();
      if (wait > 0) {
        timer = setTimeout(run, wait);
        return;
      }
      const reading: Partial<Record<BriefField, boolean>> = {};
      for (const field of stale) reading[field] = true;
      store.reading = reading;
      spendSystemOne();
      let result: Awaited<ReturnType<typeof askJudgement>>;
      try {
        result = await askJudgement(client.value, {
          state: buildBriefStrengthState(snapshot),
          questions: buildBriefStrengthQuestions(snapshot, stale),
        });
      } catch {
        result = { ok: false, error: "network" };
      }
      if (!cancelled) store.reading = {};
      if (!result.ok || !result.answers) {
        if (result.error && UNAVAILABLE.has(result.error))
          store.unavailable = true;
        else if (!cancelled) backOffSystemOne();
        return;
      }
      // Kept even when the writer typed on: each reading is pinned to the
      // text it read, so fields they didn't touch are still current.
      const read = readBriefStrengths(
        snapshot,
        stale,
        result.answers as Record<string, SystemOneAnswer>,
      );
      store.judged = { ...store.judged, ...read.fields };
      if (read.sufficiency !== null) store.sufficiency = read.sufficiency;
    };
    timer = setTimeout(run, PAUSE_MS);
    cleanup(() => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      store.reading = {};
    });
  });

  return store;
}

/** Every field's current strength: Jev where it has read the text, else quick. */
export function briefStrengthViews(
  answers: ProjectInterviewAnswers,
  store: BriefStrengthStore,
): Partial<Record<BriefField, StrengthView>> {
  const views: Partial<Record<BriefField, StrengthView>> = {};
  for (const field of BRIEF_FIELDS)
    views[field] = strengthFor(
      field,
      answers[field] ?? "",
      store.judged[field],
    );
  return views;
}
