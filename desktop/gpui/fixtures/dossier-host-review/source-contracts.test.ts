import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildVectors } from "./generate";
globalThis.fetch=()=>{throw Error("No network in Dossier host review");};
async function row(name:string) {
  const rows=(await buildVectors()).cases;
  const found=rows.find(row=>row.name===name);
  if(!found)throw Error(`Missing case ${name}`);
  return found.observed as any;
}
test("retained vectors execute current original Source callbacks and filing helpers",async()=>{
  expect(await buildVectors()).toEqual(JSON.parse(readFileSync(new URL("./source-vectors.json",import.meta.url),"utf8")));
});
test("literal opening/refine context and existing answered probes require no generated turn",async()=>{
  const refine=await row("opening-refine");
  expect(refine.providerCalls).toBe(0);
  expect(refine.state.messages).toHaveLength(1);
  expect(refine.state.answeredProbes[0].id).toBe("probe-prior");
  const probes=await row("refine-probe-context");
  expect(probes.answered.answeredProbes.map((probe:any)=>probe.id)).toEqual(["probe-prior","probe-new"]);
  expect(probes.requests[0].mode).toBe("refine");
  expect(probes.requests[0].currentBrief.probes[0].unknown).toEqual({keep:true});
});
test("failed/unconfigured turns retain writer input and form fallback",async()=>{
  const retry=await row("failure-retry-no-duplicate-writer");
  expect(retry.failed.pendingWriterText).toBe("Writer's retained sentence");
  expect(retry.retried.messages.filter((message:any)=>message.author==="writer")).toHaveLength(1);
  expect(retry.retried.loading).toBe(false);
  const offline=await row("unconfigured-use-form");
  expect(offline.providerCalls).toBe(0);
  expect(offline.failed.error.code).toBe("CONFIGURATION_ERROR");
  expect(offline.formPayload).toHaveLength(1);
});
test("version guards discard late success; Source error/duplicate gaps are recorded accurately",async()=>{
  const late=await row("late-success-after-form");
  expect(late.after.messages).toEqual(late.before.messages);
  expect(late.after.requestVersion).toBe(2);
  const error=await row("source-late-error-before-version-guard");
  expect(error.before.error).toBeNull();
  expect(error.after.error.code).toBe("PROVIDER_ERROR");
  expect((await row("source-function-double-submit-relies-on-disabled-button")).completionCalls).toBe(2);
});
test("filing waits for verified write and feedback; failed writes have no filed acknowledgement",async()=>{
  for(const mode of ["create","refine"]) {
    const held=await row(`route-${mode}-held-feedback`);
    expect(held.before.calls.some((call:any)=>call.kind==="file-mirror")).toBe(true);
    expect(held.before.filing).toBe("filed");
    expect(held.before.calls.find((call:any)=>call.kind==="feedback").ms).toBe(780);
    expect(held.before.calls.some((call:any)=>call.kind==="navigate"||call.kind==="clear-recovery")).toBe(false);
    expect(held.result.resolved).toBe(true);
    const failed=await row(`route-${mode}-readback`);
    expect(failed.result.resolved).toBe(false);
    expect(failed.after.filing).toBe("idle");
    expect(failed.after.calls.some((call:any)=>call.kind==="feedback"||call.kind==="navigate"||call.kind==="clear-recovery")).toBe(false);
  }
  expect((await row("create-keeps-existing-manuscript")).contentWrites).toBe(0);
  expect((await row("source-refine-missing-scope-returns-without-ack")).calls).toEqual([]);
});
test("refinement carries probes/previous completion and preserves failure review",async()=>{
  const synth=await row("refine-synthesis-and-filing");
  expect(synth.synthesized.synthesis.brief.workingTitle).toBe("The notebook");
  expect(synth.submission[0].probes[0].id).toBe("probe-prior");
  expect(synth.submission[0].answers.goal).toBe("Writer's explicit goal");
  expect(synth.edited.synthesis.confidence.goal).toBe("high");
  const filed=await row("route-refine-held-feedback");
  expect(filed.after.savedBrief.completedAt).toBe(100);
  expect(filed.after.savedBrief.updatedAt).toBe(1000);
  const failure=await row("failed-filing-retains-synthesis");
  expect(failure.after.synthesis).not.toBeNull();
  expect(failure.after.filing).toBe(false);
});
test("Source synthesis keeps probe identity, string truthiness and nonempty edit guards",async()=>{
  expect((await row("synthesis-nudge-retains-active-probe")).state.activeProbe.id).toBe("probe-prior");
  const truth=await row("synthesis-uses-string-truthiness");
  expect(truth.state.synthesis.brief.workingTitle).toBe("The notebook");
  expect(truth.state.synthesis.brief.tone).toBe(" \u00a0 ");
  const blank=await row("blank-review-edit-is-neutral");
  expect(blank.state.synthesis).toEqual(truth.state.synthesis);
  expect(blank.editingField).toBe("tone");
  const trim=(await row("source-send-js-trim")).rows;
  expect(trim[0].state.messages[1].text).toBe("Writer 東京");
  expect(trim[1].state.messages[1].text).toBe("\u0085");
  expect(trim[2].requests).toHaveLength(0);
});
test("Source edition deduplication compares retained fields beyond answers",async()=>{
  const history=await row("history-compares-entire-brief");
  expect(history.duplicate).toHaveLength(1);
  expect(history.changed).toHaveLength(2);
  expect(history.changed[0].brief.unknown.edition).toBe("updated metadata");
  expect(history.calls.filter((call:any)=>call.kind==="write")).toHaveLength(2);
});
