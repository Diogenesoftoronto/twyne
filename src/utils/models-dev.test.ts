import { describe, expect, test } from "bun:test";
import {
  findModelsDevProvider,
  modelsDevModelsForFeature,
  parseModelsDevCatalog,
  searchModelsDevModels,
  searchModelsDevProviders,
} from "./models-dev";

const fixture = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-fast": {
        id: "gpt-fast",
        name: "GPT Fast",
        description: "Fast general model",
        family: "gpt",
        reasoning: false,
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
      },
      "gpt-reason": {
        id: "gpt-reason",
        name: "GPT Reason",
        description: "Deep reasoning model",
        family: "gpt",
        reasoning: true,
      },
    },
  },
  unsupported: {
    id: "unsupported",
    name: "Unsupported SDK",
    npm: "@example/unavailable",
    models: { model: { id: "model" } },
  },
  empty: {
    id: "empty",
    name: "Empty",
    npm: "@ai-sdk/openai-compatible",
    models: {},
  },
};

describe("models.dev catalog", () => {
  test("normalizes supported providers and model capabilities", () => {
    const catalog = parseModelsDevCatalog(fixture);

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "openai",
      name: "OpenAI",
      type: "openai",
      env: ["OPENAI_API_KEY"],
    });
    expect(catalog[0]?.models).toContainEqual(
      expect.objectContaining({
        id: "gpt-fast",
        name: "GPT Fast",
        toolCall: true,
        modalities: { input: ["text"], output: ["text"] },
      }),
    );
  });

  test("maps generic compatible providers to supported runtime types", () => {
    const catalog = parseModelsDevCatalog({
      compatible: {
        id: "compatible",
        name: "Compatible",
        api: "https://example.com/v1",
        npm: "@ai-sdk/openai-compatible",
        models: { "model-1": { id: "model-1" } },
      },
      anthropicCompatible: {
        id: "anthropic-compatible-example",
        name: "Anthropic Compatible",
        api: "https://example.com/anthropic",
        npm: "@ai-sdk/anthropic",
        models: { "model-a": { id: "model-a" } },
      },
    });

    expect(catalog.map((provider) => provider.type)).toEqual([
      "anthropic-compatible",
      "openai-compatible",
    ]);
  });

  test("returns an empty catalog for malformed input", () => {
    expect(parseModelsDevCatalog(null)).toEqual([]);
    expect(parseModelsDevCatalog([])).toEqual([]);
    expect(parseModelsDevCatalog("not-json")).toEqual([]);
  });
});

describe("models.dev search", () => {
  const provider = parseModelsDevCatalog(fixture)[0]!;

  test("searches providers by name, id, or API URL", () => {
    const providers = [
      provider,
      {
        ...provider,
        id: "other",
        name: "Other Provider",
        api: "https://models.other.test/v1",
      },
    ];

    expect(searchModelsDevProviders(providers, "open")).toEqual([provider]);
    expect(searchModelsDevProviders(providers, "other.test")).toHaveLength(1);
    expect(searchModelsDevProviders(providers, "")).toEqual(providers);
  });

  test("searches models by id, name, family, and description", () => {
    expect(searchModelsDevModels(provider.models, "reason")).toHaveLength(1);
    expect(searchModelsDevModels(provider.models, "general")).toHaveLength(1);
    expect(searchModelsDevModels(provider.models, "gpt")).toHaveLength(2);
    expect(searchModelsDevModels(provider.models, "")).toEqual(provider.models);
  });
});

describe("models.dev feature filtering", () => {
  const models = [
    {
      id: "chat",
      name: "Chat",
      modalities: { input: ["text"], output: ["text"] },
    },
    {
      id: "tts",
      name: "TTS",
      modalities: { input: ["text"], output: ["audio"] },
    },
    {
      id: "transcribe",
      name: "Transcribe",
      modalities: { input: ["audio"], output: ["text"] },
    },
  ];

  test("offers models matching the feature modality", () => {
    expect(modelsDevModelsForFeature(models, "language").map((m) => m.id)).toEqual([
      "chat",
    ]);
    expect(
      modelsDevModelsForFeature(models, "voice-narration").map((m) => m.id),
    ).toEqual(["tts"]);
    expect(
      modelsDevModelsForFeature(models, "voice-transcription").map((m) => m.id),
    ).toEqual(["transcribe"]);
  });

  test("keeps sparse catalogs usable when no modality metadata matches", () => {
    const sparse = [{ id: "unknown", name: "Unknown" }];
    expect(modelsDevModelsForFeature(sparse, "language")).toEqual(sparse);
  });
});

describe("models.dev provider matching", () => {
  const catalog = parseModelsDevCatalog({
    openai: {
      id: "openai",
      name: "OpenAI",
      npm: "@ai-sdk/openai",
      models: { gpt: { id: "gpt" } },
    },
    compatible: {
      id: "compatible",
      name: "Compatible",
      api: "https://example.com/v1/",
      npm: "@ai-sdk/openai-compatible",
      models: { model: { id: "model" } },
    },
  });

  test("prefers an explicitly saved models.dev id", () => {
    expect(
      findModelsDevProvider(catalog, {
        modelsDevId: "compatible",
        type: "openai",
      })?.id,
    ).toBe("compatible");
  });

  test("matches legacy configured providers by normalized API URL", () => {
    expect(
      findModelsDevProvider(catalog, {
        type: "openai-compatible",
        baseUrl: "https://example.com/v1",
      })?.id,
    ).toBe("compatible");
  });

  test("matches canonical first-party providers by runtime type", () => {
    expect(findModelsDevProvider(catalog, { type: "openai" })?.id).toBe(
      "openai",
    );
  });

  test("does not mislabel incompatible provider adapters", () => {
    expect(findModelsDevProvider(catalog, { type: "minimax" })).toBeUndefined();
  });
});
