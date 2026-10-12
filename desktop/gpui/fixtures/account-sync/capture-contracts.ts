/** Execute only AST-selected pure Source guards/diff functions. No imports from
 * app modules, browser/account state, network, or provider activity. Fixtures use
 * deterministic synthetic entropy and manuscript data. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const fixtureRoot = new URL("./", import.meta.url);
const repoRoot = new URL("../../../../", import.meta.url);
const sources = new Map<string, string>();
function extract(path: string, names: string[]) {
  const text = readFileSync(new URL(path, repoRoot), "utf8");
  sources.set(path, createHash("sha256").update(text).digest("hex"));
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<string, ts.Statement>();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found.set(node.name.text, ts.factory.updateFunctionDeclaration(node, node.modifiers?.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword), node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, node.body));
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          if (node.declarationList.declarations.length !== 1) throw new Error(`Extraction requires a single declaration: ${declaration.name.text}`);
          found.set(declaration.name.text, ts.factory.updateVariableStatement(node, node.modifiers?.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword), node.declarationList));
        }
      }
    }
  }
  for (const name of names) if (!found.has(name)) throw new Error(`Missing Source function/constant: ${path}:${name}`);
  const printer = ts.createPrinter();
  const selected = names.map((name) => printer.printNode(ts.EmitHint.Unspecified, found.get(name)!, file)).join("\n");
  if (/\b(fetch|XMLHttpRequest|WebSocket|runOnce|window|document|globalThis)\b/.test(selected)) {
    throw new Error(`Selected fixture functions crossed their pure offline contract: ${path}`);
  }
  return { selected, javascript: ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText };
}

const sync = extract("src/utils/convex-sync.ts", ["serialize", "changedRows", "removedRows", "diffPushPayload"]);
for (const marker of ["previous?.folios", "removedFolioContentIds", "personasMoved && next.customPersonas", "if (nothingMoved)", "undefined"]) {
  if (!sync.selected.includes(marker)) throw new Error(`Sync contract drift: ${marker}`);
}
const diff = new Function(`${sync.javascript}\nreturn diffPushPayload;`)() as (next: unknown, previous: unknown) => unknown;
const empty = () => ({ briefs: [], folios: [], folioContent: [], customPersonas: null, personaNotes: [], personaReplies: [], rubricResults: [], bibliography: [] });
const content = (source: string, folioId = "folio-not-a-uuid") => ({ folioId, html: "<p>A draft.</p>", format: "typst", typstSource: source });
const cases: Array<{ name: string; baseline: any; desired: any; expected?: unknown }> = [];
function add(name: string, baseline: any, desired: any) { cases.push({ name, baseline, desired, expected: JSON.parse(JSON.stringify(diff(desired, baseline))) }); }
add("unchanged-empty-account", empty(), empty());
add("exact-source-and-projection", empty(), { ...empty(), folioContent: [content("\uFEFF// fixture\r\n#text[雪]  \n$ x^2 $\n")] });
add("clear-replacement-collections", { ...empty(), folios: [{ id: "old", name: "Old" }], customPersonas: [{ id: "old-persona" }], bibliography: [{ id: "old-bib" }] }, { ...empty(), customPersonas: [] });
add("content-and-dossier-deletions", { ...empty(), folioContent: [content("kept bytes")], briefs: [{ folioId: "folio-not-a-uuid", brief: { answers: { workingTitle: "Old" } } }] }, empty());
const note = (noteId: string, feedback: string) => ({ folioId: "folio-not-a-uuid", noteId, personaId: "fixture-persona", personaName: "Fixture", personaColor: "#735446", type: "perspective", feedback, createdAt: 123 });
const reply = { folioId: "folio-not-a-uuid", replyId: "reply-old", noteId: "note-old", author: "Writer", authorKind: "user", text: "reply", createdAt: 124 };
add("upsert-and-remove-thread-rows", { ...empty(), personaNotes: [note("note-old", "Old"), note("note-stays", "Same")], personaReplies: [reply] }, { ...empty(), personaNotes: [note("note-stays", "Same"), note("note-new", "New")] });
add("v-any-folio-metadata", empty(), { ...empty(), folios: [{ id: "folio-foreign", name: "Kept", unknownEdition: { paper: "old", nested: [1, true] } }] });
add("rubric-replacement-and-deletion", { ...empty(), rubricResults: [{ folioId: "old", result: { scores: [1] } }] }, { ...empty(), rubricResults: [{ folioId: "new", result: { scores: [2] } }] });
add("unchanged-canonical-row-not-resent", { ...empty(), folioContent: [content("#let untouched = 1\r\n")], bibliography: [{ id: "entry", title: "Old" }] }, { ...empty(), folioContent: [content("#let untouched = 1\r\n")], bibliography: [{ id: "entry", title: "New" }] });

const auth = extract("src/utils/notorganic-connect.ts", ["NOTORGANIC_CALLBACK_PATH", "encode", "safeReturnTo", "beginNotOrganicSignIn", "readNotOrganicCallback"]);
for (const marker of ["600000", 'scope: "wallet:read"', 'prompt: "select_account"', 'url.searchParams.getAll("state").length !== 1', 'url.searchParams.getAll("code").length !== 1', 'url.searchParams.has("error")']) {
  if (!auth.selected.includes(marker)) throw new Error(`Auth contract drift: ${marker}`);
}
let entropyCounter = 0;
const deterministicCrypto = { subtle: globalThis.crypto.subtle, getRandomValues(array: Uint8Array) { array.fill(entropyCounter++ === 0 ? 1 : 2); return array; } };
const now = 1_700_000_000_000;
class FixtureDate extends Date { static override now() { return now; } }
const sourceAuth = new Function("crypto", "Date", "btoa", `${auth.javascript}\nreturn {beginNotOrganicSignIn, readNotOrganicCallback, safeReturnTo};`)(deterministicCrypto, FixtureDate, btoa);
const signIn = await sourceAuth.beginNotOrganicSignIn("http://127.0.0.1:42177", "/editor?folio=fixture");
const callbackCases = [
  { name: "valid", url: `${signIn.attempt.origin}/auth/notorganic/?code=fixture-code&state=${signIn.attempt.state}` },
  { name: "wrong-origin", url: `http://127.0.0.1:42178/auth/notorganic/?code=fixture-code&state=${signIn.attempt.state}` },
  { name: "wrong-path", url: `${signIn.attempt.origin}/settings/?code=fixture-code&state=${signIn.attempt.state}` },
  { name: "duplicate-code", url: `${signIn.attempt.origin}/auth/notorganic/?code=a&code=b&state=${signIn.attempt.state}` },
  { name: "duplicate-state", url: `${signIn.attempt.origin}/auth/notorganic/?code=a&state=${signIn.attempt.state}&state=${signIn.attempt.state}` },
  { name: "error-present-empty", url: `${signIn.attempt.origin}/auth/notorganic/?code=a&state=${signIn.attempt.state}&error=` },
  { name: "fragment", url: `${signIn.attempt.origin}/auth/notorganic/?code=a&state=${signIn.attempt.state}#fragment` },
  { name: "expired-at-boundary", url: `${signIn.attempt.origin}/auth/notorganic/?code=a&state=${signIn.attempt.state}`, expiresAt: now },
  { name: "wrong-state", url: `${signIn.attempt.origin}/auth/notorganic/?code=a&state=wrong` },
].map((input) => {
  const url = new URL(input.url);
  const attempt = { ...signIn.attempt, ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }) };
  let accepted = false;
  try { sourceAuth.readNotOrganicCallback(attempt, url); accepted = true; } catch { /* exact Source rejection */ }
  return { name: input.name, nowMs: now, expiresAt: attempt.expiresAt, accepted, origin: url.origin, pathname: url.pathname, fragment: url.hash, errorPresent: url.searchParams.has("error"), codes: url.searchParams.getAll("code"), states: url.searchParams.getAll("state") };
});
const result = { schemaVersion: 1, kind: "synthetic-source-execution-not-authentication", sourceSha256: Object.fromEntries(sources), selectedFunctions: { sync: ["serialize", "changedRows", "removedRows", "diffPushPayload"], auth: ["NOTORGANIC_CALLBACK_PATH", "encode", "safeReturnTo", "beginNotOrganicSignIn", "readNotOrganicCallback"] }, syncCases: cases, auth: { nowMs: now, verifierEntropyByte: 1, stateEntropyByte: 2, attempt: signIn.attempt, authorizationUrl: signIn.url, callbackCases, returnPaths: ["/editor", "//external.example", "/\\external", "/ok\nno", "https://external.example", "/"].map((input) => ({ input, expected: sourceAuth.safeReturnTo(input) })) } };
const output = JSON.stringify(result, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(new URL("source-contracts.json", fixtureRoot), "utf8") !== output) throw new Error("The source-backed fixture has drifted; inspect before regenerating.");
} else {
  writeFileSync(new URL("source-contracts.json", fixtureRoot), output);
}
console.log(JSON.stringify({ file: fileURLToPath(new URL("source-contracts.json", fixtureRoot)), syncCases: cases.length, callbackCases: callbackCases.length, sourceDefinitionsSelected: 9, sourceFunctionsExecuted: 8, networkCalls: 0, checkOnly: process.argv.includes("--check") }));
