// Run after an observed original Board/Page navigation. Read-only layout/font
// proof plus an unedited screenshot, confined to the owned localhost test tab.
const fs = require("node:fs");
const root = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/apparatus-view";
const dimensions = state.apparatusDimensions ?? {width:1280,height:860};
const surface = state.page.url().includes("/apparatus") ? "page" : "board";
const name = `apparatus-${surface}-${dimensions.width}`;
console.log(state.page.url()); console.log(await snapshot({page:state.page}));
const fonts = await state.page.evaluate(async()=>{await document.fonts.ready;return [...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight,style:f.style}));});
const props=["font-family","font-size","font-weight","font-style","line-height","letter-spacing","white-space","overflow-wrap","word-break","overflow","text-overflow","padding","margin","gap","border-radius","border-top-width","border-left-width","border-bottom-width","background-color","color","opacity","width","grid-template-columns"];
const selectors=surface==="board" ? [
  ".editorial-overlay--apparatus", ".board-panel", ".apparatus-signal-desk", ".apparatus-monitor-card__head",
  ".apparatus-signal-desk .dept-label", ".apparatus-monitor-card__summary", ".apparatus-monitor-card__query",
  ".board-panel .panel-meta:visible", ".desk-card", ".desk-card__head",
  ".desk-card__name", ".desk-card__aside", ".desk-card__body", ".desk-card__stamp",
  ".desk-card__quote", ".desk-card__foot", ".card-key",
] : ["main", "main > div", "h1", "h2", ".btn-paper", ".grid", ".grid > section", ".grid > section:nth-child(2)", ".style-toggle", ".style-toggle button", ".card", ".row", ".row p", ".row p:nth-child(2)", ".row p:nth-child(3)", ".agent-pill", ".cited-pill"];
const layout={};
for (const selector of selectors) {
  const locator=state.page.locator(selector); const count=await locator.count();
  if (count) layout[selector]=await inspect({locator:locator.first(),properties:props});
}
const cdp=await getCDPSession({page:state.page});
await cdp.send("DOM.enable");await cdp.send("CSS.enable");
const doc=await cdp.send("DOM.getDocument");const selected={};
for (const selector of surface==="board" ? [".desk-card__name",".desk-card__aside",".desk-card__body",".card-key"] : ["h1",".row p",".row p:nth-child(2)",".style-toggle button"]) {
  const node=await cdp.send("DOM.querySelector",{nodeId:doc.root.nodeId,selector});
  if (node.nodeId) selected[selector]=await cdp.send("CSS.getPlatformFontsForNode",{nodeId:node.nodeId});
}
fs.writeFileSync(`${root}/browser-${surface}-${dimensions.width}.json`,JSON.stringify({
  url:state.page.url(),scope:state.apparatusScope,dimensions,
  documentBytes:Buffer.byteLength(state.apparatusHtml),sourceFixture:"visual-native.json",fonts,selected,layout,
},null,2)+"\n");
await state.page.screenshot({path:`${root}/${name}.png`,scale:"css"});
await state.page.screenshot({path:`/tmp/twyne-reference-${name}.png`,scale:"css"});
console.log(`Captured ${name}; original fonts and app, no substitute renderer.`);
console.log(await getLatestLogs({page:state.page,sinceLastCall:true}));
