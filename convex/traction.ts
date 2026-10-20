import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const DAY_MS = 86_400_000;
export const TRACTION_ROW_LIMIT = 2000;
const authorities = ["server", "provider", "client_reported"] as const;
const metricValidator = v.object({
  id: v.string(),
  label: v.string(),
  unit: v.string(),
  value: v.union(v.number(), v.null()),
  kind: v.union(v.literal("product"), v.literal("ai_usage")),
  aggregation: v.union(v.literal("sum"), v.literal("distinct")),
  scope: v.literal("application"),
  authority: v.union(
    v.literal("server"),
    v.literal("provider"),
    v.literal("client_reported"),
    v.literal("estimated"),
  ),
});
const payloadValidator = v.object({
  date: v.string(),
  revision: v.number(),
  complete: v.literal(false),
  metrics: v.array(metricValidator),
});
type Metric = Infer<typeof metricValidator>;
export type TractionExport = Infer<typeof payloadValidator>;
type UsageRow = Pick<
  Doc<"aiUsageEvents">,
  | "ownerId"
  | "eventKey"
  | "authority"
  | "outcome"
  | "editorialActionId"
  | "inputTokens"
  | "outputTokens"
  | "costKind"
  | "costMicrousd"
>;
type WritingRow = Pick<Doc<"writingActivity">, "userId" | "count">;

function dayBounds(date: string, now: number) {
  const start = Date.parse(`${date}T00:00:00.000Z`),
    today = Math.floor(now / DAY_MS) * DAY_MS;
  if (
    !Number.isFinite(now) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(start) ||
    new Date(start).toISOString().slice(0, 10) !== date ||
    start >= today ||
    start < today - 90 * DAY_MS
  )
    throw new Error("TRACTION_INVALID_COMPLETE_DAY");
  return { start, end: start + DAY_MS };
}

function safeTotal(values: Array<number | undefined>): number | null {
  const known = values.filter(
    (value): value is number =>
      value !== undefined && Number.isSafeInteger(value) && value >= 0,
  );
  if (!known.length) return null;
  const sum = known.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(sum) ? sum : null;
}

/** These are observed records, not an application-wide activity census. */
export function summarizeTraction(
  date: string,
  revision: number,
  usage: UsageRow[],
  writing: WritingRow[],
): TractionExport {
  const metrics: Metric[] = [];
  const add = (
    id: string,
    label: string,
    unit: string,
    value: number | null,
    authority: Metric["authority"],
    kind: Metric["kind"] = "ai_usage",
    aggregation: Metric["aggregation"] = "sum",
  ) =>
    metrics.push({
      id,
      label,
      unit,
      value,
      authority,
      kind,
      aggregation,
      scope: "application",
    });
  // The owning ledger already deduplicates; retain that boundary defensively here.
  const seen = new Set<string>();
  const events = usage.filter((row) => {
    const key = JSON.stringify([row.ownerId, row.eventKey]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const authority of authorities) {
    const rows = events.filter((row) => row.authority === authority),
      label = authority.replaceAll("_", " ");
    add(
      `${authority}_ai_attempts`,
      `${label}: observed AI attempts`,
      "attempts",
      rows.length || null,
      authority,
    );
    add(
      `${authority}_ai_failures`,
      `${label}: observed AI failures`,
      "attempts",
      rows.length
        ? rows.filter((row) => row.outcome === "failed").length
        : null,
      authority,
    );
    const actions = rows.filter((row) => row.editorialActionId);
    add(
      `${authority}_editorial_actions`,
      `${label}: observed editorial actions`,
      "actions",
      actions.length
        ? new Set(
            actions.map((row) =>
              JSON.stringify([row.ownerId, row.editorialActionId]),
            ),
          ).size
        : null,
      authority,
      "product",
      "distinct",
    );
    add(
      `${authority}_input_tokens`,
      `${label}: reported input tokens`,
      "tokens",
      safeTotal(rows.map((row) => row.inputTokens)),
      authority,
    );
    add(
      `${authority}_output_tokens`,
      `${label}: reported output tokens`,
      "tokens",
      safeTotal(rows.map((row) => row.outputTokens)),
      authority,
    );
    add(
      `${authority}_actual_cost_microusd`,
      `${label}: reported actual AI cost`,
      "microusd",
      safeTotal(
        rows
          .filter((row) => row.costKind === "actual")
          .map((row) => row.costMicrousd),
      ),
      authority,
    );
    add(
      `${authority}_estimated_cost_microusd`,
      `${label}: estimated AI cost`,
      "microusd",
      safeTotal(
        rows
          .filter((row) => row.costKind === "estimated")
          .map((row) => row.costMicrousd),
      ),
      "estimated",
    );
  }
  const validWriting = writing.filter(
    (row) => Number.isSafeInteger(row.count) && row.count > 0,
  );
  add(
    "reported_writing_autosaves",
    "Reported writing autosaves",
    "autosaves",
    safeTotal(validWriting.map((row) => row.count)),
    "client_reported",
    "product",
  );
  add(
    "accounts_reporting_writing",
    "Accounts reporting writing activity",
    "accounts",
    validWriting.length
      ? new Set(validWriting.map((row) => row.userId)).size
      : null,
    "client_reported",
    "product",
    "distinct",
  );
  // Neither browser sync nor hosted capture has a complete-day ingestion watermark.
  return { date, revision, complete: false, metrics };
}

async function readEvidence(
  ctx: QueryCtx,
  date: string,
  revision: number,
  now: number,
) {
  const { start, end } = dayBounds(date, now);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("TRACTION_INVALID_REVISION");
  const [usage, writing] = await Promise.all([
    ctx.db
      .query("aiUsageEvents")
      .withIndex("by_occurredAt", (q) =>
        q.gte("occurredAt", start).lt("occurredAt", end),
      )
      .take(TRACTION_ROW_LIMIT + 1),
    ctx.db
      .query("writingActivity")
      .withIndex("by_day", (q) => q.eq("day", date))
      .take(TRACTION_ROW_LIMIT + 1),
  ]);
  return {
    payload: summarizeTraction(
      date,
      revision,
      usage.slice(0, TRACTION_ROW_LIMIT),
      writing.slice(0, TRACTION_ROW_LIMIT),
    ),
    truncated:
      usage.length > TRACTION_ROW_LIMIT || writing.length > TRACTION_ROW_LIMIT,
  };
}

/** Internal preview only; the caller supplies time so reactive query caching stays sound. */
export const dailyEvidence = internalQuery({
  args: { date: v.string(), revision: v.number(), now: v.number() },
  returns: v.object({ payload: payloadValidator, truncated: v.boolean() }),
  handler: (ctx, args) => readEvidence(ctx, args.date, args.revision, args.now),
});

/** Freeze exact bytes once per revision before any network call. */
export const prepareExport = internalMutation({
  args: { date: v.string(), revision: v.number() },
  returns: v.object({ body: v.string(), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    const now = Date.now(),
      { start } = dayBounds(args.date, now);
    if (!Number.isSafeInteger(args.revision) || args.revision < 0)
      throw new Error("TRACTION_INVALID_REVISION");
    const prior = await ctx.db
      .query("tractionExportSnapshots")
      .withIndex("by_date_and_revision", (q) =>
        q.eq("date", args.date).eq("revision", args.revision),
      )
      .unique();
    if (prior) return { body: prior.body, truncated: prior.truncated };
    const latest = await ctx.db
      .query("tractionExportSnapshots")
      .withIndex("by_date_and_revision", (q) => q.eq("date", args.date))
      .order("desc")
      .take(1);
    if (latest[0] && latest[0].revision >= args.revision)
      throw new Error("TRACTION_REVISION_MUST_INCREASE");
    const evidence = await readEvidence(ctx, args.date, args.revision, now);
    const body = JSON.stringify(evidence.payload);
    await ctx.db.insert("tractionExportSnapshots", {
      date: args.date,
      revision: args.revision,
      body,
      truncated: evidence.truncated,
      createdAt: now,
      expiresAt: start + 91 * DAY_MS,
    });
    const expired = await ctx.db
      .query("tractionExportSnapshots")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    return { body, truncated: evidence.truncated };
  },
});

export type ExportConfig = { url: string; secret: string };
export function exportConfig(
  env: Readonly<Record<string, string | undefined>>,
): ExportConfig | null {
  if (env.TRACTION_EXPORT_ENABLED !== "true") return null;
  const origin = env.NOTORGANIC_TRACTION_ORIGIN,
    serviceId = env.NOTORGANIC_TRACTION_SERVICE_ID,
    secret = env.NOTORGANIC_TRACTION_EXPORT_SECRET;
  if (!origin || !serviceId || !secret) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("TRACTION_INVALID_ORIGIN");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("TRACTION_INVALID_ORIGIN");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(serviceId) || secret.length < 32)
    throw new Error("TRACTION_INVALID_CONFIGURATION");
  return { url: `${url.origin}/v1/traction/ingest/${serviceId}/daily`, secret };
}

export async function signExport(
  body: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendExport(
  body: string,
  config: ExportConfig,
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("TRACTION_EXPORT_TIMEOUT"));
    }, 15_000);
  });
  try {
    await Promise.race([
      (async () => {
        const signature = await signExport(body, config.secret);
        if (controller.signal.aborted)
          throw new Error("TRACTION_EXPORT_TIMEOUT");
        const response = await fetcher(config.url, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-webhook-signature": signature,
          },
          body,
        });
        // This route acknowledges durable ingestion with 202 only. Never log response bodies.
        if (response.status !== 202)
          throw new Error("TRACTION_EXPORT_NOT_ACCEPTED");
        await response.body?.cancel();
      })(),
      deadline,
    ]);
  } catch {
    throw new Error("TRACTION_EXPORT_DELIVERY_FAILED");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const prepareReference = makeFunctionReference<
  "mutation",
  { date: string; revision: number },
  { body: string; truncated: boolean }
>("traction:prepareExport");

/** 04:20 UTC cron invokes this without args; operators can replay a retained date. */
export const exportDay = internalAction({
  args: { date: v.optional(v.string()), revision: v.optional(v.number()) },
  returns: v.object({
    status: v.union(v.literal("disabled"), v.literal("exported")),
    date: v.optional(v.string()),
    revision: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const config = exportConfig(process.env);
    if (!config) return { status: "disabled" as const };
    const date =
        args.date ?? new Date(Date.now() - DAY_MS).toISOString().slice(0, 10),
      revision = args.revision ?? 1;
    const snapshot = await ctx.runMutation(prepareReference, {
      date,
      revision,
    });
    await sendExport(snapshot.body, config);
    return {
      status: "exported" as const,
      date,
      revision,
      truncated: snapshot.truncated,
    };
  },
});
