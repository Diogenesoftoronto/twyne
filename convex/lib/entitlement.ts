/**
 * Pro entitlement — read from the writer's Not Organic wallet.
 *
 * Twyne no longer keeps its own subscription table: the plan lives on the
 * Not Organic account linked at sign-in (`providerIdentities`). Any failure
 * to reach the wallet resolves to "not Pro" so free-tier limits still apply.
 */
import { makeFunctionReference } from "convex/server";
import { hasCurrentTwynePlan } from "../../src/utils/subscription-plan";
import {
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  providerJsonRequest,
} from "./notorganic";

type RunQueryCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
};

const getLinkedDidBySubject = makeFunctionReference<
  "query",
  { productSubject: string },
  { did: string; sessionVersion: number } | null
>("providerIdentity:getLinkedDidBySubject");

/** Whether the signed-in Twyne user (by Better Auth subject) holds Pro. */
export async function userIsPro(
  ctx: RunQueryCtx,
  productSubject: string,
): Promise<boolean> {
  try {
    const link = await ctx.runQuery(getLinkedDidBySubject, { productSubject });
    if (!link) return false;
    const token = await issueNotOrganicAccessToken({
      did: link.did,
      feature: "wallet",
      capabilities: ["wallet:read"],
      sessionVersion: link.sessionVersion,
    });
    const wallet = await providerJsonRequest<unknown>(
      "/v1/wallet",
      token,
      {},
      { issuer: notOrganicIssuer(), feature: "wallet" },
    );
    return hasCurrentTwynePlan(wallet);
  } catch {
    return false;
  }
}
