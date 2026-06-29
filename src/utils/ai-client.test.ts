import { afterEach, describe, expect, test } from "bun:test";
import { PROVIDER_METAS } from "../types";
import type { AiFeature, AiProviderConfig, AiSettings } from "../types";
import {
  discoverProviderModels,
  hasConfiguredAiProvider,
  resolveFeatureConfig,
} from "./ai-client";

const ALL_FEATURES: AiFeature[] = [
  "persona-feedback",
  "persona-reply",
  "persona-rewrite",
  "rubric-judge",
  "voice-narration",
  "comment-reply",
  "citation-format",
  "source-summarize",
  "source-detect-missing",
  "interview-turn",
  "dossier-check",
];

function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    advancedMode: false,
    providers: [
      {
        id: "provider-openai",
        name: "OpenAI",
        type: "openai",
        apiKey: "sk-test",
        defaultModel: "gpt-5.5-mini",
        availableModels: ["gpt-5.5-mini", "gpt-5.5-nano"],
      },
    ],
    defaultProviderId: "provider-openai",
    perFeature: {},
    showProviderTags: false,
    ...overrides,
  };
}

describe("ai-client provider resolution", () => {
  test("treats configured providers as active even when advancedMode is false", () => {
    const settings = makeSettings({ advancedMode: false });

    expect(hasConfiguredAiProvider(settings)).toBe(true);

    const resolved = resolveFeatureConfig(settings, "persona-feedback");
    expect(resolved?.provider.id).toBe("provider-openai");
    expect(resolved?.model).toBe("gpt-5.5-mini");
  });

  test("resolves every AI feature against the configured provider set", () => {
    const settings = makeSettings({ advancedMode: false });

    for (const feature of ALL_FEATURES) {
      const resolved = resolveFeatureConfig(settings, feature);
      expect(resolved).not.toBeNull();
      expect(resolved?.provider.id).toBe("provider-openai");
      expect(typeof resolved?.model).toBe("string");
      expect(resolved?.model.length).toBeGreaterThan(0);
    }

    expect(resolveFeatureConfig(settings, "voice-narration")?.model).toBe(
      "gpt-4o-mini-tts",
    );
  });

  test("respects per-feature provider and model overrides", () => {
    const settings = makeSettings({
      providers: [
        {
          id: "provider-openai",
          name: "OpenAI",
          type: "openai",
          apiKey: "sk-openai",
          defaultModel: "gpt-5.5-mini",
          availableModels: ["gpt-5.5-mini"],
        },
        {
          id: "provider-anthropic",
          name: "Anthropic",
          type: "anthropic",
          apiKey: "sk-anthropic",
          defaultModel: "claude-sonnet-4-6",
          availableModels: ["claude-sonnet-4-6", "claude-haiku-4-6"],
        },
      ],
      perFeature: {
        "citation-format": {
          providerId: "provider-anthropic",
          model: "claude-haiku-4-6",
          temperature: 0.1,
          maxTokens: 180,
        },
      },
    });

    const resolved = resolveFeatureConfig(settings, "citation-format");
    expect(resolved?.provider.id).toBe("provider-anthropic");
    expect(resolved?.model).toBe("claude-haiku-4-6");
    expect(resolved?.temperature).toBe(0.1);
    expect(resolved?.maxTokens).toBe(180);
  });
});

describe("ai-client provider model discovery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("new OpenAI-compatible provider presets do not hardcode model ids", () => {
    for (const type of [
      "deepseek",
      "openrouter",
      "ollama",
      "zai",
      "minimax",
    ] as const) {
      const meta = PROVIDER_METAS.find((entry) => entry.type === type);

      expect(meta).toBeDefined();
      expect(meta?.defaultModels).toEqual([]);
      expect(meta?.defaultBaseUrl).toBeTruthy();
    }
  });

  test("discovers models from the configured OpenAI-compatible base URL", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({ data: [{ id: "provider-discovered-model" }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const config: AiProviderConfig = {
      id: "provider-openrouter",
      name: "OpenRouter",
      type: "openrouter",
      apiKey: "sk-test",
      baseUrl: "https://openrouter.example/api/v1",
      defaultModel: "",
      availableModels: [],
    };

    const result = await discoverProviderModels(config);

    expect(requestedUrl).toBe("https://openrouter.example/api/v1/models");
    expect(result).toEqual({
      models: ["provider-discovered-model"],
      source: "remote",
    });
  });

  test("discovers Ollama models without requiring an Authorization header", async () => {
    let headers: HeadersInit | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers = init?.headers;
      return new Response(JSON.stringify({ data: [{ id: "llama3.2" }] }), {
        status: 200,
      });
    }) as typeof fetch;
    const config: AiProviderConfig = {
      id: "provider-ollama",
      name: "Ollama",
      type: "ollama",
      apiKey: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "",
      availableModels: [],
    };

    const result = await discoverProviderModels(config);

    expect(headers).toEqual({});
    expect(result.models).toEqual(["llama3.2"]);
  });
});
