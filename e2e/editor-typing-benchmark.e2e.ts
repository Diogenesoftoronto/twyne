import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { typingReport, type TypingSamples } from "./helpers/typing-report";

type BenchWindow = Window & {
  typingBench: TypingSamples;
  stopTypingBench(): void;
};
// >600 samples per scenario: p99 must represent more than a single keystroke.
const burst =
  " The writer keeps typing with a steady rhythm for several sentences. ";
for (const paragraphs of [80, 800]) {
  test(`typing benchmark: ${paragraphs} annotated paragraphs, 4x CPU`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000);
    await page.route("**/__typing-benchmark-seed", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html>Seed" }),
    );
    await page.goto("/__typing-benchmark-seed");
    await page.evaluate(async () => {
      const path = "/src/utils/idb.ts";
      const idb = await import(/* @vite-ignore */ path);
      const now = Date.now();
      await idb.saveFoliosToIdb([
        {
          id: "typing-benchmark",
          name: "Typing benchmark",
          type: "draft",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await idb.saveFolioContentToIdb("typing-benchmark", "<p>Ready.</p>");
      await idb.saveActiveFolioIdToIdb("typing-benchmark");
    });
    await page.goto("/editor/");
    const manuscript = page.locator(".ProseMirror");
    await expect(manuscript).toHaveAttribute("contenteditable", "true");
    await expect(
      page.getByRole("button", { name: "Source", exact: true }),
    ).toBeVisible();
    await page.evaluate((count) => {
      const editor = (
        document.querySelector(".ProseMirror") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
      editor.commands.setContent(
        Array.from(
          { length: count },
          (_, i) =>
            `${i % 20 === 0 ? `<h2>Section ${i}</h2>` : ""}<p>Paragraph ${i}. The writer follows the river through the city. <span data-comment-id="note-${i}">This passage needs a second look.</span> The afternoon light falls across the desk.</p>`,
        ).join(""),
      );
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    }, paragraphs);
    // Let initialization and the seed's first save settle outside the sample.
    await page.waitForTimeout(2500);
    await manuscript.focus();
    await page.keyboard.press("ControlOrMeta+End");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.evaluate(() => {
      const target = window as unknown as BenchWindow;
      const editor = (
        document.querySelector(".ProseMirror") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
      const samples: TypingSamples = {
        dispatch: [],
        frame: [],
        queue: [],
        longTasks: [],
      };
      target.typingBench = samples;
      const original = editor.view.dispatch;
      editor.view.dispatch = (tr) => {
        const start = performance.now();
        original.call(editor.view, tr);
        if (tr.docChanged) samples.dispatch.push(performance.now() - start);
      };
      const input = (event: Event) => {
        samples.queue.push(Math.max(0, performance.now() - event.timeStamp));
        requestAnimationFrame(() =>
          samples.frame.push(performance.now() - event.timeStamp),
        );
      };
      editor.view.dom.addEventListener("beforeinput", input, true);
      const observer = new PerformanceObserver((list) =>
        samples.longTasks.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ type: "longtask" });
      target.stopTypingBench = () => {
        observer.disconnect();
        editor.view.dispatch = original;
        editor.view.dom.removeEventListener("beforeinput", input, true);
      };
    });
    for (let repeat = 0; repeat < 3; repeat++) {
      for (let phase = 0; phase < 3; phase++) {
        await page.keyboard.type(burst, { delay: 15 });
        await page.waitForTimeout(phase % 2 ? 1100 : 550);
      }
    }
    await page.waitForTimeout(1500);
    const samples = await page.evaluate(() => {
      const target = window as unknown as BenchWindow;
      target.stopTypingBench();
      return target.typingBench;
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const report = typingReport(
      `${paragraphs} annotated paragraphs · 4x CPU`,
      samples,
      {
        paragraphs,
        cpuThrottle: 4,
        repeats: 3,
        keystrokes: burst.length * 9,
        browser: browser.version(),
        build: "Vite development",
        platform: process.platform,
        architecture: process.arch,
        cpu: cpus()[0]?.model,
        cores: cpus().length,
        memoryGiB: Math.round(totalmem() / 1024 ** 3),
        commit: process.env.GITHUB_SHA ?? "local",
        timestamp: new Date().toISOString(),
        budgets: {
          dispatchP95: 50,
          dispatchP99: 100,
          frameP95: 100,
          frameP99: 150,
        },
      },
    );
    for (const [name, body, contentType] of [
      [
        "typing-latency.json",
        JSON.stringify(report.json, null, 2),
        "application/json",
      ],
      ["typing-latency.html", report.html, "text/html"],
      ["typing-percentiles.svg", report.svg, "image/svg+xml"],
      ["typing-histogram.svg", report.histogramSvg, "image/svg+xml"],
    ]) {
      const path = info.outputPath(name);
      await writeFile(path, body);
      await info.attach(name, { path, contentType });
    }
    const chart = await page.context().newPage();
    await chart.setContent(report.html);
    await chart.screenshot({
      path: info.outputPath("typing-charts.png"),
      fullPage: true,
    });
    await info.attach("typing-charts.png", {
      path: info.outputPath("typing-charts.png"),
      contentType: "image/png",
    });
    await chart.close();
    // Verify measured edits reached source and survived a real reload as well.
    expect(samples.frame).toHaveLength(burst.length * 9);
    expect(samples.dispatch.length).toBeGreaterThanOrEqual(burst.length * 9);
    expect(report.json.metrics["Editor transaction"].p95).toBeLessThan(50);
    expect(report.json.metrics["Editor transaction"].p99).toBeLessThan(100);
    expect(report.json.metrics["Input to next frame"].p95).toBeLessThan(100);
    expect(report.json.metrics["Input to next frame"].p99).toBeLessThan(150);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(
      page.locator(".typst-source-editor .cm-content"),
    ).toContainText(burst.trim());
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText(
      burst.repeat(9).trim(),
    );
  });
}
