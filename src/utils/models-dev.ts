import type {
  AiModelReasoningOption,
  AiProviderType,
  AiReasoningEffort,
} from "../types";

export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";

export interface ModelsDevModel {
  id: string;
  name: string;
  description?: string;
  family?: string;
  reasoning?: boolean;
  reasoningOptions?: AiModelReasoningOption[];
  toolCall?: boolean;
  modalities?: {
    input: string[];
    output: string[];
  };
  releaseDate?: string;
  lastUpdated?: string;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  api?: string;
  npm?: string;
  env: string[];
  type: AiProviderType;
  models: ModelsDevModel[];
}

interface RawModelsDevModel {
  id?: string;
  name?: string;
  description?: string;
  family?: string;
  reasoning?: boolean;
  reasoning_options?: unknown;
  tool_call?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  release_date?: string;
  last_updated?: string;
}

interface RawModelsDevProvider {
  id?: string;
  name?: string;
  api?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, RawModelsDevModel>;
}

const SUPPORTED_NPM_PACKAGES = new Set([
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider",
]);

function parseReasoningOptions(value: unknown): AiModelReasoningOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AiModelReasoningOption[] => {
    if (!entry || typeof entry !== "object") return [];
    const option = entry as Record<string, unknown>;
    if (option.type === "toggle") return [{ type: "toggle" }];
    if (option.type === "effort" && Array.isArray(option.values)) {
      const allowed = new Set(["low", "medium", "high", "xhigh", "max"]);
      const values = option.values.filter(
        (item) =>
          item === null || (typeof item === "string" && allowed.has(item)),
      ) as Array<AiReasoningEffort | null>;
      return values.length ? [{ type: "effort", values }] : [];
    }
    if (
      option.type === "budget_tokens" &&
      typeof option.min === "number" &&
      typeof option.max === "number" &&
      option.min <= option.max
    ) {
      return [{ type: "budget_tokens", min: option.min, max: option.max }];
    }
    return [];
  });
}

function providerType(provider: RawModelsDevProvider): AiProviderType | null {
  switch (provider.id) {
    case "openai":
      return "openai";
    case "anthropic":
      return "anthropic";
    case "google":
      return "google";
    case "openrouter":
      return "openrouter";
    case "deepseek":
      return "deepseek";
    case "zai":
    case "zhipuai":
      return "zai";
  }
  if (provider.npm === "@ai-sdk/anthropic") return "anthropic-compatible";
  if (
    provider.npm === "@ai-sdk/openai-compatible" ||
    provider.npm === "@openrouter/ai-sdk-provider" ||
    provider.npm === "@ai-sdk/openai"
  ) {
    return "openai-compatible";
  }
  return null;
}

export function parseModelsDevCatalog(input: unknown): ModelsDevProvider[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];

  const providers: ModelsDevProvider[] = [];
  for (const [key, raw] of Object.entries(
    input as Record<string, RawModelsDevProvider>,
  )) {
    if (!raw || typeof raw !== "object") continue;
    if (!SUPPORTED_NPM_PACKAGES.has(raw.npm ?? "")) continue;
    const type = providerType({ ...raw, id: raw.id ?? key });
    if (!type) continue;

    const models = Object.entries(raw.models ?? {})
      .map(([modelKey, model]): ModelsDevModel | null => {
        if (!model || typeof model !== "object") return null;
        const id = (model.id ?? modelKey).trim();
        if (!id) return null;
        const reasoningOptions = parseReasoningOptions(model.reasoning_options);
        return {
          id,
          name: model.name?.trim() || id,
          description: model.description?.trim() || undefined,
          family: model.family?.trim() || undefined,
          reasoning: model.reasoning,
          reasoningOptions:
            reasoningOptions.length > 0 ? reasoningOptions : undefined,
          toolCall: model.tool_call,
          modalities: model.modalities
            ? {
                input: model.modalities.input ?? [],
                output: model.modalities.output ?? [],
              }
            : undefined,
          releaseDate: model.release_date,
          lastUpdated: model.last_updated,
        };
      })
      .filter((model): model is ModelsDevModel => model !== null);

    if (models.length === 0) continue;
    providers.push({
      id: raw.id?.trim() || key,
      name: raw.name?.trim() || raw.id?.trim() || key,
      api: raw.api?.trim() || undefined,
      npm: raw.npm,
      env: raw.env ?? [],
      type,
      models,
    });
  }

  return providers.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export async function loadModelsDevCatalog(): Promise<ModelsDevProvider[]> {
  const response = await fetch(MODELS_DEV_CATALOG_URL);
  if (!response.ok) {
    throw new Error(`models.dev catalog failed (${response.status})`);
  }
  return parseModelsDevCatalog(await response.json());
}

export function searchModelsDevProviders(
  providers: ModelsDevProvider[],
  query: string,
): ModelsDevProvider[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return providers;
  return providers.filter((provider) =>
    [provider.name, provider.id, provider.api ?? ""].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

export function searchModelsDevModels(
  models: ModelsDevModel[],
  query: string,
): ModelsDevModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) =>
    [model.id, model.name, model.family ?? "", model.description ?? ""].some(
      (value) => value.toLowerCase().includes(needle),
    ),
  );
}

export function modelsDevModelsForFeature(
  models: ModelsDevModel[],
  feature: "language" | "voice-narration" | "voice-transcription",
): ModelsDevModel[] {
  const matches = models.filter((model) => {
    const input = model.modalities?.input ?? [];
    const output = model.modalities?.output ?? [];
    if (feature === "voice-narration") {
      return input.includes("text") && output.includes("audio");
    }
    if (feature === "voice-transcription") {
      return input.includes("audio") && output.includes("text");
    }
    return input.includes("text") && output.includes("text");
  });
  if (matches.length > 0) return matches;
  // Older or sparse catalog entries may not declare modalities. Preserve
  // usability only when the catalog genuinely has no modality information;
  // do not offer image or chat models for speech merely because no TTS model
  // matched.
  return models.every((model) => !model.modalities) ? models : [];
}

const CANONICAL_PROVIDER_IDS: Partial<Record<AiProviderType, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  openrouter: "openrouter",
  zai: "zai",
};

function normalizeUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export function findModelsDevProvider(
  providers: ModelsDevProvider[],
  config: {
    modelsDevId?: string;
    type: AiProviderType;
    baseUrl?: string;
  },
): ModelsDevProvider | undefined {
  if (config.modelsDevId) {
    const explicit = providers.find(
      (provider) => provider.id === config.modelsDevId,
    );
    if (explicit) return explicit;
  }
  const baseUrl = normalizeUrl(config.baseUrl);
  if (baseUrl) {
    const byUrl = providers.find(
      (provider) => normalizeUrl(provider.api) === baseUrl,
    );
    if (byUrl) return byUrl;
  }
  const canonicalId = CANONICAL_PROVIDER_IDS[config.type];
  return canonicalId
    ? providers.find((provider) => provider.id === canonicalId)
    : undefined;
}
