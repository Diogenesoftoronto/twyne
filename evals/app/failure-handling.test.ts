import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchSourcesSuite } from "./suites/research";
import { rewriteSuite } from "./suites/rewrite";
import { rubricSuite } from "./suites/rubric";
import type { Judge } from "./judges";

const noJudge = { judge: null, jev: null, extract: null };
const brokenJudge: Judge = {
  label: "broken",
  complete: async () => "unreadable",
};
const sourceCase = researchSourcesSuite.load()[0];
const sources = {
  provider: "custom",
  ranked: [
    { title: "Source", url: "https://example.org", snippet: sourceCase.fact },
  ],
};

test("malformed judge responses stay unscored across suites", async () => {
  const research = await researchSourcesSuite.score(
    { ...noJudge, judge: brokenJudge },
    sourceCase,
    sources,
  );
  expect(research.settles).toMatchObject({ score: null, label: "judge-error" });
  const rewriteCase = rewriteSuite.load()[0];
  const rewrite = await rewriteSuite.score(
    { ...noJudge, judge: brokenJudge },
    rewriteCase,
    { replacement: rewriteCase.original, provider: "hosted" },
  );
  expect(rewrite.improves).toMatchObject({ score: null, label: "judge-error" });
  const rubric = await rubricSuite.score(
    { ...noJudge, judge: brokenJudge },
    rubricSuite.load()[0],
    { review: { text: "A review" } },
  );
  expect(rubric.review_grounded).toMatchObject({
    score: null,
    label: "judge-error",
  });
});

test("a judge cannot settle a claim with a source index outside the shown results", async () => {
  const judge: Judge = {
    label: "bad index",
    complete: async () => '{"settles":[99]}',
  };
  const result = await researchSourcesSuite.score(
    { ...noJudge, judge },
    sourceCase,
    sources,
  );
  expect(result.settles).toMatchObject({ score: null, label: "judge-error" });
});

test("a partial Jev source batch stays visibly incomplete", async () => {
  const jev = async () => ({
    ok: true,
    answers: { source0: { type: "noul", noul: 0.99 } },
  });
  const result = await researchSourcesSuite.score(
    { ...noJudge, jev },
    sourceCase,
    { ...sources, ranked: [...sources.ranked, ...sources.ranked] },
  );
  expect(result.jev_settles).toMatchObject({ score: null, label: "jev-error" });
  expect(result.jev_settles.explanation).toContain("1 of 2");
});

test("an Arize failure preserves paid-run report data and strict exits nonzero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "twyne-upload-failure-"));
  try {
    await writeFile(
      join(dir, "ax"),
      '#!/usr/bin/env node\nprocess.stderr.write("test upload unavailable");process.exit(1);\n',
      { mode: 0o700 },
    );
    const child = Bun.spawn(
      [
        process.execPath,
        new URL("./run.ts", import.meta.url).pathname,
        "--suite",
        "interview",
        "--limit",
        "1",
        "--arize",
        "--arize-space",
        "test",
        "--strict",
        "--experiment",
        "upload-failure",
        "--out",
        dir,
      ],
      {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(await child.exited).toBe(1);
    const saved = (await readdir(dir)).find((name) => name.endsWith(".json"));
    expect(saved).toBeTruthy();
    const report = JSON.parse(await readFile(join(dir, saved!), "utf8"));
    expect(report.errors).toBe(0);
    expect(report.cases[0].ok).toBe(true);
    expect(report.cases[0].raw).toBeTruthy();
    expect(report.cases[0].output).toBeTruthy();
    expect(report.uploadError).toContain("test upload unavailable");
    const journal = (
      await readFile(join(dir, "upload-failure-interview.cases.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(journal.map((entry) => entry.phase)).toEqual([
      "generated",
      "scored",
    ]);
    expect(journal[0].raw).toEqual(report.cases[0].raw);
    expect(journal[1].scores).toEqual(report.cases[0].scores);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
