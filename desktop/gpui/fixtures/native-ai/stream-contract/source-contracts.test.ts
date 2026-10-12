import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildVectors,
  HERE,
  REPO_ROOT,
  SOURCE_FILES,
  type PersistedRow,
} from "./generate";
import {
  createGenerationStreamAccumulator,
  snapshotFromRecord,
  textSnapshot,
  type GenerationStreamInput,
  type StreamRunStatus,
} from "../../../../../src/utils/generation-stream";
import {
  createInterviewStreamSnapshot,
  extractTaggedReasoning,
  hasOpenReasoningBlock,
} from "../../../../../src/utils/interview-stream";
import { stripReasoningTags } from "../../../../../src/utils/reasoning-tags";

const recorded = JSON.parse(
  readFileSync(resolve(HERE, "source-vectors.json"), "utf8"),
);

describe("recorded fixtures", () => {
  test("source hashes match the Source files on disk", () => {
    expect(Object.keys(recorded.sourceSha256)).toEqual([...SOURCE_FILES]);
    for (const file of SOURCE_FILES) {
      const actual = createHash("sha256")
        .update(readFileSync(resolve(REPO_ROOT, file)))
        .digest("hex");
      expect(actual).toBe(recorded.sourceSha256[file]);
    }
  });

  test("whole recorded vector set equals a fresh execution of Source", () => {
    expect(buildVectors()).toEqual(recorded);
  });

  test("every generation snapshot is one accumulator.push result", () => {
    for (const entry of recorded.generation) {
      expect(entry.snapshots.length).toBe(entry.inputs.length);
      const accumulator = createGenerationStreamAccumulator();
      expect(accumulator.snapshot()).toEqual(entry.initial);
      (entry.inputs as GenerationStreamInput[]).forEach((input, index) => {
        expect(accumulator.push(input)).toEqual(entry.snapshots[index]);
      });
    }
    const total = recorded.generation.reduce(
      (sum: number, entry: { snapshots: unknown[] }) => sum + entry.snapshots.length,
      0,
    );
    expect(total).toBeLessThan(200);
  });

  test("every interview snapshot is a fresh Source call", () => {
    for (const entry of recorded.interview) {
      expect(
        createInterviewStreamSnapshot(entry.raw, entry.nativeReasoning),
      ).toEqual(entry.snapshot);
    }
  });

  test("every text and record snapshot is a fresh Source call", () => {
    for (const entry of recorded.textSnapshots) {
      expect(textSnapshot(entry.text, entry.status as StreamRunStatus)).toEqual(
        entry.snapshot,
      );
    }
    for (const entry of recorded.snapshotFromRecord) {
      expect(snapshotFromRecord(entry.row as PersistedRow)).toEqual(entry.snapshot);
    }
  });
});

describe("coverage", () => {
  const names = (list: Array<{ name: string }>) => list.map((entry) => entry.name);

  test("required reasoning cases are present", () => {
    const present = names(recorded.reasoning);
    for (const required of [
      "empty",
      "plain-space",
      "js-bom-nbsp-nel",
      "unicode-text",
      "think-mixed-case",
      "thinking-tag",
      "think-attributes",
      "think-self-closing",
      "think-stray-close",
      "think-42",
      "think-dash-x",
      "think-underscore-foo",
      "space-before-slash",
      "nested-blocks",
      "newline-indent",
      "partial-prefixes",
      "malformed-unclosed",
      "malformed-garbage",
    ]) {
      expect(present).toContain(required);
    }
  });

  test("required generation and interview cases are present", () => {
    const generation = names(recorded.generation);
    for (const required of [
      "empty-completion",
      "error-only",
      "native-tagged-dedupe",
      "structured-contract-preserved",
      "error-after-text",
      "chunk-prefix-think",
      "chunk-prefix-close-think",
      "malformed-tags",
    ]) {
      expect(generation).toContain(required);
    }
    const interview = names(recorded.interview);
    for (const required of [
      "structured-dossier",
      "partial-marker-dos",
      "no-newline-marker",
      "tagged-reasoning-hidden",
      "native-tagged-dedupe",
      "open-block-hides-answer",
    ]) {
      expect(interview).toContain(required);
    }
  });
});

describe("live Source semantics", () => {
  test("tag stripping, partial trimming, and open-block detection", () => {
    expect(stripReasoningTags("a\u003cthink\u003ex\u003c/think\u003eb")).toBe("ab");
    expect(stripReasoningTags("a\u003cThInKiNg \u003ex\u003c/ thinking\u003eb")).toBe("ab");
    expect(stripReasoningTags("a\u003cthink42\u003eb")).toBe("a\u003cthink42\u003eb");
    expect(stripReasoningTags("a\u003cthink_foo\u003eb")).toBe("a\u003cthink_foo\u003eb");
    expect(stripReasoningTags("a\u003cthink-x\u003eb")).toBe("a");
    expect(stripReasoningTags("a\u003cthink/\u003eb")).toBe("ab");
    expect(extractTaggedReasoning("a\u003cthink\u003ewhy\u003c/think\u003eb")).toBe("why");
    expect(hasOpenReasoningBlock("a\u003cthink\u003epartial")).toBe(true);
    expect(hasOpenReasoningBlock("a\u003cthink\u003er\u003c/think\u003e")).toBe(false);
  });

  test("accumulator withholds partial tags and dedupes native reasoning", () => {
    const accumulator = createGenerationStreamAccumulator();
    expect(accumulator.push({ type: "text-delta", text: "a\u003cth" }).text).toBe("a");
    expect(accumulator.push({ type: "text-delta", text: "ink\u003er" }).activePart).toBe(
      "reasoning",
    );
    const dedupe = createGenerationStreamAccumulator();
    dedupe.push({ type: "reasoning-delta", text: "same" });
    dedupe.push({ type: "reasoning-end" });
    dedupe.push({
      type: "text-delta",
      text: " \u003cthink\u003esame\u003c/think\u003eanswer",
    });
    expect(dedupe.push({ type: "finish" }).reasoning).toBe("same");
  });

  test("interview hides the structured contract that generation keeps", () => {
    const raw = 'Answer.\nDOSSIER: {"x":1}\nPROBE: q';
    expect(createInterviewStreamSnapshot(raw, "").text).toBe("Answer.");
    const accumulator = createGenerationStreamAccumulator();
    accumulator.push({ type: "text-delta", text: raw });
    expect(accumulator.push({ type: "finish" }).text).toBe(raw);
  });
});
