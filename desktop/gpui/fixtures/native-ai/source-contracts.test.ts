// @ts-ignore
globalThis.__EXPERIMENTAL__ = globalThis.__EXPERIMENTAL__ || {};

import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  stripReasoningTags,
  hasReasoningTags,
  trimPartialReasoningTag,
  removeReasoningTagMarkers,
} from "../../../../src/utils/reasoning-tags";
import { createGenerationStreamAccumulator } from "../../../../src/utils/generation-stream";
import { createInterviewStreamSnapshot } from "../../../../src/utils/interview-stream";
import {
  parseJudgeOutput,
  stripJsonFences,
  extractFirstJsonObject,
  extractTaggedJson,
} from "../../../../src/utils/llm-parsing";
import {
  DEFAULT_TARGETS_PER_PASS,
  parseResearchTargets,
  targetKindLabel,
} from "../../../../src/utils/research-targets";
import {
  resolveFeatureConfig,
  resolveFeatureConfigForPersona,
  hasConfiguredAiProvider,
  hasConfiguredVoiceProvider,
} from "../../../../src/utils/ai-client";
import type { AiSettings } from "../../../../src/types";

describe("Native AI Source Contracts & Golden Vectors", () => {
  it("reasoning tags stripping and partial withholding", () => {
    const normal = "<think>considering phrasing</think>Hello world!";
    expect(stripReasoningTags(normal)).toBe("Hello world!");
    expect(hasReasoningTags(normal)).toBe(true);

    const malformedCloser = "<think>evaluating<think/>Final response text";
    expect(stripReasoningTags(malformedCloser)).toBe("Final response text");

    const unclosed = "Beginning of answer<think>unclosed thought";
    expect(stripReasoningTags(unclosed)).toBe("Beginning of answer");

    const partial1 = trimPartialReasoningTag("Hello world <th");
    expect(partial1).toBe("Hello world");

    const partial2 = trimPartialReasoningTag("Prose text <think");
    expect(partial2).toBe("Prose text");

    const markersRemoved = removeReasoningTagMarkers("<think>first</think> second");
    expect(markersRemoved).toBe("first second");
  });

  it("generation stream accumulator snapshots", () => {
    const acc = createGenerationStreamAccumulator();
    expect(acc.snapshot()).toMatchObject({
      text: "",
      reasoning: "",
      activePart: null,
      status: "running",
    });

    acc.push({ type: "reasoning-start" });
    acc.push({ type: "reasoning-delta", text: "Analyzing premise..." });
    let snap = acc.snapshot();
    expect(snap.reasoning).toBe("Analyzing premise...");
    expect(snap.activePart).toBe("reasoning");
    expect(snap.reasoningStatus).toBe("running");

    acc.push({ type: "reasoning-end" });
    acc.push({ type: "text-delta", text: "The premise is solid." });
    snap = acc.snapshot();
    expect(snap.text).toBe("The premise is solid.");
    expect(snap.activePart).toBe("text");
    expect(snap.textStatus).toBe("running");

    acc.push({ type: "finish" });
    snap = acc.snapshot();
    expect(snap.status).toBe("complete");
    expect(snap.activePart).toBe(null);
  });

  it("interview stream snapshot marker withholding", () => {
    const stream1 = createInterviewStreamSnapshot(
      "Good question.\nDOSSIER: {\"workingTitle\": \"Echoes\"}",
    );
    expect(stream1.text).toBe("Good question.");
    expect(stream1.phase).toBe("answer");

    const stream2 = createInterviewStreamSnapshot(
      "Let's think.\nSYNTHESIZE",
    );
    expect(stream2.text).toBe("Let's think.");
  });

  it("structured parsing: judge output and code fences", () => {
    const jsonJudge = "```json\n{\"score\": 8, \"rationale\": \"Strong thematic cohesion.\"}\n```";
    const parsed1 = parseJudgeOutput(jsonJudge);
    expect(parsed1).toEqual({
      score: 8,
      rationale: "Strong thematic cohesion.",
    });

    const quotedJudge = "Score: 9\nRationale: \"Excellent evidence and grounding.\"";
    const parsed2 = parseJudgeOutput(quotedJudge);
    expect(parsed2).toEqual({
      score: 9,
      rationale: "Excellent evidence and grounding.",
    });

    const unquotedJudge = "Score: 7\nRationale: Some unquoted text";
    const parsed3 = parseJudgeOutput(unquotedJudge);
    expect(parsed3).toEqual({
      score: 7,
      rationale: "The draft does part of the work and leaves the rest to the writer.",
    });

    const tagged = "SYNTHESIZE: {\"summary\": \"A bold novella about memory.\"}";
    const segment = extractTaggedJson(tagged, "SYNTHESIZE");
    expect(segment?.value).toEqual({ summary: "A bold novella about memory." });
  });

  it("research targets parsing", () => {
    const targetJson = `[
      {"kind": "quote", "anchor": "To be or not to be", "query": "Hamlet soliloquy source"},
      {"kind": "statistic", "anchor": "73% of writers", "query": "writer survey percentage 73"}
    ]`;
    const targets = parseResearchTargets(targetJson);
    expect(targets.length).toBe(2);
    expect(targets[0].kind).toBe("quote");
    expect(targets[0].anchor).toBe("To be or not to be");
    expect(targets[1].kind).toBe("statistic");
  });

  it("provider configuration and feature resolution", () => {
    const settings: AiSettings = {
      defaultProviderId: "anthropic-main",
      providers: [
        {
          id: "anthropic-main",
          name: "Anthropic Claude",
          type: "anthropic",
          apiKey: "secret-key",
          defaultModel: "claude-3-5-sonnet",
        },
        {
          id: "fish-speech",
          name: "Fish Audio",
          type: "fishaudio",
          apiKey: "voice-key",
          defaultModel: "s2-pro",
        },
        {
          id: "custom-local",
          name: "Custom Local Model",
          type: "openai-compatible",
          apiKey: "local",
          baseUrl: "http://127.0.0.1:45123/v1",
          defaultModel: "minicpm5-2b",
        },
      ],
      perFeature: {
        "rubric-judge": {
          providerId: "custom-local",
          model: "minicpm5-2b",
          temperature: 0.1,
        },
      },
    };

    expect(hasConfiguredAiProvider(settings)).toBe(true);
    expect(hasConfiguredVoiceProvider(settings)).toBe(true);

    const rubricCfg = resolveFeatureConfig(settings, "rubric-judge");
    expect(rubricCfg?.provider.id).toBe("custom-local");
    expect(rubricCfg?.model).toBe("minicpm5-2b");
    expect(rubricCfg?.temperature).toBe(0.1);

    const analysisCfg = resolveFeatureConfig(settings, "persona-analysis");
    expect(analysisCfg?.provider.id).toBe("anthropic-main");
    expect(analysisCfg?.model).toBe("claude-3-5-sonnet");
    expect(analysisCfg?.temperature).toBe(0.5);

    // Voice narration must route to fishaudio rather than language models
    const voiceCfg = resolveFeatureConfig(settings, "voice-narration");
    expect(voiceCfg?.provider.id).toBe("fish-speech");
  });

  it("exports golden vectors for standalone Rust parity tests", () => {
    const vectors = {
      reasoningTags: [
        {
          input: "<think>considering phrasing</think>Hello world!",
          stripped: stripReasoningTags("<think>considering phrasing</think>Hello world!"),
          hasTags: hasReasoningTags("<think>considering phrasing</think>Hello world!"),
        },
        {
          input: "<think>evaluating<think/>Final response text",
          stripped: stripReasoningTags("<think>evaluating<think/>Final response text"),
          hasTags: true,
        },
        {
          input: "Beginning of answer<think>unclosed thought",
          stripped: stripReasoningTags("Beginning of answer<think>unclosed thought"),
          hasTags: true,
        },
      ],
      partialTags: [
        { input: "Hello world <th", trimmed: trimPartialReasoningTag("Hello world <th") },
        { input: "Prose text <think", trimmed: trimPartialReasoningTag("Prose text <think") },
        { input: "Prose text <thinking", trimmed: trimPartialReasoningTag("Prose text <thinking") },
        { input: "Done text <", trimmed: trimPartialReasoningTag("Done text <") },
        { input: "Ordinary text <5 is less than 6", trimmed: trimPartialReasoningTag("Ordinary text <5 is less than 6") },
      ],
      judgeOutputs: [
        {
          input: "```json\n{\"score\": 8, \"rationale\": \"Strong thematic cohesion.\"}\n```",
          expected: parseJudgeOutput("```json\n{\"score\": 8, \"rationale\": \"Strong thematic cohesion.\"}\n```"),
        },
        {
          input: "Score: 9\nRationale: Excellent evidence and grounding.",
          expected: parseJudgeOutput("Score: 9\nRationale: Excellent evidence and grounding."),
        },
      ],
      researchTargets: {
        input: `[
          {"kind": "quote", "anchor": "To be or not to be", "query": "Hamlet soliloquy source"},
          {"kind": "statistic", "anchor": "73% of writers", "query": "writer survey percentage 73"}
        ]`,
        parsed: parseResearchTargets(`[
          {"kind": "quote", "anchor": "To be or not to be", "query": "Hamlet soliloquy source"},
          {"kind": "statistic", "anchor": "73% of writers", "query": "writer survey percentage 73"}
        ]`),
      },
    };

    const outPath = resolve(import.meta.dir, "golden-vectors.json");
    writeFileSync(outPath, JSON.stringify(vectors, null, 2) + "\n", "utf8");
    expect(vectors.reasoningTags.length).toBe(3);
  });
});
