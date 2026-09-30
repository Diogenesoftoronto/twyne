import { expect, test } from "bun:test";
import {
  assembleContextStack,
  effectiveBrief,
  emptyHouseState,
} from "./house-model";
import type { ProjectBrief } from "../types";

test("nearest context wins, charter accumulates, and projection never rewrites the dossier", () => {
  const house = emptyHouseState();
  house.house.dossier = {
    tone: "House voice",
    audience: "General readers",
    workingTitle: "Never inherited",
  };
  house.collections = [
    {
      id: "series",
      name: "Series",
      description: "",
      folioIds: ["f"],
      dossier: { tone: "Series voice" },
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  house.charter = [
    {
      id: "one",
      scope: "house",
      ownerRef: "house",
      text: "Cite primary sources",
      severity: "must",
      kind: "citation",
      order: 0,
      updatedAt: 1,
    },
    {
      id: "two",
      scope: "folio",
      ownerRef: "another",
      text: "Unrelated",
      severity: "must",
      kind: "style",
      order: 0,
      updatedAt: 1,
    },
  ];
  const brief: ProjectBrief = {
    answers: {
      workingTitle: "",
      format: "",
      audience: "",
      goal: "Explain",
      tone: "My voice",
      constraints: "500 words",
      successSignal: "",
    },
    attachments: [],
    completedAt: 1,
    updatedAt: 1,
  };
  const before = JSON.stringify({ house, brief });
  const stack = assembleContextStack(house, "f", brief);
  expect(stack.fields.tone.shadowed.map((f) => f.value)).toEqual([
    "Series voice",
    "House voice",
  ]);
  expect(stack.fields.audience.layer).toBe("house");
  expect(stack.fields.workingTitle.value).toBe("");
  const projected = effectiveBrief(stack, brief);
  expect(projected.answers.constraints).toBe(
    "500 words\nMust: Cite primary sources",
  );
  expect(projected.answers.tone).toBe("My voice");
  expect(JSON.stringify({ house, brief })).toBe(before);
  expect(
    assembleContextStack(house, "f", {
      ...brief,
      answers: { ...brief.answers, tone: "" },
    }).fields.tone.layer,
  ).toBe("collection");
});

test("later manual edits supersede amendment provenance", () => {
  const house = emptyHouseState();
  const entry = {
    id: "a",
    at: 1,
    layer: "amendment",
    ownerRef: "f",
    field: "tone",
    to: "Warm",
    source: "amendment",
  } as const;
  house.ledger = [entry];
  const brief: ProjectBrief = {
    answers: {
      workingTitle: "",
      format: "",
      audience: "",
      goal: "",
      tone: "Warm",
      constraints: "",
      successSignal: "",
    },
    attachments: [],
    completedAt: 1,
    updatedAt: 1,
  };
  expect(assembleContextStack(house, "f", brief).fields.tone.layer).toBe(
    "amendment",
  );
  house.ledger.unshift({
    ...entry,
    id: "b",
    at: 2,
    source: "refine",
    layer: "folio",
  });
  expect(assembleContextStack(house, "f", brief).fields.tone.layer).toBe(
    "folio",
  );
});
