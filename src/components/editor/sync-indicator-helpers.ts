/**
 * Sync indicator — the status bar's "Saved Xs ago · filed" line.
 * It is wired to the `twyne:sync-status` event that `convex-sync`
 * fires when the underlying state changes. The helpers are pure
 * with respect to the event stream: they don't import convex-sync
 * or know how the status is derived.
 */

import type { SyncStatus } from "../../utils/convex-sync";
import type { Consequence } from "../../utils/consequence";

/**
 * Map a sync status to the colour the indicator dot should
 * show. Vermilion is the danger colour (offline / error),
 * paper-3 is the in-flight / pending state (deliberately
 * quiet so it doesn't fight the cursor), and accent-green is
 * the steady "you are saved" state.
 */
export function statusColor(status: SyncStatus): string {
  switch (status.kind) {
    case "offline":
    case "error":
      return "var(--color-vermilion)";
    case "pending":
    case "syncing":
      return "var(--color-paper-3)";
    case "synced":
      return "var(--color-accent-green)";
    case "local-only":
      return "var(--color-ink-muted)";
  }
}

/**
 * Single-line human description shown in the dot's tooltip.
 * Keeps the toolbar label short while the colophon line carries
 * the timestamp.
 */
export function statusLabel(
  status: SyncStatus,
  now: number = Date.now(),
): string {
  switch (status.kind) {
    case "local-only":
      return "Local only — sign in to sync across devices";
    case "offline":
      return "Offline — your changes are still being saved locally";
    case "pending":
      return "Queued for sync…";
    case "syncing":
      return "Syncing…";
    case "synced":
      return `Synced ${formatAge(status.lastSyncedAt, now)}`;
    case "error": {
      const safetyCopy = /local work remains safe/i.test(status.message)
        ? ""
        : " Your local work remains safe on this device.";
      return `Sync failed ${formatAge(status.lastErrorAt, now)} — ${status.message}${safetyCopy}`;
    }
  }
}

/**
 * Format a timestamp as a human-friendly age: "12s ago",
 * "3m ago", "2h ago", or "just now". Anything older than a
 * day falls through to a date string so the tooltip doesn't
 * grow without bound.
 */
export function formatAge(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * The "last saved" line. Falls back to the current time when
 * no successful save has happened yet, so the line never
 * reads as empty.
 */
export function lastSavedLabel(
  savedAt: number | null,
  now: number = Date.now(),
): string {
  if (savedAt == null) return "Not saved yet";
  return `Saved ${formatAge(savedAt, now)}`;
}

/**
 * Where the latest saved words are, as one word in its consequence ink:
 * "filed" once the account holds them, "on the wire" while they travel,
 * "held here" when they only live on this device. Nothing before the
 * first save, so the line never claims a route for words that do not exist.
 */
export function saveRouteLabel(
  status: SyncStatus,
  savedAt: number | null,
): { word: string; consequence: Extract<Consequence, "local" | "synced"> } | null {
  if (savedAt == null) return null;
  switch (status.kind) {
    case "synced":
      return status.lastSyncedAt >= savedAt
        ? { word: "filed", consequence: "synced" }
        : { word: "on the wire", consequence: "synced" };
    case "pending":
    case "syncing":
      return { word: "on the wire", consequence: "synced" };
    case "offline":
    case "error":
    case "local-only":
      return { word: "held here", consequence: "local" };
  }
}
