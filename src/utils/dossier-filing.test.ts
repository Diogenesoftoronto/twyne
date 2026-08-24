import { describe, expect, test } from "bun:test";
import { DOSSIER_FILED_FEEDBACK_MS } from "./dossier-filing";

describe("dossier filing feedback", () => {
  test("keeps the success acknowledgment perceptible without delaying the desk", () => {
    expect(DOSSIER_FILED_FEEDBACK_MS).toBeGreaterThanOrEqual(400);
    expect(DOSSIER_FILED_FEEDBACK_MS).toBeLessThanOrEqual(800);
  });

  test("wires the shared filed state through both dossier surfaces", async () => {
    const [folio, form, conversation, create, refine, css] = await Promise.all(
      [
        "src/components/onboarding/dossier-folio.tsx",
        "src/components/onboarding/anti-tabula-rasa.tsx",
        "src/components/onboarding/conversational-interview.tsx",
        "src/routes/dossier/create/index.tsx",
        "src/routes/dossier/refine/index.tsx",
        "src/global.css",
      ].map((path) => Bun.file(path).text()),
    );

    expect(folio).toContain("data-filing-state={filingState}");
    expect(folio).toContain('role="status"');
    expect(form).toContain('filingState === "filed"');
    expect(conversation).toContain('props.filingState === "filed"');
    expect(create).toContain('filingState.value = "filed"');
    expect(refine).toContain('store.filingState = "filed"');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".dossier-filed-confirmation__paper");
  });
});
