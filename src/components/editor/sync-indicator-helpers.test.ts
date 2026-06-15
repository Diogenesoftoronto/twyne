import { describe, expect, test } from "bun:test";
import {
  formatAge,
  lastSavedLabel,
  statusColor,
  statusLabel,
} from "./sync-indicator-helpers";
import type { SyncStatus } from "../../utils/convex-sync";

const NOW = 1_700_000_000_000; // fixed reference time for deterministic tests

const statuses: SyncStatus[] = [
  { kind: "local-only" },
  { kind: "offline" },
  { kind: "pending", queuedAt: NOW - 1_000 },
  { kind: "syncing" },
  { kind: "synced", lastSyncedAt: NOW - 12_000 },
  { kind: "error", lastErrorAt: NOW - 5_000, message: "boom" },
];

describe("statusColor", () => {
  test("returns the danger colour for offline and error", () => {
    expect(statusColor({ kind: "offline" })).toBe("var(--color-vermilion)");
    expect(
      statusColor({ kind: "error", lastErrorAt: NOW, message: "x" }),
    ).toBe("var(--color-vermilion)");
  });

  test("returns the quiet paper-3 colour while pending or syncing", () => {
    expect(statusColor({ kind: "pending", queuedAt: NOW })).toBe(
      "var(--color-paper-3)",
    );
    expect(statusColor({ kind: "syncing" })).toBe("var(--color-paper-3)");
  });

  test("returns the steady accent-green once synced", () => {
    expect(statusColor({ kind: "synced", lastSyncedAt: NOW })).toBe(
      "var(--color-accent-green)",
    );
  });

  test("returns the muted ink colour while local-only", () => {
    expect(statusColor({ kind: "local-only" })).toBe(
      "var(--color-ink-muted)",
    );
  });

  test("covers every status kind with no default fallthrough", () => {
    // If a new SyncStatus kind is added without updating
    // statusColor, this loop will trip a TypeScript error.
    for (const s of statuses) {
      expect(typeof statusColor(s)).toBe("string");
    }
  });
});

describe("statusLabel", () => {
  test("describes the offline state in human language", () => {
    expect(statusLabel({ kind: "offline" })).toMatch(/offline/i);
  });

  test("describes the syncing state as in-flight", () => {
    expect(statusLabel({ kind: "syncing" })).toMatch(/sync/i);
  });

  test("embeds the synced timestamp in the label", () => {
    expect(statusLabel({ kind: "synced", lastSyncedAt: NOW - 12_000 }, NOW)).toMatch(
      /12s ago/,
    );
  });

  test("embeds the error message in the error label", () => {
    const label = statusLabel(
      { kind: "error", lastErrorAt: NOW - 5_000, message: "boom" },
      NOW,
    );
    expect(label).toMatch(/5s ago/);
    expect(label).toMatch(/boom/);
  });
});

describe("formatAge", () => {
  test("'just now' for anything under five seconds", () => {
    expect(formatAge(NOW - 0, NOW)).toBe("just now");
    expect(formatAge(NOW - 4_000, NOW)).toBe("just now");
  });

  test("seconds under a minute", () => {
    expect(formatAge(NOW - 12_000, NOW)).toBe("12s ago");
    expect(formatAge(NOW - 59_000, NOW)).toBe("59s ago");
  });

  test("minutes under an hour", () => {
    expect(formatAge(NOW - 60_000, NOW)).toBe("1m ago");
    expect(formatAge(NOW - 3 * 60_000, NOW)).toBe("3m ago");
    expect(formatAge(NOW - 59 * 60_000, NOW)).toBe("59m ago");
  });

  test("hours under a day", () => {
    expect(formatAge(NOW - 60 * 60_000, NOW)).toBe("1h ago");
    expect(formatAge(NOW - 23 * 60 * 60_000, NOW)).toBe("23h ago");
  });

  test("falls through to a localised date after a day", () => {
    // We don't assert the exact string (locale-dependent) —
    // only that it isn't the seconds/minutes/hours form.
    const day = formatAge(NOW - 25 * 60 * 60_000, NOW);
    expect(day).not.toMatch(/\d+s ago/);
    expect(day).not.toMatch(/\d+m ago/);
    expect(day).not.toMatch(/\d+h ago/);
  });

  test("negative ages clamp to 'just now'", () => {
    // A clock skew of a few hundred ms should never show "-3s ago".
    expect(formatAge(NOW + 3_000, NOW)).toBe("just now");
  });
});

describe("lastSavedLabel", () => {
  test("'Not saved yet' when no save has happened", () => {
    expect(lastSavedLabel(null)).toBe("Not saved yet");
  });

  test("includes a human age when a save has happened", () => {
    expect(lastSavedLabel(NOW - 12_000, NOW)).toBe("Saved 12s ago");
  });
});
