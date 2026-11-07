import { describe, expect, test } from "bun:test";
import {
  type AlternativeOption,
  acceptAlternative,
  drumGroup,
  drumOrder,
  alternativeCore,
  alternativesPrompt,
  checkAlternativeSpan,
  lengthBudget,
  lexiconQueries,
  matchCase,
  mergeOptions,
  parseAlternatives,
  parseLexicon,
  spanContext,
  wordAt,
} from "./alternatives";

describe("checkAlternativeSpan", () => {
  test("sizes the lock by how much is selected", () => {
    expect(checkAlternativeSpan("happy")).toMatchObject({ scale: "word" });
    expect(checkAlternativeSpan("the old house")).toMatchObject({
      scale: "phrase",
      words: 3,
    });
    expect(
      checkAlternativeSpan(
        "She had not told her brother that the house was sold.",
      ),
    ).toMatchObject({ scale: "sentence" });
    expect(
      checkAlternativeSpan(
        "She left early. He stayed until the lights went out.",
      ),
    ).toMatchObject({ scale: "passage" });
  });

  test("refuses empty, punctuation-only, notes and over-long locks", () => {
    expect(checkAlternativeSpan("  ").ok).toBe(false);
    expect(checkAlternativeSpan("—").ok).toBe(false);
    expect(checkAlternativeSpan("a note ￼ here").ok).toBe(false);
    expect(checkAlternativeSpan(Array(200).fill("word").join(" ")).ok).toBe(
      false,
    );
  });
});

describe("span edges", () => {
  test("a single word sheds surrounding punctuation and space", () => {
    const text = ' "happy," ';
    const core = alternativeCore(text);
    expect(text.slice(core.start, core.end)).toBe("happy");
  });

  test("a passage keeps its own punctuation", () => {
    const text = " She left early. ";
    const core = alternativeCore(text);
    expect(text.slice(core.start, core.end)).toBe("She left early.");
  });

  test("the word at a caret includes apostrophes but not quotes", () => {
    const text = "It isn’t “quiet” here.";
    const at = wordAt(text, text.indexOf("n’t"));
    expect(text.slice(at!.start, at!.end)).toBe("isn’t");
    const q = wordAt(text, text.indexOf("quiet") + 2);
    expect(text.slice(q!.start, q!.end)).toBe("quiet");
    expect(wordAt(text, text.indexOf("“"))).toBeNull();
  });

  test("context stops at word boundaries", () => {
    const paragraph = `${"lorem ".repeat(100)}TARGET ${"ipsum ".repeat(100)}`;
    const start = paragraph.indexOf("TARGET");
    const ctx = spanContext(paragraph, start, start + 6);
    expect(ctx.before.startsWith("lorem")).toBe(true);
    expect(ctx.after.trim().endsWith("ipsum")).toBe(true);
  });
});

describe("length", () => {
  test("budgets stay near the original's word count", () => {
    expect(lengthBudget("word", 1)).toEqual({ min: 1, max: 2 });
    expect(lengthBudget("phrase", 3)).toEqual({ min: 2, max: 4 });
    expect(lengthBudget("sentence", 20)).toEqual({ min: 16, max: 24 });
  });

  test("candidates far from the original's length are dropped", () => {
    const original = "She had not told her brother that the house was sold.";
    expect(
      acceptAlternative(
        "She had kept the sale of the house from her brother.",
        original,
        "sentence",
        "rephrase",
        "model",
      ),
    ).not.toBeNull();
    expect(
      acceptAlternative(
        "She kept it quiet.",
        original,
        "sentence",
        "rephrase",
        "model",
      ),
    ).toBeNull();
    expect(
      acceptAlternative(original, original, "sentence", "rephrase", "model"),
    ).toBeNull();
  });

  test("a sentence keeps its closing punctuation", () => {
    const option = acceptAlternative(
      "Her brother still did not know the house had sold",
      "She had not told her brother that the house was sold.",
      "sentence",
      "rephrase",
      "model",
    );
    expect(option?.text.endsWith(".")).toBe(true);
  });
});

describe("case", () => {
  test("follows the replaced word", () => {
    expect(matchCase("glad", "Happy")).toBe("Glad");
    expect(matchCase("glad", "HAPPY")).toBe("GLAD");
    expect(matchCase("glad", "happy")).toBe("glad");
    expect(
      acceptAlternative("content", "Happy", "word", "synonym", "lexicon")?.text,
    ).toBe("Content");
  });
});

describe("lexicon", () => {
  test("queries carry only the word and its neighbours", () => {
    const queries = lexiconQueries({
      text: "happy",
      before: "It was a really",
      after: "day for everyone.",
    });
    const urls = queries.map((q) => q.url).join(" ");
    expect(urls).toContain("ml=happy");
    expect(urls).toContain("lc=really");
    expect(urls).toContain("rc=day");
    expect(urls).toContain("rel_ant=happy");
    expect(urls).not.toContain("everyone");
    expect(queries.some((q) => q.lens === "slot")).toBe(true);
  });

  test("keeps synonyms of the same part of speech and drops related words", () => {
    const [ml] = lexiconQueries({ text: "happy", before: "a", after: "day" });
    const parsed = parseLexicon(
      [
        { word: "glad", tags: ["syn", "adj"] },
        { word: "happiness", tags: ["n"] },
        { word: "felicity", tags: ["syn", "n"] },
        { word: "happy", tags: ["syn", "adj"] },
      ],
      ml!,
      "happy",
      ["adj"],
    );
    expect(parsed.map((o) => o.text)).toEqual(["glad"]);
  });
});

describe("model output", () => {
  const req = {
    text: "the old house",
    scale: "phrase" as const,
    lenses: ["rephrase", "plainer"] as Array<"rephrase" | "plainer">,
  };

  test("reads JSONL, a fenced block or an array, and drops other lenses", () => {
    const lines = [
      "```jsonl",
      '{"lens":"rephrase","text":"the aging house"}',
      '{"lens":"plainer","text":"the old home"}',
      '{"lens":"opposite","text":"the new house"}',
      "not json",
      '{"lens":"rephrase","text":"the aging house"}',
      "```",
    ].join("\n");
    expect(parseAlternatives(lines, req).map((o) => o.text)).toEqual([
      "the aging house",
      "the old home",
    ]);
    const array = JSON.stringify([
      { lens: "rephrase", text: "the weathered house" },
    ]);
    expect(parseAlternatives(array, req)).toHaveLength(1);
  });

  test("while streaming, an unfinished last line waits", () => {
    const partial =
      '{"lens":"rephrase","text":"the aging house"}\n{"lens":"plainer","text":"the ol';
    expect(parseAlternatives(partial, req, { partial: true })).toHaveLength(1);
  });

  test("the prompt states the length rule, context and exclusions", () => {
    const { system, prompt } = alternativesPrompt({
      text: "the old house",
      before: "They drove past",
      after: "without stopping.",
      scale: "phrase",
      lenses: ["rephrase"],
      count: 8,
      exclude: ["the aging house"],
    });
    expect(system).toContain("JSONL");
    expect(prompt).toContain("between 2 and 4 words");
    expect(prompt).toContain("They drove past");
    expect(prompt).toContain("- the aging house");
    expect(prompt).toContain('"rephrase"');
    expect(prompt).not.toContain('"plainer"');
    expect(prompt).not.toMatch(/\{\w+\}/);
  });
});

describe("drum", () => {
  const opt = (
    text: string,
    lens: AlternativeOption["lens"],
    source: AlternativeOption["source"],
  ): AlternativeOption => ({ id: text, text, lens, source, words: 1 });

  test("turns through words for this sentence, synonyms, slot fillers, then antonyms", () => {
    const order = drumOrder([
      opt("sad", "antonym", "lexicon"),
      opt("pleased", "synonym", "lexicon"),
      opt("busy", "slot", "model"),
      opt("joyful", "synonym", "model"),
      opt("content", "synonym", "lexicon"),
      opt("glad", "synonym", "model"),
    ]);
    expect(order.map((o) => o.text)).toEqual([
      "joyful",
      "glad",
      "pleased",
      "content",
      "busy",
      "sad",
    ]);
    expect(order.map(drumGroup)).toEqual([
      "fits",
      "fits",
      "synonym",
      "synonym",
      "slot",
      "antonym",
    ]);
  });
});

describe("merging", () => {
  test("a dictionary word the model also chose counts as fitting here", () => {
    const lex = (text: string): AlternativeOption => ({
      id: text,
      text,
      lens: "synonym",
      source: "lexicon",
      words: 1,
    });
    const merged = mergeOptions(
      [lex("pleased"), lex("joyful")],
      [
        { ...lex("joyful"), source: "model" },
        { ...lex("glad"), source: "model" },
      ],
    );
    expect(merged.map((o) => `${o.text}:${o.source}`)).toEqual([
      "pleased:lexicon",
      "joyful:model",
      "glad:model",
    ]);
    expect(drumOrder(merged).map((o) => o.text)).toEqual([
      "joyful",
      "glad",
      "pleased",
    ]);
  });
});

describe("prompt bounds", () => {
  test("each lens is listed once, and only lenses the scale allows", () => {
    const { prompt } = alternativesPrompt({
      text: "happy",
      before: "a",
      after: "day",
      scale: "word",
      lenses: [...Array<"synonym">(500).fill("synonym"), "rephrase", "antonym"],
      count: 8,
      exclude: [],
    });
    expect(prompt.match(/- "synonym"/g)).toHaveLength(1);
    expect(prompt).toContain('- "antonym"');
    expect(prompt).not.toContain('"rephrase"');
  });
});

describe("steering", () => {
  test("a direction goes into the prompt and asks for steered lines only", () => {
    const { prompt } = alternativesPrompt({
      text: "The old house stood alone",
      before: "",
      after: "at the end of the lane.",
      scale: "sentence",
      lenses: ["steered"],
      count: 6,
      exclude: [],
      direction: "lonelier",
    });
    expect(prompt).toContain('"lonelier"');
    expect(prompt).toContain('"steered"');
    expect(prompt).not.toContain('"rephrase"');
  });

  test("steered lines parse; other lenses in the reply are dropped", () => {
    const req = {
      text: "the old house",
      scale: "phrase" as const,
      lenses: ["steered"] as Array<"steered">,
    };
    const out = parseAlternatives(
      '{"lens":"steered","text":"the lonely house"}\n{"lens":"rephrase","text":"the aging house"}',
      req,
    );
    expect(out.map((o) => o.text)).toEqual(["the lonely house"]);
  });
});
