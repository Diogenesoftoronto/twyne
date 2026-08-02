import type { DossierProbe, ProjectInterviewAnswers } from "../types";
import type { InterviewMessage, InterviewTurnResult } from "./ai-client";
import { createAppError, successResult } from "./application-errors";
import type { ApplicationResult } from "../types/application-errors";

export const FORM_PROBE_COUNT = 3;

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
