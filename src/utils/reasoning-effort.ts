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
import type { AiProviderConfig, AiModelReasoningSetting } from "../types";

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
