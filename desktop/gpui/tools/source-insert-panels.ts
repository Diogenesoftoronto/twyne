// Read literal original dialog copy through TypeScript's parser, without Qwik.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = ts.createSourceFile(
  "insert-panels.tsx",
  readFileSync(
    resolve(
      import.meta.dir,
      "../../../src/components/editor/insert-panels.tsx",
    ),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function literal(node: ts.Expression): unknown {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return literal(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (
          !ts.isPropertyAssignment(property) ||
          !ts.isIdentifier(property.name)
        )
          throw new Error("Unexpected original copy shape");
        return [property.name.text, literal(property.initializer)];
      }),
    );
  throw new Error("Dialog copy must remain literal");
}
let copy: Record<string, object> | undefined;
const modals: ts.JsxSelfClosingElement[] = [];
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "NOTE_MODAL_COPY" &&
    node.initializer
  )
    copy = literal(node.initializer) as Record<string, object>;
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(file) === "TextModal"
  )
    modals.push(node);
  ts.forEachChild(node, visit);
}
visit(file);
if (!copy || modals.length !== 2)
  throw new Error("Original insertion dialog contract changed");
function props(node: ts.JsxSelfClosingElement) {
  return Object.fromEntries(
    node.attributes.properties.flatMap((attribute) => {
      if (!ts.isJsxAttribute(attribute) || !attribute.initializer) return [];
      const initializer = attribute.initializer;
      if (ts.isStringLiteral(initializer))
        return [[attribute.name.getText(file), initializer.text]];
      if (
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        ts.isNumericLiteral(initializer.expression)
      )
        return [
          [attribute.name.getText(file), Number(initializer.expression.text)],
        ];
      return [];
    }),
  );
}
const common = props(modals[0]);
export const insertionModals = {
  footnote: { ...common, ...copy.footnote },
  endnote: { ...common, ...copy.endnote },
  mermaid: props(modals[1]),
};
