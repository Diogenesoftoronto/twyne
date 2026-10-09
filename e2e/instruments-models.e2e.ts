import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("explicit real packs: download, infer, then continue without network", async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env.TWYNE_MODEL_DOWNLOADS !== "1",
    "Set TWYNE_MODEL_DOWNLOADS=1 to allow the pinned 136 MB model downloads plus runtime.",
  );
  await page.goto("/evals/instruments/browser/index.html");
  await page.waitForFunction(() => (window as any).ready === true);
  const downloads = await page.evaluate(async () => {
    const w = window as any;
    const timings: Record<string, number> = {};
    for (const pack of ["embeddings", "words", "speech"]) {
      const start = performance.now();
      await w.models.downloadLocalWriting(pack);
      timings[pack] = performance.now() - start;
    }
    w.audio = await w.models.decodeWritingAudio(
      await (await fetch("./voice-fixture.wav")).blob(),
    );
    return {
      timings,
      manifests: w.manifest.LOCAL_WRITING_PACKS,
      audioSeconds: w.audio.length / 16000,
    };
  });
  const infer = () =>
    page.evaluate(async () => {
      const w = window as any;
      const samples = [];
      for (let i = 0; i < 6; i++) {
        const start = performance.now();
        const vectors = await w.models.embedWritingPassages([
          "The river flooded the bridge.",
          "Water covered the bridge.",
          "I baked a loaf of bread.",
        ]);
        samples.push({
          ms: performance.now() - start,
          dimensions: vectors.map((v: number[]) => v.length),
          related: w.manifest.cosineSimilarity(vectors[0], vectors[1]),
          unrelated: w.manifest.cosineSimilarity(vectors[0], vectors[2]),
        });
      }
      const wordStart = performance.now();
      const words = await w.models.localWritingWords(
        "The small boat crossed the river.",
        4,
        9,
      );
      const wordsMs = performance.now() - wordStart;
      const speechStart = performance.now();
      const transcript = await w.models.transcribeWritingAudio(w.audio);
      return {
        samples,
        words,
        wordsMs,
        transcript,
        speechMs: performance.now() - speechStart,
      };
    });
  const online = await infer();
  await context.setOffline(true);
  const offline = await infer();
  await context.setOffline(false);
  const transcriptWords = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z' ]/g, "")
      .trim()
      .split(/\s+/);
  const expected = transcriptWords(
    "The river carried our story through the sleeping town.",
  );
  const actual = transcriptWords(offline.transcript);
  const table = Array.from({ length: expected.length + 1 }, (_, i) =>
    Array.from({ length: actual.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= expected.length; i++)
    for (let j = 1; j <= actual.length; j++)
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + Number(expected[i - 1] !== actual[j - 1]),
      );
  const wordErrorRate = table[expected.length][actual.length] / expected.length;
  const result = {
    version: 1,
    at: new Date().toISOString(),
    browser: info.project.name,
    userAgent: await page.evaluate(() => navigator.userAgent),
    scope:
      "Real pinned model inference in a browser worker. Offline phase uses an already-loaded application and worker. One synthetic English utterance is a regression fixture, not a speech-quality benchmark.",
    downloads,
    online,
    offline,
    wordErrorRate,
  };
  await writeFile(
    info.outputPath("model-report.json"),
    JSON.stringify(result, null, 2),
  );
  await info.attach("model-report", {
    path: info.outputPath("model-report.json"),
    contentType: "application/json",
  });
  for (const run of [online, offline]) {
    for (const sample of run.samples) {
      expect(sample.dimensions).toEqual([384, 384, 384]);
      expect(sample.related).toBeGreaterThan(sample.unrelated + 0.2);
    }
    expect(run.words.length).toBeGreaterThan(0);
    for (const word of run.words) {
      expect(word.text).toMatch(/^The [A-Za-z]+ boat crossed the river\.$/);
      expect(word.probability).toBeGreaterThanOrEqual(0);
      expect(word.probability).toBeLessThanOrEqual(1);
    }
    expect(run.transcript.trim().length).toBeGreaterThan(0);
  }
  expect(wordErrorRate).toBeLessThanOrEqual(0.4);
  expect(offline.transcript).toBe(online.transcript);
});
