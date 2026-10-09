// Re-encode the preserved generated originals; no recoloring or alpha removal.
// Run from the repository with: rtk proxy bun public/assets/instruments/export-assets.mjs
import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const names = [
  "sentence-bench",
  "threads",
  "research",
  "scene",
  "press-grain",
  "proof-rule",
];
const entries = [];
for (const name of names) {
  const source = `${name}-source-v1.png`;
  const output = `${name}-v1.webp`;
  const metadata = await sharp(root + source).metadata();
  if (!metadata.hasAlpha) throw new Error(`${source} must retain alpha`);
  const width = name === "press-grain" ? 256 : 512;
  await sharp(root + source)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toFile(root + output);
  const exported = await sharp(root + output).metadata();
  const stats = await sharp(root + output).stats();
  const bytes = (await stat(root + output)).size;
  if (stats.isOpaque || !exported.hasAlpha) {
    throw new Error(`${output} lost transparency`);
  }
  if (bytes > 150_000)
    throw new Error(`${output} exceeds the 150KB asset budget`);
  entries.push({
    id: name,
    source,
    sourceSha256: createHash("sha256")
      .update(await readFile(root + source))
      .digest("hex"),
    output,
    width: exported.width,
    height: exported.height,
    bytes,
    hasAlpha: true,
    promptKey: name,
  });
}
const manifest = {
  version: 1,
  created: "2026-10-09",
  method: "OpenAI built-in image_gen tool",
  model: "Tool-managed; model ID not returned",
  direction: "Copperplate tools",
  selection:
    "Implementation choice after parent-agent visual review; not an explicit user selection",
  provenance:
    "Original generated illustrations; no external image sources. Reference was the generated direction study, then the generated sentence-bench illustration.",
  directionStudy: "direction-study-v1.png",
  prompts: "prompts.json",
  export: {
    command: "rtk proxy bun public/assets/instruments/export-assets.mjs",
    sharpVersion: sharp.versions.sharp,
    changes:
      "Resize and WebP encoding only. Preserve alpha and color; do not remove backgrounds or repaint.",
    maxAssetBytes: 150_000,
  },
  assets: entries,
};
await writeFile(
  root + "manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    entries.map(({ id, bytes, width, height, hasAlpha }) => ({
      id,
      bytes,
      width,
      height,
      hasAlpha,
    })),
    null,
    2,
  ),
);
