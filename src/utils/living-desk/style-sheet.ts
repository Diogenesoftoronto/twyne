import { finding, occurrence, matchCase, type Block } from "./segment";
import type { Finding, Occurrence } from "../living-desk-contract";

export const SPELLING_PAIRS = [
  ["color", "colour"],
  ["colors", "colours"],
  ["colored", "coloured"],
  ["colorful", "colourful"],
  ["center", "centre"],
  ["centers", "centres"],
  ["theater", "theatre"],
  ["liter", "litre"],
  ["gray", "grey"],
  ["toward", "towards"],
  ["favorite", "favourite"],
  ["favor", "favour"],
  ["flavor", "flavour"],
  ["honor", "honour"],
  ["humor", "humour"],
  ["labor", "labour"],
  ["neighbor", "neighbour"],
  ["behavior", "behaviour"],
  ["organize", "organise"],
  ["organized", "organised"],
  ["organization", "organisation"],
  ["recognize", "recognise"],
  ["realize", "realise"],
  ["analyze", "analyse"],
  ["defense", "defence"],
  ["offense", "offence"],
  ["catalog", "catalogue"],
  ["dialog", "dialogue"],
  ["traveling", "travelling"],
  ["traveled", "travelled"],
  ["canceled", "cancelled"],
  ["canceling", "cancelling"],
  ["jewelry", "jewellery"],
  ["pajamas", "pyjamas"],
  ["aluminum", "aluminium"],
  ["skeptical", "sceptical"],
  ["apologize", "apologise"],
  ["criticize", "criticise"],
  ["emphasize", "emphasise"],
  ["summarize", "summarise"],
] as const;
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
interface Sample {
  form: number;
  occ: Occurrence;
  fixes: [string, string];
}

export function analyzeStyle(blocks: Block[]): Finding[] {
  const rules = new Map<string, Sample[]>();
  const add = (
    rule: string,
    block: Block,
    from: number,
    length: number,
    form: number,
    fixes: [string, string],
  ) => {
    const samples = rules.get(rule) ?? [];
    samples.push({
      form,
      occ: occurrence(block, from, length, `style:${rule}`),
      fixes,
    });
    rules.set(rule, samples);
  };
  for (const block of blocks) {
    if (block.kind === "code" || block.kind === "quote") continue;
    const text = block.text;
    // A conservative three-item list, confined to one sentence.
    for (const m of text.matchAll(
      /\b[\p{L}]+(?:\s+[\p{L}]+){0,2},\s+[\p{L}]+(?:\s+[\p{L}]+){0,2}(,?)\s+(?:and|or)\s+[\p{L}]+/gu,
    )) {
      const junction = /,?\s+(?:and|or)\s/.exec(m[0])!;
      const from = m.index! + junction.index;
      const plain = junction[0].replace(/^,/, "");
      add("serial-comma", block, from, junction[0].length, m[1] ? 1 : 0, [
        plain,
        `,${plain}`,
      ]);
    }
    const spellings = new Map<
      string,
      { form: number; pair: readonly [string, string] }
    >();
    SPELLING_PAIRS.forEach((pair) =>
      pair.forEach((word, form) => spellings.set(word, { pair, form })),
    );
    for (const m of text.matchAll(/\b[a-z]+\b/gi)) {
      const spelling = spellings.get(m[0].toLowerCase());
      if (spelling)
        add("us-uk", block, m.index!, m[0].length, spelling.form, [
          matchCase(m[0], spelling.pair[0]),
          matchCase(m[0], spelling.pair[1]),
        ]);
    }
    for (const m of text.matchAll(
      /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|[0-9])\b/gi,
    )) {
      const before = text.slice(Math.max(0, m.index! - 25), m.index),
        after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 24);
      if (
        m[0].toLowerCase() === "one" &&
        (/^\s+(?:of|another)\b/i.test(after) || /\bno\s+$/i.test(before))
      )
        continue;
      if (
        /[\d.:/-]$/.test(before) ||
        /^[\d.:/-]/.test(after) ||
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*$/i.test(
          before,
        ) ||
        /^\s*(?:am|pm|a\.m|p\.m|cm|mm|km|m|kg|g|mg|ml|l|inches|inch|feet|foot|meters|metres|miles|hours|minutes|seconds|percent|%|°|lbs|lb)\b/i.test(
          after,
        ) ||
        /[$£€]$/.test(before) ||
        /^\s*[%°]/.test(after) ||
        /^\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(
          after,
        )
      )
        continue;
      const digit = /^\d$/.test(m[0]),
        number = digit
          ? Number(m[0])
          : NUMBER_WORDS.indexOf(m[0].toLowerCase());
      add("numbers", block, m.index!, m[0].length, Number(digit), [
        matchCase(m[0], NUMBER_WORDS[number]),
        String(number),
      ]);
    }
    for (const m of text.matchAll(/[ \t]*—[ \t]*/g)) {
      add("em-dash", block, m.index!, m[0].length, Number(m[0].length > 1), [
        "—",
        " — ",
      ]);
    }
    for (const m of text.matchAll(/"[^"\n]+"|“[^”\n]+”|'[^'\n]+'|‘[^’\n]+’/g)) {
      if (
        /[\p{L}]/u.test(text[m.index! - 1] ?? "") ||
        /[\p{L}]/u.test(text[m.index! + m[0].length] ?? "")
      )
        continue;
      const double = /["“]/.test(m[0][0]),
        curly = /[“‘]/.test(m[0][0]);
      const straight = double ? '"' : "'",
        left = double ? "“" : "‘",
        right = double ? "”" : "’";
      add("quotes", block, m.index!, m[0].length, Number(curly), [
        straight + m[0].slice(1, -1) + straight,
        left + m[0].slice(1, -1) + right,
      ]);
    }
  }
  const names: Record<string, [string, string]> = {
    "serial-comma": [
      "Lists omit the serial comma",
      "Lists use the serial comma",
    ],
    "us-uk": ["US spelling is the majority", "UK spelling is the majority"],
    numbers: ["Small numbers are spelled out", "Small numbers use digits"],
    "em-dash": ["Em dashes are closed", "Em dashes are spaced"],
    quotes: ["Quotes are straight", "Quotes are curly"],
  };
  return [...rules].flatMap(([rule, samples]) => {
    const n = samples.filter((s) => s.form === 1).length;
    if (n === 0 || n === samples.length || n * 2 === samples.length) return [];
    const majority = n * 2 > samples.length ? 1 : 0;
    const occurrences = samples.map((s) => ({
      ...s.occ,
      flagged: s.form !== majority,
      label: s.form === majority ? "majority" : "minority",
      ...(s.form !== majority ? { fix: s.fixes[majority] } : {}),
    }));
    const count = occurrences.filter((o) => o.flagged).length;
    return [
      finding(
        `style:${rule}`,
        "style",
        names[rule][majority],
        `${count} exception${count === 1 ? "" : "s"} · ${samples.length - count} by the majority rule`,
        occurrences,
      ),
    ];
  });
}
