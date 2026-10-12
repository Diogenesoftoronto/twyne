// Parent-run single-action file. Run open.js, then observe.js before an action.
const fs = require("node:fs");
const path = require("node:path");
if (!state.inlineGeometryOwnedPage || !state.page ||
    state.page !== state.inlineGeometryPage ||
    !state.page.url().includes("/inline-geometry/?scenario=")) {
  throw new Error("No current task-owned original-source inline fixture.");
}
const variant = state.inlineGeometryVariant ?? "markers";
if (!["markers", "control"].includes(variant)) throw new Error("Unknown paired variant.");
const action = state.inlineGeometryAction;
if (!["open", "fill-draft", "cancel", "escape", "caret-before", "caret-after", "arrow-right", "resize"].includes(action)) {
  throw new Error("Set one explicit inlineGeometryAction before executing this file.");
}
if (!state.inlineGeometryLastObservation ||
    state.inlineGeometryLastObservation.url !== state.page.url()) {
  throw new Error("Observe the current Source fixture before acting.");
}
try {
  const section = state.page.locator('[data-probe-variant="' + variant + '"]');
  console.log("URL:", state.page.url());
  console.log(await snapshot({ locator: section, showDiffSinceLastCall: false }));
  console.log("Logs:", await getLatestLogs({ page: state.page, sinceLastCall: true }));
  const before = await state.inlineGeometryFreshReport();
  const row = before.sample.rows.find((item) => item.variant === variant);
  if (!row || !row.unchangedHtml) throw new Error("Fixture already changed canonical source; reload, do not regolden.");

  // All selectors refer to actual reviewed Source controls or explicitly named
  // authored fixture navigation. No force, dispatchEvent or DOM evaluation.
  if (action === "open") {
    await section.locator(".twyne-math-inline").click({ timeout: 3000 });
  } else if (action === "fill-draft") {
    const priorPreview = state.inlineGeometryLastObservation.nodes.find((node) =>
      node.variant === variant && node.role === "preview");
    if (!priorPreview?.outerHTML) throw new Error("Observe the currently rendered preview before typing a draft.");
    state.inlineGeometryPendingPreview = {
      variant,
      beforeMarkup: priorPreview.outerHTML,
      source: before.sample.selected.draft,
      earliest: Date.now() + 300,
    };
    await section.getByRole("textbox", { name: "Inline LaTeX source", exact: true })
      .fill(before.sample.selected.draft, { timeout: 3000 });
  } else if (action === "cancel") {
    await section.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 3000 });
  } else if (action === "escape") {
    await section.getByRole("textbox", { name: "Inline LaTeX source", exact: true }).press("Escape");
  } else if (action === "caret-before") {
    await section.getByRole("button", { name: "Caret before equation", exact: true }).click({ timeout: 3000 });
  } else if (action === "caret-after") {
    await section.getByRole("button", { name: "Caret after equation", exact: true }).click({ timeout: 3000 });
  } else if (action === "arrow-right") {
    // Only after a directly observed real manuscript caret.
    if (row.field || !row.focusedInEditor || row.selection.type !== "text") {
      throw new Error("ArrowRight requires the observed plain manuscript caret.");
    }
    await state.page.keyboard.press("ArrowRight");
  } else {
    const request = state.inlineGeometryResize;
    if (!request || !Number.isInteger(request.width) || request.width < 320 || request.width > 1280 ||
        !Number.isInteger(request.height) || request.height < 600 || request.height > 1000 ||
        ![1, 2].includes(request.dpr)) {
      throw new Error("Resize must be explicitly bounded to width320..1280, height600..1000, DPR1|2.");
    }
    await state.inlineGeometryCDP.send("Emulation.setDeviceMetricsOverride", {
      width: request.width,
      height: request.height,
      deviceScaleFactor: request.dpr,
      mobile: false,
    });
  }
  console.log("URL:", state.page.url());
  console.log("Logs:", await getLatestLogs({ page: state.page, sinceLastCall: true }));
  console.log(await snapshot({ locator: section, showDiffSinceLastCall: false }));
  const next = await state.inlineGeometryFreshReport(before.frame + 1);
  if (next.sample.rows.some((item) => !item.unchangedHtml)) {
    throw new Error("Geometry-only action changed original canonical HTML.");
  }
  const result = next.sample.rows.find((item) => item.variant === variant);
  if (action === "open" && (!result.field?.focused ||
      result.field.selectionStart !== result.field.value.length ||
      result.field.selectionEnd !== result.field.value.length)) {
    throw new Error("Actual Source did not autofocus its end-caret.");
  }
  if (action === "fill-draft" && result.field?.value !== next.sample.selected.draft) {
    throw new Error("Actual textarea raw value does not equal the requested authored draft.");
  }
  if ((action === "cancel" || action === "escape") && result.field) {
    throw new Error("Actual Source cancel/escape did not close the form.");
  }
  state.inlineGeometryPhase = action + "-" + variant;
  const actionFile = String(++state.inlineGeometryActionSequence).padStart(2, "0") + "-" +
    state.inlineGeometryPhase + "-action.json";
  fs.writeFileSync(path.join(state.inlineGeometryArtifacts, actionFile), JSON.stringify({
    action,
    variant,
    url: state.page.url(),
    before,
    after: next,
    resize: action === "resize" ? state.inlineGeometryResize : null,
    observedUiAfter: await snapshot({ locator: section, showDiffSinceLastCall: false }),
    logs: await getLatestLogs({ page: state.page, sinceLastCall: true }),
  }, null, 2) + "\n", { flag: "wx" });
  // An observation must be refreshed after every action.
  state.inlineGeometryLastObservation = null;
  console.log({ action, variant, canonicalHtmlUnchanged: true, nextFrame: next.frame });
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
