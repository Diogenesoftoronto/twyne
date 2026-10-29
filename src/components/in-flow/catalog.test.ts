import { describe, expect, test } from "bun:test";
import {
  createToolStream,
  STREAMABLE_PATHS,
  toolSpec,
  validateToolSpec,
} from "./catalog";

const lab = () =>
  toolSpec({
    type: "SentenceLab",
    props: { sentence: "It decided nothing." },
    children: [],
  });
const questions = () =>
  toolSpec({
    type: "ReaderQuestions",
    props: { angle: "", questions: [] },
    children: [],
  });
const line = (value: string, path = "/elements/tool/props/questions/-") =>
  JSON.stringify({ op: "add", path, value });

describe("validateToolSpec", () => {
  test("accepts a catalog component with valid props", () => {
    expect(validateToolSpec(lab())).not.toBeNull();
    expect(validateToolSpec(questions())).not.toBeNull();
  });

  test("a revision bench has no field a model may stream into", () => {
    expect(STREAMABLE_PATHS.SentenceLab).toBeUndefined();
    const stream = createToolStream(lab(), 3);
    const spec = stream.push(
      `${JSON.stringify({ op: "add", path: "/elements/tool/props/trial", value: "Hijacked." })}\n`,
    );
    expect(spec.elements.tool.props).toEqual({
      sentence: "It decided nothing.",
    });
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
    const stream = createToolStream(questions(), 3);
    const full = `${line("One way.")}\n${line("Another way.")}\n`;
    const cut = full.length - 20;
    const first = stream.push(full.slice(0, cut));
    expect(first.elements.tool.props).toMatchObject({
      questions: ["One way."],
    });
    const second = stream.push(full);
    expect(second.elements.tool.props).toMatchObject({
      questions: ["One way.", "Another way."],
    });
  });

  test("ignores patches aimed anywhere but the allowed list", () => {
    const stream = createToolStream(questions(), 3);
    const text = [
      JSON.stringify({
        op: "replace",
        path: "/elements/tool/props/angle",
        value: "Hijacked.",
      }),
      line("Hijacked.", "/elements/tool/props/other/-"),
      "Sure! Here are some questions:",
      line("Kept."),
    ].join("\n");
    const spec = stream.push(`${text}\n`);
    expect(spec.elements.tool.props).toEqual({
      angle: "",
      questions: ["Kept."],
    });
  });

  test("caps the list and flushes a final line without a newline", () => {
    const stream = createToolStream(questions(), 2);
    stream.push(
      `${line("Who says so?")}\n${line("What changed?")}\n${line("A third question?")}`,
    );
    const spec = stream.finish();
    expect(spec.elements.tool.props).toMatchObject({
      questions: ["Who says so?", "What changed?"],
    });
  });

  test("never mutates the seed", () => {
    const seed = questions();
    createToolStream(seed, 3).push(`${line("New.")}\n`);
    expect(seed.elements.tool.props).toMatchObject({ questions: [] });
  });
});
