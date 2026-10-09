import { expect, test } from "bun:test";
import { parseInstrumentComment } from "./instrument-comment";
import {
  buildInstrumentRoomRequest,
  instrumentRoomComment,
} from "./instrument-room";
import { PERSONAS } from "./personas";

for (const [instrument, name] of [
  ["sentence", "Sentence bench"],
  ["threads", "Threads"],
  ["scene", "Scene bench"],
] as const) {
  test(`${name} generated invitation exposes the human question without changing full evidence`, () => {
    const prepared = buildInstrumentRoomRequest(
      {
        instrument,
        key: "fictional-passage",
        source: "Mara closed the blue door.",
        question: "Does this action make Mara's decision clear?",
        proposal: "Mara shut the blue door behind her.",
        detail: "A local comparison; no meaning verdict.",
      },
      PERSONAS,
    );
    const request = instrumentRoomComment(prepared, PERSONAS[0].id)!;
    const original = request.body;
    expect(parseInstrumentComment(original)).toEqual({
      instrument: name,
      personaName: PERSONAS[0].name,
      question: prepared.context.question,
    });
    expect(request.body).toBe(original);
    expect(original).toContain(prepared.context.source);
    expect(original).toContain(prepared.context.proposal!);
  });
}

test("ordinary writer prose and almost matching invitation labels remain ordinary comments", () => {
  const request = instrumentRoomComment(
    buildInstrumentRoomRequest(
      {
        instrument: "sentence",
        key: "one",
        source: "Mara waited.",
        question: "Is the pause clear?",
      },
      PERSONAS,
    ),
    PERSONAS[0].id,
  )!;
  for (const body of [
    "Please ask the editor about this paragraph.",
    "Sentence bench · A focused question for Editor\n\nMy own question\n\nSource passage (current manuscript; quoted evidence):\nMara waited.",
    request.body.replace("quoted evidence", "evidence"),
    request.body.replace("Sentence bench ·", "Sentence bench:"),
    request.body.replace("Is the pause clear?", " "),
    request.body.replace("Is the pause clear?", "q".repeat(601)),
    request.body + "\nWriter's own postscript",
    "x".repeat(32_001),
  ])
    expect(parseInstrumentComment(body)).toBeNull();
});
