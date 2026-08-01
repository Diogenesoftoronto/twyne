import { describe, expect, test } from "bun:test";
import {
  buildSystemPrompt,
  type AgentRequest,
} from "../../convex/agentPrompts";
import {
  createVisibleTextFilter,
  hasReasoningTags,
  removeReasoningTagMarkers,
  stripReasoningTags,
} from "./reasoning-tags";

function makeAgentRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    persona: {
      id: "editor",
      name: "Line Editor",
      role: "line editor",
      description: "Cuts fog and names the sentence-level problem.",
      focus: "clarity and sentence movement",
    },
    brief: null,
    draftText:
      "The opening claims too much before the reader has evidence. The second paragraph finally gives the piece a spine.",
    instruction: "feedback",
    ...overrides,
  };
}

describe("stripReasoningTags", () => {
  test("removes normal think blocks and preserves visible answer text", () => {
    expect(
      stripReasoningTags(
        '<think>I should not render this.</think>\nOn: "The opening..."',
      ),
    ).toBe('On: "The opening..."');
  });

  test("treats malformed self-closing think tags as block closers", () => {
    const stripped = stripReasoningTags(
      "Before\n<think>hidden chain of thought<think/>\nAfter",
    );

    expect(stripped).toContain("Before");
    expect(stripped).toContain("After");
    expect(stripped).not.toContain("hidden chain of thought");
    expect(stripped).not.toContain("<think");
  });

  test("removes thinking aliases and orphan closing tags", () => {
    expect(
      stripReasoningTags(
        "<thinking>private reasoning</thinking>\nVisible answer</think>",
      ),
    ).toBe("Visible answer");
  });

  test("drops an unclosed reasoning block through the end of the text", () => {
    expect(stripReasoningTags("Visible\n<think>hidden forever")).toBe(
      "Visible",
    );
  });
});

/**
 * The generators discard and regenerate any reply that reached for the
 * reasoning channel, so the *detection* has to be exact — a false negative
 * ships a note with the model's thinking in it, and a false positive spends a
 * second call on a perfectly good one.
 */
describe("hasReasoningTags", () => {
  test("catches a reply that thought out loud even when text survives", () => {
    expect(hasReasoningTags("<think>hmm</think>The opening overclaims.")).toBe(
      true,
    );
  });

  test("catches aliases, orphan closers, and malformed self-closers", () => {
    expect(hasReasoningTags("<thinking>private</thinking>Answer")).toBe(true);
    expect(hasReasoningTags("Answer</think>")).toBe(true);
    expect(hasReasoningTags("Answer<think/>")).toBe(true);
  });

  test("leaves ordinary prose alone", () => {
    expect(hasReasoningTags("The second paragraph gives the piece a spine.")).toBe(
      false,
    );
    expect(hasReasoningTags("I think the opening overclaims.")).toBe(false);
  });

  test("does not carry regex state between calls", () => {
    const text = "<think>a</think>b";
    expect(hasReasoningTags(text)).toBe(true);
    expect(hasReasoningTags(text)).toBe(true);
  });
});

describe("removeReasoningTagMarkers", () => {
  /**
   * The last resort when both the reply and its regeneration strip to
   * nothing: the writer sees the model's thinking, which is poor, but never
   * a literal `<think>`, which is broken.
   */
  test("keeps the content and drops only the markers", () => {
    expect(removeReasoningTagMarkers("<think>All of it was in here.</think>")).toBe(
      "All of it was in here.",
    );
  });

  test("handles an unclosed block", () => {
    expect(removeReasoningTagMarkers("<think>never closed")).toBe(
      "never closed",
    );
  });
});

describe("createVisibleTextFilter", () => {
  test("does not expose a reasoning tag split across chunks", () => {
    const push = createVisibleTextFilter();

    expect(push("Visible")).toBe("Visible");
    expect(push("<thi")).toBeNull();
    expect(push("nk>private")).toBeNull();
    expect(push("</think>Answer")).toBe("VisibleAnswer");
  });

  test("does not expose a split closing tag", () => {
    const push = createVisibleTextFilter();

    expect(push("<think>private</thi")).toBeNull();
    expect(push("nk>Answer")).toBe("Answer");
  });

  test("returns null when a chunk changes no visible text", () => {
    const push = createVisibleTextFilter();

    expect(push("<think>")).toBeNull();
    expect(push("still private")).toBeNull();
    expect(push("</think>")).toBeNull();
  });
});

describe("persona feedback passage references", () => {
  test("makes exact passage references explicit in the persona prompt", () => {
    const prompt = buildSystemPrompt(makeAgentRequest().persona);

    expect(prompt).toContain("quote_passage");
    expect(prompt).toContain(
      "Do not make a claim about the draft unless you have first quoted the relevant passage",
    );
  });
});
