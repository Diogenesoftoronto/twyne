// Replay already-captured original Source web fonts. This script performs no network requests.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import postcss from "postcss";

const own = import.meta.dir;
const cached = "/tmp/twyne-original-web-fonts";
const root = path.resolve(own, "../../../../..");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const captured: Array<{ url: string; path: string; status: number }> = JSON.parse(
  fs.readFileSync(path.join(cached, "assets.json"), "utf8"),
);
const cssReceipt = captured.find((row) => row.url.startsWith("https://fonts.googleapis.com/"));
if (!cssReceipt || cssReceipt.status !== 200) throw new Error("Original cached Source font CSS unavailable.");
const sourceCss = fs.readFileSync(cssReceipt.path, "utf8");
const fontDir = path.join(own, "fonts");
fs.mkdirSync(fontDir, { recursive: true });
const faces = new Map<string, string>();
const files = [];
for (const row of captured.filter((row) => row.url.startsWith("https://fonts.gstatic.com/"))) {
  if (row.status !== 200 || !fs.existsSync(row.path)) throw new Error("Captured Source font bytes unavailable.");
  const file = path.basename(new URL(row.url).pathname);
  const bytes = fs.readFileSync(row.path);
  fs.writeFileSync(path.join(fontDir, file), bytes);
  faces.set(row.url, `/fonts/${file}`);
  files.push({ originalUrl: row.url, file, sha256: hash(bytes), bytes: bytes.length });
}
const replay = postcss.parse(sourceCss);
let keptFaces = 0;
replay.walkComments((comment) => comment.remove());
for (const node of [...replay.nodes]) {
  if (node.type !== "atrule" || node.name !== "font-face") throw new Error("Unaudited Source font CSS node.");
  const src = node.nodes?.find((child) => child.type === "decl" && child.prop === "src");
  if (!src || src.type !== "decl") throw new Error("Missing Source font URL.");
  const url = /url\(([^)]+)\)/.exec(src.value)?.[1];
  const local = url && faces.get(url);
  if (!local) { node.remove(); continue; }
  src.value = src.value.replace(url!, local);
  keptFaces++;
}
for (const [family, sourceFile] of [
  ["Lora", "lora-OFL.txt"],
  ["DM-Sans", "dmsans-OFL.txt"],
  ["Libre-Baskerville", "librebaskerville-OFL.txt"],
  ["Special-Elite", "specialelite-LICENSE.txt"],
]) {
  fs.copyFileSync(path.join(root, "src/assets/typst", sourceFile!), path.join(fontDir, `${family}-LICENSE.txt`));
}
fs.writeFileSync(path.join(own, "captured-google-fonts.css"), sourceCss);
const localCss = replay.toString();
fs.writeFileSync(path.join(own, "original-fonts.css"), localCss);
fs.writeFileSync(path.join(own, "font-replay.json"), JSON.stringify({
  provenance: "Byte-exact prior authorized Source Chrome font responses; reused locally, no network calls. Source root.tsx Google CSS retained. Only previously captured faces needed by this ASCII/Café/math fixture are replayed; unused unavailable ranges/families are omitted.",
  originalCssUrl: cssReceipt.url,
  originalCssSha256: hash(sourceCss), localCssSha256: hash(localCss), keptFaces, files,
}, null, 2) + "\n");
console.log({ sourceResponses: files.length, retainedDeclarations: keptFaces, externalRequests: 0 });
