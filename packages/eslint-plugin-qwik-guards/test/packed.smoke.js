import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test(
  "the tarball works from an independent consumer without Twyne source links",
  { timeout: 30_000 },
  () => {
    const temporary = mkdtempSync(join(tmpdir(), "qwik-guards-package-"));
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
    const require = createRequire(import.meta.url);
    try {
      const options = {
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, npm_config_update_notifier: "false" },
      };
      const [packed] = JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            "--offline",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            temporary,
          ],
          { ...options, cwd: packageDirectory },
        ),
      );
      const files = packed.files.map((file) => file.path);
      assert.ok(files.includes("src/index.js"));
      assert.ok(files.includes("src/index.d.ts"));
      assert.ok(files.includes("src/rules/no-empty-array-before-sibling.js"));
      assert.ok(files.includes("src/rules/no-plain-jsx-form-wrapper.js"));
      assert.ok(files.includes("README.md"));
      assert.ok(!files.some((file) => file.startsWith("test/")));

      const consumer = join(temporary, "consumer");
      mkdirSync(consumer);
      writeFileSync(
        join(consumer, "package.json"),
        JSON.stringify({ private: true, type: "module" }),
      );
      execFileSync(
        "npm",
        [
          "install",
          "--offline",
          "--ignore-scripts",
          "--legacy-peer-deps",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          "--cache",
          join(temporary, "cache"),
          join(temporary, packed.filename),
        ],
        { ...options, cwd: consumer },
      );
      // Supply the ESLint peer already installed by the test runner. The plugin
      // must be a real extracted archive, not a link to the source workspace.
      symlinkSync(
        dirname(require.resolve("eslint/package.json")),
        join(consumer, "node_modules/eslint"),
        "dir",
      );
      const installed = join(
        consumer,
        "node_modules/eslint-plugin-qwik-guards",
      );
      assert.equal(realpathSync(installed), installed);
      writeFileSync(
        join(consumer, "verify.mjs"),
        `
      import assert from 'node:assert/strict';
      import { ESLint } from 'eslint';
      import plugin from 'eslint-plugin-qwik-guards';
      const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, overrideConfig: [plugin.configs.recommended] });
      const [bad] = await eslint.lintText('const ui = <>{items.map(render)}<dialog key="stable" /></>', { filePath: 'input.jsx' });
      assert.equal(bad.errorCount, 0);
      assert.equal(bad.warningCount, 1);
      assert.equal(bad.messages[0].ruleId, 'qwik-guards/no-empty-array-before-sibling');
      const [good] = await eslint.lintText('const ui = <>{items.length ? items.map(render) : null}<dialog /></>', { filePath: 'input.jsx' });
      assert.equal(good.messages.length, 0);
      const [wrapper] = await eslint.lintText('const Layout = (props) => <main>{props.leaf}</main>; const ui = <Layout leaf={<textarea />} />;', { filePath: 'input.jsx' });
      assert.equal(wrapper.warningCount, 1);
      assert.equal(wrapper.messages[0].ruleId, 'qwik-guards/no-plain-jsx-form-wrapper');
    `,
      );
      execFileSync("node", ["verify.mjs"], { ...options, cwd: consumer });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
