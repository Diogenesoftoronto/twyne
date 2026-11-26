import { useStore, useVisibleTask$, type ReadonlySignal } from "@qwik.dev/core";
import type {
  ConstraintKind,
  ConstraintTriage,
  ProjectInterviewAnswers,
} from "../../types";
import { useAuth } from "../../utils/auth-context";
import {
  BRIEF_FIELD_ORDER,
  WRITER_SET,
  declaresNoConstraints,
  splitConstraints,
} from "../../utils/brief-facets";
import {
  buildBriefStrengthQuestions,
  buildBriefStrengthState,
  readBriefStrengths,
  sendDelay,
  standingFromViews,
  strangersFirstQuestion,
  strengthFor,
  toggleBinding,
  triageFromLines,
  type BriefField,
  type BriefStanding,
  type FirstQuestion,
  type JudgedStrength,
  type LineReading,
  type StrengthView,
  type Tension,
} from "../../utils/brief-strength";
import { useConvexClient } from "../../utils/convex-context";
import { askJudgement } from "../../utils/judgement-client";
import {
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "../../utils/system-one-budget";
import type { SystemOneAnswer } from "../../utils/system-one";

/** Failures that will not fix themselves by retrying on the next pause. */
const UNAVAILABLE = new Set(["signed out", "unconfigured", "unauthorized"]);

export interface BriefStrengthStore {
  judged: Partial<Record<BriefField, JudgedStrength>>;
  /** Constraint lines Jev (or the writer) has classified, by line text. */
  lines: Record<string, LineReading>;
  /** Fields Jev is reading right now. */
  reading: Partial<Record<BriefField, boolean>>;
  /** Probability the brief tells a stranger enough to write the piece. */
  sufficiency: number | null;
  /** Probability two answers pull against each other. */
  contradiction: number | null;
  /** How likely each field is to be a stranger's first question. */
  firstQuestionOdds: Partial<Record<BriefField, number>> | null;
  tension: Tension | null;
  /** Jev cannot be reached from here; only the quick read is shown. */
  unavailable: boolean;
  /** Bumped by settings or account changes to retry an unavailable Jev. */
  epoch: number;
  /**
   * Bump when the writer leaves a field or turns a page: whatever they wrote
   * is read now rather than at the next natural stopping point.
   */
  leave: number;
  /** The last `leave` the hook acted on. */
  leaveSeen: number;
  /** One request at a time; a newer brief waits for the one in the air. */
  inFlight: boolean;
  /** When the last request went out, to keep requests apart. */
  lastSentAt: number;
  /** Text that was sent and came back without a reading; not asked again. */
  tried: Partial<Record<BriefField, string>>;
}

/**
 * Live answer strength for a brief, shared by the form and the conversation.
 *
 * The quick read needs no state — `strengthFor` computes it at render. This
 * hook owns the Jev side, and nothing in it runs per keystroke: typing only
 * restarts a timer. A request goes out 350 ms after the writer stops typing,
 * or at once when they leave the field, and never within three seconds of
 * the last one. Every answer Jev has not read goes in that one batched
 * request, never more than one in the air, and each reading stays pinned to
 * the text it was made for. It spends from the shared System One budget, so
 * it cannot crowd out the editor's pause-driven callers.
 */
export function useBriefStrength(
  answers: ReadonlySignal<ProjectInterviewAnswers>,
  /** The filed brief's triage, so kinds the writer set by hand carry over. */
  filedTriage?: ConstraintTriage | null,
): BriefStrengthStore {
  const client = useConvexClient();
  const auth = useAuth();
  const store = useStore<BriefStrengthStore>({
    judged: {},
    lines: Object.fromEntries(
      (filedTriage?.lines ?? []).map((line) => [
        line.text,
        {
          kind: line.kind,
          confidence: line.confidence,
          ...(line.confidence === WRITER_SET ? { pinned: true } : {}),
        },
      ]),
    ),
    reading: {},
    sufficiency: null,
    contradiction: null,
    firstQuestionOdds: null,
    tension: null,
    unavailable: false,
    epoch: 0,
    leave: 0,
    leaveSeen: 0,
    inFlight: false,
    lastSentAt: 0,
    tried: {},
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
    const leave = track(() => store.leave);
    track(() => auth.value.user?.id);
    // A request in the air bumps `epoch` when it lands, which re-runs this
    // with whatever the writer has typed since.
    if (store.unavailable || store.inFlight) return;

    const isStale = (field: BriefField) => {
      const value = snapshot[field]?.trim();
      if (!value || store.tried[field] === value) return false;
      if (field !== "constraints") return store.judged[field]?.value !== value;
      return (
        !declaresNoConstraints(value) &&
        splitConstraints(value).some((line) => !store.lines[line])
      );
    };
    const stale = BRIEF_FIELD_ORDER.filter(isStale);
    if (stale.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const wait = systemOneWait();
      if (wait > 0) {
        timer = setTimeout(run, wait);
        return;
      }
      const opts = { knownLines: Object.keys(store.lines) };
      const reading: Partial<Record<BriefField, boolean>> = {};
      for (const field of stale) reading[field] = true;
      store.reading = reading;
      store.inFlight = true;
      store.lastSentAt = Date.now();
      spendSystemOne();
      let result: Awaited<ReturnType<typeof askJudgement>>;
      try {
        result = await askJudgement(client.value, {
          state: buildBriefStrengthState(snapshot),
          questions: buildBriefStrengthQuestions(snapshot, stale, opts),
        });
      } catch {
        result = { ok: false, error: "network" };
      }
      store.reading = {};
      store.inFlight = false;
      if (!result.ok || !result.answers) {
        if (result.error && UNAVAILABLE.has(result.error))
          store.unavailable = true;
        else backOffSystemOne();
        return;
      }
      // Kept even when the writer typed on: each reading is pinned to the
      // text it read, so fields they didn't touch are still current.
      const read = readBriefStrengths(
        snapshot,
        stale,
        result.answers as Record<string, SystemOneAnswer>,
        opts,
      );
      // Each new judgement carries how far the number moved since the last
      // one, so the writer can see what an edit did.
      for (const [field, next] of Object.entries(read.fields)) {
        const before = store.judged[field as BriefField];
        if (
          before &&
          before.value !== next.value &&
          before.score !== undefined &&
          next.score !== undefined
        )
          next.delta = next.score - before.score;
      }
      store.judged = { ...store.judged, ...read.fields };
      // A line the writer set by hand keeps their kind.
      const lines = { ...store.lines };
      for (const [text, line] of Object.entries(read.lines))
        if (!lines[text]?.pinned) lines[text] = line;
      store.lines = lines;
      const tried = { ...store.tried };
      for (const field of stale) {
        const came =
          field === "constraints"
            ? Object.keys(read.lines).length > 0
            : !!read.fields[field];
        if (!came) tried[field] = snapshot[field].trim();
      }
      store.tried = tried;
      if (read.sufficiency !== null) store.sufficiency = read.sufficiency;
      if (read.contradiction !== null) {
        store.contradiction = read.contradiction;
        store.tension = read.tension;
      }
      if (read.firstQuestionOdds)
        store.firstQuestionOdds = read.firstQuestionOdds;
      store.epoch++;
    };

    // Every keystroke re-runs this task, and the cleanup below cancels the
    // timer, so the wait always counts from the last key pressed.
    const left = leave !== store.leaveSeen;
    store.leaveSeen = leave;
    timer = setTimeout(
      run,
      sendDelay(left ? "leave" : "pause", Date.now() - store.lastSentAt),
    );
    cleanup(() => {
      if (timer) clearTimeout(timer);
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
  for (const field of BRIEF_FIELD_ORDER)
    views[field] = strengthFor(
      field,
      answers[field] ?? "",
      store.judged[field],
      store.lines,
    );
  return views;
}

export interface BriefWhole {
  standing: BriefStanding;
  firstQuestion: FirstQuestion | null;
  /** Shown only while both answers still read as they did when judged. */
  tension: Tension | null;
}

/** The whole-brief reading for the working copy, from the current views. */
export function briefWhole(
  answers: ProjectInterviewAnswers,
  store: BriefStrengthStore,
  views: Partial<Record<BriefField, StrengthView>>,
): BriefWhole {
  const tension =
    store.tension &&
    answers[store.tension.a]?.trim() === store.tension.values[0] &&
    answers[store.tension.b]?.trim() === store.tension.values[1]
      ? store.tension
      : null;
  return {
    standing: standingFromViews(views, {
      sufficiency: store.sufficiency,
      // A pull between two answers that have since changed is no longer news.
      contradiction: store.tension && !tension ? null : store.contradiction,
    }),
    firstQuestion: strangersFirstQuestion(
      answers,
      views,
      store.firstQuestionOdds,
    ),
    tension,
  };
}

/** The writer's tap on a line's label: binding ↔ weighed, and it sticks. */
export function overrideConstraintLine(
  store: BriefStrengthStore,
  text: string,
): void {
  const current: ConstraintKind = store.lines[text]?.kind ?? "preference";
  store.lines = {
    ...store.lines,
    [text]: {
      kind: toggleBinding(current),
      confidence: WRITER_SET,
      pinned: true,
    },
  };
}

/** The triage to file with the brief, once every line has been read. */
export function constraintTriageFor(
  answers: ProjectInterviewAnswers,
  store: BriefStrengthStore,
): ConstraintTriage | null {
  return triageFromLines(answers.constraints ?? "", store.lines);
}
