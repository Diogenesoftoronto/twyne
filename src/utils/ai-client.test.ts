import { afterEach, describe, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { PROVIDER_METAS } from "../types";
import type { AiFeature, AiProviderConfig, AiSettings } from "../types";
import type { SpeechAlignmentSnapshot } from "./speech-alignment";

// `ai-client-reasoning.test.ts` stubs the `ai` SDK process-globally under
// Bun's full-suite worker, so the import graph below can resolve to that
// generateText stub instead of the real SDK. Re-register a pass-through mock
// here — a later mock.module() registration replaces an earlier one, so this
// file always sees the real SDK no matter which files ran before it.
const realAi = await import(
  `${createRequire(import.meta.url).resolve("ai")}?ai-client-test-real`
);
mock.module("ai", () => ({ ...realAi }));

// `ai-orchestrator.test.ts` mocks ./ai-client process-globally under Bun's
// full-suite worker, so a plain `./ai-client` import here can resolve to that
// three-export mock instead of the real module. Import a private instance —
// same pattern ai-orchestrator.test.ts and ai-client-browser.test.ts use to
// stay immune to cross-file mocks.
const {
  discoverProviderModels,
  hasConfiguredAiProvider,
  hasConfiguredVoiceProvider,
  parseCitationFormatResult,
  parseMissingSourceResult,
  providerRequestWasSent,
  providerSupportsFeature,
  resolveFeatureConfig,
  runClientVoiceTranscribe,
  runClientVoiceSpeech,
  usesOpenAiResponsesApi,
} = await import(`./ai-client?ai-client-test=${Date.now()}`);

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
  test("distinguishes pre-send configuration failures from provider attempts", () => {
    expect(providerRequestWasSent(new Error("invalid local options"))).toBe(
      false,
    );
    expect(
      providerRequestWasSent({
        name: "AI_APICallError",
        url: "https://api.example.test/v1/chat",
        requestBodyValues: {},
      }),
    ).toBe(true);
    expect(providerRequestWasSent({ statusCode: 429 })).toBe(true);
  });

  test("opts into Responses API explicitly and keeps existing providers on chat", () => {
    expect(usesOpenAiResponsesApi({})).toBe(false);
    expect(usesOpenAiResponsesApi({ apiMode: "chat" })).toBe(false);
    expect(usesOpenAiResponsesApi({ apiMode: "responses" })).toBe(true);
  });

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

describe("client voice synthesis", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends the Voice Narration provider and chosen model to synthesis", async () => {
    let requestedUrl = "";
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as typeof fetch;

    const settings = makeSettings({
      providers: [
        {
          id: "default-openai",
          name: "Default OpenAI",
          type: "openai",
          apiKey: "sk-default",
          defaultModel: "gpt-5.5-mini",
        },
        {
          id: "voice-provider",
          name: "Voice Provider",
          type: "openai-compatible",
          apiKey: "voice-key",
          baseUrl: "https://voice.example/v1/",
          defaultModel: "provider-default-tts",
        },
      ],
      defaultProviderId: "default-openai",
      perFeature: {
        "voice-narration": {
          providerId: "voice-provider",
          model: "chosen-high-quality-tts",
          voice: "chosen-voice",
        },
      },
    });

    const result = await runClientVoiceSpeech(
      { text: "Read this passage." },
      settings,
    );

    expect(requestedUrl).toBe("https://voice.example/v1/audio/speech");
    expect(requestBody).toMatchObject({
      model: "chosen-high-quality-tts",
      input: "Read this passage.",
      voice: "chosen-voice",
      stream_format: "audio",
    });
    expect(result?.audioStream).toBeDefined();
    expect(result?.provider).toBe("openai-compatible");
    expect(result?.model).toBe("chosen-high-quality-tts");
    expect(result?.voice).toBe("chosen-voice");
  });

  test("sends direct audio to an audio-capable OpenAI-compatible model", async () => {
    let requestedUrl = "";
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-audio",
          object: "chat.completion",
          created: 1,
          model: "gemma-4-12b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "A spoken note." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await runClientVoiceTranscribe(
      {
        audio: new Blob([new Uint8Array(44)], { type: "audio/wav" }),
        prompt: "Transcribe this recording.",
      },
      makeSettings({
        providers: [
          {
            id: "audio-provider",
            name: "Audio Provider",
            type: "openai-compatible",
            apiKey: "audio-key",
            baseUrl: "https://audio.example/v1",
            defaultModel: "gemma-4-12b",
          },
        ],
        defaultProviderId: "audio-provider",
      }),
    );

    const messages = (
      requestBody as {
        messages?: Array<{ content: unknown }>;
      } | null
    )?.messages;
    const message = (messages?.find((entry) => Array.isArray(entry.content))
      ?.content ?? []) as Array<Record<string, unknown>>;
    expect(requestedUrl).toBe("https://audio.example/v1/chat/completions");
    expect(message).toEqual(
      expect.arrayContaining([
        { type: "text", text: "Transcribe this recording." },
        {
          type: "input_audio",
          input_audio: { format: "wav", data: expect.any(String) },
        },
      ]),
    );
    expect(result).toMatchObject({
      text: "A spoken note.",
      provider: "openai-compatible",
      model: "gemma-4-12b",
    });
  });

  test("streams OpenAI transcription deltas through the voice hook", async () => {
    let requestBody: FormData | null = null;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body as FormData;
      return new Response(
        [
          'data: {"type":"transcript.text.delta","delta":"A spoken"}',
          "",
          'data: {"type":"transcript.text.delta","delta":" note."}',
          "",
          'data: {"type":"transcript.text.done","text":"A spoken note."}',
          "",
        ].join("\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    const partials: string[] = [];
    const result = await runClientVoiceTranscribe(
      { audio: new Blob(["voice"], { type: "audio/webm" }) },
      makeSettings({
        perFeature: {
          "voice-transcription": {
            providerId: "provider-openai",
            model: "gpt-4o-mini-transcribe",
          },
        },
      }),
      { onDelta: (text: string) => partials.push(text) },
    );

    expect((requestBody as FormData | null)?.get("stream")).toBe("true");
    expect((requestBody as FormData | null)?.has("response_format")).toBe(
      false,
    );
    expect(partials).toEqual(["A spoken", "A spoken note."]);
    expect(result?.text).toBe("A spoken note.");
  });

  test("routes Inkling audio through Twyne's Tinker bridge", async () => {
    let requestedUrl = "";
    let requestBody: Record<string, unknown> | null = null;
    let authorization = "";
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(url);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-inkling-audio",
          object: "chat.completion",
          created: 1,
          model: "thinkingmachines/Inkling",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "An Inkling transcript." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const tinker: AiProviderConfig = {
      id: "tinker",
      name: "Tinker",
      type: "anthropic-compatible",
      apiKey: "tinker-test-key",
      baseUrl:
        "https://tinker.thinkingmachines.dev/services/tinker-prod/anthropic/api/v1",
      defaultModel: "thinkingmachines/Inkling",
    };

    expect(
      providerSupportsFeature(tinker.type, "voice-transcription", tinker),
    ).toBe(true);

    const result = await runClientVoiceTranscribe(
      {
        audio: new Blob([new Uint8Array(44)], { type: "audio/wav" }),
      },
      makeSettings({
        providers: [tinker],
        defaultProviderId: tinker.id,
      }),
    );

    const messages = (
      requestBody as {
        messages?: Array<{ content: unknown }>;
      } | null
    )?.messages;
    const content = (messages?.find((entry) => Array.isArray(entry.content))
      ?.content ?? []) as Array<Record<string, unknown>>;
    expect(requestedUrl).toBe("http://localhost/api/tinker/chat/completions");
    expect(authorization).toBe("Bearer tinker-test-key");
    expect(content).toEqual(
      expect.arrayContaining([
        {
          type: "input_audio",
          input_audio: { format: "wav", data: expect.any(String) },
        },
      ]),
    );
    expect(result).toMatchObject({
      text: "An Inkling transcript.",
      model: "thinkingmachines/Inkling",
    });
  });

  test("uses Fish Audio's current TTS contract and reference voice id", async () => {
    let requestedUrl = "";
    let requestBody: Record<string, unknown> | null = null;
    let requestHeaders: Headers | null = null;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestHeaders = new Headers(init?.headers);
      const event = {
        audio_base64: "AQID",
        content: "Read this passage.",
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: {
          segments: [{ text: "Read", start: 0, end: 0.3 }],
        },
      };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const settings = makeSettings({
      providers: [
        {
          id: "fish-provider",
          name: "Fish Audio",
          type: "fishaudio",
          apiKey: "fish-key",
          defaultModel: "s2-pro",
        },
      ],
      defaultProviderId: "fish-provider",
      perFeature: {
        "voice-narration": {
          voice: "91f2fedea8bc4465a6c668b2776be809",
        },
      },
    });

    const alignments: unknown[] = [];
    const result = await runClientVoiceSpeech(
      {
        text: "Read this passage.",
        onAlignment: (snapshot: SpeechAlignmentSnapshot) =>
          alignments.push(snapshot),
      },
      settings,
    );

    expect(requestedUrl).toBe(
      "https://api.fish.audio/v1/tts/stream/with-timestamp",
    );
    expect((requestHeaders as Headers | null)?.get("model")).toBe("s2-pro");
    expect(requestBody).toMatchObject({
      text: "Read this passage.",
      format: "mp3",
      reference_id: "91f2fedea8bc4465a6c668b2776be809",
    });
    expect(result?.provider).toBe("fishaudio");
    expect(
      Array.from(
        new Uint8Array(await new Response(result!.audioStream).arrayBuffer()),
      ),
    ).toEqual([1, 2, 3]);
    expect(alignments).toEqual([
      {
        provider: "fishaudio",
        ranges: [
          {
            sourceStart: 0,
            sourceEnd: 4,
            audioStart: 0,
            audioEnd: 0.3,
            precision: "word",
          },
        ],
      },
    ]);
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
    defaultModel: "s2-pro",
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
        expect(
          resolved,
          `${feature} must not resolve to a voice-only provider`,
        ).toBeNull();
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

  test("picks Fish's documented TTS model by default", () => {
    const settings = makeSettings({
      providers: [fish],
      defaultProviderId: fish.id,
    });
    expect(resolveFeatureConfig(settings, "voice-narration")?.model).toBe(
      "s2-pro",
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

  test("a transcription-only provider does not make narration resolvable", () => {
    // Google can listen but not speak. `hasConfiguredVoiceProvider` answers
    // "some voice feature is reachable", which is true here — so reading aloud
    // must gate on narration resolving, not on that broader question. Gating
    // on the broad one stranded writers running an LLM plus Google: narration
    // resolved to nothing and the hosted fallback was never tried.
    const google: AiProviderConfig = {
      id: "provider-google",
      name: "Google",
      type: "google",
      apiKey: "goog-test",
      defaultModel: "gemini-2.5-flash",
    };
    const settings = makeSettings({
      providers: [anthropic, google],
      defaultProviderId: anthropic.id,
    });

    expect(hasConfiguredVoiceProvider(settings)).toBe(true);
    expect(
      resolveFeatureConfig(settings, "voice-transcription")?.provider.type,
    ).toBe("google");
    expect(resolveFeatureConfig(settings, "voice-narration")).toBeNull();
  });
});
