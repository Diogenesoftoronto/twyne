/**
 * Not Organic achievements. The provider ledger is the only authority: Twyne
 * reads awards and reports earned keys, and never stores an award itself.
 */
import { v } from "convex/values";
import {
  issueNotOrganicAccessToken,
  notOrganicIssuer,
  providerJsonRequest,
} from "./notorganic";

const PORTAL_ORIGIN = "https://id.notorganic.info";

/** Keys defined for Twyne in Not Organic's starter achievement catalog. */
export const TWYNE_ACHIEVEMENTS = [
  "first-draft",
  "notes-from-the-room",
  "well-sourced",
  "kill-your-darlings",
  "ten-thousand-words",
  "out-the-door",
] as const;
export type TwyneAchievement = (typeof TWYNE_ACHIEVEMENTS)[number];

export const achievementValidator = v.object({
  id: v.string(),
  application: v.string(),
  title: v.string(),
  description: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  awardedAt: v.number(),
  recordUrl: v.union(v.string(), v.null()),
});

export interface NotOrganicAchievement {
  id: string;
  application: string;
  title: string;
  description: string;
  imageUrl: string | null;
  awardedAt: number;
  recordUrl: string | null;
}

interface LinkedAccount {
  did: string;
  sessionVersion: number;
}

export function parseAchievementAward(
  entry: unknown,
): NotOrganicAchievement | null {
  const award = entry as Record<string, unknown> | null;
  if (
    !award ||
    typeof award.id !== "string" ||
    typeof award.title !== "string" ||
    typeof award.awarded_at !== "number"
  )
    return null;
  const publication = award.publication as { record_url?: unknown } | undefined;
  return {
    id: award.id,
    application: typeof award.application === "string" ? award.application : "",
    title: award.title,
    description: typeof award.description === "string" ? award.description : "",
    imageUrl:
      typeof award.asset_path === "string" &&
      /^\/(achievements|brand)\/[a-z0-9/-]+\.png$/.test(award.asset_path)
        ? `${PORTAL_ORIGIN}${award.asset_path}`
        : null,
    awardedAt: award.awarded_at,
    recordUrl:
      typeof publication?.record_url === "string" &&
      publication.record_url.startsWith("https://")
        ? publication.record_url
        : null,
  };
}

export async function listNotOrganicAchievements(
  link: LinkedAccount,
): Promise<NotOrganicAchievement[]> {
  const token = await issueNotOrganicAccessToken({
    did: link.did,
    feature: "achievements",
    capabilities: ["achievements:read"],
    sessionVersion: link.sessionVersion,
  });
  const payload = await providerJsonRequest<{ data?: unknown }>(
    "/v1/achievements/awards",
    token,
    {},
    { issuer: notOrganicIssuer(), feature: "achievements" },
  );
  return (Array.isArray(payload.data) ? payload.data : []).flatMap((entry) => {
    const award = parseAchievementAward(entry);
    return award ? [award] : [];
  });
}

/** Idempotent on the ledger: a repeat award replays instead of paying twice. */
export async function awardNotOrganicAchievement(
  link: LinkedAccount,
  achievement: TwyneAchievement,
): Promise<void> {
  const token = await issueNotOrganicAccessToken({
    did: link.did,
    feature: "achievements",
    capabilities: ["achievements:award"],
    sessionVersion: link.sessionVersion,
  });
  await providerJsonRequest<unknown>(
    "/v1/achievements/awards",
    token,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ achievement }),
    },
    { issuer: notOrganicIssuer(), feature: "achievements" },
  );
}
