import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { root, sourceContract } from "./reference";

const folder = import.meta.dir;
const output = resolve(folder, "raster");
await mkdir(output, { recursive: true });
const version = Bun.spawn(["rtk", "proxy", "magick", "-version"], {
  stdout: "pipe",
  stderr: "pipe",
});
const versionText = await new Response(version.stdout).text();
if (await version.exited)
  throw new Error("Installed standalone SVG rasterizer unavailable");
const hash = async (path: string) =>
  createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
const source = await sourceContract();
const rows = [];
for (const width of [1280, 620]) {
  for (const preset of Object.keys(source.presets)) {
    const svg = resolve(folder, `${preset}-${width}.svg`);
    const png = resolve(output, `${preset}-${width}.png`);
    const child = Bun.spawn(
      [
        "rtk",
        "proxy",
        "magick",
        svg,
        "-colorspace",
        "sRGB",
        "-strip",
        "PNG32:" + png,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exit, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    if (exit || stderr)
      throw new Error(
        `Standalone raster failed: ${preset}/${width}: ${stderr}`,
      );
    const dimensions = Bun.spawn(
      ["rtk", "proxy", "magick", "identify", "-format", "%w %h", png],
      { stdout: "pipe", stderr: "pipe" },
    );
    const size = await new Response(dimensions.stdout).text();
    if ((await dimensions.exited) || size !== `${width} 860`)
      throw new Error("Unexpected diagnostic raster dimensions");
    rows.push({
      preset,
      width,
      height: 860,
      svgSha256: await hash(svg),
      png: `raster/${preset}-${width}.png`,
      pngSha256: await hash(png),
    });
  }
}
const evidence = [];
for (const [kind, path] of [
  [
    "original Source app baseline supplied by Parent",
    "/tmp/twyne-gpui-dossier-current-web.png",
  ],
  [
    "preparation-before native app baseline supplied by Parent",
    "/tmp/twyne-dossier-styled-capture-20261005-ejfqyltz/frame.png",
  ],
  [
    "restored original Source app baseline supplied by Parent",
    resolve(root, "desktop/gpui/target/verification/source-dossier-1280.png"),
  ],
  [
    "restored original Source DOM box receipt supplied by Parent",
    resolve(root, "desktop/gpui/target/verification/source-dossier-boxes.json"),
  ],
]) {
  if (await Bun.file(path!).exists())
    evidence.push({ kind, path, sha256: await hash(path!) });
}
await Bun.write(
  resolve(output, "receipt.json"),
  JSON.stringify(
    {
      schema: 1,
      renderer: versionText.trim(),
      sourceRules: source.rules.map(({ selector, sha256 }) => ({
        selector,
        sha256,
      })),
      root,
      cases: rows,
      suppliedEvidence: evidence,
      includes: "CSS-derived seven background gradient geometry only",
      excludes:
        "Source inset-shadow blur; foxing multiply over descendants; GPUI paint; browser raster comparison",
      proof:
        "Standalone Librsvg projection/snapshot receipt, not Source or native pixel parity",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    rasters: rows.length,
    svgRenderer: "installed ImageMagick/Librsvg",
    proof: "diagnostic only",
  }),
);
