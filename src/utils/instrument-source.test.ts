import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import {
  instrumentPassage,
  locateInstrumentSpan,
  instrumentRoomAnchorMatches,
} from "./instrument-source";
import { createSceneInventory } from "./scene-bench";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    atom: { group: "inline", inline: true, atom: true },
  },
  marks: { em: {} },
});
const p = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
describe("instrument source positions", () => {
  test("room invitations require the owned folio and every exact related span", () => {
    const first = "Mara waited.";
    const second = "The river rose.";
    const doc = schema.nodes.doc.create(null, [p(first), p(second)]);
    const from = first.length + 3;
    const anchor = {
      folioId: "folio",
      from: 1,
      to: first.length + 1,
      text: first,
      related: [{ from, to: from + second.length, text: second }],
    };
    expect(instrumentRoomAnchorMatches(doc, "folio", anchor)).toBe(true);
    expect(instrumentRoomAnchorMatches(doc, "other", anchor)).toBe(false);
    expect(
      instrumentRoomAnchorMatches(
        schema.nodes.doc.create(null, [p(first), p("The river fell.")]),
        "folio",
        anchor,
      ),
    ).toBe(false);
    expect(
      instrumentRoomAnchorMatches(doc, "folio", {
        ...anchor,
        to: doc.content.size + 1,
      }),
    ).toBe(false);
  });
  test("selects the second identical sentence, preserving marks and UTF-16", () => {
    const text = "🌒 Mara crossed the bridge.";
    const doc = schema.nodes.doc.create(null, [
      p(text),
      schema.nodes.paragraph.create(null, [
        schema.text("🌒 Mara ", [schema.marks.em.create()]),
        schema.text("crossed the bridge."),
      ]),
    ]);
    const from = text.length + 3;
    const passage = instrumentPassage(doc, "folio", {
      from,
      to: from + text.length,
    });
    expect(passage.text).toBe(text);
    expect(passage.sourceOffset).toBe(text.length + 2);
    expect(
      locateInstrumentSpan(
        doc,
        "folio",
        passage,
        createSceneInventory(passage).spans[0],
      ),
    ).toEqual({ from, to: from + text.length });
    expect(
      locateInstrumentSpan(
        doc,
        "other-folio",
        passage,
        createSceneInventory(passage).spans[0],
      ),
    ).toBeNull();
  });
  test("drops stale offsets and maps across inline atoms", () => {
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [
        schema.text("Mara "),
        schema.nodes.atom.create(),
        schema.text("waited."),
      ]),
    );
    const passage = instrumentPassage(doc, "folio");
    const span = createSceneInventory(passage).spans[0];
    expect(passage.text).toBe("Mara waited.");
    expect(locateInstrumentSpan(doc, "folio", passage, span)).toEqual({
      from: 1,
      to: 14,
    });
    expect(
      locateInstrumentSpan(
        schema.nodes.doc.create(null, p("Mara turned.")),
        "folio",
        passage,
        span,
      ),
    ).toBeNull();
    expect(
      locateInstrumentSpan(doc, "folio", passage, {
        ...span,
        text: "Invented evidence.",
      }),
    ).toBeNull();
  });
});
