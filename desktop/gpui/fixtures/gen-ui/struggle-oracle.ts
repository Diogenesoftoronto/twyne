// The unchanged Source implementation is the oracle, with explicit edit times.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  emptyActivity, recordEdit, commitVersion, readStruggle, coolDown, hedgeCount,
  type BlockActivity,
} from "../../../../src/utils/struggle-signals";

type Step = { op: string; text?: string; at?: number; undo?: boolean; cursorAtEnd?: boolean; ms?: number; values?: Partial<BlockActivity> };
type Case = { id: string; initial: string; steps: Step[]; startAt?: number };
const cases: Case[] = [];
const add = (id: string, initial: string, steps: Step[]) => cases.push({ id, initial, steps });
const edit = (text: string, at: number, undo = false): Step => ({op:"edit",text,at,undo});
const commit: Step = {op:"commit"};
const read = (at: number, cursorAtEnd = false): Step => ({op:"read",at,cursorAtEnd});
const base = "The committee met on Tuesday. It decided nothing of consequence. Everyone went home. Nobody minded.";
add("three rewrites and attempts",base,[
  ...["settled nothing at all","reached no decision","adjourned undecided"].flatMap((word,i)=>[edit(base.replace("decided nothing of consequence",word),i+1),commit,read(i+1)]),
]);
add("caps and repeated prior wording",base,Array.from({length:12},(_,i)=>[
  edit(base.replace("decided nothing of consequence",i%4===0?"reached no decision":`settled matter number ${i}`),i+1),commit,read(i+1),
]).flat());
add("splits reset sentence indices",base,[
  edit(base.replace("decided nothing of consequence","settled nothing at all"),1),commit,
  edit(base.replace("Tuesday. It","Tuesday and it"),2),commit,
  edit(base,3),commit,read(4),
]);
add("writing forwards", "", [
  ...base.split(" ").map((_,i)=>base.split(" ").slice(0,i+1).join(" ")).flatMap((text,i)=>[edit(text,i+1),commit]),read(99),
]);
for(const whitespace of [""," \t\r\n\uFEFF\u00a0","\u0085","\u200b"]) add("initial whitespace "+JSON.stringify(whitespace),whitespace,[read(0),edit(whitespace,10,true),commit,read(10)]);
add("UTF16 shared high surrogate","a😀b",[edit("a😃b",1,true),commit,read(2)]);
add("meaningful UTF16 growth","a",[edit("a"+"😀".repeat(5)+"b",1),edit("a"+"😀".repeat(6),2),commit,read(3)]);
add("hedge flips", "Remote work is better for deep focus than any open-plan office ever built.", [
  ...["Remote work is perhaps better for deep focus than any open-plan office ever built.","Remote work is better for deep focus than any open-plan office ever built.","Remote work is probably better for deep focus than any open-plan office ever built."].flatMap((text,i)=>[edit(text,i+1),commit]),read(4),
]);
const long = `${base} ${base} ${base}`;
add("stall boundaries",`${long} A paragraph of padding that the writer then cut away entirely.`,[
  edit(long,1_000),commit,read(39_999,true),read(40_000,false),read(40_000,true),
  {op:"patch",values:{lastEditAt:33_000}},read(40_999,true),read(41_000,true),
  {op:"cool",at:41_000},read(340_999,true),read(341_000,true),
]);
add("numeric key ties and invalid indices",base,[
  {op:"patch",values:{rewrites:{2:3,0:3,99:10}}},read(1),
  {op:"patch",values:{rewrites:{1:1}}},read(2),
  {op:"cool",at:2,ms:3},read(4),read(5),
]);
for(const flips of [1,2,3,10]) add(`hedge score ${flips}`,long,[{op:"patch",values:{hedgeFlips:flips}},read(1)]);
for(const cuts of [39,40]) add(`stall cuts ${cuts}`,long,[{op:"patch",values:{deleted:cuts,lastEditAt:1_000}},read(40_000,true)]);
for(const churn of [159,160,161,500]) add(`churn ${churn}`,"An opening sentence. "+"word ".repeat(82)+"ends here. A closing sentence.",[{op:"patch",values:{inserted:churn}},read(1)]);

// Reproducible edit sequences exercise UTF16 middle edits, punctuation and trim.
let random = 0x1537a19;
const next = (n:number) => { random = (Math.imul(random,1664525)+1013904223)>>>0; return random%n; };
const pieces=["a","b","😀","😃","💡"," ","\uFEFF","\u0085","Perhaps","maybe","?",".","…"," )","\n"];
const text = () => Array.from({length:20+next(30)},()=>pieces[next(pieces.length)]).join("");
for(let i=0;i<40;i++) {
  const initial=text();
  const steps:Step[]=[];
  for(let j=0;j<8;j++) {
    steps.push(edit(text(),j*13,!!next(2)));
    if(next(2)) steps.push(commit);
    steps.push(read(j*13+next(42_000),!!next(2)));
  }
  add(`random-${i}`,initial,steps);
}
const hedges = ["perhaps maybe SEEMS appear suggest suggests", "_perhaps_ xperhaps perhapsx", "éperhapsé ſeems İ think i think", "in some ways to some extent I BELIEVE", "might\uFEFFmay\u0085could", "maybemaybe maybe-maybe"];
const results=cases.map(input=>{
  let activity=emptyActivity(input.initial,input.startAt??0);
  const initial=activity;
  const frames=input.steps.map(step=>{
    let reading;
    switch(step.op) {
      case "edit": activity=recordEdit(activity,step.text!,step.at!,{undo:step.undo});break;
      case "commit": activity=commitVersion(activity);break;
      case "cool": activity=coolDown(activity,step.at!,step.ms);break;
      case "patch": activity={...activity,...step.values};break;
      case "read": reading=readStruggle(activity,step.at!,{cursorAtEnd:step.cursorAtEnd});break;
      default: throw new Error("Unknown oracle operation");
    }
    return {activity,...(reading?{reading}:{})};
  });
  return {input,initial,frames};
});
const path="src/utils/struggle-signals.ts";
if(!process.argv[2]) throw new Error("Owned output path required");
await Bun.write(process.argv[2],JSON.stringify({hashes:{[path]:createHash("sha256").update(readFileSync(path)).digest("hex")},cases:results,hedges:hedges.map(text=>({text,count:hedgeCount(text)}))},null,2)+"\n");
console.log(JSON.stringify({cases:results.length,frames:results.reduce((n,c)=>n+c.frames.length,0),hedges:hedges.length}));
