// Execute Source's pure helpers without booting its Qwik component runtime.
import ts from "typescript";
import { readFile } from "node:fs/promises";

type Dimensions = { rows: number; columns: number };
export type TableGridDirection =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";
const path = "src/components/editor/table-insertion-grid.tsx";
const text = await readFile(path, "utf8");
const source = ts.createSourceFile(
  path,
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const constants = new Set([
  "TABLE_GRID_DEFAULT_ROWS",
  "TABLE_GRID_DEFAULT_COLUMNS",
  "TABLE_INSERT_MAX_ROWS",
  "TABLE_INSERT_MAX_COLUMNS",
]);
const functions = new Set([
  "positiveInteger",
  "clampTableDimensions",
  "moveTableGridSelection",
  "isTableGridCellSelected",
]);
const selected = source.statements.filter(
  (node) =>
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.every(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          constants.has(declaration.name.text),
      )) ||
    (ts.isFunctionDeclaration(node) &&
      node.name &&
      functions.has(node.name.text)),
);
if (selected.length !== constants.size + functions.size)
  throw new Error(
    "Source table helper declarations changed; review the extraction.",
  );
const compiled = ts.transpileModule(
  selected.map((node) => node.getText(source)).join("\n"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports: Record<string, unknown> = {};
new Function("exports", compiled)(exports);
export const {
  TABLE_GRID_DEFAULT_ROWS,
  TABLE_GRID_DEFAULT_COLUMNS,
  TABLE_INSERT_MAX_ROWS,
  TABLE_INSERT_MAX_COLUMNS,
} = exports as Record<string, number>;
export const clampTableDimensions = exports.clampTableDimensions as (
  dimensions: Partial<Dimensions>,
  limits?: Partial<Dimensions>,
) => Dimensions;
export const moveTableGridSelection = exports.moveTableGridSelection as (
  current: Dimensions,
  direction: TableGridDirection,
  limits: Dimensions,
) => Dimensions;
