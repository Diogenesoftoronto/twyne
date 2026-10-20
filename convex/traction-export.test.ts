/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  exportConfig,
  sendExport,
  signExport,
  summarizeTraction,
  TRACTION_ROW_LIMIT,
  type TractionExport,
} from "./traction";
import type { Doc } from "./_generated/dataModel";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;
const read = makeFunctionReference<
  "query",
  { date: string; revision: number; now: number },
  { payload: TractionExport; truncated: boolean }
>("traction:dailyEvidence");
const prepare = makeFunctionReference<
  "mutation",
  { date: string; revision: number },
  { body: string; truncated: boolean }
>("traction:prepareExport");
const run = makeFunctionReference<"action">("traction:exportDay");
const now = Date.parse("2026-10-19T04:20:00Z"),
  day = "2026-10-18",
  start = Date.parse(`${day}T00:00:00Z`),
  DAY = 86_400_000;
const secret = "fixture-signing-secret-32-characters";
const configEnv = {
  TRACTION_EXPORT_ENABLED: "true",
  NOTORGANIC_TRACTION_ORIGIN: "https://gateway.example.test",
  NOTORGANIC_TRACTION_SERVICE_ID: "twyne-product",
  NOTORGANIC_TRACTION_EXPORT_SECRET: secret,
};
const metric = (payload: TractionExport, id: string) =>
  payload.metrics.find((row) => row.id === id)!;
type Usage = Omit<Doc<"aiUsageEvents">, "_id" | "_creationTime">;
const event = (overrides: Partial<Usage> = {}): Usage => ({
  ownerId: "private-owner-a",
  eventKey: "private-event-a",
  occurredAt: start + 1,
  day,
  source: "hosted",
  authority: "provider",
  feature: "persona-feedback",
  provider: "provider",
  model: "private-model",
  folioId: "private-folio",
  editorialActionId: "private-action",
  traceId: "private-trace",
  attempt: 1,
  outcome: "completed",
  inputTokens: 12,
  outputTokens: 3,
  costKind: "actual",
  costMicrousd: 15,
  ...overrides,
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describeConvex("Twyne Traction exports", () => {
  test("empty or unavailable ingestion remains unknown, and authority never merges into an app-wide count", () => {
    const empty = summarizeTraction(day, 1, [], []);
    expect(empty.complete).toBe(false);
    expect(empty.metrics.every((row) => row.value === null)).toBe(true);
    const result = summarizeTraction(
      day,
      1,
      [
        event(),
        event(),
        event({ eventKey: "two", costKind: "estimated", costMicrousd: 8 }),
        event({
          ownerId: "private-owner-b",
          authority: "client_reported",
          source: "byok",
          eventKey: "three",
          outcome: "failed",
          costKind: "unknown",
          costMicrousd: undefined,
        }),
      ],
      [
        { userId: "private-owner-a", count: 4 },
        { userId: "private-owner-b", count: 2 },
      ],
    );
    expect(metric(result, "provider_ai_attempts").value).toBe(2);
    expect(metric(result, "provider_editorial_actions")).toMatchObject({
      value: 1,
      aggregation: "distinct",
      authority: "provider",
    });
    expect(metric(result, "provider_actual_cost_microusd")).toMatchObject({
      value: 15,
      authority: "provider",
    });
    expect(metric(result, "provider_estimated_cost_microusd")).toMatchObject({
      value: 8,
      authority: "estimated",
    });
    expect(metric(result, "client_reported_ai_failures")).toMatchObject({
      value: 1,
      authority: "client_reported",
    });
    expect(metric(result, "accounts_reporting_writing")).toMatchObject({
      value: 2,
      aggregation: "distinct",
      authority: "client_reported",
    });
    expect(metric(result, "reported_writing_autosaves").value).toBe(6);
    expect(JSON.stringify(result)).not.toMatch(
      /private-|ownerId|eventKey|folioId|traceId/,
    );
  });

  test("time index selects exactly one complete UTC day and day index selects only matching writing rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("aiUsageEvents", event({ occurredAt: start }));
      await ctx.db.insert(
        "aiUsageEvents",
        event({ eventKey: "before", occurredAt: start - 1 }),
      );
      await ctx.db.insert(
        "aiUsageEvents",
        event({ eventKey: "after", occurredAt: start + DAY }),
      );
      await ctx.db.insert("writingActivity", {
        userId: "private-writer",
        day,
        count: 5,
        updatedAt: start + 1,
      });
      await ctx.db.insert("writingActivity", {
        userId: "private-other-day",
        day: "2026-10-17",
        count: 999,
        updatedAt: start - 1,
      });
    });
    const result = await t.query(read, { date: day, revision: 1, now });
    expect(result.truncated).toBe(false);
    expect(result.payload.complete).toBe(false);
    expect(metric(result.payload, "provider_ai_attempts").value).toBe(1);
    expect(metric(result.payload, "reported_writing_autosaves").value).toBe(5);
    for (const invalid of ["2026-10-19", "2026-02-30", "2026-01-01"])
      await expect(
        t.query(read, { date: invalid, revision: 1, now }),
      ).rejects.toThrow("TRACTION_INVALID_COMPLETE_DAY");
  });

  test("source ledger deduplication survives into the export", async () => {
    const t = convexTest(schema, modules);
    const trusted = makeFunctionReference<"mutation">(
      "usage:recordTrustedEvent",
    );
    const { ownerId, ...record } = event({ eventKey: "same" });
    await t.mutation(trusted, { ownerId, event: record });
    await t.mutation(trusted, { ownerId, event: record });
    const result = await t.query(read, { date: day, revision: 1, now });
    expect(metric(result.payload, "provider_ai_attempts").value).toBe(1);
  });

  test("row cap returns a partial lower bound and explicit local truncation flag", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < TRACTION_ROW_LIMIT + 1; i++)
        await ctx.db.insert("aiUsageEvents", event({ eventKey: `event-${i}` }));
    });
    const result = await t.query(read, { date: day, revision: 1, now });
    expect(result.truncated).toBe(true);
    expect(result.payload.complete).toBe(false);
    expect(metric(result.payload, "provider_ai_attempts").value).toBe(
      TRACTION_ROW_LIMIT,
    );
  });

  test("frozen bytes survive late arrival retries; a deliberate higher revision corrects them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("aiUsageEvents", event()));
    const first = await t.mutation(prepare, { date: day, revision: 1 });
    await t.run((ctx) =>
      ctx.db.insert("aiUsageEvents", event({ eventKey: "late" })),
    );
    expect(await t.mutation(prepare, { date: day, revision: 1 })).toEqual(
      first,
    );
    const corrected = await t.mutation(prepare, { date: day, revision: 2 });
    expect(
      metric(JSON.parse(corrected.body), "provider_ai_attempts").value,
    ).toBe(2);
    await expect(
      t.mutation(prepare, { date: day, revision: 0 }),
    ).rejects.toThrow("TRACTION_REVISION_MUST_INCREASE");
    expect(first.body).not.toMatch(/private-|ownerId|traceId/);
  });

  test("missing or disabled server configuration does not read the database or send requests", async () => {
    const t = convexTest(schema, modules),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const key of Object.keys(configEnv)) vi.stubEnv(key, "");
    expect(await t.action(run, {})).toEqual({ status: "disabled" });
    vi.stubEnv("TRACTION_EXPORT_ENABLED", "true");
    expect(await t.action(run, {})).toEqual({ status: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await t.run((ctx) => ctx.db.query("tractionExportSnapshots").take(1)),
    ).toEqual([]);
    expect(
      exportConfig({ ...configEnv, TRACTION_EXPORT_ENABLED: "false" }),
    ).toBeNull();
  });

  test("server destination requires an HTTPS origin without credentials, path, query or fragment", () => {
    expect(exportConfig(configEnv)?.url).toBe(
      "https://gateway.example.test/v1/traction/ingest/twyne-product/daily",
    );
    for (const origin of [
      "http://gateway.test",
      "https://user:pass@gateway.test",
      "https://gateway.test/private",
      "https://gateway.test?token=private",
      "https://gateway.test#private",
    ])
      expect(() =>
        exportConfig({ ...configEnv, NOTORGANIC_TRACTION_ORIGIN: origin }),
      ).toThrow("TRACTION_INVALID_ORIGIN");
  });

  test("HMAC matches the standard vector and binds exact raw bytes", async () => {
    // RFC 4231 test case 1: key 0x0b repeated 20 times, data 'Hi There'.
    expect(await signExport("Hi There", "\x0b".repeat(20))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
    expect(await signExport("{}", secret)).not.toBe(
      await signExport("{}\n", secret),
    );
  });

  test("configured action sends the frozen payload to the registered route with HMAC and refuses redirects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const t = convexTest(schema, modules);
    for (const [key, value] of Object.entries(configEnv))
      vi.stubEnv(key, value);
    const fetcher = vi.fn(
      async () => new Response('{"accepted":true}', { status: 202 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await t.run((ctx) => ctx.db.insert("aiUsageEvents", event()));
    expect(await t.action(run, {})).toEqual({
      status: "exported",
      date: day,
      revision: 1,
      truncated: false,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://gateway.example.test/v1/traction/ingest/twyne-product/daily",
    );
    expect(init.redirect).toBe("error");
    expect(
      (init.headers as Record<string, string>)["x-webhook-signature"],
    ).toBe(await signExport(init.body as string, secret));
    expect(JSON.parse(init.body as string).complete).toBe(false);
  });

  test("failure messages reveal neither provider response bodies nor credentials", async () => {
    const config = exportConfig(configEnv)!;
    await expect(
      sendExport(
        "{}",
        config,
        vi.fn(
          async () => new Response("private error and token", { status: 500 }),
        ),
      ),
    ).rejects.toThrow(/^TRACTION_EXPORT_DELIVERY_FAILED$/);
    await expect(
      sendExport(
        "{}",
        config,
        vi.fn(async () => {
          throw new Error(secret);
        }),
      ),
    ).rejects.toThrow(/^TRACTION_EXPORT_DELIVERY_FAILED$/);
  });

  test("a stalled request is aborted after the bounded delivery timeout", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          started();
        }),
    );
    const failure = expect(
      sendExport("{}", exportConfig(configEnv)!, fetcher),
    ).rejects.toThrow("TRACTION_EXPORT_DELIVERY_FAILED");
    await ready;
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  test.each(["ignored abort", "hung body cancellation"])(
    "hard deadline also bounds %s",
    async (mode) => {
      vi.useFakeTimers();
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const fetcher = vi.fn(async () => {
        if (mode === "ignored abort") {
          started();
          return new Promise<Response>(() => {});
        }
        return {
          status: 202,
          body: {
            cancel: () => {
              started();
              return new Promise<void>(() => {});
            },
          },
        } as unknown as Response;
      });
      const failure = expect(
        sendExport("{}", exportConfig(configEnv)!, fetcher),
      ).rejects.toThrow("TRACTION_EXPORT_DELIVERY_FAILED");
      await ready;
      await vi.advanceTimersByTimeAsync(15_000);
      await failure;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
