import { describe, expect, test } from "bun:test";

describe("citation UI wiring", () => {
  test("apparatus scans the persisted active folio, not just the first folio", async () => {
    const source = await Bun.file("src/routes/apparatus/index.tsx").text();

    expect(source).toContain("loadActiveFolioIdFromIdb");
    expect(source).toContain("folios.find((folio) => folio.id === activeFolioId)");
    expect(source).not.toContain("store.activeFolio = folios[0] ?? null");
  });

  test("apparatus auto-formats detected citations when AI enhancement is enabled", async () => {
    const source = await Bun.file("src/routes/apparatus/index.tsx").text();

    expect(source).toContain("store.aiEnhanceCitations");
    expect(source).toContain("hasConfiguredAiProvider(store.aiSettings)");
    expect(source).toContain("buildBibEntryFromFormattedCitation");
    expect(source).toContain("runClientCitationFormat");
  });

  test("right citations panel uses the saved default citation style", async () => {
    const source = await Bun.file(
      "src/components/citations/citations-panel.tsx",
    ).text();

    expect(source).toContain("loadApparatusSettingsFromIdb");
    expect(source).toContain("store.style = apparatusSettings.defaultCitationStyle");
    expect(source).toContain("formatCitation(entry, store.style)");
    expect(source).toContain("footnoteCite(entry, store.style)");
    expect(source).not.toContain('entry.style ?? "mla"');
  });
});
