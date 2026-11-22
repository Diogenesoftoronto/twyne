import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import plugin from "../src/index.js";

const cwd = fileURLToPath(new URL("./fixtures/past-errors", import.meta.url));
const eslint = new ESLint({
  cwd,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { project: "./tsconfig.json", tsconfigRootDir: cwd },
      },
    },
    plugin.configs.recommended,
  ],
});

for (const [name, ruleId] of [
  ["brief", "qwik-guards/no-plain-jsx-form-wrapper"],
  ["persona", "qwik-guards/no-empty-array-before-sibling"],
]) {
  test(`${name}: warns on the historical bad shape and accepts the corrected shape`, async () => {
    const [before, after] = await eslint.lintFiles([
      `${name}-before.tsx`,
      `${name}-after.tsx`,
    ]);
    assert.equal(before.fatalErrorCount, 0);
    assert.equal(after.fatalErrorCount, 0);
    assert.deepEqual(
      before.messages.map((message) => [message.ruleId, message.severity]),
      [[ruleId, 1]],
    );
    assert.deepEqual(after.messages, []);
  });
}
