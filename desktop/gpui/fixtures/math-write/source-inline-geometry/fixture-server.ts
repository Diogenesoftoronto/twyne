import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import corpus from "./cases.json";

const root = path.resolve(import.meta.dir, "../../../../..");
const own = import.meta.dir;
const retained = path.join(root, "desktop/gpui/fixtures/math-write/nodeview");
const prefix = "/inline-geometry/";
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const read = (relative: string) => fs.readFileSync(path.join(root, relative));

function mime(file: string) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".ttf")) return "font/ttf";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

export async function prepareInlineGeometry() {
  // Parent execution only. Every generated bundle/receipt gets a new owned
  // directory; no retained fixture, Source or running server is overwritten.
  const verification = path.join(root, "desktop/gpui/target/verification");
  fs.mkdirSync(verification, { recursive: true });
  const generated = fs.mkdtempSync(path.join(verification, "source-inline-geometry-server-"));
  const outdir = path.join(generated, "build");
  const originalCssFile = path.join(retained, "original.css");
  const fontCssFile = path.join(retained, "original-fonts.css");
  const replayFile = path.join(retained, "font-replay.json");
  const originalCss = fs.readFileSync(originalCssFile);
  const fontCss = fs.readFileSync(fontCssFile);
  const replay = JSON.parse(fs.readFileSync(replayFile, "utf8"));
  if (digest(fontCss) !== replay.localCssSha256) {
    throw new Error("Retained original font replay CSS changed; re-review, do not fetch.");
  }
  const fontFiles = new Map<string, string>();
  for (const font of replay.files) {
    if (path.basename(font.file) !== font.file) throw new Error("Unsafe retained font name.");
    const file = path.join(retained, "fonts", font.file);
    if (digest(fs.readFileSync(file)) !== font.sha256) {
      throw new Error("Original captured font bytes changed: " + font.file);
    }
    fontFiles.set("/fonts/" + font.file, file);
  }
  const dist = path.join(root, "dist/assets");
  const publishedStyles = fs.readdirSync(dist).filter((name) => name.endsWith("-style.css"));
  const matching = publishedStyles.filter((name) =>
    digest(fs.readFileSync(path.join(dist, name))) === digest(originalCss));
  if (matching.length !== 1) {
    throw new Error("Retained Source CSS must match exactly one published original stylesheet.");
  }
  const sourceMathCss = read("src/components/editor/math/math.css").toString("utf8");
  if (!sourceMathCss.includes("min-width: min(22rem, 70vw)") ||
      !sourceMathCss.includes("align-items: baseline") ||
      !originalCss.toString("utf8").includes(".twyne-math-source-editor")) {
    throw new Error("Source inline contract changed; review the authored probe before execution.");
  }
  const build = await Bun.build({
    entrypoints: [path.join(own, "client.ts")],
    outdir,
    target: "browser",
    format: "esm",
    splitting: true,
    plugins: [{
      name: "serve-original-published-css-once",
      setup(api) {
        // The entire byte-exact original stylesheet is served below. Source
        // modules themselves, including the renderer, remain actual imports.
        api.onLoad({ filter: /\.css$/ }, () => ({ loader: "css", contents: "" }));
      },
    }],
  });
  if (!build.success) throw new Error(build.logs.map((log) => log.toString()).join("\n"));

  const pinned = [
    "src/root.tsx",
    "src/global.css",
    "src/components/editor/extensions/math.ts",
    "src/components/editor/math/math-source-editor.ts",
    "src/components/editor/math/math-renderer.ts",
    "src/components/editor/math/math.css",
    "src/components/editor/math/katex.min.css",
    "node_modules/@tiptap/core/package.json",
    "node_modules/@tiptap/starter-kit/package.json",
    "node_modules/katex/package.json",
    "desktop/gpui/target/verification/source-nodeview-server.ts",
    "desktop/gpui/fixtures/math-write/nodeview/original.css",
    "desktop/gpui/fixtures/math-write/nodeview/original-fonts.css",
    "desktop/gpui/fixtures/math-write/nodeview/font-replay.json",
    "desktop/gpui/fixtures/math-write/source-inline-geometry/cases.json",
    "desktop/gpui/fixtures/math-write/source-inline-geometry/client.ts",
    "desktop/gpui/fixtures/math-write/source-inline-geometry/fixture-server.ts",
  ];
  const provenance = {
    schemaVersion: 1,
    generated,
    scope: "Actual original math NodeView/source form inside a two-editor authored scaffold, not the product route.",
    originalCss: {
      retained: "desktop/gpui/fixtures/math-write/nodeview/original.css",
      published: "dist/assets/" + matching[0],
      sha256: digest(originalCss),
      candidateOverlay: false,
    },
    bodyFontReplay: replay,
    sourceHashes: Object.fromEntries(pinned.map((file) => [file, digest(read(file))])),
    bundleHashes: Object.fromEntries(build.outputs.map((file) =>
      [path.basename(file.path), digest(fs.readFileSync(file.path))])),
    versions: {
      tiptap: JSON.parse(read("node_modules/@tiptap/core/package.json").toString("utf8")).version,
      katex: JSON.parse(read("node_modules/katex/package.json").toString("utf8")).version,
    },
    fixtureOnly: [
      "Root rem basis 16px, 24px outer fixture padding, explicit measured paragraph width.",
      "Captions/navigation and min-height:0 replace the product editor minimum, outside math CSS.",
      "Zero-width baseline Decoration widgets only in the markers variant, with matched control.",
      "Explicit Editor.view.coordsAtPos/selection reporter and bounded frame heartbeat.",
    ],
    limits: [
      "No KaTeX stylesheet correction, engine diagnostic, SVG geometry substitution or native renderer.",
      "Captured Latin/Greek original fonts; CJK/emoji depend on the measured platform fallback.",
      "No app extension-stack, accounts, storage, providers, network fetch or route parity proof.",
    ],
  };
  fs.writeFileSync(path.join(generated, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
  const assets = new Map(fs.readdirSync(dist).map((name) =>
    ["/assets/" + name, path.join(dist, name)]));
  const bundles = new Map(build.outputs.map((file) =>
    [prefix + "build/" + path.basename(file.path), file.path]));
  const headers = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; img-src 'self' data:; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
  };

  return {
    prefix,
    generated,
    provenance,
    fetch(request: Request): Response | undefined {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Read-only fixture server", { status: 405 });
      }
      if (url.pathname === prefix) {
        const scenario = corpus.scenarios.find((row) => row.id === url.searchParams.get("scenario"));
        if (!scenario) return new Response("Unknown scenario", { status: 400 });
        const controlWidth = url.searchParams.get("controlWidth") ?? "flow";
        if (!["flow", "min-content", "max-content"].includes(controlWidth)) {
          return new Response("Unknown authored intrinsic control", { status: 400 });
        }
        const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Original Source inline geometry / ' + scenario.id + '</title>' +
          '<link rel="stylesheet" href="' + prefix + 'original-fonts.css">' +
          '<link rel="stylesheet" href="' + prefix + 'original.css">' +
          '<style>html{font-size:16px}body{margin:0}.fixture-root{padding:24px}' +
          '.fixture-caption,.fixture-navigation{font:14px/20px monospace;margin:0 0 12px}' +
          '.fixture-navigation{display:flex;flex-wrap:wrap;gap:8px}' +
          '.fixture-navigation button{padding:4px 8px}.fixture-slab{margin-bottom:40px}' +
          '.probe-prose-width{width:' + scenario.contentWidth + 'px;max-width:100%}' +
          '.probe-prose-width[data-probe-width-mode="min-content"]{width:min-content;max-width:none}' +
          '.probe-prose-width[data-probe-width-mode="max-content"]{width:max-content;max-width:none}' +
          '.fixture-slab .ProseMirror{min-height:0}' +
          '.probe-baseline-marker{display:inline-block;position:relative;width:0;height:0;' +
          'padding:0;margin:0;border:0;line-height:0;vertical-align:baseline;pointer-events:none}' +
          '.probe-baseline-marker::after{content:"";position:absolute;left:-2px;top:0;' +
          'width:4px;border-top:1px solid #ca1d89;pointer-events:none}' +
          '</style></head><body><main class="fixture-root">' +
          '<h1 class="fixture-caption">Original Source inline form geometry</h1>' +
          '<p class="fixture-caption">Authored scaffold; actual Source modules, CSS and original captured fonts.</p>' +
          '<p class="fixture-caption" id="inline-geometry-status">Loading actual Source…</p>' +
          '<div id="inline-geometry-cases"></div>' +
          '<output hidden id="inline-geometry-report" data-frame="0"></output>' +
          '</main><script type="module" src="' + prefix + 'build/client.js"></script></body></html>';
        return new Response(request.method === "HEAD" ? null : html, {
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === prefix + "provenance.json" ||
          url.pathname === prefix + "cases.json") {
        const value = url.pathname.endsWith("cases.json") ? corpus : provenance;
        return new Response(request.method === "HEAD" ? null : JSON.stringify(value, null, 2) + "\n", {
          headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
        });
      }
      const file = url.pathname === prefix + "original.css" ? originalCssFile
        : url.pathname === prefix + "original-fonts.css" ? fontCssFile
        : bundles.get(url.pathname) ?? fontFiles.get(url.pathname) ?? assets.get(url.pathname);
      if (!file) return undefined;
      if (!fs.existsSync(file)) return new Response("Missing retained asset", { status: 404 });
      return new Response(request.method === "HEAD" ? null : Bun.file(file), {
        headers: { ...headers, "Content-Type": mime(file) },
      });
    },
  };
}
