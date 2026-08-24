import { describe, expect, test } from "bun:test";
import type { DossierProbe, ProjectInterviewAnswers } from "../types";
import type { InterviewTurnResult } from "./ai-client";
import {
  buildFormProbeMessages,
  buildLocalFormProbes,
  FORM_PROBE_COUNT,
  mergeFormProbes,
  mergeFormProbesWithLimit,
  mergeProviderFormProbes,
  requireFormProbe,
} from "./form-probes";

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

describe("buildLocalFormProbes", () => {
  test("always produces an ordered local-first Particulars set", () => {
    const probes = buildLocalFormProbes(answers);

    expect(probes).toHaveLength(FORM_PROBE_COUNT);
    expect(probes.map((item) => item.kind)).toEqual([
      "blanks",
      "choice",
      "scale",
    ]);
    expect(probes[0]?.prompt).toContain(answers.audience);
    expect(probes[1]?.prompt).toContain(answers.goal);
    expect(probes[2]?.prompt).toContain(answers.tone);
    expect(new Set(probes.map((item) => item.prompt)).size).toBe(
      FORM_PROBE_COUNT,
    );
  });

  test("handles empty and very long answers without empty or unbounded copy", () => {
    const probes = buildLocalFormProbes({
      workingTitle: "",
      format: "",
      audience: "reader ".repeat(100),
      goal: "",
      tone: "",
      constraints: "",
      successSignal: "",
    });

    expect(probes).toHaveLength(FORM_PROBE_COUNT);
    expect(probes.every((item) => item.prompt.trim().length > 0)).toBe(true);
    expect(Math.max(...probes.map((item) => item.prompt.length))).toBeLessThan(
      240,
    );
  });
});

describe("mergeFormProbes", () => {
  test("preserves order, removes duplicate IDs and prompts, and caps the set", () => {
    const duplicatePrompt = {
      ...probe,
      id: "different-id",
      prompt: `  ${probe.prompt.toUpperCase()}  `,
    };
    const extra = buildLocalFormProbes(answers);

    const merged = mergeFormProbes([probe], [duplicatePrompt], extra);

    expect(merged).toHaveLength(FORM_PROBE_COUNT);
    expect(merged[0]).toEqual(probe);
    expect(
      merged.filter(
        (item) =>
          item.prompt.trim().toLowerCase() === probe.prompt.toLowerCase(),
      ),
    ).toHaveLength(1);
  });

  test("keeps an answered duplicate over an unanswered copy", () => {
    const answered = { ...probe, answer: "Editors" };

    const merged = mergeFormProbes([probe], [answered]);

    expect(merged).toEqual([answered]);
  });

  test("can preserve more previously answered questions than the generation limit", () => {
    const answered = buildLocalFormProbes(answers).map((item, index) => ({
      ...item,
      id: `answered-${index}`,
      answer:
        item.kind === "scale"
          ? 4
          : item.kind === "blanks"
            ? ["uncertain", "clear"]
            : "Change a belief",
    }));
    answered.push({
      ...probe,
      id: "answered-extra",
      answer: "Editors",
    });

    expect(mergeFormProbesWithLimit(answered.length, answered)).toHaveLength(
      answered.length,
    );
  });

  test("preserves an answer entered while provider probes were loading", () => {
    const local = buildLocalFormProbes(answers);
    const answeredDuringRequest = local.map((item, index) =>
      index === 0 ? { ...item, answer: ["uncertain", "clear"] } : item,
    );
    const provider = [
      {
        ...probe,
        id: "provider-particular",
        prompt: "What evidence should change the reader's mind?",
      },
    ];

    const merged = mergeProviderFormProbes(
      answeredDuringRequest,
      provider,
      local,
    );

    expect(merged.find((item) => item.id === local[0]?.id)?.answer).toEqual([
      "uncertain",
      "clear",
    ]);
    expect(merged.some((item) => item.id === "provider-particular")).toBe(
      true,
    );
  });
});
