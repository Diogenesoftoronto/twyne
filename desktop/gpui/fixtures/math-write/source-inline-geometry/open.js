// Parent-run Playwriter file. Do not use an existing app/fixture tab or session.
// Load full current Playwriter documentation before execution.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const own = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write/source-inline-geometry";
const corpus = JSON.parse(fs.readFileSync(path.join(own, "cases.json"), "utf8"));
const scenario = corpus.scenarios.find((row) => row.id === (state.inlineGeometryScenario ?? "wide-ordinary"));
if (!scenario) throw new Error("Unknown authored scenario.");
const controlWidthMode = state.inlineGeometryControlWidth ?? "flow";
if (!["flow", "min-content", "max-content"].includes(controlWidthMode)) {
  throw new Error("Unknown explicitly authored intrinsic control.");
}
const origin = state.inlineGeometryOrigin ?? "http://127.0.0.1:5199";
if (!["http://127.0.0.1:5199", "http://127.0.0.1:5196"].includes(origin)) {
  throw new Error("Only the explicitly owned original-source fixture origins are admitted.");
}
if (!state.inlineGeometryServerArtifacts || !path.isAbsolute(state.inlineGeometryServerArtifacts)) {
  throw new Error("Set the fresh server artifacts directory printed by prepareInlineGeometry.");
}
const provenancePath = path.join(state.inlineGeometryServerArtifacts, "provenance.json");
if (fs.statSync(provenancePath).size > 1024 * 1024) throw new Error("Oversized server provenance.");
const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
if (provenance.originalCss.candidateOverlay !== false ||
    provenance.scope !== "Actual original math NodeView/source form inside a two-editor authored scaffold, not the product route.") {
  throw new Error("This is not the original unmodified CSS/source fixture.");
}
for (const name of ["cases.json", "client.ts", "fixture-server.ts"]) {
  const relative = "desktop/gpui/fixtures/math-write/source-inline-geometry/" + name;
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(own, name))).digest("hex");
  if (actual !== provenance.sourceHashes[relative]) {
    throw new Error("Generated server bundle does not match the current frozen fixture: " + name);
  }
}
if (state.inlineGeometryPage && !state.inlineGeometryPage.isClosed()) {
  if (!state.inlineGeometryOwnedPage || !state.inlineGeometryPage.url().startsWith(origin + "/inline-geometry/")) {
    throw new Error("Refusing to navigate an unowned or different fixture page.");
  }
} else {
  if (state.page && !state.page.isClosed()) {
    throw new Error("Use a fresh task-owned Playwriter session; existing state.page is not adopted.");
  }
  state.inlineGeometryPage = await context.newPage();
  state.inlineGeometryOwnedPage = true;
  state.inlineGeometryRequests = [];
  state.inlineGeometryBlocked = [];
  await state.inlineGeometryPage.route("**/*", (route) => {
    const url = route.request().url();
    const allowed = url.startsWith(origin + "/inline-geometry/") ||
      url.startsWith(origin + "/fonts/") || url.startsWith(origin + "/assets/") ||
      url.startsWith("data:");
    if (allowed) return route.continue();
    if (state.inlineGeometryBlocked.length < 1000) state.inlineGeometryBlocked.push(url);
    return route.abort();
  });
  state.inlineGeometryPage.on("request", (request) => {
    if (state.inlineGeometryRequests.length >= 1000) return;
    state.inlineGeometryRequests.push({ url: request.url(), type: request.resourceType() });
  });
}
state.page = state.inlineGeometryPage;
state.inlineGeometryRequests = [];
state.inlineGeometryBlocked = [];
state.inlineGeometryProvenance = provenance;
state.inlineGeometryConfig = scenario;
state.inlineGeometryVariant = "markers";
state.inlineGeometryPhase = "closed";
state.inlineGeometryActionSequence = 0;
state.inlineGeometryCaptureSequence = 0;
state.inlineGeometryPendingPreview = null;
const cdp = await getCDPSession({ page: state.page });
state.inlineGeometryCDP = cdp;
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");
await cdp.send("Page.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: scenario.viewportWidth,
  height: scenario.viewportHeight,
  deviceScaleFactor: scenario.dpr,
  mobile: false,
});
await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

// CDP helpers retained only in this task's state. No Runtime.evaluate,
// page.evaluate, locator.evaluate or injected browser inspection functions.
async function readReport() {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#inline-geometry-report",
  });
  if (!nodeId) return null;
  const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
  const attrs = {};
  for (let i = 0; i < attributes.length; i += 2) attrs[attributes[i]] = attributes[i + 1];
  if (!attrs["data-state"]) return null;
  if (attrs["data-state"].length > 128 * 1024) throw new Error("Oversized explicit fixture report.");
  return {
    frame: Number(attrs["data-frame"]),
    heartbeatStopped: attrs["data-heartbeat-stopped"] === "true",
    sample: JSON.parse(attrs["data-state"]),
  };
}
async function freshReport(afterFrame = -1) {
  const stop = Date.now() + 8000;
  while (Date.now() < stop) {
    const report = await readReport();
    if (report?.heartbeatStopped) throw new Error("Bounded fixture heartbeat ended; reload explicitly.");
    if (report?.sample.ready && report.frame > afterFrame) return report;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("No fresh ready original-source fixture frame within 8 seconds.");
}
state.inlineGeometryReadReport = readReport;
state.inlineGeometryFreshReport = freshReport;
await state.page.goto(origin + "/inline-geometry/?scenario=" + scenario.id + "&controlWidth=" + controlWidthMode, {
  waitUntil: "domcontentloaded",
  timeout: 10000,
});
console.log("URL:", state.page.url());
console.log("Logs:", await getLatestLogs({ page: state.page, sinceLastCall: true }));
console.log(await snapshot({ page: state.page, showDiffSinceLastCall: false }));
await state.page.getByText("Actual Source inline geometry ready", { exact: true }).waitFor({
  state: "visible",
  timeout: 8000,
});
const first = await freshReport();
const second = await freshReport(first.frame);
if (second.sample.scenario.id !== scenario.id || second.sample.devicePixelRatio !== scenario.dpr) {
  throw new Error("Actual fixture configuration/DPR differs from the explicitly requested scenario.");
}
const artifactsRoot = "/home/diogenes/Projects/twyne/desktop/gpui/target/verification";
const artifacts = fs.mkdtempSync(path.join(artifactsRoot, "source-inline-geometry-" + scenario.id + "-"));
state.inlineGeometryArtifacts = artifacts;
fs.writeFileSync(path.join(artifacts, "server-provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
fs.writeFileSync(path.join(artifacts, "configuration.json"), JSON.stringify({
  scenario,
  controlWidthMode,
  originalUrl: state.page.url(),
  actualReport: second,
  readyFrames: [first.frame, second.frame],
  fixtureScope: "Two-editor authored scaffold, actual original modules/CSS/font replay; not full Twyne.",
  driverHash: crypto.createHash("sha256").update(fs.readFileSync(path.join(own, "open.js"))).digest("hex"),
}, null, 2) + "\n");
console.log("Artifacts:", artifacts);
console.log(await snapshot({ page: state.page, showDiffSinceLastCall: false }));
console.log("Logs:", await getLatestLogs({ page: state.page, sinceLastCall: true }));
