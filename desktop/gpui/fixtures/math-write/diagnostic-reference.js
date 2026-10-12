const fs = require("node:fs");
const source = fs.readFileSync("/home/diogenes/Projects/twyne/node_modules/katex/dist/katex.css","utf8");
// Reuse current Source's byte-identical font faces; only this task-created tab
// receives the diagnostic rules. Source app/runtime/files remain unmodified.
state.mathWriteDiagnosticStyle = await state.mathWritePage.addStyleTag({content:source.replace(/@font-face\s*\{[^}]*\}/g,"")});
state.mathWriteDiagnostic = true;
console.log(await inspect({locator:state.mathWritePage.locator("[data-math-case=\"fraction\"] .katex-sizing").first(),properties:["font-family","font-size","line-height"]}));
console.log(await getLatestLogs({page:state.mathWritePage,sinceLastCall:true}));
