import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { extract, isAvailable } from "./extraction";
import * as notorganic from "./lib/notorganic";
import * as entitlement from "./lib/entitlement";
import * as limits from "./lib/rateLimit";
import type {
  ExtractionRequest,
  ExtractionResult,
} from "../src/utils/extraction";
import contract from "../src/utils/extraction-contract-v1.json";

const cleanup: Array<() => void> = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((off) => off()),
);
function env(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    cleanup.push(() => {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    });
  }
}
const request: ExtractionRequest = {
  state: "Ada arrived.",
  fields: { name: { type: "text" } },
};
const body = {
  model: "extraction-clairic/clairic",
  truncated: false,
  answers: { name: { type: "text", value: "Ada", span: [0, 3] } },
  usage: { input_tokens: 10, output_tokens: 0 },
};
function fixture() {
  const enabled = spyOn(notorganic, "notOrganicEnabled").mockReturnValue(true);
  const token = spyOn(
    notorganic,
    "issueNotOrganicAccessToken",
  ).mockResolvedValue({
    accessToken: "test",
    dpop: {} as notorganic.DpopKeyPair,
  });
  const upstream = spyOn(notorganic, "providerJsonRequest").mockResolvedValue(
    body,
  );
  const pro = spyOn(entitlement, "userIsPro").mockResolvedValue(false);
  const limit = spyOn(limits, "consumeRateLimit").mockResolvedValue(undefined);
  const direct = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected direct call"),
  );
  for (const spy of [enabled, token, upstream, pro, limit, direct])
    cleanup.push(() => spy.mockRestore());
  let identity: { subject: string; tokenIdentifier: string } | null = {
    subject: "writer",
    tokenIdentifier: "issuer|writer",
  };
  let linked = true;
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    runQuery: async () =>
      linked ? { did: "did:plc:writer", sessionVersion: 2 } : null,
  };
  return {
    enabled,
    token,
    upstream,
    pro,
    limit,
    direct,
    signedOut: () => {
      identity = null;
    },
    unlinked: () => {
      linked = false;
    },
    run: (input = request) =>
      (
        extract as unknown as {
          _handler: (
            ctx: unknown,
            args: ExtractionRequest,
          ) => Promise<ExtractionResult>;
        }
      )._handler(ctx, input),
    available: () =>
      (
        isAvailable as unknown as {
          _handler: () => Promise<{ available: boolean; transport: string }>;
        }
      )._handler(),
  };
}

describe("Clairic action boundaries", () => {
  test("signed-out callers never reach token exchange, tier lookup or provider", async () => {
    const f = fixture();
    f.signedOut();
    expect(await f.run()).toMatchObject({ ok: false, error: "signed out" });
    expect(f.pro).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
    expect(f.upstream).not.toHaveBeenCalled();
  });
  test("unlinked callers never reach extraction provider", async () => {
    const f = fixture();
    f.unlinked();
    expect(await f.run()).toMatchObject({
      ok: false,
      error: "account not linked",
    });
    expect(f.token).not.toHaveBeenCalled();
    expect(f.upstream).not.toHaveBeenCalled();
  });
  test("linked writer uses the account capability and receives validated values", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({
      ok: true,
      transport: "notorganic",
      answers: body.answers,
    });
    expect(f.token).toHaveBeenCalledWith({
      did: "did:plc:writer",
      sessionVersion: 2,
      feature: "extraction",
      capabilities: ["extraction:run"],
    });
    expect(f.direct).not.toHaveBeenCalled();
  });
  test("rate limit refusal is returned without provider dispatch", async () => {
    const f = fixture();
    f.limit.mockRejectedValue(new limits.RateLimitError("private", 1000));
    expect(await f.run()).toMatchObject({ ok: false, error: "rate limited" });
    expect(f.upstream).not.toHaveBeenCalled();
  });
  test("unrelated exceptions do not become rate limits or echo the draft", async () => {
    const f = fixture();
    f.pro.mockRejectedValue(new Error(request.state));
    expect(await f.run()).toEqual({
      ok: false,
      transport: "notorganic",
      error: "provider",
    });
  });
  test("upstream authorization denial stays an authorization failure", async () => {
    const f = fixture();
    f.upstream.mockRejectedValue(
      new Error(`Not Organic API failed (403): ${request.state}`),
    );
    expect(await f.run()).toEqual({
      ok: false,
      transport: "notorganic",
      error: "unauthorized",
    });
  });
  for (const example of contract.cases.filter(
    (example) =>
      !example.valid && example.name !== "ambiguous repeated unicode source",
  )) {
    test(`rejects malformed hosted response: ${example.name}`, async () => {
      const f = fixture();
      f.upstream.mockResolvedValue({ ...body, answers: example.answers });
      expect(await f.run(example.request as ExtractionRequest)).toMatchObject({
        ok: false,
        error: "provider",
      });
    });
  }
  test("rejects negative and non-finite usage instead of returning it to Convex", async () => {
    for (const n of [-1, Infinity, NaN]) {
      const f = fixture();
      f.upstream.mockResolvedValue({
        ...body,
        usage: { input_tokens: n, output_tokens: 0 },
      });
      expect(await f.run()).toMatchObject({ ok: false, error: "provider" });
    }
  });
  // Each case overrides one variable of the otherwise-permitted local setup.
  const refusals: Array<[string, Record<string, string | undefined>]> = [
    ["production", { NODE_ENV: "production" }],
    ["unset environment", { NODE_ENV: undefined }],
    [
      "hosted development",
      { CONVEX_CLOUD_URL: "https://example.convex.cloud" },
    ],
    ["no explicit opt in", { TWYNE_ALLOW_DIRECT_EXTRACTION: undefined }],
  ];
  for (const [label, overrides] of refusals) {
    test(`refuses direct credentials in ${label}`, async () => {
      const f = fixture();
      f.enabled.mockReturnValue(false);
      env({
        NODE_ENV: "development",
        TWYNE_ALLOW_DIRECT_EXTRACTION: "1",
        CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
        CLOUDFLARE_AI_API_TOKEN: "fixture",
        CLOUDFLARE_ACCOUNT_ID: "fixture",
        ...overrides,
      });
      expect(await f.available()).toEqual({
        available: false,
        transport: "none",
      });
      expect(await f.run()).toMatchObject({ ok: false, error: "unconfigured" });
      expect(f.direct).not.toHaveBeenCalled();
      expect(f.upstream).not.toHaveBeenCalled();
    });
  }
  test("explicit local development permits direct extraction, still validates responses", async () => {
    const f = fixture();
    f.enabled.mockReturnValue(false);
    env({
      NODE_ENV: "development",
      TWYNE_ALLOW_DIRECT_EXTRACTION: "1",
      CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
      CLOUDFLARE_AI_API_TOKEN: "fixture",
      CLOUDFLARE_ACCOUNT_ID: "fixture",
    });
    f.direct.mockResolvedValue(
      Response.json({ result: { ...body, model: "clairic" } }),
    );
    expect(await f.available()).toEqual({
      available: true,
      transport: "direct",
    });
    expect(await f.run()).toMatchObject({ ok: true, transport: "direct" });
    f.direct.mockResolvedValue(
      Response.json({
        result: {
          ...body,
          model: "clairic",
          answers: { name: { type: "text", value: "wrong", span: [0, 3] } },
        },
      }),
    );
    expect(await f.run()).toMatchObject({
      ok: false,
      transport: "direct",
      error: "provider",
    });
  });
});
