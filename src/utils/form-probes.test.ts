import { describe, expect, test } from "bun:test";
import type { DossierProbe, ProjectInterviewAnswers } from "../types";
import type { InterviewTurnResult } from "./ai-client";
import { buildFormProbeMessages, requireFormProbe } from "./form-probes";

const answers: ProjectInterviewAnswers = {
  workingTitle: "The Particulars",
  format: "Essay",
  audience: "Editors",
  goal: "Explain the failure",
  tone: "Exact",
  constraints: "Keep the writer's answers",
  successSignal: "The recovery path is visible",
};

const probe: DossierProbe = {
  id: "probe-1",
  kind: "choice",
  prompt: "Which reader needs the most convincing?",
  options: ["Editors", "Writers"],
};

describe("buildFormProbeMessages", () => {
  test("includes current answers and previously collected questions", () => {
    const messages = buildFormProbeMessages(answers, [probe]);

    expect(messages[1]?.text).toContain("Working title: The Particulars");
    expect(messages[1]?.text).toContain("Goal: Explain the failure");
    expect(messages.at(-2)).toEqual({
      author: "interviewer",
      text: probe.prompt,
    });
  });
});

describe("requireFormProbe", () => {
  test("accepts a renderable typed question", () => {
    const result: InterviewTurnResult = {
      kind: "question",
      text: probe.prompt,
      probe,
      provider: "test",
      model: "test",
    };

    expect(requireFormProbe(result)).toEqual({ ok: true, value: probe });
  });

  test.each([
    ["an empty response", null],
    [
      "a prose-only question",
      {
        kind: "question",
        text: "Tell me more.",
        provider: "test",
        model: "test",
      },
    ],
    [
      "an unexpected synthesis",
      {
        kind: "synthesis",
        brief: answers,
        confidence: {},
        provider: "test",
        model: "test",
      },
    ],
  ])("turns %s into a safe, retryable error", (_label, result) => {
    const checked = requireFormProbe(result as InterviewTurnResult | null);

    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.error.code).toBe("MALFORMED_RESPONSE");
    expect(checked.error.recovery).toEqual({
      action: "retry",
      canRetry: true,
    });
    expect(checked.error.message).not.toContain("Tell me more");
  });
});
