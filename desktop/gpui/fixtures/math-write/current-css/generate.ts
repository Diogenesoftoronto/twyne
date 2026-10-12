import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import { renderMathWrite, provenance } from "../../../tools/math-write";
import { compareGlyphs } from "./compare";
const own = import.meta.dir;
const root = resolve(own, "../../../../.."),
  hash = (bytes: Uint8Array | string) =>
    createHash("sha256").update(bytes).digest("hex");
const observed = await Bun.file(`${own}/browser-glyphs.json`).json();
const outputs = [];
for (const row of observed.rows)
  outputs.push({
    id: row.id,
    ...(await renderMathWrite({
      source: row.source,
      display: row.display,
      fontSizePx: row.fontSizePx ?? 18,
      color: 0x302922,
      widthPx: 910,
      profile: "currentSourceCssDiagnostic",
    })),
  });
await Bun.write(`${own}/results.json`, JSON.stringify(outputs, null, 2) + "\n");
const comparisons = observed.rows.map((row: any, index: number) =>
  compareGlyphs(row, outputs[index]),
);
const runs = comparisons.flatMap((row) => row.glyphRuns);
const receipt = {
  purpose:
    "Current Source CSS natural inline-span/glyph diagnostic only. No wrapper, paragraph, display-line, native GPUI or raster parity.",
  provenance,
  browser: observed.browser,
  browserReceiptSha256: createHash("sha256")
    .update(await Bun.file(`${own}/browser-glyphs.json`).bytes())
    .digest("hex"),
  profiles: {
    accepted: outputs.filter((row) => row.vector).length,
    refused: outputs.filter((row) => !row.vector).length,
  },
  maximumErrorsPx: {
    x: Math.max(...runs.map((row) => Math.abs(row.xError))),
    baseline: Math.max(...runs.map((row) => Math.abs(row.baselineError))),
    advance: Math.max(...runs.map((row) => Math.abs(row.advanceError))),
  },
  comparisons,
};
await Bun.write(
  `${own}/comparison.json`,
  JSON.stringify(receipt, null, 2) + "\n",
);
const sourceFonts = `${root}/src/components/editor/math/fonts`;
const sourceCss = await Bun.file(`${own}/../nodeview/original.css`).text();
const assets = [
  ...new Set(
    [
      ...sourceCss.matchAll(/(?:\/assets\/)([^\s"')]+KaTeX_[^\s"')]+\.woff2)/g),
    ].map((match) => match[1]),
  ),
];
const embedded: { family: string; bytes: Uint8Array }[] = [];
postcss.parse(sourceCss).walkAtRules("font-face", (rule) => {
  let family = "",
    src = "";
  rule.walkDecls((declaration) => {
    if (declaration.prop === "font-family")
      family = declaration.value.replace(/["']/g, "");
    if (declaration.prop === "src") src = declaration.value;
  });
  const match = src.match(/url\(["']?data:font\/woff2;base64,([^"')]+)["']?\)/);
  if (family.startsWith("KaTeX_") && match)
    embedded.push({ family, bytes: Buffer.from(match[1], "base64") });
});
const fontProof = {
  sourceTtf: await Promise.all(
    (await readdir(sourceFonts))
      .filter((file) => file.endsWith(".ttf"))
      .sort()
      .map(async (file) => ({
        file: `src/components/editor/math/fonts/${file}`,
        sha256: hash(await Bun.file(`${sourceFonts}/${file}`).bytes()),
      })),
  ),
  publishedWoff2: await Promise.all(
    assets.sort().map(async (file) => {
      const name = file.slice(file.indexOf("KaTeX_"));
      const bytes = await Bun.file(`${root}/dist/assets/${file}`).bytes(),
        source = await Bun.file(`${sourceFonts}/${name}`).bytes(),
        engine = await Bun.file(
          `${root}/node_modules/katex/dist/fonts/${name}`,
        ).bytes();
      if (hash(bytes) !== hash(source) || hash(bytes) !== hash(engine))
        throw new Error(`Source published/font/engine byte mismatch: ${file}`);
      return {
        file: `dist/assets/${file}`,
        original: `src/components/editor/math/fonts/${name}`,
        sha256: hash(bytes),
        installedEngineSameBytes: true,
      };
    }),
  ),
  embeddedWoff2: await Promise.all(
    embedded.map(async (item) => {
      const name = `${item.family}-Regular.woff2`,
        source = await Bun.file(`${sourceFonts}/${name}`).bytes(),
        engine = await Bun.file(
          `${root}/node_modules/katex/dist/fonts/${name}`,
        ).bytes();
      if (
        hash(item.bytes) !== hash(source) ||
        hash(item.bytes) !== hash(engine)
      )
        throw new Error(`Embedded published font mismatch: ${name}`);
      return {
        family: item.family,
        original: `src/components/editor/math/fonts/${name}`,
        sha256: hash(item.bytes),
        bytes: item.bytes.length,
        installedEngineSameBytes: true,
      };
    }),
  ),
  stylesheetSha256: hash(sourceCss),
  vendorSha256: provenance.sourceCssSha256,
  parser: {
    name: "postcss",
    installedVersion: (await import("postcss/package.json")).version,
    dependency:
      "already installed transitive dependency; compiled helper embeds it",
  },
};
await Bun.write(
  `${own}/fonts-and-css.json`,
  JSON.stringify(fontProof, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      profiles: receipt.profiles,
      maximumErrorsPx: receipt.maximumErrorsPx,
      rows: comparisons.map((row) => ({
        id: row.id,
        widthError: row.widthError,
        ascentError: row.ascentError,
        descentError: row.descentError,
      })),
    },
    null,
    2,
  ),
);
