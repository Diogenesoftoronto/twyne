import { describe, expect, test } from "bun:test";
import {
  exportHtml,
  exportMarkdown,
  exportPlainText,
  extractInlineNotes,
} from "./exchange";
import { combineJudgesAndStatic, scoreStaticFeatures } from "./rubric";

/* TipTap serializes the text attribute BEFORE data-type, so the
   extractor must not depend on attribute order. */
const TIPTAP_ENDNOTE =
  '<sup data-endnote-text="See the 1998 census." data-type="endnote" class="twyne-endnote" title="See the 1998 census."></sup>';
const TIPTAP_FOOTNOTE =
  '<sup data-endnote-text="Author interview, 2024." data-type="footnote" class="twyne-endnote"></sup>';

describe("inline note extraction", () => {
  test("finds notes regardless of attribute order and kind", () => {
    const html = `<p>First claim${TIPTAP_ENDNOTE} and second${TIPTAP_FOOTNOTE}.</p>`;
    expect(extractInlineNotes(html)).toEqual([
      { kind: "endnote", text: "See the 1998 census." },
      { kind: "footnote", text: "Author interview, 2024." },
    ]);
  });

  test("decodes escaped attribute text", () => {
    const html =
      '<sup data-endnote-text="Jones &amp; Sons, &quot;Report&quot;" data-type="endnote"></sup>';
    expect(extractInlineNotes(html)).toEqual([
      { kind: "endnote", text: 'Jones & Sons, "Report"' },
    ]);
  });
});

describe("export with notes", () => {
  const payload = {
    title: "Test Draft",
    html: `<p>Alpha${TIPTAP_ENDNOTE} beta${TIPTAP_FOOTNOTE}.</p>`,
  };

  test("HTML export numbers refs and builds both sections", () => {
    const out = exportHtml(payload);
    expect(out).toContain('<sup class="endnote-ref">¹</sup>');
    expect(out).toContain('<sup class="footnote-ref">¹</sup>');
    expect(out).toContain("<h2>Notes</h2>");
    expect(out).toContain("See the 1998 census.");
    expect(out).toContain("<h2>Footnotes</h2>");
    expect(out).toContain("Author interview, 2024.");
    // Raw editor sups must be gone from the body.
    expect(out).not.toContain("data-endnote-text");
  });

  test("markdown export lists endnotes and footnotes separately", () => {
    const out = exportMarkdown(payload);
    expect(out).toContain("## Notes");
    expect(out).toContain("1. **note**: See the 1998 census.");
    expect(out).toContain("## Footnotes");
    expect(out).toContain("1. Author interview, 2024.");
  });

  test("persona comments only appear when supplied by the export choice", () => {
    const personaComment = {
      personaId: "copy-chief",
      personaName: "M. Le Stylo",
      personaColor: "#d4a017",
      feedback: "Verify the archive figure before publication.",
      timestamp: 1,
      type: "critique" as const,
      anchor: "nearly sixty percent",
    };

    const withoutComments = exportMarkdown({
      title: "Clean proof",
      html: "<p>The manuscript stands alone.</p>",
    });
    expect(withoutComments).not.toContain("M. Le Stylo");
    expect(withoutComments).not.toContain("Verify the archive figure");

    const withComments = exportMarkdown({
      title: "Annotated proof",
      html: "<p>The manuscript stands alone.</p>",
      marginalia: [personaComment],
    });
    expect(withComments).toContain("M. Le Stylo");
    expect(withComments).toContain("Verify the archive figure");

    const cleanText = exportPlainText({
      title: "Clean proof",
      html: "<p>The manuscript stands alone.</p>",
    });
    expect(cleanText).not.toContain("M. Le Stylo");

    const annotatedText = exportPlainText({
      title: "Annotated proof",
      html: "<p>The manuscript stands alone.</p>",
      marginalia: [personaComment],
    });
    expect(annotatedText).toContain("Notes");
    expect(annotatedText).toContain("M. Le Stylo");
    expect(annotatedText).toContain("Verify the archive figure");
  });
});

describe("rubric scoring", () => {
  test("combined grade never exceeds 100", () => {
    const judges = ["a", "b", "c"].map((id) => ({
      personaId: id,
      score: 10,
      rationale: "flawless",
      provider: "test",
    }));
    const staticScore = scoreStaticFeatures("word ".repeat(500));
    staticScore.total = 10; // force the extreme
    const result = combineJudgesAndStatic(judges, staticScore, null);
    expect(result.combined).toBeLessThanOrEqual(100);
    expect(result.combined).toBeGreaterThanOrEqual(0);
  });

  test("parenthetical and bracketed citations count as support", () => {
    const supported = scoreStaticFeatures(
      "Everyone in the field accepts this finding (Smith, 2020). More prose follows here to give the detector something to chew on.",
    );
    expect(supported.features.unsupportedUniversalClaimCount).toBe(0);

    const bracketed = scoreStaticFeatures(
      "No one disputes the measured effect [3]. More prose follows here to give the detector something to chew on.",
    );
    expect(bracketed.features.unsupportedUniversalClaimCount).toBe(0);

    const unsupported = scoreStaticFeatures(
      "Everyone knows this is true. More prose follows here to give the detector something to chew on.",
    );
    expect(unsupported.features.unsupportedUniversalClaimCount).toBe(1);
  });

  test("windowed type-token ratio does not crater with length alone", () => {
    // 2,000 words drawn from a 300-word vocabulary: raw TTR would be
    // 0.15, yet locally the prose is varied — MATTR should stay high.
    // Letter-only words — the feature normalizer strips digits.
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const vocab = Array.from(
      { length: 300 },
      (_, i) => `${letters[i % 26]}${letters[Math.floor(i / 26) % 26]}zz`,
    );
    const long = Array.from({ length: 2000 }, (_, i) => vocab[i % 300]).join(
      " ",
    );
    expect(scoreStaticFeatures(long).features.uniqueWordsRatio).toBeGreaterThan(
      0.9,
    );

    // Genuine local repetition must still be caught.
    const paragraph =
      "The harbor master logged every vessel by name, tonnage, and flag, then walked the pier at dusk comparing manifests against cargo. ";
    expect(
      scoreStaticFeatures(paragraph.repeat(40)).features.uniqueWordsRatio,
    ).toBeLessThan(0.3);
  });
});
