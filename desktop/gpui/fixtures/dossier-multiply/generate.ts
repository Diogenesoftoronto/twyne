// Source-derived scalar vectors for Parent GPU tests; no native/browser claim.
import { resolve } from "node:path";
import { cssMultiply, fixedMultiply, groupAt, groupSvg, premultiply, rgb, sourceContract } from "./kernel";
import { sourceContract as paperSource } from "../dossier-paper/reference";

const source = await sourceContract();
const paper = await paperSource();
const hex = (value: string) => {
  if (!/^#[\da-f]{6}$/i.test(value)) throw new Error(`Unsupported Source color: ${value}`);
  return Number.parseInt(value.slice(1), 16);
};
const presets = Object.entries(paper.presets).map(([id, palette]) => ({
  id, foxing: palette["--foxing-base"] === "transparent" ? 0 : hex(palette["--foxing-base"]!),
  alpha: palette["--foxing-base"] === "transparent" ? 0 : 1, paper: hex(palette["--color-paper"]!),
}));
const vectors = [];
for (const preset of presets) for (const geometry of [{ width: 1280, height: 860 }, { width: 620, height: 860 }, { width: 4, height: 4 }]) {
  const positions = [...source.spots.map(spot => ({ x: spot.x * geometry.width, y: spot.y * geometry.height })), { x: 0, y: 0 }, { x: 2, y: 2 }];
  for (const point of positions) for (const backdrop of [rgb(preset.paper), [0, 0, 0], [.03, .37, .92]] as [number, number, number][]) {
    const group = groupAt(source.spots, rgb(preset.foxing), preset.alpha, geometry.width, geometry.height, point.x, point.y);
    const destination = premultiply(backdrop, 1);
    vectors.push({ preset: preset.id, ...geometry, ...point, group, destination,
      originalEquation: cssMultiply(group, destination, source.opacity),
      proposedFixedBlend: fixedMultiply(group, destination, source.opacity) });
  }
  const name = `${preset.id}-${geometry.width}-group.svg`;
  await Bun.write(resolve(import.meta.dir, name), groupSvg(source.spots, preset.foxing, preset.alpha, geometry.width, geometry.height));
}
await Bun.write(resolve(import.meta.dir, "source-vectors.json"), JSON.stringify({
  status: "Source-extracted-scalar-and-SVG-geometry-only",
  source, presets, vectors,
  limits: ["No Chromium/resvg/GPUI raster equivalence", "No native GPU run", "1:1 integral device grid only", "Opaque backdrop required"],
}, null, 2) + "\n");
console.log(`Wrote ${vectors.length} original-equation/fixed-blend scalar pairs and 12 group SVGs`);
