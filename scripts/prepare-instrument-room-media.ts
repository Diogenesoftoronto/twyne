import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";

const input = process.argv[2];
if (!input || process.argv.length !== 3)
  throw new Error(
    "Usage: bun scripts/prepare-instrument-room-media.ts <passing-playwright-results-directory>",
  );
const sourceRoot = resolve(input);
const run = JSON.parse(
  await readFile(join(sourceRoot, ".last-run.json"), "utf8"),
) as { status?: string };
if (run.status !== "passed")
  throw new Error("Prepare media only from a completed, passing browser run.");
const outputRoot = new URL("../public/assets/manual/", import.meta.url);
await mkdir(outputRoot, { recursive: true });
const files: string[] = [];
async function visit(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) files.push(path);
  }
}
await visit(sourceRoot);
const rows = [];
for (const [source, output] of [
  ["desktop-room-invitation.png", "instrument-room-invitation-v1.webp"],
  ["sentence-real-anchored-room-reply.png", "instrument-room-reply-v1.webp"],
]) {
  const matches = files.filter((path) => path.endsWith(`/${source}`));
  if (matches.length !== 1)
    throw new Error(`Expected exactly one ${source}; found ${matches.length}.`);
  const bytes = await readFile(matches[0]);
  const meta = await sharp(bytes).metadata();
  if (meta.width !== 1440 || meta.height !== 900)
    throw new Error(`${source} must be the actual 1440 × 900 app capture.`);
  const encoded = await sharp(bytes).webp({ lossless: true }).toBuffer();
  await writeFile(new URL(output, outputRoot), encoded);
  rows.push({
    source,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    output,
    outputSha256: createHash("sha256").update(encoded).digest("hex"),
    width: meta.width,
    height: meta.height,
    bytes: encoded.length,
  });
}
await writeFile(
  new URL("instrument-room-media.json", outputRoot),
  JSON.stringify(
    {
      provenance:
        "Actual app screenshots from e2e/instrument-room.e2e.ts. Fictional manuscript and explicitly simulated model transports; no live Jev quality or account proof.",
      processing: "Lossless WebP encoding only; no crop or UI alteration.",
      assets: rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Prepared ${rows.length} actual-app screenshots for the manual.`);
