import { describe, expect, test } from "bun:test";
import { emptyHouseState, type HouseState } from "./house-model";
import { mergeHouseStates } from "./house-sync";

function state(at: number): HouseState {
  return {
    ...emptyHouseState(at),
    house: { name: String(at), dossier: { tone: String(at) }, updatedAt: at },
    collections: [
      {
        id: String(at),
        name: "Series",
        description: "",
        dossier: {},
        folioIds: ["folio"],
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
}
describe("mergeHouseStates", () => {
  test("newer house selects the house and entire collection snapshot", () => {
    const local = state(1),
      remote = state(2);
    expect(mergeHouseStates(local, remote).house).toEqual(remote.house);
    expect(mergeHouseStates(local, remote).collections).toEqual(
      remote.collections,
    );
    expect(mergeHouseStates(remote, local).collections).toEqual(
      remote.collections,
    );
    expect(
      mergeHouseStates(local, { ...remote, collections: [] }).collections,
    ).toEqual([]);
  });
  test("ties preserve local house and collections", () => {
    const local = state(2),
      remote = state(2);
    remote.house.name = "Other";
    remote.collections = [];
    expect(mergeHouseStates(local, remote)).toEqual(local);
  });
  test("newer withdrawals survive an older remote charter", () => {
    const local = state(3),
      remote = state(1);
    remote.charter = [
      {
        id: "item",
        scope: "house",
        ownerRef: "house",
        text: "Withdrawn",
        severity: "must",
        kind: "style",
        order: 0,
        updatedAt: 1,
      },
    ];
    const before = JSON.stringify([local, remote]);
    expect(mergeHouseStates(local, remote).charter).toEqual([]);
    expect(mergeHouseStates(remote, local).charter).toEqual([]);
    expect(JSON.stringify([local, remote])).toBe(before);
  });
  test("ledger unions ids newest first and retains local duplicates", () => {
    const local = state(1),
      remote = state(2);
    const entry = {
      id: "a",
      at: 1,
      layer: "house",
      ownerRef: "house",
      source: "manual",
    } as const;
    local.ledger = [entry];
    remote.ledger = [
      { ...entry, reason: "duplicate" },
      { ...entry, id: "b", at: 3 },
    ];
    expect(mergeHouseStates(local, remote).ledger).toEqual([
      { ...entry, id: "b", at: 3 },
      entry,
    ]);
  });
});
