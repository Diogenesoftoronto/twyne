/**
 * The accumulator is the single place both generation paths agree on what a
 * half-finished answer looks like, so it carries the cases that used to be
 * handled — differently — in four places.
 */
import { describe, expect, test } from "bun:test";
import {
  createGenerationStreamAccumulator,
  createPublishGate,
  snapshotFromRecord,
  textSnapshot,
} from "./generation-stream";

describe("createGenerationStreamAccumulator — native reasoning parts", () => {
  test("keeps reasoning out of the text a reader sees", () => {
    const acc = createGenerationStreamAccumulator();
    acc.push({ type: "reasoning-start" });
    const thinking = acc.push({
      type: "reasoning-delta",
      text: "The claim is unearned.",
    });

    expect(thinking.text).toBe("");
    expect(thinking.reasoning).toBe("The claim is unearned.");
    expect(thinking.activePart).toBe("reasoning");

    acc.push({ type: "reasoning-end" });
    const answering = acc.push({
      type: "text-delta",
      text: "The opening overclaims.",
    });

    expect(answering.text).toBe("The opening overclaims.");
    expect(answering.reasoning).toBe("The claim is unearned.");
    expect(answering.activePart).toBe("text");
  });
});

describe("createGenerationStreamAccumulator — inline <think> tags", () => {
  test("reads an OpenAI-compatible model's tags as reasoning, not prose", () => {
    const acc = createGenerationStreamAccumulator();
    const thinking = acc.push({
      type: "text-delta",
      text: "<think>Weigh the second paragraph",
    });

    expect(thinking.text).toBe("");
    expect(thinking.reasoning).toBe("Weigh the second paragraph");
    expect(thinking.activePart).toBe("reasoning");

    const answering = acc.push({
      type: "text-delta",
      text: "</think>The second paragraph gives the piece a spine.",
    });

    expect(answering.text).toBe(
      "The second paragraph gives the piece a spine.",
    );
    expect(answering.activePart).toBe("text");
  });

  test("a tag split across chunks never leaks into the text", () => {
    const acc = createGenerationStreamAccumulator();
    for (const chunk of ["<th", "ink>hidden</thi", "nk>Visible."]) {
      const snapshot = acc.push({ type: "text-delta", text: chunk });
      expect(snapshot.text).not.toContain("think");
      expect(snapshot.text).not.toContain("<");
    }
    expect(acc.snapshot().text).toBe("Visible.");
  });

  test("an unclosed block withholds the text rather than showing scratch work", () => {
    const acc = createGenerationStreamAccumulator();
    const snapshot = acc.push({
      type: "text-delta",
      text: "<think>Still working through the middle section",
    });

    expect(snapshot.text).toBe("");
    expect(snapshot.reasoning).toBe("Still working through the middle section");
    // The case that used to trigger a whole second generation. It is a state
    // to render, not a failure: the model is mid-thought.
    expect(snapshot.status).toBe("running");
  });
});

describe("createGenerationStreamAccumulator — lifecycle", () => {
  test("finish settles both parts and stops claiming an active one", () => {
    const acc = createGenerationStreamAccumulator();
    acc.push({ type: "text-delta", text: "<think>brief</think>A note." });
    const done = acc.push({ type: "finish" });

    expect(done.status).toBe("complete");
    expect(done.activePart).toBeNull();
    expect(done.textStatus).toBe("complete");
    expect(done.reasoningStatus).toBe("complete");
  });

  test("error settles the run without inventing text", () => {
    const acc = createGenerationStreamAccumulator();
    acc.push({ type: "reasoning-delta", text: "half a thought" });
    const failed = acc.push({ type: "error" });

    expect(failed.status).toBe("error");
    expect(failed.text).toBe("");
    expect(failed.activePart).toBeNull();
  });
});

describe("textSnapshot", () => {
  test("carries finished text with no reasoning", () => {
    const snapshot = textSnapshot("A filed note.");
    expect(snapshot.text).toBe("A filed note.");
    expect(snapshot.reasoning).toBe("");
    expect(snapshot.status).toBe("complete");
    expect(snapshot.textStatus).toBe("complete");
  });

  test("an empty running snapshot is the reset before a retry", () => {
    const snapshot = textSnapshot("", "running");
    expect(snapshot.text).toBe("");
    expect(snapshot.status).toBe("running");
    expect(snapshot.textStatus).toBe("pending");
  });
});

describe("createPublishGate", () => {
  /** A clock the test drives, so cadence is asserted rather than waited on. */
  function clock() {
    let t = 1_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  const running = (text: string) =>
    ({ text, reasoning: "", status: "running" }) as const;

  test("the first token is written immediately — a blank card is the thing being fixed", () => {
    const gate = createPublishGate(100, clock().now);
    expect(gate(running("The"))).toBe(true);
  });

  test("tokens inside the interval are held back", () => {
    const c = clock();
    const gate = createPublishGate(100, c.now);

    expect(gate(running("The"))).toBe(true);
    c.advance(20);
    expect(gate(running("The opening"))).toBe(false);
    c.advance(20);
    expect(gate(running("The opening over"))).toBe(false);
    c.advance(70); // 110ms since the last write
    expect(gate(running("The opening overclaims."))).toBe(true);
  });

  test("a terminal snapshot is always written, however soon it lands", () => {
    const c = clock();
    const gate = createPublishGate(100, c.now);

    expect(gate(running("A note"))).toBe(true);
    c.advance(5);
    // Nothing accumulated between the last write and the finish may be lost:
    // this is the write the reader's final card is built from.
    expect(gate({ text: "A note.", reasoning: "", status: "complete" })).toBe(
      true,
    );
  });

  test("an error is written too, rather than leaving the row mid-flight", () => {
    const c = clock();
    const gate = createPublishGate(100, c.now);
    gate(running("Half a"));
    c.advance(5);
    expect(gate({ text: "Half a", reasoning: "", status: "error" })).toBe(true);
  });

  test("a snapshot identical to the last written one is never worth a trip", () => {
    const c = clock();
    const gate = createPublishGate(100, c.now);

    expect(gate(running("The opening"))).toBe(true);
    // A step boundary or a tool call: the stream moved, the reader's view
    // did not.
    c.advance(500);
    expect(gate(running("The opening"))).toBe(false);
  });

  test("reasoning arriving on its own still earns a write", () => {
    const c = clock();
    const gate = createPublishGate(100, c.now);

    expect(gate({ text: "", reasoning: "Weighing", status: "running" })).toBe(
      true,
    );
    c.advance(150);
    expect(
      gate({ text: "", reasoning: "Weighing the opening", status: "running" }),
    ).toBe(true);
  });

  test("a token-rate stream costs writes at the interval, not per token", () => {
    const c = clock();
    const gate = createPublishGate(100, c.now);
    let written = 0;
    let text = "";

    // 400 tokens over 8 seconds — a note at a realistic generation rate.
    for (let i = 0; i < 400; i += 1) {
      text += `t${i} `;
      if (gate(running(text))) written += 1;
      c.advance(20);
    }

    // One per 100ms of the 8 seconds, rather than one per token. Five editors
    // convening is the difference between ~400 writes and ~2,000.
    expect(written).toBe(80);
  });
});

describe("snapshotFromRecord", () => {
  test("a hosted note mid-thought renders like a browser one", () => {
    const snapshot = snapshotFromRecord({
      text: "",
      reasoning: "Weighing the opening.",
      phase: "reasoning",
      status: "running",
    });

    expect(snapshot.activePart).toBe("reasoning");
    expect(snapshot.reasoningStatus).toBe("running");
    expect(snapshot.textStatus).toBe("pending");
  });

  test("a finished row claims no active part", () => {
    const snapshot = snapshotFromRecord({
      text: "The opening overclaims.",
      reasoning: "Weighed it.",
      phase: "answer",
      status: "complete",
    });

    expect(snapshot.activePart).toBeNull();
    expect(snapshot.textStatus).toBe("complete");
    expect(snapshot.reasoningStatus).toBe("complete");
  });
});
