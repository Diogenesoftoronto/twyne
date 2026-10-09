import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { segmentDocument, posAtOffset, type Block } from "./segment";
import {
  agreementFix,
  analyzeStance,
  classifyStance,
  STANCE_OPTIONS,
  type StanceCache,
} from "./stance";
import { analyzeNaming, nameDistance } from "./naming";
import { analyzeStyle } from "./style-sheet";
import { analyzePresence } from "./presence";
import {
  buildScore,
  rankFindings,
  ruleValues,
  consistencyPenalty,
  type Confirmation,
  RULE_WEIGHTS,
} from "./score";
import { analyzeDesk } from "./analyze";
import { deliberateBaseline, respectDeliberate } from "./deliberate";

const block = (text: string, paragraph = 1, section = 0): Block => ({
  text,
  paragraph,
  section,
  pos: paragraph * 1000,
  kind: "paragraph",
});
const prefix =
  "I walked. My map helped me. I remembered my home. I knew myself. I kept my notes. ";

test("segmentation retains heading sections, block exclusions and inline atom positions", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      text: { group: "inline" },
      paragraph: { group: "block", content: "inline*" },
      heading: { group: "block", content: "inline*" },
      blockquote: { group: "block", content: "block+" },
      codeBlock: { group: "block", content: "text*" },
      atom: { group: "inline", inline: true, atom: true },
    },
  });
  const p = schema.nodes.paragraph.create(null, [
    schema.text("Hello"),
    schema.nodes.atom.create(),
    schema.text(" world"),
  ]);
  const doc = schema.nodes.doc.create(null, [
    p,
    schema.nodes.heading.create(null, schema.text("Arrival")),
    schema.nodes.blockquote.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("We believe.")),
    ),
    schema.nodes.codeBlock.create(null, schema.text("we")),
  ]);
  const data = segmentDocument(doc);
  expect(data.blocks.map((b) => b.kind)).toEqual([
    "paragraph",
    "heading",
    "quote",
    "code",
  ]);
  expect(data.sections.map((s) => s.title)).toEqual(["Opening", "Arrival"]);
  expect(data.blocks[0].text).toBe("Hello world");
  expect(posAtOffset(data.blocks[0], 5)).toBe(7);
  expect(posAtOffset(data.blocks[0], 5, true)).toBe(6);
  expect(posAtOffset(data.blocks[0], 11, true)).toBe(13);
  expect(data.blocks[2].paragraph).toBe(2);
  const startsWithHeading = segmentDocument(
    schema.nodes.doc.create(
      null,
      schema.nodes.heading.create(null, schema.text("First")),
    ),
  );
  expect(startsWithHeading.sections).toHaveLength(1);
});

describe("stance", () => {
  test("rule labels separate author, reader, group and unknown; quotes and code are excluded", () => {
    const result = analyzeStance([
      block(
        prefix +
          'We argue for a bridge. As we\'ll see, it helps. We both visited. We wandered. “We think it is fine,” she said. "Our thesis is fine."',
      ),
      { ...block("we argue I I I"), kind: "quote" },
      { ...block("we believe I I I"), kind: "code" },
    ]);
    expect(result.plural).toBe(4);
    expect(result.finding?.count).toBe(1);
    expect(result.candidates.map((c) => c.occurrence.label)).toEqual([
      "editorial",
      "inclusive",
      "group",
      "unclassified",
    ]);
    expect(result.candidates[0].occurrence.fix).toBe("I");
  });
  test("threshold excludes mainly plural essays and fewer than three singular tokens", () => {
    expect(
      analyzeStance([block("I agree. We argue. We believe. We think.")])
        .finding,
    ).toBeNull();
    expect(
      analyzeStance([block("I agree with my friend. We think.")]).finding,
    ).toBeNull();
    expect(
      analyzeStance([block("I know my mind and myself. We think.")]).finding
        ?.count,
    ).toBe(1);
  });
  test("heading numerals are excluded and the metric names all singular pronouns accurately", () => {
    const result = analyzeStance([
      { ...block("I. Before the flood"), kind: "heading" },
      block("I brought my map with me. We argue here."),
    ]);
    expect(result.singular).toBe(3);
    expect(result.finding?.metric).toBe(
      "1 editorial “we” · 3 singular pronouns",
    );
  });
  test("inclusive, group and editorial phrases cover the prescribed rule forms", () => {
    for (const phrase of [
      "As we have seen",
      "Let us consider",
      "Let's consider",
      "We can see",
    ])
      expect(
        analyzeStance([block(prefix + phrase + ".")]).candidates[0].occurrence
          .label,
      ).toBe("inclusive");
    for (const phrase of [
      "We kids",
      "We children",
      "We students",
      "We villagers",
      "We all",
      "My family and I arrived. We ate",
    ])
      expect(
        analyzeStance([block(prefix + phrase + ".")]).candidates.at(-1)
          ?.occurrence.label,
      ).toBe("group");
    for (const phrase of [
      "We would argue",
      "We contend",
      "We believe",
      "We must admit",
      "We think",
      "In our view",
      "Our argument",
      "Our thesis",
      "We have shown",
      "We will show",
    ])
      expect(
        analyzeStance([block(prefix + phrase + ".")]).candidates[0].occurrence
          .flagged,
      ).toBe(true);
  });
  test("agreement and case preserve exact replacement spans", () => {
    const pairs = [
      ["we are ready", "I am", "we are"],
      ["we were ready", "I was", "we were"],
      ["We're ready", "I'm", "We're"],
      ["we’re ready", "I’m", "we’re"],
      ["WE ARE ready", "I AM", "WE ARE"],
      ["we've arrived", "I", "we"],
      ["we'd go", "I", "we"],
      ["we'll go", "I", "we"],
      ["us", "me", "us"],
      ["Our", "My", "Our"],
      ["ours", "mine", "ours"],
      ["ourselves", "myself", "ourselves"],
    ];
    for (const [text, fix, span] of pairs)
      expect(agreementFix(text, 0)).toEqual({ fix, length: span.length });
  });
  test("Jev overrides rules and maps author-alone probability, batches at 24, caches sentences", async () => {
    const cache: StanceCache = new Map();
    const analysis = analyzeStance([
      block(prefix + "We argue here. We wander there."),
    ]);
    let calls = 0;
    const ask = async (
      request: Parameters<Parameters<typeof classifyStance>[2]>[0],
    ) => {
      calls++;
      expect(request.questions.stance0.criteria).toEqual(STANCE_OPTIONS);
      expect(request.state.counts).toContain("singular");
      return {
        ok: true,
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key, i) => [
            key,
            {
              type: "choice",
              choice: STANCE_OPTIONS[i === 0 ? 1 : 0],
              probabilities: Object.fromEntries(
                STANCE_OPTIONS.map((o, j) => [
                  o,
                  j === (i === 0 ? 1 : 0) ? 0.8 : 0.05,
                ]),
              ),
              confidence: 0.8,
            },
          ]),
        ),
      };
    };
    await classifyStance(analysis, cache, ask);
    const read = analyzeStance(
      [block(prefix + "We argue here. We wander there.")],
      cache,
    );
    expect(read.candidates[0].occurrence.flagged).toBe(false);
    expect(read.candidates[1].occurrence).toMatchObject({
      flagged: true,
      provenance: "jev",
      probability: 0.8,
      note: "the author alone",
    });
    await classifyStance(read, cache, ask);
    expect(calls).toBe(1);
    const many = analyzeStance([
      block(
        prefix +
          Array.from({ length: 30 }, (_, i) => `We argue case ${i}.`).join(" "),
      ),
    ]);
    const result = await classifyStance(many, new Map(), async (req) => {
      expect(Object.keys(req.questions)).toHaveLength(24);
      return { ok: false };
    });
    expect(result).toEqual({ ok: false, remaining: true });
  });
});

test("stance cache distinguishes identical sentences by preceding context and counts", async () => {
  const cache: StanceCache = new Map();
  const text =
    prefix +
    "My family and I arrived. We believe it works. I state my own conclusion. We believe it works.";
  const first = analyzeStance([block(text)]);
  await classifyStance(first, cache, async (req) => ({
    ok: true,
    answers: Object.fromEntries(
      Object.keys(req.questions).map((key, i) => {
        const group = req.state[`previous${i}`].includes("family"),
          option = group ? 2 : 0;
        return [
          key,
          {
            type: "choice",
            choice: STANCE_OPTIONS[option],
            probabilities: Object.fromEntries(
              STANCE_OPTIONS.map((o, j) => [o, j === option ? 0.8 : 0.05]),
            ),
          },
        ];
      }),
    ),
  }));
  const classified = analyzeStance([block(text)], cache);
  expect(classified.candidates.map((c) => c.occurrence.label)).toEqual([
    "group",
    "editorial",
  ]);
  expect(classified.candidates.map((c) => c.occurrence.provenance)).toEqual([
    "jev",
    "jev",
  ]);
  const contextChanged = analyzeStance(
    [
      block(
        text.replace("My family and I arrived", "My opinion and I arrived"),
      ),
    ],
    cache,
  );
  expect(contextChanged.candidates[0].occurrence.provenance).toBe("rule");
  expect(contextChanged.candidates[1].occurrence.provenance).toBe("jev");
  const countsChanged = analyzeStance(
    [block(text + " I add my conclusion.")],
    cache,
  );
  expect(
    countsChanged.candidates.every((c) => c.occurrence.provenance === "rule"),
  ).toBe(true);
});

test("deliberate signatures flag replacement drift at equal counts and suppress accepted spans", () => {
  const original = [block(prefix + "We argue here. We think it helps.")];
  const old = analyzeStance(original).finding!;
  const baseline = deliberateBaseline(old, original);
  const reloaded = new Map<string, number>(
    JSON.parse(JSON.stringify([...baseline])),
  );
  expect(respectDeliberate(old, original, reloaded)).toMatchObject({
    state: "deliberate",
    count: 0,
  });
  const changed = [block(prefix + "We argue here. We contend it helps.")];
  const drift = respectDeliberate(
    analyzeStance(changed).finding!,
    changed,
    reloaded,
  );
  expect(drift.count).toBe(1);
  expect(
    drift.occurrences.filter((o) => o.flagged).map((o) => o.after),
  ).toContain(" contend it helps.");
  expect(
    drift.occurrences.find((o) => o.after.includes("argue"))?.flagged,
  ).toBe(false);
  const added = [...original, block("We believe the bridge is needed.", 2)];
  expect(
    respectDeliberate(analyzeStance(added).finding!, added, reloaded).count,
  ).toBe(1);
});

test("naming collects established names and variants at sentence and paragraph starts", () => {
  const blocks = [
    block("I met Mara Okafor at Hollins. Hollins welcomed Mara Okafor.", 1, 0),
    block("Mara Okafor left Hollins. Hollis stayed.", 2, 1),
    block("Mara Okafor returned.", 3, 2),
  ];
  const naming = analyzeNaming(blocks);
  expect(
    naming.groups.find((g) => g.canonical === "Mara Okafor")?.mentions,
  ).toHaveLength(4);
  expect(naming.findings.find((f) => f.id === "naming:hollins")?.count).toBe(1);
  const sections = [0, 1, 2].map((index) => ({
    index,
    title: `Part ${index + 1}`,
    from: 0,
    to: 0,
    words: 10,
  }));
  const presence = analyzePresence(naming.groups, sections);
  expect(presence.rows.find((r) => r.entity === "Mara Okafor")?.counts).toEqual(
    [2, 1, 1],
  );
  expect(
    presence.findings.find((f) => f.id === "presence:mara okafor"),
  ).toBeUndefined();
});

test("naming groups minority variants with correct canonical fixes and distance thresholds", () => {
  const result = analyzeNaming([
    block("At Hollins, I met Hollins and Hollins."),
    block("We visited Hollis.", 6),
  ]);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({ id: "naming:hollins", count: 1 });
  expect(result.findings[0].occurrences[0]).toMatchObject({
    text: "Hollis",
    fix: "Hollins",
    paragraph: 6,
  });
  expect(result.findings[0].metric).toBe("“Hollins” ×3 · “Hollis” ×1 in ¶6");
  expect(nameDistance("Hollins", "Holilns")).toBe(1);
  expect(
    analyzeNaming([block("At Hollins and Hollis.")]).findings,
  ).toHaveLength(0);
  expect(
    analyzeNaming([block("Hollins begins. Monday is here. We are here.")])
      .groups,
  ).toHaveLength(0);
});

describe("style sheet", () => {
  test("context-dependent spellings and idiomatic one are not mechanically reformatted", () => {
    const text =
      "colour honour flavour. Check the door and check the window. Program the machine. License the work. Meter the flow. 3 birds and 4 nests greet one of the villagers, one another, and no one else.";
    expect(analyzeStyle([block(text)])).toHaveLength(0);
  });
  const cases = [
    [
      "serial-comma",
      "apples, pears, and plums. Bread, milk, and eggs. Ink, paper and glue.",
      " and ",
      ", and ",
    ],
    ["us-uk", "The color and center have colour.", "colour", "color"],
    ["numbers", "I saw three birds and two trees with 4 nests.", "4", "four"],
    ["em-dash", "One—two—three — four", " — ", "—"],
    ["quotes", 'She said “yes” then “no” then "maybe".', '"maybe"', "“maybe”"],
  ];
  for (const [rule, text, original, fix] of cases)
    test(rule, () => {
      const finding = analyzeStyle([block(text)]).find(
        (f) => f.id === `style:${rule}`,
      );
      expect(finding?.count).toBe(1);
      expect(finding?.occurrences.find((o) => o.flagged)).toMatchObject({
        text: original,
        fix,
      });
    });
  test("number exclusions avoid dates, times, measurements and decimals; ties produce no findings", () => {
    expect(
      analyzeStyle([
        block(
          "three birds and two nests on October 3 at 4:30, 5 kg, 6.2 cm, 7/8, and $9.",
        ),
      ]),
    ).toHaveLength(0);
    expect(analyzeStyle([block("color colour")])).toHaveLength(0);
    const digits = analyzeStyle([block("3 birds, 4 nests, three trees.")]).find(
      (f) => f.id === "style:numbers",
    );
    expect(digits?.occurrences[0].fix).toBe("3");
  });
});

test("presence finds sections missing between mentions and supplies jump-only context", () => {
  const sections = ["Arrival", "Crossing", "Return"].map((title, index) => ({
    title,
    index,
    from: index * 1000,
    to: (index + 1) * 1000,
    words: 50,
  }));
  const naming = analyzeNaming([
    block("I saw Mara Okafor.", 1, 0),
    block("I met Mara Okafor.", 3, 2),
  ]);
  const result = analyzePresence(naming.groups, sections);
  expect(result.rows[0].counts).toEqual([1, 0, 1]);
  expect(result.findings[0]).toMatchObject({
    title: "Mara Okafor drops out of Crossing",
    impact: null,
    actions: ["jump"],
    level: "section",
  });
  expect(result.findings[0].occurrences.every((o) => !o.flagged)).toBe(true);
  expect(
    analyzePresence(naming.groups, sections.slice(0, 2)).findings,
  ).toHaveLength(0);
});

test("live score normalises weights, converts confirmed grade, caps penalties, and computes impacts", () => {
  const text = prefix + "We argue here. " + "word ".repeat(160);
  const f = analyzeStance([block(text)]).finding!;
  const values = ruleValues(text, [f]);
  const base = buildScore(text, [f], null);
  expect(values.consistency).toBe(9.7);
  expect(base.estimate).toBeCloseTo(
    Object.entries(values).reduce(
      (sum, [key, value]) => sum + value * RULE_WEIGHTS[key],
      0,
    ),
  );
  const confirmation: Confirmation = {
    at: 123,
    rules: values,
    review: {
      overallScore: 78,
      overallGrade: "B",
      criteria: [],
      judgementGrade: { criteria: { thesis: { id: "thesis", score: 8 } } },
    } as unknown as Confirmation["review"],
  };
  const confirmed = buildScore(text, [f], confirmation);
  expect(confirmed).toMatchObject({
    confirmed: 7.8,
    estimate: 7.8,
    confirmedLetter: "B",
    confirmedAt: 123,
  });
  expect(
    confirmed.criteria.find((c) => c.key === "review:thesis"),
  ).toMatchObject({ value: 8, source: "review", scope: "piece" });
  const fixed = { ...f, count: 0 };
  const next = buildScore(text, [fixed], confirmation, 1);
  expect(next.estimate).toBeCloseTo(7.83);
  expect(next.criteria.find((c) => c.key === "consistency")?.delta).toBeCloseTo(
    0.3,
  );
  expect(rankFindings([f])[0].impact).toBeCloseTo(0.03);
  expect(consistencyPenalty([{ ...f, count: 100 }])).toBe(6);
  expect(rankFindings([{ ...f, count: 100 }])[0].impact).toBeCloseTo(0.6);
  expect(consistencyPenalty([{ ...f, state: "deliberate" }])).toBe(0);
  expect(buildScore("short", [f], null).estimate).toBeNull();
  const sorted = rankFindings([
    { ...f, id: "null", criterion: "structure" },
    { ...f, id: "done", state: "resolved" },
    f,
  ]);
  expect(sorted.map((item) => item.id)).toEqual(["stance", "null", "done"]);
});

test("a roughly 5k-word full analysis stays bounded and reports its measured cost", () => {
  const texts = Array.from({ length: 100 }, (_, i) =>
    block(
      `I recall my childhood and my home near Hollins. We argue for the color of the sky. ${"The river carried stories past the old village. ".repeat(4)}${i % 10 === 0 ? "We saw Hollis and the colour." : ""}`,
      i + 1,
      Math.floor(i / 20),
    ),
  );
  const plainText = texts.map((b) => b.text).join("\n\n");
  const input = { blocks: texts, sections: [], plainText };
  const timings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = analyzeDesk(input);
    buildScore(plainText, result.findings, null);
    timings.push(performance.now() - start);
  }
  console.info(
    `Living desk ${plainText.split(/\s+/).length} words: ${timings.map((ms) => ms.toFixed(1)).join(", ")} ms (analysis + score)`,
  );
  expect(Math.min(...timings)).toBeLessThan(250);
});
