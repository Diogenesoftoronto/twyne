// Authored, unexecuted Source callback audit. This executes AST-extracted
// callbacks with local event/tree spies; it is not browser default/focus proof.
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { EDITOR_KEYBINDINGS, chordMatches, parseShortcut } from "../../../../../src/utils/keybindings";

const root = new URL("../../../../../", import.meta.url);
async function parse(path: string, kind = ts.ScriptKind.TS) {
  const url = new URL(path, root);
  const text = await Bun.file(url).text();
  return ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true, kind);
}
const nodeView = await parse("src/components/editor/extensions/math.ts");
const form = await parse("src/components/editor/math/math-source-editor.ts");
const editor = await parse("src/components/editor/twyne-editor.tsx", ts.ScriptKind.TSX);
const pm = await parse("node_modules/prosemirror-view/src/input.ts");

function unique<T extends ts.Node>(source: ts.SourceFile, predicate: (node: ts.Node) => node is T): T {
  const found: T[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (found.length !== 1) throw new Error(`Source callback changed: expected one match, got ${found.length}`);
  return found[0]!;
}
function arrow(source: ts.SourceFile, name: string): string {
  return unique(source, (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name &&
    !!node.initializer && ts.isArrowFunction(node.initializer),
  ).initializer!.getText(source);
}
function compile(expression: string, parameters: string[], values: unknown[]) {
  const javascript = ts.transpileModule(`const callback = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...parameters, `${javascript}; return callback;`)(...values);
}
const stopProperty = unique(nodeView, (node): node is ts.PropertyAssignment =>
  ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "stopEvent" &&
  ts.isArrowFunction(node.initializer),
);
const stopExpression = stopProperty.initializer.getText(nodeView);
const belongsDeclaration = unique(pm, (node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "eventBelongsToView",
);
const belongsText = ts.transpileModule(belongsDeclaration.getText(pm), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const belongs = new Function(`${belongsText}; return eventBelongsToView;`)();

// Minimal local node spies supply only APIs the original callbacks actually use.
// There is no simulated browser editing, focus traversal or clipboard here.
class ElementSpy {
  nodeType = 1;
  isContentEditable = false;
  pmViewDesc?: { stopEvent: (event: unknown) => boolean };
  constructor(readonly tag: string, readonly parentNode: ElementSpy | null = null) {}
  contains(target: ElementSpy | null): boolean {
    for (let node = target; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    return selector.split(",").some(part => part.trim() === this.tag);
  }
  closest(selector: string): ElementSpy | null {
    for (let node: ElementSpy | null = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
}
function tree() {
  const manuscript = new ElementSpy("div");
  const math = new ElementSpy("span", manuscript);
  const form = new ElementSpy("form", math);
  const label = new ElementSpy("label", form);
  const textarea = new ElementSpy("textarea", label);
  const actions = new ElementSpy("span", form);
  const save = new ElementSpy("button", actions);
  const cancel = new ElementSpy("button", actions);
  const render = new ElementSpy("span", math);
  return { manuscript, math, form, label, textarea, actions, save, cancel, render };
}
function event(target: ElementSpy, key: string, modifiers: Record<string, boolean> = {}) {
  return {
    target, key, type: "keydown", bubbles: true, defaultPrevented: false,
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, stopped: false,
    ...modifiers,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}
function globalHarness() {
  const calls: string[] = [];
  const store = {
    typstSourcePending: false, typstView: "write", selectionAction: {}, notePopover: {},
    userCommentPopover: {}, suggestionPopover: {}, openPicker: {},
    showFindReplace: true, showOutline: true,
  };
  const threadRequest = { value: 0 };
  class CustomEventSpy {
    constructor(readonly type: string, readonly init: { detail: string }) {}
  }
  const callback = compile(arrow(editor, "onGlobalKeydown"),
    ["store", "threadRequest", "EDITOR_KEYBINDINGS", "chordMatches", "window", "CustomEvent"],
    [store, threadRequest, EDITOR_KEYBINDINGS, chordMatches,
      { dispatchEvent(value: CustomEventSpy) { calls.push(value.init.detail); } }, CustomEventSpy],
  );
  return { callback, calls, store, threadRequest };
}

describe("original equation event ownership, callback execution only", () => {
  test("all form descendants stop actual ProseMirror input guards; saved renderer does not", () => {
    const nodes = tree();
    const stop = compile(stopExpression, ["sourceEditor"], [{ dom: nodes.form }]);
    nodes.math.pmViewDesc = { stopEvent: stop };
    for (const target of [nodes.form, nodes.label, nodes.textarea, nodes.actions, nodes.save, nodes.cancel]) {
      for (const type of ["keydown", "copy", "cut", "paste"]) {
        const input = { ...event(target, "ArrowLeft"), type };
        expect(stop(input)).toBe(true);
        expect(belongs({ dom: nodes.manuscript }, input)).toBe(false);
      }
    }
    expect(stop(event(nodes.render, "ArrowLeft"))).toBe(false);
    expect(belongs({ dom: nodes.manuscript }, event(nodes.render, "ArrowLeft"))).toBe(true);
    const closed = compile(stopExpression, ["sourceEditor"], [null]);
    expect(closed(event(nodes.textarea, "ArrowLeft"))).toBe(false);
  });

  test("document-capture Mod-A exempts the textarea but selects manuscript from form buttons", () => {
    const nodes = tree();
    const calls: string[] = [];
    const chain = {
      focus(position: unknown, options: unknown) {
        expect(position).toBeNull();
        expect(options).toEqual({ scrollIntoView: false });
        calls.push("focus"); return chain;
      },
      selectAll() { calls.push("selectAll"); return chain; },
      run() { calls.push("run"); },
    };
    const callback = compile(arrow(editor, "selectManuscript"), ["editor", "Element", "HTMLElement"],
      [{ isDestroyed: false, view: { dom: nodes.manuscript }, chain: () => chain }, ElementSpy, ElementSpy],
    );
    const fieldEvent = event(nodes.textarea, "a", { ctrlKey: true });
    callback(fieldEvent);
    expect(calls).toEqual([]);
    expect(fieldEvent.defaultPrevented).toBe(false);
    for (const button of [nodes.save, nodes.cancel]) {
      calls.length = 0;
      const buttonEvent = event(button, "a", { ctrlKey: true });
      callback(buttonEvent);
      expect(calls).toEqual(["focus", "selectAll", "run"]);
      expect(buttonEvent.defaultPrevented).toBe(true);
      expect(buttonEvent.stopped).toBe(true);
    }
  });

  test("the global catalogue ignores raw textarea keys but deliberately routes button keys", () => {
    const nodes = tree();
    for (const binding of EDITOR_KEYBINDINGS) {
      const chord = parseShortcut(binding.shortcut);
      const modifiers = {
        ctrlKey: chord.modifiers.includes("Mod") || chord.modifiers.includes("Ctrl"),
        metaKey: false, altKey: chord.modifiers.includes("Alt"), shiftKey: chord.modifiers.includes("Shift"),
      };
      const field = globalHarness();
      const fieldEvent = event(nodes.textarea, chord.key, modifiers);
      field.callback(fieldEvent);
      expect(field.calls).toEqual([]);
      expect(fieldEvent.defaultPrevented).toBe(false);
      for (const button of [nodes.save, nodes.cancel]) {
        const harness = globalHarness();
        const buttonEvent = event(button, chord.key, modifiers);
        harness.callback(buttonEvent);
        expect(harness.calls).toEqual([binding.commandId]);
        expect(buttonEvent.defaultPrevented).toBe(true);
      }
    }
  });

  test("Tab is not a source-edit callback; Escape cancellation is attached only to the textarea", () => {
    const nodes = tree();
    const effects = { submit: 0, close: 0 };
    const inputKeydown = compile(arrow(form, "keydown"), ["options", "closeAndFocusNode", "form"],
      [{ nodeName: "blockMath" }, () => effects.close++, { requestSubmit() { effects.submit++; } }],
    );
    for (const shiftKey of [false, true]) {
      const tab = event(nodes.textarea, "Tab", { shiftKey });
      inputKeydown(tab);
      expect(tab.defaultPrevented).toBe(false);
      expect(tab.stopped).toBe(false);
    }
    expect(effects).toEqual({ submit: 0, close: 0 });
    const escape = event(nodes.textarea, "Escape");
    inputKeydown(escape);
    expect(effects).toEqual({ submit: 0, close: 1 });
    expect(escape.stopped).toBe(true);

    const listener = unique(form, (node): node is ts.CallExpression =>
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener" &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0]!.text === "keydown",
    );
    expect(listener.expression.getText(form)).toBe("input.addEventListener");
    expect(listener.arguments[1]!.getText(form)).toBe("keydown");

    const openNodeKeydown = compile(arrow(nodeView, "keydown"), ["sourceEditor"], [{}]);
    const buttonEscape = event(nodes.save, "Escape");
    openNodeKeydown(buttonEscape);
    const harness = globalHarness();
    harness.callback(buttonEscape);
    expect(effects.close).toBe(1);
    expect(buttonEscape.defaultPrevented).toBe(false);
    expect(harness.calls).toEqual([]);
    expect(harness.threadRequest.value).toBe(1);
    expect(harness.store.notePopover).toBeNull();
    expect(harness.store.showOutline).toBe(false);
  });
});
