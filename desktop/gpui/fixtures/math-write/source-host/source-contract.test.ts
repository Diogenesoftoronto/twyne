// Executes only AST-extracted original callback guards with local chain spies.
// This is neither native host execution nor a browser/default-editing receipt.
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import decisions from "../native-source-form/sakana-key-decisions.json";

const sourcePath = new URL("../../../../../src/components/editor/math/math-source-editor.ts", import.meta.url);
const text = await Bun.file(sourcePath).text();
const source = ts.createSourceFile(sourcePath.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "updateSource");
if (declarations.length !== 1 || declarations[0]!.parameters.length !== 4 || declarations[0]!.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) {
  throw new Error("Original updateSource callback contract changed");
}
const updateText = ts.transpileModule(declarations[0]!.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const updateSource = new Function(`${updateText}; return updateSource;`)() as (editor: unknown, getPos: () => unknown, nodeName: string, raw: string) => boolean;

const keydowns: ts.ArrowFunction[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "keydown" && node.initializer && ts.isArrowFunction(node.initializer)) keydowns.push(node.initializer);
  ts.forEachChild(node, visit);
}
visit(source);
if (keydowns.length !== 1) throw new Error("Original keydown callback contract changed");
const keyText = ts.transpileModule(`const keydown = ${keydowns[0]!.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function chainSpy(node?: { type: { name: string }; attrs: Record<string, unknown> }) {
  let command: ((args: unknown) => boolean) | undefined;
  const observations = { chainCalls: 0, nodeAt: [] as unknown[], markup: [] as Array<{ position: unknown; attrs: Record<string, unknown> }>, focusCalls: 0 };
  const chain = {
    command(value: (args: unknown) => boolean) { command = value; return chain; },
    focus() { observations.focusCalls++; return chain; },
    run() {
      return command!({ tr: {
        doc: { nodeAt(position: unknown) { observations.nodeAt.push(position); return node; } },
        setNodeMarkup(position: unknown, type: unknown, attrs: Record<string, unknown>) {
          expect(type).toBeUndefined();
          observations.markup.push({ position, attrs });
        },
      } });
    },
  };
  return { editor: { chain() { observations.chainCalls++; return chain; } }, observations };
}

describe("original math-source callback guards, source AST only", () => {
  test("missing/non-number position refuses before a command chain", () => {
    for (const position of [undefined, null, "17", {}, false]) {
      const { editor, observations } = chainSpy({ type: { name: "inlineMath" }, attrs: { source: "old" } });
      expect(updateSource(editor, () => position, "inlineMath", "raw")).toBe(false);
      expect(observations.chainCalls).toBe(0);
      expect(observations.markup).toHaveLength(0);
    }
  });

  test("missing or changed node type refuses without writing any markup", () => {
    for (const name of [undefined, "paragraph", "blockMath"]) {
      const node = name === undefined ? undefined : { type: { name }, attrs: { source: "old" } };
      const { editor, observations } = chainSpy(node);
      expect(updateSource(editor, () => 17, "inlineMath", "raw")).toBe(false);
      expect(observations.nodeAt).toEqual([17]);
      expect(observations.markup).toHaveLength(0);
    }
  });

  test("both original math types preserve blank, invalid, Unicode and exact whitespace plus unknown attrs", () => {
    for (const name of ["inlineMath", "blockMath"]) {
      for (const raw of ["", " \n \t", " \\notACommand{🦊 é\n東京  ", "x\r\ny\rz "]) {
        const attrs = { source: "before", future: { nested: "keep" }, revision: 0 };
        const { editor, observations } = chainSpy({ type: { name }, attrs });
        let reads = 0;
        expect(updateSource(editor, () => { reads++; return 17; }, name, raw)).toBe(true);
        expect(reads).toBe(1);
        expect(observations.markup).toEqual([{ position: 17, attrs: { ...attrs, source: raw } }]);
        expect(observations.markup[0]!.attrs.future).toBe(attrs.future);
        expect(attrs.source).toBe("before");
        expect(observations.focusCalls).toBe(1);
      }
    }
  });

  test("consumes the frozen 32 original keydown decisions without claiming browser default editing", () => {
    const keys = new Set<string>();
    for (const vector of decisions.cases) {
      const effects = { submit: false, preventDefault: false, stopPropagation: false, cancel: false };
      const keydown = new Function("options", "closeAndFocusNode", "form", `${keyText}; return keydown;`)(
        { nodeName: vector.nodeName }, () => { effects.cancel = true; }, { requestSubmit() { effects.submit = true; } },
      );
      keydown({ key: "Enter", ...vector, preventDefault() { effects.preventDefault = true; }, stopPropagation() { effects.stopPropagation = true; } });
      expect(effects).toEqual({ submit: vector.submit, preventDefault: vector.preventDefault, stopPropagation: vector.stopPropagation, cancel: false });
      keys.add(JSON.stringify([vector.nodeName, vector.shiftKey, vector.ctrlKey, vector.metaKey, vector.altKey]));
    }
    expect(keys.size).toBe(32);
  });

  test("Escape requests cancellation; unrelated keys do not write or submit", () => {
    for (const key of ["Escape", "F2", "a"]) {
      const effects = { submit: 0, cancel: 0, prevented: 0, stopped: 0 };
      const keydown = new Function("options", "closeAndFocusNode", "form", `${keyText}; return keydown;`)(
        { nodeName: "blockMath" }, () => { effects.cancel++; }, { requestSubmit() { effects.submit++; } },
      );
      keydown({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() { effects.prevented++; }, stopPropagation() { effects.stopped++; } });
      expect(effects).toEqual(key === "Escape" ? { submit: 0, cancel: 1, prevented: 1, stopped: 1 } : { submit: 0, cancel: 0, prevented: 0, stopped: 0 });
    }
  });
});
