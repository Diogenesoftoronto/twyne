import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const walletState = makeFunctionReference<
  "action",
  Record<string, never>,
  unknown
>("providerIdentity:getWalletState");

const providerCheckout = makeFunctionReference<
  "action",
  { planId?: string; packId?: string; successUrl?: string },
  { checkoutUrl: string }
>("providerIdentity:createProviderCheckout");

export function getNotOrganicWallet(client: ConvexClient): Promise<unknown> {
  return client.action(walletState, {});
}

export function createNotOrganicCheckout(
  client: ConvexClient,
  input: { planId?: string; packId?: string; successUrl?: string },
): Promise<{ checkoutUrl: string }> {
  return client.action(providerCheckout, input);
}
