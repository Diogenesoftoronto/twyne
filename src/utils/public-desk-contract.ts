/** Public PDS snapshot. Omitted statistics are private, never zero. */
export const PUBLIC_DESK_COLLECTION = "love.twyne.desk";
export const PUBLIC_DESK_RKEY = "self";
export interface PublicDeskStats {
  writingHeatmap?: Array<{ day: string; count: number }>;
  writingHeatmapTruncated?: boolean;
  daysWritten30?: number;
  streak?: number;
  streakKind?: "current" | "longest";
  streakTruncated?: boolean;
  publicPieceCount?: number;
  publicPieceCountTruncated?: boolean;
  folioCount?: number;
  folioCountTruncated?: boolean;
}
export interface PublicDeskRecord {
  $type: typeof PUBLIC_DESK_COLLECTION;
  version: 1;
  handle: string;
  displayName?: string;
  bio?: string;
  url: string;
  updatedAt: string;
  stats: PublicDeskStats;
}
/** Withdrawals retain only this marker, preventing a delayed older create. */
export type PublicDeskPdsRecord =
  | (PublicDeskRecord & { visibility: "public"; publicationId: string })
  | {
      $type: typeof PUBLIC_DESK_COLLECTION;
      version: 1;
      visibility: "private";
      publicationId: string;
    };

export interface PublicDeskJob {
  publicationId: string;
  did: string;
  revision: number;
  pending: boolean;
  record: PublicDeskRecord | null;
}

/** Explicit allowlist even if a future public stats query gains more fields. */
export function publicDeskRecord(
  profile: { handle: string; displayName?: string; bio?: string },
  input: Record<string, unknown>,
  now: number,
): PublicDeskRecord {
  const stats: PublicDeskStats = {};
  for (const key of [
    "daysWritten30",
    "streak",
    "publicPieceCount",
    "folioCount",
  ] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      stats[key] = value;
  }
  for (const key of [
    "writingHeatmapTruncated",
    "streakTruncated",
    "publicPieceCountTruncated",
    "folioCountTruncated",
  ] as const) {
    const value = input[key];
    if (typeof value === "boolean") stats[key] = value;
  }
  if (input.streakKind === "current" || input.streakKind === "longest")
    stats.streakKind = input.streakKind;
  if (Array.isArray(input.writingHeatmap)) {
    stats.writingHeatmap = input.writingHeatmap
      .slice(0, 371)
      .flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.day !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) ||
          !Number.isSafeInteger(entry.count) ||
          entry.count < 0
        )
          return [];
        return [{ day: entry.day, count: entry.count }];
      });
  }
  return {
    $type: PUBLIC_DESK_COLLECTION,
    version: 1,
    handle: profile.handle,
    ...(profile.displayName
      ? { displayName: profile.displayName.slice(0, 60) }
      : {}),
    ...(profile.bio ? { bio: profile.bio.slice(0, 280) } : {}),
    url: `https://twyne.love/${encodeURIComponent(profile.handle)}`,
    updatedAt: new Date(now).toISOString(),
    stats,
  };
}
