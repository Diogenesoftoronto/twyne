/** Integrity and data-preservation tests. Synthetic loader tables are never
 * executed and establish no runtime/installer/signing proof. Real-build checks
 * are explicit skips when absent, or mandatory with REQUIRE_REAL=1. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readBinaryDependencies } from "../../packaging/binary-deps";
import {
  readRegular,
  readRegularPath,
  safeRelative,
} from "../../packaging/files";
import {
  buildPortabilityReport,
  classifyDependency,
  isNonPortableInterpreter,
} from "../../packaging/portability";
import {
  currentPlatform,
  loadContract,
  stage,
  verify,
  type Contract,
  type DistributionManifest,
  type Platform,
  type StageOptions,
} from "../../packaging/stage";
import { loaderFixture } from "./binary-fixtures";

const GPUI_ROOT = resolve(import.meta.dir, "../..");
const REQUIRED = ["twyne-desktop", "twyne-document", "twyne-math-write"];
const POSIX = process.platform !== "win32";
const TARGET = currentPlatform();
const FORMAT = { linux: "elf", macos: "macho", windows: "pe" } as const;
let workspace: string;
let serial = 0;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const nameFor = (name: string, platform: Platform) =>
  platform === "windows" ? `${name}.exe` : name;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "twyne-packaging-checks-"));
});
afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function fixture(target: Platform = TARGET) {
  const directory = join(workspace, `case-${serial++}`);
  const sourceRoot = join(directory, "inputs");
  const releaseDir = join(directory, "release");
  const outDir = join(directory, "output");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(releaseDir);
  const contract = structuredClone(await loadContract());
  contract.notices = { files: ["NOTICE.md"], globs: ["licenses/*"] };
  for (const platform of ["linux", "macos", "windows"] as const) {
    contract.platformMetadata[platform] = [
      {
        source: "metadata/identity.txt",
        target: `scaffolds/${platform}/identity.txt`,
      },
    ];
    contract.icons[platform] = [
      {
        source: "icons/original.png",
        target: `scaffolds/${platform}/original.png`,
      },
    ];
  }
  await mkdir(join(sourceRoot, "licenses"));
  await mkdir(join(sourceRoot, "metadata"));
  await mkdir(join(sourceRoot, "icons"));
  await writeFile(join(sourceRoot, "NOTICE.md"), "Original required notice\n");
  await writeFile(
    join(sourceRoot, "licenses/OFL.txt"),
    "Original OFL license fixture\n",
  );
  await writeFile(
    join(sourceRoot, "metadata/identity.txt"),
    "love.twyne.gpui\n",
  );
  await writeFile(
    join(sourceRoot, "icons/original.png"),
    Buffer.from([137, 80, 78, 71]),
  );
  for (const name of REQUIRED) {
    const path = join(releaseDir, nameFor(name, target));
    await writeFile(path, loaderFixture(target));
    if (POSIX) await chmod(path, 0o751);
  }
  const contractPath = join(directory, "contract.json");
  const saveContract = () => writeFile(contractPath, JSON.stringify(contract));
  await saveContract();
  const options: StageOptions = {
    platform: target,
    releaseDir,
    outDir,
    sourceRoot,
    contractPath,
    productVersion: "0.22.0",
    nativeCrateVersion: "0.1.0",
  };
  return {
    directory,
    sourceRoot,
    releaseDir,
    outDir,
    contract,
    saveContract,
    options,
    run: () => stage(options),
    check: (manifest?: DistributionManifest) =>
      verify(outDir, { sourceRoot, contractPath, manifest }),
  };
}

describe("original contract and portable loader tables", () => {
  test("identifiers, helpers and associations trace to current native sources", async () => {
    const contract = await loadContract();
    const main = await readFile(join(GPUI_ROOT, "src/main.rs"), "utf8");
    const storage = await readFile(join(GPUI_ROOT, "src/storage.rs"), "utf8");
    const bridge = await readFile(
      join(GPUI_ROOT, "src/semantic_bridge.rs"),
      "utf8",
    );
    expect(main).toContain(
      `app_id: Some("${contract.identifiers.appId}".into())`,
    );
    expect(storage).toContain(
      `ProjectDirs::from("${contract.identifiers.dataDirectoryQualifier}"`,
    );
    expect(storage).toContain(
      `"${contract.identifiers.dataDirectoryApplication}"`,
    );
    expect(bridge).toContain(`"${contract.identifiers.helperPathEnvOverride}"`);
    for (const extension of [
      "twyne",
      "json",
      "typ",
      "html",
      "htm",
      "md",
      "markdown",
      "txt",
    ])
      expect(storage).toContain(`"${extension}"`);
    expect(
      new Set(contract.fileAssociations.map((entry) => entry.extension)).size,
    ).toBe(contract.fileAssociations.length);
    expect(
      contract.executables.find((entry) => entry.id === "math-write")?.required,
    ).toBe(true);
  });

  for (const platform of ["linux", "macos", "windows"] as const)
    for (const arm64 of [false, true]) {
      test(`${platform} ${arm64 ? "ARM64" : "x86-64"} table is parsed on any host`, () => {
        const dependency = readBinaryDependencies(
          loaderFixture(platform, arm64),
        );
        expect(dependency.format).toBe(FORMAT[platform]);
        expect(dependency.architecture).toBe(arm64 ? "aarch64" : "x86_64");
        expect(dependency.libraries).toEqual(
          platform === "linux"
            ? ["libc.so.6"]
            : platform === "macos"
              ? ["/usr/lib/libSystem.B.dylib"]
              : ["KERNEL32.dll"],
        );
        if (platform === "linux")
          expect(dependency.runpaths).toEqual(["$ORIGIN/lib"]);
        if (platform === "macos")
          expect(dependency.runpaths).toEqual(["@executable_path/lib"]);
      });
    }
  test("scripts and truncated headers are not accepted as loader tables", () => {
    for (const bytes of [
      Buffer.from("#!/bin/sh\nexit 0\n"),
      Buffer.from([127, 69, 76, 70]),
    ])
      expect(readBinaryDependencies(bytes).format).toBe("unknown");
  });

  const realPaths = REQUIRED.map((name) =>
    join(GPUI_ROOT, "target/release", nameFor(name, TARGET)),
  );
  const requireReal = process.env.TWYNE_DISTRIBUTION_REQUIRE_REAL === "1";
  test.skipIf(!requireReal && !realPaths.every(existsSync))(
    "all actual host release binaries have recognized host headers (not runtime proof)",
    async () => {
      const architectures: Record<string, string> = {
        x64: "x86_64",
        arm64: "aarch64",
        ia32: "i386",
        arm: "arm",
        riscv64: "riscv",
      };
      const expected = architectures[process.arch];
      expect(expected).toBeDefined();
      for (const path of realPaths) {
        const dependencies = readBinaryDependencies(
          (await readRegularPath(path)).bytes,
        );
        expect(dependencies.format).toBe(FORMAT[TARGET]);
        expect(dependencies.architecture?.split("+")).toContain(expected);
      }
    },
  );
});

describe("fresh staging and complete inputs", () => {
  test("host-format stage retains exact input bytes, required identities and logical provenance", async () => {
    const f = await fixture();
    const manifest = await f.run();
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.bundleStatus).toBe("not-assembled");
    expect(manifest.executables.map((entry) => entry.targetName)).toEqual(
      REQUIRED.map((name) => nameFor(name, TARGET)),
    );
    expect(manifest.productVersion).toBe("0.22.0");
    expect(manifest.nativeCrateVersion).toBe("0.1.0");
    expect(manifest.versionMismatch).toBe(true);
    for (const entry of manifest.files)
      expect(digest(await readFile(join(f.outDir, entry.path)))).toBe(
        entry.sha256,
      );
    expect(
      manifest.files.every(
        (entry) =>
          entry.source.startsWith("gpui/") ||
          entry.source.startsWith("release/"),
      ),
    ).toBe(true);
    expect((await f.check()).issues).toEqual([]);
  });
  for (const platform of ["linux", "macos", "windows"] as const) {
    test.skipIf(!POSIX && platform !== "windows")(
      `${platform} stages only declared targets with original notices/icons`,
      async () => {
        const f = await fixture(platform);
        f.options.sourceRoot = GPUI_ROOT;
        f.options.contractPath = undefined;
        const manifest = await f.run();
        expect(
          manifest.executables.every(
            (entry) => entry.dependencies.format === FORMAT[platform],
          ),
        ).toBe(true);
        expect(
          manifest.files.some((entry) =>
            entry.path.endsWith("assets/licenses/typst-fonts.txt"),
          ),
        ).toBe(true);
        const icon = manifest.files.find((entry) => entry.kind === "icon");
        expect(icon).toBeDefined();
        expect(icon?.sha256).toBe(
          digest(await readFile(join(GPUI_ROOT, icon!.source.slice(5)))),
        );
        expect((await verify(f.outDir)).issues).toEqual([]);
        if (platform === "macos") {
          expect(
            manifest.files.some((entry) => entry.path.startsWith("Twyne.app/")),
          ).toBe(false);
          const plist = await readFile(
            join(f.outDir, "scaffolds/macos/Info.plist.in"),
            "utf8",
          );
          expect(plist).toContain("@PRODUCT_VERSION@");
          expect(plist).not.toContain("CFBundleURLTypes");
          expect(plist).not.toContain("CFBundleURLSchemes");
        }
        if (platform === "windows") {
          expect(
            manifest.executables.every((entry) => entry.path.endsWith(".exe")),
          ).toBe(true);
          expect(
            await readFile(
              join(f.outDir, "scaffolds/windows/twyne.rc.in"),
              "utf8",
            ),
          ).toContain("@PRODUCT_VERSION@");
        }
      },
    );
  }
  for (const kind of [
    "nonempty directory",
    "empty directory",
    "file",
  ] as const) {
    test(`existing ${kind} is never removed or replaced, even with invalid inputs`, async () => {
      const f = await fixture();
      if (kind === "file") await writeFile(f.outDir, "KEEP MY DATA");
      else {
        await mkdir(f.outDir);
        if (kind === "nonempty directory")
          await writeFile(join(f.outDir, "user-draft.txt"), "KEEP MY DATA");
      }
      await rm(join(f.releaseDir, nameFor("twyne-document", TARGET)));
      await expect(f.run()).rejects.toThrow(/already exists/);
      expect(
        kind === "file"
          ? await readFile(f.outDir, "utf8")
          : kind === "nonempty directory"
            ? await readFile(join(f.outDir, "user-draft.txt"), "utf8")
            : (await readdir(f.outDir)).join(""),
      ).toBe(kind === "empty directory" ? "" : "KEEP MY DATA");
    });
  }
  test.skipIf(!POSIX)(
    "dangling destination symlink is not followed, replaced or removed",
    async () => {
      const f = await fixture();
      const absent = join(f.directory, "not-created");
      await symlink(absent, f.outDir);
      await expect(f.run()).rejects.toThrow(/already exists/);
      expect(await readlink(f.outDir)).toBe(absent);
      expect(existsSync(absent)).toBe(false);
    },
  );
  for (const missing of [
    "helper",
    "notice",
    "license glob",
    "metadata",
    "icon",
  ] as const) {
    test(`missing ${missing} fails before destination creation`, async () => {
      const f = await fixture();
      const path =
        missing === "helper"
          ? join(f.releaseDir, nameFor("twyne-math-write", TARGET))
          : join(
              f.sourceRoot,
              missing === "notice"
                ? "NOTICE.md"
                : missing === "license glob"
                  ? "licenses/OFL.txt"
                  : missing === "metadata"
                    ? "metadata/identity.txt"
                    : "icons/original.png",
            );
      await rm(path);
      await expect(f.run()).rejects.toThrow();
      expect(existsSync(f.outDir)).toBe(false);
    });
  }
  test("binary format for a different target and text scripts fail before creation", async () => {
    for (const bytes of [
      loaderFixture(TARGET === "windows" ? "macos" : "windows"),
      Buffer.from("#!/bin/sh\nexit 0"),
    ]) {
      const f = await fixture();
      await writeFile(
        join(f.releaseDir, nameFor("twyne-document", TARGET)),
        bytes,
      );
      await expect(f.run()).rejects.toThrow(/recognized/);
      expect(existsSync(f.outDir)).toBe(false);
    }
  });
  test("a directory cannot masquerade as an executable", async () => {
    const f = await fixture();
    const path = join(f.releaseDir, nameFor("twyne-desktop", TARGET));
    await rm(path);
    await mkdir(path);
    await expect(f.run()).rejects.toThrow(/unsafe executable/);
    expect(existsSync(f.outDir)).toBe(false);
  });
  test("destination inside release input is refused", async () => {
    const f = await fixture();
    f.options.outDir = join(f.releaseDir, "new-output");
    await expect(f.run()).rejects.toThrow(/inside/);
    expect(existsSync(f.options.outDir)).toBe(false);
  });
  test("colliding output mappings are refused before writing", async () => {
    const f = await fixture();
    f.contract.icons[TARGET][0].target = nameFor("twyne-desktop", TARGET);
    await f.saveContract();
    await expect(f.run()).rejects.toThrow(/Duplicate target/);
    expect(existsSync(f.outDir)).toBe(false);
  });
  test("case aliases and file/directory collisions fail before writing on every host", async () => {
    for (const target of [
      nameFor("TWYNE-DESKTOP", TARGET),
      `${nameFor("twyne-desktop", TARGET)}/child`,
      "distribution-manifest.json/child",
    ]) {
      const f = await fixture();
      f.contract.icons[TARGET][0].target = target;
      await f.saveContract();
      await expect(f.run()).rejects.toThrow(/collision/);
      expect(existsSync(f.outDir)).toBe(false);
    }
  });
  test("unsupported contract and empty required input fail before writing", async () => {
    const f = await fixture();
    f.contract.schemaVersion = 99;
    await f.saveContract();
    await expect(f.run()).rejects.toThrow(/Unsupported/);
    expect(existsSync(f.outDir)).toBe(false);
    const g = await fixture();
    await writeFile(join(g.sourceRoot, "NOTICE.md"), "");
    await expect(g.run()).rejects.toThrow(/empty/);
    expect(existsSync(g.outDir)).toBe(false);
  });
  for (const location of [
    "helper",
    "notice",
    "notice ancestor",
    "release root",
  ] as const) {
    test.skipIf(!POSIX)(
      `symlink ${location} is refused before writing`,
      async () => {
        const f = await fixture();
        const external = join(f.directory, "external");
        if (location === "release root") {
          await symlink(f.releaseDir, external);
          f.options.releaseDir = external;
        } else if (location === "notice ancestor") {
          await mkdir(external);
          await writeFile(join(external, "identity.txt"), "external");
          await rm(join(f.sourceRoot, "metadata"), { recursive: true });
          await symlink(external, join(f.sourceRoot, "metadata"));
        } else {
          await writeFile(
            external,
            location === "helper" ? loaderFixture(TARGET) : "external notice",
          );
          const path =
            location === "helper"
              ? join(f.releaseDir, nameFor("twyne-desktop", TARGET))
              : join(f.sourceRoot, "NOTICE.md");
          await rm(path);
          await symlink(external, path);
        }
        await expect(f.run()).rejects.toThrow();
        expect(existsSync(f.outDir)).toBe(false);
      },
    );
  }
  test.skipIf(!POSIX)(
    "nonexecutable POSIX helper fails before writing",
    async () => {
      const f = await fixture(TARGET === "windows" ? "linux" : TARGET);
      await chmod(join(f.releaseDir, "twyne-document"), 0o644);
      await expect(f.run()).rejects.toThrow(/executable permission/);
      expect(existsSync(f.outDir)).toBe(false);
    },
  );
  test.skipIf(!POSIX)(
    "original POSIX modes survive umask and tampering is detected",
    async () => {
      const f = await fixture();
      const manifest = await f.run();
      const path = manifest.executables[0].path;
      expect((await lstat(join(f.outDir, path))).mode & 0o777).toBe(0o751);
      expect(manifest.executables[0].mode).toBe(0o751);
      await chmod(join(f.outDir, path), 0o644);
      expect(
        (await f.check()).issues.some(
          (issue) => issue.code === "mode-mismatch",
        ),
      ).toBe(true);
    },
  );
  test("two simultaneous stages cannot overwrite each other's destination", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.run(), f.run()]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await f.check()).ok).toBe(true);
  });
  test("bounded reads reject oversized data without allocating the file", async () => {
    const f = await fixture();
    await expect(readRegular(f.sourceRoot, "NOTICE.md", 2)).rejects.toThrow(
      /bounded read limit/,
    );
  });
});

describe("verification refuses incomplete or escaping inventories", () => {
  test("altered bytes, byte counts and removed helper are detected", async () => {
    const f = await fixture();
    await f.run();
    const desktop = join(f.outDir, nameFor("twyne-desktop", TARGET));
    await writeFile(
      desktop,
      Buffer.concat([await readFile(desktop), Buffer.from("modified")]),
    );
    await rm(join(f.outDir, nameFor("twyne-document", TARGET)));
    const codes = (await f.check()).issues.map((issue) => issue.code);
    expect(codes).toContain("hash-mismatch");
    expect(codes).toContain("byte-count-mismatch");
    expect(codes).toContain("missing-executable");
  });
  test("removing a notice from disk AND manifest cannot hide a required license", async () => {
    const f = await fixture();
    const manifest = await f.run();
    const path = "share/doc/twyne/licenses/OFL.txt";
    manifest.files = manifest.files.filter((entry) => entry.path !== path);
    await rm(join(f.outDir, path));
    expect(
      (await f.check(manifest)).issues.some(
        (issue) => issue.code === "missing-notice" && issue.path === path,
      ),
    ).toBe(true);
  });
  test("replacing a required notice and rehashing the manifest still rejects changed source bytes", async () => {
    const f = await fixture();
    const manifest = await f.run();
    const notice = manifest.files.find((entry) => entry.kind === "notice")!;
    const replacement = Buffer.from("replacement notice\n");
    await writeFile(join(f.outDir, notice.path), replacement);
    notice.sha256 = digest(replacement);
    notice.bytes = replacement.length;
    expect(
      (await f.check(manifest)).issues.some(
        (issue) => issue.code === "hash-mismatch",
      ),
    ).toBe(true);
  });
  for (const field of ["path", "source"] as const)
    for (const path of [
      "../outside.txt",
      "/etc/passwd",
      "C:/outside.txt",
      "..\\outside.txt",
      "safe/../outside.txt",
      "safe//outside.txt",
      "CON.txt",
      "name:stream",
    ] as const) {
      test(`manifest ${field} '${path}' is rejected before traversal`, async () => {
        const f = await fixture();
        const manifest = await f.run();
        manifest.files[0][field] = path;
        const result = await f.check(manifest);
        expect(result.ok).toBe(false);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].code).toBe("unsafe-path");
        expect(await readFile(join(f.sourceRoot, "NOTICE.md"), "utf8")).toBe(
          "Original required notice\n",
        );
      });
    }
  test("executable path/target traversal is rejected before reading", async () => {
    const f = await fixture();
    const manifest = await f.run();
    manifest.executables[0].path = "../outside";
    expect((await f.check(manifest)).issues[0].code).toBe("unsafe-path");
    manifest.executables[0].path = nameFor("twyne-desktop", TARGET);
    manifest.executables[0].targetName = "nested/twyne-desktop";
    expect((await f.check(manifest)).issues[0].code).toBe("unsafe-path");
  });
  test("duplicate file and executable identity records do not substitute for completeness", async () => {
    for (const duplicate of ["file", "executable"] as const) {
      const f = await fixture();
      const manifest = await f.run();
      if (duplicate === "file") manifest.files.push(manifest.files[0]);
      else manifest.executables.push(manifest.executables[0]);
      expect((await f.check(manifest)).issues[0].code).toBe("invalid-manifest");
    }
  });
  test("required flag, identity, loader table and platform substitutions are detected", async () => {
    for (const mutation of [
      "required",
      "identity",
      "loader",
      "platform",
    ] as const) {
      const f = await fixture();
      const manifest = await f.run();
      if (mutation === "required") manifest.executables[0].required = false;
      else if (mutation === "identity")
        manifest.executables[0].id = "fake-desktop";
      else if (mutation === "loader")
        manifest.executables[0].dependencies.libraries = ["fake-library"];
      else manifest.platform = TARGET === "windows" ? "linux" : "windows";
      const result = await f.check(manifest);
      expect(result.ok).toBe(false);
      expect(
        result.issues.some((issue) =>
          mutation === "loader"
            ? issue.code === "dependency-mismatch"
            : issue.code === "unexpected-target-name",
        ),
      ).toBe(true);
    }
  });
  test("manifest schema, bundle status and exact contract digest are checked", async () => {
    const f = await fixture();
    const manifest = await f.run();
    const badSchema = structuredClone(manifest);
    (badSchema as unknown as { schemaVersion: number }).schemaVersion = 1;
    expect((await f.check(badSchema)).issues[0].code).toBe("invalid-manifest");
    const badStatus = structuredClone(manifest);
    (badStatus as unknown as { bundleStatus: string }).bundleStatus =
      "runnable";
    expect((await f.check(badStatus)).ok).toBe(false);
    manifest.contractSha256 = "0".repeat(64);
    expect(
      (await f.check(manifest)).issues.some(
        (issue) => issue.code === "contract-mismatch",
      ),
    ).toBe(true);
  });
  test("unexpected file and empty directory are detected", async () => {
    const f = await fixture();
    await f.run();
    await writeFile(join(f.outDir, "stray.txt"), "unlisted");
    await mkdir(join(f.outDir, "stray-empty-dir"));
    const result = await f.check();
    expect(
      result.issues
        .filter((issue) => issue.code === "unexpected-file")
        .map((issue) => issue.path),
    ).toEqual(expect.arrayContaining(["stray.txt", "stray-empty-dir"]));
  });
  for (const location of [
    "helper",
    "manifest",
    "notice ancestor",
    "stray link",
  ] as const) {
    test.skipIf(!POSIX)(`staged ${location} symlink is refused`, async () => {
      const f = await fixture();
      await f.run();
      const target = join(f.directory, "outside");
      if (location === "notice ancestor") {
        await mkdir(target);
        await rm(join(f.outDir, "share/doc/twyne"), { recursive: true });
        await symlink(target, join(f.outDir, "share/doc/twyne"));
      } else {
        const path =
          location === "helper"
            ? join(f.outDir, nameFor("twyne-desktop", TARGET))
            : location === "manifest"
              ? join(f.outDir, "distribution-manifest.json")
              : join(f.outDir, "unlisted-link");
        if (location !== "stray link") {
          await writeFile(target, await readFile(path));
          await rm(path);
        } else await writeFile(target, "outside");
        await symlink(target, path);
      }
      const result = await f.check();
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.code === "unsafe-file")).toBe(
        true,
      );
    });
  }
  test("portable path validator rejects reserved separators/components on every host", () => {
    for (const path of [
      "a/../b",
      "a\\b",
      "a:b",
      "NUL",
      "foo.",
      "foo ",
      "./file",
      "",
      "a\u0000b",
    ])
      expect(() => safeRelative(path)).toThrow();
    expect(safeRelative("share/doc/twyne/OFL.txt")).toBe(
      "share/doc/twyne/OFL.txt",
    );
  });
});

describe("bounded portability analysis is not runtime proof", () => {
  test("host and build-store findings retain an explicit updater boundary", async () => {
    const f = await fixture();
    const manifest = await f.run();
    manifest.executables[0].dependencies = {
      ...readBinaryDependencies(loaderFixture(TARGET)),
      interpreter: "/nix/store/example/lib/ld-linux.so",
      libraries: ["libc.so.6", "libxkbcommon.so.0"],
    };
    const report = await buildPortabilityReport(manifest);
    expect(report.binaries[0].nonPortableInterpreter).toBe(true);
    expect(report.updateSignature.updateMechanismImplemented).toBe(false);
    expect(
      classifyDependency("libxkbcommon.so.0", "linux").classification,
    ).toBe("system-x11");
    expect(isNonPortableInterpreter("/nix/store/example/ld.so")).toBe(true);
    expect(report.updateSignature.requiresCodeSigning).toEqual(
      TARGET === "linux" ? [] : [TARGET],
    );
  });
});
