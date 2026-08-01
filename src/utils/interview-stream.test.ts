import { describe, expect, test } from "bun:test";
import {
  createInterviewStreamSnapshot,
  extractTaggedReasoning,
} from "./interview-stream";

describe("interview streaming parts", () => {
  test("keeps native reasoning separate from the visible answer", () => {
    expect(
      createInterviewStreamSnapshot("What kind of reader is this for?", "The audience is still vague."),
    ).toEqual({
      text: "What kind of reader is this for?",
      reasoning: "The audience is still vague.",
      phase: "answer",
    });
  });

  test("adapts think tags from OpenAI-compatible providers", () => {
    expect(
      createInterviewStreamSnapshot(
        "<think>The goal is clear; audience is not.</think>Who needs this most?",
      ),
    ).toEqual({
      text: "Who needs this most?",
      reasoning: "The goal is clear; audience is not.",
      phase: "answer",
    });
  });

  test("shows an unclosed thinking block while it streams", () => {
    expect(extractTaggedReasoning("<think>Comparing the draft")).toBe(
      "Comparing the draft",
    );
    expect(
      createInterviewStreamSnapshot("<think>Comparing the draft").phase,
    ).toBe("reasoning");
  });

  test("never flashes structured interview tags or JSON", () => {
    expect(
      createInterviewStreamSnapshot(
        'Who should read it?\nDOSSIER: {"brief":{"audience":"editors"}}',
      ).text,
    ).toBe("Who should read it?");
  });

  test("withholds partial contract markers at chunk boundaries", () => {
    expect(createInterviewStreamSnapshot("Who should read it?\nDOSS").text).toBe(
      "Who should read it?",
    );
  });
});
