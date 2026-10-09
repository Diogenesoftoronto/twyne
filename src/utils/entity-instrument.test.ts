import { expect, test } from "bun:test";
import {
  buildEntityInstrumentIndex,
  buildEntityInstrumentRequest,
  readEntityInstrumentResponse,
  classifyEntityInstrument,
  UNKNOWN_SPEAKER,
} from "./entity-instrument";
import type { Segments } from "./living-desk/segment";

const manuscript = (): Segments => ({
  plainText: "",
  sections: [
    { index: 0, title: "Arrival", from: 1, to: 200, words: 20 },
    { index: 1, title: "Departure", from: 200, to: 400, words: 20 },
  ],
  blocks: [
    {
      kind: "paragraph",
      text: "I met Mara and Tom. Mara said, “I keep the blue coat.”",
      pos: 1,
      paragraph: 1,
      section: 0,
    },
    {
      kind: "paragraph",
      text: "Later, Mara visited Tom. Mara wore a red coat. Tom said, “The road is clear.”",
      pos: 200,
      paragraph: 2,
      section: 1,
    },
  ],
});
const input = (
  kind: "relationship" | "continuity" | "attribution",
  attribute = "",
) => {
  const index = buildEntityInstrumentIndex(manuscript());
  return {
    index,
    request: buildEntityInstrumentRequest(
      index,
      index.candidates.find((candidate) => candidate.name === "Mara")!.id,
      kind,
      "brief-v1",
      "Two travellers",
      attribute,
    ),
  };
};
const answer = (request: ReturnType<typeof input>["request"]) => ({
  ok: true,
  model: "fake-jev",
  answers: Object.fromEntries(
    request.specs.map((spec) => [
      spec.id,
      {
        type: "choice",
        choice: spec.options.at(-1),
        confidence: 1,
        probabilities: Object.fromEntries(
          spec.options.map((option, at) => [
            option,
            at === spec.options.length - 1 ? 1 : 0,
          ]),
        ),
      },
    ]),
  ),
});

test("code builds candidate presence and exact passage/dialogue spans without a model", () => {
  const index = buildEntityInstrumentIndex(manuscript());
  expect(
    index.candidates.find((candidate) => candidate.name === "Mara")?.counts,
  ).toEqual([2, 2]);
  const quote = index.evidence.find((span) => span.kind === "dialogue")!;
  expect(quote.text).toBe("I keep the blue coat.");
  expect(manuscript().blocks[0].text.slice(quote.from - 1, quote.to - 1)).toBe(
    quote.text,
  );
  expect(quote.provenance).toBe("rule");
});
test("inline atoms preserve code-selected dialogue positions", () => {
  const source = manuscript();
  source.blocks = [
    {
      kind: "paragraph",
      text: "I met Mara. “Hello.”",
      pos: 1,
      paragraph: 1,
      section: 0,
      runs: [
        { offset: 0, length: 11, pos: 1 },
        { offset: 11, length: 9, pos: 13 },
      ],
    },
  ];
  const quote = buildEntityInstrumentIndex(source).evidence.find(
    (span) => span.kind === "dialogue",
  )!;
  expect(quote.from).toBe(15);
  expect(quote.to).toBe(21);
});
test("relationship readings require real co-presence and remain per section", () => {
  const { index, request } = input("relationship");
  expect(request.specs).toHaveLength(2);
  for (const spec of request.specs) {
    expect(spec.options).toContain("No relationship established");
    expect(spec.options).toContain("Unknown or ambiguous");
    expect(
      spec.evidenceIds.every((id) =>
        index.evidence.some((span) => span.id === id),
      ),
    ).toBe(true);
  }
});
test("continuity names the attribute and compares exact pairs without inventing values", () => {
  const { index, request } = input("continuity", "coat colour");
  expect(request.state.attribute).toBe("coat colour");
  expect(request.specs).toHaveLength(1);
  expect(request.specs[0].evidenceIds).toEqual(
    index.evidence
      .filter((span) => span.kind === "passage")
      .map((span) => span.id),
  );
  expect(request.specs[0].options).toContain("Attribute not established");
  expect(() => input("continuity")).toThrow("Name an attribute");
});
test("blind attribution withholds speaker tags and preserves a real unknown option", () => {
  const { request } = input("attribution");
  expect(request.specs).toHaveLength(2);
  const texts = Object.entries(request.state)
    .filter(([key]) => key.startsWith("q"))
    .map(([, text]) => text);
  expect(texts).toEqual(["I keep the blue coat.", "The road is clear."]);
  expect(texts.every((text) => !text.includes("said"))).toBe(true);
  expect(
    request.specs.every((spec) => spec.options.includes(UNKNOWN_SPEAKER)),
  ).toBe(true);
});
test("response evidence and entities are projected from code even if provider adds bogus source IDs", () => {
  const { request } = input("relationship");
  const response = answer(request);
  Object.assign(response.answers.q0, { evidenceIds: ["invented"], from: 9999 });
  const result = readEntityInstrumentResponse(request, response, 10)!;
  expect(result.readings[0].evidenceIds).toEqual(request.specs[0].evidenceIds);
  expect(result.readings[0].choice).toBe("Unknown or ambiguous");
  expect(result.readings[0].probabilities).toEqual(
    response.answers.q0.probabilities,
  );
  expect("from" in result.readings[0]).toBe(false);
});
test("malformed, non-finite, partial and invented-option answers cannot become readings", () => {
  const { request } = input("relationship");
  for (const malformed of [
    { ...answer(request), answers: {} },
    {
      ...answer(request),
      answers: {
        ...answer(request).answers,
        q0: { ...answer(request).answers.q0, choice: "invented" },
      },
    },
    {
      ...answer(request),
      answers: {
        ...answer(request).answers,
        q0: { ...answer(request).answers.q0, confidence: NaN },
      },
    },
    {
      ...answer(request),
      answers: {
        ...answer(request).answers,
        q0: { ...answer(request).answers.q0, probabilities: { Unknown: 1 } },
      },
    },
  ])
    expect(readEntityInstrumentResponse(request, malformed)).toBeNull();
});
test("text, offsets, brief and attribute changes invalidate exact result identity", () => {
  const { index, request } = input("continuity", "coat colour");
  expect(
    buildEntityInstrumentRequest(
      index,
      request.specs[0].entityIds[0],
      "continuity",
      "new-brief",
      "Two travellers",
      "coat colour",
    ).key,
  ).not.toBe(request.key);
  expect(
    buildEntityInstrumentRequest(
      index,
      request.specs[0].entityIds[0],
      "continuity",
      "brief-v1",
      "Two travellers",
      "age",
    ).key,
  ).not.toBe(request.key);
  const source = manuscript();
  source.blocks[0].pos++;
  expect(buildEntityInstrumentIndex(source).key).not.toBe(index.key);
  source.blocks[0].text += " A change.";
  expect(buildEntityInstrumentIndex(source).key).not.toBe(index.key);
});
test("late cancelled/context-stale responses are dropped and requests are frozen", async () => {
  const { request } = input("relationship");
  let current = true;
  const result = await classifyEntityInstrument(
    request,
    async (sent) => {
      expect(sent.state.entity).toBe("Mara");
      request.state.entity = "changed by caller";
      current = false;
      return answer(request);
    },
    () => current,
  );
  expect(result).toBeNull();
});
test("oversized source passages are excluded rather than truncated and no transport runs for empty requests", async () => {
  const source = manuscript();
  source.blocks[0].text = `I met Mara and Tom. ${"é".repeat(16000)}`;
  const index = buildEntityInstrumentIndex(source);
  const request = buildEntityInstrumentRequest(
    index,
    index.candidates.find((candidate) => candidate.name === "Mara")!.id,
    "relationship",
    "ctx",
  );
  expect(request.excluded).toBeGreaterThan(0);
  expect(
    new TextEncoder().encode(JSON.stringify(request.state)).byteLength,
  ).toBeLessThan(28001);
  const empty = { ...request, specs: [], questions: {} };
  let called = false;
  expect(
    await classifyEntityInstrument(
      empty,
      async () => {
        called = true;
        return { ok: true };
      },
      () => true,
    ),
  ).toBeNull();
  expect(called).toBe(false);
});
