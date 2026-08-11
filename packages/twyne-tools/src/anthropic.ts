import type Anthropic from "@anthropic-ai/sdk";

export interface AnthropicRunOptions {
  model?: string;
  system?: string;
  maxTokens?: number;
  /** Selects a profile created by `ant auth login --profile NAME`. */
  profile?: string;
}

export interface AnthropicRunResult {
  finalResponse: string;
  model: string;
  stopReason: string | null;
  usage: unknown;
}

export function buildAnthropicClientOptions(
  options: Pick<AnthropicRunOptions, "profile">,
): { profile?: string } {
  return options.profile?.trim() ? { profile: options.profile.trim() } : {};
}

export function anthropicText(
  content: Array<{ type: string; text?: string }>,
): string {
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Run one Messages API turn through the official Anthropic SDK.
 *
 * With no API-key environment variable, the SDK resolves the active profile
 * written by `ant auth login` and refreshes its OAuth credential itself.
 */
export async function runAnthropicTask(
  prompt: string,
  options: AnthropicRunOptions = {},
): Promise<AnthropicRunResult> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  const client = new AnthropicClient(buildAnthropicClientOptions(options));
  const model = options.model ?? "claude-sonnet-4-6";
  const message = await client.messages.create({
    model,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.system ? { system: options.system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  return {
    finalResponse: anthropicText(
      message.content as Array<{ type: string; text?: string }>,
    ),
    model: message.model,
    stopReason: message.stop_reason,
    usage: message.usage,
  };
}

export type AnthropicClientOptions = ConstructorParameters<typeof Anthropic>[0];
