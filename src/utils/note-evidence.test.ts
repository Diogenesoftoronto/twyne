import { describe, expect, test } from "bun:test";
import {
  evidenceFields,
  factsFromReadings,
  noteEvidence,
  normaliseNoteAnchors,
  normaliseNoteFacts,
} from "./note-evidence";
import type { PersonaExtractionReading } from "./persona-research";

const reading = (
  answers: PersonaExtractionReading["answers"],
): PersonaExtractionReading => ({ fields: {}, answers, partial: false });

describe("note evidence", () => {
  test("anchors drop the primary, repeats and contained passages, capped at three", () => {
    const out = normaliseNoteAnchors("Ada held the iron key.", [
      "Ada held the iron key.",
      "Ben carried a silver key.",
      "  ben   carried a silver KEY.  ",
      "Ben carried",
      "The door would not open for either of them.",
      "Rain came in off the estuary at dusk.",
      "A fourth passage that would overflow the card.",
      42,
      "short",
    ]);
    expect(out).toEqual([
      "Ben carried a silver key.",
      "The door would not open for either of them.",
      "Rain came in off the estuary at dusk.",
    ]);
  });

  test("old notes without anchors or facts read as empty evidence", () => {
    const ev = noteEvidence({ feedback: "Tighten this.", anchor: "Ada held." });
    expect(ev).toEqual({ passages: [], facts: [] });
    expect(evidenceFields({ anchor: "Ada held." })).toEqual({});
  });

  test("a passage the note already quotes is not listed again", () => {
    const ev = noteEvidence({
      feedback: 'Set "Ben carried a silver key" against the iron one.',
      anchor: "Ada held the iron key.",
      anchors: ["Ben carried a silver key.", "The door would not open."],
    });
    expect(ev.passages).toEqual(["The door would not open."]);
  });

  test("readings become facts without probabilities; near misses are marked", () => {
    const facts = factsFromReadings([
      reading({
        first_meeting_year: {
          type: "number",
          value: 1987,
          confidence: 0.91,
          source: { from: 0, to: 20, passage: "They met in 1987." },
          passages: [],
        },
        key_colour: {
          type: "text",
          value: null,
          guess: "silver",
          p_null: 0.7,
          source: { from: 30, to: 50, passage: "a pale key" },
          passages: [],
        },
        nothing: { type: "text", value: null, source: null, passages: [] },
      }),
    ]);
    expect(facts).toEqual([
      {
        id: "first_meeting_year",
        label: "first meeting year",
        value: "1987",
        passages: ["They met in 1987."],
      },
      {
        id: "key_colour",
        label: "key colour",
        value: "silver",
        near: true,
        passages: ["a pale key"],
      },
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/0\.7|0\.91|p_null|confidence/);
  });

  test("synced facts are normalised and unsourced ones are not shown", () => {
    const facts = normaliseNoteFacts([
      { id: "a", value: "x", passages: ["src", 3] },
      { id: "b", value: "y", passages: [] },
      { id: 1, value: "z" },
      null,
    ]);
    expect(facts).toEqual([
      { id: "a", label: "a", value: "x", passages: ["src"] },
      { id: "b", label: "b", value: "y", passages: [] },
    ]);
    expect(noteEvidence({ feedback: "n", facts }).facts.map((f) => f.id)).toEqual(["a"]);
  });
});
