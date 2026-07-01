import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
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

mock.module("./idb", () => ({
  loadAiSettingsFromIdb: async () => mockState.settings,
}));

mock.module("./ai-client", () => ({
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

const { invalidateAiSettingsCache, runAiWithFallback } = await import(
  "./ai-orchestrator"
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
          provider: "bifrost",
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
          provider: "bifrost",
        };
      },
    });

    expect(mockState.runClientCalls).toHaveLength(0);
    expect(serverCalls).toBe(1);
    expect(result.provider).toBe("bifrost");
  });
});
