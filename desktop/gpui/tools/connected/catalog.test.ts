import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { validateCatalog, toolDefinition } from "./catalog";

const source = readFileSync(
  new URL("../../../../src/utils/account-knowledge.ts", import.meta.url),
  "utf8",
);
const review = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/connected-work/knowledge-catalog-proposal/current-source-revalidation.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ast = ts.createSourceFile(
  "account-knowledge.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
function declaration(name: string) {
  const found = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!found?.body) throw new Error("Reviewed Source declaration is missing");
  return found;
}
const statements = declaration("refreshAccountKnowledge").body!.statements;
const guarded = statements.find((node): node is ts.TryStatement =>
  ts.isTryStatement(node),
)?.tryBlock.statements;
if (!guarded) throw new Error("Reviewed Source catalog block is missing");
const start = guarded.findIndex((node) =>
  node.getText(ast).startsWith("if (!Array.isArray(raw?.data))"),
);
const end = guarded.findIndex(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => ts.isIdentifier(item.name) && item.name.text === "sources",
    ),
);
if (start < 0 || end <= start)
  throw new Error("Reviewed Source catalog boundaries changed");
const body = guarded
  .slice(start, end + 1)
  .map((node) => node.getText(ast))
  .join("\n");
if (/\b(?:await|client|snapshot|localStorage|publish)\b/.test(body))
  throw new Error("Source oracle is not pure");
const transpile = (text: string) =>
  ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.None,
    },
  }).outputText;
// Execute the actual selected Source bodies, with no imports or app context.
const sourceCatalog = new Function(
  "raw",
  transpile(body + "\nreturn sources;"),
) as typeof validateCatalog;
const sourceDefinition = new Function(
  transpile(declaration("toolDefinition").getText(ast)) +
    "\nreturn toolDefinition;",
)() as typeof toolDefinition;
function tool(name = "search") {
  return { name, inputSchema: { type: "object" } };
}
function row(id = "notes") {
  return { id, label: "Notes", tools: [tool()], resources_allowed: true };
}
function outcome(fn: typeof validateCatalog, raw: unknown) {
  try {
    return { accepted: true, count: fn(raw).length };
  } catch (error) {
    return {
      accepted: false,
      message: error instanceof Error ? error.message : "Unknown",
    };
  }
}
function parity(raw: unknown) {
  expect(outcome(validateCatalog, raw)).toEqual(outcome(sourceCatalog, raw));
}

describe("knowledge catalog admission against the reviewed Source AST bodies", () => {
  test("pins the current Source used for catalog admission revalidation", () => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      review.sourceSha256,
    );
  });
  test("matches shape, duplicates, Unicode, count, label and tool boundaries", () => {
    for (const raw of [
      null,
      undefined,
      {},
      { data: null },
      { data: [] },
      { data: [row()] },
      { data: [row("")] },
      { data: [row("🪼".repeat(128))] },
      { data: [row("🪼".repeat(129))] },
      { data: [row(), row()] },
      { data: [{ ...row(), label: "" }] },
      { data: [{ ...row(), label: "x".repeat(200) }] },
      { data: [{ ...row(), label: "x".repeat(201) }] },
      { data: [{ ...row(), resources_allowed: "true" }] },
      { data: [{ ...row(), tools: [null] }] },
      { data: [{ ...row(), tools: [tool(), tool()] }] },
      { data: [{ ...row(), tools: [tool("🪼".repeat(128))] }] },
      { data: [{ ...row(), tools: [tool("🪼".repeat(129))] }] },
      { data: Array.from({ length: 100 }, (_, i) => row(`source-${i}`)) },
      { data: Array.from({ length: 101 }, (_, i) => row(`source-${i}`)) },
      {
        data: [
          {
            ...row(),
            tools: Array.from({ length: 128 }, (_, i) => tool(`tool-${i}`)),
          },
        ],
      },
      {
        data: [
          {
            ...row(),
            tools: Array.from({ length: 129 }, (_, i) => tool(`tool-${i}`)),
          },
        ],
      },
    ])
      parity(raw);
    for (const schema of [
      undefined,
      null,
      0,
      "x",
      [],
      {},
      { type: "array" },
      { type: "object" },
    ])
      parity({
        data: [{ ...row(), tools: [{ name: "search", inputSchema: schema }] }],
      });
  });
  test("uses exact JavaScript serialized limits rather than bytes", () => {
    const sourceRow = { ...row(), padding: "" };
    sourceRow.padding = "x".repeat(
      1_048_576 - JSON.stringify([sourceRow]).length,
    );
    expect(JSON.stringify([sourceRow]).length).toBe(1_048_576);
    expect(validateCatalog({ data: [sourceRow] })).toHaveLength(1);
    parity({ data: [sourceRow] });
    sourceRow.padding += "x";
    expect(() => validateCatalog({ data: [sourceRow] })).toThrow(
      "Source catalog is too large",
    );
    parity({ data: [sourceRow] });
    const schema = { type: "object", padding: "" };
    schema.padding = "🪼".repeat(
      Math.floor((65_536 - JSON.stringify(schema).length) / 2),
    );
    schema.padding += "x".repeat(65_536 - JSON.stringify(schema).length);
    expect(JSON.stringify(schema).length).toBe(65_536);
    const raw = {
      data: [{ ...row(), tools: [{ name: "search", inputSchema: schema }] }],
    };
    expect(validateCatalog(raw)).toHaveLength(1);
    parity(raw);
    schema.padding += "x";
    expect(() => validateCatalog(raw)).toThrow("Invalid tool schema");
    parity(raw);
  });
  test("retains metadata and exact Source tool-definition key ordering and omission", () => {
    const original = { ...row(), unknown: { revision: 8 } };
    expect(validateCatalog({ data: [original] })[0]).toBe(original);
    expect(validateCatalog({ data: [original] })[0].tools[0]).toBe(
      original.tools[0],
    );
    for (const current of [
      tool(),
      { ...tool(), title: 5, description: null },
      { ...tool(), title: undefined, description: undefined },
      {
        name: "search",
        title: "Search",
        description: "Notes",
        inputSchema: { type: "object", z: 1, a: 2 },
      },
    ])
      expect(toolDefinition(current)).toBe(sourceDefinition(current));
    const first = {
      name: "search",
      inputSchema: { type: "object", z: 1, a: 2 },
    };
    const second = {
      name: "search",
      inputSchema: { type: "object", a: 2, z: 1 },
    };
    expect(toolDefinition(first)).not.toBe(toolDefinition(second));
    expect(toolDefinition({ name: "search", description: null })).toBe(
      '{"name":"search","description":null}',
    );
  });
  test("matches deterministic mixed catalog admission without mutating input", () => {
    for (let i = 0; i < 80; i++) {
      const rows = Array.from({ length: i % 11 }, (_, n) => ({
        ...row(`source-${n}`),
        tools: [tool(`tool-${i}`)],
        extra: { i, n },
      }));
      if (rows.length && i % 3 === 0)
        rows[0].tools[0].inputSchema.type = "array";
      if (rows.length > 1 && i % 4 === 0) rows[1].id = rows[0].id;
      if (rows.length && i % 5 === 0) rows[0].label = "x".repeat(201);
      const raw = { data: rows };
      const before = JSON.stringify(raw);
      parity(raw);
      expect(JSON.stringify(raw)).toBe(before);
    }
  });
});
