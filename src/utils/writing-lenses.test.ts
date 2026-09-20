import { describe, expect, test } from "bun:test";
import {
  promiseId,
  runWritingLens,
  WRITING_LENSES,
  type WritingLensCaller,
  type WritingLensInput,
} from "./writing-lenses";
import type { SystemOneQuestion } from "./system-one";

function answer(
  q: SystemOneQuestion,
  selected?: string,
  uncertain = false,
): unknown {
  if (q.type === "noul") return { type: "noul", noul: uncertain ? 0.5 : 0.95 };
  const value =
    selected && q.criteria.includes(selected) ? selected : q.criteria[0];
  return {
    type: "choice",
    choice: value,
    confidence: uncertain ? 0.2 : 0.95,
    probabilities: Object.fromEntries(
      q.criteria.map((option) => [
        option,
        uncertain ? 1 / q.criteria.length : option === value ? 1 : 0,
      ]),
    ),
  };
}
function caller(selected?: string, uncertain = false): WritingLensCaller {
  return async ({ questions }) => ({
    ok: true,
    answers: Object.fromEntries(
      Object.entries(questions).map(([key, q]) => [
        key,
        answer(q, selected, uncertain),
      ]),
    ),
  });
}
const input: WritingLensInput = {
  draft:
    "Why did the plan fail?\n\nThe plan failed because the bridge was closed.",
  previousDraft: "The plan failed.",
  voiceSamples: [{ id: "v1", text: "The bridge grinned at our little maps." }],
  scraps: [{ id: "s1", text: "The bridge had been closed since June." }],
  notes: [
    { id: "n1", text: "Explain the background first." },
    { id: "n2", text: "Start with the action." },
  ],
  revisions: [
    { id: "r1", text: "A plan." },
    { id: "r2", text: "A failed plan." },
  ],
  sources: [
    {
      id: "source1",
      claim: "The bridge was closed.",
      source: "The bridge closed in June.",
      previousClaim: "The bridge may have been closed.",
    },
  ],
};

describe("writing lenses", () => {
  test("circling sends bounded focus and asks about that passage or question", async () => {
    let observed = false;
    await runWritingLens(
      "circling",
      { ...input, focus: "the bridge question ".repeat(200) },
      async (request) => {
        observed = true;
        expect(request.state.focus).toBe(
          "the bridge question ".repeat(200).trim().slice(0, 2000),
        );
        expect(request.questions.direction.instructions).toContain(
          "When `focus` is supplied",
        );
        expect(request.questions.direction.instructions).toContain(
          "Not enough evidence",
        );
        return caller()(request);
      },
    );
    expect(observed).toBe(true);
  });
  test("every lens runs using bounded typed questions and supplied quotes", async () => {
    for (const lens of WRITING_LENSES) {
      const result = await runWritingLens(lens.id, input, caller());
      expect(result.status).toBe("complete");
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.coverage.length).toBeGreaterThan(0);
      for (const finding of result.findings)
        expect(finding.passage).toBeTruthy();
    }
  });

  test("reader sees no future text, even through unused state fields", async () => {
    const requests: Parameters<WritingLensCaller>[0][] = [];
    await runWritingLens(
      "reader",
      {
        ...input,
        draft: "First.\n\nSecond.\n\nENDING SECRET.",
        previousDraft: "ENDING SECRET.",
        focus: "ENDING SECRET.",
      },
      async (request) => {
        requests.push(request);
        return caller()(request);
      },
    );
    expect(requests.length).toBe(3);
    expect(JSON.stringify(requests[0])).not.toContain("Second.");
    expect(JSON.stringify(requests[0])).not.toContain("ENDING SECRET");
    expect(JSON.stringify(requests[1])).not.toContain("ENDING SECRET");
    expect(requests[2].state.earlierText).toBe("First.\n\nSecond.");
    expect(requests[2].state.passage).toBe("ENDING SECRET.");
  });

  test("uncertain alternatives require review rather than decisive verdicts", async () => {
    const result = await runWritingLens(
      "revision",
      input,
      caller(undefined, true),
    );
    expect(
      result.findings.every(
        (f) => f.needsReview && f.title.startsWith("Review:"),
      ),
    ).toBe(true);
    expect(result.notice).toContain("Uncertain");
  });

  test("uncertain promise presence is reviewed despite a concentrated payoff", async () => {
    const result = await runWritingLens(
      "promises",
      input,
      async ({ questions }) => ({
        ok: true,
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, q]) => [
            key,
            q.type === "noul" ? { type: "noul", noul: 0.5 } : answer(q),
          ]),
        ),
      }),
    );
    expect(result.findings.every((f) => f.needsReview)).toBe(true);
  });

  test("invalid answers and transport failures never become reassuring results", async () => {
    for (const value of [
      null,
      {
        type: "choice",
        choice: "invented",
        confidence: 1,
        probabilities: { invented: 1 },
      },
      {
        type: "choice",
        choice: "Clarity: improved",
        confidence: 1,
        probabilities: {},
      },
    ]) {
      const result = await runWritingLens(
        "revision",
        input,
        async ({ questions }) => ({
          ok: true,
          answers: Object.fromEntries(
            Object.keys(questions).map((key) => [key, value]),
          ),
        }),
      );
      expect(result.status).toBe("unavailable");
      expect(result.findings).toEqual([]);
    }
    const failed = await runWritingLens("reader", input, async () => {
      throw new Error("offline");
    });
    expect(failed.status).toBe("unavailable");
  });

  test("missing evidence requires no network calls", async () => {
    let calls = 0;
    const call: WritingLensCaller = async () => {
      calls++;
      return { ok: false };
    };
    for (const lens of WRITING_LENSES) {
      const result = await runWritingLens(lens.id, { draft: "" }, call);
      expect(result.status).toBe("missing-input");
    }
    expect(calls).toBe(0);
  });

  test("no matching scraps or advice yields no fabricated finding", async () => {
    for (const id of ["scraps", "room"] as const) {
      const result = await runWritingLens(
        id,
        input,
        caller("No relevant match"),
      );
      expect(result.status).toBe("complete");
      expect(result.findings).toEqual([]);
    }
  });

  test("intentionally open promises are excluded using stable content IDs", async () => {
    const first = "Why did the plan fail?";
    const result = await runWritingLens(
      "promises",
      { ...input, intentionalPromises: [promiseId(first)] },
      caller(),
    );
    expect(result.findings.some((f) => f.passage === first)).toBe(false);
    const changed = promiseId(first + " Again?");
    expect(changed).not.toBe(promiseId(first));
  });

  test("absence of a promise ignores an unused malformed payoff answer", async () => {
    const result = await runWritingLens(
      "promises",
      input,
      async ({ questions }) => ({
        ok: true,
        answers: Object.fromEntries(
          Object.entries(questions).map(([key, q]) => [
            key,
            q.type === "noul" ? { type: "noul", noul: 0.05 } : null,
          ]),
        ),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.findings).toEqual([]);
    expect(result.notice).toBeUndefined();
  });

  test("omitted ending is disclosed and unmatched promises need review", async () => {
    const result = await runWritingLens(
      "promises",
      { draft: `A promise.\n\n${"x".repeat(17_000)}\n\nThe payoff.` },
      caller("No relevant match"),
    );
    expect(result.notice).toContain("Partial coverage");
    expect(result.findings.every((f) => f.needsReview)).toBe(true);
  });

  test("reader and source checks have bounded request counts with honest limits", async () => {
    let calls = 0;
    const call: WritingLensCaller = async (request) => {
      calls++;
      return caller()(request);
    };
    const result = await runWritingLens(
      "reader",
      {
        draft: Array.from({ length: 20 }, (_, i) => `Paragraph ${i}`).join(
          "\n\n",
        ),
      },
      call,
    );
    expect(calls).toBe(8);
    expect(result.notice).toContain("first 8 of 20");
    expect(result.coverage).toContain("8 of 20");
  });

  test("partial service failure preserves valid findings and discloses missing work", async () => {
    let calls = 0;
    const result = await runWritingLens("reader", input, async (request) =>
      ++calls === 1 ? caller()(request) : { ok: false },
    );
    expect(result.status).toBe("complete");
    expect(result.findings.length).toBe(1);
    expect(result.notice).toContain("1 judgements could not");
  });

  test("research compares exact explicit current and previous claims with supplied source", async () => {
    let state: Record<string, unknown> = {};
    const result = await runWritingLens("research", input, async (request) => {
      state = request.state;
      return caller("Claim exceeds supplied evidence")(request);
    });
    expect(state.currentClaim).toBe(input.sources![0].claim);
    expect(state.previousClaim).toBe(input.sources![0].previousClaim);
    expect(state.source).toBe(input.sources![0].source);
    expect(result.findings[0].passage).toBe(input.sources![0].claim);
    expect(result.findings[0].relatedPassage).toBe(input.sources![0].source);
  });

  test("circling appends current text and uses chronological last four snapshots", async () => {
    let state: Record<string, unknown> = {};
    const revisions = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      text: `Draft ${i}`,
    }));
    const result = await runWritingLens(
      "circling",
      { draft: "Current", revisions },
      async (request) => {
        state = request.state;
        return caller()(request);
      },
    );
    expect(
      (state.revisions as Array<{ text: string }>).map((r) => r.text),
    ).toEqual(["Draft 3", "Draft 4", "Draft 5", "Current"]);
    expect(result.notice).toContain("Latest 4 of 7");
    expect(revisions.length).toBe(6);
  });
});
