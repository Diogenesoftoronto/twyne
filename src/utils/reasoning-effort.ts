/**
 * How hard the model should think before it answers.
 *
 * Every major provider now sells a thinking dial, and every one of them spells
 * it differently: OpenAI takes a word, Google takes a word *or* a token budget,
 * Anthropic takes only a budget and needs to be told the feature is on at all.
 * A writer choosing "think harder about my structure" should not have to know
 * any of that, so the setting is stored provider-neutral on the provider config
 * and translated here, once, at the call site.
 *
 * Absent means absent: a provider with no level set sends no reasoning options
 * and gets whatever the model does by default. That is deliberately distinct
 * from `"off"`, which asks the model *not* to think — on a reasoning model
 * those are different requests, and only the writer knows which they meant.
 */
import type {
  AiModelReasoningSetting,
  AiProviderConfig,
  AiReasoningEffort,
} from "../types";

/** JSON-ish value accepted by the AI SDK's `providerOptions`. */
type ProviderOptionValue =
  | string
  | number
  | boolean
  | null
  | ProviderOptionValue[]
  | { [key: string]: ProviderOptionValue };

export type ProviderOptions = Record<
  string,
  Record<string, ProviderOptionValue>
>;

/**
 * Which family's option keys this provider answers to.
 *
 * Keyed off how {@link createModel} builds the model rather than off the
 * provider type alone: every OpenAI-shaped endpoint Twyne talks to — DeepSeek,
 * OpenRouter, Ollama, Z.ai, MiniMax, LiteRT, Tinker and plain
 * OpenAI-compatible — is constructed with `createOpenAI`, which reports itself
 * as `openai`, so they all read `providerOptions.openai`.
 */
function optionFamily(
  type: AiProviderConfig["type"],
): "openai" | "anthropic" | "google" | null {
  switch (type) {
    case "anthropic":
    case "anthropic-compatible":
      return "anthropic";
    case "google":
      return "google";
    case "openai":
    case "openai-compatible":
    case "deepseek":
    case "openrouter":
    case "ollama":
    case "zai":
    case "minimax":
    case "litert":
      return "openai";
    default:
      // Voice-only providers have no language model to think with.
      return null;
  }
}

/**
 * Can this provider family carry a thinking instruction at all?
 *
 * A necessary condition, not a sufficient one — whether the *model* reasons is
 * the question that actually decides it, and only the catalog knows that.
 * Settings uses this to rule out the families that could never work (a
 * voice-only endpoint), then defers to {@link ModelsDevModel.reasoning}.
 */
export function supportsReasoningEffort(
  type: AiProviderConfig["type"],
): boolean {
  return optionFamily(type) !== null;
}

/**
 * Translate the level set for one model into that provider's
 * `providerOptions`.
 *
 * Returns undefined when there is nothing to say — no level set for this
 * model, or a family with no dial — so the caller can spread the result
 * without planting an empty object in the request. This is the safety
 * property that keeps a thinking parameter away from a model that would
 * reject it: silence is the default, and only an explicit choice breaks it.
 */
export function reasoningProviderOptions(
  config: Pick<AiProviderConfig, "type" | "modelReasoning">,
  modelId: string | undefined,
): ProviderOptions | undefined {
  const setting = modelId ? config.modelReasoning?.[modelId] : undefined;
  if (!setting) return undefined;
  const family = optionFamily(config.type);
  if (!family) return undefined;

  return translateReasoningSetting(family, setting);
}

/**
 * Translate the adaptive drafting loop's provider-neutral level without
 * changing the writer's saved Settings value. Unknown models remain untouched:
 * a reasoning option is only sent when the model catalog or an existing model
 * setting proves that the selected provider understands one.
 */
export function reasoningProviderOptionsForLevel(
  config: Pick<
    AiProviderConfig,
    "type" | "modelReasoning" | "modelReasoningOptions"
  >,
  modelId: string | undefined,
  level: "off" | "low" | "medium" | "high",
): ProviderOptions | undefined {
  if (!modelId) return undefined;
  const family = optionFamily(config.type);
  if (!family) return undefined;
  const setting = config.modelReasoning?.[modelId];
  const options = config.modelReasoningOptions?.[modelId] ?? [];
  const option = options[0];

  if (!setting && !option) return undefined;

  if (level === "off") {
    switch (family) {
      case "openai":
        return { openai: { reasoningEffort: "none" } };
      case "anthropic":
        return { anthropic: { thinking: { type: "disabled" } } };
      case "google":
        return { google: { thinkingConfig: { thinkingBudget: 0 } } };
    }
  }

  if (setting?.type === "toggle" || option?.type === "toggle") {
    return family === "anthropic"
      ? { anthropic: { thinking: { type: "adaptive" } } }
      : family === "google"
        ? { google: { thinkingConfig: { thinkingBudget: -1 } } }
        : { openai: { reasoningEffort: "high" } };
  }

  if (setting?.type === "budget_tokens" || option?.type === "budget_tokens") {
    const range = option?.type === "budget_tokens" ? option : undefined;
    const fallback = setting?.type === "budget_tokens" ? setting.value : 0;
    const min = range?.min ?? Math.max(1, Math.floor(fallback / 4));
    const max = range?.max ?? Math.max(min, fallback);
    const ratio = level === "low" ? 0.35 : level === "medium" ? 0.65 : 1;
    const value = Math.min(
      max,
      Math.max(min, Math.round(min + (max - min) * ratio)),
    );
    return family === "anthropic"
      ? { anthropic: { thinking: { type: "enabled", budgetTokens: value } } }
      : family === "google"
        ? { google: { thinkingConfig: { thinkingBudget: value } } }
        : { openai: { reasoningEffort: level } };
  }

  const supported =
    option?.type === "effort"
      ? option.values.filter(
          (value): value is AiReasoningEffort => value !== null,
        )
      : [];
  const desired: AiReasoningEffort =
    level === "low" ? "low" : level === "medium" ? "medium" : "high";
  const selected =
    supported.length > 0
      ? supported[
          Math.min(
            supported.length - 1,
            ["low", "medium", "high", "xhigh", "max"].indexOf(desired),
          )
        ]!
      : desired;

  if (family === "anthropic") {
    return { anthropic: { thinking: { type: "adaptive" }, effort: selected } };
  }
  if (family === "google") {
    return { google: { thinkingConfig: { thinkingLevel: selected } } };
  }
  return { openai: { reasoningEffort: selected } };
}

/** Read the writer's configured level as the adaptive loop's ceiling. */
export function adaptiveReasoningCeiling(
  config: Pick<AiProviderConfig, "modelReasoning" | "modelReasoningOptions">,
  modelId: string | undefined,
): "off" | "low" | "medium" | "high" {
  if (!modelId) return "high";
  const setting = config.modelReasoning?.[modelId];
  if (!setting) return "high";
  if (setting.type === "toggle") return setting.value ? "high" : "off";
  if (setting.type === "effort") {
    return setting.value === "low"
      ? "low"
      : setting.value === "medium"
        ? "medium"
        : "high";
  }
  const range = config.modelReasoningOptions?.[modelId]?.find(
    (option) => option.type === "budget_tokens",
  );
  if (!range || range.type !== "budget_tokens" || range.max <= range.min) {
    return setting.value > 0 ? "high" : "off";
  }
  const ratio = (setting.value - range.min) / (range.max - range.min);
  return ratio < 0.45 ? "low" : ratio < 0.8 ? "medium" : "high";
}

function translateReasoningSetting(
  family: "openai" | "anthropic" | "google",
  setting: AiModelReasoningSetting,
): ProviderOptions | undefined {
  switch (family) {
    case "openai": {
      if (setting.type === "budget_tokens") return undefined;
      const effort =
        setting.type === "effort"
          ? setting.value
          : setting.value
            ? "high"
            : "none";
      return { openai: { reasoningEffort: effort } };
    }
    case "anthropic":
      if (setting.type === "budget_tokens") {
        return {
          anthropic: {
            thinking: {
              type: "enabled",
              budgetTokens: setting.value,
            },
          },
        };
      }
      if (setting.type === "toggle") {
        return {
          anthropic: {
            thinking: { type: setting.value ? "adaptive" : "disabled" },
          },
        };
      }
      return {
        anthropic: {
          thinking: { type: "adaptive" },
          effort: setting.value,
        },
      };
    case "google": {
      if (setting.type === "effort") {
        return {
          google: { thinkingConfig: { thinkingLevel: setting.value } },
        };
      }
      return {
        google: {
          thinkingConfig: {
            thinkingBudget:
              setting.type === "toggle"
                ? setting.value
                  ? -1
                  : 0
                : setting.value,
          },
        },
      };
    }
  }
}
