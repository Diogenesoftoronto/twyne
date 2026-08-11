/**
 * Codex agent runner.
 *
 * The Codex SDK spawns the `codex` CLI as a child process and exchanges JSONL
 * over stdio, so it can only run where processes can be spawned — this package
 * and the desktop shell, never the browser or a Convex action. That is the
 * reason this lives in twyne-tools rather than src/utils.
 *
 * Codex is not OpenAI-only, despite the name. It reads `[model_providers.*]`
 * from its config, and the SDK forwards a `config` object as `--config k=v`
 * overrides after flattening nested objects into dotted paths. So a whole
 * custom provider can be declared from here, without the writer editing
 * ~/.codex/config.toml:
 *
 *   TWYNE_CODEX_BASE_URL=https://openrouter.ai/api/v1
 *   TWYNE_CODEX_API_KEY=sk-or-...
 *   TWYNE_CODEX_MODEL=anthropic/claude-opus-5
 *
 * Two constraints worth knowing before pointing this at a gateway:
 *  - `openai`, `ollama`, and `lmstudio` are reserved provider ids in Codex, so
 *    the provider declared here is named `twyne`.
 *  - Codex speaks the Responses API. A gateway that only exposes Chat
 *    Completions needs a translating proxy in front of it.
 *
 * With no apiKey/baseUrl overrides the SDK reuses the credential owned by the
 * local Codex CLI. Run `twyne provider login codex` (or `codex login`) first;
 * Twyne never reads or persists that cached ChatGPT credential.
 */

import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";

export interface CodexProviderSettings {
  /** OpenAI-compatible base URL. Omitted means Codex's own default. */
  baseUrl?: string;
  apiKey?: string;
  /** Model id as the provider spells it. */
  model?: string;
  /** Shown in Codex's own status output. */
  providerLabel?: string;
  /** Codex wire format. Responses is the safe default. */
  wireApi?: "responses" | "chat";
}

export interface CodexRunOptions extends CodexProviderSettings {
  workingDirectory?: string;
  /** Codex writes files by default; read-only is the safer default here. */
  sandboxMode?: ThreadOptions["sandboxMode"];
  reasoningEffort?: ThreadOptions["modelReasoningEffort"];
  skipGitRepoCheck?: boolean;
}

export interface CodexRunResult {
  finalResponse: string;
  threadId: string | null;
  /** Item types the turn produced, useful for logging what the agent did. */
  itemTypes: string[];
  usage?: unknown;
}

const PROVIDER_ID = "twyne";

export function codexSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CodexProviderSettings {
  const wire = env.TWYNE_CODEX_WIRE_API?.trim();
  return {
    baseUrl: env.TWYNE_CODEX_BASE_URL?.trim() || undefined,
    apiKey: env.TWYNE_CODEX_API_KEY?.trim() || undefined,
    model: env.TWYNE_CODEX_MODEL?.trim() || undefined,
    providerLabel: env.TWYNE_CODEX_PROVIDER_LABEL?.trim() || undefined,
    wireApi: wire === "chat" ? "chat" : wire === "responses" ? "responses" : undefined,
  };
}

/**
 * Build the SDK options for a custom provider.
 *
 * Exported separately from `runCodexTask` so the provider wiring can be
 * asserted in tests without spawning the CLI.
 */
export function buildCodexOptions(
  settings: CodexProviderSettings,
): CodexOptions {
  // No base URL means the writer is on Codex's built-in auth and provider;
  // declaring a custom provider in that case would only break it.
  if (!settings.baseUrl) {
    return settings.apiKey ? { apiKey: settings.apiKey } : {};
  }

  const envKey = "TWYNE_CODEX_API_KEY";
  const options: CodexOptions = {
    config: {
      model_provider: PROVIDER_ID,
      model_providers: {
        [PROVIDER_ID]: {
          name: settings.providerLabel ?? "Twyne provider",
          base_url: settings.baseUrl,
          env_key: envKey,
          wire_api: settings.wireApi ?? "responses",
          // Codex otherwise expects an OpenAI-shaped `sk-` key and rejects
          // gateway tokens that do not look like one.
          requires_openai_auth: false,
        },
      },
    },
  };
  if (settings.apiKey) {
    // The provider reads the key from the environment at request time, so it
    // has to be present in the CLI's environment, not just in the config.
    options.env = { ...process.env, [envKey]: settings.apiKey } as Record<
      string,
      string
    >;
  }
  return options;
}

/**
 * Run one Codex turn and return its final response.
 *
 * Defaults to a read-only sandbox: this is used for analysis over a writer's
 * repository, and an agent that can edit files by default is a surprise nobody
 * asked for. Callers that want writes must say so.
 */
export async function runCodexTask(
  prompt: string,
  options: CodexRunOptions = {},
): Promise<CodexRunResult> {
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex(buildCodexOptions(options));

  const threadOptions: ThreadOptions = {
    sandboxMode: options.sandboxMode ?? "read-only",
    skipGitRepoCheck: options.skipGitRepoCheck ?? true,
  };
  if (options.model) threadOptions.model = options.model;
  if (options.workingDirectory) {
    threadOptions.workingDirectory = options.workingDirectory;
  }
  if (options.reasoningEffort) {
    threadOptions.modelReasoningEffort = options.reasoningEffort;
  }

  const thread = codex.startThread(threadOptions);
  const turn = await thread.run(prompt);

  return {
    finalResponse: turn.finalResponse ?? "",
    threadId: thread.id,
    itemTypes: (turn.items ?? []).map((item) => item.type),
    usage: turn.usage,
  };
}
