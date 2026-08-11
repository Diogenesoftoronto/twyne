import { describe, expect, test } from "bun:test";
import { createOpenUiStream, extractCompleteCardPrograms } from "./stream";

describe("OpenUI source stream", () => {
  test("exposes completed cards while a later card is still arriving", () => {
    const stream = createOpenUiStream();
    const first = stream.push('root = Cards([Card("First", [Prose("Complete")]), Card("Sec');
    expect(first.cards[0]?.props.title).toBe("First");
    expect(first.completedCards.map((card) => card.props.title)).toEqual(["First"]);
    expect(first.incomplete).toBe(true);

    const done = stream.push('ond", [Prose("Also complete")])])');
    expect(done.cards.map((card) => card.props.title)).toEqual(["First", "Second"]);
    expect(done.completedCards).toHaveLength(2);
    expect(done.incomplete).toBe(false);
  });

  test("never promotes a partial card", () => {
    const stream = createOpenUiStream();
    const snapshot = stream.set('root = Cards([Card("Partial", [Prose("unfinished');
    expect(snapshot.completedCards).toEqual([]);
  });

  test("handles an empty parser result", () => {
    const stream = createOpenUiStream();
    const result = stream.getSnapshot();
    expect(result.root).toBeNull();
    expect(result.cards).toEqual([]);
  });

  test("does not mistake parentheses inside strings for card boundaries", () => {
    const programs = extractCompleteCardPrograms(
      'root = Cards([Card("A (qualified) title", [Prose("Use \\"x)\\" here")]), Card("still',
    );
    expect(programs).toHaveLength(1);
    expect(programs[0]).toContain('A (qualified) title');
  });
});
