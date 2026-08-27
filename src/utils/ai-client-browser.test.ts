import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AiProviderConfig, AiSettings } from "../types";
import type { ClientUsageAttemptInput } from "./usage-ledger";

/**
 * The synthesis module is loaded through a dynamic import inside
 * `runClientVoiceSpeech`, so the mock has to be in place before the branch
 * runs — the library's own test pattern registers it at the top and swaps
 * the implementation via a mutable variable.
 */
let synthesizeImpl:
  | ((text: string, opts: unknown) => Promise<unknown>)
  | undefined;
mock.module("./supertonic-tts", () => ({
  synthesizeSupertonic: async (text: string, opts: unknown) => {
    if (!synthesizeImpl) throw new Error("no synthesize stub");
    return synthesizeImpl(text, opts);
  },
}));

// `ai-orchestrator.test.ts` mocks ./ai-client process-globally under Bun's
// full-suite worker, so a plain `./ai-client` import here can resolve to that
// two-export mock instead of the real module. Import a private instance —
// same pattern ai-orchestrator.test.ts uses to stay immune to cross-file mocks.
const {
  hasConfiguredVoiceProvider,
  normalizeAiSettings,
  providerSupportsFeature,
  runClientVoiceSpeech,
  setClientUsageRecorderForTests,
  stripManagedSupertonicProvider,
} = await import(`./ai-client?ai-client-browser-test=${Date.now()}`);
const { BROWSER_TTS_PROVIDER_ID, setBrowserTtsCapabilityOverride } =
  await import("./browser-inference");

/** A settings box with nothing configured but the browser's own voice. */
function browserOnlySettings(): AiSettings {
  return normalizeAiSettings({
    advancedMode: false,
    providers: [],
    defaultProviderId: null,
    perFeature: {},
    showProviderTags: false,
  });
}

function browserVoiceSettings(): AiSettings {
  const provider: AiProviderConfig = {
    id: BROWSER_TTS_PROVIDER_ID,
    name: "Browser — offline voice",
    type: "supertonic",
    apiKey: "browser",
    defaultModel: "supertonic-tts",
    availableModels: ["supertonic-tts"],
  };
  return {
    advancedMode: false,
    providers: [provider],
    defaultProviderId: null,
    perFeature: {},
    showProviderTags: false,
  };
}

afterEach(() => {
  setClientUsageRecorderForTests(undefined);
  setBrowserTtsCapabilityOverride(undefined);
  synthesizeImpl = undefined;
  mock.restore();
});

describe("browser Supertonic provider auto-registration", () => {
  test("is injected by normalization on a capable browser", () => {
    setBrowserTtsCapabilityOverride("wasm");
    const settings = browserOnlySettings();
    expect(
      settings.providers.some((p) => p.id === BROWSER_TTS_PROVIDER_ID),
    ).toBe(true);
    const supertonic = settings.providers.find(
      (p) => p.id === BROWSER_TTS_PROVIDER_ID,
    );
    expect(supertonic?.type).toBe("supertonic");
    expect(supertonic?.apiKey).toBe("browser");
  });

  test("claims the default slot only when the writer chose none", () => {
    setBrowserTtsCapabilityOverride("wasm");
    const settings = browserOnlySettings();
    expect(
      settings.providers.some((p) => p.id === BROWSER_TTS_PROVIDER_ID),
    ).toBe(true);
    // It is deliberately not the default: the writer's own keyed provider
    // must always win when present.
    expect(settings.defaultProviderId).toBeNull();
  });

  test("is stripped before persisting so the writer's choices stay clean", () => {
    setBrowserTtsCapabilityOverride("wasm");
    const injected = browserOnlySettings();
    const stripped: AiSettings = stripManagedSupertonicProvider(injected);
    expect(
      stripped.providers.some((p) => p.id === BROWSER_TTS_PROVIDER_ID),
    ).toBe(false);
  });

  test("counts as a configured voice provider for speech enablement", () => {
    setBrowserTtsCapabilityOverride("wasm");
    expect(hasConfiguredVoiceProvider(browserOnlySettings())).toBe(true);
  });

  test("is narration-capable but never transcription-capable", () => {
    setBrowserTtsCapabilityOverride("wasm");
    expect(providerSupportsFeature("supertonic", "voice-narration")).toBe(true);
    expect(providerSupportsFeature("supertonic", "voice-transcription")).toBe(
      false,
    );
  });

  test("is not injected when the browser cannot run on-device inference", () => {
    setBrowserTtsCapabilityOverride(null);
    const settings: AiSettings = normalizeAiSettings({
      providers: [],
      defaultProviderId: null,
    });
    expect(
      settings.providers.some((p) => p.id === BROWSER_TTS_PROVIDER_ID),
    ).toBe(false);
  });

  test("a writer's keyed provider still wins the default slot", () => {
    setBrowserTtsCapabilityOverride("wasm");
    const settings: AiSettings = normalizeAiSettings({
      advancedMode: false,
      providers: [
        {
          id: "provider-openai",
          name: "OpenAI",
          type: "openai",
          apiKey: "sk-test",
          defaultModel: "gpt-5.5-mini",
          availableModels: ["gpt-5.5-mini"],
        },
      ],
      defaultProviderId: "provider-openai",
      perFeature: {},
      showProviderTags: false,
    });
    expect(
      settings.providers.some((p) => p.id === BROWSER_TTS_PROVIDER_ID),
    ).toBe(true);
    expect(settings.defaultProviderId).toBe("provider-openai");
  });
});

describe("client voice speech with the browser voice", () => {
  test("routes through the Supertonic branch and returns its WAV", async () => {
    setBrowserTtsCapabilityOverride("wasm");
    const synthesize = mock(async () => ({
      audio: new Blob([new Uint8Array(0)], { type: "audio/wav" }),
      provider: "supertonic",
      model: "supertonic-tts",
      voice: "F1",
      responseFormat: "wav",
    }));
    synthesizeImpl = synthesize;
    const usageAttempts: ClientUsageAttemptInput[] = [];
    setClientUsageRecorderForTests(async (input: ClientUsageAttemptInput) => {
      usageAttempts.push(structuredClone(input));
      return null;
    });

    const result = await runClientVoiceSpeech(
      { text: "Read this passage." },
      browserVoiceSettings(),
    );

    expect(result?.provider).toBe("supertonic");
    expect(result?.responseFormat).toBe("wav");
    expect(result?.model).toBe("supertonic-tts");
    expect(synthesize).toHaveBeenCalledWith(
      "Read this passage.",
      expect.objectContaining({ speed: undefined }),
    );
    expect(usageAttempts).toHaveLength(1);
    expect(usageAttempts[0]).toMatchObject({
      requestSent: true,
      source: "local",
      feature: "voice-narration",
      provider: "supertonic",
      model: "supertonic-tts",
      outcome: "completed",
    });
    expect(usageAttempts[0].usage).toBeUndefined();
  });

  test("surfaces download-required when the pack is not on disk", async () => {
    setBrowserTtsCapabilityOverride("wasm");
    synthesizeImpl = () =>
      Promise.reject(
        Object.assign(new Error("pack needed"), {
          code: "CONFIGURATION_ERROR",
          recovery: { action: "download-required", canRetry: true },
        }),
      );

    await expect(
      runClientVoiceSpeech(
        { text: "Read this passage." },
        browserVoiceSettings(),
      ),
    ).rejects.toThrowError(/pack needed/);
  });
});
