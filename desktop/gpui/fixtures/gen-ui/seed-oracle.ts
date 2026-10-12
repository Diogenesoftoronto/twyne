import { seedSpec, fillSpec } from "../../../../src/utils/in-flow-tools.ts";
import { splitSentences, wordCount } from "../../../../src/utils/struggle-signals.ts";
const passages = [
  "First is long. A is B.", "A.”Next?", "A.   ? Next.",
  "\uFEFF😀\u00A0Hi. \u0085Next.", "...", "  ",
  "May be so? It always is. Never again.", "Perhaps. No one shows why.",
  "éISé there. Its issue remains.", `A.[” Last?"] More…`,
  Array.from({length:45},(_,i)=>`Sentence ${i}.`).join(" "),
];
const cases: any[] = [];
const add = (id:string,kind:any,passage:string,options:any={}) => cases.push({id,kind,passage,options});
for (const [i,passage] of passages.entries()) for (const kind of ["sentence-lab","rhythm-strip","claim-check","reader-questions"]) add(`${i}-${kind}`,kind,passage);
for (const sentenceIndex of [-3,0,1,99]) add(`sentence-index-${sentenceIndex}`,"sentence-lab","First. A longer second sentence.",{sentenceIndex});
for (const claimIndex of [-3,0,1,99]) add(`claim-index-${claimIndex}`,"claim-check","First. It must be true.",{classification:{claimIndex}});
add("attempts-last-five","sentence-lab","Current sentence.",{sentenceIndex:0,activity:{attempts:{0:["old1","old2","Current sentence.","old3","old4","old5","old6"]}}});
add("custom-band","rhythm-strip","A sentence. Another sentence.",{config:{targetMin:30,targetMax:20}});
add("fractional-band","rhythm-strip","A sentence.",{config:{targetMin:8.5,targetMax:28.25}});
add("custom-slots","claim-check","The sky is blue.",{config:{slots:["Other support"]},classification:{filled:{"Other support":true}}});
add("empty-slots-default","claim-check","The sky is blue.",{config:{slots:[]}});
add("reader-angle","reader-questions","A paragraph.",{config:{angle:"a skeptical reader"}});
add("long-seed-not-truncated","sentence-lab","x".repeat(1201));
for (const item of cases) {
  const seed=seedSpec(item.kind,item.passage,item.options);
  const filled=await fillSpec(seed,{passage:item.passage,preceding:"",goal:"",audience:""},null,()=>{});
  item.expected={seed,filled:filled.spec,notice:filled.notice??null};
}
if (!process.argv[2]) throw new Error("Owned output path is required");
await Bun.write(process.argv[2],JSON.stringify({cases,sentences:passages.map(text=>({text,spans:splitSentences(text),words:wordCount(text)}))},null,2)+"\n");
console.log(JSON.stringify({seeds:cases.length,offlineFills:cases.length,spanCases:passages.length}));
