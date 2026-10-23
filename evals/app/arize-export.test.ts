import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const corpus = Array.from({ length: 126 }, (_, index) => ({
  case_id: `case-${index}`,
}));
const completeExport = corpus.map(({ case_id }, index) => ({
  id: `example-${index}`,
  additional_properties: { case_id },
}));

async function resolveDataset(exported: typeof completeExport) {
  const dir = await mkdtemp(join(tmpdir(), "twyne-arize-export-"));
  try {
    const fixture = join(dir, "examples.json");
    await writeFile(fixture, JSON.stringify(exported));
    await writeFile(
      join(dir, "ax"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "datasets" && args[1] === "get") {
  process.stdout.write(JSON.stringify({ id: "fixture-dataset" }));
} else if (args[0] === "datasets" && args[1] === "export") {
  const rows = JSON.parse(fs.readFileSync(process.env.TWYNE_AX_FIXTURE, "utf8"));
  process.stdout.write(JSON.stringify(args.includes("--all") ? rows : rows.slice(0, 100)));
} else {
  process.stderr.write("Unexpected test command");
  process.exit(1);
}
`,
      { mode: 0o700 },
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `import { ensureDataset } from ${JSON.stringify(new URL("./arize.ts", import.meta.url).pathname)};
const dataset = await ensureDataset({ space: "test" }, "fixture", ${JSON.stringify(corpus)});
console.log(JSON.stringify([...dataset.examples]));`,
      ],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          TWYNE_AX_FIXTURE: fixture,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Arize resolves all case mappings beyond the default export page", async () => {
  const result = await resolveDataset(completeExport);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(
    corpus.map(({ case_id }, index) => [case_id, `example-${index}`]),
  );
});

test("an incomplete full export cannot silently omit experiment runs", async () => {
  const result = await resolveDataset(completeExport.slice(0, 100));
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("missing 26 of 126 case mappings");
});

test("duplicate Arize case mappings cannot select an arbitrary example", async () => {
  const duplicate = structuredClone(completeExport);
  duplicate[125].additional_properties.case_id = "case-0";
  const result = await resolveDataset(duplicate);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("duplicate case_id case-0");
});
