import { describe, expect, test } from "bun:test";

const names = [
  "chart-table.tsx",
  "daily-activity-chart.tsx",
  "writing-activity.tsx",
  "usage-cost.tsx",
  "usage-breakdowns.tsx",
  "token-dimensions.tsx",
  "writer-patterns.tsx",
  "recent-work.tsx",
  "data-controls.tsx",
];
const sources = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [
      name,
      await Bun.file(new URL(name, import.meta.url)).text(),
    ]),
  ),
);
const route = await Bun.file(
  new URL("../../routes/desk/index.tsx", import.meta.url),
).text();

describe("My Desk accessible dossier contract", () => {
  test("gives every chart family a table equivalent", () => {
    expect(sources["writing-activity.tsx"]).toContain("<ChartTable");
    expect(sources["daily-activity-chart.tsx"]).toContain("<ChartTable");
    expect(sources["usage-cost.tsx"]).toContain("<ChartTable");
    expect(sources["usage-breakdowns.tsx"]).toContain("<ChartTable");
    expect(sources["token-dimensions.tsx"]).toContain("<ChartTable");
    expect(sources["chart-table.tsx"]).toContain("<caption");
    expect(sources["chart-table.tsx"]).toContain('scope="row"');
  });

  test("shows one lower analytics view at a time with semantic tabs", () => {
    const cost = sources["usage-cost.tsx"];
    expect(cost).toContain('role="tablist"');
    expect(cost).toContain('role="tabpanel"');
    expect(cost).toContain("grid grid-cols-4");
    expect(cost).toContain("min-w-0");
    expect(cost).toContain("aria-selected={active.value === tab}");
    expect(cost).toContain('active.value === "cost"');
    expect(cost).toContain('active.value === "tokens"');
  });

  test("keeps content and credentials outside export claims", () => {
    const controls = sources["data-controls.tsx"];
    expect(controls).toContain("may include token counts");
    expect(controls.replaceAll(/\s+/g, " ")).toContain(
      "exclude manuscripts, prompts, responses, and API credentials",
    );
    expect(controls).toContain("deletion was scheduled");
    expect(controls).toContain("usageSyncReadiness(accountId)");
  });

  test("uses local-first loading and bounded all-time daily detail", () => {
    expect(route.indexOf("listLocalEvents")).toBeLessThan(
      route.indexOf("client.query"),
    );
    expect(route).toContain('createUsageRange("90d"');
    expect(sources["usage-cost.tsx"]).toContain(
      "All-time totals and breakdowns",
    );
    expect(route).toContain("api.usage.deleteMyUsageHistory");
  });

  test("does not introduce fixed palettes, gradients, glass, or raster UI", () => {
    const combined = `${Object.values(sources).join("\n")}\n${route}`;
    expect(combined).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(combined).not.toContain("gradient");
    expect(combined).not.toContain("backdrop-blur");
    expect(combined).not.toMatch(/\.(png|jpe?g|webp)/i);
  });
});
