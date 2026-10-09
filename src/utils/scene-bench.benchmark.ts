/** Local-only synthetic benchmark. No provider, editor, or private draft input. */
import {
  createSceneInventory,
  createSceneJudgementRequest,
  sceneSpanMatches,
} from "./scene-bench";

const budgetArgument = process.argv.find((arg) =>
  arg.startsWith("--budget-ms="),
);
const budgetMs = budgetArgument ? Number(budgetArgument.split("=")[1]) : null;
if (budgetMs !== null && (!Number.isFinite(budgetMs) || budgetMs <= 0))
  throw new Error("--budget-ms must be positive");

const longSentence =
  "At midnight, Mara crossed the quiet kitchen while the dim lamp over the doorway flickered, carrying the letter she needed to deliver before morning although the road beyond the river was blocked";
const fixtures = [
  {
    id: "short-scene",
    text: "At dusk, Mara crossed the kitchen. The lamp flickered. She heard footsteps outside. She needed the letter before morning.",
    sourceOffset: 0,
  },
  {
    id: "long-scene",
    text: Array.from(
      { length: 48 },
      (_, i) => `${longSentence}, and she counted another ${i + 1} steps. `,
    ).join(""),
    sourceOffset: 1400,
  },
];

const output = fixtures.map((fixture) => {
  const sanity = createSceneInventory(fixture);
  if (
    sanity.status !== "ready" ||
    !sanity.spans.every((span) => sceneSpanMatches(span, fixture))
  )
    throw new Error(`${fixture.id}: invalid benchmark fixture`);
  const run = () => {
    const inventory = createSceneInventory(fixture);
    createSceneJudgementRequest(inventory);
  };
  for (let i = 0; i < 30; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const percentile = (p: number) =>
    Number(
      samples[
        Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)
      ].toFixed(4),
    );
  const p95 = percentile(0.95);
  return {
    id: fixture.id,
    characters: fixture.text.length,
    sentences: sanity.spans.length,
    samples: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: p95,
    maxMs: Number(samples.at(-1)!.toFixed(4)),
    budgetMs,
    withinBudget: budgetMs === null ? null : p95 <= budgetMs,
  };
});
console.log(
  JSON.stringify(
    {
      benchmark: "scene-inventory-and-request-v1",
      runtime: {
        bun: process.versions.bun,
        platform: process.platform,
        arch: process.arch,
      },
      scope:
        "Pure inventory plus request construction; no editor, browser paint, model latency, or end-to-end typing measurement.",
      results: output,
    },
    null,
    2,
  ),
);
if (output.some((result) => result.withinBudget === false))
  process.exitCode = 1;
