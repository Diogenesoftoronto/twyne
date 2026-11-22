import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import plugin from "../src/index.js";

test("public plugin metadata matches its manifest", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(plugin.meta.name, manifest.name);
  assert.equal(plugin.meta.version, manifest.version);
});

test("the preset reports warnings in JSX and TSX without changing the parser", async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.tsx"], languageOptions: { parser: tseslint.parser } },
      plugin.configs.recommended,
    ],
  });
  for (const filePath of ["fixture.jsx", "fixture.tsx"]) {
    const [unsafe] = await eslint.lintText(
      "const ui = <>{items.map(render)}<input /></>",
      { filePath },
    );
    assert.equal(unsafe.errorCount, 0);
    assert.equal(unsafe.warningCount, 1);
    assert.equal(
      unsafe.messages[0].ruleId,
      "qwik-guards/no-empty-array-before-sibling",
    );
    const [safe] = await eslint.lintText(
      "const ui = <>{items.length ? items.map(render) : null}<input /></>",
      { filePath },
    );
    assert.equal(safe.messages.length, 0);
  }
});
