const fs = require("node:fs");
const crypto = require("node:crypto");
const directory = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write/mermaid";
const profile = state.mermaidMathProfile || "original";
await state.mermaidMathPage.waitForFunction(() => window.mermaidMathReady || window.mermaidMathError, {timeout:20000});
const actual = await state.mermaidMathPage.evaluate(() => ({
  ready:window.mermaidMathReady, error:window.mermaidMathError,
  versions:window.mermaidMathVersions, rows:window.mermaidMathRows,
  editorRunSvg:window.mermaidEditorRunSvg, directHtml:window.mermaidDirectMathHtml,
  fontStatus:document.fonts.status,faces:window.mermaidMathFontFaces,fontLoads:window.mermaidMathFontLoads,
}));
if (!actual.ready || actual.error) throw new Error(actual.error || "Original renderer not ready.");
const cdp = await getCDPSession({page:state.mermaidMathPage});
await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
const {root} = await cdp.send("DOM.getDocument", {depth:0});
const properties = ["font-family","font-size","font-weight","font-style","line-height","display","width","height","position","overflow","vertical-align","top"];
async function observe(selector, fonts=false, index=0) {
  const locator = state.mermaidMathPage.locator(selector);
  if (await locator.count() <= index) return null;
  const {nodeIds} = await cdp.send("DOM.querySelectorAll", {nodeId:root.nodeId,selector});
  const nodeId = nodeIds[index];
  const {computedStyle} = await cdp.send("CSS.getComputedStyleForNode", {nodeId});
  const attributes = await cdp.send("DOM.getAttributes", {nodeId});
  let box = null; try { box = (await cdp.send("DOM.getBoxModel", {nodeId})).model; } catch {}
  let selectedFonts = null;
  if (fonts) selectedFonts = (await cdp.send("CSS.getPlatformFontsForNode", {nodeId})).fonts;
  return {
    selector,index,inspection:await inspect({locator:locator.nth(index),properties}),
    styles:Object.fromEntries(computedStyle.filter(({name})=>properties.includes(name)).map(({name,value})=>[name,value])),
    attributes:Object.fromEntries(Array.from({length:attributes.attributes.length/2},(_,i)=>[attributes.attributes[i*2],attributes.attributes[i*2+1]])),
    box, selectedFonts,
  };
}
const rows = [];
for (const row of actual.rows) {
  const selector = `[data-mermaid-case="${row.id}"]`;
  const record = {...row, svgSha256:crypto.createHash("sha256").update(row.svg).digest("hex")};
  const svgFile = `${profile}-${row.id}.svg`;
  fs.writeFileSync(`${directory}/${svgFile}`,row.svg);
  record.svgFile = svgFile;
  record.inlineSvg = await observe(`${selector} .source-inline svg`);
  record.image = await observe(`${selector} .source-image img`);
  record.foreignObjects = [];
  const foCount = await state.mermaidMathPage.locator(`${selector} .source-inline foreignObject`).count();
  for (let index=0;index<foCount;index++) {
    record.foreignObjects.push(await observe(`${selector} .source-inline foreignObject`,false,index));
  }
  // Keep returned SVG attributes alongside transformed screen-space boxes.
  record.foreignObjectAttributes = [...row.svg.matchAll(/<foreignObject\b([^>]*)>/g)].map(match=>match[1]);
  record.katex = await observe(`${selector} .source-inline .katex`);
  record.mathml = await observe(`${selector} .source-inline math`,true);
  record.html = await observe(`${selector} .source-inline .katex-html`);
  record.base = await observe(`${selector} .source-inline .base`);
  record.strut = await observe(`${selector} .source-inline .strut`);
  record.sizing = await observe(`${selector} .source-inline .sizing`);
  record.glyph = await observe(`${selector} .source-inline .mathnormal`,true);
  record.label = await observe(`${selector} .source-inline .label`,true);
  record.embeddedStyles = [...row.svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]);
  record.hasHtmlMath = row.svg.includes("katex-html");
  await state.mermaidMathPage.locator(selector).screenshot({path:`${directory}/${profile}-${row.id}.png`});
  rows.push(record);
}
const direct = {
  html:actual.directHtml,
  wrapper:await observe("#direct-math .twyne-math"),
  base:await observe("#direct-math .katex-base"),
  strut:await observe("#direct-math .katex-strut"),
  sizing:await observe("#direct-math .katex-sizing"),
};
fs.writeFileSync(`${directory}/${profile}-editor-run.svg`,actual.editorRunSvg);
const editorRun = {
  svgFile:`${profile}-editor-run.svg`,
  svgSha256:crypto.createHash("sha256").update(actual.editorRunSvg).digest("hex"),
  svg:await observe(".source-run svg"),
  katex:await observe(".source-run .katex"),
  mathml:await observe(".source-run math",true),
  hasHtmlMath:actual.editorRunSvg.includes("katex-html"),
};
const output = {
  provenance:"Actual published Source renderTwyneMermaid and initialize+run modules with original renderer/DOM; fixture-only whole stylesheet original/replacement/scoped variants. Exact supplied KaTeX faces are loaded before render to isolate CSS from Mermaid cold font measurement. Separate image consumes the same returned SVG. No Source/app metadata edits or external requests.",
  profile,url:state.mermaidMathPage.url(),originalAppUrl:state.page?.url(),
  versions:actual.versions,fontStatus:actual.fontStatus,faces:actual.faces,fontLoads:actual.fontLoads,
  blockedOrigins:[...new Set(state.mermaidMathBlocked || [])],rows,direct,editorRun,
};
fs.writeFileSync(`${directory}/browser-${profile}.json`,JSON.stringify(output,null,2)+"\n");
console.log({profile,versions:actual.versions,rows:rows.map(row=>({id:row.id,html:row.hasHtmlMath,svg:row.inlineSvg?.attributes?.viewBox,katex:row.katex?.styles,base:row.base?.styles?.display})),direct:{base:direct.base?.styles?.display,strut:direct.strut?.styles?.display,sizing:direct.sizing?.styles?.["font-size"]}});
console.log(await getLatestLogs({page:state.mermaidMathPage,sinceLastCall:true}));
