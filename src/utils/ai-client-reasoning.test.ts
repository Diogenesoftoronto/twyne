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
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import type { AiSettings } from "../types";
import type { AgentRequest } from "../../convex/agentPrompts";

/** Replies handed to the mocked provider, one per call. */
let replies: string[] = [];
let calls: { prompt: string }[] = [];

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
  generateText: async ({ prompt }: { prompt: string }) => {
    calls.push({ prompt });
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
const { runClientAgent } = await import(
  `./ai-client?ai-client-reasoning-test=${Date.now()}`
);

const DRAFT =
  "Most companies treat AI like a vending machine. You put a prompt in, and a polished paragraph comes out. The paragraph never disappoints anyone.";

function settings(): AiSettings {
  return {
    advancedMode: false,
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
