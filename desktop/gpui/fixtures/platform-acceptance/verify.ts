/** Checks consistency of explicit SYNTHETIC declarations. No build, staged file,
 * key event, OS registration, adapter or device is observed. Existing actual
 * clipboard receipts are linked separately in matrix.md, never negated here. */
import { readRegularPath, safeName, safeRelative } from "../../packaging/files";
import {
  expectedExecutableName,
  type BuildDeclaration,
  type PlatformAcceptanceInput,
  type PlatformContract,
} from "./contract";

export type AcceptanceIssueCode =
  | "invalid-input"
  | "platform-mismatch"
  | "app-id-mismatch"
  | "missing-helper"
  | "unexpected-helper-name"
  | "missing-staged-executable-entry"
  | "unexpected-executable-file"
  | "missing-key-alias"
  | "missing-file-startup"
  | "unhandled-association"
  | "undeclared-association"
  | "unimplemented-url-scheme"
  | "undeclared-url-scheme"
  | "unsupported-microphone-requirement"
  | "missing-microphone-contract"
  | "missing-microphone-metadata";
export interface AcceptanceIssue {
  code: AcceptanceIssueCode;
  detail: string;
}
export interface AcceptanceResult {
  scope: "synthetic-input-consistency";
  ok: boolean;
  issues: AcceptanceIssue[];
  /** Does not imply absence of proof elsewhere; this tool does not check it. */
  notChecked: string[];
}
const NOT_CHECKED = [
  "Actual build output and staged filesystem bytes/types/modes",
  "Running keyboard bindings and OS startup/file-association dispatch",
  "IME composition and candidate handling",
  "Clipboard transfer across applications (separate X11/Wayland evidence exists)",
  "Accessibility tree and screen-reader behavior",
  "macOS/Windows device execution, bundle assembly, installation, signing and updates",
];

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function array(value: unknown): asserts value is unknown[] {
  assert(
    Array.isArray(value) && value.length <= 1024,
    "Expected a bounded array.",
  );
}
function strings(value: unknown): asserts value is string[] {
  array(value);
  assert(
    value.every(text) && new Set(value).size === value.length,
    "Expected unique nonempty strings.",
  );
}
function platform(value: unknown): void {
  assert(
    ["linux", "macos", "windows"].includes(value as string),
    "Unknown platform.",
  );
}
function unique(values: string[], detail: string): void {
  assert(
    new Set(values.map((value) => value.toLowerCase())).size === values.length,
    detail,
  );
}
function suffix(value: unknown): asserts value is string {
  assert(
    typeof value === "string" && /^\.?[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(value),
    "Invalid file-extension declaration.",
  );
}
function normalizeExtension(value: string): string {
  return value.replace(/^\./, "").toLowerCase().split(".").at(-1)!;
}

function validateInput(
  value: unknown,
): asserts value is PlatformAcceptanceInput {
  assert(
    object(value) && value.scope === "synthetic-input-consistency",
    "Only explicitly synthetic consistency inputs are supported.",
  );
  const { contract, manifest, build } = value;
  assert(
    object(contract) &&
      contract.schemaVersion === 2 &&
      object(manifest) &&
      manifest.schemaVersion === 2 &&
      object(build) &&
      build.kind === "synthetic-fixture",
    "Unsupported contract/manifest/declaration schema or overstated build receipt.",
  );
  platform(contract.platform);
  platform(manifest.platform);
  platform(build.platform);
  assert(text(contract.appId) && text(manifest.appId), "Missing app ID.");
  assert(
    manifest.layout === "flat-executables-and-metadata" &&
      manifest.bundleStatus === "not-assembled",
    "Only the flat unassembled packaging layout is supported.",
  );
  array(contract.helpers);
  assert(contract.helpers.length > 0, "Helper contract is empty.");
  for (const helper of contract.helpers) {
    assert(
      object(helper) && typeof helper.required === "boolean",
      "Invalid helper contract.",
    );
    safeName(helper.id);
    safeName(helper.targetName);
    assert(
      helper.windowsExtension === undefined ||
        helper.windowsExtension === ".exe",
      "Invalid executable extension.",
    );
    if (contract.platform === "windows")
      assert(
        helper.windowsExtension === ".exe",
        "Windows contract helpers must declare .exe.",
      );
  }
  unique(
    contract.helpers.map((entry) => (entry as { id: string }).id),
    "Duplicate helper IDs.",
  );
  unique(
    contract.helpers.map(
      (entry) => (entry as { targetName: string }).targetName,
    ),
    "Duplicate helper names.",
  );
  array(contract.keyAliases);
  for (const binding of contract.keyAliases) {
    assert(
      object(binding) &&
        ["save", "undo", "redo", "quit"].includes(binding.action as string),
      "Unknown action contract.",
    );
    strings(binding.aliases);
    assert(binding.aliases.length > 0, "Empty key-alias contract.");
  }
  unique(
    contract.keyAliases.map((entry) => (entry as { action: string }).action),
    "Duplicate key-action contracts.",
  );
  array(contract.fileAssociations);
  for (const association of contract.fileAssociations) {
    assert(
      object(association) && text(association.mime),
      "Invalid file association.",
    );
    suffix(association.extension);
  }
  unique(
    contract.fileAssociations.map(
      (entry) => (entry as { extension: string }).extension,
    ),
    "Duplicate file associations.",
  );
  array(contract.urlSchemes);
  for (const scheme of contract.urlSchemes)
    assert(
      object(scheme) &&
        typeof scheme.scheme === "string" &&
        /^[a-z][a-z0-9+.-]*$/.test(scheme.scheme) &&
        typeof scheme.implementedInGpui === "boolean",
      "Invalid URL-scheme declaration.",
    );
  unique(
    contract.urlSchemes.map((entry) => (entry as { scheme: string }).scheme),
    "Duplicate URL schemes.",
  );
  assert(
    object(contract.microphone) &&
      typeof contract.microphone.required === "boolean",
    "Invalid microphone contract.",
  );
  strings(contract.microphone.usageKeys);
  array(manifest.executables);
  for (const executable of manifest.executables) {
    assert(
      object(executable) && typeof executable.required === "boolean",
      "Invalid executable record.",
    );
    safeName(executable.id);
    safeName(executable.targetName);
    safeRelative(executable.path);
  }
  unique(
    manifest.executables.map((entry) => (entry as { id: string }).id),
    "Duplicate executable IDs.",
  );
  unique(
    manifest.executables.map((entry) => (entry as { path: string }).path),
    "Duplicate executable paths.",
  );
  unique(
    manifest.executables.map(
      (entry) => (entry as { targetName: string }).targetName,
    ),
    "Duplicate executable names.",
  );
  array(manifest.files);
  for (const file of manifest.files) {
    assert(
      object(file) &&
        ["executable", "metadata", "icon", "notice"].includes(
          file.kind as string,
        ),
      "Invalid file inventory entry.",
    );
    safeRelative(file.path);
  }
  unique(
    manifest.files.map((entry) => (entry as { path: string }).path),
    "Duplicate file inventory paths.",
  );
  strings(build.producedExecutables);
  build.producedExecutables.forEach(safeName);
  array(build.keyBindings);
  for (const binding of build.keyBindings) {
    assert(
      object(binding) && text(binding.action),
      "Invalid keybinding declaration.",
    );
    strings(binding.keystrokes);
  }
  unique(
    build.keyBindings.map((entry) => (entry as { action: string }).action),
    "Duplicate keybinding actions.",
  );
  assert(
    object(build.startup) &&
      typeof build.startup.handlesFileArguments === "boolean" &&
      typeof build.startup.handlesUrlScheme === "boolean",
    "Invalid startup declaration.",
  );
  strings(build.startup.extensionTokens);
  build.startup.extensionTokens.forEach(suffix);
  assert(
    object(build.microphone) &&
      typeof build.microphone.realAdapterPresent === "boolean",
    "Invalid microphone capability declaration.",
  );
  strings(build.microphone.usageDescriptionKeys);
}

export function verifyPlatformAcceptance(input: unknown): AcceptanceResult {
  const issues: AcceptanceIssue[] = [];
  const result = () => ({
    scope: "synthetic-input-consistency" as const,
    ok: issues.length === 0,
    issues,
    notChecked: [...NOT_CHECKED],
  });
  try {
    validateInput(input);
  } catch (error) {
    issues.push({ code: "invalid-input", detail: (error as Error).message });
    return result();
  }
  const { contract, manifest, build } = input;
  if (
    contract.platform !== manifest.platform ||
    contract.platform !== build.platform
  )
    issues.push({
      code: "platform-mismatch",
      detail: "Contract, manifest and declaration platforms must match.",
    });
  if (contract.appId !== manifest.appId)
    issues.push({
      code: "app-id-mismatch",
      detail: "Contract and manifest app IDs must match.",
    });
  verifyHelpers(contract, manifest, build, issues);
  verifyKeys(contract, build, issues);
  verifyAssociations(contract, build, issues);
  verifyMicrophone(contract, build, issues);
  return result();
}

function verifyHelpers(
  contract: PlatformContract,
  manifest: PlatformAcceptanceInput["manifest"],
  build: BuildDeclaration,
  issues: AcceptanceIssue[],
): void {
  for (const helper of contract.helpers) {
    const name = expectedExecutableName(helper, contract.platform);
    const executable = manifest.executables.find(
      (entry) => entry.id === helper.id,
    );
    if (!executable) {
      if (helper.required)
        issues.push({
          code: "missing-helper",
          detail: `Required helper ID "${helper.id}" (${name}) is absent from the manifest inventory.`,
        });
      continue;
    }
    if (
      executable.targetName !== name ||
      executable.path !== name ||
      executable.required !== helper.required
    )
      issues.push({
        code: "unexpected-helper-name",
        detail: `Helper "${helper.id}" must have path/target ${name} and required=${helper.required}.`,
      });
    if (
      !manifest.files.some(
        (file) => file.path === name && file.kind === "executable",
      )
    )
      issues.push({
        code: "missing-staged-executable-entry",
        detail: `Helper "${helper.id}" lacks an executable manifest.files entry at ${name}. This checks the declaration, not disk presence.`,
      });
    if (!build.producedExecutables.includes(name))
      issues.push({
        code: "missing-helper",
        detail: `Stated build names do not include manifested helper "${helper.id}" (${name}).`,
      });
  }
  for (const helper of contract.helpers.filter((entry) => entry.required)) {
    const name = expectedExecutableName(helper, contract.platform);
    if (
      !build.producedExecutables.includes(name) &&
      !manifest.executables.some((entry) => entry.id === helper.id)
    )
      issues.push({
        code: "missing-helper",
        detail: `Required helper "${helper.id}" (${name}) is missing from the stated build names.`,
      });
  }
  for (const executable of manifest.executables)
    if (!contract.helpers.some((helper) => helper.id === executable.id))
      issues.push({
        code: "unexpected-helper-name",
        detail: `Unknown executable ID "${executable.id}" cannot substitute for a required helper.`,
      });
  for (const file of manifest.files.filter(
    (entry) => entry.kind === "executable",
  ))
    if (
      !manifest.executables.some(
        (entry) =>
          entry.path === file.path &&
          contract.helpers.some((helper) => helper.id === entry.id),
      )
    )
      issues.push({
        code: "unexpected-executable-file",
        detail: `Executable file ${file.path} has no declared helper identity.`,
      });
}
function verifyKeys(
  contract: PlatformContract,
  build: BuildDeclaration,
  issues: AcceptanceIssue[],
): void {
  for (const spec of contract.keyAliases) {
    const declared = new Set(
      build.keyBindings
        .filter((binding) => binding.action === spec.action)
        .flatMap((binding) => binding.keystrokes),
    );
    for (const alias of spec.aliases)
      if (!declared.has(alias))
        issues.push({
          code: "missing-key-alias",
          detail: `Action "${spec.action}" is missing promised alias "${alias}" on ${contract.platform}.`,
        });
  }
}
function verifyAssociations(
  contract: PlatformContract,
  build: BuildDeclaration,
  issues: AcceptanceIssue[],
): void {
  const declared = new Set(
    contract.fileAssociations.map((entry) =>
      normalizeExtension(entry.extension),
    ),
  );
  const handled = new Set(
    build.startup.extensionTokens.map(normalizeExtension),
  );
  if (
    !build.startup.handlesFileArguments &&
    (declared.size > 0 || handled.size > 0)
  )
    issues.push({
      code: "missing-file-startup",
      detail:
        "File associations/import tokens are stated but startup file-argument handling is disabled.",
    });
  for (const token of declared)
    if (!handled.has(token))
      issues.push({
        code: "unhandled-association",
        detail: `Declared file suffix dispatches on .${token}, absent from startup tokens on ${contract.platform}.`,
      });
  for (const token of handled)
    if (!declared.has(token))
      issues.push({
        code: "undeclared-association",
        detail: `Startup dispatches .${token}, absent from the file declarations on ${contract.platform}.`,
      });
  for (const scheme of contract.urlSchemes)
    if (!scheme.implementedInGpui || !build.startup.handlesUrlScheme)
      issues.push({
        code: "unimplemented-url-scheme",
        detail: `Declared scheme "${scheme.scheme}" lacks a supported startup handler; false implementation flags cannot justify registration.`,
      });
  if (build.startup.handlesUrlScheme && contract.urlSchemes.length === 0)
    issues.push({
      code: "undeclared-url-scheme",
      detail: "URL handling is stated without a declared supported scheme.",
    });
}
function verifyMicrophone(
  contract: PlatformContract,
  build: BuildDeclaration,
  issues: AcceptanceIssue[],
): void {
  if (!build.microphone.realAdapterPresent) {
    if (contract.microphone.required)
      issues.push({
        code: "unsupported-microphone-requirement",
        detail:
          "Microphone metadata is required but the declaration states no real hardware adapter.",
      });
    return;
  }
  if (!contract.microphone.required)
    issues.push({
      code: "missing-microphone-contract",
      detail:
        "A hardware adapter is stated without a microphone metadata contract.",
    });
  if (
    !contract.microphone.usageKeys.some((key) =>
      build.microphone.usageDescriptionKeys.includes(key),
    )
  )
    issues.push({
      code: "missing-microphone-metadata",
      detail:
        "A stated hardware adapter lacks the required declared usage-description key.",
    });
}
export function formatAcceptanceResult(result: AcceptanceResult): string {
  return [
    result.ok
      ? "Synthetic platform declarations agree."
      : "Synthetic platform declarations disagree.",
    ...result.issues.map((issue) => `[${issue.code}] ${issue.detail}`),
    ...result.notChecked.map(
      (item) => `[not checked by this verifier] ${item}`,
    ),
  ].join("\n");
}
if (import.meta.main) {
  if (process.argv.length !== 3) {
    console.error("Usage: verify.ts <synthetic-platform-input.json>");
    process.exitCode = 2;
  } else {
    let input: unknown;
    try {
      input = JSON.parse(
        (
          await readRegularPath(process.argv[2], 2 * 1024 * 1024)
        ).bytes.toString("utf8"),
      );
    } catch (error) {
      console.error(
        `Input could not be read safely: ${(error as Error).message}`,
      );
      process.exitCode = 2;
    }
    if (input !== undefined) {
      const result = verifyPlatformAcceptance(input);
      console.log(formatAcceptanceResult(result));
      if (!result.ok) process.exitCode = 1;
    }
  }
}
