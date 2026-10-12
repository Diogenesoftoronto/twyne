import { writeFileSync } from "node:fs";
import { conversation, deferred, settle, snapshot, filing, answers, attachment,
  retainedProbe, existingBrief, question, hashes, briefHistory } from "./source-functions";
import { createAppError } from "../../../../src/utils/application-errors";
import { upsertProbe } from "../../../../src/utils/dossier-probes";

export async function buildVectors() {
  const cases:Array<{name:string;observed:unknown}>=[];
  const add=(name:string,observed:unknown)=>cases.push({name,observed});
  for(const mode of ["first-run","refine"] as const) {
    const api=conversation({mode,initialBrief:mode==="refine"?existingBrief:undefined});
    await api.initialize();await api.initialize();
    add(`opening-${mode}`,{state:snapshot(api),providerCalls:api.calls.length});
  }
  const probe={...retainedProbe,id:"probe-new",answer:"General"};
  {
    const api=conversation({mode:"refine",initialBrief:existingBrief,turns:[{ok:true,value:{...question,draft:{brief:{goal:"A new goal"},confidence:{goal:"high"}},probe}}]});
    await api.initialize();await api.runTurn("The draft changed");
    const questionState=snapshot(api);
    await api.answerProbe(probe);
    add("refine-probe-context",{questionState,answered:snapshot(api),requests:api.calls});
  }
  {
    const error=createAppError("PROVIDER_ERROR",{recovery:{action:"retry",canRetry:true}});
    const api=conversation({turns:[{ok:false,error},{ok:true,value:question}]});
    await api.initialize();api.store.draft="  Writer's retained sentence  ";
    await api.send();const failed=snapshot(api);
    await api.retryTurn();add("failure-retry-no-duplicate-writer",{failed,retried:snapshot(api),requests:api.calls});
  }
  {
    const api=conversation({configured:false});await api.initialize();api.store.draft="Offline answer";
    await api.send();const failed=snapshot(api);api.useForm();
    add("unconfigured-use-form",{failed,formPayload:api.form,providerCalls:api.calls.length});
  }
  {
    const turn=deferred<any>();const api=conversation({turns:[turn.promise]});await api.initialize();
    const pending=api.runTurn("In flight");await settle();api.useForm();
    const before=snapshot(api);turn.resolve({ok:true,value:{...question,text:"Late answer"}});await pending;
    add("late-success-after-form",{before,after:snapshot(api),formPayload:api.form});
  }
  {
    const turn=deferred<any>();const api=conversation({turns:[turn.promise]});await api.initialize();
    const pending=api.runTurn("In flight");await settle();api.useForm();
    const before=snapshot(api);turn.resolve({ok:false,error:createAppError("PROVIDER_ERROR")});await pending;
    // This records a Source weakness rather than treating it as a native goal:
    // BYOK error assignment precedes Source's requestVersion guard.
    add("source-late-error-before-version-guard",{before,after:snapshot(api)});
  }
  {
    const api=conversation({mode:"refine",initialBrief:existingBrief,turns:[{ok:true,value:{kind:"synthesis",brief:{workingTitle:"",format:"Book",audience:"",goal:"",tone:"",constraints:"",successSignal:""},confidence:{format:"high"}}}]});
    await api.initialize();await api.runTurn("A book instead");const synthesized=snapshot(api);
    api.store.editingField="goal";api.store.draft=" Writer's explicit goal ";api.applyEdit("goal");
    await api.acceptSynthesis();add("refine-synthesis-and-filing",{synthesized,edited:snapshot(api),submission:api.complete});
  }
  {
    const api=conversation();await api.initialize();await api.requestSynthesis();
    add("synthesis-nudge-does-not-append-transcript",{state:snapshot(api),requests:api.calls});
  }
  {
    const turn=deferred<any>();const api=conversation({turns:[turn.promise]});await api.initialize();api.store.activeProbe=structuredClone(retainedProbe);
    const pending=api.requestSynthesis();await settle();const state=snapshot(api);
    turn.resolve({ok:true,value:question});await pending;
    add("synthesis-nudge-retains-active-probe",{state,after:snapshot(api),requests:api.calls});
  }
  {
    const api=conversation({mode:"refine",initialBrief:existingBrief,turns:[{ok:true,value:{kind:"synthesis",brief:{...answers,workingTitle:"",tone:" \u00a0 ",goal:""},confidence:{}}}]});
    await api.initialize();await api.runTurn("Reconsider tone");
    add("synthesis-uses-string-truthiness",{state:snapshot(api)});
    api.store.editingField="tone";api.store.draft="\ufeff \u00a0 ";api.applyEdit("tone");
    add("blank-review-edit-is-neutral",{state:snapshot(api),editingField:api.store.editingField});
  }
  {
    const inputs=["\ufeff \u00a0 Writer 東京 \u00a0 \ufeff","\u0085","\ufeff \u00a0 "];
    const rows=[];
    for(const input of inputs){const api=conversation();await api.initialize();api.store.draft=input;await api.send();rows.push({input,state:snapshot(api),requests:api.calls});}
    add("source-send-js-trim",{rows});
  }
  {
    const history=briefHistory();
    await history.archiveBriefEdition("folio-a",existingBrief,{source:"refine"});
    await history.archiveBriefEdition("folio-a",structuredClone(existingBrief),{source:"refine"});
    const duplicate=history.editions;
    const changed={...existingBrief,unknown:{keep:true,edition:"updated metadata"}};
    await history.archiveBriefEdition("folio-a",changed,{source:"refine"});
    add("history-compares-entire-brief",{duplicate,changed:history.editions,calls:history.calls});
  }
  {
    const wait=deferred<void>();const api=conversation({complete:()=>wait.promise});await api.initialize();
    api.store.synthesis={brief:answers,confidence:{}};
    const first=api.acceptSynthesis(),second=api.acceptSynthesis();await settle();
    const pending=snapshot(api);wait.resolve();await Promise.all([first,second]);
    add("source-function-double-submit-relies-on-disabled-button",{pending,completionCalls:api.complete.length,after:snapshot(api)});
  }
  {
    const api=conversation({complete:()=>{throw Error("synthetic durable write failure");}});await api.initialize();
    api.store.synthesis={brief:answers,confidence:{}};await api.acceptSynthesis();
    add("failed-filing-retains-synthesis",{after:snapshot(api),submission:api.complete});
  }
  add("probe-upsert-only-id",{result:upsertProbe([retainedProbe],probe)});
  for(const mode of ["create","refine"] as const) {
    for(const state of ["held-feedback","readback","mirror"] as const) {
      const api=filing({mode,holdFeedback:state==="held-feedback",fail:state==="held-feedback"?undefined:state,empty:mode==="create"});
      const payload={answers,attachments:[attachment],probes:[retainedProbe]};
      const submitted=api.submit(payload).then(()=>({resolved:true}),()=>({resolved:false}));await settle();
      const before={filing:mode==="create"?api.filingState.value:api.store.filingState,briefDone:api.briefDone.value,calls:structuredClone(api.calls)};
      api.feedback.resolve();const result=await submitted;
      add(`route-${mode}-${state}`,{before,result,after:{filing:mode==="create"?api.filingState.value:api.store.filingState,briefDone:api.briefDone.value,calls:api.calls,savedBrief:api.rows.get("folio-a")}});
    }
  }
  {
    const api=filing({mode:"create",empty:false});await api.submit({answers,attachments:[],probes:[]});
    add("create-keeps-existing-manuscript",{calls:api.calls,contentWrites:api.calls.filter(row=>row.kind==="write-content").length});
  }
  {
    const api=filing({mode:"refine",missingScope:true});await api.submit({answers,attachments:[],probes:[]});
    add("source-refine-missing-scope-returns-without-ack",{calls:api.calls,filing:api.store.filingState});
  }
  return {version:1,sourceHashes:hashes(),proof:"Original selected Source callbacks/helpers; fake Qwik, provider replies, IDB/mirrors and clock. No real provider/account/storage/display.",cases};
}
if(import.meta.main)writeFileSync(new URL("./source-vectors.json",import.meta.url),JSON.stringify(await buildVectors(),null,2)+"\n");
