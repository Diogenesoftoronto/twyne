/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { INSTRUMENT_LEASE_MS } from "./instrumentTasks";
import { instrumentTaskRefs } from "../src/utils/instrument-tasks";
import { instrumentTextFingerprint } from "../src/utils/instrument-tasks-model";
import type {
  InstrumentTaskRequest,
  InstrumentTaskResult,
} from "../src/utils/instrument-tasks-model";
const supportsViteModules = typeof import.meta.glob === "function";
// Convex loads this provider through the lazy module glob, after setup.
// doMock keeps Bun's skipped discovery outside Vitest-only mocking APIs.
const provider = supportsViteModules
  ? { issue: vi.fn(), request: vi.fn() }
  : ({} as never);
if (supportsViteModules) {
  vi.doMock("./lib/notorganic", () => ({
    issueNotOrganicAccessToken: provider.issue,
    providerJsonRequest: provider.request,
    notOrganicIssuer: () => "https://api.notorganic.info",
    notOrganicEnabled: () => true,
  }));
}
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;
type Lease = { taskId: Id<"instrumentTasks">; leaseToken: string };
const claim = makeFunctionReference<
  "mutation",
  Lease,
  Doc<"instrumentTasks"> | null
>("instrumentTasks:claim");
const start = makeFunctionReference<"mutation", Lease, boolean>(
  "instrumentTasks:start",
);
const expire = makeFunctionReference<"mutation", Lease, null>(
  "instrumentTasks:expireLease",
);
const finish = makeFunctionReference<
  "mutation",
  Lease & { result?: InstrumentTaskResult; error?: string },
  boolean
>("instrumentTasks:finish");
const request: InstrumentTaskRequest = {
  requestId: "task-request-1",
  folioId: "f1",
  kind: "source-research",
  instruction: "What does the source establish?",
  selectedText: "A claim whose evidence needs review.",
  sources: [{ sourceId: "notes", uri: "notes://study", label: "Study" }],
};
const result: InstrumentTaskResult = {
  text: "The source supports this claim [1].",
  citations: [
    {
      ...request.sources[0],
      excerpt: "Saved evidence.",
      fingerprint: instrumentTextFingerprint("Saved evidence."),
      retrievedAt: 1,
    },
  ],
  provider: "notorganic",
  model: "balanced",
  completedAt: 2,
};
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("folioEntries", {
      userId: "issuer|writer",
      itemId: "f1",
      item: { id: "f1", title: "Draft" },
      order: 0,
      updatedAt: 1,
    });
    await ctx.db.insert("providerIdentities", {
      did: "did:plc:writer",
      productSubject: "writer",
      verificationMethod: "notorganic_pkce",
      sessionVersion: 7,
      verifiedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  provider.issue.mockResolvedValue({ accessToken: "server-only" });
  provider.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/resources"))
      return { resources: [{ uri: "notes://study" }] };
    if (path.endsWith("/resources/read"))
      return { contents: [{ text: "Primary source evidence." }] };
    if (path === "/v1/chat/completions")
      return {
        model: "hosted-balanced",
        choices: [
          {
            message: {
              content: "Evidence supports only a narrower claim [1].",
            },
          },
        ],
      };
    throw new Error("Unexpected provider path");
  });
  return {
    t,
    writer: t.withIdentity({
      subject: "writer",
      tokenIdentifier: "issuer|writer",
    }),
    other: t.withIdentity({
      subject: "other",
      tokenIdentifier: "issuer|other",
    }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NOTORGANIC_ASSERTION_PRIVATE_KEY", "test-only");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describeConvex("durable instrument tasks", () => {
  test("anonymous writes and reads fail; another writer cannot read, cancel or leave feedback", async () => {
    const { t, writer, other } = await setup();
    await expect(t.mutation(instrumentTaskRefs.queue, request)).rejects.toThrow(
      "Sign in",
    );
    await expect(
      t.query(instrumentTaskRefs.list, { folioId: "f1" }),
    ).rejects.toThrow("Sign in");
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    expect(
      await other.query(instrumentTaskRefs.list, { folioId: "f1" }),
    ).toEqual([]);
    await expect(
      other.mutation(instrumentTaskRefs.cancel, { taskId }),
    ).rejects.toThrow("not found");
    await expect(
      other.mutation(instrumentTaskRefs.feedback, {
        taskId,
        verdict: "useful",
        comment: "stolen",
      }),
    ).rejects.toThrow("not found");
  });
  test("queue requires account-owned folio and a verified provider link", async () => {
    const { t, writer, other } = await setup();
    await expect(
      other.mutation(instrumentTaskRefs.queue, request),
    ).rejects.toThrow("Sync this folio");
    await t.run(async (ctx) => {
      const link = await ctx.db.query("providerIdentities").first();
      await ctx.db.patch("providerIdentities", link!._id, {
        verificationMethod: "legacy_atproto_browser_oauth",
      });
    });
    await expect(
      writer.mutation(instrumentTaskRefs.queue, request),
    ).rejects.toThrow("Reconnect");
  });
  test("idempotent queue keeps one immutable context and one scheduled action", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    expect(await writer.mutation(instrumentTaskRefs.queue, request)).toBe(
      taskId,
    );
    await expect(
      writer.mutation(instrumentTaskRefs.queue, {
        ...request,
        selectedText: "Changed passage",
      }),
    ).rejects.toThrow("different task");
    const rows = await writer.query(instrumentTaskRefs.list, { folioId: "f1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].selectedText).toBe(request.selectedText);
    expect(rows[0]).not.toHaveProperty("leaseToken");
    expect(rows[0]).not.toHaveProperty("did");
    const schedules = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(schedules).toHaveLength(1);
    expect(schedules[0].name).toBe("instrumentTasksRunner:run");
  });
  test("server schedule runs without a browser identity and preserves exact source provenance", async () => {
    const { t, writer } = await setup();
    await writer.mutation(instrumentTaskRefs.queue, request);
    // The only browser request ends here. The scheduler invokes internal work
    // with no auth context; credential acquisition comes from the owned row.
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.status).toBe("complete");
    expect(row.result?.text).toContain("narrower claim");
    expect(row.result?.citations[0]).toMatchObject({
      ...request.sources[0],
      excerpt: "Primary source evidence.",
    });
    expect(provider.issue.mock.calls[0][0]).toMatchObject({
      did: "did:plc:writer",
      sessionVersion: 7,
      capabilities: ["knowledge:read"],
    });
    const call = provider.request.mock.calls.find(
      (args) => args[0] === "/v1/chat/completions",
    );
    expect(call?.[2].headers).toEqual({
      "idempotency-key": "twyne-instrument:task-request-1",
    });
    expect(JSON.parse(call?.[2].body).messages[1].content).toContain(
      request.selectedText,
    );
    const usage = await t.run((ctx) => ctx.db.query("aiUsageEvents").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      ownerId: "issuer|writer",
      source: "hosted",
      authority: "server",
      model: "hosted-balanced",
      costKind: "unknown",
    });
    expect(usage[0]).not.toHaveProperty("selectedText");
  });
  test("one worker can claim; old lease tokens cannot start or finish", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    expect(
      (await t.mutation(claim, { taskId, leaseToken: "first" }))?.status,
    ).toBe("claimed");
    expect(
      await t.mutation(claim, { taskId, leaseToken: "second" }),
    ).toBeNull();
    expect(await t.mutation(start, { taskId, leaseToken: "second" })).toBe(
      false,
    );
    expect(await t.mutation(start, { taskId, leaseToken: "first" })).toBe(true);
    expect(
      await t.mutation(finish, { taskId, leaseToken: "second", result }),
    ).toBe(false);
  });
  test("cancelled jobs never publish late provider results", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    const lease = { taskId, leaseToken: "lease" };
    await t.mutation(claim, lease);
    await t.mutation(start, lease);
    await writer.mutation(instrumentTaskRefs.cancel, { taskId });
    expect(await t.mutation(finish, { ...lease, result })).toBe(false);
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.status).toBe("cancelled");
    expect(row.result).toBeUndefined();
  });
  test("queued cancellation prevents dispatch", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    await writer.mutation(instrumentTaskRefs.cancel, { taskId });
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    expect(provider.issue).not.toHaveBeenCalled();
    expect(
      (await writer.query(instrumentTaskRefs.list, { folioId: "f1" }))[0]
        .status,
    ).toBe("cancelled");
  });
  test("claims without dispatch recover, bounded to three attempts", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    for (let index = 1; index <= 3; index++) {
      const lease = { taskId, leaseToken: `lease-${index}` };
      await t.mutation(claim, lease);
      await t.run((ctx) =>
        ctx.db.patch("instrumentTasks", taskId, {
          leaseExpiresAt: Date.now() - 1,
        }),
      );
      await t.mutation(expire, lease);
      const [row] = await writer.query(instrumentTaskRefs.list, {
        folioId: "f1",
      });
      expect(row.attempts).toBe(index);
      expect(row.status).toBe(index < 3 ? "queued" : "failed");
    }
    expect(provider.request).not.toHaveBeenCalled();
  });
  test("a running expired lease fails with unknown outcome and is never replayed", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    const lease = { taskId, leaseToken: "lease" };
    await t.mutation(claim, lease);
    await t.mutation(start, lease);
    await t.run((ctx) =>
      ctx.db.patch("instrumentTasks", taskId, {
        leaseExpiresAt: Date.now() - 1,
      }),
    );
    await t.mutation(expire, lease);
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("outcome-unknown");
    expect(await t.mutation(finish, { ...lease, result })).toBe(false);
    expect(
      await t.mutation(claim, { taskId, leaseToken: "replay" }),
    ).toBeNull();
  });
  test("early expiry callbacks cannot revoke a live lease", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    const lease = { taskId, leaseToken: "lease" };
    const row = await t.mutation(claim, lease);
    expect(row!.leaseExpiresAt).toBe(Date.now() + INSTRUMENT_LEASE_MS);
    await t.mutation(expire, lease);
    expect(
      (await writer.query(instrumentTaskRefs.list, { folioId: "f1" }))[0]
        .status,
    ).toBe("claimed");
  });
  test("account changes and deleted folios stop dispatch and discard completion", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    const lease = { taskId, leaseToken: "lease" };
    await t.mutation(claim, lease);
    await t.mutation(start, lease);
    await t.run(async (ctx) => {
      const link = await ctx.db.query("providerIdentities").first();
      await ctx.db.patch("providerIdentities", link!._id, {
        sessionVersion: 8,
      });
    });
    expect(await t.mutation(finish, { ...lease, result })).toBe(false);
    expect(
      (await writer.query(instrumentTaskRefs.list, { folioId: "f1" }))[0]
        .failureKind,
    ).toBe("needs-input");
    const next = await writer.mutation(instrumentTaskRefs.queue, {
      ...request,
      requestId: "next",
    });
    await t.run(async (ctx) => {
      const folio = await ctx.db.query("folioEntries").first();
      await ctx.db.delete("folioEntries", folio!._id);
    });
    expect(
      await t.mutation(claim, { taskId: next, leaseToken: "next" }),
    ).toBeNull();
    expect(provider.request).not.toHaveBeenCalled();
  });
  test("empty model responses are failed, with no sample answer or implicit retry", async () => {
    const { t, writer } = await setup();
    provider.request.mockImplementation(async (path: string) =>
      path.endsWith("/resources")
        ? { resources: [{ uri: "notes://study" }] }
        : path.endsWith("/resources/read")
          ? { contents: [{ text: "Evidence" }] }
          : { choices: [{ message: { content: "" } }] },
    );
    await writer.mutation(instrumentTaskRefs.queue, request);
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.status).toBe("failed");
    expect(row.result).toBeUndefined();
    expect(row.failureKind).toBe("provider-unavailable");
    expect(
      provider.request.mock.calls.filter(
        (args) => args[0] === "/v1/chat/completions",
      ),
    ).toHaveLength(1);
  });
  test("revoked source access fails before any model request and hides provider details", async () => {
    const { t, writer } = await setup();
    provider.request.mockRejectedValue(
      new Error("Not Organic API failed (403): private backend details"),
    );
    await writer.mutation(instrumentTaskRefs.queue, request);
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.failureKind).toBe("needs-input");
    expect(row.error).not.toContain("private backend");
    expect(
      provider.request.mock.calls.some(
        (args) => args[0] === "/v1/chat/completions",
      ),
    ).toBe(false);
  });
  test("results and feedback remain account-persisted after return", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    const lease = { taskId, leaseToken: "lease" };
    await t.mutation(claim, lease);
    await t.mutation(start, lease);
    expect(await t.mutation(finish, { ...lease, result })).toBe(true);
    await writer.mutation(instrumentTaskRefs.feedback, {
      taskId,
      verdict: "not-useful",
      comment: "Please distinguish correlation.",
    });
    const returned = t.withIdentity({
      subject: "writer",
      tokenIdentifier: "issuer|writer",
    });
    const [row] = await returned.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.result).toEqual(result);
    expect(row.feedback).toMatchObject({
      verdict: "not-useful",
      comment: "Please distinguish correlation.",
    });
  });
  test("a resource revoked while the model runs is rechecked and its result is discarded", async () => {
    const { t, writer } = await setup();
    let catalogReads = 0;
    provider.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/resources")) {
        catalogReads++;
        if (catalogReads > 1)
          throw new Error(
            "Not Organic API failed (403): revoked during inference",
          );
        return { resources: [{ uri: "notes://study" }] };
      }
      if (path.endsWith("/resources/read"))
        return { contents: [{ text: "Evidence" }] };
      return {
        model: "balanced",
        choices: [{ message: { content: "A late result [1]." } }],
      };
    });
    await writer.mutation(instrumentTaskRefs.queue, request);
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("needs-input");
    expect(row.result).toBeUndefined();
    expect(catalogReads).toBe(2);
  });
  test("source and text bounds are enforced before scheduling", async () => {
    const { t, writer } = await setup();
    await expect(
      writer.mutation(instrumentTaskRefs.queue, {
        ...request,
        selectedText: "x".repeat(20001),
      }),
    ).rejects.toThrow("Selected text");
    await expect(
      writer.mutation(instrumentTaskRefs.queue, { ...request, sources: [] }),
    ).rejects.toThrow("one to three");
    await expect(
      writer.mutation(instrumentTaskRefs.queue, {
        ...request,
        sources: [request.sources[0], request.sources[0]],
      }),
    ).rejects.toThrow("once");
    expect(
      await t.run((ctx) => ctx.db.query("instrumentTasks").collect()),
    ).toEqual([]);
  });
  test("account deletion tombstone prevents dispatch", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionJobs", {
        ownerId: "issuer|writer",
        productSubject: "writer",
        phase: 0,
        deletedCount: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    expect(
      await t.mutation(claim, { taskId, leaseToken: "deleted" }),
    ).toBeNull();
    await expect(
      writer.mutation(instrumentTaskRefs.queue, {
        ...request,
        requestId: "after-deletion",
      }),
    ).rejects.toThrow("deletion");
    expect(provider.issue).not.toHaveBeenCalled();
  });
  test("account deletion removes task snapshots, results and feedback", async () => {
    const { t, writer } = await setup();
    const taskId = await writer.mutation(instrumentTaskRefs.queue, request);
    const lease = { taskId, leaseToken: "lease" };
    await t.mutation(claim, lease);
    await t.mutation(start, lease);
    await t.mutation(finish, { ...lease, result });
    await writer.mutation(instrumentTaskRefs.feedback, {
      taskId,
      verdict: "useful",
      comment: "Private feedback",
    });
    // Keep only the deletion scheduler pending, not the completed job's lease.
    const schedules = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    for (const scheduled of schedules)
      await t.run((ctx) => ctx.scheduler.cancel(scheduled._id));
    const deleteAccount = makeFunctionReference<
      "mutation",
      Record<string, never>,
      unknown
    >("account:deleteAccount");
    await writer.mutation(deleteAccount, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) => ctx.db.query("instrumentTasks").collect()),
    ).toEqual([]);
    expect(provider.request).not.toHaveBeenCalled();
  });
  test("missing deployment credentials fails honestly without a model request", async () => {
    const { t, writer } = await setup();
    vi.stubEnv("NOTORGANIC_ASSERTION_PRIVATE_KEY", "");
    await writer.mutation(instrumentTaskRefs.queue, request);
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    const [row] = await writer.query(instrumentTaskRefs.list, {
      folioId: "f1",
    });
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("provider-unavailable");
    expect(row.error).toContain("No model request was sent");
    expect(provider.issue).not.toHaveBeenCalled();
  });
});
