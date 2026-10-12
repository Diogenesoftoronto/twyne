// Parent-run geometry observation. Snapshot first; inspect only through CDP.
const fs = require("node:fs");
const path = require("node:path");
if (!state.inlineGeometryOwnedPage || state.page !== state.inlineGeometryPage ||
    !state.page.url().includes("/inline-geometry/?scenario=")) {
  throw new Error("No current task-owned original-source inline fixture.");
}
const cdp = state.inlineGeometryCDP;
const artifacts = state.inlineGeometryArtifacts;
const properties = [
  "display", "position", "box-sizing", "font-family", "font-size", "font-weight",
  "font-style", "line-height", "vertical-align", "align-items", "align-self",
  "flex-direction", "flex-wrap", "flex-basis", "flex-grow", "flex-shrink", "gap",
  "row-gap", "column-gap", "width", "height", "min-width", "max-width",
  "min-height", "max-height", "padding-top", "padding-bottom", "padding-left",
  "padding-right", "border-top-width", "border-bottom-width", "border-left-width",
  "border-right-width", "margin-top", "margin-bottom", "margin-left", "margin-right",
  "overflow-x", "overflow-y", "white-space", "overflow-wrap", "word-break",
  "text-align", "resize", "visibility",
];
const selectors = [
  ["editor", ".ProseMirror"],
  ["paragraph", ".ProseMirror > p"],
  ["atom", ".twyne-math-inline"],
  ["saved-render", ".twyne-math-render"],
  ["saved-katex", ".twyne-math-render .katex"],
  ["saved-html", ".twyne-math-render .katex-html"],
  ["saved-base", ".twyne-math-render .katex-base"],
  ["form", ".twyne-math-source-editor"],
  ["label", ".twyne-math-source-label"],
  ["textarea", ".twyne-math-source-input"],
  ["preview", ".twyne-math-source-preview"],
  ["preview-output", ".twyne-math-source-preview-output"],
  ["preview-katex", ".twyne-math-source-preview .katex"],
  ["actions", ".twyne-math-source-actions"],
  ["save", ".twyne-math-source-save"],
  ["cancel", ".twyne-math-source-cancel"],
  ["prefix-start", '[data-probe-baseline="prefix-start"]'],
  ["before-math", '[data-probe-baseline="before-math"]'],
  ["after-math", '[data-probe-baseline="after-math"]'],
  ["suffix-end", '[data-probe-baseline="suffix-end"]'],
];
const fontRoles = new Set(["paragraph", "label", "textarea", "saved-katex", "preview-katex", "save"]);
const ruleRoles = new Set(["atom", "form", "textarea", "label", "actions"]);
function rect(quad) {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
async function boxes(nodeId) {
  try {
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    return {
      content: rect(model.content),
      padding: rect(model.padding),
      border: rect(model.border),
      margin: rect(model.margin),
      quads: model,
    };
  } catch (error) {
    // Hidden saved output must remain reported as hidden/unmeasurable, not as
    // a zero-size renderer or a successful new preview.
    return { unavailable: String(error) };
  }
}
async function collect(details) {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const nodes = [];
  for (const variant of ["markers", "control"]) {
    for (const [role, suffix] of selectors) {
      const selector = '[data-probe-variant="' + variant + '"] ' + suffix;
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (!nodeId) {
        nodes.push({ variant, role, selector, missing: true });
        continue;
      }
      const row = { variant, role, selector, box: await boxes(nodeId) };
      if (details) {
        const { node } = await cdp.send("DOM.describeNode", { nodeId, depth: 0 });
        row.backendNodeId = node.backendNodeId;
        row.tag = node.nodeName;
        row.attrs = {};
        for (let i = 0; i < (node.attributes?.length ?? 0); i += 2) {
          row.attrs[node.attributes[i]] = node.attributes[i + 1];
        }
        const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", { nodeId });
        row.styles = Object.fromEntries(computedStyle.filter((item) =>
          properties.includes(item.name)).map((item) => [item.name, item.value]));
        if (fontRoles.has(role)) {
          try { row.fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId }); }
          catch (error) { row.fonts = { unavailable: String(error) }; }
        }
        if (ruleRoles.has(role)) {
          const matched = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
          row.matchedRules = (matched.matchedCSSRules ?? []).map(({ rule }) => ({
            selector: rule.selectorList?.text,
            origin: rule.origin,
            styleSheetId: rule.styleSheetId,
            declarations: (rule.style?.cssProperties ?? []).filter((item) =>
              properties.includes(item.name) && !item.disabled),
          }));
        }
        if (role === "atom" || role === "preview") {
          row.outerHTML = (await cdp.send("DOM.getOuterHTML", { nodeId })).outerHTML;
        }
      }
      nodes.push(row);
    }
  }
  return nodes;
}
function signature(nodes) {
  // Dimensions/position/extents, with actual missing/hidden states included.
  // Frame serials, fonts and Source markup are intentionally not geometry keys.
  return JSON.stringify(nodes.map((row) => ({
    variant: row.variant,
    role: row.role,
    missing: row.missing === true,
    boxes: row.box?.border ? {
      content: row.box.content,
      padding: row.box.padding,
      border: row.box.border,
      margin: row.box.margin,
    } : null,
  })));
}
function proseRuns(domSnapshot, nodes) {
  // CDP textBoxes give raw character subranges/ink boxes, not baselines.
  // Only Editor/marker positions are used as confirmed ProseMirror UTF16
  // positions; text-box indices are not silently mapped into that model.
  // Only the paragraph's own text leaves are selected; KaTeX descendant text
  // is retained in the raw snapshot separately.
  const document = domSnapshot.documents[0];
  if (!document) return [];
  const result = [];
  for (const variant of ["markers", "control"]) {
    const paragraph = nodes.find((row) => row.variant === variant && row.role === "paragraph");
    const paragraphIndex = document.nodes.backendNodeId.indexOf(paragraph.backendNodeId);
    const directText = new Set();
    document.nodes.parentIndex.forEach((parent, index) => {
      if (parent === paragraphIndex && document.nodes.nodeType[index] === 3) directText.add(index);
    });
    document.layout.nodeIndex.forEach((nodeIndex, layoutIndex) => {
      if (!directText.has(nodeIndex)) return;
      const textIndex = document.layout.text[layoutIndex];
      const run = {
        variant,
        nodeIndex,
        layoutIndex,
        text: domSnapshot.strings[textIndex],
        layoutBounds: document.layout.bounds[layoutIndex],
        boxes: [],
      };
      document.textBoxes.layoutIndex.forEach((owner, index) => {
        if (owner !== layoutIndex) return;
        run.boxes.push({
          start: document.textBoxes.start[index],
          length: document.textBoxes.length[index],
          bounds: document.textBoxes.bounds[index],
        });
      });
      result.push(run);
    });
  }
  return result;
}
function pairedDimensions(nodes, report) {
  const rows = report.sample.rows;
  if (report.sample.controlWidthMode !== "flow") {
    return { admitted: false, reason: "Intrinsic control intentionally has a different scaffold width." };
  }
  const sameField = (!rows[0].field && !rows[1].field) ||
    (rows[0].field && rows[1].field && rows[0].field.value === rows[1].field.value);
  if (!sameField) {
    return { admitted: false, reason: "Open/draft states differ; measure after opening both variants." };
  }
  const find = (variant, role) => nodes.find((row) => row.variant === variant && row.role === role)?.box?.border;
  const p0 = find("markers", "paragraph");
  const p1 = find("control", "paragraph");
  const a0 = find("markers", "atom");
  const a1 = find("control", "atom");
  if (!p0 || !p1 || !a0 || !a1) return { admitted: false, reason: "Unmeasurable matched paragraph/atom." };
  return {
    admitted: false,
    reason: "Measurements only; Parent must compare prose textBoxes, caret rects and marker rows before admission.",
    canonicalHtmlEqual: rows[0].canonical.html === rows[1].canonical.html,
    dimensions: {
      paragraphWidthDelta: p0.width - p1.width,
      paragraphHeightDelta: p0.height - p1.height,
      atomWidthDelta: a0.width - a1.width,
      atomHeightDelta: a0.height - a1.height,
      atomRelativeXDelta: (a0.x - p0.x) - (a1.x - p1.x),
      atomRelativeYDelta: (a0.y - p0.y) - (a1.y - p1.y),
    },
  };
}
try {
  console.log("URL:", state.page.url());
  const initialSnapshot = await snapshot({ page: state.page, showDiffSinceLastCall: false });
  console.log(initialSnapshot);
  console.log("Logs:", await getLatestLogs({ page: state.page, sinceLastCall: true }));
  const stop = Date.now() + 10000;
  if (state.inlineGeometryPendingPreview) {
    const pending = state.inlineGeometryPendingPreview;
    let changed = false;
    while (Date.now() < stop) {
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: '[data-probe-variant="' + pending.variant + '"] .twyne-math-source-preview',
      });
      if (!nodeId) throw new Error("Draft preview owner/form retired; do not claim a preview result.");
      const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId });
      if (Date.now() >= pending.earliest && outerHTML !== pending.beforeMarkup) {
        changed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!changed) throw new Error("Actual Source debounced preview did not change within 10 seconds.");
  }
const start = await state.inlineGeometryFreshReport();
let firstReport = start;
  let nodes = await collect(true);
  let later = await state.inlineGeometryFreshReport(start.frame);
  let second = await collect(false);
  if (signature(nodes) !== signature(second)) {
    // One bounded retry for actual font/preview/resize settling. Do not accept
    // a perpetually changing frame or invent a last-known stable baseline.
  const retry = await state.inlineGeometryFreshReport(later.frame);
  firstReport = retry;
    nodes = await collect(true);
    later = await state.inlineGeometryFreshReport(retry.frame);
    second = await collect(false);
  }
  if (signature(nodes) !== signature(second)) throw new Error("Original Source boxes did not settle across fresh frames.");
  if (later.sample.rows.some((row) => !row.unchangedHtml)) throw new Error("Geometry probe changed canonical Source.");
  const atomHasCustomProse = nodes.filter((row) => row.role === "paragraph").every((row) =>
    row.fonts?.fonts?.some((font) => font.isCustomFont && /Lora/i.test(font.familyName)));
  if (!atomHasCustomProse || later.sample.fontStatus !== "loaded") {
    throw new Error("Original custom Lora font is not proven loaded for both measured paragraphs.");
  }
  if (state.inlineGeometryBlocked.length) {
    throw new Error("External request attempted; preserve logs and do not certify isolated original-font geometry.");
  }
  const domSnapshot = await cdp.send("DOMSnapshot.captureSnapshot", {
    computedStyles: ["display", "font-family", "font-size", "font-weight", "font-style", "line-height", "vertical-align"],
    includeDOMRects: true,
    includePaintOrder: true,
  });
  const layoutMetrics = await cdp.send("Page.getLayoutMetrics");
  const finalReport = await state.inlineGeometryFreshReport(later.frame);
  const finalBoxes = await collect(false);
  if (signature(nodes) !== signature(finalBoxes)) {
    throw new Error("Source geometry changed during DOMSnapshot/caret collection; no coherent frame is admitted.");
  }
  const output = {
    schemaVersion: 1,
    url: state.page.url(),
    scenario: state.inlineGeometryConfig,
    phase: state.inlineGeometryPhase,
  frames: [firstReport.frame, later.frame, finalReport.frame],
    report: finalReport,
    browser: await cdp.send("Browser.getVersion"),
    layoutMetrics,
    nodes,
    proseTextRuns: proseRuns(domSnapshot, nodes),
    markers: nodes.filter((row) => row.variant === "markers" && row.attrs?.["data-probe-baseline"]).map((row) => ({
      name: row.attrs["data-probe-baseline"],
      sourcePositionUtf16: Number(row.attrs["data-probe-position"]),
      border: row.box?.border ?? null,
      baselineY: row.box?.border && row.box.border.height === 0 ? row.box.border.y : null,
      scope: "Zero-height authored inline-block point; verify same-row association/control before use.",
    })),
    markerControl: pairedDimensions(nodes, finalReport),
    requests: state.inlineGeometryRequests,
    blocked: state.inlineGeometryBlocked,
    logs: await getLatestLogs({ page: state.page, sinceLastCall: true }),
    limits: [
      "Raw measured original NodeView/form geometry in an authored two-editor scaffold, not the app route.",
      "No selected fragment/TeX baseline is inferred from struts, ink boxes or wrapper height.",
      "DOMSnapshot text boxes are document-space records; CDP quads and client caret rectangles remain separately recorded.",
      "Baseline markers/control must agree before a Source baseline contract is admitted.",
      "DPR emulation/browser pixels do not establish native renderer/font/platform parity.",
    ],
  };
  const name = String(++state.inlineGeometryCaptureSequence).padStart(2, "0") + "-" + state.inlineGeometryPhase;
  const serialized = JSON.stringify(output, null, 2) + "\n";
  const snapshotSerialized = JSON.stringify(domSnapshot) + "\n";
  if (serialized.length > 8 * 1024 * 1024 || snapshotSerialized.length > 16 * 1024 * 1024) {
    throw new Error("Bounded Source geometry corpus output exceeded its explicit limit.");
  }
  fs.writeFileSync(path.join(artifacts, name + ".json"), serialized, { flag: "wx" });
  fs.writeFileSync(path.join(artifacts, name + "-dom-snapshot.json"), snapshotSerialized, { flag: "wx" });
  fs.writeFileSync(path.join(artifacts, name + "-snapshot.txt"), initialSnapshot + "\n", { flag: "wx" });
  console.log(await snapshot({ page: state.page, showDiffSinceLastCall: false }));
  await state.page.screenshot({ path: path.join(artifacts, name + "-css.png"), scale: "css", fullPage: true });
  if (finalReport.sample.devicePixelRatio === 2) {
    await state.page.screenshot({ path: path.join(artifacts, name + "-device.png"), scale: "device", fullPage: true });
  }
  state.inlineGeometryLastObservation = output;
  state.inlineGeometryPendingPreview = null;
  console.log({ artifacts, phase: output.phase, frames: output.frames, markerControl: output.markerControl });
} catch (error) {
  state.inlineGeometryLastObservation = null;
  const report = await state.inlineGeometryReadReport().catch((cause) => ({ unavailable: String(cause) }));
  const failure = {
    schemaVersion: 1,
    status: "FAILED_NOT_ADMITTED",
    url: state.page.url(),
    phase: state.inlineGeometryPhase,
    error: String(error?.stack ?? error).slice(0, 12000),
    report,
    logs: await getLatestLogs({ page: state.page, sinceLastCall: true }).catch((cause) => ({ unavailable: String(cause) })),
    blocked: state.inlineGeometryBlocked,
    instruction: "Retain this result and inspect the actual page; do not regolden or automatically retry an action.",
  };
  fs.writeFileSync(path.join(state.inlineGeometryArtifacts, "failure-" + Date.now() + ".json"), JSON.stringify(failure, null, 2) + "\n", { flag: "wx" });
  throw error;
}
