import type { DossierProbe, ProjectInterviewAnswers } from "../types";
import type { InterviewMessage, InterviewTurnResult } from "./ai-client";
import { createAppError, successResult } from "./application-errors";
import type { ApplicationResult } from "../types/application-errors";
import { isAnswered } from "./dossier-probes";

export const FORM_PROBE_COUNT = 3;

function compact(value: string, fallback: string, max = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim() || fallback;
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function probeIdentity(probe: DossierProbe): string {
  return probe.prompt.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * Merge generated questions without changing the order in which the writer
 * saw them. IDs are useful for answer updates, while prompt identity catches
 * providers that return the same question with a fresh random ID.
 *
 * An answered copy always wins over an unanswered duplicate so retries cannot
 * erase a choice the writer already made.
 */
export function mergeFormProbes(
  ...groups: ReadonlyArray<ReadonlyArray<DossierProbe>>
): DossierProbe[] {
  return mergeFormProbesWithLimit(FORM_PROBE_COUNT, ...groups);
}

export function mergeFormProbesWithLimit(
  limit: number,
  ...groups: ReadonlyArray<ReadonlyArray<DossierProbe>>
): DossierProbe[] {
  const merged: DossierProbe[] = [];
  const indexById = new Map<string, number>();
  const indexByPrompt = new Map<string, number>();
  const boundedLimit = Math.max(0, Math.floor(limit));

  for (const probe of groups.flat()) {
    const promptKey = probeIdentity(probe);
    const existingIndex =
      indexById.get(probe.id) ?? indexByPrompt.get(promptKey);
    if (existingIndex === undefined) {
      if (merged.length >= boundedLimit) continue;
      const index = merged.push(probe) - 1;
      indexById.set(probe.id, index);
      indexByPrompt.set(promptKey, index);
      continue;
    }

    if (!isAnswered(merged[existingIndex]!) && isAnswered(probe)) {
      merged[existingIndex] = probe;
      indexById.set(probe.id, existingIndex);
      indexByPrompt.set(promptKey, existingIndex);
    }
  }

  return merged;
}

/**
 * Install provider questions without losing answers entered while the
 * provider request was in flight. The current store is the authority here;
 * callers must not reuse the answered snapshot captured before awaiting.
 */
export function mergeProviderFormProbes(
  current: ReadonlyArray<DossierProbe>,
  provider: ReadonlyArray<DossierProbe>,
  localFallback: ReadonlyArray<DossierProbe>,
): DossierProbe[] {
  const answered = current.filter(isAnswered);
  const visibleQuestionLimit = Math.max(FORM_PROBE_COUNT, answered.length);
  return mergeFormProbesWithLimit(
    visibleQuestionLimit,
    answered,
    provider,
    localFallback,
  );
}

/**
 * Questions that require no account, provider, or network connection.
 *
 * The form is explicitly a local-first entry point, so the Particulars step
 * cannot become an empty AI-shaped hole when the writer chooses "just check
 * things out." These are deterministic but still use the writer's current
 * title, reader, goal, tone, and constraints rather than presenting a generic
 * questionnaire.
 */
export function buildLocalFormProbes(
  answers: ProjectInterviewAnswers,
): DossierProbe[] {
  const title = compact(answers.workingTitle, "this piece", 54);
  const audience = compact(answers.audience, "the intended reader", 68);
  const goal = compact(answers.goal, "the central goal", 68);
  const tone = compact(answers.tone, "the intended voice", 62);
  const constraints = compact(
    answers.constraints,
    "the promise the draft must keep",
    68,
  );

  return [
    {
      id: "local-particular-reader-change",
      kind: "blanks",
      prompt: `For ${audience}, what should change by the end of “${title}”?`,
      template: "They begin ___ and leave ___",
      relatesTo: "successSignal",
    },
    {
      id: "local-particular-goal",
      kind: "choice",
      prompt: `Which result matters most for this goal: ${goal}?`,
      options: [
        "Understand the central idea",
        "Change a belief",
        "Take a specific action",
        "Feel the stakes",
      ],
      relatesTo: "goal",
    },
    {
      id: "local-particular-protection",
      kind: "scale",
      prompt: `How firmly should the room protect “${tone}” while honoring ${constraints}?`,
      min: 1,
      max: 5,
      minLabel: "Flexible",
      maxLabel: "Non-negotiable",
      relatesTo: "tone",
    },
  ];
}

/**
 * Build the form interview from the writer's current answers. Each subsequent
 * request includes the probes already collected so the model does not ask the
 * same question three ways.
 */
export function buildFormProbeMessages(
  answers: ProjectInterviewAnswers,
  collected: DossierProbe[],
): InterviewMessage[] {
  return [
    {
      author: "interviewer",
      text: "Tell me about the piece — the form, the reader, the goal, the tone, the constraints, and how you'll know it landed.",
    },
    {
      author: "writer",
      text: [
        `Working title: ${answers.workingTitle}`,
        `Format: ${answers.format}`,
        `Audience: ${answers.audience}`,
        `Goal: ${answers.goal}`,
        `Tone: ${answers.tone}`,
        `Constraints: ${answers.constraints}`,
        `Success signal: ${answers.successSignal}`,
      ].join("\n"),
    },
    {
      author: "writer",
      text: "(ask me one sharp follow-up as a typed question — a choice, a scale, or a fill-in-the-blanks — about whichever of those answers is vaguest)",
    },
    ...collected.flatMap((probe) => [
      { author: "interviewer" as const, text: probe.prompt },
      { author: "writer" as const, text: "(noted — ask another)" },
    ]),
  ];
}

/**
 * The Particulars page can only render typed probes. Treat a prose-only,
 * synthesis, or empty response as a failed response contract instead of
 * presenting an empty page as a successful result.
 */
export function requireFormProbe(
  result: InterviewTurnResult | null,
): ApplicationResult<DossierProbe> {
  if (result?.kind === "question" && result.probe) {
    return successResult(result.probe);
  }

  return {
    ok: false,
    error: createAppError("MALFORMED_RESPONSE", {
      source: "provider",
      recovery: { action: "retry", canRetry: true },
      metadata: {
        feature: "interview",
        operation: "form-probes",
        kind: result?.kind ?? "empty",
      },
    }),
  };
}
