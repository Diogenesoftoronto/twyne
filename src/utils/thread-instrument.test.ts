import { expect, test } from "bun:test";
import {
  buildSpanIndex,
  embeddingThreadPairs,
  proposeThreadPairs,
  spanById,
} from "./span-index";
import {
  ruleThreads,
  verifyThreadPairs,
  THREAD_RELATIONS,
} from "./thread-instrument";
import type { Ask } from "./in-flow-tools";
const distribution = (label: string, p: number) =>
  Object.fromEntries(
    THREAD_RELATIONS.map((key) => [key, key === label ? p : (1 - p) / 7]),
  );
const repeated = "The ledger held every name we remembered.";
const index = buildSpanIndex([
  {
    from: 0,
    sectionId: "river",
    text: `${repeated} This was our only trace. ${repeated}`,
  },
]);

test("index nodes are exact manuscript spans with stable code-owned IDs", () => {
  expect(index.spans).toHaveLength(3);
  const source = `${repeated} This was our only trace. ${repeated}`;
  for (const span of index.spans)
    expect(source.slice(span.from - 1, span.to - 1)).toBe(span.text);
  expect(spanById(index, "invented-model-node")).toBeNull();
  expect(buildSpanIndex([{ from: 0, text: source }], [], 1).limited).toBe(true);
});
test("offline threads distinguish literal repeats from unverified references", () => {
  const pairs = proposeThreadPairs(index, index.spans[0].id);
  const threads = ruleThreads(index, pairs);
  expect(threads.some((t) => t.hypothesis === "exact-wording")).toBe(true);
  expect(threads.some((t) => t.hypothesis === "reference")).toBe(true);
  expect(
    threads.every(
      (t) => t.source === "rule" && t.state === "candidate" && !t.relation,
    ),
  ).toBe(true);
  expect(
    ruleThreads(index, [
      {
        id: "bad",
        firstId: index.spans[0].id,
        secondId: "invented",
        hypothesis: "reference",
        observation: "",
        overlap: 0,
      },
    ]),
  ).toEqual([]);
});
test("Jev sees only indexed spans and selects relation labels with an exists question", async () => {
  const pair = proposeThreadPairs(index).find(
    (p) => p.hypothesis === "exact-wording",
  )!;
  let request: Parameters<Ask>[0] | undefined;
  const ask: Ask = async (input) => {
    request = input;
    return {
      ok: true,
      model: "jev-test",
      answers: {
        exists0: { type: "noul", noul: 0.93 },
        relation0: {
          type: "choice",
          choice: "repeats",
          probabilities: distribution("repeats", 0.88),
          confidence: 0.8,
        },
      },
    };
  };
  const threads = await verifyThreadPairs(index, [pair], ask);
  expect(request!.questions.exists0.type).toBe("noul");
  expect(request!.questions.relation0).toMatchObject({
    type: "choice",
    criteria: [...THREAD_RELATIONS],
  });
  expect(Object.keys(request!.state.spans as object)).toEqual([
    pair.firstId,
    pair.secondId,
  ]);
  expect(threads[0]).toMatchObject({
    state: "confirmed",
    relation: "repeats",
    probability: 0.88,
    exists: 0.93,
    source: "judgement",
  });
});
test("no-relation, low existence, malformed labels and unavailable judgement stay explicit", async () => {
  const pair = proposeThreadPairs(index).find(
    (p) => p.hypothesis === "exact-wording",
  )!;
  const judge =
    (label: string, exists: number): Ask =>
    async () => ({
      ok: true,
      answers: {
        exists0: { type: "noul", noul: exists },
        relation0: {
          type: "choice",
          choice: label,
          probabilities: distribution(label, 0.9),
          confidence: 0.9,
        },
      },
    });
  expect(
    (await verifyThreadPairs(index, [pair], judge("no real relation", 0.9)))[0]
      .state,
  ).toBe("no-relation");
  expect(
    (await verifyThreadPairs(index, [pair], judge("supports", 0.1)))[0].state,
  ).toBe("no-relation");
  expect(
    (await verifyThreadPairs(index, [pair], judge("invented relation", 0.9)))[0]
      .source,
  ).toBe("rule");
  expect(
    (
      await verifyThreadPairs(index, [pair], async () => {
        throw new Error("offline");
      })
    )[0].state,
  ).toBe("candidate");
});
test("punctuation and named pronouns are not erased to manufacture exact duplicates", () => {
  const differentlyPunctuated = buildSpanIndex([
    {
      from: 0,
      text: "The ledger held every name? The ledger held every name.",
    },
  ]);
  expect(
    proposeThreadPairs(differentlyPunctuated).some(
      (p) => p.hypothesis === "exact-wording",
    ),
  ).toBe(false);
});

test("embedding proposals preserve real spans and measured cosine without relation claims", () => {
  const ids = index.spans.map((s) => s.id);
  const pairs = embeddingThreadPairs(
    index,
    ids[0],
    ids,
    [
      [1, 0],
      [0.8, 0.6],
      [0, 1],
    ],
    "local-test",
  );
  expect(pairs).toHaveLength(1);
  expect(pairs[0].embedding?.cosine).toBeCloseTo(0.8);
  expect(ruleThreads(index, pairs)[0]).toMatchObject({
    source: "on-device",
    state: "candidate",
  });
  expect(
    embeddingThreadPairs(
      index,
      ids[0],
      ids,
      [
        [1, 0],
        [NaN, 1],
        [0, 1],
      ],
      "local-test",
    ),
  ).toEqual([]);
  expect(
    embeddingThreadPairs(
      index,
      ids[0],
      [ids[0], "invented"],
      [
        [1, 0],
        [1, 0],
      ],
      "local-test",
    ),
  ).toEqual([]);
});
test("partial, inconsistent, extra, unnormalized and invalid Choice distributions remain unverified", async () => {
  const pair = proposeThreadPairs(index)[0];
  for (const probabilities of [
    { repeats: 0.88 },
    { ...distribution("supports", 0.9) },
    { ...distribution("repeats", 0.9), invented: 0 },
    Object.fromEntries(THREAD_RELATIONS.map((k) => [k, 0.5])),
    { ...distribution("repeats", 0.9), answers: NaN },
  ]) {
    const result = await verifyThreadPairs(index, [pair], async () => ({
      ok: true,
      answers: {
        exists0: { type: "noul", noul: 0.9 },
        relation0: {
          type: "choice",
          choice: "repeats",
          probabilities,
          confidence: 0.8,
        },
      },
    }));
    expect(result[0].source).toBe("rule");
  }
});
