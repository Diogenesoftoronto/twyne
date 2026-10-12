/** Bounded arithmetic timing only. This is not a native/editor latency test. */
import {
  buildNaturalStack,
  paginate,
  computePageGeometry,
  type BlockMetric,
} from "../../../../src/components/editor/pagination-geometry";
import { DEFAULT_LAYOUT } from "../../../../src/types";

const geometry = computePageGeometry({ ...DEFAULT_LAYOUT, pagination: "paginated" });
const measurements = [1_000, 20_000].map((blocks) => {
  const metrics: BlockMetric[] = Array.from({ length: blocks }, (_, index) => ({
    pos: index * 12 + 1,
    height: 32.4,
    marginTop: index % 50 === 0 ? 36 : 0,
    marginBottom: 8.1,
    keepWithNext: index % 50 === 0,
  }));
  // Warm the same original implementation; retain exact count/break outputs.
  for (let iteration = 0; iteration < 3; iteration++) {
    paginate(metrics, geometry, { maxPages: 2_000 });
  }
  const samplesMs: number[] = [];
  let result = paginate(metrics, geometry, { maxPages: 2_000 });
  for (let iteration = 0; iteration < 20; iteration++) {
    const start = performance.now();
    buildNaturalStack(metrics);
    result = paginate(metrics, geometry, { maxPages: 2_000 });
    samplesMs.push(performance.now() - start);
  }
  return { blocks, iterations: samplesMs.length, samplesMs, pageCount: result.pageCount, breaks: result.breaks.length };
});

const target = new URL("./source-timing.json", import.meta.url);
await Bun.write(target, JSON.stringify({
  boundary: "Original pure TypeScript stack+paginate arithmetic over authored finite measurements. No native layout, DOM measurement, serialization, GPU or typing percentile is measured.",
  runtime: Bun.version,
  geometry,
  measurements,
}, null, 2) + "\n");
console.log(`Recorded original arithmetic only: ${measurements.map((measurement) => measurement.blocks).join(", ")} blocks, 20 samples each.`);
