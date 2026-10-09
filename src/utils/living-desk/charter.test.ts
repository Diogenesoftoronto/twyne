import { expect, test } from "bun:test";
import {
  deliberateCharterBaselines,
  deliberateCharterItem,
  deliberateCharterId,
} from "./charter";
import { deliberateBaseline, respectDeliberate } from "./deliberate";
import { analyzeStance } from "./stance";
import { emptyHouseState } from "../house-model";
import type { Block } from "./segment";
const block = (text: string): Block => ({
  kind: "paragraph",
  text,
  pos: 1,
  section: 0,
  paragraph: 1,
});
const text =
  "I remember my map. I knew myself. We argue for the bridge. We think it helps.";
test("a bounded Charter entry preserves exact signatures separately from readable prose", () => {
  const original = block(text),
    finding = analyzeStance([original]).finding!;
  const baseline = deliberateBaseline(finding, [original]);
  const item = deliberateCharterItem("folio", finding, baseline);
  expect(item).toMatchObject({
    id: deliberateCharterId("folio", "stance"),
    scope: "folio",
    ownerRef: "folio",
    severity: "prefer",
    kind: "voice",
    occurrenceException: { version: 1, findingId: "stance" },
  });
  expect(item.text).toContain("Flag new drift");
  expect(item.text).not.toContain("signature");
  const state = {
    ...emptyHouseState(),
    charter: [{ ...item, order: 0, updatedAt: 1 }],
  };
  const imported = deliberateCharterBaselines(state, "folio");
  expect(imported.get("stance")).toEqual(baseline);
  expect(deliberateCharterBaselines(state, "other").size).toBe(0);
  const changed = block(text.replace("We think", "We contend")),
    drift = analyzeStance([changed]).finding!;
  expect(
    respectDeliberate(drift, [changed], imported.get("stance")!).count,
  ).toBe(1);
});
test("remote removal restores flags; plain Charter prose cannot suppress occurrences", () => {
  const state = emptyHouseState();
  state.charter = [
    {
      id: "manual",
      scope: "folio",
      ownerRef: "folio",
      text: "All mixtures are deliberate",
      severity: "prefer",
      kind: "voice",
      order: 0,
      updatedAt: 1,
    },
  ];
  expect(deliberateCharterBaselines(state, "folio").size).toBe(0);
  const finding = analyzeStance([block(text)]).finding!;
  expect(respectDeliberate(finding, [block(text)], new Map()).count).toBe(2);
});
test("exception bounds reject oversized storage instead of silently granting broad exceptions", () => {
  const finding = analyzeStance([block(text)]).finding!;
  expect(() =>
    deliberateCharterItem(
      "folio",
      finding,
      new Map(Array.from({ length: 101 }, (_, index) => [String(index), 1])),
    ),
  ).toThrow("too large");
  expect(() =>
    deliberateCharterItem("folio", finding, new Map([["x".repeat(12001), 1]])),
  ).toThrow("too large");
  expect(() =>
    deliberateCharterItem("folio", finding, new Map([["exact", -1]])),
  ).toThrow("too large");
});
test("malformed local metadata cannot crash or grant an exception", () => {
  const finding = analyzeStance([block(text)]).finding!;
  const item = deliberateCharterItem("folio", finding, new Map([["exact", 1]]));
  const state = emptyHouseState();
  state.charter = [{ ...item, order: 0, updatedAt: 1 }];
  state.charter[0].occurrenceException!.signatures = [null] as never;
  expect(deliberateCharterBaselines(state, "folio").size).toBe(0);
});
