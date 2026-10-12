/**
 * Regenerate with `rtk proxy bun desktop/gpui/fixtures/dossier/generate.ts`.
 * The fixture calls the existing web helpers directly. Persistence adapters
 * are inert so generating a contract fixture cannot open a provider or store.
 */
import { mock } from "bun:test";

const web = new URL("../../../../src/utils/", import.meta.url);
const unused = () => {
  throw new Error("Persistence is outside this Dossier contract fixture");
};
mock.module(new URL("convex-sync.ts", web).pathname, () => ({
  markDirty: unused,
}));
mock.module(new URL("lix.ts", web).pathname, () => ({
  BRIEF_PATH: "brief.json",
  writeFileAsJson: unused,
}));
mock.module(new URL("idb.ts", web).pathname, () => ({
  loadActiveFolioIdFromIdb: unused,
  loadBriefFromIdb: unused,
  loadFolioContentFromIdb: unused,
  saveBriefToIdb: unused,
}));
mock.module(new URL("brief-history.ts", web).pathname, () => ({
  archiveBriefEdition: unused,
}));

const { DEFAULT_INTERVIEW_ANSWERS, createProjectBrief, withFolioTitle } =
  await import(new URL("anti-tabula-rasa.ts", web).pathname);
const { buildLocalFormProbes } = await import(
  new URL("form-probes.ts", web).pathname
);
const now = 1_700_000_000_000;
Date.now = () => now;

const raw = {
  ...DEFAULT_INTERVIEW_ANSWERS,
  workingTitle: "\uFEFF  ",
  format: "  Dispatch  ",
  audience: "\n",
  tone: "  Quiet and exact  ",
};
const normalized = withFolioTitle(raw, "  The named folio  ");
const localProbes = buildLocalFormProbes(DEFAULT_INTERVIEW_ANSWERS);
const refinement = createProjectBrief(
  DEFAULT_INTERVIEW_ANSWERS,
  {
    answers: DEFAULT_INTERVIEW_ANSWERS,
    attachments: [],
    completedAt: 42,
    updatedAt: 43,
  },
  [],
  [{ ...localProbes[1], answer: "Change a belief" }],
);
await Bun.write(
  new URL("web-contract.json", import.meta.url),
  `${JSON.stringify(
    {
      generatedBy: "src/utils/anti-tabula-rasa.ts and src/utils/form-probes.ts",
      now,
      defaults: DEFAULT_INTERVIEW_ANSWERS,
      localProbes,
      rawAnswers: raw,
      folioName: "  The named folio  ",
      creation: createProjectBrief(normalized, null, [], []),
      refinement,
    },
    null,
    2,
  )}\n`,
);
