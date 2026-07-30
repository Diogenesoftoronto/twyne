import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const linkDid = makeFunctionReference<"mutation", { did: string }, unknown>(
  "providerIdentity:linkDidFromLegacyBrowserSession",
);

const walletState = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("providerIdentity:getWalletState");

const providerCheckout = makeFunctionReference<
  "action",
  { planId: string; successUrl?: string },
  { checkoutUrl: string }
>("providerIdentity:createProviderCheckout");

export async function linkNotOrganicDid(
  client: ConvexClient,
  did: string,
): Promise<void> {
  await client.mutation(linkDid, { did });
}

export function getNotOrganicWallet(client: ConvexClient): Promise<unknown> {
  return client.action(walletState, {});
}

export function createNotOrganicCheckout(
  client: ConvexClient,
  input: { planId: string; successUrl?: string },
): Promise<{ checkoutUrl: string }> {
  return client.action(providerCheckout, input);
}
