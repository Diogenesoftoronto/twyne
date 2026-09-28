import { describe, expect, test } from "bun:test";
import { createToolStream, toolSpec, validateToolSpec } from "./catalog";

const lab = () =>
  toolSpec({
    type: "SentenceLab",
    props: { sentence: "It decided nothing.", attempts: [], variants: [] },
    children: [],
  });
const line = (value: string, path = "/elements/tool/props/variants/-") =>
  JSON.stringify({ op: "add", path, value });

describe("validateToolSpec", () => {
  test("accepts a catalog component with valid props", () => {
    expect(validateToolSpec(lab())).not.toBeNull();
  });

  test("rejects components outside the catalog and bad props", () => {
    expect(
      validateToolSpec({
        root: "tool",
        elements: { tool: { type: "Iframe", props: {}, children: [] } },
      }),
    ).toBeNull();
    expect(
      validateToolSpec({
        root: "tool",
        elements: {
          tool: {
            type: "RhythmStrip",
            props: { sentences: [], targetMin: 8, targetMax: 28 },
            children: [],
          },
        },
      }),
    ).toBeNull();
  });
});

describe("createToolStream", () => {
  test("fills the list as lines arrive, across chunk boundaries", () => {
    const stream = createToolStream(lab(), 3);
    const full = `${line("One way.")}\n${line("Another way.")}\n`;
    const cut = full.length - 20;
    const first = stream.push(full.slice(0, cut));
    expect(first.elements.tool.props).toMatchObject({ variants: ["One way."] });
    const second = stream.push(full);
    expect(second.elements.tool.props).toMatchObject({
      variants: ["One way.", "Another way."],
    });
  });

  test("ignores patches aimed anywhere but the allowed list", () => {
    const stream = createToolStream(lab(), 3);
    const text = [
      JSON.stringify({
        op: "replace",
        path: "/elements/tool/props/sentence",
        value: "Hijacked.",
      }),
      line("Hijacked.", "/elements/tool/props/attempts/-"),
      "Sure! Here are some variants:",
      line("Kept."),
    ].join("\n");
    const spec = stream.push(`${text}\n`);
    expect(spec.elements.tool.props).toEqual({
      sentence: "It decided nothing.",
      attempts: [],
      variants: ["Kept."],
    });
  });

  test("caps the list and flushes a final line without a newline", () => {
    const stream = createToolStream(lab(), 2);
    stream.push(`${line("A.")}\n${line("B.")}\n${line("C")}`);
    const spec = stream.finish();
    expect(spec.elements.tool.props).toMatchObject({ variants: ["A.", "B."] });
  });

  test("never mutates the seed", () => {
    const seed = lab();
    createToolStream(seed, 3).push(`${line("New.")}\n`);
    expect(seed.elements.tool.props).toMatchObject({ variants: [] });
  });
});
