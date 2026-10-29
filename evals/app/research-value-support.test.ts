import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { corpusHash } from "./arize";
import { agreementFor } from "./agreement";
import type { ClairicAsk } from "./judges";
import { researchSourcesSuite } from "./suites/research";
import {
  clairicValueSupport,
  validateValueManifest,
  valueEntry,
  VALUE_EVALUATOR,
  VALUE_METRIC,
} from "./suites/research-value-support";

const cases = researchSourcesSuite.load();
const claim = (id: string) => cases.find((c) => c.case_id.endsWith(`:${id}`))!;
const source = (snippet: string) => ({
  title: "Primary source",
  url: "https://example.org",
  snippet,
});
function fake(
  value: unknown,
  quote: string,
  overrides: Record<string, unknown> = {},
) {
  const requests: Parameters<ClairicAsk>[0][] = [];
  const extract: ClairicAsk = async (request) => {
    requests.push(request);
    const start = request.state!.indexOf(quote);
    return {
      ok: true,
      answers: {
        value: { value, confidence: 0.99, p_null: 0.001, ...overrides },
        evidence: {
          value: quote,
          confidence: 0.99,
          p_null: 0.001,
          span: [start, start + quote.length],
        },
      },
    };
  };
  return { extract, requests };
}

test("every gold claim is explicitly reviewed; corpus changes cannot silently inherit checks", () => {
  expect(cases).toHaveLength(126);
  expect(cases.filter((c) => valueEntry(c).check)).toHaveLength(47);
  expect(() => validateValueManifest(cases)).not.toThrow();
  expect(() =>
    validateValueManifest([...cases, { case_id: "new", fact: "Two things" }]),
  ).toThrow("Review");
  expect(() => validateValueManifest(cases.slice(1))).toThrow("stale");
  expect(() => validateValueManifest([...cases, cases[0]])).toThrow(
    "duplicate",
  );
  expect(() =>
    validateValueManifest(
      cases.map((c, i) => (i ? c : { ...c, fact: "Changed" })),
    ),
  ).toThrow("Review");
  const data = JSON.parse(
    readFileSync(
      new URL("./cases/research-value-checks.v2.json", import.meta.url),
      "utf8",
    ),
  );
  data.cases[claim("fire-start").case_id].check.expected = "1666-02-30";
  expect(() => validateValueManifest(cases, data)).toThrow("Invalid");
});

test("Rosetta uses the declared two-language gold without extracting an answer key", async () => {
  const text =
    "The Rosetta Stone records two languages, Egyptian and Greek, in three writing systems.";
  const f = fake(2, text);
  const scores = await researchSourcesSuite.score(
    { judge: null, jev: null, extract: f.extract },
    claim("rosetta-languages"),
    { ranked: [source(text)] },
  );
  expect(scores[VALUE_METRIC]).toMatchObject({ score: 1, label: "supported" });
  expect(scores.clairic_fact).toBeUndefined();
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].fields.value).toMatchObject({
    type: "number",
    unit: "languages",
  });
  expect(f.requests[0].fields.value.instructions).toContain(
    "not the number of scripts",
  );
  // Neither expected value nor fact text is sent as a gold-reading request.
  expect(Object.keys(f.requests[0].fields)).toEqual(["value", "evidence"]);
});

test("'one another' is not a numeric claim and incurs no extraction", async () => {
  let calls = 0;
  const result = await clairicValueSupport(
    async () => {
      calls++;
      throw new Error("unexpected");
    },
    claim("plates-converge"),
    [source("Two plates move toward one another.")],
  );
  expect(result).toMatchObject({ score: null, label: "n/a" });
  expect(calls).toBe(0);
});

test("Webb requests an L2 text identifier, independently of its 1.5-million-km distance", async () => {
  const quote = "Webb orbits L2, 1.5 million kilometers from Earth.";
  const f = fake("L2", quote);
  expect(
    await clairicValueSupport(f.extract, claim("webb-orbit"), [source(quote)]),
  ).toMatchObject({ score: 1 });
  expect(f.requests[0].fields.value.type).toBe("text");
  expect(f.requests[0].fields.value.instructions).toContain("not its ordinal");
});

test("Darwin's ship arrival is explicit; independent source readings retain both dates", async () => {
  const wrong = "Darwin reached Shrewsbury on 4 October 1836.";
  const right = "The Beagle returned to England on 2 October 1836.";
  const f = fake("1836-10-04", wrong);
  const g = fake("1836-10-02", right);
  let i = 0;
  const result = await clairicValueSupport(
    (request) => (i++ ? g : f).extract(request),
    claim("darwin-return"),
    [source(wrong), source(right)],
  );
  expect(result).toMatchObject({ score: 1, items: { source1: 0, source2: 1 } });
  expect(f.requests[0].fields.value.instructions).toContain(
    "not the date Darwin reached his home",
  );
  expect(g.requests[0].state).not.toContain("Shrewsbury");
  expect(
    JSON.parse(result.explanation!).readings.map(
      (r: { value: string }) => r.value,
    ),
  ).toEqual(["1836-10-04", "1836-10-02"]);
});

test("an invented 1966 century cannot score against a 1666 evidence span", async () => {
  const quote = "The Great Fire of London began on 2 September 1666.";
  const f = fake("1966-09-02", quote);
  const result = await clairicValueSupport(f.extract, claim("fire-start"), [
    source(quote),
  ]);
  expect(result).toMatchObject({ score: null, label: "uncertain" });
  expect(JSON.parse(result.explanation!).readings[0].status).toBe("ungrounded");
  const correct = fake("1666-09-02", quote);
  expect(
    await clairicValueSupport(correct.extract, claim("fire-start"), [
      source(quote),
    ]),
  ).toMatchObject({ score: 1 });
});

test("Chicago asks for opening, not closure; ambiguous snippets remain attributed to their source", async () => {
  const quote = "Opening: May 1, 1893. Closure: October 30, 1893.";
  const f = fake("1893-05-01", quote);
  const result = await clairicValueSupport(
    f.extract,
    claim("chicago-opening"),
    [source(quote)],
  );
  expect(result.score).toBe(1);
  expect(f.requests[0].fields.value.instructions).toContain(
    "not the closing date",
  );
  expect(JSON.parse(result.explanation!).readings[0]).toMatchObject({
    rank: 1,
    url: "https://example.org",
    evidence: quote,
    truncated: false,
  });
  const mixed = fake("1893-05-30", quote);
  expect(
    await clairicValueSupport(mixed.extract, claim("chicago-opening"), [
      source(quote),
    ]),
  ).toMatchObject({ score: null, label: "uncertain" });
});

test("eligibility gates apply to matching and differing answers; missing probabilities are errors", async () => {
  const text = "There are five Bennet daughters; there are six other people.";
  for (const value of [5, 6])
    for (const overrides of [{ confidence: 0.1 }, { p_null: 0.8 }]) {
      const f = fake(value, text, overrides);
      expect(
        await clairicValueSupport(f.extract, claim("austen-sisters"), [
          source(text),
        ]),
      ).toMatchObject({ score: null, label: "uncertain" });
    }
  for (const overrides of [
    { confidence: undefined },
    { p_null: undefined },
    { confidence: 2 },
    { value: "five" },
  ]) {
    const f = fake(5, text, overrides);
    expect(
      await clairicValueSupport(f.extract, claim("austen-sisters"), [
        source(text),
      ]),
    ).toMatchObject({ score: null, label: "clairic-error" });
  }
});

test("nonliteral evidence, invalid spans, and ungrounded unit conversions cannot yield a pass", async () => {
  const quote = "There are five Bennet daughters.";
  const f = fake(5, "There are five daughters.");
  expect(
    await clairicValueSupport(f.extract, claim("austen-sisters"), [
      source(quote),
    ]),
  ).toMatchObject({ score: null });
  const badUnit = fake(5, quote, { unit: "scripts" });
  expect(
    await clairicValueSupport(badUnit.extract, claim("austen-sisters"), [
      source(quote),
    ]),
  ).toMatchObject({ score: null });
  const invented = fake(6, quote);
  expect(
    await clairicValueSupport(invented.extract, claim("austen-sisters"), [
      source(quote),
    ]),
  ).toMatchObject({ score: null });
  for (const text of [
    "There are fifty-five Bennet daughters.",
    "There are five hundred Bennet daughters.",
    "There are twenty five Bennet daughters.",
  ]) {
    expect(
      await clairicValueSupport(
        fake(5, text).extract,
        claim("austen-sisters"),
        [source(text)],
      ),
    ).toMatchObject({ score: null });
  }
  const numeric = "Number of Bennet daughters: 5.";
  expect(
    await clairicValueSupport(
      fake(5, numeric).extract,
      claim("austen-sisters"),
      [source(numeric)],
    ),
  ).toMatchObject({ score: 1 });
});

test("year/month precision and per-check absolute tolerances are declared, not inferred", async () => {
  const year = "Frankenstein was first published anonymously in 1818.";
  expect(
    (
      await clairicValueSupport(
        fake("1818-11-19", year).extract,
        claim("frank-anonymous"),
        [source(year)],
      )
    ).score,
  ).toBe(1);
  const month = "Berners-Lee wrote the proposal in March 1989.";
  expect(
    (
      await clairicValueSupport(
        fake("1989-03-01", month).extract,
        claim("web-proposal"),
        [source(month)],
      )
    ).score,
  ).toBe(1);
  const angle = "The lunar orbital plane is inclined by 5.145 degrees.";
  expect(
    (
      await clairicValueSupport(
        fake(5.145, angle).extract,
        claim("eclipse-inclination"),
        [source(angle)],
      )
    ).score,
  ).toBe(1);
  const count = "There are 5.1 Bennet daughters.";
  expect(
    (
      await clairicValueSupport(
        fake(5.1, count).extract,
        claim("austen-sisters"),
        [source(count)],
      )
    ).score,
  ).toBe(0);
});

test("nulls, clipping, and partial provider failures remain distinguishable", async () => {
  const absent: ClairicAsk = async () => ({
    ok: true,
    answers: {
      value: { value: null, p_null: 0.99 },
      evidence: { value: null, p_null: 0.99 },
    },
  });
  expect(
    await clairicValueSupport(absent, claim("fire-start"), [
      source("Nothing here."),
    ]),
  ).toMatchObject({ score: 0, label: "not stated" });
  expect(
    await clairicValueSupport(absent, claim("fire-start"), [
      source("x".repeat(13000)),
    ]),
  ).toMatchObject({ score: null, label: "uncertain" });
  const text = "The fire began on 2 September 1666.";
  let calls = 0;
  const f = fake("1666-09-02", text);
  const result = await clairicValueSupport(
    async (request) =>
      ++calls === 1 ? f.extract(request) : { ok: false, error: "rate limited" },
    claim("fire-start"),
    [source(text), source(text), source(text)],
  );
  expect(result).toMatchObject({
    score: null,
    label: "clairic-error",
    items: { source1: 1 },
  });
  expect(calls).toBe(2);
});

test("new dataset rows and metric names enforce the version boundary", () => {
  const row = researchSourcesSuite.example(claim("rosetta-languages"));
  expect(row.clairic_evaluator).toBe(VALUE_EVALUATOR);
  expect(researchSourcesSuite.evaluatorVersions).toEqual({
    [VALUE_METRIC]: VALUE_EVALUATOR,
  });
  const oldRow = { ...row };
  delete oldRow.clairic_evaluator;
  delete oldRow.value_check;
  expect(corpusHash([row])).not.toBe(corpusHash([oldRow]));
  const agreement = agreementFor("research-sources", [
    {
      case_id: "c",
      scores: {
        settles: { score: 1 },
        jev_settles: { score: 1 },
        [VALUE_METRIC]: { score: 1 },
      },
    },
  ]);
  expect(agreement.find((c) => c.name.includes("v2"))?.evaluators).toContain(
    VALUE_METRIC,
  );
  expect(
    agreement.find((c) => c.name === "a source settles the claim")?.evaluators,
  ).not.toContain(VALUE_METRIC);
});
