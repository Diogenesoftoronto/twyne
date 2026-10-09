import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { resolve } from "node:path";
import { Schema } from "@tiptap/pm/model";
import { segmentDocument } from "../../src/utils/living-desk/segment";
import { analyzeDesk } from "../../src/utils/living-desk/analyze";
import { buildScore } from "../../src/utils/living-desk/score";
import {
  checkSentenceCandidates,
  localSentenceCandidates,
  sentenceCandidate,
  sentenceWordDiff,
  wordAlternatives,
} from "../../src/utils/sentence-bench";
import {
  completeSentence,
  emptySentenceLedger,
  reconcileSentenceLedger,
  settleSentenceWording,
} from "../../src/utils/sentence-ledger";
import {
  executeInstrumentTask,
  InstrumentTaskCancelled,
} from "../../src/utils/instrument-tasks-runner";
import {
  instrumentTextFingerprint,
  type InstrumentTaskRequest,
} from "../../src/utils/instrument-tasks-model";
import { CORPUS_VERSION, deskCases, rewriteCases, missions } from "./corpus";
import { buildSpanIndex, proposeThreadPairs } from "../../src/utils/span-index";
import { ruleThreads } from "../../src/utils/thread-instrument";
import {
  createSceneInventory,
  createSceneMediaBrief,
  resolveSceneJudgement,
} from "../../src/utils/scene-bench";
import {
  parseInstrumentIntent,
  confirmInstrumentIntent,
} from "../../src/utils/instrument-intent";
import {
  paragraphPassages,
  localParagraphReview,
  buildParagraphBatch,
} from "../../src/utils/living-desk/paragraphs";
import {
  LOCAL_WRITING_PACKS,
  pinnedLocalWritingUrl,
  cosineSimilarity,
} from "../../src/utils/local-writing-manifest";
import {
  buildEntityInstrumentIndex,
  buildEntityInstrumentRequest,
} from "../../src/utils/entity-instrument";

const args = process.argv.slice(2);
const value = (flag: string) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const filter = value("--case");
const benchmarkOnly = args.includes("--benchmark-only");
const out = resolve(
  value("--output") ??
    `artifacts/instrument-evals/${new Date().toISOString().replaceAll(":", "-")}`,
);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
  },
});
const para = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
const documentFor = (text: string, quote?: string) =>
  schema.nodes.doc.create(null, [
    para(text),
    ...(quote ? [schema.nodes.blockquote.create(null, para(quote))] : []),
  ]);
type CaseResult = {
  id: string;
  pass: boolean;
  ms: number;
  proof: "local-real" | "transport-contract";
  error?: string;
};
const results: CaseResult[] = [];
async function check(
  id: string,
  proof: CaseResult["proof"],
  run: () => unknown | Promise<unknown>,
) {
  if (benchmarkOnly || (filter && !id.includes(filter))) return;
  const start = performance.now();
  try {
    await run();
    results.push({ id, pass: true, ms: performance.now() - start, proof });
  } catch (error) {
    results.push({
      id,
      pass: false,
      ms: performance.now() - start,
      proof,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const fixture of deskCases)
  await check(fixture.id, "local-real", () => {
    const segments = segmentDocument(
      documentFor(
        fixture.text,
        "protected" in fixture ? fixture.protected : undefined,
      ),
    );
    const first = analyzeDesk(segments);
    assert.equal(
      JSON.stringify(first),
      JSON.stringify(analyzeDesk(segments)),
      "Repeated analysis differs",
    );
    for (const [id, count] of Object.entries(fixture.expected))
      assert.equal(
        first.findings.find((f) => f.id === id)?.count ?? 0,
        count,
        id,
      );
    for (const f of first.findings)
      for (const o of f.occurrences) {
        assert.equal(
          documentFor(
            fixture.text,
            "protected" in fixture ? fixture.protected : undefined,
          ).textBetween(o.from, o.to),
          o.text,
          "Finding points outside its exact text",
        );
      }
  });
for (const fixture of rewriteCases)
  await check(fixture.id, "local-real", () => {
    const candidates = localSentenceCandidates(fixture.text);
    if (fixture.expected === null) assert.equal(candidates.length, 0);
    else
      assert(
        candidates.some((c) => c.text === fixture.expected),
        "Expected complete rewrite is missing",
      );
    for (const c of candidates) {
      assert(completeSentence(c.text), "Fragment offered as a candidate");
      assert.equal(
        c.meaning,
        undefined,
        "A rule claimed unmeasured meaning confidence",
      );
      for (const token of fixture.preserve)
        assert(c.text.includes(token), `Lost protected token: ${token}`);
      const diff = sentenceWordDiff(fixture.text, c.text);
      assert.equal(
        diff
          .filter((t) => t.kind !== "added")
          .map((t) => t.text)
          .join(""),
        fixture.text,
      );
      assert.equal(
        diff
          .filter((t) => t.kind !== "removed")
          .map((t) => t.text)
          .join(""),
        c.text,
      );
    }
  });
await check("word-context-preservation", "local-real", () => {
  const text = "Mara said the bridge was important.";
  const from = text.indexOf("important"),
    to = from + 9;
  const alternatives = wordAlternatives(text, from, to);
  assert(alternatives.length > 0);
  for (const a of alternatives)
    assert.equal(
      a.sentence,
      text.slice(0, from) + a.replacement + text.slice(to),
    );
  assert.equal(
    wordAlternatives(text, from + 1, to).length,
    0,
    "Partial word accepted",
  );
});
await check("settled-history-and-cut-paste", "local-real", () => {
  const original = "The river carried the town's memory.";
  let ledger = reconcileSentenceLedger(
    emptySentenceLedger(),
    [{ text: original, from: 1, to: original.length + 1, blockFrom: 1 }],
    0,
  );
  assert.equal(
    settleSentenceWording(ledger.entries[0], 1200, 8, true).wordings.length,
    0,
  );
  ledger.entries[0] = settleSentenceWording(ledger.entries[0], 6000, 8, true);
  const id = ledger.entries[0].id;
  ledger = reconcileSentenceLedger(ledger, [], 7000);
  ledger = reconcileSentenceLedger(
    ledger,
    [{ text: original, from: 200, to: 200 + original.length, blockFrom: 200 }],
    8000,
  );
  assert.equal(ledger.entries[0].id, id);
  assert.equal(ledger.entries[0].wordings[0].text, original);
  assert.equal(ledger.entries[0].lineage, "move");
  const fragment = { ...ledger.entries[0], text: "The river carr." };
  assert.equal(
    settleSentenceWording(fragment, 20000, null, false).wordings.length,
    1,
    "Unchecked misspelling became a settled attempt",
  );
});
await check("grammar-rejects-new-errors", "transport-contract", async () => {
  const original = "Mara waited for the train.";
  const good = sentenceCandidate(
    original,
    "Mara waited beside the train.",
    "rule",
    "test",
  );
  const bad = sentenceCandidate(
    original,
    "Mara waitted for the train.",
    "rule",
    "test",
  );
  const checked = await checkSentenceCandidates(
    original,
    [good, bad],
    async (text) =>
      text.includes("waitted")
        ? [
            {
              id: "spelling",
              start: 5,
              end: 12,
              problem: "waitted",
              message: "Unknown word",
              kind: "Spelling",
              suggestions: ["waited"],
            },
          ]
        : [],
  );
  assert.deepEqual(
    checked.map((c) => c.text),
    [good.text],
  );
  assert.equal(checked[0].grammar, "checked");
});
const task: InstrumentTaskRequest = {
  requestId: "fixture-1",
  folioId: "fictional-folio",
  kind: "source-research",
  instruction: "What evidence supports the flood date?",
  selectedText: "The bridge flooded in 1927.",
  sources: [
    {
      sourceId: "fictional-archive",
      uri: "archive://flood-log",
      label: "Flood log",
    },
  ],
};
await check("research-exact-evidence", "transport-contract", async () => {
  const excerpt = "The flood log records the bridge closure on 12 May 1927.";
  const result = await executeInstrumentTask(task, {
    current: async () => true,
    read: async () => excerpt,
    now: () => 123,
    generate: async (input) => {
      assert.equal(input.idempotencyKey, "twyne-instrument:fixture-1");
      assert.deepEqual(JSON.parse(input.prompt).sources[0].excerpt, excerpt);
      return {
        text: "The log records a closure in May 1927 [1].",
        model: "fixture",
        provider: "test-transport",
      };
    },
  });
  assert.equal(result.citations[0].excerpt, excerpt);
  assert.equal(
    result.citations[0].fingerprint,
    instrumentTextFingerprint(excerpt),
  );
  assert.equal(result.citations[0].uri, task.sources[0].uri);
});
await check(
  "research-cancel-before-provider",
  "transport-contract",
  async () => {
    let calls = 0;
    await assert.rejects(
      executeInstrumentTask(task, {
        current: async () => false,
        read: async () => {
          calls++;
          return "source";
        },
        now: () => 123,
        generate: async () => {
          calls++;
          return { text: "answer", model: "fixture", provider: "test" };
        },
      }),
      InstrumentTaskCancelled,
    );
    assert.equal(calls, 0);
  },
);
await check(
  "research-late-cancel-discards-answer",
  "transport-contract",
  async () => {
    let current = true;
    await assert.rejects(
      executeInstrumentTask(task, {
        current: async () => current,
        read: async () => "Source text.",
        now: () => 123,
        generate: async () => {
          current = false;
          return { text: "answer", model: "fixture", provider: "test" };
        },
      }),
      InstrumentTaskCancelled,
    );
  },
);
await check(
  "research-empty-evidence-does-not-charge",
  "transport-contract",
  async () => {
    let calls = 0;
    await assert.rejects(
      executeInstrumentTask(task, {
        current: async () => true,
        read: async () => "  ",
        now: () => 123,
        generate: async () => {
          calls++;
          return { text: "answer", model: "fixture", provider: "test" };
        },
      }),
    );
    assert.equal(calls, 0);
  },
);
await check(
  "research-empty-result-is-not-success",
  "transport-contract",
  async () => {
    await assert.rejects(
      executeInstrumentTask(task, {
        current: async () => true,
        read: async () => "Source text.",
        now: () => 123,
        generate: async () => ({
          text: " ",
          model: "fixture",
          provider: "test",
        }),
      }),
    );
  },
);

await check("threads-only-real-spans-no-semantic-claim", "local-real", () => {
  const text =
    "Mara kept the copper key beside the ledger. This was the only key. Mara kept the copper key beside the ledger.";
  const index = buildSpanIndex([{ from: 0, text }]);
  const pairs = proposeThreadPairs(index);
  assert(pairs.some((p) => p.hypothesis === "exact-wording"));
  for (const span of index.spans)
    assert.equal(text.slice(span.from - 1, span.to - 1), span.text);
  for (const thread of ruleThreads(index, pairs)) {
    assert.equal(thread.source, "rule");
    assert.equal(thread.relation, undefined);
  }
  const distinct = buildSpanIndex([
    { from: 0, text: "Mara kept the key? Mara kept the key." },
  ]);
  assert(
    !proposeThreadPairs(distinct).some((p) => p.hypothesis === "exact-wording"),
  );
});
await check("scene-evidence-kept-separate-from-invention", "local-real", () => {
  const passage = {
    id: "scene-fixture",
    text: "🌒 Mara crossed the bridge at midnight. The river was silent.",
    sourceOffset: 32,
  };
  const inventory = createSceneInventory(passage);
  assert.equal(inventory.status, "ready");
  for (const span of inventory.spans)
    assert.equal(passage.text.slice(span.start, span.end), span.text);
  const brief = createSceneMediaBrief(inventory, "image", [
    {
      dimension: "light",
      text: "A red lantern on the railing.",
      origin: "writer",
    },
  ])!;
  assert(brief.includes(passage.text));
  assert(
    brief.indexOf("A red lantern") > brief.indexOf("Writer-proposed additions"),
  );
  assert(!passage.text.includes("lantern"));
  assert.deepEqual(
    resolveSceneJudgement(
      inventory,
      { ok: true, model: "fixture", answers: {} },
      { ...passage, text: "Changed." },
    ),
    { ok: false, reason: "stale" },
  );
});
await check(
  "paragraph-local-uncertainty-and-bounded-request",
  "local-real",
  () => {
    const doc = schema.nodes.doc.create(
      null,
      Array.from({ length: 40 }, () =>
        para("Mara was waiting. She was cold beside the bridge."),
      ),
    );
    const passages = paragraphPassages(segmentDocument(doc).blocks);
    const reading = localParagraphReview(passages[0], {});
    assert.equal(reading.scores.voice.value, null);
    assert.equal(reading.model, null);
    const batch = buildParagraphBatch(passages, {}, new Map());
    assert(batch);
    assert(Object.keys(batch.request.questions).length <= 60);
  },
);
await check(
  "instruction-quotes-and-invalid-constraints-stay-inspectable",
  "local-real",
  () => {
    const parsed = parseInstrumentIntent(
      'Keep "under 100 words" unchanged; by 2026-02-30 use 300-200 words.',
    );
    assert.equal(parsed.tokens.filter((t) => t.kind === "quote").length, 1);
    assert.equal(parsed.tokens.filter((t) => !t.valid).length, 2);
    for (const token of parsed.tokens)
      assert.equal(parsed.text.slice(token.from, token.to), token.text);
    assert.equal(
      confirmInstrumentIntent(
        parsed,
        "scope",
        [],
        `${parsed.text} changed`,
        "scope",
      ),
      null,
    );
  },
);
await check(
  "local-model-files-pinned-and-vector-errors-explicit",
  "local-real",
  () => {
    for (const pack of Object.values(LOCAL_WRITING_PACKS))
      for (const file of pack.files) {
        assert.equal(
          pinnedLocalWritingUrl(file.url.replace(pack.revision, "main")),
          file.url,
        );
        assert.equal(pinnedLocalWritingUrl(`${file.url}?private`), null);
      }
    assert.throws(() => cosineSimilarity([1], [1, 2]));
    assert.throws(() => cosineSimilarity([NaN], [1]));
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  },
);
await check("entity-source-index-and-bounded-model-scope", "local-real", () => {
  const doc = schema.nodes.doc.create(null, [
    para('Mara met Tom at the bridge. "Give me the key," Mara said.'),
    para('Tom handed Mara the key. "Keep it," Tom said.'),
  ]);
  const index = buildEntityInstrumentIndex(segmentDocument(doc));
  assert(index.candidates.length > 0);
  for (const evidence of index.evidence)
    assert.equal(doc.textBetween(evidence.from, evidence.to), evidence.text);
  const request = buildEntityInstrumentRequest(
    index,
    index.candidates[0].id,
    "relationship",
    "fixture",
  );
  assert(Object.keys(request.questions).length <= 60);
  for (const spec of request.specs)
    for (const id of spec.evidenceIds)
      assert(index.evidence.some((e) => e.id === id));
});

const quantile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
const benchmarks = [];
if (!filter && !args.includes("--no-benchmark"))
  for (const words of [500, 5000, 10000]) {
    const sentence =
      "I remember my home beside the river and the stories we told together.";
    const text = Array.from(
      { length: Math.ceil(words / sentence.split(/\s+/).length) },
      () => sentence,
    )
      .join(" ")
      .split(/\s+/)
      .slice(0, words);
    const paragraphs = Array.from(
      { length: Math.ceil(text.length / 80) },
      (_, i) => para(text.slice(i * 80, (i + 1) * 80).join(" ")),
    );
    const doc = schema.nodes.doc.create(null, paragraphs);
    const once = () => {
      const start = performance.now();
      const segments = segmentDocument(doc);
      const result = analyzeDesk(segments);
      buildScore(segments.plainText, result.findings, null);
      return performance.now() - start;
    };
    const firstPassMs = once();
    for (let i = 0; i < 6; i++) once();
    const samplesMs = Array.from({ length: 50 }, once);
    benchmarks.push({
      words,
      characters: doc.textContent.length,
      firstPassMs,
      warmups: 6,
      samplesMs,
      p50Ms: quantile(samplesMs, 0.5),
      p95Ms: quantile(samplesMs, 0.95),
      p99Ms: quantile(samplesMs, 0.99),
    });
  }
if (filter && results.length === 0)
  throw new Error(`No case matches ${filter}`);
const git = (a: string[]) => {
  try {
    return execFileSync("git", a, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
};
const corpusHash = sha(
  readFileSync(new URL("./corpus.ts", import.meta.url), "utf8"),
);
const threshold = Number(value("--max-p95-ms") ?? 250);
const flags = [
  ...results.filter((r) => !r.pass).map((r) => r.id),
  ...benchmarks
    .filter((b) => b.p95Ms > threshold)
    .map((b) => `latency-${b.words}-words`),
];
const report = {
  schemaVersion: 1,
  corpus: CORPUS_VERSION,
  corpusHash,
  at: new Date().toISOString(),
  revision: git(["rev-parse", "HEAD"]),
  dirty: !!git(["status", "--porcelain"]),
  runtime: {
    node: process.version,
    bun: process.versions.bun ?? null,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
  },
  scope:
    "Local rules, sentence candidates, ledger and fake transport contracts. No live model quality, Harper WASM, browser typing latency or deployed durability claim.",
  criteria: {
    maxP95Ms: threshold,
    failOnLatency: args.includes("--strict-performance"),
  },
  results,
  benchmarks,
  flags,
  missions: missions.map((m) => ({ ...m, status: "requires-separate-run" })),
  reproduction: `bun run eval:instruments${filter ? ` --case ${filter}` : ""}`,
};
mkdirSync(out, { recursive: true });
writeFileSync(
  resolve(out, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
writeFileSync(
  resolve(out, "report.md"),
  `# Writing instrument evaluation\n\n${results.filter((r) => r.pass).length}/${results.length} cases pass. Corpus: ${CORPUS_VERSION}.\n\n${report.scope}\n\n| Case | Result | Proof |\n| --- | --- | --- |\n${results.map((r) => `| ${r.id} | ${r.pass ? "PASS" : "FAIL"} | ${r.proof} |`).join("\n")}\n\n| Words | First pass ms | Warm p50 ms | Warm p95 ms | Warm p99 ms |\n| --- | ---: | ---: | ---: | ---: |\n${benchmarks.map((b) => `| ${b.words} | ${b.firstPassMs.toFixed(2)} | ${b.p50Ms.toFixed(2)} | ${b.p95Ms.toFixed(2)} | ${b.p99Ms.toFixed(2)} |`).join("\n")}\n\nFlags: ${flags.join(", ") || "none"}.\n\nRun: \`${report.reproduction}\`. Exact environment, corpus hash, samples and failure messages are in report.json.\n`,
);
console.log(
  `${results.filter((r) => r.pass).length}/${results.length} cases passed. Report: ${out}/report.json`,
);
for (const r of results.filter((r) => !r.pass))
  console.error(`${r.id}: ${r.error}`);
for (const b of benchmarks)
  console.log(
    `${b.words} words: p50 ${b.p50Ms.toFixed(2)} ms; p95 ${b.p95Ms.toFixed(2)} ms; first ${b.firstPassMs.toFixed(2)} ms`,
  );
if (
  results.some((r) => !r.pass) ||
  (args.includes("--strict-performance") &&
    benchmarks.some((b) => b.p95Ms > threshold))
)
  process.exitCode = 1;
