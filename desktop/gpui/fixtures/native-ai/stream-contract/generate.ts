import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGenerationStreamAccumulator, snapshotFromRecord, textSnapshot } from "../../../../../src/utils/generation-stream";
import type { GenerationStreamInput, StreamRunStatus } from "../../../../../src/utils/generation-stream";
import { hasReasoningTags, removeReasoningTagMarkers, stripReasoningTags, trimPartialReasoningTag } from "../../../../../src/utils/reasoning-tags";
import { createInterviewStreamSnapshot, extractTaggedReasoning, hasOpenReasoningBlock } from "../../../../../src/utils/interview-stream";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../../../..");

export const SOURCE_FILES = ["src/utils/generation-stream.ts", "src/utils/reasoning-tags.ts", "src/utils/interview-stream.ts"] as const;

export type PersistedRow = { text: string; reasoning: string; phase: "reasoning" | "answer"; status: StreamRunStatus };

const td = (text: string): GenerationStreamInput => ({ type: "text-delta", text });
const rd = (text: string): GenerationStreamInput => ({ type: "reasoning-delta", text });
const START: GenerationStreamInput = { type: "reasoning-start" };
const END: GenerationStreamInput = { type: "reasoning-end" };
const FINISH: GenerationStreamInput = { type: "finish" };
const ERROR: GenerationStreamInput = { type: "error" };

const LT = "\u003c";
const GT = "\u003e";
const tag = (body: string): string => `${LT}${body}${GT}`;

const prefixes = (value: string): string[] =>
  Array.from({ length: value.length + 1 }, (_, index) => value.slice(0, index));
const chunkCase = (name: string, value: string): [string, GenerationStreamInput[]] => [
  name,
  [...Array.from(value).map(td), FINISH],
];

export const REASONING_CASES: Array<[string, string]> = [
  ["empty", ""],
  ["plain-space", "   \t  "],
  ["plain-text", "just prose, no tags"],
  ["js-bom-nbsp-nel", "\uFEFF\u00A0\u0085x\u0085\u00A0"],
  ["unicode-text", "Ünïcödé 漢字 🜂 ﷽"],
  ["think-lower", `a${tag("think")}secret${tag("/think")}b`],
  ["think-mixed-case", `a${tag("ThInK")}secret${tag("/ThInK")}b`],
  ["thinking-tag", `a${tag("thinking")}secret${tag("/thinking")}b`],
  ["think-attributes", `a${tag('think type="x" id=1')}secret${tag("/think ")}b`],
  ["think-self-closing", `a${tag("think/")}b`],
  ["think-self-closing-space", `a${tag("think /")}b`],
  ["think-stray-close", `a${tag("/think")}b`],
  ["think-42", `a${tag("think42")}b`],
  ["think-dash-x", `a${tag("think-x")}b`],
  ["think-underscore-foo", `a${tag("think_foo")}b`],
  ["space-before-slash", `a${tag(" think / ")}secret${tag("/ think ")}b`],
  ["nested-blocks", `a${tag("think")}1${tag("thinking")}2${tag("/thinking")}3${tag("/think")}b`],
  ["newline-indent", `a\n   ${tag("think")}\n  indented\n   ${tag("/think")}\n\t b`],
  ["triple-blank", "a\n\n\n\n\nb"],
  ["partial-prefixes", ["", "t", "th", "thi", "thin", "think"].map((s) => `${LT}${s}`).join("\n")],
  ["malformed-unclosed", `a${tag("think")}never closed`],
  ["malformed-garbage", `a${tag("think!!!")}x${tag("/think###")}b`],
  ["marker-text", 'DOSSIER: {"a":1}\nPROBE: q\nSYNTHESIZE: s'],
  ["partial-marker-prefixes", ["DOS", "DOSS", "DOSSIER:", "PROBE:", "SYNTHESIZE:"].join("\n")],
  ["mixed-open-nested", `a${tag("think")}b${tag("ThInKiNg")}c${tag("/thinking")}d`],
  ...["<", "</", "</ t", "<th\n", "  answer<th", "< /think>shown", "<thinké>hidden</think>"]
    .map((raw, index): [string, string] => [`boundary-${index}`, raw]),
];

export const GENERATION_CASES: Array<[string, GenerationStreamInput[]]> = [
  ["empty-completion", [FINISH]],
  ["error-only", [ERROR]],
  ["empty-text-delta", [td(""), FINISH]],
  ["plain-deltas", [td("Hel"), td("lo "), td("world"), FINISH]],
  ["whitespace-only", [td("   \n\t "), FINISH]],
  ["bom-nbsp-nel", [td("\uFEFF\u00A0\u0085text"), FINISH]],
  ["unicode-deltas", [td("Ünï"), td("cödé "), td("漢字 🜂"), FINISH]],
  ["tagged-reasoning", [td(`a${tag("think")}why${tag("/think")}b`), FINISH]],
  ["open-tagged-running", [td(`a${tag("think")}partial`)]],
  ["native-only", [START, rd("native "), rd("thought"), END, td("answer"), FINISH]],
  ["native-tagged-dedupe", [rd("same"), END, td(` ${tag("think")}same${tag("/think")}answer`), FINISH]],
  ["native-plus-tagged", [rd("native"), END, td(`${tag("thinking")}tagged${tag("/thinking")}answer`), FINISH]],
  ["reasoning-restart", [START, rd("one"), END, START, rd("two"), FINISH]],
  ["structured-contract-preserved", [td('Preamble.\nDOSSIER: {"a":1}\nPROBE: q\nSYNTHESIZE: done'), FINISH]],
  ["error-after-text", [td("partial answer"), ERROR]],
  ["finish-after-open-reasoning", [td(`a${tag("thinking")}r`), FINISH]],
  chunkCase("chunk-prefix-think", tag("think")),
  chunkCase("chunk-prefix-close-think", tag("/think")),
  chunkCase("chunk-prefix-thinking", tag("thinking")),
  ["mixed-case-attributes", [td(`a${tag('ThInKiNg data-x="1"')}r${tag("/ThInKiNg")}b`), FINISH]],
  ["malformed-tags", [td(`a${tag("think42")}${tag("think-x")}${tag("think_foo")}b`), FINISH]],
  ["space-before-slash", [td(`a${tag(" think / ")}r${tag("/ think ")}b`), FINISH]],
  ["newline-indent", [td(`a\n   ${tag("think")}\n  in\n   ${tag("/think")}\n\t b`), FINISH]],
];

export const INTERVIEW_CASES: Array<[string, string, string]> = [
  ["empty", "", ""],
  ["whitespace", "   \n  ", ""],
  ["plain", "Just an answer.", ""],
  ["structured-dossier", 'Answer.\nDOSSIER: {"x":1}\nPROBE: q\nSYNTHESIZE: s', ""],
  ["structured-probe-only", "Answer.\nPROBE: q", ""],
  ["structured-synthesize-only", "Answer.\nSYNTHESIZE: s", ""],
  ["partial-marker-dos", "Answer.\nDOS", ""],
  ["partial-marker-synth", "Answer.\nSYNTHE", ""],
  ["no-newline-marker", "Answer DOSSIER: x", ""],
  ["tagged-reasoning-hidden", `${tag("think")}why${tag("/think")}Answer.`, ""],
  ["native-reasoning", "Answer.", "native why"],
  ["native-tagged-dedupe", ` ${tag("think")}same${tag("/think")}Answer.`, "same"],
  ["native-plus-tagged", `${tag("thinking")}tagged${tag("/thinking")}Answer.`, "native"],
  ["bom-nbsp-nel", "\uFEFF\u00A0\u0085Answer.", ""],
  ["unicode", "Ünïcödé 漢字 🜂 answer", ""],
  ["open-block-hides-answer", `${tag("think")}only reasoning`, ""],
  ["marker-inside-think", `${tag("think")}DOSSIER: x${tag("/think")}Answer.`, ""],
  ["lowercase-marker", "Answer.\ndossier: x", ""],
  ["mixed-case-tag", `${tag("ThInK")}r${tag("/ThInK")}Answer.`, ""],
  ["attributes", `${tag('think data-x="1"')}r${tag("/think")}Answer.`, ""],
  ...["DOSSIER", "PROBE", "SYNTHESIZE"].flatMap((marker) =>
    prefixes(marker).map((prefix, index): [string, string, string] =>
      [`prefix-${marker}-${index}`, `Answer.\n${prefix}`, ""])),
];

export const TEXT_CASES: Array<[string, string, StreamRunStatus]> = [
  ["empty-complete", "", "complete"],
  ["whitespace-complete", "   ", "complete"],
  ["plain-complete", "hello", "complete"],
  ["unicode-complete", "Ünïcödé 漢字", "complete"],
  ["running-text", "hello", "running"],
  ["running-empty", "", "running"],
  ["error-text", "boom", "error"],
  ["error-empty", "", "error"],
];

export const RECORD_CASES: Array<[string, PersistedRow]> = [
  ["running-reasoning", { text: "", reasoning: "thinking", phase: "reasoning", status: "running" }],
  ["running-answer", { text: "answer", reasoning: "thinking", phase: "answer", status: "running" }],
  ["running-empty", { text: "", reasoning: "", phase: "answer", status: "running" }],
  ["complete-reasoning", { text: "answer", reasoning: "thinking", phase: "reasoning", status: "complete" }],
  ["complete-no-reasoning", { text: "answer", reasoning: "", phase: "answer", status: "complete" }],
  ["error-answer", { text: "partial", reasoning: "", phase: "answer", status: "error" }],
  ["error-empty", { text: "", reasoning: "", phase: "reasoning", status: "error" }],
  ["unicode-persisted", { text: "Ünïcödé 漢字", reasoning: "理由", phase: "answer", status: "complete" }],
];

export function buildVectors() {
  const sourceSha256: Record<string, string> = {};
  for (const file of SOURCE_FILES) {
    sourceSha256[file] = createHash("sha256").update(readFileSync(resolve(REPO_ROOT, file))).digest("hex");
  }

  const reasoning = REASONING_CASES.map(([name, raw]) => ({
    name,
    raw,
    strip: stripReasoningTags(raw),
    extract: extractTaggedReasoning(raw),
    open: hasOpenReasoningBlock(raw),
    hasTags: hasReasoningTags(raw),
    removeMarkers: removeReasoningTagMarkers(raw),
    trimPartial: trimPartialReasoningTag(raw),
  }));

  const generation = GENERATION_CASES.map(([name, inputs]) => {
    const accumulator = createGenerationStreamAccumulator();
    const initial = accumulator.snapshot();
    const snapshots = inputs.map((input) => accumulator.push(input));
    return { name, inputs, snapshots, initial };
  });

  const interview = INTERVIEW_CASES.map(([name, raw, nativeReasoning]) => ({
    name,
    raw,
    nativeReasoning,
    snapshot: createInterviewStreamSnapshot(raw, nativeReasoning),
  }));

  const textSnapshots = TEXT_CASES.map(([name, text, status]) => ({
    name,
    text,
    status,
    snapshot: textSnapshot(text, status),
  }));

  const recordCases = RECORD_CASES.map(([name, row]) => ({
    name,
    row,
    snapshot: snapshotFromRecord(row),
  }));

  return {
    generator: "desktop/gpui/fixtures/native-ai/stream-contract/generate.ts",
    sourceSha256,
    reasoning,
    generation,
    interview,
    textSnapshots,
    snapshotFromRecord: recordCases,
  };
}

if (import.meta.main) {
  const output = resolve(HERE, "source-vectors.json");
  writeFileSync(output, `${JSON.stringify(buildVectors(), null, 2)}\n`);
  console.log(`wrote ${output}`);
}
