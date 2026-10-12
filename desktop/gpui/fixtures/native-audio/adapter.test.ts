import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PERSONAS } from "../../../../src/utils/personas";
import { BROWSER_TTS_VOICES } from "../../../../src/utils/browser-inference";
import { segmentSpeechText } from "../../../../src/utils/speech-segments";
import { mapFishTimestampEvent, alignmentRangeAtTime, alignmentRangeAtSourceOffset } from "../../../../src/utils/speech-alignment";
import { parseLiveAction, LIVE_ACTIONS } from "../../../../src/utils/live-voice-contract";
import { normalizeApplicationError } from "../../../../src/utils/application-errors";

// These checks execute Source helpers; native behavior is checked separately by
// run-rust.ts. They are not browser, synthesis, gateway, or device acceptance.
const vector=await Bun.file(path.join(import.meta.dir,"source-vectors.json")).json();
const root=path.resolve(import.meta.dir,"../../../..");

test("vectors belong to the current unmodified Source helper bytes",()=>{
  for(const [file,hash] of Object.entries(vector.hashes)){
    expect(createHash("sha256").update(fs.readFileSync(path.join(root,"src/utils",file))).digest("hex")).toBe(hash);
  }
});
test("resident voice prose and provider overrides come from actual PERSONAS",()=>{
  const projected=PERSONAS.map(p=>({id:p.id,name:p.name,role:p.role,defaultVoice:p.speechVoice,providerVoices:p.speechVoices??{},instructions:p.voice??""}));
  expect(projected).toEqual(vector.personas);
  expect(JSON.parse(fs.readFileSync(path.join(root,"desktop/gpui/src/native_audio/resident_personas.json"),"utf8"))).toEqual(projected);
  expect(vector.browserVoices).toEqual([...BROWSER_TTS_VOICES]);
});
test("actual Intl and fallback segmentation retain JS UTF16 boundaries",()=>{
  for(const row of vector.segmentation)expect(segmentSpeechText(row.source,row.options)).toEqual(row.sourceIntl);
  const descriptor=Object.getOwnPropertyDescriptor(Intl,"Segmenter");
  try {
    Object.defineProperty(Intl,"Segmenter",{configurable:true,value:undefined});
    for(const row of vector.segmentation){
      const chunks=segmentSpeechText(row.source,row.options);
      expect(chunks).toEqual(row.sourceFallback);
      for(const chunk of chunks)expect(row.source.slice(chunk.start,chunk.end)).toBe(chunk.text);
    }
  } finally {if(descriptor)Object.defineProperty(Intl,"Segmenter",descriptor);}
});
test("Fish exact matching and timing lookup execute actual Source helpers",()=>{
  for(const row of vector.alignment){
    const ranges=mapFishTimestampEvent(row.source,row.event,row.sourceStart);
    expect(ranges).toEqual(row.ranges);
    for(const check of row.times)expect(ranges.indexOf(alignmentRangeAtTime(ranges,check.seconds)!)).toBe(check.index);
    for(const check of row.offsets)expect(ranges.indexOf(alignmentRangeAtSourceOffset(ranges,check.offset)!)).toBe(check.index);
  }
});
test("voice proposals are typed data and Source refuses oversized or unknown actions",()=>{
  for(const kind of LIVE_ACTIONS)expect(parseLiveAction(JSON.stringify({kind,text:"Café 😀",original:"",target:""}))).toEqual({kind,text:"Café 😀",original:"",target:""});
  expect(()=>parseLiveAction(JSON.stringify({kind:"send",text:"",original:"",target:""}))).toThrow();
  expect(()=>parseLiveAction(JSON.stringify({kind:"append",text:"😀".repeat(4001),original:"",target:""}))).toThrow();
  expect(parseLiveAction(JSON.stringify({kind:"append",text:"😀".repeat(4000),original:"",target:""})).text.length).toBe(8000);
});
test("Source normalization never publishes arbitrary provider errors",()=>{
  for(const message of ["Authorization: Bearer synthetic-private-token\nMANUSCRIPT: private draft text","API key=synthetic-private-key"]){
    const safe=normalizeApplicationError(new Error(message),{source:"provider",metadata:{feature:"voice-narration",operation:"synthesize"}});
    expect(safe.message).toBe(vector.sanitizedErrors[0].message);
    expect(safe.code).toBe(vector.sanitizedErrors[0].code);
    expect(JSON.stringify(safe)).not.toContain("synthetic-private");
    expect(JSON.stringify(safe)).not.toContain("MANUSCRIPT");
  }
});
