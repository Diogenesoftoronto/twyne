import { describe, expect, test } from "bun:test";
import {
  assistQuotation,
  createGroundingAssistCache,
} from "./quote-grounding-assist";
import {
  linkQuotations,
  quotationCandidates,
  quotationDraftFingerprint,
  resolveQuotationForReveal,
} from "./quote-grounding";
import type { PersonaResearch } from "./persona-research";

const draft = "Ada held the iron key.\n\nBen carried a silver key.";
const extractor = (
  value: unknown = "retyped",
  guess: unknown = "retyped",
  pNull = 0.05,
): PersonaResearch => ({
  reserve: () => true,
  extract: async () => ({
    ok: true,
    answers: {
      passage: { type: "text", value, guess, span: [0, 21], p_null: pNull },
    },
  }),
});

describe("quotation assistance", () => {
  test("literal matches never spend", async () => {
    const quote = "Ada held the iron key";
    const resolution = await assistQuotation(quote, draft, "", {
      reserve: () => {
        throw new Error("must not spend");
      },
    });
    expect(resolution).toEqual({ status: "resolved", from: 0, to: 21 });
    const html = linkQuotations(
      quote,
      [{ quote, index: 0, context: "", resolution }],
      draft,
    );
    expect(html).toContain('class="quote-link"');
    expect(html).toContain('data-quote="Ada held the iron key"');
    expect(html).toContain("data-draft-fingerprint=");
  });
  test("a confident paraphrase remains a possible passage, never an exact quote link", async () => {
    const result = await assistQuotation(
      "Ada clutched an iron key",
      draft,
      "Ada",
      extractor(),
    );
    expect(result).toEqual({
      status: "near",
      from: 0,
      to: 21,
      passage: "Ada held the iron key",
      pNull: 0.05,
    });
    const html = linkQuotations(
      "Ada clutched an iron key",
      [
        {
          quote: "Ada clutched an iron key",
          index: 0,
          context: "Ada",
          resolution: result,
        },
      ],
      draft,
    );
    expect(html).not.toContain('class="quote-link"');
    expect(html).not.toContain("data-quote=");
    expect(html).toContain("Possible related passage, not an exact quotation");
    expect(html).toContain("Ada held the iron key");
  });
  test("null plus guess is a distinct near result without a quote link", async () => {
    const resolution = await assistQuotation(
      "Ada clutched an iron key",
      draft,
      "",
      extractor(null, "retyped", 0.9),
    );
    expect(resolution).toEqual({
      status: "near",
      from: 0,
      to: 21,
      passage: draft.slice(0, 21),
      pNull: 0.9,
    });
    const html = linkQuotations("Ada clutched an iron key", [
      { quote: "Ada clutched an iron key", index: 0, context: "", resolution },
    ]);
    expect(html).not.toContain('class="quote-link"');
    expect(html).toContain("Possible related passage, not an exact quotation");
  });
  test("low confidence and unrelated valid spans cannot create quotation links", async () => {
    const quote = "Ada clutched an iron key";
    for (const [from, to, pNull] of [
      [0, 21, 0.99],
      [draft.indexOf("Ben"), draft.length, 0.01],
    ]) {
      const resolution = await assistQuotation(quote, draft, "", {
        reserve: () => true,
        extract: async () => ({
          ok: true,
          answers: {
            passage: {
              type: "text",
              value: "model-selected text",
              span: [from, to],
              p_null: pNull,
            },
          },
        }),
      });
      expect(resolution).toMatchObject({
        status: "near",
        passage: draft.slice(from, to),
      });
      const html = linkQuotations(quote, [
        { quote, index: 0, context: "", resolution },
      ]);
      expect(html).toContain('class="quote-unresolved"');
      expect(html).not.toContain('role="link"');
      expect(html).not.toContain("data-quote=");
    }
  });
  test("invalid spans, absence and failures preserve unmatched", async () => {
    for (const research of [
      extractor(null, null),
      { reserve: () => false, extract: extractor().extract },
      {
        reserve: () => true,
        extract: async () => {
          throw new Error("offline");
        },
      },
      {
        reserve: () => true,
        extract: async () => ({
          ok: true,
          answers: {
            passage: {
              type: "text" as const,
              value: "fake",
              span: [-1, 99] as [number, number],
            },
          },
        }),
      },
    ])
      expect(
        await assistQuotation("made up quotation", draft, "", research),
      ).toEqual({ status: "unmatched" });
  });
  test("ambiguous choice requires a clear probability win and enumerates occurrence paragraphs", async () => {
    const repeated =
      "At the harbour, the bell rang twice.\n\nIn the mountains, the bell rang twice.";
    const candidates = quotationCandidates("the bell rang twice", repeated);
    expect(candidates).toHaveLength(2);
    for (const [probabilities, resolved] of [
      [{ occurrence_1: 0.02, occurrence_2: 0.96, none: 0.02 }, true],
      [{ occurrence_1: 0.45, occurrence_2: 0.5, none: 0.05 }, false],
      [{ occurrence_1: 0.02, occurrence_2: 0.02, none: 0.96 }, false],
    ] as const) {
      const result = await assistQuotation(
        "the bell rang twice",
        repeated,
        "the ending",
        {
          reserve: () => true,
          judge: async (req) => {
            expect(req.state.occurrence_2).toContain("mountains");
            expect(req.questions.occurrence.criteria).toEqual([
              "occurrence_1",
              "occurrence_2",
              "none",
            ]);
            return { ok: true, answers: { occurrence: { probabilities } } };
          },
        },
      );
      expect(result).toEqual(
        resolved
          ? { status: "resolved", ...candidates[1] }
          : { status: "ambiguous", count: 2 },
      );
      if (resolved) {
        const html = linkQuotations(
          "the bell rang twice",
          [
            {
              quote: "the bell rang twice",
              index: 0,
              context: "the ending",
              resolution: result,
            },
          ],
          repeated,
        );
        expect(html).toContain('class="quote-link"');
        expect(html).toContain(`data-quote-from="${candidates[1].from}"`);
      }
    }
  });
  test("reveal uses chosen occurrence only for the current draft", () => {
    const repeated = "the bell rang twice.\n\nthe bell rang twice.";
    const quote = "the bell rang twice";
    const [, occurrence] = quotationCandidates(quote, repeated);
    const hint = {
      ...occurrence,
      quote,
      context: "",
      draftFingerprint: quotationDraftFingerprint(repeated),
    };
    expect(resolveQuotationForReveal(quote, repeated, "", hint)).toEqual({
      status: "resolved",
      ...occurrence,
    });
    expect(
      resolveQuotationForReveal(
        quote,
        "New paragraph.\n\n" + repeated,
        "",
        hint,
      ),
    ).toEqual({ status: "ambiguous", count: 2 });
    expect(
      resolveQuotationForReveal("different words", repeated, "", hint),
    ).toEqual({ status: "unmatched" });
  });
  test("cache deduplicates concurrent mounts and invalidates on note or draft edits", async () => {
    let calls = 0;
    const cache = createGroundingAssistCache();
    const base = extractor();
    const research: PersonaResearch = {
      ...base,
      extract: async (req) => {
        calls++;
        return base.extract!(req);
      },
    };
    const note = 'Consider "Ada clutched an iron key".';
    const results = await Promise.all([
      cache(note, draft, research),
      cache(note, draft, research),
    ]);
    expect(results[0]).toEqual(results[1]);
    await cache(note, draft, research);
    expect(calls).toBe(1);
    await cache(note + " Again.", draft, research);
    await cache(note, draft + " New words.", research);
    expect(calls).toBe(3);
  });
  test("a note attempts at most four unresolved quotations", async () => {
    let calls = 0;
    const research: PersonaResearch = {
      reserve: () => true,
      extract: async () => {
        calls++;
        return { ok: false };
      },
    };
    await createGroundingAssistCache()(
      '"first missing quote" "second missing quote" "third missing quote" "fourth missing quote" "fifth missing quote"',
      draft,
      research,
    );
    expect(calls).toBe(4);
  });
  test("temporary failures and unavailable budgets can recover after the unresolved TTL", async () => {
    const note = 'Consider "Ada clutched an iron key".';
    const failures: PersonaResearch[] = [
      { reserve: () => true },
      { ...extractor(), reserve: () => false },
      { reserve: () => true, extract: async () => ({ ok: false }) },
      {
        reserve: () => true,
        extract: async () => {
          throw new Error("offline");
        },
      },
    ];
    for (const failure of failures) {
      let now = 1000;
      const cache = createGroundingAssistCache(128, 100, () => now);
      const failed = await cache(note, draft, failure);
      expect(failed[0].resolution).toEqual({ status: "unmatched" });
      let calls = 0;
      const recovered: PersonaResearch = {
        reserve: () => true,
        extract: async (request) => {
          calls++;
          return extractor().extract!(request);
        },
      };
      expect(await cache(note, draft, recovered)).toEqual(failed);
      expect(calls).toBe(0);
      now += 100;
      expect((await cache(note, draft, recovered))[0].resolution.status).toBe(
        "near",
      );
      expect(calls).toBe(1);
      now += 1000;
      await cache(note, draft, recovered);
      expect(calls).toBe(1);
    }
  });
  test("the cache evicts older notes at its entry limit", async () => {
    const cache = createGroundingAssistCache(1);
    let calls = 0;
    const research: PersonaResearch = {
      reserve: () => true,
      extract: async (request) => {
        calls++;
        return extractor().extract!(request);
      },
    };
    const note = 'Consider "Ada clutched an iron key".';
    await cache(note, draft, research);
    await cache(note + " Again.", draft, research);
    await cache(note, draft, research);
    expect(calls).toBe(3);
  });
});
