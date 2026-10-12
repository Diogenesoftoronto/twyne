import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "..");
// Reuse the original pure starter functions without importing the route's
// browser/Convex side effects into a local document helper. Regenerate on every
// build so the desktop cannot drift behind the source application's wording.
const starterSource = await readFile(
  resolve(root, "../../src/utils/anti-tabula-rasa.ts"),
  "utf8",
);
const defaultsStart = starterSource.indexOf(
  "export const DEFAULT_INTERVIEW_ANSWERS:",
);
const defaultsEnd = starterSource.indexOf("\n};", defaultsStart) + 4;
const functionsStart = starterSource.indexOf(
  "export function buildStarterDocument(",
);
if (defaultsStart < 0 || defaultsEnd < 4 || functionsStart < 0)
  throw new Error("The starter document source contract changed.");
await writeFile(
  resolve(import.meta.dir, "semantic-starter.generated.ts"),
  "// Generated from src/utils/anti-tabula-rasa.ts by build-helper.ts.\n" +
    'import type { ProjectInterviewAnswers, ProjectBrief } from "../../../src/types";\n' +
    starterSource.slice(defaultsStart, defaultsEnd) +
    "\n" +
    starterSource.slice(functionsStart),
);
// The fingerprint helper is pure, but its module imports browser persistence.
// Extract that exact function into the same generated local-only bridge.
const fingerprintSource = await readFile(
  resolve(root, "../../src/utils/rubric-judgement-result.ts"),
  "utf8",
);
const fingerprintStart = fingerprintSource.indexOf(
  "export async function rubricDraftFingerprint(",
);
const fingerprintEnd = fingerprintSource.indexOf("\n}", fingerprintStart) + 2;
if (fingerprintStart < 0 || fingerprintEnd < 2)
  throw new Error("The rubric fingerprint source contract changed.");
await writeFile(
  resolve(import.meta.dir, "semantic-rubric.generated.ts"),
  "// Generated from src/utils/rubric-judgement-result.ts by build-helper.ts.\n" +
    fingerprintSource.slice(fingerprintStart, fingerprintEnd) +
    "\n",
);
// Bibliography's persistence module imports Lix. Copy only these exact pure
// declarations so local citation operations cannot initialize that browser
// store, research watchers or provider clients.
const bibliographySource = await readFile(
  resolve(root, "../../src/utils/bibliography.ts"),
  "utf8",
);
const bibliographyFunctions = new Set([
  "bibliographyForFolio",
  "mlaEscape",
  "formatMla",
  "formatApa",
  "formatChicago",
  "formatCitation",
  "formatUrlAccessed",
  "footnoteCite",
  "normalizeUrl",
  "hasResolvableUrl",
  "findBibliographyEntryByUrl",
  "stableCitationId",
  "buildBibEntryFromFormattedCitation",
]);
const bibliographyAst = ts.createSourceFile(
  "bibliography.ts",
  bibliographySource,
  ts.ScriptTarget.Latest,
  true,
);
const pureBibliography = bibliographyAst.statements.filter(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) &&
    !!node.name &&
    bibliographyFunctions.has(node.name.text),
);
if (
  pureBibliography.length !== bibliographyFunctions.size ||
  new Set(pureBibliography.map((node) => node.name!.text)).size !==
    bibliographyFunctions.size
)
  throw new Error("The offline bibliography source contract changed.");
await writeFile(
  resolve(import.meta.dir, "semantic-apparatus.generated.ts"),
  "// Generated from src/utils/bibliography.ts by build-helper.ts.\n" +
    'import type { BibEntry, CitationStyle, FormattedCitationFields } from "../../../src/utils/bibliography";\n' +
    'import type { DetectedCitation } from "../../../src/types";\n' +
    pureBibliography.map((node) => node.getText(bibliographyAst)).join("\n\n") +
    "\n",
);
const editorSource = await readFile(
  resolve(root, "../../src/components/editor/twyne-editor.tsx"),
  "utf8",
);
const editorAst = ts.createSourceFile(
  "twyne-editor.tsx",
  editorSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const findTextRange = editorAst.statements.filter(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "findTextRange",
);
if (findTextRange.length !== 1)
  throw new Error("The citation passage lookup source contract changed.");
await writeFile(
  resolve(import.meta.dir, "semantic-citation-anchor.generated.ts"),
  "// Generated from the original editor by build-helper.ts.\n" +
    "export " +
    findTextRange[0].getText(editorAst) +
    "\n",
);
// Offline steering reuses only the original ordered failure guards. Never
// import the research watcher, its provider clients, or its runOnce body.
const researchSource = await readFile(
  resolve(root, "../../src/utils/background-research.ts"),
  "utf8",
);
const researchAst = ts.createSourceFile(
  "background-research.ts",
  researchSource,
  ts.ScriptTarget.Latest,
  true,
);
const steeringFunction = researchAst.statements.filter(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "steerBackgroundResearch",
);
const researchResult = researchAst.statements.filter(
  (node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) &&
    node.name.text === "ResearchCommandResult",
);
const minimumDraft = researchAst.statements.filter(
  (node): node is ts.VariableStatement =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "MIN_DRAFT_CHARS",
    ),
);
const steeringContract = () => {
  throw new Error("The offline steering source contract changed.");
};
if (
  steeringFunction.length !== 1 ||
  researchResult.length !== 1 ||
  minimumDraft.length !== 1
)
  steeringContract();
const steering = steeringFunction[0];
if (
  !steering.body ||
  steering.parameters.length !== 1 ||
  steering.parameters[0].name.getText(researchAst) !== "instructions" ||
  steering.parameters[0].type?.kind !== ts.SyntaxKind.StringKeyword ||
  !steering.modifiers?.some(
    (item) => item.kind === ts.SyntaxKind.AsyncKeyword,
  ) ||
  !steering.type ||
  !ts.isTypeReferenceNode(steering.type) ||
  steering.type.typeName.getText(researchAst) !== "Promise" ||
  steering.type.typeArguments?.length !== 1 ||
  steering.type.typeArguments[0].getText(researchAst) !==
    "ResearchCommandResult"
)
  steeringContract();
const resultMembers = researchResult[0].members;
if (
  resultMembers.length !== 2 ||
  !resultMembers.every(ts.isPropertySignature) ||
  resultMembers[0].name.getText(researchAst) !== "ok" ||
  resultMembers[0].questionToken ||
  resultMembers[0].type?.kind !== ts.SyntaxKind.BooleanKeyword ||
  resultMembers[1].name.getText(researchAst) !== "message" ||
  !resultMembers[1].questionToken ||
  resultMembers[1].type?.kind !== ts.SyntaxKind.StringKeyword
)
  steeringContract();
const minimumDeclaration = minimumDraft[0].declarationList.declarations;
if (
  !(minimumDraft[0].declarationList.flags & ts.NodeFlags.Const) ||
  minimumDeclaration.length !== 1 ||
  !minimumDeclaration[0].initializer ||
  !ts.isNumericLiteral(minimumDeclaration[0].initializer) ||
  Number(minimumDeclaration[0].initializer.text) !== 120
)
  steeringContract();
const printer = ts.createPrinter({ removeComments: true });
const printed = (node: ts.Node, source: ts.SourceFile) =>
  printer.printNode(ts.EmitHint.Unspecified, node, source);
const steeringStatements = steering.body!.statements;
const boundary = steeringStatements.findIndex(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isAwaitExpression(node.expression) &&
    ts.isCallExpression(node.expression.expression) &&
    ts.isIdentifier(node.expression.expression.expression) &&
    node.expression.expression.expression.text === "runOnce",
);
if (
  boundary !== 7 ||
  printed(steeringStatements[boundary], researchAst) !==
    "await runOnce(lastDraftText, true, direction);"
)
  steeringContract();
function steeringVariable(node: ts.Statement, name: string, value: string) {
  if (!ts.isVariableStatement(node)) steeringContract();
  const declarations = (node as ts.VariableStatement).declarationList;
  if (
    !(declarations.flags & ts.NodeFlags.Const) ||
    declarations.declarations.length !== 1 ||
    declarations.declarations[0].name.getText(researchAst) !== name ||
    !declarations.declarations[0].initializer ||
    printed(declarations.declarations[0].initializer, researchAst) !== value
  )
    steeringContract();
}
function steeringFailure(node: ts.Statement, condition: string) {
  if (!ts.isIfStatement(node)) steeringContract();
  const guard = node as ts.IfStatement;
  if (
    guard.elseStatement ||
    printed(guard.expression, researchAst) !== condition
  )
    steeringContract();
  const statements = ts.isBlock(guard.thenStatement)
    ? guard.thenStatement.statements
    : [guard.thenStatement];
  const result = statements[0];
  if (
    statements.length !== 1 ||
    !ts.isReturnStatement(result) ||
    !result.expression ||
    !ts.isObjectLiteralExpression(result.expression) ||
    result.expression.properties.length !== 2
  )
    steeringContract();
  const properties = (result as ts.ReturnStatement)
    .expression as ts.ObjectLiteralExpression;
  const [ok, message] = properties.properties;
  if (
    !ts.isPropertyAssignment(ok) ||
    ok.name.getText(researchAst) !== "ok" ||
    ok.initializer.kind !== ts.SyntaxKind.FalseKeyword ||
    !ts.isPropertyAssignment(message) ||
    message.name.getText(researchAst) !== "message" ||
    !ts.isStringLiteral(message.initializer)
  )
    steeringContract();
}
steeringVariable(steeringStatements[0], "direction", "instructions.trim()");
steeringFailure(steeringStatements[1], "!direction");
steeringFailure(steeringStatements[2], "!activeFolioId || !lastDraftText");
steeringFailure(
  steeringStatements[3],
  "lastDraftText.trim().length < MIN_DRAFT_CHARS",
);
steeringFailure(steeringStatements[4], "passInFlight");
steeringVariable(
  steeringStatements[5],
  "aiSettings",
  "await loadAiSettingsFromIdb()",
);
steeringFailure(
  steeringStatements[6],
  "!aiSettings || !hasConfiguredAiProvider(aiSettings)",
);
// The editor supplies block text, then applies this exact ECMAScript whitespace
// operation. Do not substitute DOM textContent or a Rust whitespace predicate.
const routeSource = await readFile(
  resolve(root, "../../src/routes/editor/index.tsx"),
  "utf8",
);
const routeAst = ts.createSourceFile(
  "editor/index.tsx",
  routeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const flattenArguments: ts.Expression[] = [];
function findDraftFlatten(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "onDraftChanged"
  ) {
    if (node.arguments.length !== 1) steeringContract();
    flattenArguments.push(node.arguments[0]);
  }
  ts.forEachChild(node, findDraftFlatten);
}
findDraftFlatten(routeAst);
if (
  flattenArguments.length !== 1 ||
  printed(flattenArguments[0], routeAst) !== 'text.replace(/\\s+/g, " ").trim()'
)
  steeringContract();
const steeringGuards = researchSource.slice(
  steering.body!.getStart(researchAst) + 1,
  steeringStatements[boundary].getStart(researchAst),
);
await writeFile(
  resolve(import.meta.dir, "semantic-steering.generated.ts"),
  "// Generated from original background-research guards and editor text normalization.\n" +
    "// No runtime imports, research implementation, or provider access.\n" +
    researchResult[0].getText(researchAst) +
    "\n\n" +
    minimumDraft[0].getText(researchAst) +
    "\nconst passInFlight = false;\n" +
    "async function loadAiSettingsFromIdb(): Promise<null> {\n  return null;\n}\n" +
    "function hasConfiguredAiProvider(_settings: never): never {\n" +
    '  throw new Error("Offline steering cannot inspect a provider.");\n}\n\n' +
    "export async function apparatusSteerOffline(\n" +
    "  instructions: string,\n  folioId: string | null,\n  text: string,\n" +
    "): Promise<ResearchCommandResult & { ok: false; message: string }> {\n" +
    "  const activeFolioId = folioId;\n" +
    `  const lastDraftText = ${flattenArguments[0].getText(routeAst)};\n` +
    "  // Begin unchanged original steering guards.\n" +
    steeringGuards +
    "// End unchanged original steering guards.\n" +
    '  throw new Error("Offline steering cannot cross the research boundary.");\n' +
    "}\n",
);
const name =
  process.platform === "win32" ? "twyne-document.exe" : "twyne-document";
const output = resolve(root, "target/document", name);
const build = Bun.spawn(
  [
    process.execPath,
    "build",
    "--compile",
    "--minify",
    resolve(import.meta.dir, "semantic-worker.ts"),
    "--outfile",
    output,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await build.exited)
  throw new Error("The local document helper did not build.");
await mkdir(resolve(root, "target/release"), { recursive: true });
await copyFile(output, resolve(root, "target/release", name));

// The account transport is a separate resident SDK helper. Offline document
// conversions never launch it or gain access to its session credential store.
const connectedBuild = Bun.spawn(
  [
    process.execPath,
    resolve(import.meta.dir, "build-connected.ts"),
    resolve(root, "target/release"),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await connectedBuild.exited)
  throw new Error("The connected account helper did not build.");

// Registration/build only: no editor routing or Source stylesheet promotion.
const mathName =
  process.platform === "win32" ? "twyne-math-write.exe" : "twyne-math-write";
const mathOutput = resolve(root, "target/math-write", mathName);
await mkdir(resolve(root, "target/math-write"), { recursive: true });
const mathBuild = Bun.spawn(
  [
    // KaTeX's tree classes are inspected by the offline adapter. Production
    // minification changes those constructors and radical SVG output.
    process.execPath,
    "build",
    "--compile",
    resolve(import.meta.dir, "math-write.ts"),
    "--outfile",
    mathOutput,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await mathBuild.exited)
  throw new Error("The local diagnostic math helper did not build.");
await copyFile(mathOutput, resolve(root, "target/release", mathName));

// Build/run orchestration uses argument arrays, with no command shell.
if (process.argv[2] === "build" || process.argv[2] === "run") {
  const command = process.argv[2];
  const args = [
    "cargo",
    command,
    "--locked",
    "--manifest-path",
    resolve(root, "Cargo.toml"),
  ];
  if (command === "build") args.push("--release");
  if (command === "run") args.push("--", ...process.argv.slice(3));
  const child = Bun.spawn(args, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  process.exitCode = await child.exited;
}
