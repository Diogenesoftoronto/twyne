import { describe, expect, test } from "bun:test";
import { buildQuoteTools } from "../../convex/agentTools";
import { hostedPersonaResearch } from "../../convex/lib/personaResearch";
import type { ActionCtx } from "../../convex/_generated/server";
import { getFunctionName } from "convex/server";
import {
  validatePersonaFields,
  validatePersonaQuestions,
  personaResearchBudget,
  type PersonaResearch,
} from "./persona-research";
import { selectPassageWindow } from "./passage-window";
import { clientPersonaResearch } from "./persona-research-client";
import type { ConvexClient } from "convex/browser";
import {
  __resetSystemOneBudgetForTests,
  spendSystemOne,
} from "./system-one-budget";

const draft = "Ada was twelve in June.\n\nAda turned thirteen in July.";
async function execute(
  set: ReturnType<typeof buildQuoteTools>,
  name: string,
  args: unknown,
) {
  return (await set.tools[name].execute!(args as never, {
    toolCallId: name,
    messages: [],
  })) as any;
}

describe("persona research tools", () => {
  test("keeps BYOK-only tools unchanged and captures all literal quotes once", async () => {
    const set = buildQuoteTools(draft);
    expect(Object.keys(set.tools)).toEqual(["quote_passage"]);
    await execute(set, "quote_passage", { query: "Ada was twelve in June." });
    await execute(set, "quote_passage", {
      query: "Ada turned thirteen in July.",
    });
    await execute(set, "quote_passage", { query: "Ada was twelve in June." });
    expect(set.getAnchors()).toEqual([
      "Ada was twelve in June.",
      "Ada turned thirteen in July.",
    ]);
    expect(set.getAnchor()).toBe(set.getAnchors()[0]);
  });
  test("copies spans, rejects invalid and cross-paragraph spans, and judges only found evidence", async () => {
    let judged = 0;
    const set = buildQuoteTools(draft, {
      reserve: personaResearchBudget(),
      extract: async () => ({
        ok: true,
        answers: {
          passages: {
            type: "list",
            value: ["invented"],
            spans: [
              [0, 23],
              [25, draft.length],
              [-1, 10],
              [0, draft.length],
            ],
          },
        },
      }),
      judge: async (req) => {
        judged++;
        expect(req.state.passage_1).toBe(draft.slice(0, 23));
        return { ok: true, answers: { same: { noul: 0.92 } } };
      },
    });
    const found = await execute(set, "find_passages", {
      about: "Ada ages",
      max: 8,
    });
    expect(found.passages.map((p: any) => p.passage)).toEqual([
      draft.slice(0, 23),
      draft.slice(25),
    ]);
    expect(set.getAnchors()).toEqual(found.passages.map((p: any) => p.passage));
    const questions = {
      same: { type: "noul", instructions: "Do both mentions describe Ada?" },
    };
    expect(
      (await execute(set, "judge", { passages: ["invented"], questions })).ok,
    ).toBe(false);
    expect(judged).toBe(0);
    expect(
      (await execute(set, "judge", { passages: [set.getAnchor()], questions }))
        .answers.same.noul,
    ).toBe(0.92);
  });
  test("returns near misses without anchoring them, and bounds spend across retries", async () => {
    let calls = 0;
    const research: PersonaResearch = {
      reserve: personaResearchBudget(1),
      extract: async () => {
        calls++;
        return {
          ok: true,
          answers: {
            name: {
              type: "text",
              value: null,
              guess: "retyped",
              span: [0, 3],
              p_null: 0.8,
            },
          },
        };
      },
    };
    const set = buildQuoteTools(draft, research);
    const result = await execute(set, "extract", {
      fields: { name: { type: "text", instructions: "Name of Ada's brother" } },
    });
    expect(result.answers.name).toMatchObject({
      value: null,
      guess: "Ada",
      p_null: 0.8,
    });
    expect(set.getAnchors()).toEqual([]);
    expect(set.getExtractions()[0].answers.name).toMatchObject({
      value: null,
      guess: "Ada",
      source: { passage: "Ada", from: 0, to: 3 },
    });
    await execute(buildQuoteTools(draft, research), "find_passages", {
      about: "Ada",
    });
    expect(calls).toBe(1);
  });
  test("invalid fields and provider errors fail soft", async () => {
    let calls = 0;
    const set = buildQuoteTools(draft, {
      reserve: () => true,
      extract: async () => {
        calls++;
        throw new Error("private provider body");
      },
    });
    expect(
      (await execute(set, "extract", { fields: { bad: { type: "execute" } } }))
        .ok,
    ).toBe(false);
    expect(calls).toBe(0);
    const failure = await execute(set, "find_passages", { about: "Ada" });
    expect(failure.ok).toBe(false);
    expect(JSON.stringify(failure)).not.toContain("private provider body");
  });
});

describe("field and question validation", () => {
  test("clamps forecast and precision and drops unknown attributes", () => {
    expect(
      validatePersonaFields({
        age: {
          type: "number",
          decimals: 90,
          min: -1e20,
          max: 1e20,
          secret: "drop",
        },
        future: {
          type: "forecast",
          min: 1,
          max: 10,
          horizon: 999,
          interval: "year",
          null_threshold: -2,
        },
      }),
    ).toEqual({
      age: { type: "number", decimals: 6, min: -1e9, max: 1e9 },
      future: {
        type: "forecast",
        min: 1,
        max: 10,
        horizon: 24,
        interval: "year",
        null_threshold: 0,
      },
    });
  });
  test("rejects empty, oversized, invalid ranges, units and criteria", () => {
    for (const input of [
      {},
      Object.fromEntries(
        Array.from({ length: 13 }, (_, i) => [`f${i}`, { type: "text" }]),
      ),
      { x: { type: "estimate", min: 4, max: 2 } },
      { x: { type: "number", min: NaN } },
      { x: { type: "duration", unit: "fortnights" } },
      { x: { type: "list", items: "script" } },
      { x: { type: "estimate", min: 0, max: 5, scale: "log" } },
    ])
      expect(() => validatePersonaFields(input)).toThrow();
    expect(() =>
      validatePersonaQuestions({
        x: {
          type: "choice",
          instructions: "Best?",
          criteria: ["same", "same"],
        },
      }),
    ).toThrow();
    expect(() =>
      validatePersonaQuestions({
        x: { type: "unknown", instructions: "Best?" },
      }),
    ).toThrow();
  });
  test("long draft selection is deterministic, bounded, maps source offsets", () => {
    const long =
      "ordinary paragraph.\n\n".repeat(6000) + "Ada's age matters here.";
    const a = selectPassageWindow(long, "Ada age", 96_000);
    const b = selectPassageWindow(long, "Ada age", 96_000);
    expect(a.state).toBe(b.state);
    expect(a.state.length).toBeLessThanOrEqual(96_000);
    expect(a.truncated).toBe(true);
    const at = a.state.indexOf("Ada's age");
    expect(a.resolve([at, at + 3])).toEqual({
      from: long.indexOf("Ada's age"),
      to: long.indexOf("Ada's age") + 3,
      passage: "Ada",
    });
  });
});

describe("research transports", () => {
  test("server uses Convex actions and the same per-note cap", async () => {
    const names: string[] = [];
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "writer" }) },
      runQuery: async () => ({ did: "did:test" }),
      runAction: async (ref: any, req: any) => {
        const name = getFunctionName(ref);
        names.push(name);
        return name.endsWith("isAvailable")
          ? { available: true }
          : {
              ok: true,
              answers: req.fields
                ? { age: { type: "number", value: 12 } }
                : { same: { type: "noul", noul: 0.9 } },
            };
      },
    } as unknown as ActionCtx;
    const research = await hostedPersonaResearch(ctx);
    const set = buildQuoteTools(draft, research);
    const result = await execute(set, "extract", {
      fields: { age: { type: "number", instructions: "Ada's age in June" } },
    });
    expect(result.answers.age.value).toBe(12);
    await execute(set, "quote_passage", { query: "Ada was twelve in June." });
    await execute(set, "judge", {
      passages: set.getAnchors(),
      questions: { same: { type: "noul", instructions: "Is Ada mentioned?" } },
    });
    expect(names).toContain("extraction:extract");
    expect(names).toContain("systemOne:ask");
    expect([
      research.reserve(),
      research.reserve(),
      research.reserve(),
    ]).toEqual([true, true, false]);
  });
  test("client preserves signed-out behavior and uses shared System One budget", async () => {
    __resetSystemOneBudgetForTests();
    expect((await clientPersonaResearch(null)).extract).toBeUndefined();
    const signedOut = { query: async () => null } as unknown as ConvexClient;
    expect(
      (
        await clientPersonaResearch(signedOut, {
          source: "typesafe",
          typesafeKey: "own-typesafe-key",
        })
      ).judge,
    ).toBeUndefined();
    const requests: string[] = [];
    const client = {
      query: async () => ({ did: "did:test" }),
      action: async (ref: any) => {
        const name = getFunctionName(ref);
        requests.push(name);
        return name.endsWith("isAvailable")
          ? { available: true }
          : { ok: true, answers: {} };
      },
    } as unknown as ConvexClient;
    const research = await clientPersonaResearch(client, null);
    expect(research.reserve()).toBe(true);
    await research.extract!({
      state: draft,
      fields: { name: { type: "text" } },
    });
    await research.judge!({
      state: { draft },
      questions: { q: { type: "noul", instructions: "Ada?" } },
    });
    expect(requests).toContain("extraction:extract");
    expect(requests).toContain("systemOne:ask");
    for (let i = 0; i < 12; i++) spendSystemOne();
    expect(research.reserve()).toBe(false);
    __resetSystemOneBudgetForTests();
  });
});
