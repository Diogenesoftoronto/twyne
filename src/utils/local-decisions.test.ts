import { afterEach, expect, test } from "bun:test";
import {
  LOCAL_DECISION_MODEL,
  LOCAL_DECISION_URL,
  localDecisionStatus,
} from "./local-decisions";

// Other suites stub the judgement client process-wide. Load the real module
// under a test-only URL so these transport assertions exercise production code.
const moduleUrl = "./judgement-client.ts?local-decision-contract";
const { askJudgement, describeJudgement } = (await import(
  moduleUrl
)) as typeof import("./judgement-client");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const local = {
  source: "endpoint" as const,
  endpointUrl: LOCAL_DECISION_URL,
  endpointModel: LOCAL_DECISION_MODEL,
};
const request = {
  state: { passage: "Synthetic test state" },
  questions: {
    check: { type: "noul" as const, instructions: "Is this a test?" },
    pick: {
      type: "choice" as const,
      instructions: "Which?",
      criteria: ["first", "second"],
    },
    rate: {
      type: "score" as const,
      instructions: "How much?",
      criteria: ["low", "high"],
    },
  },
};

test("local decisions work without a Convex client and preserve all three answer types", async () => {
  let calls = 0;
  globalThis.fetch = (async (url: RequestInfo | URL, options?: RequestInit) => {
    calls++;
    expect(String(url)).toBe(`${LOCAL_DECISION_URL}/v1/systemone`);
    const body = JSON.parse(options!.body as string);
    expect(body.model).toBe(LOCAL_DECISION_MODEL);
    expect(body.questions.pick.criteria).toEqual({ first: null, second: null });
    return Response.json({
      model: LOCAL_DECISION_MODEL,
      answers: {
        check: { type: "noul", noul: 0.8 },
        pick: {
          type: "choice",
          choice: "first",
          confidence: 0.6,
          probabilities: { first: 0.8, second: 0.2 },
        },
        rate: {
          type: "score",
          score: 1,
          confidence: 0.6,
          probabilities: { "0": 0.2, "1": 0.8 },
          legend: { "0": "low", "1": "high" },
        },
      },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
  }) as unknown as typeof fetch;
  const result = await askJudgement(
    null,
    { ...request, model: "jev-latest" },
    local,
  );
  expect(result.ok).toBe(true);
  expect(result.transport).toBe("endpoint");
  expect(calls).toBe(1);
  expect(describeJudgement(local)).toBe("Liquid d1-2B, on this computer");
});

test("local failure never calls hosted judgement or retries elsewhere", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  const result = await askJudgement(null, request, local);
  expect(result.ok).toBe(false);
  expect(result.error).toBe("network");
  expect(calls).toEqual([`${LOCAL_DECISION_URL}/v1/systemone`]);
});

test("a malformed local answer fails instead of inventing probabilities", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      model: LOCAL_DECISION_MODEL,
      answers: {},
    })) as unknown as typeof fetch;
  expect((await askJudgement(null, request, local)).error).toBe("provider");
});

test("download is explicit and insufficient-space errors reach settings", async () => {
  const methods: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, options?: RequestInit) => {
    methods.push(options?.method ?? "GET");
    if (String(url).endsWith("/download"))
      return Response.json({ error: "Free at least 10 GB" }, { status: 422 });
    return Response.json({
      model: LOCAL_DECISION_MODEL,
      phase: "not_downloaded",
    });
  }) as unknown as typeof fetch;
  await localDecisionStatus();
  expect(methods).toEqual(["GET"]);
  await expect(localDecisionStatus(true)).rejects.toThrow("10 GB");
  expect(methods).toEqual(["GET", "POST"]);
});
