/** Execute the original steering guard prefix in an isolated, provider-free VM. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const project = resolve(import.meta.dir, "../../../..");
const researchPath = "src/utils/background-research.ts";
const routePath = "src/routes/editor/index.tsx";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

interface SteeringCase {
  name: string;
  instructions: string;
  folioId: string | null;
  text: string;
}

const cases: SteeringCase[] = [
  {
    name: "empty direction before missing draft",
    instructions: "",
    folioId: null,
    text: "",
  },
  {
    name: "ECMAScript whitespace-only direction",
    instructions: "\u00a0\u2003\ufeff",
    folioId: null,
    text: "x".repeat(120),
  },
  {
    name: "missing folio before provider",
    instructions: "Primary sources",
    folioId: null,
    text: "x".repeat(120),
  },
  {
    name: "empty folio id",
    instructions: "Primary sources",
    folioId: "",
    text: "x".repeat(120),
  },
  {
    name: "empty manuscript before short draft",
    instructions: "Primary sources",
    folioId: "draft",
    text: "",
  },
  {
    name: "ECMAScript manuscript whitespace",
    instructions: "Primary sources",
    folioId: "draft",
    text: " \t\r\n\u00a0\ufeff\u2028\u2029 ",
  },
  {
    name: "119 ASCII UTF16 units",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(119),
  },
  {
    name: "120 ASCII UTF16 units",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(120),
  },
  {
    name: "59 astral characters are 118 units",
    instructions: "Primary sources",
    folioId: "draft",
    text: "🌿".repeat(59),
  },
  {
    name: "60 astral characters are 120 units",
    instructions: "Primary sources",
    folioId: "draft",
    text: "🌿".repeat(60),
  },
  {
    name: "astral plus ASCII at119",
    instructions: "Primary sources",
    folioId: "draft",
    text: "🌿".repeat(59) + "x",
  },
  {
    name: "astral plus ASCII at120",
    instructions: "Primary sources",
    folioId: "draft",
    text: "🌿".repeat(59) + "xx",
  },
  {
    name: "normalized internal whitespace at120",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(118) + "\u00a0\t\r\n y",
  },
  {
    name: "normalization changes raw120 to119",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(59) + "\r\n" + "x".repeat(59),
  },
  {
    name: "trailing whitespace cannot reach threshold",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(118) + "  ",
  },
  {
    name: "NEL is not ECMAScript whitespace",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(59) + " \u0085\t \u0085 " + "x".repeat(59),
  },
  {
    name: "zero-width direction is not trimmed away",
    instructions: "\u200b",
    folioId: "draft",
    text: "x".repeat(120),
  },
  {
    name: "literal text is not HTML projection",
    instructions: "Primary sources",
    folioId: "draft",
    text: "<p>" + "x".repeat(119) + "</p>",
  },
  {
    name: "instructions are never executable",
    instructions: 'await runOnce(); fetch("https://provider.invalid/")',
    folioId: "draft",
    text: "x".repeat(120),
  },
  {
    name: "folio id follows original truthiness",
    instructions: "Primary sources",
    folioId: " ",
    text: "x".repeat(120),
  },
  {
    name: "BOM trim leaves120 units",
    instructions: "\ufeffPrimary sources\u00a0",
    folioId: "draft",
    text: "\ufeff" + "x".repeat(120) + "\u00a0",
  },
];

export async function observeSourceSteering() {
  const [research, route] = await Promise.all([
    readFile(resolve(project, researchPath), "utf8"),
    readFile(resolve(project, routePath), "utf8"),
  ]);
  const ast = ts.createSourceFile(
    researchPath,
    research,
    ts.ScriptTarget.Latest,
    true,
  );
  const fn = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "steerBackgroundResearch",
  );
  const minimum = ast.statements.find(
    (node): node is ts.VariableStatement =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (item) =>
          ts.isIdentifier(item.name) && item.name.text === "MIN_DRAFT_CHARS",
      ),
  );
  const resultInterface = ast.statements.find(
    (node): node is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(node) &&
      node.name.text === "ResearchCommandResult",
  );
  if (!fn?.body || !minimum || !resultInterface)
    throw new Error("Missing original steering declarations.");
  const boundary = fn.body.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isAwaitExpression(node.expression) &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === "runOnce",
  );
  if (!boundary) throw new Error("Missing original research boundary.");
  const guardText = research.slice(
    fn.body.getStart(ast) + 1,
    boundary.getStart(ast),
  );
  const originalFunction =
    research
      .slice(fn.getStart(ast), boundary.getStart(ast))
      .replace(/^export\s+/, "") +
    'throw new Error("Original guards crossed the research boundary.");\n}\n';
  const routeAst = ts.createSourceFile(
    routePath,
    route,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const normalizers: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "onDraftChanged"
    ) {
      if (node.arguments.length !== 1)
        throw new Error("Invalid original draft normalization.");
      normalizers.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(routeAst);
  if (normalizers.length !== 1)
    throw new Error("Original draft normalization is not unique.");
  const normalizeText = normalizers[0].getText(routeAst);
  const code = ts.transpileModule(
    resultInterface.getText(ast).replace(/^export\s+/, "") +
      "\n" +
      minimum.getText(ast) +
      "\n" +
      originalFunction +
      "\nsteerBackgroundResearch(instructions);",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  const script = new vm.Script(code);
  const normalizer = new vm.Script(normalizeText);
  const rows = [];
  for (const input of cases) {
    const calls = {
      settingsLoads: 0,
      configuredAiChecks: 0,
      research: 0,
      network: 0,
    };
    const context = vm.createContext({
      instructions: input.instructions,
      activeFolioId: input.folioId,
      text: input.text,
      passInFlight: false,
      loadAiSettingsFromIdb: async () => {
        calls.settingsLoads++;
        return null;
      },
      hasConfiguredAiProvider: () => {
        calls.configuredAiChecks++;
        throw new Error("No offline provider inspection.");
      },
      runOnce: () => {
        calls.research++;
        throw new Error("No live research.");
      },
      fetch: () => {
        calls.network++;
        throw new Error("No network.");
      },
    });
    const normalizedText = normalizer.runInContext(context) as string;
    context.lastDraftText = normalizedText;
    const result = (await script.runInContext(context)) as {
      ok: boolean;
      message?: string;
    };
    if (
      result.ok !== false ||
      typeof result.message !== "string" ||
      calls.configuredAiChecks ||
      calls.research ||
      calls.network
    )
      throw new Error(`The original offline guards escaped for ${input.name}.`);
    rows.push({
      name: input.name,
      request: {
        command: "apparatusSteerOffline",
        instructions: input.instructions,
        folioId: input.folioId,
        text: input.text,
      },
      normalizedText,
      rawUtf16Units: input.text.length,
      normalizedUtf16Units: normalizedText.length,
      result: { ok: false as const, message: result.message },
      calls,
    });
  }
  return {
    schemaVersion: 1,
    execution:
      "TypeScript-erased original guard prefix in isolated Node VM; no browser or provider module",
    source: {
      research: researchPath,
      researchSha256: hash(research),
      interface: resultInterface.getText(ast),
      minimumDeclaration: minimum.getText(ast),
      guards: guardText,
      guardsSha256: hash(guardText),
      route: routePath,
      routeSha256: hash(route),
      normalizeText,
    },
    offline: { passInFlight: false, aiSettings: null },
    rows,
  };
}

if (import.meta.main) {
  const observed = await observeSourceSteering();
  const output = resolve(import.meta.dir, "source-observations.json");
  const encoded = JSON.stringify(observed, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if ((await readFile(output, "utf8")) !== encoded)
      throw new Error("The offline steering observations are stale.");
  } else {
    await writeFile(output, encoded);
  }
  console.log(
    `${process.argv.includes("--check") ? "Verified" : "Captured"} ${observed.rows.length} original steering guard cases; zero provider/network calls.`,
  );
}
