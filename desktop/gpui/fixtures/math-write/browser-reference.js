// Run with the task-owned Playwriter session. No application storage changes.
// Executes the actual Vite-served renderer and unmodified stylesheet; this is
// an isolated source-module fixture, not a substitute editor implementation.
const fs = require("node:fs");
const path = require("node:path");
const directory = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write";
const corpus = JSON.parse(fs.readFileSync(path.join(directory, "original-results.json"), "utf8"));
const repository = "/home/diogenes/Projects/twyne";
const manifest = JSON.parse(fs.readFileSync(path.join(repository, "dist/q-manifest.json"), "utf8"));
const katexChunk = Object.entries(manifest.bundles).find(([, row]) => row.origins?.some(origin => origin.includes("katex@0.18.1/")))?.[0];
const cssAsset = fs.readdirSync(path.join(repository, "dist/assets")).find(name => name.endsWith("-style.css"));
if (!katexChunk || !cssAsset) throw new Error("Current original build assets must be resolved explicitly.");
state.mathWriteBuild = {katexChunk, cssAsset};
if (!state.mathWritePage) {
  state.mathWritePage = await context.newPage();
  await state.mathWritePage.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return route.continue();
    return route.abort("blockedbyclient");
  });
}
await state.mathWritePage.unroute("http://localhost:5180/__native-math-write-reference");
await state.mathWritePage.route("http://localhost:5180/__native-math-write-reference", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Original Twyne math module reference</title><link rel="stylesheet" href="/assets/${cssAsset}"></head><body><h1>Original Twyne math module reference</h1><main id="math-reference"></main><script type="module">
      import katex from "/build/${katexChunk}";
      const corpus = ${JSON.stringify(corpus)};
      window.mathReferenceRows = [];
      for (const row of corpus) {
        // The saved HTML/error was produced by the exact original renderLatex
        // function. Confirm its HTML against the currently served build peer.
        const result = {html:row.html,error:row.error};
        if (!row.error && katex.renderToString(row.source.trim(), {displayMode:row.display==="block",output:"htmlAndMathml",strict:"error",throwOnError:true,trust:false}) !== row.html) throw new Error("Original build peer output differs: " + row.id);
        const section = document.createElement("section");
        section.dataset.mathCase = row.id;
        section.style.cssText = "margin:16px; font-size:18px; line-height:32.4px; width:600px";
        const label = document.createElement("p"); label.textContent = row.id; section.append(label);
        const equation = document.createElement(row.display === "block" ? "div" : "span");
        equation.className = "twyne-math twyne-math-" + row.display;
        const render = document.createElement("span"); render.className = "twyne-math-render";
        render.innerHTML = result.html; equation.append(render); section.append(equation);
        const marker = document.createElement("span"); marker.dataset.mathBaseline = "";
        marker.style.cssText = "display:inline-block; width:0; height:0; padding:0; margin:0";
        if(row.display === "inline") section.append(marker);
        document.querySelector("#math-reference").append(section);
        window.mathReferenceRows.push({...row, ...result});
      }
      await document.fonts.ready;
      window.mathReferenceVersion = katex.version;
      window.mathReferenceReady = true;
    </script></body></html>`,
}));
await state.mathWritePage.goto("http://localhost:5180/__native-math-write-reference", {waitUntil:"domcontentloaded"});
console.log("URL:", state.mathWritePage.url());
console.log(await getLatestLogs({page:state.mathWritePage,sinceLastCall:true}));
console.log(await snapshot({page:state.mathWritePage,search:/Original Twyne|fraction|ordinary/}));
