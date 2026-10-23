/**
 * The generation loop's contract with reasoning models.
 *
 * A model whose chat template always opens a `<think>` block used to cost two
 * calls for every note: the first reply was discarded on sight of the tag and
 * asked for again. These tests pin the replacement rule — regenerate only when
 * nothing visible survived — because the failure it guards against is silent.
 * Nothing breaks; the app is simply twice as slow and twice as expensive on
 * exactly the models that can least afford it.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import type { AiSettings } from "../types";
import type { AgentRequest } from "../../convex/agentPrompts";
import type { ClientUsageAttemptInput } from "./usage-ledger";

/** Replies handed to the mocked provider, one per call. */
let replies: string[] = [];
let calls: {
  prompt: string;
  system?: string;
  model: unknown;
  providerOptions?: unknown;
}[] = [];
let usageAttempts: ClientUsageAttemptInput[] = [];

// These mocks are process-global under Bun's full-suite worker, so re-register
// them for this file and keep them to a narrow override: spread the real
// modules so any other file co-located in the worker still sees a complete
// module, and count on a later mock.module() registration replacing this one.
const realAi = await import(
  `${createRequire(import.meta.url).resolve("ai")}?ai-client-reasoning-test-real`
);
const realAiEvals = await import(
  `${createRequire(import.meta.url).resolve("./ai-evals")}?ai-client-reasoning-test-real`
);

// Spread the real SDK so only the two functions under test are stubbed: any
// other file in the same worker still sees a complete `ai` module instead of
// a partial stand-in, and a later mock.module() registration replaces this
// one anyway.
mock.module("ai", () => ({
  ...realAi,
  generateText: async ({
    prompt,
    system,
    model,
    providerOptions,
  }: {
    prompt: string;
    system?: string;
    model: unknown;
    providerOptions?: unknown;
  }) => {
    calls.push({ prompt, system, model, providerOptions });
    return {
      text: replies[calls.length - 1] ?? "",
      totalUsage: { inputTokens: 10, outputTokens: 10 },
      steps: [],
      finishReason: "stop",
    };
  },
  streamText: () => {
    throw new Error("streamText not used in these tests");
  },
}));

// Keep the trace exporter out of it — these tests are about call counts —
// while preserving every other export for files that share this worker.
mock.module("./ai-evals", () => ({
  ...realAiEvals,
  captureAiGeneration: async () => undefined,
}));

// `ai-orchestrator.test.ts` also mocks ./ai-client process-globally, so a
// plain `./ai-client` import here can resolve to that mock instead of the
// real module. Import a private instance — same pattern ai-orchestrator.test.ts
// and ai-client-browser.test.ts use to stay immune to cross-file mocks.
const {
  runClientAgent,
  runClientJudge,
  runClientEvidenceJudge,
  runClientIntegrityJudge,
  runClientTargetFitJudge,
  runClientCustomCriterionJudge,
  runClientRubricReview,
  runClientRewrite,
  setClientUsageRecorderForTests,
} = await import(`./ai-client?ai-client-reasoning-test=${Date.now()}`);

const DRAFT =
  "Most companies treat AI like a vending machine. You put a prompt in, and a polished paragraph comes out. The paragraph never disappoints anyone.";

function settings(): AiSettings {
  return {
    advancedMode: true,
    providers: [
      {
        id: "provider-local",
        name: "Local",
        type: "openai-compatible",
        apiKey: "local",
        baseUrl: "http://localhost:8080/v1",
        defaultModel: "LFM2.5-2.6B",
        availableModels: ["LFM2.5-2.6B"],
      },
    ],
    defaultProviderId: "provider-local",
    perFeature: {},
    showProviderTags: false,
  };
}

function request(): AgentRequest {
  return {
    persona: {
      id: "devil",
      name: "The Devil",
      role: "contrarian",
      systemPrompt: "You argue the other side.",
    } as unknown as AgentRequest["persona"],
    brief: null,
    draftText: DRAFT,
    instruction: "feedback",
  };
}

beforeEach(() => {
  replies = [];
  calls = [];
  usageAttempts = [];
  setClientUsageRecorderForTests(async (input: ClientUsageAttemptInput) => {
    usageAttempts.push(structuredClone(input));
    return null;
  });
});

afterEach(() => {
  setClientUsageRecorderForTests(undefined);
});

describe("reasoning models do not cost a second call", () => {
  test("a reply that thinks first is kept, not regenerated", async () => {
    replies = [
      "<think>The vending machine image is the strongest thing here.</think>" +
        "The vending machine image earns its keep. The sentence after it does not.",
    ];

    const result = await runClientAgent(
      "persona-feedback",
      request(),
      settings(),
    );

    expect(calls).toHaveLength(1);
    expect(usageAttempts).toHaveLength(1);
    expect(usageAttempts[0]).toMatchObject({
      requestSent: true,
      attempt: 1,
      source: "local",
      outcome: "completed",
    });
    expect(result?.text).toBe(
      "The vending machine image earns its keep. The sentence after it does not.",
    );
    // The thinking must not survive into the filed note.
    expect(result?.text).not.toContain("<think>");
  });

  test("an unclosed block that swallowed the answer still regenerates", async () => {
    replies = [
      "<think>Still weighing the second paragraph",
      "The second paragraph repeats the first.",
    ];

    const result = await runClientAgent(
      "persona-feedback",
      request(),
      settings(),
    );

    expect(calls).toHaveLength(2);
    expect(usageAttempts).toHaveLength(2);
    expect(usageAttempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(new Set(usageAttempts.map((attempt) => attempt.traceId)).size).toBe(
      1,
    );
    expect(
      new Set(usageAttempts.map((attempt) => attempt.editorialActionId)).size,
    ).toBe(1);
    expect(result?.text).toBe("The second paragraph repeats the first.");
  });

  test("the retry asks for something the model can actually do", async () => {
    replies = ["<think>unterminated", "A note."];

    await runClientAgent("persona-feedback", request(), settings());

    // The old nudge told a model whose template always opens <think> not to
    // use <think>. Ask it to close the block instead.
    expect(calls[1]?.prompt).toContain("Close your <think> block");
    expect(calls[1]?.prompt).not.toContain("Do not place");
  });

  test("two empty replies still file a note rather than a blank card", async () => {
    replies = ["<think>never closed", "<think>also never closed"];

    const result = await runClientAgent(
      "persona-feedback",
      request(),
      settings(),
    );

    expect(calls).toHaveLength(2);
    expect(result?.text).toContain("also never closed");
    expect(result?.text).not.toContain("<think>");
  });
});

describe("language reaches the model provider", () => {
  test.each([
    ["en", "English"],
    ["fr", "French"],
    ["es", "Spanish"],
    ["zh", "Simplified Chinese"],
    ["hi", "Hindi"],
    ["ja", "Japanese"],
  ])("%s survives an empty-response retry", async (locale, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => locale },
    });
    try {
      replies = ["<think>unfinished", "A visible reply."];
      await runClientAgent("persona-feedback", request(), settings());
      expect(calls).toHaveLength(2);
      for (const call of calls)
        expect(call.system).toContain(`Response language: ${name}.`);
    } finally {
      if (descriptor)
        Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("client rubric readers retry once without inventing scores", () => {
  const judgeCases = [
    ["persona", (config: AiSettings) => runClientJudge(request(), config)],
    [
      "evidence",
      (config: AiSettings) => runClientEvidenceJudge(request(), config),
    ],
    [
      "integrity",
      (config: AiSettings) => runClientIntegrityJudge(request(), config),
    ],
    [
      "target fit",
      (config: AiSettings) => runClientTargetFitJudge(request(), config),
    ],
    [
      "custom criterion",
      (config: AiSettings) =>
        runClientCustomCriterionJudge(
          {
            ...request(),
            label: "Clarity",
            description: "Explain the point plainly.",
          },
          config,
        ),
    ],
  ] as const;
  const valid = JSON.stringify({
    score: 8,
    rationale: "The claim is supported.",
  });

  for (const [name, judge] of judgeCases) {
    test(`${name}: empty then valid retries the same model with lower reasoning`, async () => {
      replies = ["", valid];
      const config = settings();
      config.providers[0]!.modelReasoning = {
        "LFM2.5-2.6B": { type: "effort", value: "high" },
      };
      expect(await judge(config)).toEqual({
        score: 8,
        rationale: "The claim is supported.",
        provider: "openai-compatible",
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]!.model).toBe(calls[0]!.model);
      expect(calls[1]!.system).toBe(calls[0]!.system);
      expect(calls[1]!.prompt).toBe(
        `${calls[0]!.prompt}\n\nAnswer now with only the requested JSON object.`,
      );
      expect(calls[0]!.providerOptions).toEqual({
        openai: { reasoningEffort: "high" },
      });
      expect(calls[1]!.providerOptions).toEqual({
        openai: { reasoningEffort: "low" },
      });
      expect(usageAttempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
      expect(
        new Set(usageAttempts.map((attempt) => attempt.traceId)).size,
      ).toBe(1);
      expect(config.providers[0]!.modelReasoning["LFM2.5-2.6B"]!.value).toBe(
        "high",
      );
    });

    test(`${name}: invalid visible output also retries`, async () => {
      replies = ["I cannot decide yet.", valid];
      expect((await judge(settings()))?.score).toBe(8);
      expect(calls).toHaveLength(2);
      // Unknown models must not acquire an unsupported reasoning parameter.
      expect(calls[1]!.providerOptions).toBeUndefined();
    });

    test(`${name}: two empty replies return null`, async () => {
      replies = ["", ""];
      expect(await judge(settings())).toBeNull();
      expect(calls).toHaveLength(2);
    });

    test(`${name}: hidden reasoning is never promoted to a score`, async () => {
      replies = [`<think>${valid}`, `<think>${valid}`];
      expect(await judge(settings())).toBeNull();
      expect(calls).toHaveLength(2);
    });

    test(`${name}: a valid first reading needs no retry`, async () => {
      replies = [valid];
      expect((await judge(settings()))?.score).toBe(8);
      expect(calls).toHaveLength(1);
    });
  }

  const reviewRequest = {
    combined: 70,
    grade: "B",
    judgeMean: 8,
    minJudge: 8,
    staticTotal: 7,
    judges: [],
    staticFeedback: [],
    brief: null,
    draftText: DRAFT,
  };

  test("review retries empty content with a prose instruction", async () => {
    replies = ["", "  Support the second claim.  "];
    expect((await runClientRubricReview(reviewRequest, settings()))?.text).toBe(
      "Support the second claim.",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toBe(
      `${calls[0]!.prompt}\n\nAnswer now with only the requested review.`,
    );
  });

  test("review stays null when both attempts contain only reasoning", async () => {
    replies = ["<think>Still reading", "<think>Still reading"];
    expect(await runClientRubricReview(reviewRequest, settings())).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

test.each(["sentence", "paragraph"] as const)(
  "%s rewrite uses the shared fact-preserving task",
  async (level) => {
    const original = "Ada visited Toronto on 3 May to explain habeas corpus.";
    replies = [
      JSON.stringify({ replacement: original, rationale: "Keep the facts." }),
    ];
    const result = await runClientRewrite(
      { ...request(), original, level },
      settings(),
    );
    expect(result?.replacement).toBe(original);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain(
      "Keep every name, number, date, place and term of art",
    );
    expect(calls[0]!.prompt).toContain(`PASSAGE:\n"${original}"`);
    expect(calls[0]!.prompt).toContain(
      level === "sentence"
        ? "Keep the replacement to a single sentence."
        : "The replacement may be up to one paragraph, but no longer than the original.",
    );
  },
);
