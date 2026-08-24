import { describe, expect, test } from "bun:test";

describe("dossier preview integration", () => {
  test("keeps draft review inside the live dossier instead of a route header", async () => {
    const refine = await Bun.file("src/routes/dossier/refine/index.tsx").text();
    const form = await Bun.file(
      "src/components/onboarding/anti-tabula-rasa.tsx",
    ).text();
    const preview = await Bun.file(
      "src/components/brief/dossier-preview.tsx",
    ).text();

    expect(refine).not.toContain("Have the room read your draft.");
    expect(refine).not.toContain("Drift report");
    expect(refine).toContain("draftReview={store.dossierCheck}");
    expect(refine).toContain("onApplyDraftObservation$={applyObservation}");
    expect(form).toContain("<DossierPreview");
    expect(preview).toContain("Read my draft");
    expect(preview).toContain("Apply to dossier");
  });

  test("the preview and filed dossier expose the full brief and Particulars", async () => {
    const preview = await Bun.file(
      "src/components/brief/dossier-preview.tsx",
    ).text();
    const filed = await Bun.file(
      "src/components/brief/project-brief-card.tsx",
    ).text();

    for (const label of [
      "Working title",
      "Format",
      "Audience",
      "Goal",
      "Tone",
      "Non-negotiables",
      "Success signal",
    ]) {
      expect(preview).toContain(label);
    }
    expect(preview).toContain("props.probes.map");
    expect(filed).toContain('BriefRow label="Success signal"');
    expect(filed).toContain("brief.probes?.map");
  });

  test("refine awaits folio persistence before leaving the page", async () => {
    const refine = await Bun.file("src/routes/dossier/refine/index.tsx").text();

    expect(refine).toContain(
      "await saveProjectBriefForFolio(store.folioId, next)",
    );
    expect(refine).toContain('await nav("/editor/")');
  });
});
