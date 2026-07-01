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

  test("applies a mention by replacing the trailing partial", () => {
    expect(applyMention("Hey @Re", "Reader")).toBe("Hey @Reader ");
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
