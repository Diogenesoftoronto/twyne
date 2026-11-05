import { describe, expect, test } from "bun:test";
import {
  CONSEQUENCE_LABELS,
  aiConsequenceFor,
  researchConsequenceFor,
  type Consequence,
} from "./consequence";
import { DEFAULT_AI_SETTINGS } from "../types";

describe("consequence", () => {
  test("every destination has a short word and a spoken description", () => {
    const all: Consequence[] = [
      "local",
      "synced",
      "provider",
      "credit",
      "public",
      "erase",
    ];
    for (const to of all) {
      expect(CONSEQUENCE_LABELS[to].short.length).toBeGreaterThan(0);
      expect(CONSEQUENCE_LABELS[to].long.length).toBeGreaterThan(
        CONSEQUENCE_LABELS[to].short.length,
      );
    }
  });

  test("an unconfigured room spends hosted credit", () => {
    expect(aiConsequenceFor(null)).toBe("credit");
    expect(aiConsequenceFor(DEFAULT_AI_SETTINGS)).toBe("credit");
  });

  test("a saved language provider with BYOK on routes to the writer's model", () => {
    expect(
      aiConsequenceFor({
        ...DEFAULT_AI_SETTINGS,
        advancedMode: true,
        providers: [
          {
            id: "anthropic-1",
            type: "anthropic",
            name: "Anthropic",
            apiKey: "sk-test",
            defaultModel: "claude-sonnet-5-5",
          },
        ],
        defaultProviderId: "anthropic-1",
      } as never),
    ).toBe("provider");
  });

  test("BYOK off still uses hosted credit, whatever is saved", () => {
    expect(
      aiConsequenceFor({
        ...DEFAULT_AI_SETTINGS,
        advancedMode: false,
        providers: [
          {
            id: "anthropic-1",
            type: "anthropic",
            name: "Anthropic",
            apiKey: "sk-test",
            defaultModel: "claude-sonnet-5-5",
          },
        ],
      } as never),
    ).toBe("credit");
  });

  test("research goes to the hosted service unless the writer chose a provider", () => {
    expect(researchConsequenceFor(null)).toBe("credit");
    expect(researchConsequenceFor({ researchProvider: "hosted" })).toBe(
      "credit",
    );
    expect(researchConsequenceFor({ researchProvider: "search-api" })).toBe(
      "provider",
    );
  });
});
