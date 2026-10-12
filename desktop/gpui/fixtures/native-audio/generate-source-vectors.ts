import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { PERSONAS } from "../../../../src/utils/personas";
import { segmentSpeechText } from "../../../../src/utils/speech-segments";
import { mapFishTimestampEvent, alignmentRangeAtTime, alignmentRangeAtSourceOffset } from "../../../../src/utils/speech-alignment";
import { liveVoiceAudio } from "../../../../src/utils/live-voice-audio";
import { BROWSER_TTS_VOICES } from "../../../../src/utils/browser-inference";
import { normalizeApplicationError } from "../../../../src/utils/application-errors";

const root = path.resolve(import.meta.dir, "../../../..");
const originals = ["speech.ts","speech-segments.ts","speech-alignment.ts","live-voice-audio.ts","live-voice.ts","personas.ts","application-errors.ts","browser-inference.ts"];
const hashes = Object.fromEntries(originals.map(name=>[name,createHash("sha256").update(fs.readFileSync(path.join(root,"src/utils",name))).digest("hex")]));
// Execute the original private voice helpers with only their configuration/IDB
// dependencies stubbed. No synthesis or account client is instantiated.
const speechSource=fs.readFileSync(path.join(root,"src/utils/speech.ts"),"utf8");
const voiceFunctions=speechSource.slice(speechSource.indexOf("export function pickVoiceForProvider("),speechSource.indexOf("function uniqueVoiceOptions("))
  +speechSource.slice(speechSource.indexOf("async function withPersonaVoice("),speechSource.indexOf("/**\n * A one-sample silent WAV."));
const voiceJS=new Bun.Transpiler({loader:"ts"}).transformSync(voiceFunctions.replace("export function","function"));
const originalVoiceHelpers=new Function("PERSONAS","loadPersonasFromIdb","resolveFeatureConfig",voiceJS+"; return {pickVoiceForProvider, resolveVoice, withPersonaVoice};")(PERSONAS,async()=>PERSONAS,(settings:any)=>settings.resolved);
const voiceCases=await Promise.all([
  {id:"resident-name",request:{id:"n",text:"A note",author:PERSONAS[0].name}},
  {id:"resident-role",request:{id:"n",text:"A note",author:"  "+PERSONAS[1].role.toUpperCase()+"  "}},
  {id:"no-invented-alias",request:{id:"n",text:"A note",author:"Marguerite"}},
  {id:"explicit-empty-map",request:{id:"n",text:"A note",author:PERSONAS[0].name,voices:{}}},
  {id:"empty-override",request:{id:"n",text:"A note",voice:"echo",voices:{fishaudio:""}}},
].map(async row=>{const enriched=await originalVoiceHelpers.withPersonaVoice(row.request);return {...row,enriched,selected:Object.fromEntries(["openai","fishaudio","supertonic"].map(kind=>[kind,originalVoiceHelpers.resolveVoice(enriched,{resolved:{provider:{type:kind}},perFeature:{"voice-narration":{}}})??null]))};}));
const silenceBase64=speechSource.match(/const SILENCE =\s*"data:audio\/wav;base64,([^"\n]+)"/)?.[1];
if(!silenceBase64)throw new Error("Original unlock WAV not found");
const personas = PERSONAS.map(persona=>({id:persona.id,name:persona.name,role:persona.role,defaultVoice:persona.speechVoice,providerVoices:persona.speechVoices??{},instructions:persona.voice??""}));
fs.writeFileSync(path.join(root,"desktop/gpui/src/native_audio/resident_personas.json"),JSON.stringify(personas,null,2)+"\n");

const segmentation = [
  {id:"emoji-offset",source:"  😀 Café opens. A second voice answers.  ",options:{targetWords:2,maxChars:80}},
  {id:"ecmascript-space",source:"\uFEFF\u00a0First voice.\u2003Second voice.\uFEFF",options:{targetWords:2,maxChars:80}},
  {id:"long-multibyte",source:("é😀 words; ".repeat(24))+"End.",options:{targetWords:8,maxChars:81}},
  {id:"clause-without-space",source:("café—more".repeat(20))+" tail.",options:{targetWords:3,maxChars:83}},
  {id:"crlf-and-quotes",source:"First paragraph.\n\r\n\"Second paragraph!\" Third—one.",options:{targetWords:2,maxChars:80}},
  {id:"apostrophes-numbers",source:"Don't re-read 3.14 lightly. ’Tis déjà vu! The end.",options:{targetWords:4,maxChars:80}},
  {id:"unbroken-token",source:"😀".repeat(95)+". Next.",options:{targetWords:1,maxChars:80}},
  {id:"intl-abbreviation",source:"Dr. Rivers arrived. The writer stopped. Then he left.",options:{targetWords:2,maxChars:80}},
  {id:"blank",source:"\uFEFF \n\t\u2003",options:{targetWords:1,maxChars:80}},
].map(row=>({...row,sourceIntl:segmentSpeechText(row.source,row.options),sourceFallback:[] as ReturnType<typeof segmentSpeechText>}));
const descriptor = Object.getOwnPropertyDescriptor(Intl,"Segmenter");
try {
  Object.defineProperty(Intl,"Segmenter",{value:undefined,configurable:true});
  for(const row of segmentation) row.sourceFallback=segmentSpeechText(row.source,row.options);
} finally { if(descriptor) Object.defineProperty(Intl,"Segmenter",descriptor); }

const alignment = [
  {id:"utf16-repeated",source:"😀 écho écho, café.",sourceStart:3,event:{content:"écho écho, café.",chunk_audio_offset_sec:1.25,alignment:{segments:[{text:"écho",start:0,end:.2},{text:"écho",start:.3,end:.5},{text:"café",start:.6,end:.9}]}}},
  {id:"normalization-refusal",source:"Keep Café intact.",sourceStart:5,event:{content:"Cafe intact.",alignment:{segments:[{text:"Cafe",start:0,end:.4},{text:"intact",start:.5,end:.9}]}}},
  {id:"negative-audio-offset",source:"A B",sourceStart:0,event:{content:"A B",chunk_audio_offset_sec:-2,alignment:{segments:[{text:"A",start:0,end:.2},{text:"B",start:.5,end:1}]}}},
].map(row=>{
  const ranges=mapFishTimestampEvent(row.source,row.event,row.sourceStart);
  return {...row,ranges,times:[-2,-1.5,0,1.25,1.7,2,99].map(seconds=>({seconds,index:ranges.indexOf(alignmentRangeAtTime(ranges,seconds)!)})),offsets:[0,3,7,8,12,99].map(offset=>({offset,index:ranges.indexOf(alignmentRangeAtSourceOffset(ranges,offset)!)}))};
});

// Execute the exact original AudioWorklet and liveVoiceAudio against in-memory
// WebAudio objects. These never ask for, record, or play a physical device.
const audioSource=fs.readFileSync(path.join(root,"src/utils/live-voice-audio.ts"),"utf8");
const worklet=audioSource.match(/const WORKLET = `([\s\S]*?)`;/)?.[1];
if(!worklet)throw new Error("Original Worklet source not found.");
const emitted:ArrayBuffer[]=[];
let Processor:any;
vm.runInNewContext(worklet,{
  AudioWorkletProcessor:class{port={postMessage:(buffer:ArrayBuffer)=>emitted.push(buffer)};},
  Int16Array,
  registerProcessor:(_name:string,klass:any)=>{Processor=klass;},
});
const processor=new Processor();
const probeInput=Float32Array.from([0,.00002,-.00002,.5,-.5,.99999,-.99999,1,-1,2,-2,.123456,-.123456]);
const input=new Float32Array(2400);input.set(probeInput);
processor.process([[input.subarray(0,777)]]);
const emittedAfterFirst=emitted.length;
processor.process([[input.subarray(777)]]);
const quantized=Array.from(new Int16Array(emitted[0]));
let workletNode:any;
const sourceOutput:Float32Array[]=[];
const scheduled:number[]=[];
let tracksStopped=false;
class FakeContext{
  sampleRate=24000;state="running";currentTime=0;
  audioWorklet={addModule:async()=>{}};
  async resume(){} async close(){this.state="closed";}
  createMediaStreamSource(){return{connect(){},disconnect(){}};}
  createGain(){return{gain:{value:1},connect(){},disconnect(){}};}
  createBuffer(_channels:number,length:number){const values=new Float32Array(length);sourceOutput.push(values);return{duration:length/24000,getChannelData:()=>values};}
  createBufferSource(){return{buffer:null as any,connect(){},disconnect(){},stop(){},onended:null,start:(time:number)=>scheduled.push(time)};}
}
const globalNames=["navigator","AudioContext","AudioWorkletNode"];
const saved=globalNames.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
const chunks:any[]=[];
try{
  const track={enabled:true,stop(){tracksStopped=true;}};
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}}});
  Object.defineProperty(globalThis,"AudioContext",{configurable:true,value:FakeContext});
  Object.defineProperty(globalThis,"AudioWorkletNode",{configurable:true,value:class{port={onmessage:null as any};constructor(){workletNode=this;}connect(){}disconnect(){}}});
  const controller=await liveVoiceAudio((base64,level)=>chunks.push({base64,level}));
  workletNode.port.onmessage({data:emitted[0]});
  controller.play(btoa(String.fromCharCode(...new Uint8Array(emitted[0]))),()=>{});
  controller.play(btoa(String.fromCharCode(...new Uint8Array(emitted[0]))),()=>{});
  let oddError="";try{controller.play(btoa("a"),()=>{});}catch(error){oddError=(error as Error).message;}
  controller.mute(true);const mutedTrackEnabled=track.enabled;
  controller.stop();
  fs.writeFileSync(path.join(import.meta.dir,"source-vectors.json"),JSON.stringify({
    provenance:"Executed unmodified Source TS helpers, exact original Worklet and liveVoiceAudio with only in-memory WebAudio/device stubs. No provider/network/physical device/app calls.",hashes,personas,voiceCases,browserVoices:BROWSER_TTS_VOICES,silenceWav:Array.from(Buffer.from(silenceBase64,"base64")),segmentation,alignment,
    pcm:{input:Array.from(probeInput),quantized:quantized.slice(0,probeInput.length),playback:Array.from(sourceOutput[0].subarray(0,probeInput.length)),level:chunks[0].level,emittedAfterFirst,emittedAfterFull:emitted.length,chunkBytes:emitted[0].byteLength,scheduled,oddError,mutedTrackEnabled,tracksStopped},
    sanitizedErrors:["Authorization: Bearer synthetic-private-token\nMANUSCRIPT: private draft text", "API key=synthetic-private-key"].map(message=>normalizeApplicationError(new Error(message),{source:"provider",metadata:{feature:"voice-narration",operation:"synthesize"}})),
  },null,2)+"\n");
}finally{for(const[name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete(globalThis as any)[name];}}
console.log({segmentation:segmentation.length,alignment:alignment.length,workletFrames:emitted.length,providersCalled:0,devicesOpened:0});
