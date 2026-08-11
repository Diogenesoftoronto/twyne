import { describe, expect, test } from "bun:test";
import { getPrompt, prompt, promptFrontmatter, renderPrompt } from "./prompts";

describe("prompts loader (bun fallback)", () => {
  test("renders a no-var file verbatim", () => {
    const out = prompt("synthesis-system");
    expect(out).toContain("Managing Editor of");
    expect(out).toContain("even-handed and decisive");
    expect(out).toContain("Five editors have each filed a full analysis");
  });

  test("substitutes {var} placeholders", () => {
    const out = prompt("blocks/rubric-review-brief", {
      audience: "editors of literary monthlies",
      goal: "to land a feature, not a puff piece",
      successSignal: "the writer commits to a next revision",
    });
    expect(out).toContain("- Audience: editors of literary monthlies");
    expect(out).toContain("- Goal: to land a feature, not a puff piece");
    expect(out).toContain(
      "- Success signal: the writer commits to a next revision",
    );
  });

  test("leaves unknown {placeholders} literal so missing vars are visible", () => {
    const out = prompt("blocks/rubric-review-brief", {
      audience: "editors",
      // goal + successSignal intentionally omitted
    });
    expect(out).toContain("- Audience: editors");
    expect(out).toContain("- Goal: {goal}");
    expect(out).toContain("- Success signal: {successSignal}");
  });

  test("strips frontmatter from the body", () => {
    const loaded = getPrompt("evidence-judge-system");
    expect(loaded.body).not.toContain("---");
    expect(loaded.body).not.toContain("notes:");
    expect(loaded.body.startsWith("You are a rigorous research editor.")).toBe(
      true,
    );
  });

  test("exposes parsed frontmatter", () => {
    const fm = promptFrontmatter("synthesis-system");
    expect(fm.version).toBe("1");
    expect(typeof fm.notes).toBe("string");
  });

  test("renders a Group C block with substituted values", () => {
    const out = renderPrompt(
      getPrompt("blocks/writer-profile-name").body,
      { displayName: "Anne" },
    );
    expect(out.trim()).toBe("- Name: Anne");
  });

  test("renders the empty-draft fallback", () => {
    const out = prompt("blocks/user-draft-empty");
    expect(out).toContain("DRAFT: empty");
    expect(out).toContain("Respond as if to a blank page");
  });

  test("renders the empty-missing-source block", () => {
    expect(prompt("blocks/missing-source-existing-empty").trim()).toBe(
      "No sources have been cited yet.",
    );
  });

  test("renderPrompt numeric values stringify", () => {
    expect(renderPrompt("x = {n}", { n: 7 })).toBe("x = 7");
  });
});
