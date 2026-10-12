import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const own = import.meta.dir;
const root = path.resolve(own, "../../../../..");
const frozen = path.join(own, "../nodeview");
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const reference = JSON.parse(
  fs.readFileSync(path.join(frozen, "provenance.json"), "utf8"),
);
for (const [file, sha] of Object.entries(reference.sourceHashes)) {
  if (hash(fs.readFileSync(path.join(root, file))) !== sha)
    throw new Error(`Frozen Source changed: ${file}`);
}
const outdir = path.join(own, "build");
const result = await Bun.build({
  entrypoints: [path.join(own, "client.ts")],
  outdir,
  target: "browser",
  format: "esm",
  splitting: true,
  plugins: [
    {
      name: "exact-published-source-css-served-once",
      setup(build) {
        build.onLoad({ filter: /\.css$/ }, () => ({
          loader: "css",
          contents: "",
        }));
      },
    },
  ],
});
if (!result.success)
  throw new Error(result.logs.map((log) => log.toString()).join("\n"));
fs.writeFileSync(
  path.join(own, "browser-provenance.json"),
  JSON.stringify(
    {
      reference: "../nodeview/provenance.json",
      sourceHashes: reference.sourceHashes,
      stylesheetHash: reference.stylesheet.originalHash,
      bodyFontReplay: reference.bodyFontReplay,
      purpose:
        "Extra glyph-level CDP geometry and browser font metrics from actual unmodified Source NodeViews. Original stylesheet only; no proposed overlay.",
      bundleHashes: Object.fromEntries(
        result.outputs.map((file) => [
          path.basename(file.path),
          hash(fs.readFileSync(file.path)),
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
const mime = (file: string) =>
  file.endsWith(".css")
    ? "text/css"
    : file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".woff2")
        ? "font/woff2"
        : file.endsWith(".woff")
          ? "font/woff"
          : file.endsWith(".ttf")
            ? "font/ttf"
            : "application/octet-stream";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 5197,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/")
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current Source CSS glyph observations</title><link rel="stylesheet" href="/original-fonts.css"><link rel="stylesheet" href="/original.css"><style>body{margin:0}.fixture-root{max-width:1024px;padding:24px;margin:auto}.fixture-caption,.fixture-controls{font:14px/20px monospace;margin:0 0 12px}.fixture-case{padding:16px;margin:12px 0;border:1px solid #cbbb96}.fixture-case .ProseMirror{min-height:0}.fixture-controls{display:flex;gap:12px}.fixture-controls button{padding:6px 12px}</style></head><body><main class="fixture-root"><h1 class="fixture-caption">Actual Source glyph observations</h1><p class="fixture-caption">Current published Source CSS, exact NodeViews and local original fonts.</p><div class="fixture-controls"><button data-testid="fixture-undo">Fixture Undo</button><button data-testid="fixture-redo">Fixture Redo</button><span id="fixture-status">Loading actual NodeViews…</span></div><div id="cases"></div></main><script type="module" src="/build/client.js"></script></body></html>`,
        {
          headers: {
            "content-type": "text/html",
            "Content-Security-Policy":
              "default-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; img-src 'self' data:; media-src 'none'; frame-src 'none'",
          },
        },
      );
    if (url.pathname.includes(".."))
      return new Response("Not found", { status: 404 });
    let file: string | undefined;
    if (["/original.css", "/original-fonts.css"].includes(url.pathname))
      file = path.join(frozen, path.basename(url.pathname));
    else if (url.pathname.startsWith("/fonts/"))
      file = path.join(frozen, "fonts", path.basename(url.pathname));
    else if (url.pathname.startsWith("/assets/"))
      file = path.join(root, "dist/assets", path.basename(url.pathname));
    else if (url.pathname.startsWith("/build/"))
      file = path.join(outdir, path.basename(url.pathname));
    if (!file || !fs.existsSync(file))
      return new Response("Not found", { status: 404 });
    return new Response(Bun.file(file), {
      headers: { "content-type": mime(file) },
    });
  },
});
console.log(
  `Current CSS fixture ready http://127.0.0.1:${server.port}/?profile=original`,
);
