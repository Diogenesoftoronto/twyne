import { describe, expect, test } from "bun:test";
import {
  buildSpeechSourceMap,
  mapSpeechSourceRange,
} from "./speech-source-map";

function mappedWord(
  source: string,
  rendered: string,
  word: string,
  occurrence = 0,
) {
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1)
    start = source.indexOf(word, start + 1);
  const map = buildSpeechSourceMap(source, rendered, { markdown: true });
  const range = mapSpeechSourceRange(map, start, start + word.length);
  return range
    ? { ...range, text: rendered.slice(range.start, range.end) }
    : null;
}

describe("speech source mapping", () => {
  test("an explicit manuscript offset selects the correct repeated passage", () => {
    const clip = "The same words.";
    const manuscript = `${clip}\n\n🙂 ${clip}`;
    const offset = manuscript.lastIndexOf(clip);
    const map = buildSpeechSourceMap(clip, manuscript, {
      sourceOffset: offset,
    });
    expect(mapSpeechSourceRange(map, 4, 8)).toEqual({
      start: offset + 4,
      end: offset + 8,
    });
    expect(buildSpeechSourceMap(clip, manuscript)).toBeNull();
    expect(
      buildSpeechSourceMap(clip, manuscript, { sourceOffset: 3 }),
    ).toBeNull();
  });

  test("a unique manuscript chunk maps without the whole manuscript being spoken", () => {
    const clip = "A later sentence.";
    const manuscript = `Opening words.\n\n${clip}\n\nClosing words.`;
    const map = buildSpeechSourceMap(clip, manuscript);
    expect(map?.renderedStart).toBe(manuscript.indexOf(clip));
    expect(map?.renderedEnd).toBe(manuscript.indexOf(clip) + clip.length);
  });

  test("bold, links and list markers do not shift source words", () => {
    const source =
      "Read **bold** and [linked words](https://example.test/bold).\n\n- First item\n- Second item";
    const rendered = "Read bold and linked words.\n\nFirst item\n\nSecond item";
    for (const word of ["Read", "bold", "linked", "words", "First", "Second"])
      expect(mappedWord(source, rendered, word)?.text).toBe(word);
    const map = buildSpeechSourceMap(source, rendered, { markdown: true });
    const hidden = source.indexOf("https://");
    expect(mapSpeechSourceRange(map, hidden, hidden + 5)).toBeNull();
    expect(
      mapSpeechSourceRange(map, source.indexOf("**"), source.indexOf("**") + 8),
    ).toBeNull();
  });

  test("repeated labels and words retain their occurrence, excluding link destinations", () => {
    const source =
      "[same](https://example.test/same) same **same**. Next same.";
    const rendered = "same same same. Next same.";
    expect(mappedWord(source, rendered, "same", 0)?.start).toBe(0);
    expect(mappedWord(source, rendered, "same", 1)).toBeNull();
    expect(mappedWord(source, rendered, "same", 2)?.start).toBe(5);
    expect(mappedWord(source, rendered, "same", 3)?.start).toBe(10);
    expect(mappedWord(source, rendered, "same", 4)?.start).toBe(21);
  });

  test("UTF-16 offsets stay correct around emoji and a sentence change", () => {
    const source = "🙂 **First** sentence. Next [café](https://example.test).";
    const rendered = "🙂 First sentence. Next café.";
    expect(mappedWord(source, rendered, "🙂")).toEqual({
      start: 0,
      end: 2,
      text: "🙂",
    });
    expect(mappedWord(source, rendered, "First")).toEqual({
      start: 3,
      end: 8,
      text: "First",
    });
    expect(mappedWord(source, rendered, "Next")).toEqual({
      start: 19,
      end: 23,
      text: "Next",
    });
    expect(mappedWord(source, rendered, "café")?.text).toBe("café");
  });

  test("changed or ambiguous rendered prose never receives guessed word positions", () => {
    expect(
      buildSpeechSourceMap("**right** word", "wrong word", { markdown: true }),
    ).toBeNull();
    expect(
      buildSpeechSourceMap("**same**", "same same", { markdown: true }),
    ).toBeNull();
    expect(mapSpeechSourceRange(null, 0, 4)).toBeNull();
  });

  test("line breaks and nested formatting map only literal visible words", () => {
    const source = "> A **bold** line\n> and `code`.";
    const rendered = "A bold line\nand code.";
    for (const word of ["A", "bold", "line", "and", "code"])
      expect(mappedWord(source, rendered, word)?.text).toBe(word);
  });
});
