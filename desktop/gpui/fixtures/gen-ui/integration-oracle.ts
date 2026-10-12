// Execute the current Source codecs, offset function and placement arithmetic.
// Storage is replaced through Source's own adapter seam; no user data or UI.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Schema } from "@tiptap/pm/model";
import { normalizeSavedTool, loadSavedTools, __setSavedToolsStorageForTests } from "../../../../src/utils/saved-tools";
import { loadWritingToolsNotebook, __setWritingToolsStorageForTests } from "../../../../src/utils/writing-tools-storage";

const sources = ["src/utils/saved-tools.ts", "src/utils/writing-tools-storage.ts", "src/components/editor/extensions/struggle-tracker.ts", "src/components/in-flow/margin-rail.tsx"];
const hashes = Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const unpaired = (value: any): boolean => {
  if (typeof value === "string") {
    for (let i=0; i<value.length; i++) {
      const unit=value.charCodeAt(i);
      if (unit>=0xd800 && unit<=0xdbff) {
        const next=value.charCodeAt(++i);
        if (!(next>=0xdc00 && next<=0xdfff)) return true;
      } else if (unit>=0xdc00 && unit<=0xdfff) return true;
    }
  } else if (Array.isArray(value)) return value.some(unpaired);
  else if (value && typeof value === "object") return Object.values(value).some(unpaired);
  return false;
};
const saved: any[]=[];
const savedCase=(id:string,input:any)=>{
  const expected=normalizeSavedTool(input);
  saved.push({id,input,...(unpaired(expected)?{unpairedOutput:true}:{expected})});
};
for (const [index,input] of [null,false,0,"x",[],{}, {id:"",kind:"sentence-lab"},{id:"x",kind:"wrong"}].entries()) savedCase(`invalid-${index}`,input);
for (const kind of ["sentence-lab","rhythm-strip","claim-check","reader-questions"]) savedCase(kind,{id:" x ",kind,name:"\uFEFF  Tool  \uFEFF",config:{extra:"draft",angle:"\uFEFF reader \uFEFF"},savedAt:2.5,ignored:true});
for (const number of [-1e100,-0.5,1.4999999999999998,1.5,1.5000000000000002,79.5,80.5,119.5,1e100]) savedCase(`round-${number}`,{id:"r",kind:"rhythm-strip",config:{targetMin:number,targetMax:number}});
savedCase("slots-retain-raw-spaces",{id:"c",kind:"claim-check",config:{slots:[null,0,"\uFEFF", "  source  ","\u0085","x".repeat(61),"last","fifth","sixth"]}});
savedCase("retained-unpaired-name",{id:"c",kind:"claim-check",name:"x".repeat(59)+"😀"});
savedCase("retained-unpaired-slot",{id:"c",kind:"claim-check",config:{slots:["x".repeat(59)+"😀"]}});
savedCase("discarded-sixth-slot-does-not-change-output",{id:"c",kind:"claim-check",config:{slots:["a","b","c","d","e","x".repeat(59)+"😀"]}});
savedCase("retained-unpaired-angle",{id:"r",kind:"reader-questions",config:{angle:"x".repeat(199)+"😀"}});
let stored:any=null;
__setSavedToolsStorageForTests({load:async()=>stored,save:async()=>{}} as any);
const savedLoads:any[]=[];
for (const [id,input] of [["non-array",{}],["mixed",saved.filter(c=>"expected"in c).map(c=>c.input)],["uncapped-load",Array.from({length:30},(_,i)=>({id:String(i),kind:"sentence-lab"}))]] as const) {
  stored=input;
  savedLoads.push({id,input,expected:await loadSavedTools()});
}
__setSavedToolsStorageForTests(null);

__setWritingToolsStorageForTests({load:async()=>stored,save:async()=>{}} as any);
const notebooks:any[]=[];
const notebookInputs:any[]=[null,false,[],{}, {audience:42,voiceSamples:"x",scraps:null,sources:[],intentionalPromises:3}, {
  audience:"\uFEFF reader ",extra:"discard",
  voiceSamples:[null,{}, {id:"",text:"",metadata:{keep:true}},{id:2,text:"bad"},{id:"v",text:"Voice.",extra:[1]}],
  scraps:[{id:"s",text:"Question?",answered:true},{id:"bad",text:false}],
  sources:[{id:"a",claim:"",source:"",metadata:1},{id:"b",claim:"claim",source:"source",previousClaim:"",keep:true},{id:"null",claim:"x",source:"y",previousClaim:null},{id:"bad",claim:2,source:"y"}],
  intentionalPromises:["",3," x ","x","x",false],
}];
for (const [index,input] of notebookInputs.entries()) { stored=input; notebooks.push({id:`notebook-${index}`,input,expected:await loadWritingToolsNotebook("folio")}); }
__setWritingToolsStorageForTests(null);

const tracker=readFileSync(sources[2],"utf8");
const offsetCode=tracker.slice(tracker.indexOf("function posAtOffset("),tracker.indexOf("function isTrackedBlock("));
const offsetFunction=new Function(new Bun.Transpiler({loader:"ts"}).transformSync(offsetCode)+";return posAtOffset;")();
const schema=new Schema({nodes:{doc:{content:"block+"},paragraph:{group:"block",content:"inline*"},text:{group:"inline"},hardBreak:{inline:true,group:"inline"},image:{inline:true,group:"inline",atom:true,attrs:{src:{default:"x"}}}},marks:{strong:{},em:{}}});
const spans:any[]=[];
const passages=[
  {id:"unicode-mark-break-atom",html:"<p><strong>A😀</strong><br><em>B.</em><img src='x'> C.</p>",content:[{type:"text",text:"A😀",marks:[{type:"strong"}]},{type:"hardBreak"},{type:"text",text:"B.",marks:[{type:"em"}]},{type:"image"},{type:"text",text:" C."}]},
  {id:"leading-atoms",html:"<p><img src='x'><br>Text.</p>",content:[{type:"image"},{type:"hardBreak"},{type:"text",text:"Text."}]},
  {id:"atom-only",html:"<p><img src='x'><br></p>",content:[{type:"image"},{type:"hardBreak"}]},
  {id:"marked-ties",html:"<p>A<strong>B</strong><img src='x'><em>C</em><br>D.</p>",content:[{type:"text",text:"A"},{type:"text",text:"B",marks:[{type:"strong"}]},{type:"image"},{type:"text",text:"C",marks:[{type:"em"}]},{type:"hardBreak"},{type:"text",text:"D."}]},
  {id:"empty",html:"<p></p>",content:[]},
];
for (const passage of passages) {
  const node=schema.nodeFromJSON({type:"paragraph",content:passage.content});
  spans.push({id:passage.id,html:passage.html,text:node.textContent,positions:Array.from({length:node.textContent.length+1},(_,offset)=>({offset,projectionUtf16:offsetFunction(node,0,offset)-1}))});
}

const rail=readFileSync(sources[3],"utf8");
const constants=rail.slice(rail.indexOf("const CARD_WIDTH ="),rail.indexOf("interface RailState"));
const modeStart=rail.indexOf("const right = scrollerRect.right");
const modeEnd=rail.indexOf("state.shelf =",modeStart);
const mode=rail.slice(modeStart,rail.indexOf(";",modeEnd)+1);
const anchorStart=rail.indexOf("state.anchorTop = rect.top");
const anchor=rail.slice(anchorStart,rail.indexOf("} else {",anchorStart));
const geometryFunction=new Function("canvasRect","scrollerRect","rect","window",constants+"const state={};"+mode+anchor+"return state;");
const geometries:any[]=[];
for (const width of [280,620,1280,1800]) for (const right of [331.984375,332,332.015625]) for (const left of [203.984375,204]) for (const top of [-200,60,760]) {
  const canvas={left,right:width-right,top:80,bottom:1400};
  const scroller={left:0,right:width,top:44,bottom:820};
  const rect={left:canvas.left+40,top,bottom:top+100,height:100};
  const view={innerWidth:width,innerHeight:860};
  const state=geometryFunction(canvas,scroller,rect,view);
  geometries.push({canvas,scroller,anchor:{...rect,right:rect.left+500},viewport:{width,height:860},expected:{rail:state.mode==="rail",shelf:state.shelf,x:state.mode==="rail"?canvas.right+28:state.popLeft,top:state.mode==="rail"?canvas.top+state.cardTop:state.popTop,connectorTop:canvas.top+state.anchorTop+Math.min(12,state.anchorHeight/2)}});
}
if (!process.argv[2]) throw new Error("Owned output path required");
await Bun.write(process.argv[2],JSON.stringify({hashes,saved,savedLoads,notebooks,spans,geometries},null,2)+"\n");
console.log(JSON.stringify({saved:saved.length,savedLoads:savedLoads.length,notebooks:notebooks.length,paragraphs:spans.length,positions:spans.reduce((n,c)=>n+c.positions.length,0),geometries:geometries.length}));
