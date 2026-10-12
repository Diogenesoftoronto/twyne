/**
 * Generate native conformance fixtures through the actual web exporter and
 * validate them through the actual web importer. Run from the repository root:
 *
 *   bun desktop/gpui/fixtures/exchange/generate.ts
 *
 * Files contain synthetic manuscripts only. The deliberately stale cache
 * verifies that an importer chooses canonical source rather than HTML.
 */
import { exportTwyneBackup, importAs } from "../../../../src/utils/exchange";
import type { Folio, ProjectBrief } from "../../../../src/types";
import { format } from "prettier";

const directory = import.meta.dir;
const time = 1_791_072_000_000;
const source =
  "// Preserve my native source, including unknown syntax.\r\n" +
  "#let double(x) = x * 2\r\n" +
  "\r\n= Canonical Å — café\r\n\r\n" +
  "The canonical manuscript has *emphasis*, a 🧵, and custom code.\r\n" +
  "#double(21)\r\n";
const brief: ProjectBrief = {
  answers: {
    workingTitle: "Field and form",
    format: "Essay",
    audience: "Writers who keep notebooks",
    goal: "Make the ordinary visible",
    tone: "Attentive and direct",
    constraints: "Keep the source, marks, and uncertainty",
    successSignal: "The reader notices one small thing",
  },
  attachments: [
    {
      id: "attachment-document",
      kind: "document",
      title: "A clipped field note",
      text: "First line\r\nSecond line — Å",
      why: "A detail the draft should preserve",
      addedAt: time,
    },
    {
      id: "attachment-link",
      kind: "link",
      title: "A primary source",
      url: "https://example.com/source?q=field&n=1",
      why: "The source for a claim",
      addedAt: time + 1,
    },
  ],
  completedAt: time,
  updatedAt: time + 2,
  probes: [
    {
      id: "choice",
      kind: "choice",
      prompt: "How should the reader feel?",
      options: ["Focused", "Restless"],
      answer: "Focused",
      relatesTo: "tone",
    },
    {
      id: "multi",
      kind: "multi",
      prompt: "Which threads matter?",
      options: ["History", "Form", "Time"],
      answer: ["History", "Form"],
      relatesTo: "goal",
    },
    {
      id: "blanks",
      kind: "blanks",
      prompt: "Finish the sentence.",
      template: "The reader should ___ and then ___.",
      answer: ["notice", "write"],
      relatesTo: "successSignal",
    },
    {
      id: "scale",
      kind: "scale",
      prompt: "How wide is the audience?",
      min: 0,
      max: 10,
      minLabel: "One writer",
      maxLabel: "Everyone",
      answer: 7.5,
      relatesTo: "audience",
    },
    {
      id: "unanswered",
      kind: "choice",
      prompt: "Still undecided?",
      options: ["Yes", "No"],
    },
  ],
};
const folios: Folio[] = [
  {
    id: "folio-draft-non-uuid",
    name: "Field and form",
    type: "draft",
    createdAt: time,
    updatedAt: time + 4,
    layout: {
      width: "wide",
      margin: "normal",
      marginX: 2.25,
      marginLeft: 1.75,
      marginRight: 2.5,
      marginTop: 1.25,
      marginBottom: 1.75,
      runningHeader: true,
      pageNumbers: true,
      showMarginGuides: false,
      paper: "a4",
      orientation: "portrait",
      marginUnit: "mm",
      openingInitial: {
        mode: "illuminated",
        collection: "alternate",
        size: "large",
      },
      pageBorder: "engraved",
      columns: 2,
      columnGap: 1.75,
      // pagination deliberately absent, exactly as DEFAULT_LAYOUT requires.
    },
    header: "Running header — Å",
    footer: "Private draft / folio 7",
  },
  {
    id: "folio-notes-non-uuid",
    name: "Field notes",
    type: "notes",
    createdAt: time - 5,
    updatedAt: time + 1,
    layout: {
      width: "normal",
      margin: "roomy",
      runningHeader: false,
      pageNumbers: false,
      pagination: "paginated",
    },
    header: "",
    footer: "",
  },
  {
    id: "folio-outline-non-uuid",
    name: "Structure",
    type: "outline",
    createdAt: time - 1,
    updatedAt: time,
  },
];

const exported = exportTwyneBackup({
  title: "Field and form",
  html: "<p>Stale HTML — <em>this is not the canonical manuscript</em>.</p>",
  typstSource: source,
  brief,
  folios,
});
const webV2 = JSON.parse(exported);
// Fix the fixture's clock, leaving every document field produced by the exporter.
webV2.exportedAt = "2026-10-04T00:00:00.000Z";

const legacyBrief = { ...brief };
delete legacyBrief.probes;
const webV1 = {
  version: 1,
  exportedAt: "2025-01-01T00:00:00.000Z",
  title: "Legacy HTML manuscript",
  brief: legacyBrief,
  folios: [folios[1]],
  content: {
    html: "<h1>Legacy title</h1><p>Retain <em>these marks</em> and &amp; entities.</p>",
  },
};

const extended = structuredClone(webV2);
extended.futureWorkspace = { revision: 4, identity: "writer-owned" };
extended.content.sourceMap = {
  encoding: "utf-8",
  compiler: "future-compiler",
  offsets: [0, 12, 37],
};
extended.folios[0].futureCover = "engraved";
extended.folios[0].layout.futureRule = "double";
extended.folios[0].layout.openingInitial.futureInk = "indigo";
extended.brief.futureStatus = "revised";
extended.brief.answers.futureReader = "the writer";
extended.brief.attachments[0].futureLocator = "sheet 3";
extended.brief.probes[0].futureConfidence = "high";

for (const [filename, backup] of [
  ["web-v2.twyne.json", webV2],
  ["web-v1-html.twyne.json", webV1],
  ["web-v2-extended.twyne.json", extended],
] as const) {
  const text = await format(JSON.stringify(backup, null, 2), {
    parser: "json",
  });
  const imported = await importAs(new File([text], filename));
  if (backup.content.typstSource !== undefined) {
    if (imported.typstSource !== source)
      throw new Error(`${filename} failed canonical source preservation`);
    if (imported.html.includes("Stale HTML"))
      throw new Error(`${filename} used the stale HTML cache`);
  } else if (imported.html !== backup.content.html) {
    throw new Error(`${filename} failed legacy HTML preservation`);
  }
  await Bun.write(`${directory}/${filename}`, text);
}
await Bun.write(`${directory}/canonical.typ`, source);
console.log("Generated three native fixtures; actual web imports verified.");
