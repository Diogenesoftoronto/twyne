import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import type { AiSettings } from "../types";

const mockState: {
  settings: AiSettings | null;
  clientResult:
    | { text: string; type: "suggestion" | "perspective"; provider: string }
    | null;
  runClientCalls: Array<{ feature: string; settings: AiSettings | null }>;
} = {
  settings: null,
  clientResult: null,
  runClientCalls: [],
};

/**
 * Keep every real export and override only the one this test controls.
 *
 * A stub with a single export breaks as soon as anything else in the module
 * graph statically imports another idb function — `lix.ts` imports
 * `loadLixBlobFromIdb`, and it is reachable from here via
 * application-diagnostics → posthog-context → auth-context → convex-sync.
 * That is a link-time failure, so it takes the whole file down rather than
 * one test. Spreading the real module makes the mock immune to that: the real
 * functions are all `isBrowser()`-guarded and inert under the test runner.
 */
const realIdb = await import("./idb");
mock.module("./idb", () => ({
  ...realIdb,
  loadAiSettingsFromIdb: async () => mockState.settings,
}));

// Spread the real module and override only the three functions this test
// controls. A stub with three exports breaks as soon as anything else in the
// module graph statically imports another ai-client function — speech.ts,
// background-room.ts and voice-notes.ts all reach into it — and a leaked
// mock is process-global under Bun's full-suite worker, so it takes every
// co-located file down with it rather than one test.
const realAiClient = await import(
  `${createRequire(import.meta.url).resolve("./ai-client")}?ai-orchestrator-test-real`
);
mock.module("./ai-client", () => ({
  ...realAiClient,
  hasConfiguredAiProvider: (settings: AiSettings | null) =>
    Boolean(settings?.providers?.length),
  normalizeAiSettings: (settings: AiSettings | null) =>
    settings ?? {
      advancedMode: false,
      providers: [],
      defaultProviderId: null,
      perFeature: {},
      showProviderTags: false,
    },
  runClientAgent: async (feature: string, _req: unknown, settings: AiSettings) => {
    mockState.runClientCalls.push({ feature, settings });
    return mockState.clientResult;
  },
}));

// Other files mock the same dependencies process-globally under Bun. Import a
// private instance so this unit always sees the mocks declared immediately
// above, independent of full-suite module evaluation order.
const { invalidateAiSettingsCache, runAiWithFallback } = await import(
  `./ai-orchestrator?ai-orchestrator-test=${Date.now()}`
);

afterEach(() => {
  mockState.settings = null;
  mockState.clientResult = null;
  mockState.runClientCalls = [];
  invalidateAiSettingsCache();
});

afterAll(() => {
  mock.restore();
});

describe("ai-orchestrator", () => {
  test("uses the BYOK client path when providers are configured", async () => {
    mockState.settings = {
      advancedMode: false,
      providers: [
        {
          id: "provider-openai",
          name: "OpenAI",
          type: "openai",
          apiKey: "sk-test",
          defaultModel: "gpt-5.5-mini",
        },
      ],
      defaultProviderId: "provider-openai",
      perFeature: {},
      showProviderTags: false,
    };
    mockState.clientResult = {
      text: "Client result",
      type: "suggestion",
      provider: "openai",
    };

    let serverCalls = 0;
    let localCalls = 0;

    const result = await runAiWithFallback({
      feature: "persona-feedback",
      req: {
        persona: {
          id: "editor",
          name: "Editor",
          role: "Editor",
          description: "Edits for clarity",
          focus: "clarity",
          color: "#000",
          icon: "E",
        },
        brief: null,
        draftText: "Draft text",
        instruction: "feedback",
      },
      client: null,
      serverAction: async () => {
        serverCalls += 1;
        return {
          text: "Server result",
          type: "perspective",
          provider: "portkey",
        };
      },
      localFallback: () => {
        localCalls += 1;
        return {
          text: "Local result",
          type: "perspective",
          provider: "local",
        };
      },
    });

    expect(mockState.runClientCalls).toHaveLength(1);
    expect(serverCalls).toBe(0);
    expect(localCalls).toBe(0);
    expect(result.text).toBe("Client result");
    expect(result.type).toBe("suggestion");
    expect(String(result.provider)).toBe("client-openai");
  });

  test("falls back to the server path when no providers are configured", async () => {
    mockState.settings = {
      advancedMode: false,
      providers: [],
      defaultProviderId: null,
      perFeature: {},
      showProviderTags: false,
    };

    let serverCalls = 0;

    const result = await runAiWithFallback({
      feature: "persona-feedback",
      req: {
        persona: {
          id: "reader",
          name: "Reader",
          role: "Reader",
          description: "Reads for audience fit",
          focus: "audience",
          color: "#000",
          icon: "R",
        },
        brief: null,
        draftText: "Draft text",
        instruction: "feedback",
      },
      client: null,
      serverAction: async () => {
        serverCalls += 1;
        return {
          text: "Server result",
          type: "perspective",
          provider: "portkey",
        };
      },
    });

    expect(mockState.runClientCalls).toHaveLength(0);
    expect(serverCalls).toBe(1);
    expect(result.provider).toBe("portkey");
  });
});
