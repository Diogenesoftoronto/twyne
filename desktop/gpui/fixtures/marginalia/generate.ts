/** Run with rtk proxy bun desktop/gpui/fixtures/marginalia/generate.ts.
 * Executes original web store bodies and pure reconciliation. Only local
 * storage, window and time are substituted; no browser/provider/sync proof.
 */
import { reconcileCommentAnchors } from "../../../../src/utils/reconcile-comments";
import type { UserComment } from "../../../../src/utils/user-comments";

const source = await Bun.file(
  new URL("../../../../src/utils/user-comments.ts", import.meta.url),
).text();
const start = source.indexOf("const COMMENTS_PATH =");
if (start < 0) throw new Error("User comment store module boundary changed");
const body = new Bun.Transpiler({ loader: "ts" })
  .transformSync(source.slice(start))
  .replace(/\bexport\s+/g, "");
const files = new Map<string, unknown>();
let now = 1000;
const methods = [
  "loadUserComments",
  "upsertUserComment",
  "appendUserCommentReply",
  "toggleUserCommentResolved",
  "deleteUserComments",
  "clearUserComments",
] as const;
const store = new Function(
  "readFileAsJson",
  "writeFileAsJson",
  "window",
  "Date",
  `${body}\nreturn {${methods.join(",")}};`,
)(
  async (path: string) => structuredClone(files.get(path)),
  async (path: string, value: unknown) =>
    files.set(path, structuredClone(value)),
  {},
  { now: () => now },
) as Record<(typeof methods)[number], (...args: any[]) => Promise<any>>;
const base: UserComment[] = [
  {
    id: "web/comment:café",
    folioId: "web/folio:café",
    text: "Check **this claim**.\n\nKeep the quotation.",
    author: "You",
    anchor: "The notebook was small enough",
    resolved: false,
    createdAt: 90,
    updatedAt: 100,
    audioId: "local-voice:original",
    audioDurationMs: 2450.25,
    transcriptProvider: "original-provider",
    futureThread: { provenance: "spoken" },
    replies: [
      {
        id: "reply:editor",
        author: "The Scholar",
        authorKind: "persona",
        personaId: "scholar",
        color: "#2c4a7c",
        text: "Keep the primary source.",
        createdAt: 95,
        futureReply: { model: "retained" },
      },
    ],
  },
  {
    id: "foreign:note",
    folioId: "not-imported:folio",
    text: "Foreign note",
    author: "Elsewhere",
    resolved: true,
    createdAt: 20,
    updatedAt: 30,
    replies: [],
    unseenScope: ["retain", 3],
  },
] as unknown as UserComment[];
files.set("/user-comments.json", structuredClone(base));
const cases: unknown[] = [];
async function operation(method: (typeof methods)[number], args: unknown[]) {
  const before = structuredClone(files.get("/user-comments.json"));
  const result = await store[method](...args);
  const after = structuredClone(files.get("/user-comments.json"));
  cases.push({ method, args, now, before, after, result });
  now++;
}
await operation("upsertUserComment", [
  {
    id: "web/comment:café",
    folioId: "web/folio:café",
    text: "A parent body edited after replies arrived.",
    author: "You",
    resolved: false,
    createdAt: 90,
    updatedAt: 999,
    replies: [],
  },
]);
await operation("appendUserCommentReply", [
  "web/comment:café",
  {
    id: "r-1000",
    author: "You",
    authorKind: "user",
    text: "  Café — keep these spaces.  ",
    createdAt: 1000,
  },
]);
await operation("toggleUserCommentResolved", ["web/comment:café"]);
await operation("toggleUserCommentResolved", ["web/comment:café"]);
await operation("deleteUserComments", [[]]);
await operation("deleteUserComments", [
  ["web/comment:café", "foreign:note", "absent"],
]);
await operation("appendUserCommentReply", [
  "web/comment:early",
  {
    id: "persona:early",
    author: "The Editor",
    authorKind: "persona",
    personaId: "editor",
    text: "The reply arrived first.",
    createdAt: 800,
    color: "#d4a017",
  },
]);
await operation("upsertUserComment", [
  {
    id: "web/comment:early",
    folioId: "web/folio:café",
    text: "The parent arrived later.",
    author: "You",
    anchor: "A real original passage",
    resolved: false,
    createdAt: 799,
    updatedAt: 1007,
    replies: [],
  },
]);
const reconciliationThreads = [
  ...base,
  {
    ...base[0],
    id: "same-quote-no-mark",
    text: "This is a ghost, despite identical anchor prose.",
  },
];
const marks = [
  "web/comment:café",
  "headless:mark",
  "web/comment:café",
  "second-headless",
  "headless:mark",
];
const reconciliation = {
  threads: reconciliationThreads,
  marks,
  result: reconcileCommentAnchors(reconciliationThreads, marks),
};
// Execute the actual editor caller through its scoped filter and local delete.
// The DOM walk, debounce, connected mutation and dispatches are outside this
// deterministic fixture. Actual DOM marks are separately exported by the
// original browser flow in browser-manuscript.html.
const editorSource = await Bun.file(
  new URL("../../../../src/components/editor/twyne-editor.tsx", import.meta.url),
).text();
const callerStart = editorSource.indexOf("const markIds = collectCommentMarkIdsFromHtml(html);");
const deleteLine = "await deleteUserComments(deletedIds);";
const callerEnd = editorSource.indexOf(deleteLine, callerStart);
if (callerStart < 0 || callerEnd < 0) throw new Error("Editor reconciliation caller boundary changed");
const callerBody = editorSource.slice(callerStart, callerEnd + deleteLine.length);
const caller = new Function(
  "html", "store", "collectCommentMarkIdsFromHtml", "loadUserComments",
  "reconcileCommentAnchors", "deleteUserComments",
  `return (async () => {${callerBody}\n}\nreturn result;})();`,
);
const callerScope = "web/folio:café";
const callerBefore = [
  structuredClone(base[0]),
  { ...structuredClone(base[0]), id: "same-quote-orphan", futureThread: { origin: "same quote; distinct ID" } },
  { ...structuredClone(base[0]), id: "struck-orphan", resolved: true },
  structuredClone(base[1]),
];
const callerMarks = ["headless:actual-mark", "web/comment:café", "web/comment:café"];
files.set("/user-comments.json", structuredClone(callerBefore));
const callerResult = await caller(
  "", { activeFolioId: callerScope }, () => callerMarks,
  store.loadUserComments, reconcileCommentAnchors, store.deleteUserComments,
);
const callerReconciliation = {
  folioId: callerScope,
  marks: callerMarks,
  before: callerBefore,
  after: structuredClone(files.get("/user-comments.json")),
  result: callerResult,
  heldDrafts: {
    [callerScope]: {
      "same-quote-orphan": "Unfiled last character… Café\nStill held.",
      "web/comment:café": "Live draft",
    },
    "not-imported:folio": { "foreign:note": "Foreign draft stays" },
  },
};
const legacy = [
  {
    id: "legacy:note",
    text: "Old panel note",
    selectedText: "Old passage",
    from: 4,
    to: 17,
    author: "You",
    timestamp: 50,
    resolved: false,
    futureLegacy: { keep: true },
    replies: [
      {
        id: "legacy:reply",
        author: "You",
        text: "Older reply",
        timestamp: 60,
        position: 2,
      },
    ],
  },
];
files.set("/user-comments.json", []);
files.set("/comments.json", structuredClone(legacy));
const migrated = await store.loadUserComments();
await Bun.write(
  new URL("web-reference.json", import.meta.url),
  JSON.stringify(
    {
      base,
      cases,
      reconciliation,
      callerReconciliation,
      legacy: {
        before: legacy,
        after: migrated,
        legacyAfterLoad: files.get("/comments.json"),
      },
    },
    null,
    2,
  ) + "\n",
);
