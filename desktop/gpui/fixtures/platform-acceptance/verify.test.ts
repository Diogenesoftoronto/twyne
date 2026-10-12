//! Focused tests for the platform-acceptance verifier.
//!
//! Each broken fixture must fail for its named reason; each valid fixture must
//! pass. The tests assert issue codes, not just a boolean, so a fixture that
//! breaks for the wrong reason cannot pass silently.

import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { PlatformAcceptanceInput } from "./contract";
import { formatAcceptanceResult, verifyPlatformAcceptance } from "./verify";

const here = import.meta.dir;

async function load(relative: string): Promise<PlatformAcceptanceInput> {
  return (await Bun.file(
    resolve(here, relative),
  ).json()) as PlatformAcceptanceInput;
}

const validFixtures = [
  "valid/linux.json",
  "valid/macos.json",
  "valid/windows.json",
];

for (const fixture of validFixtures) {
  test(`valid fixture passes: ${fixture}`, async () => {
    const result = verifyPlatformAcceptance(await load(fixture));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("synthetic-input-consistency");
    expect(result.notChecked).toContain(
      "IME composition and candidate handling",
    );
    expect(result.notChecked).toContain(
      "Clipboard transfer across applications (separate X11/Wayland evidence exists)",
    );
    expect(result.notChecked).toContain(
      "Accessibility tree and screen-reader behavior",
    );
  });
}

test("hypothetical microphone declaration is consistent when capability and metadata agree", async () => {
  const result = verifyPlatformAcceptance(
    await load("valid/macos-microphone.json"),
  );
  expect(result.issues).toEqual([]);
  expect(result.ok).toBe(true);
});

test("a disabled startup dispatcher cannot pass merely by listing correct extension tokens", async () => {
  const input = await load("valid/linux.json");
  input.build.startup.handlesFileArguments = false;
  expect(
    verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
  ).toContain("missing-file-startup");
});

test("the wrong helper ID cannot satisfy a required helper with an equal name", async () => {
  const input = await load("valid/linux.json");
  input.manifest.executables[1].id = "imposter-document";
  const result = verifyPlatformAcceptance(input);
  expect(result.ok).toBe(false);
  expect(
    result.issues.some(
      (issue) =>
        issue.code === "missing-helper" &&
        issue.detail.includes('ID "document"'),
    ),
  ).toBe(true);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "unexpected-helper-name",
  );
});

test("a required helper needs a matching executable file entry, not only names", async () => {
  for (const mutation of ["missing", "wrong-kind", "wrong-path"] as const) {
    const input = await load("valid/linux.json");
    const file = input.manifest.files.find(
      (entry) => entry.path === "twyne-document",
    )!;
    if (mutation === "missing")
      input.manifest.files = input.manifest.files.filter(
        (entry) => entry !== file,
      );
    else if (mutation === "wrong-kind") file.kind = "metadata";
    else file.path = "other-document";
    expect(
      verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
    ).toContain("missing-staged-executable-entry");
  }
});

test("helper path, required flag and build-name omissions cannot pass", async () => {
  for (const mutation of ["path", "required", "build"] as const) {
    const input = await load("valid/linux.json");
    if (mutation === "path")
      input.manifest.executables[1].path = "nested/twyne-document";
    else if (mutation === "required")
      input.manifest.executables[1].required = false;
    else
      input.build.producedExecutables = input.build.producedExecutables.filter(
        (entry) => entry !== "twyne-document",
      );
    const result = verifyPlatformAcceptance(input);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      mutation === "build" ? "missing-helper" : "unexpected-helper-name",
    );
  }
});

test("unknown executable file inventory is rejected", async () => {
  const input = await load("valid/linux.json");
  input.manifest.files.push({
    path: "uncontracted-helper",
    kind: "executable",
  });
  expect(
    verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
  ).toContain("unexpected-executable-file");
});

test("duplicate identities and case-alias file records are rejected", async () => {
  for (const mutation of ["id", "name", "file", "alias"] as const) {
    const input = await load("valid/linux.json");
    if (mutation === "id")
      input.manifest.executables[1].id = input.manifest.executables[0].id;
    else if (mutation === "name")
      input.manifest.executables[1].targetName =
        input.manifest.executables[0].targetName;
    else
      input.manifest.files.push({
        ...input.manifest.files[0],
        ...(mutation === "alias"
          ? { path: input.manifest.files[0].path.toUpperCase() }
          : {}),
      });
    expect(
      verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
    ).toEqual(["invalid-input"]);
  }
});

test("unsafe paths are invalid declarations even though this verifier performs no file traversal", async () => {
  for (const path of [
    "../other",
    "/tmp/other",
    "C:/other",
    "..\\other",
    "name:stream",
    "CON.txt",
  ]) {
    const input = await load("valid/linux.json");
    input.manifest.files[0].path = path;
    expect(
      verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
    ).toEqual(["invalid-input"]);
  }
});

test("false implementation flags never justify declaring a native deep link", async () => {
  const input = await load("valid/macos.json");
  input.contract.urlSchemes = [{ scheme: "twyne", implementedInGpui: false }];
  expect(
    verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
  ).toContain("unimplemented-url-scheme");
  input.build.startup.handlesUrlScheme = true;
  expect(
    verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
  ).toContain("unimplemented-url-scheme");
});

test("declared implemented schemes require startup handling and handler claims require a scheme", async () => {
  const input = await load("valid/linux.json");
  input.contract.urlSchemes = [{ scheme: "twyne", implementedInGpui: true }];
  expect(
    verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
  ).toContain("unimplemented-url-scheme");
  input.contract.urlSchemes = [];
  input.build.startup.handlesUrlScheme = true;
  expect(
    verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
  ).toContain("undeclared-url-scheme");
});

test("all native fixture schemes are empty after unsupported registration removal", async () => {
  for (const file of validFixtures)
    expect((await load(file)).contract.urlSchemes).toEqual([]);
  const plist = await Bun.file(
    resolve(import.meta.dir, "../../packaging/platform/macos/Info.plist"),
  ).text();
  expect(plist).not.toContain("CFBundleURLTypes");
  expect(plist).not.toContain("CFBundleURLSchemes");
});

test("compound Twyne backups use the real final json dispatch token", async () => {
  const input = await load("valid/linux.json");
  input.contract.fileAssociations.find(
    (entry) => entry.extension === "json",
  )!.extension = "twyne.json";
  expect(verifyPlatformAcceptance(input).ok).toBe(true);
});

test("hardware claims still require a capability contract and usage metadata", async () => {
  const input = await load("valid/macos.json");
  input.build.microphone.realAdapterPresent = true;
  const codes = verifyPlatformAcceptance(input).issues.map(
    (issue) => issue.code,
  );
  expect(codes).toContain("missing-microphone-contract");
  expect(codes).toContain("missing-microphone-metadata");
});

test("malformed/older/overstated inputs fail closed without crashing", async () => {
  for (const input of [null, {}, [], { contract: {} }])
    expect(
      verifyPlatformAcceptance(input).issues.map((issue) => issue.code),
    ).toEqual(["invalid-input"]);
  const input = await load("valid/linux.json");
  for (const mutation of [
    "old-schema",
    "receipt",
    "bundle",
    "boolean",
  ] as const) {
    const candidate = structuredClone(input) as unknown as Record<string, any>;
    if (mutation === "old-schema") candidate.manifest.schemaVersion = 1;
    else if (mutation === "receipt")
      candidate.build.kind = "observed-running-build";
    else if (mutation === "bundle")
      candidate.manifest.bundleStatus = "assembled";
    else candidate.build.startup.handlesFileArguments = "true";
    expect(
      verifyPlatformAcceptance(candidate).issues.map((issue) => issue.code),
    ).toEqual(["invalid-input"]);
  }
});

test("formatted results are static consistency claims, not platform or clipboard proof", async () => {
  const result = verifyPlatformAcceptance(await load("valid/linux.json"));
  const text = formatAcceptanceResult(result);
  expect(text).toStartWith("Synthetic platform declarations agree.");
  expect(text).not.toContain("Platform acceptance verification passed");
  expect(text).toContain("not checked by this verifier");
  expect(text).toContain("separate X11/Wayland evidence exists");
});

test("windows helper missing its .exe extension is rejected", async () => {
  const result = verifyPlatformAcceptance(
    await load("broken/windows-extension-missing.json"),
  );
  expect(result.ok).toBe(false);
  const codes = result.issues.map((issue) => issue.code);
  expect(codes).toContain("unexpected-helper-name");
  expect(
    result.issues.some((issue) => issue.detail.includes("twyne-document.exe")),
  ).toBe(true);
});

test("missing redo alias is rejected by action name", async () => {
  const result = verifyPlatformAcceptance(
    await load("broken/macos-redo-alias-missing.json"),
  );
  expect(result.ok).toBe(false);
  expect(result.issues).toContainEqual({
    code: "missing-key-alias",
    detail: 'Action "redo" is missing promised alias "cmd-shift-z" on macos.',
  });
});

test("startup handling an undeclared association is rejected", async () => {
  const result = verifyPlatformAcceptance(
    await load("broken/linux-undeclared-association.json"),
  );
  expect(result.ok).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "undeclared-association",
  );
  expect(result.issues.some((issue) => issue.detail.includes(".rtf"))).toBe(
    true,
  );
});

test("microphone metadata required without a real adapter is rejected", async () => {
  const result = verifyPlatformAcceptance(
    await load("broken/microphone-without-adapter.json"),
  );
  expect(result.ok).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "unsupported-microphone-requirement",
  );
});

test("platform mismatch between contract and manifest is reported", async () => {
  const input = await load("valid/linux.json");
  input.manifest.platform = "macos";
  const result = verifyPlatformAcceptance(input);
  expect(result.ok).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "platform-mismatch",
  );
});
