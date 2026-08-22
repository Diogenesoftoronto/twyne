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

  test("editorial board closes as one surface while Apparatus cards disclose locally", async () => {
    const [board, panel, styles] = await Promise.all([
      Bun.file(
        "src/components/editorial-board/editorial-board-overlay.tsx",
      ).text(),
      Bun.file("src/components/citations/citations-panel.tsx").text(),
      Bun.file("src/global.css").text(),
    ]);

    expect(board).toContain('aria-label="Close the Editorial Board"');
    expect(board).not.toContain("boardCollapsed");
    expect(board).not.toContain("editorial-board-card--collapsed");
    expect(board).toContain('store.steeringCollapsed ? "▸" : "▾"');
    expect(panel).toContain('store.signalCollapsed ? "▸" : "▾"');
    expect(panel).toContain('store.deepTraceCollapsed ? "▸" : "▾"');
    expect(`${board}\n${panel}`).not.toContain("editorial-card-collapse");
    expect(styles).toContain(".apparatus-disclosure-toggle");
  });

  test("steering the Apparatus uses the shared composer — Steer key under the box, voice inside it", async () => {
    const [board, composer, styles] = await Promise.all([
      Bun.file(
        "src/components/editorial-board/editorial-board-overlay.tsx",
      ).text(),
      Bun.file("src/components/ui/chat-composer.tsx").text(),
      Bun.file("src/global.css").text(),
    ]);

    // The steering box is the composer, so it inherits dictation and the
    // control bar rather than re-implementing a textarea beside a button.
    expect(board).toContain("<ChatComposer");
    expect(board).toContain('sendLabel="Steer"');
    expect(board).toContain("onSend$={submitSteering}");
    expect(board).not.toContain("editorial-steering-card__input-row");
    expect(board).not.toContain('id="apparatus-steering"');

    // Voice is available: the composer only hides the mic when told to.
    expect(board).not.toContain("allowVoice={false}");
    expect(composer).toContain("props.allowVoice !== false && canRecord()");
    expect(composer).toContain('title={props.sendLabel ?? "Send"}');

    // The send key lives in the bar beneath the input, not alongside it.
    const inputAt = composer.indexOf('class="composer-input"');
    const barAt = composer.indexOf('class="composer-bar"');
    expect(inputAt).toBeGreaterThan(-1);
    expect(barAt).toBeGreaterThan(inputAt);

    // A bare-element rule here would out-specify .composer-input.
    expect(styles).not.toContain(".editorial-steering-card textarea");
  });
});
