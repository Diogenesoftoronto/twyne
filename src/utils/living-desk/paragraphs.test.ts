import { describe, expect, test } from "bun:test";
import {
  buildParagraphBatch,
  classifyParagraphs,
  paragraphReviewKey,
  localParagraphReview,
  readParagraphReviews,
  ruleNarratingTense,
  paragraphPassages,
  TENSE_OPTIONS,
  MAX_PARAGRAPHS_PER_BATCH,
  MAX_PARAGRAPH_STATE_BYTES,
  type ParagraphPassage,
  type ParagraphCache,
  type ParagraphJudgementRequest,
} from "./paragraphs";
import { SCORE_LEVELS } from "../rubric-grade";
const passage = (
  text = "She was waiting at the door. She opened it and walked into the rain.",
  index = 1,
): ParagraphPassage => ({
  id: `p${index}`,
  text,
  from: index * 100,
  to: index * 100 + text.length,
  paragraph: index,
  section: 0,
});
const context = {
  audience: "General readers",
  goal: "Explain the decision",
  voice: "Plain and specific",
};
function answers(
  request: ParagraphJudgementRequest,
  tense: (typeof TENSE_OPTIONS)[number] = TENSE_OPTIONS[0],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => [
      key,
      question.type === "score"
        ? {
            type: "score",
            score: 3,
            confidence: 0.8,
            legend: Object.fromEntries(
              SCORE_LEVELS.map((level, index) => [String(index), level]),
            ),
            probabilities: {
              "0": 0.05,
              "1": 0.05,
              "2": 0.05,
              "3": 0.8,
              "4": 0.05,
            },
          }
        : {
            type: "choice",
            choice: tense,
            confidence: 0.8,
            probabilities: Object.fromEntries(
              TENSE_OPTIONS.map((option) => [
                option,
                option === tense ? 0.8 : 0.05,
              ]),
            ),
          },
    ]),
  );
}
describe("paragraph readings", () => {
  test("local scores are explicit heuristics, voice is unavailable, and tense excludes dialogue", () => {
    const local = localParagraphReview(passage(), context);
    expect(local.at).toBeNull();
    expect(local.model).toBeNull();
    expect(local.scores.voice.value).toBeNull();
    expect(
      Object.values(local.scores).every(
        (metric) => metric.source === "rule" && metric.confidence === null,
      ),
    ).toBe(true);
    expect(local.scores.evidence.note).toContain("does not verify");
    expect(
      ruleNarratingTense(
        'She was quiet. "I am ready and I have plans," she said.',
      ).label,
    ).toBe("past");
    expect(ruleNarratingTense("She is quiet and has a plan.").label).toBe(
      "present",
    );
    expect(ruleNarratingTense("She was quiet. Now she is ready.").label).toBe(
      "mixed",
    );
    expect(ruleNarratingTense("A broad quiet river.").label).toBe("unknown");
  });
  test("paragraph segmentation excludes headings, code and blockquotes, retaining exact text and offsets", () => {
    const input = [
      {
        kind: "heading" as const,
        text: "Heading",
        pos: 1,
        paragraph: 1,
        section: 0,
      },
      {
        kind: "paragraph" as const,
        text: "Exact prose.",
        pos: 10,
        paragraph: 1,
        section: 0,
      },
      {
        kind: "quote" as const,
        text: "Quoted prose",
        pos: 30,
        paragraph: 2,
        section: 0,
      },
      {
        kind: "code" as const,
        text: "const x = 1",
        pos: 50,
        paragraph: 3,
        section: 0,
      },
      {
        kind: "paragraph" as const,
        text: "Next prose.",
        pos: 80,
        paragraph: 4,
        section: 1,
      },
    ];
    const passages = paragraphPassages(input);
    expect(passages).toHaveLength(2);
    expect(passages[0]).toMatchObject({
      text: "Exact prose.",
      from: 10,
      to: 22,
      next: "Next prose.",
    });
    expect(passages[1].previous).toBe("Exact prose.");
  });
  test("one bounded call caches paragraph scores with full distributions and the deliberate-shift reading", async () => {
    const cache: ParagraphCache = new Map();
    let calls = 0;
    const result = await classifyParagraphs(
      [passage()],
      context,
      cache,
      async (request) => {
        calls++;
        return {
          ok: true,
          model: "jev-test",
          answers: answers(request, TENSE_OPTIONS[2]),
        };
      },
      undefined,
      () => 123,
    );
    expect(result).toEqual({
      ok: true,
      remaining: false,
      accepted: 1,
      stale: false,
      excludedIds: [],
    });
    const [review] = readParagraphReviews([passage()], context, cache);
    expect(review.at).toBe(123);
    expect(review.model).toBe("jev-test");
    expect(review.scores.evidence.value).toBe(7.5);
    expect(review.scores.voice.source).toBe("jev");
    expect(review.scores.pacing.probabilities).toEqual({
      "0": 0.05,
      "1": 0.05,
      "2": 0.05,
      "3": 0.8,
      "4": 0.05,
    });
    expect(review.tense.label).toBe("deliberate-shift");
    expect(review.tense.note).toContain("writer decides");
    await classifyParagraphs([passage()], context, cache, async () => {
      calls++;
      return { ok: false };
    });
    expect(calls).toBe(1);
  });
  test("editing the paragraph, neighbours or brief invalidates the model reading; moving offsets does not", async () => {
    const cache: ParagraphCache = new Map();
    const original = {
      ...passage(),
      previous: "Earlier scene.",
      next: "Next scene.",
    };
    await classifyParagraphs([original], context, cache, async (request) => ({
      ok: true,
      answers: answers(request),
    }));
    for (const changed of [
      { ...original, text: `${original.text} ` },
      { ...original, previous: "Changed scene." },
      { ...original, next: "Changed ending." },
    ])
      expect(
        readParagraphReviews([changed], context, cache)[0].scores.voice.source,
      ).toBe("rule");
    expect(
      readParagraphReviews(
        [original],
        { ...context, audience: "Experts" },
        cache,
      )[0].scores.voice.source,
    ).toBe("rule");
    const moved = { ...original, id: "new-position", from: 900, to: 990 };
    expect(readParagraphReviews([moved], context, cache)[0]).toMatchObject({
      passage: moved,
      model: "judgement model",
    });
    expect(paragraphReviewKey(original, context)).toBe(
      paragraphReviewKey(original, {
        voice: context.voice,
        goal: context.goal,
        audience: context.audience,
      }),
    );
  });
  test("at most 12 paragraphs and 60 questions are sent in one invocation", async () => {
    const passages = Array.from({ length: 25 }, (_, index) =>
      passage(`She was in room ${index}.`, index),
    );
    let calls = 0;
    const cache: ParagraphCache = new Map();
    const result = await classifyParagraphs(
      passages,
      context,
      cache,
      async (request) => {
        calls++;
        expect(Object.keys(request.questions)).toHaveLength(60);
        return { ok: true, answers: answers(request) };
      },
    );
    expect(calls).toBe(1);
    expect(result.accepted).toBe(MAX_PARAGRAPHS_PER_BATCH);
    expect(result.remaining).toBe(true);
    expect(cache.size).toBe(MAX_PARAGRAPHS_PER_BATCH);
  });
  test("UTF-8 state bytes are bounded and an oversized paragraph is never silently truncated", () => {
    const oversized = passage("界".repeat(10000));
    const valid = passage("She was ready.", 2);
    const batch = buildParagraphBatch([oversized, valid], context, new Map());
    expect(
      new TextEncoder().encode(JSON.stringify(batch.request.state)).byteLength,
    ).toBeLessThanOrEqual(MAX_PARAGRAPH_STATE_BYTES);
    expect(batch.excludedIds).toEqual([oversized.id]);
    expect(batch.passages).toEqual([valid]);
    expect(batch.remaining).toBe(true);
    expect(batch.request.state.paragraph0).toBe(valid.text);
  });
  test("malformed, incomplete and wrong-kind responses never replace an honest local reading", async () => {
    for (const corrupt of [
      "missing",
      "nonfinite",
      "probability",
      "wrong-kind",
      "legend",
    ] as const) {
      const cache: ParagraphCache = new Map();
      const result = await classifyParagraphs(
        [passage()],
        context,
        cache,
        async (request) => {
          const response = answers(request);
          if (corrupt === "missing") delete response.p0_voice;
          else if (corrupt === "nonfinite")
            response.p0_voice = { ...response.p0_voice, score: NaN };
          else if (corrupt === "probability")
            response.p0_voice = {
              ...response.p0_voice,
              probabilities: { "0": 1, "1": 1, "2": 1, "3": 1, "4": 1 },
            };
          else if (corrupt === "wrong-kind")
            response.p0_voice = {
              type: "noul",
              noul: 0.8,
            } as (typeof response)[string];
          else response.p0_voice = { ...response.p0_voice, legend: {} };
          return { ok: true, answers: response };
        },
      );
      expect(result.accepted).toBe(0);
      expect(cache.size).toBe(0);
      expect(
        readParagraphReviews([passage()], context, cache)[0].scores.voice.value,
      ).toBeNull();
    }
  });
  test("stale asynchronous responses and failures are not cached or retried automatically", async () => {
    const cache: ParagraphCache = new Map();
    let current = true,
      calls = 0;
    const stale = await classifyParagraphs(
      [passage()],
      context,
      cache,
      async (request) => {
        calls++;
        current = false;
        return { ok: true, answers: answers(request) };
      },
      () => current,
    );
    expect(stale.stale).toBe(true);
    expect(cache.size).toBe(0);
    expect(calls).toBe(1);
    await classifyParagraphs([passage()], context, cache, async () => {
      calls++;
      throw new Error("Unavailable");
    });
    expect(cache.size).toBe(0);
    expect(calls).toBe(2);
  });
  test("mutating the supplied brief while a request is in flight cannot relabel its cached judgement", async () => {
    const cache: ParagraphCache = new Map();
    const brief = { ...context };
    const original = { ...brief };
    await classifyParagraphs([passage()], brief, cache, async (request) => {
      brief.audience = "Different audience";
      return { ok: true, answers: answers(request) };
    });
    expect(readParagraphReviews([passage()], brief, cache)[0].model).toBeNull();
    expect(
      readParagraphReviews([passage()], original, cache)[0].scores.voice.source,
    ).toBe("jev");
  });
  test("cached distributions are protected from callers mutating a displayed review", async () => {
    const cache: ParagraphCache = new Map();
    await classifyParagraphs([passage()], context, cache, async (request) => ({
      ok: true,
      answers: answers(request),
    }));
    const [review] = readParagraphReviews([passage()], context, cache);
    review.scores.voice.value = 0;
    review.scores.voice.probabilities!["3"] = 0;
    const [again] = readParagraphReviews([passage()], context, cache);
    expect(again.scores.voice.value).toBe(7.5);
    expect(again.scores.voice.probabilities!["3"]).toBe(0.8);
  });
  test("bimodal distributions stay visible instead of being converted to a misleading scalar label", async () => {
    const cache: ParagraphCache = new Map();
    await classifyParagraphs([passage()], context, cache, async (request) => {
      const response = answers(request);
      response.p0_pacing = {
        ...response.p0_pacing,
        score: 2,
        probabilities: { "0": 0.49, "1": 0, "2": 0.02, "3": 0, "4": 0.49 },
      };
      return { ok: true, answers: response };
    });
    expect(
      readParagraphReviews([passage()], context, cache)[0].scores.pacing
        .bimodal,
    ).toBe(true);
  });
});
