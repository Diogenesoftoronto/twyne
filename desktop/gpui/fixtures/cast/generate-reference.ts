/** Cast-only fixtures from current source. No browser, provider or account I/O. */
import { PERSONAS } from "../../../../src/utils/personas";
import { DEFAULT_ROOM_SETTINGS, type Persona } from "../../../../src/types";
import { buildVoicePreview, toAgentPersona } from "../../../../convex/agentPrompts";
import { getPrompt } from "../../../../src/utils/prompts";
import { exportRoomAnalysisMarkdown, safeFilename } from "../../../../src/utils/exchange";

const folder = import.meta.dir;
const source = await Bun.file(`${folder}/../../../../src/routes/personas/index.tsx`).text();
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
function section(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Cast source section is missing: ${start}`);
  return source.slice(from, to);
}
const levelAndScope = transpiler.transformSync(section("  const setPersonaLevel =", "  const toggleVoicePreview ="));
const removeCode = transpiler.transformSync(section("  const remove =", "  const move ="));
const editCode = transpiler.transformSync(section("  const saveEdit =", "  const remove ="));
const lineCode = transpiler.transformSync(section("function linesFromTextarea", "/**\n * The cast's colours"));
const clone = <T>(v: T): T => structuredClone(v);
const cases: unknown[] = [];
for (const initial of [DEFAULT_ROOM_SETTINGS, { ...DEFAULT_ROOM_SETTINGS, perPersona: { devil: "comments", foreign: "paragraph" }, personaScope: ["devil", "unimported"] }]) {
  for (const operation of ["toggleScope", "setPersonaLevel", "remove"] as const) {
    const store = { personas: clone(PERSONAS), roomSettings: clone(initial) };
    const persistSettings = async (next: unknown) => { store.roomSettings = next as typeof store.roomSettings; };
    const persistPersonas = async (next: Persona[]) => { store.personas = next; };
    const code = operation === "remove" ? removeCode : levelAndScope;
    const run = new Function("$", "store", "persistSettings", "persistPersonas", `${code}\nreturn ${operation};`)(
      (fn: unknown) => fn, store, persistSettings, persistPersonas,
    );
    const before = clone(store);
    if (operation === "setPersonaLevel") await run("devil", "comments");
    else await run("devil");
    cases.push({ operation, id: "devil", level: "comments", before, after: clone(store) });
  }
}
const optional: Persona = { id: "foreign/editor:café", name: "Retained editor", role: "The Visitor", color: "var(--color-ink)", icon: "❧", description: "Prior local configuration.", focus: "The actual retained passage", speechVoice: "custom-audio-id", speechVoices: { openai: "voice-from-prior-version", "future-voice": "future-id" } as never, providerId: "local-provider-id", model: "local-model-name", temperature: 0.125, ...{ voice: null, backstory: null, sourceMetadata: { owner: "foreign", exact: "<>& 東京" } } as never };
const editStore = {
  personas: [clone(optional)], editingId: optional.id, draftName: "  Preserved name  ", draftRole: "The Visitor", draftDescription: "Edited description", draftFocus: "The actual retained passage", draftBackstory: "  A life.  ", draftCriticalMethod: "", draftVoice: "  Quiet.  ", draftSignatureMoves: " - First\n• Second\n\n— Third ", draftAvoidances: " ", draftSampleLines: " An actual sample. ", draftIcon: "❧", draftColor: "var(--color-ink)",
};
const editBefore = clone(editStore.personas);
new Function("$", "store", "persistPersonas", `${lineCode}\n${editCode}\nreturn saveEdit;`)(
  (fn: unknown) => fn, editStore, async (next: Persona[]) => { editStore.personas = next; },
)();
cases.push({ operation: "edit", before: editBefore, draft: clone(editStore), after: clone(editStore.personas) });

const notes = [
  { personaId: "devil", personaName: PERSONAS[0].name, personaColor: PERSONAS[0].color, feedback: "**Keep the claim exact.**\n\nRetained editorial material.", timestamp: 1700000000000, type: "critique", anchor: "The repeated sentence.", noteId: "pn-source:one", briefTitle: "Prior dossier", origin: "convened", traceId: null, folioId: "web/folio:café", sourceMetadata: { exact: "<>& 東京" } },
  { personaId: "devil", personaName: "Prior Sceptique", personaColor: "#c1272d", feedback: "An older retained note.", timestamp: 1699999000000, type: "suggestion", anchor: "The repeated sentence.", noteId: "pn-source:older" },
  { personaId: "reader", personaName: PERSONAS[4].name, personaColor: PERSONAS[4].color, feedback: "The next paragraph kept my attention.", timestamp: 1700000000001, type: "perspective", anchor: "The repeated sentence.", noteId: "pn-source:reader", origin: "background" },
  { personaId: "unknown-editor", personaName: "A retained voice", personaColor: "var(--future-color)", feedback: "Legacy headless material.", timestamp: 1700000000002, type: "future-type", anchor: null, noteId: null, futureNote: true },
];
const replies = [
  { id: "preply-source:one", noteId: "pn-source:one", author: "You", authorKind: "user", text: "A prior filed reply.", timestamp: 1700000000100, futureReply: { retained: true } },
  { id: "preply-source:persona", folioId: "web/folio:café", noteId: "pn-source:one", author: PERSONAS[0].name, authorKind: "persona", personaId: "devil", text: "An actual imported persona answer, not generated by the native fixture.", timestamp: 1700000000200 },
  { id: "preply-future:one", noteId: "pn-source:reader", author: "Retained author", authorKind: "future-author", personaId: null, text: "Future reply metadata.", timestamp: 1700000000300 },
];
const analysis = {
  folioId: "web/folio:café", briefTitle: "The retained notebook", timestamp: 1700000000000,
  synthesis: "## Keep the premise visible\n\nAn existing saved synthesis.", synthesisProvider: "prior-provider",
  memos: [{ personaId: "devil", personaName: PERSONAS[0].name, personaColor: PERSONAS[0].color, text: "**Retained memo.**\n\nRead the actual sentence.", anchor: "The repeated sentence.", provider: "prior-provider", futureMemo: { keep: true } }], futureAnalysis: { keep: true },
};
const grouped = Array.from(notes.reduce((map, note) => { const old = map.get(note.personaId); if (!old || old.timestamp < note.timestamp) map.set(note.personaId, note); return map; }, new Map<string, typeof notes[number]>()).values());
await Bun.write(`${folder}/resident-personas.json`, JSON.stringify(PERSONAS, null, 2) + "\n");
await Bun.write(`${folder}/prompt-templates.json`, JSON.stringify({ personaTemplate: getPrompt("persona-system").body, editorialProtocol: getPrompt("editorial-protocol").body }, null, 2) + "\n");
await Bun.write(`${folder}/web-reference.json`, JSON.stringify({
  provenance: "Current original TS data and pure routines; retained-note shapes are explicit test data, never provider-generated results.",
  defaults: DEFAULT_ROOM_SETTINGS, optionalPersona: optional, cases, notes, replies, analysis,
  groupedIds: grouped.map(n => n.noteId ?? null),
  voicePreviews: [...PERSONAS, optional].map(persona => ({ persona, preview: buildVoicePreview(toAgentPersona(persona)) })),
  analysisExport: { filedLabel: new Date(analysis.timestamp).toLocaleString(), markdown: exportRoomAnalysisMarkdown(analysis), filename: safeFilename(`${analysis.briefTitle} full analysis`, "md") },
}, null, 2) + "\n");
// Native capture input is explicitly imported retained test metadata. It does
// not assert that a provider generated these notes or that marks exist.
await Bun.write(`${folder}/native-retained.json`, JSON.stringify({
  format: "twyne-gpui-cast", version: 1, generation: 0,
  personas: PERSONAS, roomSettings: DEFAULT_ROOM_SETTINGS,
  folios: {
    "web/folio:café": { notes, replies, analysis, fixtureOrigin: "explicit retained test material" },
    "unimported/foreign": { notes: [notes[0]], replies: [], futureArtifact: { keep: true } },
  },
  replyDrafts: {},
}, null, 2) + "\n");
console.log("Cast source fixtures written; no provider calls.");
