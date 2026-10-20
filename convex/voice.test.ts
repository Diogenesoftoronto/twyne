import { afterEach, expect, spyOn, test } from "bun:test";
import { synthesizeSpeech } from "./voice";
import * as notorganic from "./lib/notorganic";
import * as entitlement from "./lib/entitlement";
import * as rateLimit from "./lib/rateLimit";

const fixtureDpop = await notorganic.createDpopKeyPair();
const restore: Array<() => void> = [];
afterEach(() => {
  restore
    .splice(0)
    .reverse()
    .forEach((off) => off());
});

function fixture() {
  const requests: Request[] = [];
  let response = new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "audio/mpeg" },
  });
  let identity: { subject: string; tokenIdentifier: string } | null = {
    subject: "fixture-product-user",
    tokenIdentifier: "fixture-issuer|user",
  };
  let link: { did: string; sessionVersion: number } | null = {
    did: "did:plc:fictionalwriter",
    sessionVersion: 4,
  };
  const enabled = spyOn(notorganic, "notOrganicEnabled").mockReturnValue(true);
  const token = spyOn(
    notorganic,
    "issueNotOrganicAccessToken",
  ).mockResolvedValue({
    accessToken: "fixture-token",
    dpop: fixtureDpop,
  });
  const route = spyOn(notorganic, "notOrganicOpenAiRoute").mockReturnValue({
    baseURL: "https://gateway.example.test/v1",
    apiKey: "fixture-token",
    model: "audio",
    headers: {
      "x-notorganic-product": "twyne",
      "x-notorganic-feature": "voice-narration",
    },
    fetch: (async (input, init) => {
      requests.push(new Request(input, init));
      return response.clone();
    }) as typeof fetch,
  });
  const pro = spyOn(entitlement, "userIsPro").mockResolvedValue(false);
  const limit = spyOn(rateLimit, "consumeRateLimit").mockResolvedValue(
    undefined,
  );
  for (const spy of [enabled, token, route, pro, limit])
    restore.push(() => spy.mockRestore());
  const queries: unknown[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    runQuery: async (_ref: unknown, args: unknown) => {
      queries.push(args);
      return link;
    },
  };
  const action = synthesizeSpeech as unknown as {
    _handler: (
      ctx: unknown,
      args: { text: string; voice?: string; model?: string },
    ) => Promise<{
      audioBase64: string;
      provider: string;
      model: string;
      voice: string;
    }>;
  };
  return {
    requests,
    queries,
    token,
    route,
    pro,
    run: (
      args = {
        text: "Read this aloud.",
        voice: "alloy",
        model: "untrusted-upstream-id",
      },
    ) => action._handler(ctx, args),
    signedOut: () => {
      identity = null;
    },
    unlinked: () => {
      link = null;
    },
    reject: () => {
      response = Response.json(
        { error: { message: "Add account credit to continue." } },
        { status: 402 },
      );
    },
    respond: (next: Response) => {
      response = next;
    },
  };
}

test("hosted narration uses the verified linked wallet without requiring Pro", async () => {
  const f = fixture();
  const result = await f.run();
  expect(f.queries).toEqual([{ productSubject: "fixture-product-user" }]);
  expect(f.token).toHaveBeenCalledWith({
    did: "did:plc:fictionalwriter",
    sessionVersion: 4,
    feature: "voice-narration",
    capabilities: ["infer:audio"],
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].url).toBe(
    "https://gateway.example.test/v1/audio/speech",
  );
  expect(await f.requests[0].json()).toEqual({
    model: "audio",
    input: "Read this aloud.",
    voice: "alloy",
    response_format: "mp3",
  });
  expect(result).toMatchObject({
    audioBase64: "AQID",
    provider: "notorganic",
    model: "audio",
    voice: "alloy",
  });
  expect(f.pro).not.toHaveBeenCalled();
});

test("missing identity or verified link cannot spend account credit", async () => {
  const f = fixture();
  f.unlinked();
  await expect(f.run()).rejects.toThrow("Link your Not Organic account");
  f.signedOut();
  await expect(f.run()).rejects.toThrow("Not signed in");
  expect(f.token).not.toHaveBeenCalled();
  expect(f.requests).toHaveLength(0);
});

test("a credit rejection stays visible and never falls back to the legacy paid key", async () => {
  const f = fixture();
  f.reject();
  await expect(f.run()).rejects.toThrow("Add Not Organic wallet credit");
  expect(f.requests).toHaveLength(1);
  expect(f.pro).not.toHaveBeenCalled();
});

test("a rejected hosted route preserves its classification and support reference", async () => {
  const f = fixture();
  f.respond(Response.json({ error: "private upstream body" }, { status: 400 }));
  let failure: any;
  try {
    await f.run();
  } catch (error) {
    failure = error;
  }
  expect(failure.data).toMatchObject({
    code: "configuration_required",
    retryable: false,
  });
  expect(failure.data.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(String(failure)).not.toContain("private upstream body");
  expect(f.requests).toHaveLength(1);
});

test("empty or JSON success responses do not become silent cached audio", async () => {
  const f = fixture();
  for (const response of [
    new Response(null),
    Response.json({ error: "upstream failed" }),
  ]) {
    f.respond(response);
    await expect(f.run()).rejects.toThrow("malformed_response");
  }
});

test("changing the selected hosted voice changes the speech request", async () => {
  const f = fixture();
  for (const voice of ["alloy", "shimmer", "echo", "ash", "onyx"]) {
    const result = await f.run({
      text: "A fictional note.",
      voice,
      model: "ignored-client-model",
    });
    expect((await f.requests.at(-1)!.json()).voice).toBe(voice);
    expect(result.voice).toBe(voice);
  }
});
