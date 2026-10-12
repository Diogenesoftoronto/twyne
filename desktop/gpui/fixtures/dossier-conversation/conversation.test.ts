import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTaggedJson, stripTaggedJson, stripJsonFences } from "../../../../src/utils/llm-parsing";
import { stripReasoningTags } from "../../../../src/utils/reasoning-tags";
import { parseDossierCheckResult } from "../../../../src/utils/dossier-check";
import type { ProjectInterviewAnswers } from "../../../../src/types";

const fixturePath = join(import.meta.dir, "web-conversation-contract.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("dossier conversation protocol & fixtures", () => {
  test("opening questions match source strings", () => {
    expect(fixture.constants.openingQuestion).toBe(
      "Tell me the piece in one sentence — the way you'd describe it to a friend at lunch.",
    );
    expect(fixture.constants.refineOpeningQuestion).toBe(
      "Reading your current brief back to you, what feels off, or what has the draft outgrown?",
    );
    expect(fixture.constants.synthesizeNudge).toBe(
      "(the writer is ready to see the dossier — please synthesise now)",
    );
  });

  test("extracts DOSSIER and PROBE tags and cleans question prose", () => {
    const raw = fixture.protocol.turnResponseWithDossierAndProbe;
    const dossierSegment = extractTaggedJson(raw, "DOSSIER");
    expect(dossierSegment).not.toBeNull();
    expect(dossierSegment!.value).toEqual(fixture.protocol.extractedDossier);

    const strippedDossier = stripTaggedJson(raw, dossierSegment!);
    const probeSegment = extractTaggedJson(strippedDossier, "PROBE");
    expect(probeSegment).not.toBeNull();
    expect(probeSegment!.value).toEqual(fixture.protocol.extractedProbe);

    const cleanQuestion = stripTaggedJson(strippedDossier, probeSegment!);
    expect(cleanQuestion).toBe(fixture.protocol.finalCleanQuestion);
  });

  test("extracts SYNTHESIZE tag with confidence ratings", () => {
    const raw = fixture.protocol.turnResponseSynthesis;
    const stripped = stripReasoningTags(raw);
    const synthSegment = extractTaggedJson(stripped, "SYNTHESIZE");
    expect(synthSegment).not.toBeNull();
    expect(synthSegment!.value).toEqual(fixture.protocol.extractedSynthesis);
  });

  test("amendment response line cleaning conforms to source bounds", () => {
    const cases = fixture.amendment.cases;
    for (const c of cases) {
      if (c.expected === null) {
        expect(c.raw.trim()).toBe("");
      } else {
        expect(c.expected.length).toBeLessThanOrEqual(240);
        expect(c.expected).not.toMatch(/^["'“”‘’`]|["'“”‘’`]$/);
        expect(c.expected).not.toMatch(/\s{2,}/);
      }
    }
  });

  test("drift check observations parse, narrow, deduplicate, and hydrate current values", () => {
    const raw = fixture.driftCheck.raw;
    const sampleAnswers = fixture.sampleAnswers;
    const parsed = parseDossierCheckResult(raw, "local-provider", sampleAnswers);

    expect(parsed).not.toBeNull();
    expect(parsed!.observations.length).toBe(2);
    // tone first, then goal (invalidField dropped, duplicate tone dropped, empty constraint dropped)
    expect(parsed!.observations[0].field).toBe("tone");
    expect(parsed!.observations[0].suggested).toBe("Direct and unsparing");
    expect(parsed!.observations[1].field).toBe("goal");
    expect(parsed!.observations[1].current).toBe(sampleAnswers.goal);
  });

  test("starter and imported document HTML preserve authored and imported prose", () => {
    const starter = fixture.documents.starterHtml;
    expect(starter).toContain("<h1>The Anatomy of Attention</h1>");
    expect(starter).toContain("<strong>Anti-tabula rasa brief</strong>");
    expect(starter).toContain("Show that deep focus requires intentional architectural boundaries");

    const imported = fixture.documents.importedHtmlWithFilename;
    expect(imported).toContain("<strong>Imported from chapter-outline.txt</strong>");
    expect(imported).toContain("<p>Paragraph one of previous material.</p>");
    expect(imported).toContain("<p>Paragraph two with notes.</p>");
  });
});
