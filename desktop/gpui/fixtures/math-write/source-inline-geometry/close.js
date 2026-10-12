// Parent cleanup only; never close any page other than this task's own page.
const fs = require("node:fs");
const path = require("node:path");
if (!state.inlineGeometryOwnedPage || !state.inlineGeometryPage ||
    state.page !== state.inlineGeometryPage ||
    !state.page.url().includes("/inline-geometry/?scenario=")) {
  throw new Error("Refusing cleanup of an unowned browser page.");
}
const url = state.page.url();
const ui = await snapshot({ page: state.page, showDiffSinceLastCall: false });
console.log(ui);
const logs = await getLatestLogs({ page: state.page, sinceLastCall: true });
await state.inlineGeometryCDP.send("Emulation.clearDeviceMetricsOverride");
state.page.removeAllListeners("request");
await state.page.close();
fs.writeFileSync(path.join(state.inlineGeometryArtifacts, "cleanup.json"), JSON.stringify({
  url,
  onlyTaskPageClosed: true,
  finalSnapshot: ui,
  logs,
  requests: state.inlineGeometryRequests,
  blocked: state.inlineGeometryBlocked,
  serverStopped: false,
  limits: "Parent must stop only the server process it started; no global browser/server cleanup.",
}, null, 2) + "\n", { flag: "wx" });
state.inlineGeometryOwnedPage = false;
state.inlineGeometryPage = null;
state.page = null;
console.log({ onlyTaskPageClosed: true });
