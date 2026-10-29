import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { HostedUsageSummary } from "./hosted-usage";

const hostedUsage = makeFunctionReference<
  "action",
  { from: number | null; to: number },
  HostedUsageSummary
>("providerIdentity:getHostedUsage");

export function getNotOrganicHostedUsage(
  client: ConvexClient,
  range: { from: number | null; to: number },
): Promise<HostedUsageSummary> {
  return client.action(hostedUsage, range);
}

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

export interface NotOrganicAchievement {
  id: string;
  application: string;
  title: string;
  description: string;
  imageUrl: string | null;
  awardedAt: number;
  recordUrl: string | null;
}

const achievements = makeFunctionReference<
  "action",
  Record<string, never>,
  NotOrganicAchievement[]
>("achievements:listMine");

export function getNotOrganicAchievements(
  client: ConvexClient,
): Promise<NotOrganicAchievement[]> {
  return client.action(achievements, {});
}
