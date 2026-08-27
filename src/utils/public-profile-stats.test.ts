import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const profileSource = readFileSync(
  new URL("../routes/[handle]/index.tsx", import.meta.url),
  "utf8",
);

describe("public profile statistics boundary", () => {
  test("reads only the opted-in public projection", () => {
    expect(profileSource).toContain("api.usage.getPublicStats");
    expect(profileSource).not.toContain(
      "api.writingActivity.getPublicActivity",
    );
    expect(profileSource).toContain(
      "Object.keys(publicStats.value).length > 0",
    );
  });

  test("structurally excludes private AI and folio-detail fields", () => {
    for (const privateField of [
      "costMicrousd",
      "inputTokens",
      "outputTokens",
      "provider_model",
      "editorialActionId",
      "folioId",
      "recentActions",
      "patterns",
    ]) {
      expect(profileSource).not.toContain(privateField);
    }
    expect(profileSource).toContain("writingHeatmap?: ActivityDay[]");
    expect(profileSource).toContain("daysWritten30?: number");
    expect(profileSource).toContain("publicPieceCount?: number");
    expect(profileSource).toContain("folioCount?: number");
  });

  test("keeps the missing-profile response and generic metadata shape", () => {
    expect(profileSource).toContain("No writer by that handle.");
    expect(profileSource).toContain(
      'Writing by @${params.handle ?? ""} on Twyne.',
    );
    const headSource = profileSource.slice(
      profileSource.indexOf("export const head"),
    );
    expect(headSource).not.toContain("publicStats");
  });
});
