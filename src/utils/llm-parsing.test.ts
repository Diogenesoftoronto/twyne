import { describe, expect, test } from "bun:test";
import {
  extractFirstJsonObject,
  extractTaggedJson,
  parseJudgeOutput,
  stripTaggedJson,
} from "./llm-parsing";

describe("llm parsing helpers", () => {
  test("extracts the first balanced JSON object from padded text", () => {
    expect(extractFirstJsonObject('before {"a":{"b":1}} after')).toBe(
      '{"a":{"b":1}}',
    );
  });

  test("parses tagged JSON and strips the tagged segment", () => {
    const text = 'Question?\nDOSSIER: {"brief":{"goal":"ship"}}';
    const segment = extractTaggedJson(text, "DOSSIER");

    expect(segment?.value).toEqual({ brief: { goal: "ship" } });
    expect(segment ? stripTaggedJson(text, segment) : "").toBe("Question?");
  });

  test("parses fenced judge JSON", () => {
    expect(
      parseJudgeOutput(
        '```json\n{"score": 7.4, "rationale": "Specific."}\n```',
      ),
    ).toEqual({ score: 7, rationale: "Specific." });
  });

  test("falls back to loose score and rationale parsing", () => {
    expect(
      parseJudgeOutput('score: 11\nrationale: "Useful but thin."'),
    ).toEqual({ score: 10, rationale: "Useful but thin." });
  });
});
