export interface TypingSamples {
  dispatch: number[];
  frame: number[];
  queue: number[];
  longTasks: number[];
}
export function distribution(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1) ?? 0,
  };
}
export function typingReport(
  label: string,
  samples: TypingSamples,
  metadata: Record<string, unknown>,
) {
  const metrics = {
    "Input to next frame": distribution(samples.frame),
    "Editor transaction": distribution(samples.dispatch),
    "Input queue delay": distribution(samples.queue),
  };
  const percentiles = ["p50", "p95", "p99", "max"] as const;
  const colors = ["#b4aaa0", "#51483e", "#b4412d", "#773022"];
  const width = 940;
  const height = 600;
  const ceiling = Math.max(
    100,
    ...Object.values(metrics).flatMap((m) => percentiles.map((p) => m[p])),
  );
  const escape = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  const bars = Object.entries(metrics)
    .flatMap(([name, values], group) => {
      const y = 110 + group * 140;
      return [
        `<text x="24" y="${y}" font-size="16">${name}</text>`,
        ...percentiles.map((p, i) => {
          const bar = (values[p] / ceiling) * 590;
          const row = y + 14 + i * 25;
          return `<text x="24" y="${row + 14}">${p}</text><rect x="90" y="${row}" width="${bar.toFixed(1)}" height="18" fill="${colors[i]}"/><text x="${(100 + bar).toFixed(1)}" y="${row + 14}">${values[p].toFixed(1)} ms</text>`;
        }),
      ];
    })
    .join("");
  const buckets = [16, 32, 50, 100, 200, 400, Infinity];
  const histogram = buckets.map((upper, i) => ({
    range: `${i ? buckets[i - 1] : 0}–${upper === Infinity ? "∞" : upper} ms`,
    count: samples.frame.filter(
      (n) => n >= (i ? buckets[i - 1] : 0) && n < upper,
    ).length,
  }));
  const maxBucket = Math.max(1, ...histogram.map((b) => b.count));
  const histSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="940" height="330" viewBox="0 0 940 330"><rect width="940" height="330" fill="#f6f2e9"/><g font-family="sans-serif" fill="#29251f"><text x="24" y="32" font-size="20">Input to next frame · distribution</text>${histogram
    .map((b, i) => {
      const h = (b.count / maxBucket) * 190;
      const x = 30 + i * 128;
      return `<rect x="${x}" y="${260 - h}" width="90" height="${h}" fill="#b4412d"/><text x="${x}" y="${250 - h}">${b.count}</text><text x="${x}" y="285">${b.range}</text>`;
    })
    .join("")}</g></svg>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="940" height="600" fill="#f6f2e9"/><g font-family="sans-serif" fill="#29251f" font-size="13"><text x="24" y="38" font-size="24">${escape(label)}</text><text x="24" y="64">${samples.frame.length} native keystrokes · lower is better · milliseconds</text>${bars}<text x="24" y="574">Long tasks ≥50 ms: ${samples.longTasks.length} · largest: ${Math.max(0, ...samples.longTasks).toFixed(1)} ms</text></g></svg>`;
  const json = {
    label,
    metadata,
    metrics,
    histogram,
    longTasks: distribution(samples.longTasks),
    samples,
  };
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(label)}</title><style>body{margin:24px;background:#f6f2e9;color:#29251f;font:16px system-ui}main{max-width:940px;margin:auto}svg{display:block;width:100%;height:auto}p{line-height:1.5}pre{white-space:pre-wrap}</style><main>${svg}${histSvg}<p>Input to next frame measures the browser event timestamp to the next animation-frame callback. It includes queue delay and editor processing, but is a proxy for visible latency: it ends before paint. Editor transaction measures synchronous ProseMirror dispatch only.</p><p>Native typing includes sustained bursts, 550/1100 ms pauses, and live autosave. Long tasks include work between keystrokes. Absolute results depend on the CPU, browser and build; compare runs with matching metadata.</p><pre>${escape(JSON.stringify(metadata, null, 2))}</pre></main></html>`;
  return { json, html, svg, histogramSvg: histSvg };
}
