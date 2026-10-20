import { describe, expect, it } from "vitest";
import {
  decisionsDigest,
  settledBy,
  withoutSettled,
  type NoteDecision,
} from "./note-decisions";

const draft =
  "The ferry left without her.\n\nShe watched the lights go out across the water.";
const decision: NoteDecision = {
  noteId: "pn-1",
  personaId: "devil",
  anchor: "The ferry left without her.",
  kind: "intentional",
  summary: "The departure is abrupt.",
  at: 1,
};

describe("note decisions", () => {
  it("keeps the same editor off a passage the writer settled", () => {
    expect(
      settledBy(
        { personaId: "devil", anchor: "the ferry left without her" },
        [decision],
        draft,
      ),
    ).toEqual(decision);
  });

  it("lets another editor raise it", () => {
    const notes = [
      { personaId: "muse", anchor: "The ferry left without her." },
    ];
    expect(withoutSettled(notes, [decision], draft)).toEqual(notes);
  });

  it("lapses once the passage is rewritten", () => {
    const rewritten = draft.replace("left without her", "pulled away at dawn");
    expect(
      settledBy(
        { personaId: "devil", anchor: "The ferry pulled away at dawn." },
        [decision],
        rewritten,
      ),
    ).toBeNull();
    expect(decisionsDigest([decision], rewritten)).toBe("");
  });

  it("tells the editors what is settled", () => {
    expect(decisionsDigest([decision], draft)).toContain(
      "the writer means this as written",
    );
  });
});
