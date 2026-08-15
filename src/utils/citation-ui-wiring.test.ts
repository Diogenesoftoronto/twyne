import { describe, expect, test } from "bun:test";

describe("citation UI wiring", () => {
  test("apparatus scans the persisted active folio, not just the first folio", async () => {
    const source = await Bun.file("src/routes/apparatus/index.tsx").text();

    expect(source).toContain("loadActiveFolioIdFromIdb");
    expect(source).toContain(
      "folios.find((folio) => folio.id === activeFolioId)",
    );
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
    expect(source).toContain(
      "store.style = apparatusSettings.defaultCitationStyle",
    );
    expect(source).toContain("formatCitation(entry, store.style)");
    expect(source).toContain("footnoteCite(entry, store.style)");
    expect(source).not.toContain('entry.style ?? "mla"');
  });

  test("apparatus surfaces load only the active folio bibliography", async () => {
    const [panel, apparatus] = await Promise.all([
      Bun.file("src/components/citations/citations-panel.tsx").text(),
      Bun.file("src/routes/apparatus/index.tsx").text(),
    ]);
    expect(panel).toContain("loadBibliographyForFolio(activeFolio?.id)");
    expect(apparatus).toContain("loadBibliographyForFolio(");
    expect(`${panel}\n${apparatus}`).not.toContain("|| !entry.folioId");
  });

  test("citation insertion targets the researched claim and never silently uses the cursor", async () => {
    const panel = await Bun.file(
      "src/components/citations/citations-panel.tsx",
    ).text();
    const editor = await Bun.file(
      "src/components/editor/twyne-editor.tsx",
    ).text();

    expect(panel).toContain("anchor: entry.target?.anchor");
    expect(panel).toContain('new CustomEvent("twyne:insert-citation"');
    expect(editor).toContain("findTextRange(editor.state.doc, detail.anchor)");
    expect(editor).toContain(".setFootnote({ text: detail.text })");
    expect(editor).not.toContain('new CustomEvent("twyne:insert-text"');
  });

  test("automatic footnotes are persisted and confirmed by the editor", async () => {
    const panel = await Bun.file(
      "src/components/citations/citations-panel.tsx",
    ).text();
    const settings = await Bun.file("src/routes/settings/index.tsx").text();

    expect(panel).toContain("store.autoInsertFootnotes");
    expect(panel).toContain(
      'window.addEventListener("twyne:citation-inserted"',
    );
    expect(panel).toContain("citationInsertedAt: Date.now()");
    expect(settings).toContain("Auto-insert researched footnotes");
  });
});
