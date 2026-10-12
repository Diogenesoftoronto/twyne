// Call unchanged Source classify with a fake Ask. This executes both the real
// request builder and response branches; no provider call or account data.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { classify, fallbackClassification } from "../../../../src/utils/in-flow-tools";

const options = ["Leave the writer alone", "Try other wordings of one sentence", "See the paragraph's sentence rhythm", "Check how strongly to state the claim", "Hear what a reader would ask next"];
const defaults = ["A source", "An example", "A number"];
const base = {
  passage: "First😀 sentence. Second one. Another claim.",
  versions: ["oldest", "earlier", "before", "now"],
  hints: [{ kind: "claim-check", strength: 0.7, reason: "A claim keeps changing." }],
  goal: "Explain the claim.", audience: "Curious readers",
};
const answer = (choice: unknown = options[3], confidence: unknown = 0.5, probability: unknown = 0.6) => ({ ok: true, answers: { tool: { type: "choice", choice, confidence, probabilities: { [String(choice)]: probability } } } });
const cases: any[] = [];
async function record(id: string, input: any, response: any, slots = defaults) {
  let requestJson: string | undefined;
  let expected: any, error = false;
  try {
    expected = await classify({ ...input, reading: { score: 0.8, hints: input.hints } } as any, async request => {
      requestJson = JSON.stringify(request);
      return response;
    }, slots);
  } catch { error = true; }
  if (requestJson === undefined) throw new Error(`Source request was not built: ${id}`);
  cases.push({ id, input, response, slots, requestJson, ...(error ? { error } : { expected }) });
}
for (const [index, choice] of options.entries()) {
  for (const confidence of [0.49999999999999994, 0.5, 2, -1]) {
    for (const probability of [0.5999999999999999, 0.6, -1, 2]) await record(`threshold-${index}-${confidence}-${probability}`, base, answer(choice, confidence, probability));
  }
}
await record("empty-no-claim-question", { ...base, passage: "", hints: [] }, answer());
await record("leave-still-reads-claim-and-slots", { ...base, hints: [] }, { ...answer(options[0]), answers: { ...answer(options[0]).answers, claim: { type: "choice", choice: "2. Second one." }, slot0: { type: "noul", noul: 0.6 } } });
await record("unknown-tool-choice", base, answer("Make coffee"));
await record("ignored-nonnumeric-extra-probability", base, { ok: true, answers: { tool: { ...answer().answers.tool, probabilities: { [options[3]]: 0.6, unused: "ignore" } } } });
for (const [id, patch] of Object.entries({
  unavailable: { ok: false }, "missing-tool": { ok: true, answers: {} }, "wrong-tool-type": { ok: true, answers: { tool: { type: "noul", noul: 1 } } },
  "missing-probabilities": { ok: true, answers: { tool: { type: "choice", choice: options[3], confidence: 1 } } },
  "null-probabilities": { ok: true, answers: { tool: { type: "choice", choice: options[3], confidence: 1, probabilities: null } } },
})) await record(id, base, patch);
for (const [index, confidence] of [null, false, true, "0.5", " 0x1 ", "not a number", [], [0.5], {}, "Infinity", "inf", undefined].entries()) {
  const response = answer(options[3], confidence);
  if (confidence === undefined) delete (response.answers.tool as any).confidence;
  await record(`confidence-coercion-${index}`, base, response);
}
for (const [index, probability] of [null, false, true, "0.6", "\uFEFF0.59", [], [0.6], {}, "Infinity", "inf"].entries()) await record(`probability-coercion-${index}`, base, answer(options[3], 0.5, probability));
for (const [index, choice] of ["1. First", "+02 trailing", "\uFEFF2", "0", "-1", "13", "1e3", "0x2", "  0002", "wrong", 2, 2.5, 0.00002, 1e-7, 1e21, [2], true, null].entries()) {
  await record(`claim-prefix-${index}`, base, { ok: true, answers: { ...answer().answers, claim: { type: "choice", choice } } });
}
for (const [index, noul] of [0.5999999999999999, 0.6, null, true, false, "0.6", "Infinity", "not numeric", [0.6], {}].entries()) await record(`slot-coercion-${index}`, base, { ok: true, answers: { ...answer().answers, slot0: { type: "noul", noul } } });
await record("slot-missing-noul-is-false", base, { ok: true, answers: { ...answer().answers, slot0: { type: "noul" } } });
await record("duplicate-slots-last-answer-wins", base, { ok: true, answers: { ...answer().answers, slot0: { type: "noul", noul: 1 }, slot1: { type: "noul", noul: 0 } } }, ["same", "same"]);
await record("five-slots-and-prototype-label", base, { ok: true, answers: { ...answer().answers, slot0: { type: "noul", noul: 1 }, slot1: { type: "noul", noul: 1 }, slot5: { type: "noul", noul: 1 } } }, ["__proto__", "constructor", "ΟΣ", "İ source", "fifth", "ignored sixth"]);
await record("first-twelve-sentences", { ...base, passage: Array.from({ length: 14 }, (_, i) => `Sentence ${i + 1}.`).join(" ") }, { ok: true, answers: { ...answer().answers, claim: { type: "choice", choice: "13" } } });
await record("all-string-clips", { ...base, passage: "x".repeat(3005), versions: ["discard", "a".repeat(1505), "b".repeat(1505), "c".repeat(1505)], goal: "g".repeat(505), audience: "r".repeat(505) }, answer());
for (const [id, input] of [
  ["split-passage-surrogate", { ...base, passage: "a".repeat(2999) + "😀" }],
  ["split-sentence-surrogate", { ...base, passage: "a".repeat(159) + "😀." }],
  ["split-version-surrogate", { ...base, versions: ["a".repeat(1499) + "😀"] }],
  ["split-goal-surrogate", { ...base, goal: "a".repeat(499) + "😀" }],
  ["split-audience-surrogate", { ...base, audience: "a".repeat(499) + "😀" }],
  ["paired-at-boundary", { ...base, passage: "a".repeat(2998) + "😀" }],
] as const) await record(id, input, answer());
const fallbacks: any[] = [];
for (const [index, hints] of [[], [{ kind: "sentence-lab", strength: 0.5999999999999999, reason: "weak" }], [{ kind: "claim-check", strength: 0.6, reason: "strong" }], [{ kind: "rhythm-strip", strength: 0.3, reason: "first" }, { kind: "sentence-lab", strength: 1, reason: "second" }]].entries()) fallbacks.push({ id: `fallback-${index}`, hints, expected: fallbackClassification({ score: 1, hints } as any) });
const paths = ["src/utils/in-flow-tools.ts", "src/utils/struggle-signals.ts", "src/utils/system-one.ts"];
const hashes = Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
if (!process.argv[2]) throw new Error("Owned output path required");
await Bun.write(process.argv[2], JSON.stringify({ hashes, cases, fallbacks }, null, 2) + "\n");
console.log(JSON.stringify({ cases: cases.length, fallbacks: fallbacks.length }));
