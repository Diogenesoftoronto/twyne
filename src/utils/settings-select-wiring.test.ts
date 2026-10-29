import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../routes/settings/index.tsx", import.meta.url),
  "utf8",
);
const profileSource = readFileSync(
  new URL("../components/account/writer-profile-settings.tsx", import.meta.url),
  "utf8",
);
const deleteAccountSource = readFileSync(
  new URL("../components/account/delete-account.tsx", import.meta.url),
  "utf8",
);

describe("settings dropdown wiring", () => {
  test("uses the site dropdown for every settings choice", () => {
    expect(settingsSource).not.toContain("<select");
    expect(settingsSource).not.toContain("<option");
    const controls = settingsSource.match(/<SiteSelect[\s\S]*?\/>/g) ?? [];
    for (const label of [
      "Primary genre",
      "Experience level",
      "Feedback pressure",
      "Critique delivery style",
      "Praise preference",
      "Fact adherence mode",
      "Research provider",
    ]) {
      expect(
        controls.some((control) => control.includes(`ariaLabel="${label}"`)),
      ).toBe(true);
    }
  });

  test("keeps account controls out of Preferences", () => {
    expect(profileSource).not.toContain("<select");
    expect(profileSource).toContain('ariaLabel="Public writing streak"');
    for (const moved of [
      "api.profiles.claimHandle",
      "api.integrations.createToken",
      "api.account.deleteAccount",
    ])
      expect(settingsSource).not.toContain(moved);
  });

  test("keeps model-derived reasoning choices on the site dropdown", () => {
    expect(settingsSource).toContain("thinkingModels.flatMap");
    expect(settingsSource).toContain("option.values.filter");
    expect(settingsSource).toContain("ariaLabel={label}");
  });

  test("persists reversible public-stat choices and migrates legacy heatmaps", () => {
    expect(profileSource).toContain("api.profiles.updatePublicStats");
    expect(profileSource).toContain(
      "await client.mutation(api.profiles.updatePublicStats, row.publicStats)",
    );
    expect(profileSource).toContain("writingHeatmap");
    expect(profileSource).toContain("daysWritten30");
    expect(profileSource).toContain("publicPieceCount");
    expect(profileSource).toContain("folioCount");
    expect(profileSource).toContain('ariaLabel="Public writing streak"');
  });

  test("tracks only the aggregate enabled public-stat count", () => {
    expect(profileSource).toContain(
      'captureProductEvent("public_profile_stats_updated", {',
    );
    expect(profileSource).toContain("enabled_stat_count:");
    expect(profileSource).toContain('Number(next.streak !== "off")');
    expect(profileSource).not.toContain('public_profile_stats_updated", next');
  });

  test("describes account deletion as scheduled background work", () => {
    expect(deleteAccountSource).toContain("result.deletionScheduled");
    expect(deleteAccountSource).toContain("Account deletion started.");
    expect(deleteAccountSource).toContain("resumable background batches");
    expect(deleteAccountSource).not.toContain(
      "Your account and synced data have been deleted.",
    );
  });
});
