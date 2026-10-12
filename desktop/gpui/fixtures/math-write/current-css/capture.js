const fs = require("node:fs");
const own =
  "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write/current-css";
if (!state.page.url().startsWith("http://127.0.0.1:5197/"))
  throw new Error("Not our fixture.");
await state.page.waitForFunction(
  () => window.nodeviewFixture?.ready === true && !!window.currentCssFixture,
);
await state.page.evaluate(() => window.nodeviewFixture.settleFonts());
console.log(await getLatestLogs({ page: state.page, sinceLastCall: true }));
console.log(
  await snapshot({ page: state.page, search: /Actual Source|ready|Invalid/ }),
);
const cdp = await getCDPSession({ page: state.page });
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");
const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
const properties = [
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "vertical-align",
  "display",
  "position",
  "top",
  "left",
  "width",
  "height",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
  "border-top-width",
  "border-bottom-width",
  "white-space",
  "text-align",
];
async function metric(nodeId) {
  const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", {
    nodeId,
  });
  const styles = Object.fromEntries(
    computedStyle
      .filter((row) => properties.includes(row.name))
      .map((row) => [row.name, row.value]),
  );
  const { node } = await cdp.send("DOM.describeNode", { nodeId, depth: 1 });
  const attrs = Object.fromEntries(
    Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) => [
      node.attributes[2 * i],
      node.attributes[2 * i + 1],
    ]),
  );
  const text = (node.children ?? [])
    .filter((child) => child.nodeType === 3)
    .map((child) => child.nodeValue)
    .join("");
  let box;
  try {
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    const q = model.border;
    box = {
      x: Math.min(q[0], q[2], q[4], q[6]),
      y: Math.min(q[1], q[3], q[5], q[7]),
      width:
        Math.max(q[0], q[2], q[4], q[6]) - Math.min(q[0], q[2], q[4], q[6]),
      height:
        Math.max(q[1], q[3], q[5], q[7]) - Math.min(q[1], q[3], q[5], q[7]),
    };
  } catch (error) {
    box = { unavailable: String(error) };
  }
  let fonts;
  try {
    fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  } catch (error) {
    fonts = { unavailable: String(error) };
  }
  const fontSpec = `${styles["font-style"]} ${styles["font-weight"]} ${styles["font-size"]} ${styles["font-family"]}`;
  // Pure graphics/font probe. No page.evaluate DOM/style reads.
  const fontMetrics =
    text.replace(/\u200b/g, "") ||
    attrs.class?.split(" ").includes("katex-base")
      ? await state.page.evaluate(
          ({ font, text }) => window.currentCssFixture.measure(font, text),
          { font: fontSpec, text: text || "M" },
        )
      : undefined;
  return { tag: node.nodeName, attrs, text, styles, box, fonts, fontMetrics };
}
const rows = [];
const data = await state.page.evaluate(() => ({
  rows: [
    ...window.nodeviewFixture.data().rows,
    ...window.currentCssFixture.data(),
  ],
}));
for (const row of data.rows) {
  const prefix = `[data-case="${row.id}"]`;
  const nodes = {};
  for (const suffix of [
    ".ProseMirror",
    ".twyne-math",
    ".twyne-math-render",
    ".katex",
    ".katex-html",
    ".katex-base",
    ".katex-strut",
  ]) {
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `${prefix} ${suffix}`,
    });
    if (nodeId) nodes[suffix] = await metric(nodeId);
  }
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: `${prefix} .katex-html span`,
  });
  const all = [];
  for (const id of nodeIds) all.push(await metric(id));
  const glyphs = all.filter(
    (node) => node.fontMetrics && node.text.replace(/\u200b/g, "").length > 0,
  );
  const { nodeIds: svgIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: `${prefix} .katex-html svg,${prefix} .hide-tail,${prefix} .frac-line`,
  });
  const vectorNodes = [];
  for (const id of svgIds) vectorNodes.push(await metric(id));
  rows.push({
    ...row,
    nodes,
    glyphs,
    vectorNodes,
    flowNodes: all.filter((node) =>
      (node.attrs.class ?? "").match(
        /vlist|strut|base|sizing|mfrac|sqrt|mtable/,
      ),
    ),
    evidence:
      "Exact Source DOM/boxes/computed styles/selected fonts from CDP. Canvas metrics are a pure selected-font measurement, not an inferred TeX baseline.",
  });
}
console.log(
  await snapshot({ page: state.page, search: /Actual Source|ready|Invalid/ }),
);
await state.page.screenshot({
  path: `${own}/original-glyphs-1280.png`,
  scale: "css",
  fullPage: true,
});
fs.writeFileSync(
  `${own}/browser-glyphs.json`,
  JSON.stringify(
    {
      url: state.page.url(),
      viewport: state.page.viewportSize(),
      browser: await cdp.send("Browser.getVersion"),
      rows,
      requests: state.requests,
      blocked: state.blocked,
      logs: await getLatestLogs({ page: state.page, sinceLastCall: true }),
      canonicalSourcePreserved: true,
    },
    null,
    2,
  ) + "\n",
);
console.log({
  rows: rows.length,
  glyphLeaves: rows.reduce((n, row) => n + row.glyphs.length, 0),
});
