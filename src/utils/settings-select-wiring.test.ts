import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../routes/settings/index.tsx", import.meta.url),
  "utf8",
);

describe("settings dropdown wiring", () => {
  test("uses the site dropdown for every settings choice", () => {
    expect(settingsSource).not.toContain("<select");
    expect(settingsSource).not.toContain("<option");
    expect(settingsSource.match(/<SiteSelect/g)?.length).toBe(11);
  });

  test("keeps model-derived reasoning choices on the site dropdown", () => {
    expect(settingsSource).toContain("thinkingModels.flatMap");
    expect(settingsSource).toContain("option.values.filter");
    expect(settingsSource).toContain("ariaLabel={label}");
  });

  test("persists reversible public-stat choices and migrates legacy heatmaps", () => {
    expect(settingsSource).toContain("api.profiles.updatePublicStats");
    expect(settingsSource).toContain(
      "await client.mutation(api.profiles.updatePublicStats, row.publicStats)",
    );
    expect(settingsSource).toContain("writingHeatmap");
    expect(settingsSource).toContain("daysWritten30");
    expect(settingsSource).toContain("publicPieceCount");
    expect(settingsSource).toContain("folioCount");
    expect(settingsSource).toContain('ariaLabel="Public writing streak"');
  });

  test("tracks only the aggregate enabled public-stat count", () => {
    expect(settingsSource).toContain(
      'captureProductEvent("public_profile_stats_updated", {',
    );
    expect(settingsSource).toContain("enabled_stat_count:");
    expect(settingsSource).toContain('Number(next.streak !== "off")');
    expect(settingsSource).not.toContain('public_profile_stats_updated", next');
  });

  test("describes account deletion as scheduled background work", () => {
    expect(settingsSource).toContain("result.deletionScheduled");
    expect(settingsSource).toContain("Account deletion started.");
    expect(settingsSource).toContain("resumable background batches");
    expect(settingsSource).not.toContain(
      "Your account and synced data have been deleted.",
    );
  });
});
