import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "../src/rules/no-plain-jsx-form-wrapper.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});
const error = { messageId: "plainWrapper" };

tester.run("qwik-guards/no-plain-jsx-form-wrapper", rule, {
  valid: [
    "const Layout = (props) => <main>{props.leaf}</main>; const ui = Layout({leaf: <input />});",
    "const Layout = component$((props) => <main><Slot /></main>); const ui = <Layout><input /></Layout>;",
    "const Icon = () => <svg />; const ui = <button><Icon /></button>;",
    "const Layout = (props) => <main>{props.children}</main>; const ui = <Layout><p>Read only</p></Layout>;",
    "const icon = () => <svg />; const ui = <icon><input /></icon>;",
    "const Form = () => <input />; function Child(Form) { return <Form />; }",
    "const Layout = (props) => <main>{props.children}</main>; const ui = <Layout><div contentEditable={false} /></Layout>;",
  ],
  invalid: [
    {
      code: "const Layout = (props) => <main>{props.leaf}</main>; const ui = <Layout leaf={<input />} />;",
      errors: [error],
    },
    {
      code: "function Layout(props) { return <main>{props.children}</main>; } const ui = <Layout><textarea /></Layout>;",
      errors: [error],
    },
    {
      code: "const Form = () => <form><input /></form>; const ui = <Form />;",
      errors: [error],
    },
    {
      code: "const Layout = function(props) { return <main>{props.children}</main>; }; const ui = <Layout><select /></Layout>;",
      errors: [error],
    },
    {
      code: "const Layout = (props) => <main>{props.children}</main>; const ui = <Layout><div contentEditable /></Layout>;",
      errors: [error],
    },
    {
      code: "const Layout = (props) => <main>{props.children}</main>; const Alias = Layout; const ui = <Alias><input /></Alias>;",
      errors: [error],
    },
    {
      code: "const Form = () => <input />; const ui = <Form></Form>;",
      errors: [error],
    },
  ],
});
