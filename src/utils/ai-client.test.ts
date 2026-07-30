import { afterEach, describe, expect, test } from "bun:test";
import { PROVIDER_METAS } from "../types";
import type { AiFeature, AiProviderConfig, AiSettings } from "../types";
import {
  discoverProviderModels,
  hasConfiguredAiProvider,
  hasConfiguredVoiceProvider,
  parseCitationFormatResult,
  parseMissingSourceResult,
  resolveFeatureConfig,
} from "./ai-client";

const ALL_FEATURES: AiFeature[] = [
  "persona-feedback",
  "persona-reply",
  "persona-rewrite",
  "rubric-judge",
  "voice-narration",
  "voice-transcription",
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

describe("ai-client citation parsers", () => {
  test("preserves formatted citation metadata from fenced JSON", () => {
    const parsed = parseCitationFormatResult(
      '```json\n{"title":"Source Title","author":"Smith, Jo","year":"2024","date":"2024","url":"https://example.com","doi":"10.1234/example","publisher":"Example Press","formatted":"Smith, Jo. \\"Source Title.\\" Example Press, 2024."}\n```',
      "mla",
      "openai",
    );

    expect(parsed).toEqual({
      title: "Source Title",
      author: "Smith, Jo",
      year: "2024",
      date: "2024",
      url: "https://example.com",
      doi: "10.1234/example",
      publisher: "Example Press",
      formatted: 'Smith, Jo. "Source Title." Example Press, 2024.',
      style: "mla",
      provider: "openai",
    });
  });

  test("extracts citation JSON from surrounding model text", () => {
    const parsed = parseCitationFormatResult(
      'Here is the cleaned citation:\n{"title":"Source Title","formatted":"Formatted citation."}\nDone.',
      "apa",
      "openai",
    );

    expect(parsed).toMatchObject({
      title: "Source Title",
      formatted: "Formatted citation.",
      style: "apa",
    });
  });

  test("returns an empty missing-source result instead of null", () => {
    const parsed = parseMissingSourceResult('{"claims":[]}', "anthropic");

    expect(parsed).toEqual({
      claims: [],
      provider: "anthropic",
    });
  });

  test("filters blank missing-source claims after parsing", () => {
    const parsed = parseMissingSourceResult(
      JSON.stringify({
        claims: [
          { claim: "  ", reason: "empty", suggestedQuery: "empty" },
          { claim: "Specific claim", reason: "", suggestedQuery: "" },
        ],
      }),
      "openai",
    );

    expect(parsed).toEqual({
      claims: [
        {
          claim: "Specific claim",
          reason: "",
          suggestedQuery: "",
        },
      ],
      provider: "openai",
    });
  });
});

/**
 * Voice-only providers (Fish Audio) speak but cannot think. The routing has to
 * keep them out of every language feature, because several callers treat "BYOK
 * was attempted and produced nothing" as a hard error rather than falling back
 * to the server.
 */
describe("voice-only providers", () => {
  const fish: AiProviderConfig = {
    id: "provider-fish",
    name: "Fish Audio",
    type: "fishaudio",
    apiKey: "fish-test",
    defaultModel: "s2.1-pro-free",
  };
  const anthropic: AiProviderConfig = {
    id: "provider-anthropic",
    name: "Anthropic",
    type: "anthropic",
    apiKey: "sk-ant",
    defaultModel: "claude-sonnet-4-6",
  };

  test("Fish Audio alone does not count as a language provider", () => {
    const settings = makeSettings({
      providers: [fish],
      defaultProviderId: fish.id,
    });
    expect(hasConfiguredAiProvider(settings)).toBe(false);
    expect(hasConfiguredVoiceProvider(settings)).toBe(true);
  });

  test("Fish Audio is never chosen for a language feature", () => {
    const settings = makeSettings({
      providers: [fish],
      defaultProviderId: fish.id,
    });
    for (const feature of ALL_FEATURES) {
      const resolved = resolveFeatureConfig(settings, feature);
      if (feature === "voice-narration" || feature === "voice-transcription") {
        expect(resolved?.provider.type, feature).toBe("fishaudio");
      } else {
        expect(resolved, `${feature} must not resolve to a voice-only provider`)
          .toBeNull();
      }
    }
  });

  /**
   * The mixed setup is the one that matters: the room runs on Anthropic and
   * the voices on Fish, with no per-feature overrides configured by hand.
   */
  test("routes each feature to the provider that can serve it", () => {
    const settings = makeSettings({
      providers: [anthropic, fish],
      defaultProviderId: anthropic.id,
    });
    expect(hasConfiguredAiProvider(settings)).toBe(true);
    expect(
      resolveFeatureConfig(settings, "persona-feedback")?.provider.type,
    ).toBe("anthropic");
    expect(
      resolveFeatureConfig(settings, "voice-narration")?.provider.type,
    ).toBe("fishaudio");
    expect(
      resolveFeatureConfig(settings, "voice-transcription")?.provider.type,
    ).toBe("fishaudio");
  });

  test("picks the free-tier model by default, since a fresh key has no credit", () => {
    const settings = makeSettings({
      providers: [fish],
      defaultProviderId: fish.id,
    });
    expect(resolveFeatureConfig(settings, "voice-narration")?.model).toBe(
      "s2.1-pro-free",
    );
    expect(resolveFeatureConfig(settings, "voice-transcription")?.model).toBe(
      "asr-1",
    );
  });

  test("ignores a per-feature override that names a provider which cannot serve it", () => {
    const settings = makeSettings({
      providers: [anthropic, fish],
      defaultProviderId: anthropic.id,
      perFeature: { "persona-feedback": { providerId: fish.id } },
    });
    // Falls back to a capable provider rather than resolving to one that
    // would return no model and strand the caller.
    expect(
      resolveFeatureConfig(settings, "persona-feedback")?.provider.type,
    ).toBe("anthropic");
  });

  test("an LLM provider that cannot speak is not offered for voice", () => {
    const settings = makeSettings({
      providers: [anthropic],
      defaultProviderId: anthropic.id,
    });
    expect(resolveFeatureConfig(settings, "voice-narration")).toBeNull();
    expect(hasConfiguredVoiceProvider(settings)).toBe(false);
  });
});
