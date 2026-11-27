/**
 * How long ago `timestamp` was, in whole units: "just now", "5m ago",
 * "3h ago", "2d ago". `compact` drops " ago" for tight spaces ("5m").
 */
export function timeAgo(
  timestamp: number,
  { compact = false }: { compact?: boolean } = {},
): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const suffix = compact ? "" : " ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${suffix}`;
  return `${Math.floor(hours / 24)}d${suffix}`;
}
