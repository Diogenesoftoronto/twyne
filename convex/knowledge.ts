"use node";

import { action, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  providerJsonRequest,
} from "./lib/notorganic";

const linkRef = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");
const sourceId = v.string();
function segment(value: string) {
  if (!value || value.length > 256)
    throw new ConvexError("Invalid knowledge source.");
  return encodeURIComponent(value);
}
async function request(
  ctx: ActionCtx,
  path: string,
  call = false,
  body?: unknown,
): Promise<unknown> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    throw new ConvexError("Sign in with Not Organic to use account sources.");
  const link = await ctx.runQuery(linkRef, {
    productSubject: identity.subject || identity.tokenIdentifier,
  });
  if (!link)
    throw new ConvexError(
      "Reconnect your Not Organic account to use account sources.",
    );
  try {
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      sessionVersion: link.sessionVersion,
      feature: "knowledge",
      capabilities: [call ? "knowledge:tools" : "knowledge:read"],
    });
    return await providerJsonRequest<unknown>(
      path,
      token,
      body === undefined
        ? { signal: AbortSignal.timeout(30_000) }
        : {
            method: "POST",
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
          },
      { issuer: notOrganicIssuer(), feature: "knowledge" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/\(403\)|knowledge_access_denied/.test(message))
      throw new ConvexError(
        "Access to this source was revoked. Share it with Twyne in Not Organic, then refresh sources.",
      );
    if (/\(409\)|knowledge_tool_changed/.test(message))
      throw new ConvexError(
        "This tool changed. Review its sharing permissions in Not Organic, then refresh sources.",
      );
    if (/\(401\)|session_revoked/.test(message))
      throw new ConvexError(
        "Your account session expired. Sign in with Not Organic again.",
      );
    throw new ConvexError(
      "Account sources are unavailable. Try refreshing sources later. Tool calls are never retried automatically.",
    );
  }
}

export const sources = action({
  args: {},
  returns: v.any(),
  handler: (ctx) => request(ctx, "/v1/knowledge/sources"),
});
export const resources = action({
  args: { sourceId },
  returns: v.any(),
  handler: (ctx, args) =>
    request(ctx, `/v1/knowledge/sources/${segment(args.sourceId)}/resources`),
});
export const read = action({
  args: { sourceId, uri: v.string() },
  returns: v.any(),
  handler: (ctx, args) => {
    if (!args.uri || args.uri.length > 4096)
      throw new ConvexError("Choose a listed resource.");
    return request(
      ctx,
      `/v1/knowledge/sources/${segment(args.sourceId)}/resources/read`,
      false,
      { uri: args.uri },
    );
  },
});
export const call = action({
  args: { sourceId, tool: v.string(), arguments: v.any() },
  returns: v.any(),
  handler: (ctx, args) => {
    if (
      !args.arguments ||
      typeof args.arguments !== "object" ||
      Array.isArray(args.arguments) ||
      JSON.stringify(args.arguments).length > 60_000
    )
      throw new ConvexError("Supply a tool arguments object.");
    return request(
      ctx,
      `/v1/knowledge/sources/${segment(args.sourceId)}/tools/${segment(args.tool)}/call`,
      true,
      { arguments: args.arguments },
    );
  },
});
