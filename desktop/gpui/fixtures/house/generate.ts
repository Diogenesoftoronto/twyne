/** Regenerate with: rtk proxy bun desktop/gpui/fixtures/house/generate.ts.
 * Executes the current pure House model and unmodified store operation bodies.
 * Only browser/IDB boundaries, time and generated IDs are replaced by a harness.
 * This fixture is a data contract, not browser, sync or provider evidence.
 */
import {
  assembleContextStack,
  contextForModels,
  emptyHouseState,
  type HouseState,
} from "../../../../src/utils/house-model";
import type { ProjectBrief } from "../../../../src/types";

const storeSource = await Bun.file(
  new URL("../../../../src/utils/house-store.ts", import.meta.url),
).text();
const start = storeSource.indexOf("export const HOUSE_META_KEY");
if (start < 0) throw new Error("House store module boundary changed");
const body = new Bun.Transpiler({ loader: "ts" })
  .transformSync(storeSource.slice(start))
  .replace(/\bexport\s+/g, "");
let stored: HouseState = emptyHouseState();
let now = 1000;
let sequence = 0;
const methods = [
  "setHouseName",
  "setHouseField",
  "createCollection",
  "updateCollection",
  "deleteCollection",
  "setFolioCollection",
  "upsertCharterItem",
  "removeCharterItem",
] as const;
const store = new Function(
  "loadMetaFromIdb",
  "saveMetaToIdb",
  "toStorable",
  "emptyHouseState",
  "window",
  "CustomEvent",
  "crypto",
  "Date",
  `${body}\nreturn {${methods.join(",")}};`,
)(
  async () => structuredClone(stored),
  async (_key: string, value: HouseState) => {
    stored = structuredClone(value);
  },
  structuredClone,
  emptyHouseState,
  { dispatchEvent() {} },
  class {
    constructor(
      public type: string,
      public options: unknown,
    ) {}
  },
  { randomUUID: () => `web-generated-${++sequence}` },
  { now: () => now },
) as Record<(typeof methods)[number], (...args: any[]) => Promise<HouseState>>;

const base: HouseState = {
  house: {
    name: "The Lantern",
    dossier: { tone: "Clear", audience: "Curious neighbours" },
    updatedAt: 900,
  },
  collections: [
    {
      id: "web/collection:letters",
      name: "Letters",
      description: "A monthly letter",
      folioIds: ["web/folio:café", "not-imported:folio"],
      dossier: { tone: "Personal", constraints: "One primary source" },
      createdAt: 20,
      updatedAt: 800,
      futureCollection: { binding: "thread" },
    },
    {
      id: "collection:essays",
      name: "Essays",
      description: "",
      folioIds: ["folio:second"],
      dossier: {},
      createdAt: 30,
      updatedAt: 850,
    },
  ],
  charter: [
    {
      id: "charter:house",
      scope: "house",
      ownerRef: "house",
      text: "Cite a primary source",
      severity: "must",
      kind: "citation",
      order: 0,
      updatedAt: 80,
    },
    {
      id: "charter:letters",
      scope: "collection",
      ownerRef: "web/collection:letters",
      text: "Open on a scene",
      severity: "prefer",
      kind: "style",
      order: 0.5,
      updatedAt: 81,
      futureArticle: { reviewed: false },
    },
  ],
  ledger: [],
} as HouseState;

const cases: unknown[] = [];
async function operation(method: (typeof methods)[number], args: unknown[]) {
  const before = structuredClone(stored);
  const after = await store[method](...args);
  const nativeId =
    method === "createCollection" ? after.collections.at(-1)!.id : undefined;
  cases.push({ method, args, now, before, after, nativeId });
  now++;
}
stored = structuredClone(base);
await operation("setHouseName", [" \ufeffThe Lantern Press\ufeff "]);
await operation("setHouseField", ["goal", " Make the reader notice "]);
await operation("setHouseField", ["goal", "Make the reader notice"]); // no-op
await operation("updateCollection", [
  "web/collection:letters",
  {
    name: " Correspondence ",
    description: " Notes from this street ",
    field: { name: "tone", value: " Familiar " },
  },
]);
await operation("setFolioCollection", ["web/folio:café", "collection:essays"]);
await operation("setFolioCollection", ["folio:second", null]);
await operation("createCollection", [" Field notes ", ["web/folio:café"]]);
await operation("upsertCharterItem", [
  { ...stored.charter[1], text: " Start with a scene ", severity: "must" },
]);
await operation("upsertCharterItem", [
  {
    id: "charter:new",
    scope: "folio",
    ownerRef: "web/folio:café",
    text: " Stay under 1,200 words ",
    severity: "prefer",
    kind: "length",
  },
]);
await operation("removeCharterItem", ["charter:new"]);
await operation("removeCharterItem", ["absent:article"]); // no-op
await operation("deleteCollection", ["web/collection:letters"]);

const brief: ProjectBrief = {
  answers: {
    workingTitle: "A light on the corner",
    format: "Essay",
    audience: "Everyone",
    goal: "Show how the street changed",
    tone: "Familiar",
    constraints: "",
    successSignal: "The reader visits",
  },
  attachments: [
    {
      id: "reference:web/1",
      kind: "document",
      title: "Original notes",
      text: "Line one\r\nLine two\r\n",
      why: "A primary source",
      addedAt: 51,
      futureReference: { provenance: "scan" },
    },
  ],
  probes: [],
  completedAt: 100,
  updatedAt: 880,
} as ProjectBrief;
const contextState = structuredClone(base);
contextState.house.dossier.format = "Newsletter";
contextState.house.dossier.workingTitle = "Does not inherit";
contextState.collections[0].dossier.audience = "Neighbours";
contextState.ledger = [
  {
    id: "ledger:amendment",
    at: 879,
    layer: "amendment",
    ownerRef: "web/folio:café",
    field: "tone",
    from: "Personal",
    to: "Familiar",
    source: "amendment",
  },
];
const contexts = [
  { name: "nearest dossier and filed amendment", standIns: {} },
  {
    name: "interview stand-ins yield to inherited defaults",
    standIns: { format: "Essay", audience: "Everyone", tone: "Familiar" },
  },
  {
    name: "latest manual change removes amendment attribution",
    standIns: {},
    manual: true,
  },
].map(({ name, standIns, manual }) => {
  const state = structuredClone(contextState);
  if (manual)
    state.ledger.unshift({
      id: "ledger:manual",
      at: 880,
      layer: "folio",
      ownerRef: "web/folio:café",
      field: "tone",
      from: "Familiar",
      to: "Familiar",
      source: "manual",
    });
  const stack = assembleContextStack(state, "web/folio:café", brief, standIns);
  return {
    name,
    state,
    brief,
    standIns,
    stack,
    models: contextForModels(stack),
  };
});
await Bun.write(
  new URL("web-reference.json", import.meta.url),
  JSON.stringify({ base, operations: cases, contexts }, null, 2) + "\n",
);
