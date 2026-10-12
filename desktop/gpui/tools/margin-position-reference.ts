import { computeFallbackCardGeometry } from "../../../src/components/editor/popover-positioning";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve(
  import.meta.dir,
  "../../../src/components/editor/popover-positioning.ts",
);
const outputPath = resolve(
  import.meta.dir,
  "../fixtures/native_margin/position-reference.json",
);
const cases: Array<{
  name: string;
  input: Parameters<typeof computeFallbackCardGeometry>[0];
  expected: ReturnType<typeof computeFallbackCardGeometry>;
}> = [];
for (const [name, vw, vh, pageLeft, pageRight] of [
  ["desk", 1280, 860, 256, 1024],
  ["board", 1280, 860, 25, 793],
  ["wide", 1920, 1080, 576, 1344],
  ["right-page", 1920, 1080, 1000, 1768],
  ["narrow", 760, 520, 16, 744],
] as const) {
  for (const [position, top, bottom] of [
    ["beginning", 180, 201],
    ["middle", vh / 2 - 10, vh / 2 + 11],
    ["end", vh - 62, vh - 41],
    ["offscreen-before", 50, 72],
    ["offscreen-after", vh + 20, vh + 41],
  ] as const) {
    for (const keepOpen of [false, true]) {
      const input = {
        vw,
        vh,
        rect: { left: pageLeft + 36, top, bottom },
        page: { left: pageLeft, right: pageRight },
        viewport: { top: 160, bottom: vh - 33 },
        idealH: keepOpen ? 360 : 520,
        keepOpen,
      };
      cases.push({
        name: `${name}-${position}-${keepOpen ? "held" : "idle"}`,
        input,
        expected: computeFallbackCardGeometry(input),
      });
    }
  }
}
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(
  outputPath,
  JSON.stringify(
    {
      source: "src/components/editor/popover-positioning.ts",
      sourceSha256: createHash("sha256")
        .update(new Uint8Array(await Bun.file(sourcePath).arrayBuffer()))
        .digest("hex"),
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Recorded ${cases.length} actual source placement cases.`);
