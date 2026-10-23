import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createEvalClient, evalConfiguration } from "./llm-client";

const { privateKey } = generateKeyPairSync("ed25519");
const env = {
  NOTORGANIC_ENABLED: "true",
  NOTORGANIC_ASSERTION_PRIVATE_KEY: privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString(),
  NOTORGANIC_ASSERTION_KEY_ID: "eval-test",
  NOTORGANIC_ISSUER: "https://gateway.example",
  TWYNE_EVAL_DID: "did:plc:funded-eval-account",
  TWYNE_EVAL_MAX_COST_MICROUSD: "100000",
};
const decode = (s: string) =>
  JSON.parse(Buffer.from(s, "base64url").toString());
const body = {
  model: "balanced",
  messages: [{ role: "user", content: "Fixture prompt" }],
};
const accessToken = `header.${Buffer.from(JSON.stringify({ max_cost_microusd: 50000 })).toString("base64url")}.signature`;
const reply = () =>
  Response.json({ choices: [{ message: { content: "Fixture result" } }] });

describe("hosted eval authorization and metering", () => {
  test("requires explicit funding account, per-call ceiling, signing config and HTTPS before network", async () => {
    let calls = 0;
    const mockFetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      calls++;
      return reply();
    }) as typeof fetch;
    for (const patch of [
      { TWYNE_EVAL_DID: undefined },
      { TWYNE_EVAL_DID: "invalid" },
      { TWYNE_EVAL_MAX_COST_MICROUSD: undefined },
      { TWYNE_EVAL_MAX_COST_MICROUSD: "0" },
      { NOTORGANIC_ASSERTION_PRIVATE_KEY: undefined },
      { NOTORGANIC_ENABLED: "false" },
      { NOTORGANIC_ISSUER: "http://gateway.example" },
    ]) {
      await expect(
        createEvalClient({ ...env, ...patch }, mockFetch)(
          body,
          AbortSignal.timeout(1000),
        ),
      ).rejects.toThrow();
    }
    expect(calls).toBe(0);
    expect(evalConfiguration(env).did).toBe(env.TWYNE_EVAL_DID);
  });

  test("exchanges a scoped assertion, sends signed DPoP and budget, and preserves retry identity", async () => {
    let exchanges = 0;
    const requests: Request[] = [];
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/v1/auth/token/exchange")) {
        exchanges++;
        const exchange = (await request.json()) as {
          assertion: string;
          dpop_jwk: JsonWebKey;
        };
        const claims = decode(exchange.assertion.split(".")[1]!);
        expect(claims).toMatchObject({
          sub: env.TWYNE_EVAL_DID,
          iss: "twyne",
          aud: "notorganic",
          capabilities: ["infer:balanced"],
          feature: "offline-eval",
        });
        expect(exchange.dpop_jwk.kty).toBe("EC");
        return Response.json({ access_token: accessToken });
      }
      requests.push(request.clone());
      return requests.length === 1
        ? new Response(null, { status: 503 })
        : reply();
    }) as typeof fetch;
    const complete = createEvalClient(env, mockFetch);
    expect(await complete(body, AbortSignal.timeout(10000))).toBe(
      "Fixture result",
    );
    expect(exchanges).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers.get("idempotency-key")).toBe(
      requests[1]!.headers.get("idempotency-key"),
    );
    expect(requests[0]!.headers.get("dpop")).not.toBe(
      requests[1]!.headers.get("dpop"),
    );
    for (const request of requests) {
      expect(request.url).toBe("https://gateway.example/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe(`DPoP ${accessToken}`);
      expect(request.headers.get("x-notorganic-max-cost-microusd")).toBe(
        "50000",
      );
      expect(request.headers.get("x-notorganic-product")).toBe("twyne");
      expect(request.headers.get("x-notorganic-feature")).toBe("offline-eval");
      expect(request.headers.has("x-twyne-generation-request-id")).toBe(false);
      const [header, payload, signature] = request.headers
        .get("dpop")!
        .split(".");
      expect(decode(payload!)).toMatchObject({ htu: request.url, htm: "POST" });
      const key = await crypto.subtle.importKey(
        "jwk",
        decode(header!).jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      expect(
        await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          Buffer.from(signature!, "base64url"),
          new TextEncoder().encode(`${header}.${payload}`),
        ),
      ).toBe(true);
      expect(await request.json()).toMatchObject({
        model: "balanced",
        stream: false,
      });
    }
    await complete(body, AbortSignal.timeout(10000));
    expect(requests[2]!.headers.get("idempotency-key")).not.toBe(
      requests[1]!.headers.get("idempotency-key"),
    );
  });

  test("does not dispatch concrete upstream model names or fall back after denial", async () => {
    let calls = 0;
    const fetchDenied = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls++;
      const request = new Request(input, init);
      if (request.url.endsWith("/exchange"))
        return Response.json({ access_token: accessToken });
      return new Response("sensitive upstream detail", { status: 403 });
    }) as typeof fetch;
    const complete = createEvalClient(env, fetchDenied);
    await expect(
      complete(
        { ...body, model: "upstream/private-model" },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("alias");
    expect(calls).toBe(0);
    await expect(complete(body, AbortSignal.timeout(1000))).rejects.toThrow(
      "Not Organic chat failed (403)",
    );
    expect(calls).toBe(2);
  });

  test("honors already-aborted calls without requesting a token", async () => {
    let calls = 0;
    const mockFetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      calls++;
      return reply();
    }) as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(
      createEvalClient(env, mockFetch)(body, controller.signal),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
