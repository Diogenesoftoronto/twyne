import { describe, expect, test } from "bun:test";
import { buildCodexOptions, codexSettingsFromEnv } from "../src/codex.js";

describe("codex provider wiring", () => {
  test("stays on Codex's own provider when no base URL is set", () => {
    expect(buildCodexOptions({})).toEqual({});
    expect(buildCodexOptions({ apiKey: "sk-test" })).toEqual({
      apiKey: "sk-test",
    });
  });

  test("declares a custom provider for a non-OpenAI gateway", () => {
    const options = buildCodexOptions({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test",
      providerLabel: "OpenRouter",
    });

    const providers = options.config?.model_providers as Record<
      string,
      Record<string, unknown>
    >;
    expect(options.config?.model_provider).toBe("twyne");
    // "openai", "ollama" and "lmstudio" are reserved provider ids in Codex.
    expect(Object.keys(providers)).toEqual(["twyne"]);
    expect(providers.twyne).toMatchObject({
      name: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      env_key: "TWYNE_CODEX_API_KEY",
      wire_api: "responses",
      requires_openai_auth: false,
    });
  });

  test("puts the key in the CLI environment, since env_key is read at request time", () => {
    const options = buildCodexOptions({
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "gw-secret",
    });
    expect(options.env?.TWYNE_CODEX_API_KEY).toBe("gw-secret");
  });

  test("honours an explicit chat wire format", () => {
    const options = buildCodexOptions({
      baseUrl: "https://gateway.example.com/v1",
      wireApi: "chat",
    });
    const providers = options.config?.model_providers as Record<
      string,
      Record<string, unknown>
    >;
    expect(providers.twyne.wire_api).toBe("chat");
  });

  test("reads settings from the environment", () => {
    expect(
      codexSettingsFromEnv({
        TWYNE_CODEX_BASE_URL: "https://openrouter.ai/api/v1",
        TWYNE_CODEX_API_KEY: "sk-or-test",
        TWYNE_CODEX_MODEL: "anthropic/claude-opus-5",
        TWYNE_CODEX_WIRE_API: "nonsense",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test",
      model: "anthropic/claude-opus-5",
      providerLabel: undefined,
      // An unrecognised value falls through to the Codex default rather than
      // being passed on as-is.
      wireApi: undefined,
    });
  });
});
