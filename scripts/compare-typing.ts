import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { distribution, type TypingSamples } from "../e2e/helpers/typing-report";

const [beforePath, afterPath, output = "test-results/typing-comparison"] =
  process.argv.slice(2);
if (!beforePath || !afterPath)
  throw new Error(
    "Usage: bun scripts/compare-typing.ts BEFORE.json AFTER.json [output-directory]",
  );
const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));
for (const key of [
  "paragraphs",
  "cpuThrottle",
  "repeats",
  "browser",
  "build",
  "platform",
  "architecture",
  "cpu",
]) {
  if (before.metadata[key] !== after.metadata[key])
    throw new Error(`Cannot compare mismatched ${key}`);
}
const metrics = [
  { name: "Input to next frame", field: "frame" },
  { name: "Editor transaction", field: "dispatch" },
  { name: "Background long tasks", field: "longTasks" },
] as const;
const bars = metrics.flatMap(({ name, field }) => {
  const first = distribution((before.samples as TypingSamples)[field]);
  const last = distribution((after.samples as TypingSamples)[field]);
  return ["p95", "p99", "max"].map((percentile) => ({
    metric: name,
    percentile,
    before: first[percentile as "p95" | "p99" | "max"],
    after: last[percentile as "p95" | "p99" | "max"],
  }));
});
const ceiling = Math.max(50, ...bars.flatMap((b) => [b.before, b.after]));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800" viewBox="0 0 1000 800"><rect width="1000" height="800" fill="#f6f2e9"/><g font-family="sans-serif" fill="#29251f"><text x="24" y="35" font-size="24">Typing latency · before and after</text><text x="24" y="62">${after.metadata.paragraphs} annotated paragraphs · 4× CPU · ${after.samples.frame.length} keystrokes · lower is better</text><rect x="24" y="82" width="16" height="16" fill="#9d9285"/><text x="48" y="96">Before</text><rect x="140" y="82" width="16" height="16" fill="#b4412d"/><text x="164" y="96">After</text>${bars
  .map((b, i) => {
    const y = 130 + i * 70;
    return `<text x="24" y="${y + 16}" font-size="14">${b.metric} ${b.percentile}</text>${[
      b.before,
      b.after,
    ]
      .map((n, j) => {
        const w = (n / ceiling) * 580;
        return `<rect x="260" y="${y + j * 24}" width="${w}" height="18" fill="${j ? "#b4412d" : "#9d9285"}"/><text x="${270 + w}" y="${y + j * 24 + 14}" font-size="13">${n.toFixed(1)} ms</text>`;
      })
      .join("")}`;
  })
  .join("")}</g></svg>`;
await mkdir(output, { recursive: true });
await writeFile(join(output, "comparison.svg"), svg);
await writeFile(
  join(output, "comparison.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Typing comparison</title><style>body{margin:24px;background:#f6f2e9;color:#29251f;font:16px system-ui}svg{width:100%;max-width:1000px;height:auto}p{max-width:1000px;line-height:1.5}</style>${svg}<p>Input-to-frame ends at the next animation-frame callback, before paint. Long tasks cover background work as well as typing. Samples use sequential native Playwright keyboard input. Both runs use matching machine, browser and development-build metadata. Absolute values are not physical-device or production-build measurements.</p></html>`,
);
await writeFile(
  join(output, "comparison.json"),
  JSON.stringify(
    { before: before.metadata, after: after.metadata, bars },
    null,
    2,
  ),
);
console.log(join(output, "comparison.html"));
