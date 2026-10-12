// Verification only: the desktop compiler does not invoke Bun or WASM.
// Run: bun desktop/gpui/fixtures/typst/compile-web-reference.ts
import { createTypstCompiler } from "@myriaddreamin/typst.ts/compiler";
import { loadFonts } from "@myriaddreamin/typst.ts/options.init";
import sharp from "sharp";

const fixture = new URL("web-editorial.typ", import.meta.url);
const worker = await Bun.file(
  new URL("../../../../src/utils/typst/compiler.worker.ts", import.meta.url),
).text();
const fontImports = new Map(
  [
    ...worker.matchAll(
      /import (\w+) from "\.\.\/\.\.\/assets\/typst\/([^"?]+)\?url";/g,
    ),
  ].map((match) => [match[1], match[2]]),
);
const fontOrder = worker
  .match(/loadFonts\(\s*\[([\s\S]*?)\]/)?.[1]
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
if (!fontOrder || fontOrder.length !== 21)
  throw new Error(
    "Web worker font list changed; review the native book and this fixture.",
  );
const fonts = await Promise.all(
  fontOrder.map(async (name) => {
    const file = fontImports.get(name);
    if (!file) throw new Error(`Unknown web worker font ${name}`);
    return Bun.file(
      new URL(`../../../../src/assets/typst/${file}`, import.meta.url),
    ).bytes();
  }),
);
const compiler = createTypstCompiler();
await compiler.init({
  getModule: () =>
    Bun.file(
      new URL(
        "../../../../node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm",
        import.meta.url,
      ),
    ).bytes(),
  beforeBuild: [loadFonts(fonts, { assets: false })],
});
const provenance: { assets: { path: string; url: string }[] } = await Bun.file(
  new URL("web-editorial.provenance.json", import.meta.url),
).json();
for (const asset of provenance.assets) {
  const original = await Bun.file(
    new URL(`../../../../public${asset.url}`, import.meta.url),
  ).bytes();
  compiler.mapShadow(asset.path, await sharp(original).png().toBuffer());
}
compiler.mapShadow(
  "/assets/griffin-mark.svg",
  await Bun.file(
    new URL("../../../../public/assets/griffin-mark.svg", import.meta.url),
  ).bytes(),
);
compiler.addSource("/main.typ", await Bun.file(fixture).text());
const compiled = await compiler.runWithWorld(
  { mainFilePath: "/main.typ", inputs: {} },
  (world) => world.pdf({ diagnostics: "full" }),
);
if (
  !compiled.result ||
  compiled.diagnostics?.some((diagnostic) => diagnostic.severity === "error")
)
  throw new Error(JSON.stringify(compiled.diagnostics));
const directory =
  process.env.TWYNE_TYPST_PROOF_OUTPUT_DIR ?? "/tmp/twyne-native-proof";
const output = `${directory}/engine-web-reference.pdf`;
await Bun.write(output, compiled.result);
console.log(
  JSON.stringify({
    output,
    bytes: compiled.result.length,
    diagnostics: compiled.diagnostics ?? [],
  }),
);
