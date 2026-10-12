/** Executes the real original pure comment selector/stacking/clip functions.
 * Run: rtk proxy bun desktop/gpui/fixtures/marginalia/generate-rail.ts
 * No DOM/provider/storage operation is replaced by a claimed browser check.
 */
import { anchorOverlap, decideSurface, scoreItem, stackCards,
  type FlowItem } from "../../../../src/utils/flow-items";

const dir = new URL("./", import.meta.url);
const now = 2_000_000;
const notes = [
  { id: "comment:web:live", anchors: ["Keep the opening concrete."], createdAt: now - 60_000 },
  { id: "comment:older", anchors: ["The notebook was small enough to carry."], createdAt: now - 1_200_000 },
  { id: "comment:same-quote", anchors: ["Keep the opening concrete."], createdAt: now - 60_000 },
  { id: "comment:café", anchors: ["Café — a quotation, softened corners."], createdAt: now },
  { id: "comment:unicode", anchors: ["ὈΔΌΣ 東京 १२३ \u0345combining"], createdAt: now + 1000 },
].map((item) => ({ ...item, kind: "comment", title: "You", body: "Note" })) as FlowItem[];
const cases = [];
for (const mode of ["working", "settling", "flow", "stuck", "away"] as const) {
  for (const cursorText of ["", "Keep the opening concrete.",
    "Notebook enough remembered", "CAFÉ — café quotation", "ὀδός 東京 १२३ \u0345combining"]) {
    for (const dismissed of [[], ["comment:web:live", "comment:café"]]) {
      for (const shown of [[], ["comment:older", "comment:same-quote"]]) {
        const context = { mode, cursorText, dismissed: new Set(dismissed),
          shown: new Set(shown), visibleAnchors: new Set([notes[1].anchors[0]]),
          weight: () => 1.37, now, workingLimit: 3 };
        const result = decideSurface(notes, context);
        cases.push({ mode, cursorText, dismissed, shown, now, weight: 1.37,
          visibleAnchors: [...context.visibleAnchors], workingLimit: 3,
          visible: result.visible.map((item) => item.id), held: result.held,
          scores: notes.map((item) => ({ id: item.id,
            overlap: anchorOverlap(item, cursorText), score: scoreItem(item, context) })) });
      }
    }
  }
}
const stackCases = [
  { cards: [{ id: "first", top: 100, height: 80 }, { id: "second", top: 100, height: 50 }], obstacles: [] },
  { cards: [{ id: "late", top: 240, height: 100 }, { id: "early", top: -4, height: 50 },
    { id: "same", top: -4, height: 80 }], obstacles: [{ top: 0, height: 100 }, { top: 150, height: 75 }] },
  { cards: [{ id: "thread", top: 100, height: 451 }, { id: "below", top: 150, height: 90 }],
    obstacles: [{ top: 600, height: 64 }] },
  { cards: [{ id: "touch", top: 110, height: 20 }, { id: "boundary", top: 150, height: 5 }],
    obstacles: [{ top: 50, height: 50 }] },
].map((test) => ({ ...test, expected: stackCards(test.cards, test.obstacles) }));
const source = await Bun.file(new URL("../../../../src/components/in-flow/flow-surface.tsx", import.meta.url)).text();
const clipStart = source.indexOf("const clip =");
const clipEnd = source.indexOf("\nexport const FlowSurface", clipStart);
if (clipStart < 0 || clipEnd < 0) throw new Error("Original FlowSurface clip boundary changed.");
const clipSource = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(clipStart, clipEnd));
const clip = new Function(`${clipSource}\nreturn clip;`)() as (text: string, n: number) => string;
const clipCases = [
  { text: "Café **plain preview**.\n\nNext paragraph.", limit: 280 },
  { text: "a".repeat(278) + " 😀 suffix", limit: 280 },
  { text: "a".repeat(278) + "\u00a0 \nend", limit: 280 },
  { text: "reply ".repeat(100), limit: 420 },
  // Source slice can bisect a surrogate pair. Rust's UTF-8 display string uses
  // the same replacement glyph as browser text rendering; the full note stays
  // untouched. JSON cannot deserialize a raw lone surrogate into a Rust String.
  { text: "a".repeat(278) + "😀 suffix", limit: 280 },
].map((test) => ({ ...test, expected: clip(test.text, test.limit).toWellFormed() }));

// Execute the original closure with explicit read-only geometry/controller
// adapters. This is a pure drawing fixture, separate from the real browser
// hover/focus evidence in browser-rail-metrics.json.
const connectionStart = source.indexOf("const drawConnections = () =>");
const connectionEnd = source.indexOf("\n      const onSnapshot =", connectionStart);
if (connectionStart < 0 || connectionEnd < 0) {
  throw new Error("Original FlowSurface connection boundary changed.");
}
const connectionSource = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.slice(connectionStart, connectionEnd),
);
const canvasRect = { left: 100, top: 180, right: 804, bottom: 1380, width: 704, height: 1200 };
const textRect = { left: 132, top: 196, right: 772, bottom: 1096, width: 640, height: 900 };
const connectionNotes = [
  { id: "comment:web:live", anchors: ["Repeated quotation"], top: 66, side: "room" },
  { id: "comment:same-quote", anchors: ["Repeated quotation"], top: 236, side: "room" },
  { id: "comment:other", anchors: ["A different quotation"], top: 416, side: "room" },
  { id: "comment:unplaced", anchors: ["Repeated quotation"], top: 516, side: "room" },
].map((note) => ({ item: { ...note, kind: "comment" }, top: note.top, side: note.side }));
const connectionGroups: Record<string, { left: number; top: number; width: number; height: number; right: number; bottom: number }[][]> = {
  "comment:web:live": [[{ left: 142, top: 250, width: 90, height: 24, right: 232, bottom: 274 },
    { left: 132, top: 274, width: 130, height: 24, right: 262, bottom: 298 }]],
  "comment:same-quote": [[{ left: 155, top: 420, width: 120, height: 22, right: 275, bottom: 442 }],
    [{ left: 170, top: 490, width: 40, height: 22, right: 210, bottom: 512 }]],
  "comment:other": [[{ left: 132, top: 600, width: 200, height: 24, right: 332, bottom: 624 }]],
  // Equal text with no actual mark geometry must produce no invented line.
  "comment:unplaced": [],
};
const connectionCases = [
  { room: "rail", hoverId: "comment:web:live", peekId: null, openId: null },
  { room: "dock", hoverId: null, peekId: "comment:same-quote", openId: null },
  { room: "rail", hoverId: null, peekId: null, openId: "comment:other" },
  { room: "rail", hoverId: null, peekId: null, openId: null },
].map((test) => {
  const state = { ...test, width: canvasRect.width, archive: false, placed: connectionNotes,
    lines: [], brackets: [], marks: [] };
  const canvas = { getBoundingClientRect: () => canvasRect,
    querySelector: () => ({ getBoundingClientRect: () => textRect }) };
  const controller = { anchorRects: (item: { id: string }) => connectionGroups[item.id] ?? [] };
  const run = new Function("state", "canvas", "flowController", "accent", "GUTTER",
    `${connectionSource}\ndrawConnections();`);
  run(state, canvas, () => controller, () => "writer-note", 28);
  return { ...test, canvas: canvasRect, text: textRect, notes: connectionNotes,
    groups: connectionGroups, expected: { lines: state.lines, brackets: state.brackets, marks: state.marks } };
});
await Bun.write(new URL("rail-web-reference.json", dir),
  JSON.stringify({ notes, cases, stackCases, clipCases, connectionCases }, null, 2) + "\n");

// Exact original JavaScript \p{L}/\p{N} categories. Rust's is_alphanumeric also
// accepts Other_Alphabetic combining marks, so it is not this source predicate.
const ranges: [number, number][] = [];
let start: number | null = null;
for (let scalar = 0; scalar <= 0x110000; scalar++) {
  const matches = scalar < 0x110000 && !(scalar >= 0xd800 && scalar <= 0xdfff) &&
    /[\p{L}\p{N}]/u.test(String.fromCodePoint(scalar));
  if (matches && start === null) start = scalar;
  if (!matches && start !== null) { ranges.push([start, scalar - 1]); start = null; }
}
await Bun.write(new URL("rail-letter-number-ranges.json", dir), JSON.stringify(ranges) + "\n");
console.log({ cases: cases.length, stackCases: stackCases.length,
  clipCases: clipCases.length, connectionCases: connectionCases.length,
  letterNumberRanges: ranges.length });
