import { describe, expect, test } from "bun:test";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertHost,
  freshWorkspace,
  installRegularBinary,
  publishWorkspace,
  readBoundedResponse,
  selectedArchive,
  sha256,
  validateCommandFile,
  verifyArchiveBytes,
  verifyArchiveListing,
  type ArchiveSpec,
} from "./bootstrap-rtk";
import release from "./rtk-release.json";

const HERE = dirname(import.meta.path);
const CHECKSUMS_SHA256 =
  "2206d1e92ce695ad8a210ffd629822cce457afffee908a4c09c33aabab435348";

async function temporary<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "twyne-ci-unit-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const specimen = new TextEncoder().encode(
  "synthetic archive bytes: never an executable",
);
const specimenPin: ArchiveSpec = {
  ...selectedArchive("Linux", "X64"),
  bytes: specimen.byteLength,
  sha256: sha256(specimen),
};

describe("portable RTK bootstrap guards (synthetic data; no archive download or execution)", () => {
  test("five exact named archive hashes match the retained primary checksum bytes", async () => {
    const bytes = await readFile(join(HERE, "rtk-checksums.txt"));
    expect(bytes.byteLength).toBe(838);
    expect(sha256(bytes)).toBe(CHECKSUMS_SHA256);
    expect(release.checksums.sha256).toBe(CHECKSUMS_SHA256);
    const rows = bytes.toString("utf8").trimEnd().split("\n");
    const expected = {
      "Linux-X64": "rtk-x86_64-unknown-linux-musl.tar.gz",
      "Linux-ARM64": "rtk-aarch64-unknown-linux-gnu.tar.gz",
      "macOS-X64": "rtk-x86_64-apple-darwin.tar.gz",
      "macOS-ARM64": "rtk-aarch64-apple-darwin.tar.gz",
      "Windows-X64": "rtk-x86_64-pc-windows-msvc.zip",
    };
    expect(Object.keys(release.assets)).toEqual(Object.keys(expected));
    for (const [key, archive] of Object.entries(expected)) {
      const [os, arch] = key.split("-") as [string, string];
      const pin = selectedArchive(os, arch);
      expect(pin.archive).toBe(archive);
      const matched = rows.filter((row) => row.slice(66) === archive);
      expect(matched).toHaveLength(1);
      expect(matched[0]!.slice(0, 64)).toBe(pin.sha256);
      expect(pin.url).toBe(
        `https://github.com/rtk-ai/rtk/releases/download/v0.36.0/${archive}`,
      );
      expect(pin.binary).toBe(os === "Windows" ? "rtk.exe" : "rtk");
      expect(Object.isFrozen(pin)).toBe(true);
    }
  });

  test("unsupported runner or mismatched host fails before any download", () => {
    for (const [os, arch] of [
      ["Linux", "X86"],
      ["Windows", "ARM64"],
      ["macOS", "ARM"],
      ["Plan9", "X64"],
      ["linux", "X64"],
      ["Linux", "x64"],
    ])
      expect(() => selectedArchive(os!, arch!)).toThrow("Unsupported runner");
    expect(() => assertHost("not-the-current-host", "X64")).toThrow(
      "does not match",
    );
  });

  test("a matching checksum for some other file cannot validate the selected archive", () => {
    expect(() => verifyArchiveBytes(specimen, specimenPin)).not.toThrow();
    expect(() =>
      verifyArchiveBytes(specimen, {
        ...specimenPin,
        bytes: specimen.length - 1,
      }),
    ).toThrow("size");
    const changed = specimen.slice();
    changed[0] ^= 1;
    expect(() => verifyArchiveBytes(changed, specimenPin)).toThrow("SHA-256");
    expect(() =>
      verifyArchiveBytes(specimen, selectedArchive("Linux", "X64")),
    ).toThrow("size");
  });

  test("exact archive inventory accepts root binaries only and refuses ambiguous/traversing layouts", () => {
    for (const listing of ["rtk", "rtk\n", "rtk\r\n"])
      expect(() => verifyArchiveListing(listing, "rtk")).not.toThrow();
    expect(() => verifyArchiveListing("rtk.exe\n", "rtk.exe")).not.toThrow();
    for (const listing of [
      "",
      "rtk\nrtk\n",
      "rtk\nREADME\n",
      "./rtk\n",
      "folder/rtk\n",
      "../rtk\n",
      "/rtk\n",
      "rtk.exe\n",
      "rtk\n\n",
      "rtk\r\nextra\r\n",
    ])
      expect(() => verifyArchiveListing(listing, "rtk")).toThrow("exactly");
  });

  test("download reader bounds streamed bytes, headers, truncation and HTTP failures", async () => {
    expect(
      await readBoundedResponse(new Response(specimen), specimen.length),
    ).toEqual(specimen);
    for (const response of [
      new Response(specimen.slice(1)),
      new Response(new Uint8Array(specimen.length + 1)),
      new Response(specimen, {
        headers: { "content-length": String(specimen.length - 1) },
      }),
      new Response(null, { status: 404 }),
    ])
      await expect(
        readBoundedResponse(response, specimen.length),
      ).rejects.toThrow();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(specimen.length + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readBoundedResponse(new Response(stream), specimen.length),
    ).rejects.toThrow("exceeded");
    expect(cancelled).toBe(true);
  });

  test("invalid byte budgets never allocate an unbounded response buffer", async () => {
    for (const bound of [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      8 * 1024 * 1024 + 1,
    ]) {
      await expect(
        readBoundedResponse(new Response(specimen), bound),
      ).rejects.toThrow("byte bound");
    }
  });

  test.skipIf(process.platform === "win32")(
    "file symlink extraction is refused without following its target (POSIX fixture)",
    async () =>
      temporary(async (root) => {
        const source = join(root, "source");
        const pointer = join(root, "symlink");
        const target = join(root, "not-created");
        await writeFile(source, specimen);
        await symlink(source, pointer, "file");
        await expect(installRegularBinary(pointer, target)).rejects.toThrow(
          "regular file",
        );
        await expect(lstat(target)).rejects.toThrow();
        expect(await readFile(source)).toEqual(Buffer.from(specimen));
      }),
  );

  test("workspace is unique, leaves colliding/sentinel data intact, and stage child remains absent", async () =>
    temporary(async (root) => {
      const existing = join(root, "twyne-distribution");
      await mkdir(existing);
      await writeFile(join(existing, "keep.txt"), "unrelated destination");
      const a = await freshWorkspace(root);
      const b = await freshWorkspace(root);
      expect(a.root).not.toBe(b.root);
      expect(a.stage).not.toBe(b.stage);
      const canonicalRunner = await realpath(root);
      const canonicalWorkspace = await realpath(a.root);
      expect(dirname(canonicalWorkspace)).toBe(canonicalRunner);
      expect(await realpath(a.bin)).toBe(join(canonicalWorkspace, "bin"));
      expect((await lstat(a.bin)).isDirectory()).toBe(true);
      expect((await lstat(a.extraction)).isDirectory()).toBe(true);
      await expect(lstat(a.stage)).rejects.toThrow();
      expect(await readFile(join(existing, "keep.txt"), "utf8")).toBe(
        "unrelated destination",
      );
    }));

  test("workspace placement follows canonical runner temp ancestors", async () =>
    temporary(async (root) => {
      const actual = join(root, "actual");
      const runner = join(actual, "runner");
      const alias = join(root, "alias");
      await mkdir(runner, { recursive: true });
      await symlink(
        actual,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
      const aliasedRunner = join(alias, "runner");
      const workspace = await freshWorkspace(aliasedRunner);
      const canonicalRunner = await realpath(aliasedRunner);
      expect(canonicalRunner).toBe(await realpath(runner));
      expect(dirname(await realpath(workspace.root))).toBe(canonicalRunner);
      expect(await realpath(workspace.bin)).toBe(
        join(await realpath(workspace.root), "bin"),
      );
      await expect(lstat(workspace.stage)).rejects.toThrow();
      // A symlink at RUNNER_TEMP itself is still refused.
      await expect(freshWorkspace(alias)).rejects.toThrow("real directory");
    }));

  test("invalid/symlink runner temp cannot redirect writes", async () =>
    temporary(async (root) => {
      await writeFile(join(root, "file"), "keep");
      const redirect = join(root, "redirect");
      await symlink(
        root,
        redirect,
        process.platform === "win32" ? "junction" : "dir",
      );
      for (const path of [
        "",
        "relative/path",
        `${root}\nextra`,
        join(root, "file"),
        redirect,
      ])
        await expect(freshWorkspace(path)).rejects.toThrow();
      expect(await readFile(join(root, "file"), "utf8")).toBe("keep");
    }));

  test("exclusive synthetic file copy retains bytes and executable mode without running it", async () =>
    temporary(async (root) => {
      const source = join(root, "specimen");
      const target = join(root, "copy");
      await writeFile(source, specimen, { mode: 0o600 });
      await installRegularBinary(source, target);
      expect(await readFile(target)).toEqual(Buffer.from(specimen));
      if (process.platform !== "win32")
        expect((await lstat(target)).mode & 0o777).toBe(0o755);
      await expect(installRegularBinary(source, target)).rejects.toThrow();
      expect(await readFile(target)).toEqual(Buffer.from(specimen));
    }));

  test("nonregular, empty, hardlinked or oversized extraction is refused without destination creation", async () =>
    temporary(async (root) => {
      const source = join(root, "source");
      const empty = join(root, "empty");
      const directory = join(root, "directory");
      const linked = join(root, "hardlink");
      const oversized = join(root, "oversized");
      await writeFile(source, specimen);
      await writeFile(empty, "");
      await mkdir(directory);
      await link(source, linked);
      await writeFile(oversized, "");
      await truncate(oversized, 32 * 1024 * 1024 + 1);
      for (const path of [directory, empty, source, linked, oversized]) {
        const target = join(root, "not-created");
        await expect(installRegularBinary(path, target)).rejects.toThrow(
          "regular file",
        );
        await expect(lstat(target)).rejects.toThrow();
      }
    }));

  test("publication preserves command file contents and exports precisely the absent stage child", async () =>
    temporary(async (root) => {
      const pathFile = join(root, "path");
      const outputFile = join(root, "output");
      await writeFile(pathFile, "existing-bin\n");
      await writeFile(outputFile, "existing_output=value\n");
      const workspace = await freshWorkspace(root);
      await publishWorkspace(workspace, pathFile, outputFile);
      expect(await readFile(pathFile, "utf8")).toBe(
        `existing-bin\n${workspace.bin}\n`,
      );
      expect(await readFile(outputFile, "utf8")).toBe(
        `existing_output=value\nstage_path=${workspace.stage}\n`,
      );
      await expect(lstat(workspace.stage)).rejects.toThrow();
    }));

  test("command-file controls/symlink/nonfile cannot redirect publication", async () =>
    temporary(async (root) => {
      const pathFile = join(root, "path");
      await writeFile(pathFile, "keep\n");
      const directory = join(root, "dir");
      await mkdir(directory);
      const redirect = join(root, "redirect");
      await symlink(
        directory,
        redirect,
        process.platform === "win32" ? "junction" : "dir",
      );
      for (const path of [
        undefined,
        "relative",
        `${pathFile}\nextra`,
        directory,
        redirect,
      ])
        await expect(
          validateCommandFile(path, "GITHUB_PATH"),
        ).rejects.toThrow();
      const workspace = await freshWorkspace(root);
      await expect(
        publishWorkspace(workspace, pathFile, directory),
      ).rejects.toThrow();
      expect(await readFile(pathFile, "utf8")).toBe("keep\n");
    }));
});
