import noEmptyArrayBeforeSibling from "./rules/no-empty-array-before-sibling.js";
import noPlainJsxFormWrapper from "./rules/no-plain-jsx-form-wrapper.js";

const plugin = {
  meta: { name: "eslint-plugin-qwik-guards", version: "0.1.0" },
  rules: {
    "no-empty-array-before-sibling": noEmptyArrayBeforeSibling,
    "no-plain-jsx-form-wrapper": noPlainJsxFormWrapper,
  },
  configs: {},
};

// Opt in only for projects using the affected runtime; this plugin does not
// detect the installed Qwik version or replace eslint-plugin-qwik.
plugin.configs.recommended = {
  name: "qwik-guards/recommended",
  files: ["**/*.{jsx,tsx}"],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "qwik-guards": plugin },
  rules: {
    "qwik-guards/no-empty-array-before-sibling": "warn",
    "qwik-guards/no-plain-jsx-form-wrapper": "warn",
  },
};

export default plugin;
