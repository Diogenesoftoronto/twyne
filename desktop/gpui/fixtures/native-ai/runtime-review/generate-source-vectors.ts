import { writeFileSync } from "node:fs";
import { contracts, research, routing, runLifecycle, sourceHashes, type LifecycleCase } from "./source-functions";

const judgeInputs = [
  ["inline-fences", 'prefix ```JSON{"score":8.5,"rationale":"Quoted } brace"}``` suffix'],
  ["negative-json", '{"score":-2.5,"rationale":"Low"}'],
  ["reasoning", '<think>score: 10</think>{"score":6,"rationale":"Grounded"}'],
  ["named-fallback", 'Score\ufeff= 7 Rationale: "Some support"'],
  ["unrelated-digits", "The 9 assertions await evidence"],
  ["unicode-digit", 'score: ٣ rationale: "No ASCII score"'],
  ["fallback-default", "score: 99"],
  ["json-zero", '{"score":0,"rationale":""}'],
  ["malformed", '{"score":4,"rationale":"unclosed'],
  ["numeric-overflow", '{"score":1e400,"rationale":"Source clamps Infinity"}'],
];
const researchInputs = [
  ["wrapper-sort-dedupe", JSON.stringify({targets: [
    {kind:"quote", anchor:" Alpha passage ", query:"a search", importance:2.4},
    {kind:"person", anchor:"Beta passage", query:"b search", importance:5},
    {kind:"event", anchor:"ALPHA PASSAGE", query:"new search", importance:4},
    {kind:"work", anchor:"Gamma passage", query:"B SEARCH", importance:4},
    {kind:"QUOTE", anchor:"Delta passage", reason:"  why?  ", importance:4.5},
  ]})],
  ["items-wrapper", '{"items":[null,[],{"anchor":"東京😀","query":"emoji source","importance":0},{"anchor":"Later","importance":1}]}'],
  ["utf16-minimum", '{"results":[{"anchor":"😀a","query":"😀b"},{"anchor":"😀","query":"valid"}]}'],
  ["array-after-object", 'irrelevant {} then [{"anchor":"A claim","query":"A source"}]'],
  ["trailing-array-prose", '[{"anchor":"A claim","query":"A source"}] trailing prose'],
  ["query-fallback", '[{"anchor":"Meaningful claim","query":" x ","importance":"5"}]'],
  ["slice-and-sort", JSON.stringify({targets:[
    {anchor:"a".repeat(205),query:"q".repeat(165),reason:"r".repeat(245),importance:2},
    {anchor:"Short next",query:"other query",importance:5},
  ]})],
  ["js-whitespace", '[{"anchor":"\ufeff\u00a0claim\u2029","query":"\ufeffsource\u3000"}]'],
  ["unsupported-surrogate-cut", JSON.stringify({targets:[{anchor:"a".repeat(199)+"😀 tail",query:"valid source"}]})],
  ["unsupported-numeric-overflow", '{"targets":[{"anchor":"A claim","query":"A source","importance":1e400}]}'],
];
const provider = (id: string, type: string, defaultModel: string, extra = {}) =>
  ({id,name:id,type,apiKey:"synthetic-not-a-key",defaultModel,...extra});
const routeInputs = [
  {name:"text-override", feature:"rubric-judge", settings:{defaultProviderId:"anthropic",providers:[provider("anthropic","anthropic","claude"),provider("local","litert","minicpm5-2b")],perFeature:{"rubric-judge":{providerId:"local",temperature:0.1,maxTokens:123}}}},
  {name:"voice-eligibility", feature:"voice-narration", settings:{defaultProviderId:"anthropic",providers:[provider("anthropic","anthropic","claude"),provider("fish","fishaudio","old-model")],perFeature:{}}},
  {name:"openai-transcription", feature:"voice-transcription", settings:{providers:[provider("openai","openai","gpt-4.1")],perFeature:{}}},
  {name:"direct-audio", feature:"voice-transcription", settings:{providers:[provider("compatible","openai-compatible","known",{modelModalities:{known:{input:["audio"],output:["text"]}}})],perFeature:{}}},
  {name:"negative-modalities", feature:"voice-transcription", settings:{providers:[provider("compatible","openai-compatible","gemma",{modelModalities:{gemma:{input:["text"],output:["text"]}}})],perFeature:{}}},
  {name:"tinker-anthropic", feature:"voice-transcription", settings:{providers:[provider("tinker","anthropic-compatible","inkling",{baseUrl:"https://TINKER.thinkingmachines.dev/path"})],perFeature:{}}},
  {name:"unknown-provider-configured", feature:"persona-analysis", settings:{providers:[provider("unknown","future-provider","future")],perFeature:{}}},
  {name:"voice-only-no-text", feature:"persona-feedback", settings:{providers:[provider("browser","supertonic","voice")],perFeature:{}}},
  {name:"persona-voice-quirk", feature:"persona-analysis", persona:{providerId:"fish"}, settings:{providers:[provider("text","anthropic","claude"),provider("fish","fishaudio","voice-model")],perFeature:{"persona-analysis":{model:"feature-model",maxTokens:91}}}},
  {name:"persona-explicit", feature:"persona-reply", persona:{providerId:"missing",model:"explicit",temperature:0}, settings:{providers:[provider("text","anthropic","claude")],perFeature:{}}},
];
export const lifecycleInputs: LifecycleCase[] = [
  {name:"disabled"}, {name:"case-sensitive-flag",flag:"TRUE"},
  {name:"missing",flag:"true",missing:true},
  {name:"registered-ready",flag:"1",registered:true,readiness:"ready"},
  {name:"import-ready",flag:"true",readiness:"ready"},
  {name:"registry-failure-then-import",flag:"true",registered:true,registryExit:1,readiness:"ready"},
  {name:"import-failed",flag:"true",importExit:2},
  {name:"spawn-failed",flag:"true",registered:true,throwStage:"serve"},
  {name:"child-exited",flag:"true",registered:true,readiness:"exited"},
  {name:"timeout",flag:"true",registered:true,readiness:"timeout"},
  {name:"tcp-before-exited-check",flag:"true",registered:true,readiness:"listener-before-exit"},
];
export async function buildCorpus() {
  return {
    version:1, sourceHashes:sourceHashes(),
    boundaries:{routing:"Original declarations over already-normalized settings; normalization injection/stripping excluded.",
      lifecycle:"Original declarations with fake environment/files/spawn/readiness/clock; no real child/model/socket.",
      transport:"Native captured HTTP/SSE subset is synthetic and not original AI SDK transport."},
    judge:judgeInputs.map(([name,input])=>({name,input,result:contracts.parseJudgeOutput(input),nativeBoundary:name==="numeric-overflow" ? "Refused nonfinite JSON representation" : null})),
    fences:["before ```JSON{\"x\":1}``` after", "```python\ncode\n```", "\ufeff```json\n{}\n```\u00a0"].map(input=>({input,result:contracts.stripJsonFences(input)})),
    tagged:[
      {input:'😀 leading DOSSIER: {"x":"} escaped \\\""} tail',tag:"DOSSIER"},
      {input:'prefix probe: {"next":{"ask":"東京"}} suffix',tag:"PROBE"},
      {input:'SYNTHESIZE: {"x":1',tag:"SYNTHESIZE"},
      {input:'PROBE: {broken}',tag:"PROBE"},
    ].map(({input,tag})=>({input,tag,result:contracts.extractTaggedJson(input,tag as any)})),
    research:researchInputs.map(([name,input])=>{
      const result = research.parseResearchTargets(input);
      const unsupported = name.startsWith("unsupported-");
      return {name,input,result:unsupported ? null : result,sourceResultJson:unsupported ? JSON.stringify(result) : null,
        nativeBoundary:unsupported ? (name.includes("surrogate") ? "Unsupported Source UTF16 slice boundary" : "Unsupported Source nonfinite JSON number") : null};
    }),
    routing:routeInputs.map(input=>{
      const resolved = input.persona ? routing.resolveFeatureConfigForPersona(input.settings,input.feature,input.persona)
        : routing.resolveFeatureConfig(input.settings,input.feature);
      return {...input,result:resolved ? {providerId:resolved.provider.id,model:resolved.model,temperature:resolved.temperature,maxTokens:resolved.maxTokens??null} : null,
        hasAi:routing.hasConfiguredAiProvider(input.settings),hasVoice:routing.hasConfiguredVoiceProvider(input.settings)};
    }),
    lifecycle:await Promise.all(lifecycleInputs.map(runLifecycle)),
  };
}
if (import.meta.main) writeFileSync(new URL("./source-vectors.json",import.meta.url), JSON.stringify(await buildCorpus(),null,2)+"\n");
