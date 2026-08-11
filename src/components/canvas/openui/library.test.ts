import { describe, expect, test } from "bun:test";

import {
  canvasLibrary,
  canvasSchema,
  canvasSystemPrompt,
  redactUpstreamRules,
} from "./library";

describe("canvas component library", () => {
  test("defines every card primitive the renderer expects", () => {
    expect(Object.keys(canvasLibrary.components).sort()).toEqual(
      [
        "Annotation",
        "Callout",
        "Card",
        "Cards",
        "Comparison",
        "Figure",
        "Flow",
        "KeyValueTable",
        "Outline",
        "Prose",
        "Quote",
      ].sort(),
    );
  });

  test("produces a JSON schema the streaming parser can consume", () => {
    const schema = canvasSchema() as Record<string, unknown>;
    expect(schema.$defs).toBeDefined();
    expect(schema.properties).toBeDefined();
  });
});

describe("upstream prompt redaction", () => {
  /**
   * The guard that matters. lang-core's default prompt tells the model to
   * "generate realistic/plausible data" — fine for composing a dashboard,
   * catastrophic for transcribing a source a writer may then cite.
   */
  test("strips the fabrication rule from the generated prompt", () => {
    const prompt = canvasSystemPrompt();
    expect(prompt).not.toContain("generate realistic/plausible data");
    expect(prompt).toContain("Never invent data");
  });

  test("drops the advertisement for components this library lacks", () => {
    const prompt = canvasSystemPrompt();
    expect(prompt).not.toContain("charts for trends");
  });

  test("throws when upstream rewords the rule, rather than silently passing it through", () => {
    expect(() => redactUpstreamRules("## Important Rules\n- something else")).toThrow(
      /no longer emits the expected boilerplate/,
    );
  });

  test("keeps the transcription rules and the root contract", () => {
    const prompt = canvasSystemPrompt();
    expect(prompt).toContain("root = Cards(...)");
    expect(prompt).toContain("The only place you write in your own voice is Annotation");
    expect(prompt).toContain("does not appear in the source text");
  });
});
