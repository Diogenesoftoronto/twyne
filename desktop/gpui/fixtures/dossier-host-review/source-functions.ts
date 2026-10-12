import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { probeAnswerText, upsertProbe } from "../../../../src/utils/dossier-probes";
import { createAppError, normalizeApplicationError } from "../../../../src/utils/application-errors";

export const root = resolve(import.meta.dir,"../../../..");
const conversationPath = "src/components/onboarding/conversational-interview.tsx";
const briefPath = "src/utils/anti-tabula-rasa.ts";
export const sourcePaths = [conversationPath,briefPath,"src/utils/dossier-probes.ts",
  "src/routes/dossier/create/index.tsx","src/routes/dossier/refine/index.tsx","src/utils/dossier-filing.ts","src/utils/brief-history.ts"];
export function hashes() {
  return Object.fromEntries(sourcePaths.map(path=>[path,
    createHash("sha256").update(readFileSync(resolve(root,path))).digest("hex")]));
}
// AST selects the original declaration/initializer. Only the export modifier
// is removed; Qwik/provider/storage/clock dependencies below are explicit fakes.
function select(path:string,names:string[]) {
  const text = readFileSync(resolve(root,path),"utf8");
  const file = ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const selected = new Map<string,string>();
  function visit(node:ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      selected.set(node.name.text,node.getText(file).replace(/^export\s+/,""));
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      selected.set(node.name.text,`const ${node.getText(file)};`);
    }
    ts.forEachChild(node,visit);
  }
  visit(file);
  for (const name of names) if (!selected.has(name)) throw Error(`Missing Source declaration ${name}`);
  return names.map(name=>selected.get(name)).join("\n");
}
function execute(text:string,bindings:Record<string,unknown>,returns:string[]) {
  const js = new Bun.Transpiler({loader:"ts",target:"browser"}).transformSync(text);
  return new Function(...Object.keys(bindings),`${js}\nreturn {${returns.join(",")}};`)(...Object.values(bindings));
}
export function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(reason:unknown)=>void;
  const promise = new Promise<T>((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
export async function settle() { for(let i=0;i<64;i++) await Promise.resolve(); }
export const answers = {workingTitle:"The notebook",format:"Essay",audience:"A reader",goal:"Make the claim clear",tone:"Exact",constraints:"Evidence",successSignal:"A useful question"};
export const retainedProbe = {id:"probe-prior",kind:"choice",prompt:"Which reader?",options:["General","Specialist"],answer:"Specialist",unknown:{keep:true}};
export const attachment = {id:"attachment-prior",kind:"link",title:"Reference",why:"Prior evidence",url:"https://example.invalid/reference",addedAt:50,unknownAttachment:{keep:true}};
export const existingBrief = {answers,attachments:[attachment],probes:[retainedProbe],completedAt:100,updatedAt:200,unknown:{keep:true}};
export const question = {kind:"question",text:"What changed?",provider:"synthetic",model:"synthetic"};

export function conversation(options:{mode?:"first-run"|"refine";initialBrief?:unknown;configured?:boolean;
  turns?:Array<unknown>;complete?:(payload:unknown)=>Promise<unknown>|unknown}={}) {
  const calls:Array<unknown> = [], complete:Array<unknown> = [], form:Array<unknown> = [];
  const turns = [...(options.turns ?? [])];
  const props = {
    mode:options.mode??"first-run",initialBrief:options.initialBrief,
    initialAttachments:(options.initialBrief as any)?.attachments ?? [],initialMaterial:"Carried manuscript",
    onUseForm$:(payload:unknown)=>{form.push(structuredClone(payload));},
    onComplete$:async (payload:unknown)=>{complete.push(structuredClone(payload));await options.complete?.(payload);},
  };
  const api = execute(select(conversationPath,[
    "FIELD_ORDER","EMPTY_ANSWERS","OPENING_QUESTION","REFINE_OPENING_QUESTION","mergeDossierDraft",
    "store","runTurn","send","answerProbe","skipProbe","retryTurn","useForm","requestSynthesis",
    "acceptSynthesis","dismissSynthesis","applyEdit",
  ]), {
    props,$:(callback:unknown)=>callback,useStore:(value:unknown)=>value,
    inputRef:{value:null},clientSig:{value:null},probeAnswerText,upsertProbe,createAppError,normalizeApplicationError,
    loadAiSettingsFromIdb:async ()=>options.configured===false ? null : {providers:[{id:"synthetic",type:"openai",apiKey:"synthetic-not-a-key"}]},
    hasConfiguredAiProvider:(settings:any)=>!!settings?.providers.length,
    runClientInterviewTurn:async (request:unknown,_settings:unknown,onStream:(update:unknown)=>void)=>{
      calls.push(structuredClone(request));
      onStream({text:"",reasoning:"Synthetic reasoning",phase:"reasoning"});
      const next:any = turns.shift();
      return await (next ?? {ok:true,value:question});
    },
    // No hosted client is supplied, and this sentinel can never dispatch.
    api:{},crypto:{randomUUID:()=>{throw Error("No hosted account/client in fixture");}},
  }, ["store","runTurn","send","answerProbe","skipProbe","retryTurn","useForm","requestSynthesis","acceptSynthesis","dismissSynthesis","applyEdit","OPENING_QUESTION","REFINE_OPENING_QUESTION"]);
  // Execute the actual visible-task initializer body separately: it is the
  // only hook body with this initialization guard/opening assignment.
  const source = readFileSync(resolve(root,conversationPath),"utf8");
  const file = ts.createSourceFile(conversationPath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let openingBody:string|undefined;
  function visit(node:ts.Node) {
    if(ts.isCallExpression(node) && node.expression.getText(file)==="useVisibleTask$" &&
      node.arguments[0] && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].body.getText(file).includes("if (store.initialized) return;")) {
      openingBody=node.arguments[0].getText(file);
    }
    ts.forEachChild(node,visit);
  }
  visit(file);
  if(!openingBody) throw Error("Missing actual opening task");
  const init = execute(`const initialize=${openingBody};`,{store:api.store,props,
    OPENING_QUESTION:api.OPENING_QUESTION,REFINE_OPENING_QUESTION:api.REFINE_OPENING_QUESTION},["initialize"]).initialize;
  return {...api,initialize:init,calls,complete,form};
}
export function snapshot(api:any) {
  const store=api.store;
  return {messages:structuredClone(store.messages),loading:store.loading,pendingWriterText:store.pendingWriterText,
    synthesis:structuredClone(store.synthesis),liveDraft:structuredClone(store.liveDraft),answeredProbes:structuredClone(store.answeredProbes),
    activeProbe:structuredClone(store.activeProbe),draft:store.draft,requestVersion:store.requestVersion,filing:store.filing,
    error:store.error ? {code:store.error.code,recovery:store.error.recovery,source:store.error.source} : null};
}

export function briefHistory() {
  let editions:Array<any>=[];
  const calls:Array<unknown>=[];
  let id=0;
  const api=execute(select("src/utils/house-model.ts",["DOSSIER_FIELDS"])+"\n"+
    select("src/utils/brief-history.ts",["MAX_BRIEF_EDITIONS","editionsKey","loadBriefEditions","archiveBriefEdition","recordBriefChanges"]), {
      loadMetaFromIdb:async(key:string)=>{calls.push({kind:"read",key});return structuredClone(editions);},
      saveMetaToIdb:async(key:string,value:Array<any>)=>{calls.push({kind:"write",key});editions=structuredClone(value);},
      appendLedger:async(value:unknown)=>{calls.push({kind:"ledger",value:structuredClone(value)});},
      Date:{now:()=>1000},crypto:{randomUUID:()=>`synthetic-${++id}`},
    },["archiveBriefEdition","loadBriefEditions"]);
  return {...api,calls,get editions(){return structuredClone(editions);}};
}

export function filing(options:{mode:"create"|"refine";fail?:"readback"|"mirror";empty?:boolean;holdFeedback?:boolean;missingScope?:boolean}) {
  const calls:Array<any>=[], rows=new Map<string,any>([["folio-a",structuredClone(existingBrief)]]);
  const feedback=deferred<void>();
  const fixedDate={now:()=>1000};
  const pure = execute(select(briefPath,["DEFAULT_INTERVIEW_ANSWERS","UNTITLED_FOLIO_NAME","briefTitleFromFolioName",
    "withFolioTitle","normalizeInterviewAnswers","createProjectBrief","normalizeProjectBrief","escapeHtml",
    "buildStarterDocument","buildImportedMaterialDocument"]),{Date:fixedDate},["createProjectBrief","withFolioTitle","buildStarterDocument","buildImportedMaterialDocument","normalizeProjectBrief","UNTITLED_FOLIO_NAME"]);
  const save = execute(select(briefPath,["saveProjectBriefForFolio"]),{
    normalizeProjectBrief:pure.normalizeProjectBrief,
    loadBriefFromIdb:async(id:string)=>{calls.push({kind:"read-brief",id});return rows.get(id)??null;},
    saveBriefToIdb:async(id:string,brief:unknown)=>{calls.push({kind:"write-brief",id});if(options.fail!=="readback")rows.set(id,structuredClone(brief));},
    archiveBriefEdition:async(id:string)=>{calls.push({kind:"archive",id});},
    saveProjectBrief:()=>{calls.push({kind:"legacy-mirror"});},
    writeFileAsJson:async(path:string)=>{calls.push({kind:"file-mirror",path});if(options.fail==="mirror")throw Error("synthetic mirror failure");},
    markSyncDirty:()=>{calls.push({kind:"mark-sync"});},
  },["saveProjectBriefForFolio"]).saveProjectBriefForFolio;
  const store:any = {brief:structuredClone(existingBrief),folioId:options.missingScope?null:"folio-a",folioName:"The notebook",draftScope:"create:folio-a",briefEditions:[],filingState:"idle"};
  const filingState={value:"idle"},briefDone={value:false};
  const wait = execute(select("src/utils/dossier-filing.ts",["DOSSIER_FILED_FEEDBACK_MS","waitForDossierFiledFeedback"]),{
    setTimeout:(done:()=>void,ms:number)=>{calls.push({kind:"feedback",ms});if(options.holdFeedback)void feedback.promise.then(done);else done();},
  },["waitForDossierFiledFeedback"]).waitForDossierFiledFeedback;
  const bindings:any={...pure,store,filingState,briefDone,$:(callback:unknown)=>callback,Date:fixedDate,
    saveProjectBriefForFolio:save,loadBriefEditions:async(id:string)=>{calls.push({kind:"load-editions",id});return [];},
    captureProductEvent:async()=>{},waitForDossierFiledFeedback:wait,
    nav:async(path:string)=>{calls.push({kind:"navigate",path});},
    loadFolioContentFromIdb:async(id:string)=>{calls.push({kind:"read-content",id});return options.empty?"":"Authored manuscript preserved";},
    saveFolioContentToIdb:async(id:string,html:string)=>{calls.push({kind:"write-content",id,html});},
    saveActiveFolioIdToIdb:async(id:string)=>{calls.push({kind:"active-folio",id});},
    markDirty:()=>{calls.push({kind:"mark-dirty"});},sessionStorage:{},auth:{value:{user:null}},
    clearBriefFormDraft:(_storage:unknown,scope:string,owner:unknown)=>{calls.push({kind:"clear-recovery",scope,owner});},
  };
  if(options.mode==="create" && options.missingScope) throw Error("New-folio identity is outside this scoped host corpus");
  const route=options.mode==="create"?"src/routes/dossier/create/index.tsx":"src/routes/dossier/refine/index.tsx";
  const name=options.mode==="create"?"completeOnboarding$":"onConversationComplete";
  const submit=execute(select(route,[name]),bindings,[name])[name];
  return {store,filingState,briefDone,calls,rows,feedback,submit:async(payload:any)=>{
    if(options.mode==="create")return submit(payload.answers,undefined,undefined,payload.attachments,payload.probes);
    return submit(payload);
  }};
}
