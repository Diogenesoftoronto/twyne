// Execute the installed, unchanged ProseMirror StepMap implementation.
import { StepMap } from "prosemirror-transform";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPaths = ["node_modules/prosemirror-transform/src/map.ts", "node_modules/prosemirror-transform/dist/index.js", "node_modules/prosemirror-transform/package.json"];
const hashes = Object.fromEntries(await Promise.all(inputPaths.map(async p => [p, createHash("sha256").update(await readFile(p)).digest("hex")])));
const inputs: {id:string; ranges:number[][]; offset?:number}[] = [
  {id:"identity",ranges:[]},
  {id:"insert",ranges:[[3,0,4]]},
  {id:"delete",ranges:[[3,4,0]]},
  {id:"replace-short",ranges:[[3,7,2]]},
  {id:"replace-long",ranges:[[3,2,7]]},
  {id:"zero-range",ranges:[[3,0,0]]},
  {id:"many-ranges",ranges:[[1,2,5],[7,3,1],[13,0,2],[18,5,3],[30,1,0]]},
  {id:"adjacent-ranges",ranges:[[2,3,2],[5,2,4],[7,0,3]]},
  ...[-20,0,20].map(offset=>({id:`offset-${offset}`,ranges:[],offset})),
  ...[2**31,2**37-1,2**37,2**38,2**45].map(size=>({id:`large-recovery-${size}`,ranges:[[2,3,4],[10,size,size-3],[size+20,7,12]]})),
];
let state = 0x6b514c39;
function random(n:number) { state = (Math.imul(state,1664525)+1013904223) >>> 0; return state % n; }
for(let n=0;n<40;n++) {
  let from=0;
  const ranges:number[][]=[];
  for(let r=0,count=1+random(6);r<count;r++) {
    const old=random(9), insert=random(9);
    from+=1+random(7);
    ranges.push([from,old,insert]);
    from+=old;
  }
  inputs.push({id:`seeded-${n}`,ranges});
}
const cases=inputs.flatMap(input=>[false,true].map(inverted=>{
  const original=input.offset===undefined ? new StepMap(input.ranges.flat()) : StepMap.offset(input.offset);
  const map=inverted ? original.invert() : original;
  const changed:number[][]=[];
  map.forEach((...range)=>changed.push(range));
  const points=new Set<number>([0,1,2,3,4,5,6,7,8,9,10,15,30,60,100]);
  for(const [start,end] of changed) for(const p of [start-1,start,start+1,end-1,end,end+1]) if(p>=0) points.add(p);
  const positions=Array.from(points).sort((a,b)=>a-b);
  const frames=positions.flatMap(pos=>[-1,0,1,3].map(assoc=>{
    const result=map.mapResult(pos,assoc);
    return {pos,assoc,mapped:map.map(pos,assoc),delInfo:result.delInfo,recover:result.recover,
      deleted:result.deleted,deletedBefore:result.deletedBefore,deletedAfter:result.deletedAfter,deletedAcross:result.deletedAcross,
      recovered:result.recover===null ? null : map.recover(result.recover),
      inverseRecovered:result.recover===null ? null : map.invert().recover(result.recover),
      touched:result.recover===null ? [] : positions.map(point=>map.touches(point,result.recover!))};
  }));
  return {input,inverted,positions,changed,frames};
}));
const result={hashes,cases,scope:"Unchanged installed ProseMirror StepMap for valid nonnegative safe-integer document coordinates. Includes IEEE-754 recovery rounding; does not prove native transaction mapping or Mapping mirror pipelines."};
await writeFile(resolve(import.meta.dir,"step-map-oracle.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({cases:cases.length,frames:cases.reduce((n,c)=>n+c.frames.length,0)}));
