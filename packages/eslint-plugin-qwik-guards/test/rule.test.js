import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "../src/rules/no-empty-array-before-sibling.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});
const error = { messageId: "emptyArray" };

tester.run("qwik-guards/no-empty-array-before-sibling", rule, {
  valid: [
    // A terminal list cannot remove any later siblings.
    "const ui = <div><header />{items.map(render)}</div>",
    "const ui = <div>{items.map(render)} {/* comment */} </div>",
    "const ui = <div>{items.map(render)}{null}{false}</div>",
    // Wrapping a list gives reconciliation its own parent boundary.
    "const ui = <div><section>{items.map(render)}</section><dialog /></div>",
    "const ui = <div>{items.length > 0 ? items.map(render) : null}<dialog /></div>",
    "const ui = <div>{items.length && items.map(render)}<dialog /></div>",
    "const ui = <div>{items.length === 0 ? null : items.map(render)}<dialog /></div>",
    "const ui = <div>{items.length >= 1 && items.map(render)}<dialog /></div>",
    "const ui = <div>{!items.length || items.map(render)}<dialog /></div>",
    "const rows = items.filter(keep).map(render); const ui = <>{rows.length > 0 ? rows : null}<dialog /></>",
    "const rows = items.map(render); const ui = <>{rows.length && rows}<dialog /></>",
    "const ui = <>{[<p />, <p />]}<dialog /></>",
    "const ui = <Card values={items.map(render)}><dialog /></Card>",
    "const ui = <>{label}<dialog /></>",
    "const ui = <>{title.slice(0, 20)}<dialog /></>",
    'const ui = <>{title.concat("…")}<dialog /></>',
    "const ui = <>{[1, 2].map(render)}<dialog /></>",
    "const { title } = items.map(render); const ui = <>{title}<dialog /></>",
    "const [title] = items.map(render); const ui = <>{title}<dialog /></>",
    "const rows = items.map(render); function Card(rows) { return <>{rows}<dialog /></>; }",
  ],
  invalid: [
    {
      code: "const ui = <div>{items.map(render)}<dialog /></div>",
      errors: [error],
    },
    {
      code: "const ui = <>{items.filter(keep).map(render)}<dialog /></>",
      errors: [error],
    },
    { code: "const ui = <>{items?.map(render)}<dialog /></>", errors: [error] },
    {
      code: "const ui = <>{items['map'](render)}<dialog /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{items.flatMap(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{Array.from(items, render)}<input /></>",
      errors: [error],
    },
    { code: "const ui = <>{[]}<input /></>", errors: [error] },
    { code: "const ui = <>{[...items]}<input /></>", errors: [error] },
    {
      code: "const rows = items.map(render); const alias = rows; const ui = <>{alias}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{active && items.map(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{active ? items.map(render) : null}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{items.map(render)}{open && <dialog />}</>",
      errors: [error],
    },
    { code: "const ui = <>{items.map(render)}Some text</>", errors: [error] },
    {
      code: "const ui = <>{items.length > 0 && items.filter(keep).map(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{items.length && items.flatMap(render)}<input /></>",
      errors: [error],
    },
    {
      code: 'const ui = <>{items.map(render)}<dialog key="stable" /></>',
      errors: [error],
    },
    {
      code: "const items = [1]; const ui = <>{items.filter(keep).map(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const items = [1]; items.pop(); const ui = <>{items.map(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{other.length && items.map(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{items.length || items.map(render)}<input /></>",
      errors: [error],
    },
    {
      code: "const ui = <>{(items as Item[]).map(render)}<input /></>",
      errors: [error],
    },
  ],
});
