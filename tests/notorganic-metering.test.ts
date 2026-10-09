import { describe, expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  createDpopKeyPair,
  NOTORGANIC_GENERATION_ID_HEADER,
  notOrganicGenerationBudgetMicrousd,
  notOrganicGenerationRequestHeaders,
  notOrganicOpenAiRoute,
} from "../convex/lib/notorganic";

const fixtureBudget = 50_000; // Synthetic fixture; no production allowance.
const completion = {
  id: "fixture-completion",
  object: "chat.completion",
  created: 0,
  model: "balanced",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: "Synthetic note." },
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};
function jwt(ceiling: unknown) {
  return `fixture.${Buffer.from(JSON.stringify({ max_cost_microusd: ceiling })).toString("base64url")}.fixture`;
}
async function fixture(
  fetcher: typeof fetch,
  options: {
    ceiling?: unknown;
    budget?: number;
    alias?: "balanced" | "reasoning";
  } = {},
) {
  return notOrganicOpenAiRoute(
    {
      accessToken:
        options.ceiling === undefined
          ? "synthetic-token"
          : jwt(options.ceiling),
      dpop: await createDpopKeyPair(),
    },
    options.alias ?? "balanced",
    "persona-feedback",
    "https://gateway.synthetic.invalid",
    fetcher,
    { maxCostMicrousd: options.budget ?? fixtureBudget },
  );
}
function request(body: string, id?: string, signal?: AbortSignal) {
  return new Request("https://gateway.synthetic.invalid/v1/chat/completions", {
    method: "POST",
    signal,
    body,
    headers: {
      "content-type": "application/json",
      ...(id ? { [NOTORGANIC_GENERATION_ID_HEADER]: id } : {}),
    },
  });
}

describe("hosted metering contract", () => {
  test("requires an explicit positive safe integer in micro-USD", () => {
    for (const value of [
      undefined,
      null,
      "",
      "0",
      0,
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "50000.0",
      "5e4",
      "050000",
      " 50000",
      true,
    ]) {
      expect(() => notOrganicGenerationBudgetMicrousd(value)).toThrow(
        "explicit positive safe-integer",
      );
    }
    expect(notOrganicGenerationBudgetMicrousd("50000")).toBe(fixtureBudget);
    expect(notOrganicGenerationBudgetMicrousd(1)).toBe(1);
  });

  test("token ceiling tightens, never raises, configured request budget", async () => {
    for (const ceiling of [10_000, 500_000]) {
      let seen: Request | undefined;
      const route = await fixture(
        (async (input) => {
          seen = input as Request;
          return Response.json(completion);
        }) as typeof fetch,
        { ceiling },
      );
      await route.fetch(request('{"model":"balanced"}', "generation-a"));
      expect(seen!.headers.get("x-notorganic-max-cost-microusd")).toBe(
        String(Math.min(ceiling, fixtureBudget)),
      );
    }
    for (const ceiling of [
      0,
      -1,
      0.5,
      "50000",
      Number.MAX_SAFE_INTEGER + 1,
      null,
    ]) {
      await expect(
        fixture(
          (async () => {
            throw new Error("must not dispatch");
          }) as typeof fetch,
          { ceiling },
        ),
      ).rejects.toThrow("no valid request-budget ceiling");
    }
  });

  test("approved $10 outer ceiling respects existing alias and token authorization", async () => {
    expect(notOrganicGenerationBudgetMicrousd("10000000")).toBe(10_000_000);
    for (const [alias, ceiling, expected] of [
      ["balanced", Number.MAX_SAFE_INTEGER, 500_000],
      ["reasoning", Number.MAX_SAFE_INTEGER, 2_000_000],
      ["reasoning", 100_000, 100_000],
    ] as const) {
      let seen: Request | undefined;
      const route = await fixture(
        (async (input) => {
          seen = input as Request;
          return Response.json(completion);
        }) as typeof fetch,
        { alias, ceiling, budget: 10_000_000 },
      );
      const input = request('{"model":"balanced"}', "approved-generation");
      input.headers.set("x-notorganic-max-cost-microusd", "999999999");
      await route.fetch(input);
      expect(seen!.headers.get("x-notorganic-max-cost-microusd")).toBe(
        String(expected),
      );
    }
  });

  test("concurrent retries preserve key while tool steps, personas and logical calls separate", async () => {
    const requests: Request[] = [];
    const route = await fixture((async (input) => {
      requests.push(input as Request);
      return Response.json(completion, {
        headers: {
          "fixture-idempotency": (input as Request).headers.get(
            "idempotency-key",
          )!,
        },
      });
    }) as typeof fetch);
    const responses = await Promise.all([
      route.fetch(
        request('{"model":"balanced","messages":[]}', "generation-a"),
      ),
      route.fetch(
        request('{"model":"balanced","messages":[]}', "generation-a"),
      ),
      route.fetch(
        request(
          '{"model":"balanced","messages":[{"role":"tool","content":"fixture"}]}',
          "generation-a",
        ),
      ),
      route.fetch(
        request('{"model":"balanced","messages":[]}', "generation-b"),
      ),
    ]);
    const keys = responses.map((r) => r.headers.get("fixture-idempotency"));
    expect(keys[0]).toBe(keys[1]);
    expect(new Set([keys[0], keys[2], keys[3]]).size).toBe(3);
    for (const r of requests) {
      expect(r.headers.has(NOTORGANIC_GENERATION_ID_HEADER)).toBe(false);
      expect(r.headers.get("x-notorganic-max-cost-microusd")).toBe("50000");
      expect(r.headers.get("authorization")).toBe("DPoP synthetic-token");
      expect(r.headers.get("dpop")).toBeTruthy();
      expect(r.headers.get("idempotency-key")!.length).toBeLessThan(255);
    }
    expect(requests[0]!.headers.get("dpop")).not.toBe(
      requests[1]!.headers.get("dpop"),
    );
    const another = await fixture((async (input) => {
      requests.push(input as Request);
      return Response.json(completion);
    }) as typeof fetch);
    await route.fetch(request("same-body"));
    await another.fetch(request("same-body"));
    expect(requests.at(-1)!.headers.get("idempotency-key")).not.toBe(
      requests.at(-2)!.headers.get("idempotency-key"),
    );
  });

  test("cancellation before or during preparation never dispatches and does not poison retry", async () => {
    let calls = 0;
    const route = await fixture((async () => {
      calls++;
      return Response.json(completion);
    }) as typeof fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      route.fetch(request("fixture", "generation-a", controller.signal)),
    ).rejects.toThrow();
    const during = new AbortController();
    const pending = route.fetch(
      request("fixture", "generation-a", during.signal),
    );
    during.abort();
    await expect(pending).rejects.toThrow();
    expect(calls).toBe(0);
    await route.fetch(request("fixture", "generation-a"));
    expect(calls).toBe(1);
  });

  test("SDK HTTP retry keeps metering identity and fresh DPoP", async () => {
    const requests: Request[] = [];
    const route = await fixture((async (input) => {
      const r = input as Request;
      requests.push(r);
      expect(r.headers.get("idempotency-key")).toBeTruthy();
      expect(r.headers.get("x-notorganic-max-cost-microusd")).toBe("50000");
      return requests.length === 1
        ? Response.json(
            { error: { message: "Synthetic retry", type: "server_error" } },
            { status: 503 },
          )
        : Response.json(completion);
    }) as typeof fetch);
    const provider = createOpenAI({
      baseURL: route.baseURL,
      apiKey: route.apiKey,
      headers: route.headers,
      fetch: route.fetch,
    });
    const result = await generateText({
      model: provider.chat(route.model),
      prompt: "Synthetic fixture.",
      headers: { [NOTORGANIC_GENERATION_ID_HEADER]: "sdk-generation" },
      maxRetries: 1,
    });
    expect(result.text).toBe("Synthetic note.");
    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers.get("idempotency-key")).toBe(
      requests[1]!.headers.get("idempotency-key"),
    );
    expect(requests[0]!.headers.get("dpop")).not.toBe(
      requests[1]!.headers.get("dpop"),
    );
  });

  test("SDK tool steps and subsequent same-prompt calls have distinct keys", async () => {
    const requests: Request[] = [];
    const route = await fixture((async (input) => {
      requests.push(input as Request);
      return requests.length === 1
        ? Response.json({
            ...completion,
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "fixture-tool",
                      type: "function",
                      function: { name: "read", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          })
        : Response.json(completion);
    }) as typeof fetch);
    const provider = createOpenAI({
      baseURL: route.baseURL,
      apiKey: route.apiKey,
      headers: route.headers,
      fetch: route.fetch,
    });
    const generation = {
      model: provider.chat(route.model),
      prompt: "Synthetic fixture.",
      tools: {
        read: tool({
          inputSchema: z.object({}),
          execute: async () => "Synthetic excerpt.",
        }),
      },
      stopWhen: stepCountIs(2),
      maxRetries: 0,
    };
    await generateText({
      ...generation,
      headers: notOrganicGenerationRequestHeaders(),
    });
    await generateText({
      ...generation,
      headers: notOrganicGenerationRequestHeaders(),
    });
    expect(requests).toHaveLength(3);
    expect(
      new Set(requests.map((r) => r.headers.get("idempotency-key"))).size,
    ).toBe(3);
  });
});
