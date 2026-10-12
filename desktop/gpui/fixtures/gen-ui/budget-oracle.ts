// Execute the unchanged shared Source request budget with explicit clocks.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { systemOneWait, spendSystemOne, backOffSystemOne, __resetSystemOneBudgetForTests } from "../../../../src/utils/system-one-budget";

type Step = { op: "wait" | "spend" | "fail" | "reset"; at: number; caller?: string };
const cases: { id: string; steps: Step[]; frames: number[] }[] = [];
function timeline(id: string, steps: Step[]) {
  __resetSystemOneBudgetForTests();
  const frames = steps.map(step => {
    if (step.op === "spend") spendSystemOne(step.at);
    if (step.op === "fail") backOffSystemOne(step.at);
    if (step.op === "reset") __resetSystemOneBudgetForTests();
    return systemOneWait(step.at);
  });
  cases.push({ id, steps, frames });
}
const spends = (start: number, count = 12): Step[] => Array.from({ length: count }, (_, i) => ({ op: "spend", at: start + i, caller: i % 2 ? "in-flow" : "quick-review" }));
timeline("shared-window-expiry", [...spends(1000), ...[1012, 60999, 61000, 61001, 61011].map(at => ({ op: "wait" as const, at }))]);
timeline("underfilled-window-never-blocks", [{ op: "spend", at: 1000 }, { op: "wait", at: 60999 }, { op: "wait", at: 61000 }]);
timeline("backoff-and-full-window", [...spends(1000), { op: "fail", at: 1100 }, { op: "wait", at: 31100 }, { op: "wait", at: 61000 }]);
timeline("backoff-overwrites-on-retreated-clock", [{ op: "fail", at: 10000 }, { op: "fail", at: 5000 }, { op: "wait", at: 34999.5 }, { op: "wait", at: 35000 }]);
timeline("insertion-order-after-clock-retreat", [{ op: "spend", at: 5000 }, { op: "spend", at: 1000 }, ...spends(1100, 10), { op: "wait", at: 1300 }, { op: "wait", at: 61000 }, { op: "wait", at: 65000 }]);
timeline("reset-shared-state", [...spends(1000), { op: "fail", at: 2000 }, { op: "reset", at: 2000 }, { op: "wait", at: 2001 }]);
timeline("negative-and-fractional-clocks", [{ op: "wait", at: -1 }, ...spends(0), { op: "wait", at: 59999.5 }, { op: "wait", at: 60000 }]);
let random = 0x54_57_59_4e;
const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
for (let i = 0; i < 8; i++) {
  let at = 100000;
  const steps: Step[] = [];
  for (let j = 0; j < 96; j++) {
    at += (next() % 30000) - 5000;
    const pick = next() % 20;
    steps.push({ op: pick < 12 ? "spend" : pick < 17 ? "wait" : pick < 19 ? "fail" : "reset", at });
  }
  timeline(`clock-sequence-${i}`, steps);
}
__resetSystemOneBudgetForTests();
const path = "src/utils/system-one-budget.ts";
const hashes = { [path]: createHash("sha256").update(readFileSync(path)).digest("hex") };
if (!process.argv[2]) throw new Error("Owned output path required");
await Bun.write(process.argv[2], JSON.stringify({ hashes, cases }, null, 2) + "\n");
console.log(JSON.stringify({ cases: cases.length, frames: cases.reduce((n, c) => n + c.frames.length, 0) }));
