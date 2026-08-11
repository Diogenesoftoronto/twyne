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
  trimPartialReasoningTag,
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
        "\u003Cthink\u003E reasoning content \u003C/think\u003E\nOn: \"The opening...\"",
      ),
    ).toBe('On: "The opening..."');
  });

  test("treats malformed self-closing think tags as block closers", () => {
    const stripped = stripReasoningTags(
      "Before\n\u003Cthink\u003Ehidden chain of thought\u003Cthink/\u003E\nAfter",
    );

    expect(stripped).toContain("Before");
    expect(stripped).toContain("After");
    expect(stripped).not.toContain("hidden chain of thought");
    expect(stripped).not.toContain("think");
  });

  test("removes thinking aliases and orphan closing tags", () => {
    expect(
      stripReasoningTags(
        "\u003Cthinking\u003Eprivate reasoning\u003C/thinking\u003E\nVisible answer\u003C/think\u003E",
      ),
    ).toBe("Visible answer");
  });

  test("drops an unclosed reasoning block through the end of the text", () => {
    expect(stripReasoningTags("Visible\n\u003Cthink\u003Ehidden forever")).toBe(
      "Visible",
    );
  });

  test("strips tags that carry attributes", () => {
    expect(
      stripReasoningTags(
        '\u003Cthink class="ct"\u003Ehidden\u003C/think\u003Eanswer',
      ),
    ).toBe("answer");
  });

  test("treats repeated orphan closers without letting depth go negative", () => {
    expect(
      stripReasoningTags("A\u003C/think\u003E\u003C/think\u003EB"),
    ).toBe("AB");
  });

  test("treats a self-closer with interior whitespace as a closer", () => {
    expect(stripReasoningTags("A\u003Cthink / \u003EB")).toBe("AB");
  });

  test("collapses interior whitespace around newlines", () => {
    expect(stripReasoningTags("a  \nb\n  c\n\n\nd")).toBe("a\nb\nc\n\nd");
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
    expect(
      hasReasoningTags("\u003Cthink\u003Ehmm responseThe opening overclaims."),
    ).toBe(true);
  });

  test("catches aliases, orphan closers, and malformed self-closers", () => {
    expect(
      hasReasoningTags("\u003Cthinking\u003Eprivate\u003C/thinking\u003EAnswer"),
    ).toBe(true);
    expect(hasReasoningTags("Answer\u003C/think\u003E")).toBe(true);
    expect(hasReasoningTags("Answer\u003Cthink/\u003E")).toBe(true);
  });

  test("leaves ordinary prose alone", () => {
    expect(
      hasReasoningTags("The second paragraph gives the piece a spine."),
    ).toBe(false);
    expect(hasReasoningTags("I think the opening overclaims.")).toBe(false);
  });

  test("matches tags with attributes and interior whitespace", () => {
    expect(
      hasReasoningTags(
        "\u003Cthink class=\"ct\"\u003Eprivate response answer",
      ),
    ).toBe(true);
    expect(hasReasoningTags("\u003C think \u003E private response answer")).toBe(
      true,
    );
    expect(hasReasoningTags("\u003Cthink \u003E private answer")).toBe(true);
    expect(hasReasoningTags("\u003Cthink / \u003E private answer")).toBe(true);
  });

  test("does not carry regex state between calls", () => {
    const text = "\u003Cthink\u003Ea response\u003C/think\u003Eb";
    expect(hasReasoningTags(text)).toBe(true);
    expect(hasReasoningTags(text)).toBe(true);
  });
});

describe("removeReasoningTagMarkers", () => {
  /**
   * The last resort when both the reply and its regeneration strip to
   * nothing: the writer sees the model's thinking, which is poor, but never
   * a literal ` think` tag notation, which is broken.
   */
  test("keeps the content and drops only the markers", () => {
    expect(
      removeReasoningTagMarkers(
        "\u003Cthink\u003EAll of it was in here.\u003C/think\u003E",
      ),
    ).toBe("All of it was in here.");
  });

  test("handles an unclosed block", () => {
    expect(removeReasoningTagMarkers("\u003Cthink\u003Enever closed")).toBe(
      "never closed",
    );
  });

  test("trims whitespace outside the markers", () => {
    expect(
      removeReasoningTagMarkers("  \u003Cthink\u003Ehi\u003C/think\u003E  "),
    ).toBe("hi");
  });
});

describe("createVisibleTextFilter", () => {
  test("does not expose a reasoning tag split across chunks", () => {
    const push = createVisibleTextFilter();

    expect(push("Visible")).toBe("Visible");
    expect(push("\u003Cthi")).toBeNull();
    expect(push("nk\u003Eprivate")).toBeNull();
    expect(push(" response\u003C/think\u003EAnswer")).toBe("VisibleAnswer");
  });

  test("does not expose a split closing tag", () => {
    const push = createVisibleTextFilter();

    expect(push("\u003Cthink\u003Eprivate\u003C/thi")).toBeNull();
    expect(push("nk\u003EAnswer")).toBe("Answer");
  });

  test("returns null when a chunk changes no visible text", () => {
    const push = createVisibleTextFilter();

    expect(push("\u003Cthink\u003E")).toBeNull();
    expect(push("still private")).toBeNull();
    expect(push("\u003C/think\u003E")).toBeNull();
  });
});

describe("trimPartialReasoningTag", () => {
  test("withholds any prefix that could still become a tag", () => {
    const partials = [
      "\u003C",
      "\u003Ct",
      "\u003Cth",
      "\u003Cthi",
      "\u003Cthin",
      "\u003Cthink",
      "\u003Cthinki",
      "\u003Cthinkin",
      "\u003Cthinking",
      "\u003C/thinking",
      "\u003C/think",
      "\u003C/thinki",
      "\u003C/thinkin",
      "\u003C/thi",
      "\u003C/th",
      "\u003C/t",
      "\u003C/  t",
    ];
    for (const partial of partials) {
      expect(trimPartialReasoningTag(`Visible ${partial}`)).toBe("Visible");
    }
  });

  test("keeps text that only looks like a tag prefix", () => {
    const nonPartials = [
      "\u003Cthinker",
      "\u003Cthik",
      "\u003Cp",
      "\u003Ct\u003Ehi",
      "a \u003C b",
      "word",
    ];
    for (const text of nonPartials) {
      expect(trimPartialReasoningTag(`Visible ${text}`)).toBe(
        `Visible ${text}`,
      );
    }
  });

  test("trims trailing whitespace left before a partial tag", () => {
    expect(trimPartialReasoningTag("Visible  \u003Cthi")).toBe("Visible");
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