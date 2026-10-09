"use node";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  notOrganicEnabled,
  providerJsonRequest,
} from "./lib/notorganic";
import {
  executeInstrumentTask,
  InstrumentTaskCancelled,
} from "../src/utils/instrument-tasks-runner";
import type { InstrumentTaskResult } from "../src/utils/instrument-tasks-model";
import {
  utcDayFromTimestamp,
  type UsageEvent,
} from "../src/utils/usage-domain";

type Lease = { taskId: Id<"instrumentTasks">; leaseToken: string };
const claimRef = makeFunctionReference<
  "mutation",
  Lease,
  Doc<"instrumentTasks"> | null
>("instrumentTasks:claim");
const startRef = makeFunctionReference<"mutation", Lease, boolean>(
  "instrumentTasks:start",
);
const currentRef = makeFunctionReference<
  "query",
  Lease & { now: number },
  boolean
>("instrumentTasks:isCurrent");
const recordUsageRef = makeFunctionReference<
  "mutation",
  { taskId: Id<"instrumentTasks">; event: UsageEvent },
  null
>("instrumentTasks:recordUsage");
const finishRef = makeFunctionReference<
  "mutation",
  Lease & {
    result?: InstrumentTaskResult;
    error?: string;
    failureKind?: "needs-input" | "provider-unavailable" | "outcome-unknown";
  },
  boolean
>("instrumentTasks:finish");
function safeFailure(error: unknown): {
  error: string;
  failureKind: "needs-input" | "provider-unavailable";
} {
  const text = error instanceof Error ? error.message : "";
  if (/\(401\)|\(403\)|session_revoked/.test(text))
    return {
      error:
        "Your account or selected source access expired. Reconnect and queue a new task.",
      failureKind: "needs-input",
    };
  if (/\(402\)/.test(text))
    return {
      error: "Your Not Organic account needs credit to run this task.",
      failureKind: "needs-input",
    };
  if (/not contain readable text|no longer available/.test(text))
    return {
      error:
        "A selected resource is unavailable or has no readable text. Choose another resource.",
      failureKind: "needs-input",
    };
  if (/disabled|not configured/.test(text))
    return {
      error:
        "Durable tasks need the hosted Not Organic provider to be configured. No model request was sent.",
      failureKind: "provider-unavailable",
    };
  if (/no visible answer/.test(text))
    return {
      error:
        "The provider returned no visible answer. Queue a new task to try again.",
      failureKind: "provider-unavailable",
    };
  return {
    error:
      "The provider could not finish this task. No automatic model retry was sent.",
    failureKind: "provider-unavailable",
  };
}
export const run = internalAction({
  args: { taskId: v.id("instrumentTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const lease: Lease = { taskId, leaseToken: crypto.randomUUID() };
    const task = await ctx.runMutation(claimRef, lease);
    if (!task || !(await ctx.runMutation(startRef, lease))) return null;
    // Every request is bounded inside the 180s lease. No SDK retry or local
    // fallback is used; tool calls requiring interactive review are excluded.
    const deadline = AbortSignal.timeout(150_000);
    const current = () =>
      ctx.runQuery(currentRef, { ...lease, now: Date.now() });
    const boundedFetch = ((
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => fetch(input, { ...init, signal: deadline })) as typeof fetch;
    try {
      if (!notOrganicEnabled() || !process.env.NOTORGANIC_ASSERTION_PRIVATE_KEY)
        throw new Error("Hosted provider is not configured");
      const tokenInput = { did: task.did, sessionVersion: task.sessionVersion };
      const result = await executeInstrumentTask(task, {
        current,
        now: Date.now,
        read: async (ref) => {
          const token = await issueNotOrganicAccessToken(
            {
              ...tokenInput,
              feature: "knowledge",
              capabilities: ["knowledge:read"],
            },
            process.env,
            boundedFetch,
          );
          const base = `/v1/knowledge/sources/${encodeURIComponent(ref.sourceId)}`;
          const catalog = await providerJsonRequest<{
            resources?: { uri?: string }[];
          }>(
            `${base}/resources`,
            token,
            { signal: deadline },
            { issuer: notOrganicIssuer(), feature: "knowledge" },
          );
          if (
            !Array.isArray(catalog.resources) ||
            !catalog.resources.some((resource) => resource.uri === ref.uri)
          )
            throw new Error("Selected resource is no longer available");
          if (!(await current())) throw new InstrumentTaskCancelled();
          const resource = await providerJsonRequest<{
            contents?: { text?: string }[];
          }>(
            `${base}/resources/read`,
            token,
            {
              method: "POST",
              body: JSON.stringify({ uri: ref.uri }),
              signal: deadline,
            },
            { issuer: notOrganicIssuer(), feature: "knowledge" },
          );
          return (resource.contents ?? [])
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .join("\n")
            .slice(0, 8000);
        },
        generate: async ({ system, prompt, idempotencyKey }) => {
          if (!(await current())) throw new InstrumentTaskCancelled();
          const token = await issueNotOrganicAccessToken(
            {
              ...tokenInput,
              feature: "persona-analysis",
              capabilities: ["infer:balanced"],
            },
            process.env,
            boundedFetch,
          );
          if (!(await current())) throw new InstrumentTaskCancelled();
          let outcome: "completed" | "failed" = "failed";
          let usage:
            | {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              }
            | undefined;
          let model = "balanced";
          try {
            const answer = await providerJsonRequest<{
              model?: string;
              choices?: { message?: { content?: string } }[];
              usage?: typeof usage;
            }>(
              "/v1/chat/completions",
              token,
              {
                method: "POST",
                signal: deadline,
                headers: { "idempotency-key": idempotencyKey },
                body: JSON.stringify({
                  model: "balanced",
                  messages: [
                    { role: "system", content: system },
                    { role: "user", content: prompt },
                  ],
                  max_tokens: 2500,
                }),
              },
              { issuer: notOrganicIssuer(), feature: "persona-analysis" },
            );
            outcome = "completed";
            usage = answer.usage;
            model =
              typeof answer.model === "string"
                ? answer.model.slice(0, 256)
                : "balanced";
            return {
              text:
                typeof answer.choices?.[0]?.message?.content === "string"
                  ? answer.choices[0].message.content
                  : "",
              model,
              provider: "notorganic",
            };
          } finally {
            const occurredAt = Date.now();
            const tokens = (value: unknown) =>
              typeof value === "number" &&
              Number.isSafeInteger(value) &&
              value >= 0 &&
              value <= 1_000_000_000_000
                ? value
                : undefined;
            const event: UsageEvent = {
              eventKey: `${task._id}:provider-attempt`,
              occurredAt,
              day: utcDayFromTimestamp(occurredAt),
              source: "hosted",
              authority: "server",
              feature: "persona-analysis",
              provider: "notorganic",
              model,
              folioId: task.folioId,
              editorialActionId: task._id,
              traceId: task._id,
              attempt: 1,
              outcome,
              costKind: "unknown",
              inputTokens: tokens(usage?.prompt_tokens),
              outputTokens: tokens(usage?.completion_tokens),
              totalTokens: tokens(usage?.total_tokens),
            };
            await ctx
              .runMutation(recordUsageRef, { taskId, event })
              .catch(() => {
                console.warn(
                  "[instrument-task] Provider usage could not be recorded.",
                );
              });
          }
        },
      });
      // A source can be withdrawn while the model is reading. Recheck its
      // resource grant before publishing excerpts back into the product.
      for (const ref of task.sources) {
        if (!(await current())) throw new InstrumentTaskCancelled();
        const token = await issueNotOrganicAccessToken(
          {
            ...tokenInput,
            feature: "knowledge",
            capabilities: ["knowledge:read"],
          },
          process.env,
          boundedFetch,
        );
        const catalog = await providerJsonRequest<{
          resources?: { uri?: string }[];
        }>(
          `/v1/knowledge/sources/${encodeURIComponent(ref.sourceId)}/resources`,
          token,
          { signal: deadline },
          { issuer: notOrganicIssuer(), feature: "knowledge" },
        );
        if (
          !Array.isArray(catalog.resources) ||
          !catalog.resources.some((resource) => resource.uri === ref.uri)
        )
          throw new Error("Selected resource is no longer available");
      }
      await ctx.runMutation(finishRef, { ...lease, result });
    } catch (error) {
      await ctx.runMutation(finishRef, {
        ...lease,
        ...(error instanceof InstrumentTaskCancelled
          ? {
              error:
                "The account or task context changed. The result was discarded.",
              failureKind: "needs-input" as const,
            }
          : safeFailure(error)),
      });
    }
    return null;
  },
});
