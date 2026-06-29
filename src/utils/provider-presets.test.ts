import { describe, expect, test } from "bun:test";
import { PROVIDER_METAS } from "../types";

describe("provider presets", () => {
  test("OpenAI-compatible presets discover models instead of hardcoding them", () => {
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
});
