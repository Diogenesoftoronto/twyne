import { describe, expect, test } from "bun:test";
import {
  buildSystemPrompt,
  type AgentRequest,
} from "../../convex/agentPrompts";
import { stripReasoningTags } from "./reasoning-tags";

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

describe("persona feedback passage references", () => {
  test("makes exact passage references explicit in the persona prompt", () => {
    const prompt = buildSystemPrompt(makeAgentRequest().persona);

    expect(prompt).toContain("quote_passage");
    expect(prompt).toContain(
      "Do not make a claim about the draft unless you have first quoted the relevant passage",
    );
  });
});
