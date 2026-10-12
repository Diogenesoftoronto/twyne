// Source-only DOM/style observation on the fixture created by browser-reference.js.
const fs = require("node:fs");
const directory = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write";
await state.mathWritePage.waitForFunction(() => window.mathReferenceReady === true);
const original = await state.mathWritePage.evaluate(() => ({version:window.mathReferenceVersion,rows:window.mathReferenceRows,fontStatus:document.fonts.status}));
const properties = ["font-family","font-size","font-style","font-weight","line-height","display","vertical-align","height","width","margin-right","position","top"];
const rows = [];
for (const row of original.rows) {
  const root = state.mathWritePage.locator(`[data-math-case="${row.id}"]`);
  const record = {id:row.id,source:row.source,display:row.display,error:row.error,html:row.html};
  if (!row.error) {
    record.wrapper = await inspect({locator:root.locator(".twyne-math"),properties});
    record.katex = await inspect({locator:root.locator(".katex").first(),properties});
    record.base = await inspect({locator:root.locator(".katex-base").first(),properties});
    record.bases = [];
    for (const base of await root.locator(".katex-base").all()) record.bases.push(await inspect({locator:base,properties}));
    if (await root.locator(".katex-sizing").count()) record.sizing = await inspect({locator:root.locator(".katex-sizing").first(),properties});
    if (await root.locator(".katex-strut").count()) record.strut = await inspect({locator:root.locator(".katex-strut").first(),properties});
  }
  rows.push(record);
}
const diagnostic=state.mathWriteDiagnostic===true;
fs.writeFileSync(`${directory}/browser-${diagnostic?"engine-matched-diagnostic":"source"}.json`,JSON.stringify({provenance:diagnostic?"Explicit engine-matched CSS diagnostic on the owned module fixture; NOT current Twyne Write behavior":"Actual unmodified built KaTeX module and current published Twyne CSS on an owned localhost module fixture; no app storage or provider activity",url:state.mathWritePage.url(),build:state.mathWriteBuild,version:original.version,fontStatus:original.fontStatus,rows},null,2)+"\n");
console.log({version:original.version,cases:rows.length,fontStatus:original.fontStatus,firstSizing:rows.find(r=>r.sizing)?.sizing,firstStrut:rows.find(r=>r.strut)?.strut});
console.log(await getLatestLogs({page:state.mathWritePage,sinceLastCall:true}));
