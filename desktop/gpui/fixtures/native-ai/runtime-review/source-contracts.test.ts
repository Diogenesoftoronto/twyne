import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildCorpus } from "./generate-source-vectors";

// This corpus never starts the original lifecycle module or imports provider
// SDKs; fake dependencies execute unchanged selected Source declarations.
globalThis.fetch = () => { throw Error("No network permitted in runtime-review fixtures"); };
describe("native AI reviewed Source boundaries", () => {
  test("retained vectors equal current executed original functions", async () => {
    const retained = JSON.parse(readFileSync(new URL("./source-vectors.json",import.meta.url),"utf8"));
    expect(await buildCorpus()).toEqual(retained);
  });
  test("routing checks modality/defaults without claiming configured keys work", async () => {
    const rows = (await buildCorpus()).routing;
    expect(rows.find(row=>row.name==="voice-eligibility")?.result).toEqual({providerId:"fish",model:"s2-pro",temperature:0.4,maxTokens:null});
    expect(rows.find(row=>row.name==="persona-voice-quirk")?.result?.providerId).toBe("fish");
    expect(rows.find(row=>row.name==="unknown-provider-configured")?.hasAi).toBe(true);
    expect(rows.find(row=>row.name==="voice-only-no-text")?.result).toBeNull();
  });
  test("Source structured parsers preserve named fallback and explicit native limits", async () => {
    const corpus = await buildCorpus();
    expect(corpus.judge.find(row=>row.name==="unrelated-digits")?.result).toBeNull();
    expect(corpus.judge.find(row=>row.name==="unicode-digit")?.result).toBeNull();
    expect(corpus.judge.find(row=>row.name==="numeric-overflow")?.result?.score).toBe(5);
    expect(corpus.research.find(row=>row.name==="wrapper-sort-dedupe")?.result?.map((row:any)=>row.importance)).toEqual([5,5,2]);
    expect(corpus.research.find(row=>row.name==="trailing-array-prose")?.result).toEqual([]);
    expect(corpus.research.find(row=>row.name==="unsupported-surrogate-cut")?.sourceResultJson).toContain("\\ud83d");
    expect(corpus.tagged[0].result?.start).toBe(11); // emoji is two JS units
  });
  test("original lifecycle failure/ready order is observed without real resources", async () => {
    const cases = (await buildCorpus()).lifecycle;
    expect(cases.find(row=>row.name==="disabled")?.calls).toEqual([]);
    expect(cases.find(row=>row.name==="missing")?.calls).toEqual([]);
    expect(cases.find(row=>row.name==="import-failed")?.ready).toBe(false);
    expect(cases.find(row=>row.name==="child-exited")?.kills).toBe(1);
    expect(cases.find(row=>row.name==="timeout")?.kills).toBe(1);
    expect(cases.find(row=>row.name==="registered-ready")?.calls.map(row=>row.stage)).toEqual(["list","serve"]);
    expect(cases.find(row=>row.name==="import-ready")?.calls.map(row=>row.stage)).toEqual(["list","import","serve"]);
    // Source readiness is just TCP and runs before child-exited; not ownership/model proof.
    expect(cases.find(row=>row.name==="tcp-before-exited-check")?.ready).toBe(true);
  });
});
