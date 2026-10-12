// Run with Playwriter session 4. This creates only a separate task-owned page.
// All renderer imports/fonts/CSS are actual already-served localhost assets.
const fs = require("node:fs");
const directory = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write/mermaid";
const provenance = JSON.parse(fs.readFileSync(`${directory}/provenance.json`, "utf8"));
const corpus = JSON.parse(fs.readFileSync(`${directory}/corpus.json`, "utf8"));
const profile = state.mermaidMathProfile || "original";
if (!["original", "replacement", "scoped"].includes(profile)) throw new Error("Unknown fixture CSS profile.");
if (!state.mermaidMathPage) {
  state.mermaidMathPage = await context.newPage();
  state.mermaidMathBlocked = [];
  await state.mermaidMathPage.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
    state.mermaidMathBlocked.push(url.origin);
    return route.abort("blockedbyclient");
  });
}
const fixtureUrl = `http://localhost:5180/__native-mermaid-math/${profile}`;
const cssUrl = `http://localhost:5180/__native-mermaid-math/${profile}.css`;
await state.mermaidMathPage.unroute(fixtureUrl);
await state.mermaidMathPage.unroute(cssUrl);
await state.mermaidMathPage.route(cssUrl, (route) => route.fulfill({
  status: 200, contentType: "text/css", body: fs.readFileSync(`${directory}/${profile}.css`, "utf8"),
}));
await state.mermaidMathPage.route(fixtureUrl, (route) => route.fulfill({
  status: 200, contentType: "text/html",
  body: `<!doctype html><html><head><meta charset="utf-8"><title>Actual Source Mermaid / ${profile} CSS</title>
    <link rel="stylesheet" href="${cssUrl}">
    <style>body{margin:0;background:#f4ecd8;color:#1f1b16}.fixture-root{padding:24px;max-width:1240px;margin:auto}.fixture-case{margin:24px 0;padding:16px;border:1px solid #cbbb96}.fixture-label{font:16px/24px monospace;margin:0 0 12px}.fixture-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.fixture-pane{min-width:0;overflow:auto;padding:8px;border:1px dashed #cbbb96}.fixture-pane svg,.fixture-pane img{width:100%;height:auto;max-width:none}.fixture-caption{font:12px/18px monospace}.fixture-direct{font-size:18px;line-height:32.4px;margin-top:24px}</style>
    </head><body><main class="fixture-root"><h1>Actual Source Mermaid / ${profile} CSS</h1>
    <p>Left: original inline SVG. Right: same returned SVG in an isolated image. No external requests or app storage.</p><div id="mermaid-cases"></div><section id="direct-math" class="fixture-direct"></section></main>
    <script type="module">
    import {r as renderTwyneMermaid, t as initializeTwyneMermaid} from "/build/${provenance.build.theme}";
    import {n as mermaid} from "/build/${provenance.build.core}";
    import math from "/build/${provenance.build.math}";
    import mermaidMath from "/build/${provenance.build.mermaidMath}";
    const corpus = ${JSON.stringify(corpus)};
    window.mermaidMathRows = [];
    window.mermaidMathVersions = {directKatex:math.version,mermaidKatex:mermaidMath.version,mathMLSupported:window.MathMLElement!==undefined};
    try {
      // Mermaid measures labels synchronously while rendering. Stabilize only
      // the already supplied exact KaTeX faces to isolate stylesheet effects;
      // first-load observations are retained separately, not silently erased.
      window.mermaidMathFontLoads = await Promise.all(Array.from(document.fonts).filter(face=>face.family.startsWith("KaTeX_")).map(async face=>{
        try { await face.load();return {family:face.family,style:face.style,weight:face.weight,loaded:true}; }
        catch(error) { return {family:face.family,style:face.style,weight:face.weight,loaded:false,error:String(error)}; }
      }));
      await document.fonts.ready;
      window.mermaidMathFontFaces = Array.from(document.fonts).filter(face=>face.family.startsWith("KaTeX_")).map(face=>({family:face.family,style:face.style,weight:face.weight,status:face.status}));
      for (const row of corpus) {
        const section = document.createElement("section");
        section.className = "fixture-case"; section.dataset.mermaidCase = row.id;
        const title = document.createElement("h2"); title.className = "fixture-label"; title.textContent = row.id + " / " + row.branch; section.append(title);
        const pair = document.createElement("div"); pair.className = "fixture-pair"; section.append(pair);
        const inline = document.createElement("div"); inline.className = "fixture-pane source-inline";
        const image = document.createElement("div"); image.className = "fixture-pane source-image";
        pair.append(inline,image); document.querySelector("#mermaid-cases").append(section);
        const svg = await renderTwyneMermaid("mermaid-fixture-" + row.id, row.source);
        const node = document.createElement("div"); node.className = "mermaid twyne-mermaid-diagram"; node.innerHTML = svg; inline.append(node);
        const img = document.createElement("img"); img.alt = row.id + " isolated SVG image"; img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); image.append(img);
        const decoded = img.decode().then(()=>true,()=>false); await decoded;
        window.mermaidMathRows.push({...row, svg, imageDecoded:img.complete && img.naturalWidth>0});
      }
      // Exercise the actual editor's initialize()+run() path independently of
      // the original renderTwyneMermaid helper used above.
      const runCase = document.createElement("section"); runCase.className = "fixture-case"; runCase.dataset.mermaidCase = "editor-run-default";
      const runTitle = document.createElement("h2"); runTitle.className = "fixture-label"; runTitle.textContent = "Actual editor initialize + run default path"; runCase.append(runTitle);
      const runNode = document.createElement("div"); runNode.className = "mermaid twyne-mermaid-diagram source-run"; runNode.textContent = corpus[0].source; runCase.append(runNode); document.querySelector("#mermaid-cases").append(runCase);
      await initializeTwyneMermaid(); await mermaid.run({nodes:[runNode]});
      window.mermaidEditorRunSvg = runNode.innerHTML;
      const direct = document.createElement("span"); direct.className = "twyne-math twyne-math-inline";
      const render = document.createElement("span"); render.className = "twyne-math-render";
      render.innerHTML = math.renderToString(String.raw\`\\frac{1}{1+x^2}\`,{displayMode:false,output:"htmlAndMathml",strict:"error",throwOnError:true,trust:false});
      direct.append(render); document.querySelector("#direct-math").append(direct);
      window.mermaidDirectMathHtml = render.innerHTML;
      await document.fonts.ready;
      window.mermaidMathReady = true;
    } catch(error) { window.mermaidMathError = String(error?.stack || error); console.error(error); }
    </script></body></html>`,
}));
await state.mermaidMathPage.setViewportSize({width:1280,height:860});
await state.mermaidMathPage.goto(fixtureUrl, {waitUntil:"domcontentloaded"});
console.log(await getLatestLogs({page:state.mermaidMathPage,sinceLastCall:true}));
console.log(await snapshot({page:state.mermaidMathPage,search:/Actual Source|flow-|sequence-|editor initialize/}));
console.log({profile,originalAppUrl:state.page?.url()});
