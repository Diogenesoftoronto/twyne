import { describe, expect, test } from "bun:test";
import {
  activeMentionQuery,
  applyMention,
  filterMentionables,
  mentionedIn,
  type Mentionable,
} from "./mentions";

const items: Mentionable[] = [
  { id: "reader", name: "Reader", kind: "persona" },
  { id: "editor", name: "Editor", kind: "persona" },
  { id: "ally", name: "Ally Reyes", kind: "collaborator" },
];

describe("mentions", () => {
  test("detects a trailing partial mention", () => {
    expect(activeMentionQuery("Hey @Re")).toBe("Re");
    expect(activeMentionQuery("Hey @")).toBe("");
    expect(activeMentionQuery("Hey there")).toBeNull();
    expect(activeMentionQuery("Hey @Re ")).toBeNull();
  });

  test("detects a mention at the very start of the note", () => {
    expect(activeMentionQuery("@Ed")).toBe("Ed");
    expect(activeMentionQuery("@")).toBe("");
  });

  test("ignores the @ inside an email address", () => {
    expect(activeMentionQuery("write to ally@example")).toBeNull();
    expect(activeMentionQuery("ally@")).toBeNull();
  });

  test("detects a mention at the caret, not just at end of text", () => {
    const value = "Hey @Re — see the note below";
    expect(activeMentionQuery(value, 7)).toBe("Re");
    // Caret past the mention: no longer an active query.
    expect(activeMentionQuery(value, value.length)).toBeNull();
  });

  test("uses the mention nearest the caret when there are several", () => {
    const value = "@Reader and @Ed";
    expect(activeMentionQuery(value, 7)).toBe("Reader");
    expect(activeMentionQuery(value, value.length)).toBe("Ed");
  });

  test("clamps an out-of-range caret rather than throwing", () => {
    expect(activeMentionQuery("Hey @Re", 999)).toBe("Re");
    expect(activeMentionQuery("Hey @Re", -4)).toBeNull();
  });

  test("applies a mention by replacing the partial at the caret", () => {
    expect(applyMention("Hey @Re", "Reader")).toEqual({
      text: "Hey @Reader ",
      caret: "Hey @Reader ".length,
    });
  });

  test("applies a mention at the start of the note", () => {
    expect(applyMention("@Re", "Reader")).toEqual({
      text: "@Reader ",
      caret: 8,
    });
  });

  test("preserves text after the caret and reports the new caret", () => {
    const value = "Hey @Re — see below";
    const result = applyMention(value, "Reader", 7);
    expect(result.text).toBe("Hey @Reader  — see below");
    // Caret lands just past the inserted "@Reader ".
    expect(result.caret).toBe("Hey @Reader ".length);
    expect(result.text.slice(result.caret)).toBe(" — see below");
  });

  test("rewrites the mention at the caret, not the last one in the note", () => {
    const value = "@Re and @Editor";
    const result = applyMention(value, "Reader", 3);
    expect(result.text).toBe("@Reader  and @Editor");
  });

  test("leaves the text alone when the caret is not in a mention", () => {
    expect(applyMention("Hey there", "Reader")).toEqual({
      text: "Hey there",
      caret: 9,
    });
  });

  test("names with spaces are reachable by their first word", () => {
    expect(filterMentionables(items, "ally").map((i) => i.id)).toEqual(["ally"]);
    expect(applyMention("cc @Ally", "Ally Reyes").text).toBe("cc @Ally Reyes ");
  });

  test("filters mentionables by case-insensitive prefix", () => {
    expect(filterMentionables(items, "re").map((i) => i.id)).toEqual([
      "reader",
    ]);
    expect(filterMentionables(items, "").length).toBe(3);
  });

  test("finds whole-word @-mentions of any kind in text", () => {
    const found = mentionedIn(
      "cc @Editor and @Ally Reyes on this, not @Editorial",
      items,
    );
    expect(found.map((i) => i.id)).toEqual(["editor", "ally"]);
  });
});
