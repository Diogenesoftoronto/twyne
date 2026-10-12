/** Future CI bootstrap only. Importing this module performs no I/O or network. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import release from "./rtk-release.json";

export interface ArchiveSpec {
  archive: string;
  sha256: string;
  bytes: number;
  binary: "rtk" | "rtk.exe";
  url: string;
}

export interface Workspace {
  root: string;
  bin: string;
  extraction: string;
  stage: string;
}

const PLATFORM_KEYS = [
  "Linux-X64",
  "Linux-ARM64",
  "macOS-X64",
  "macOS-ARM64",
  "Windows-X64",
] as const;
const MAX_BINARY_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function selectedArchive(os: string, arch: string): ArchiveSpec {
  const key = `${os}-${arch}`;
  if (!PLATFORM_KEYS.some((allowed) => key === allowed)) {
    throw new Error(`Unsupported runner: ${key}`);
  }
  const spec = release.assets[key as keyof typeof release.assets];
  const windows = os === "Windows";
  if (
    release.version !== "v0.36.0" ||
    !/^[a-f0-9]{64}$/.test(spec.sha256) ||
    !Number.isSafeInteger(spec.bytes) ||
    spec.bytes <= 0 ||
    spec.bytes > MAX_ARCHIVE_BYTES ||
    spec.binary !== (windows ? "rtk.exe" : "rtk") ||
    !/^rtk-[a-z0-9_-]+\.(?:tar\.gz|zip)$/.test(spec.archive) ||
    windows !== spec.archive.endsWith(".zip") ||
    spec.url !==
      `https://github.com/rtk-ai/rtk/releases/download/${release.version}/${spec.archive}`
  ) {
    throw new Error(`Invalid embedded RTK release pin: ${key}`);
  }
  return Object.freeze({ ...spec }) as ArchiveSpec;
}

export function assertHost(os: string, arch: string): void {
  const actualOs = {
    linux: "Linux",
    darwin: "macOS",
    win32: "Windows",
  }[process.platform as "linux" | "darwin" | "win32"];
  const actualArch = { x64: "X64", arm64: "ARM64" }[
    process.arch as "x64" | "arm64"
  ];
  if (os !== actualOs || arch !== actualArch) {
    throw new Error(
      "Runner OS/architecture does not match the bootstrap host.",
    );
  }
}

export function verifyArchiveBytes(bytes: Uint8Array, spec: ArchiveSpec): void {
  if (bytes.byteLength !== spec.bytes) {
    throw new Error("RTK archive size differs from the embedded release pin.");
  }
  if (sha256(bytes) !== spec.sha256) {
    throw new Error(
      "RTK archive SHA-256 differs from the embedded release pin.",
    );
  }
}

/** A root binary is the exact layout produced by upstream release.yml. */
export function verifyArchiveListing(listing: string, binary: string): void {
  const normalized = listing.replace(/\r\n/g, "\n");
  const entries = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  if (entries.length !== 1 || entries[0] !== binary) {
    throw new Error(
      "RTK archive must contain exactly the expected root binary.",
    );
  }
}

function absoluteCommandPath(value: string | undefined, name: string): string {
  if (!value || !isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(
      `${name} must be an absolute path without control characters.`,
    );
  }
  return value;
}

export async function freshWorkspace(runnerTemp: string): Promise<Workspace> {
  const path = absoluteCommandPath(runnerTemp, "RUNNER_TEMP");
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("RUNNER_TEMP must be an existing real directory.");
  }
  const root = await mkdtemp(join(await realpath(path), "twyne-ci-"));
  await chmod(root, 0o700);
  const bin = join(root, "bin");
  const extraction = join(root, "extract");
  await mkdir(bin, { mode: 0o700 });
  await mkdir(extraction, { mode: 0o700 });
  // Do not create this child: stage.ts rejects every existing destination.
  return { root, bin, extraction, stage: join(root, "distribution") };
}

export async function installRegularBinary(
  source: string,
  destination: string,
): Promise<void> {
  const stat = await lstat(source);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size <= 0 ||
    stat.size > MAX_BINARY_BYTES
  ) {
    throw new Error("Extracted RTK binary must be one bounded regular file.");
  }
  // Destination is inside our fresh workspace; never overwrite another binary.
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(destination, 0o755);
}

export async function validateCommandFile(
  value: string | undefined,
  name: string,
): Promise<string> {
  const path = absoluteCommandPath(value, name);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${name} must be an existing regular command file.`);
  }
  return path;
}

export async function publishWorkspace(
  workspace: Workspace,
  githubPath: string,
  githubOutput: string,
): Promise<void> {
  for (const value of [workspace.bin, workspace.stage]) {
    absoluteCommandPath(value, "Generated workspace path");
  }
  await validateCommandFile(githubPath, "GITHUB_PATH");
  await validateCommandFile(githubOutput, "GITHUB_OUTPUT");
  await appendFile(githubPath, `${workspace.bin}\n`, "utf8");
  await appendFile(githubOutput, `stage_path=${workspace.stage}\n`, "utf8");
}

export async function readBoundedResponse(
  response: Response,
  expectedBytes: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > MAX_ARCHIVE_BYTES
  ) {
    await response.body?.cancel();
    throw new Error("Invalid RTK download byte bound.");
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`RTK archive download failed (HTTP ${response.status}).`);
  }
  const length = response.headers.get("content-length");
  if (length !== null && length !== String(expectedBytes)) {
    await response.body.cancel();
    throw new Error(
      "RTK download Content-Length differs from the release pin.",
    );
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedBytes) {
        throw new Error("RTK download exceeded the embedded byte bound.");
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== expectedBytes)
      throw new Error("RTK download was truncated.");
    return bytes;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function archiveTool(os: string): string {
  if (os !== "Windows") return "tar";
  return join(
    absoluteCommandPath(process.env.SystemRoot, "SystemRoot"),
    "System32",
    "tar.exe",
  );
}

function checkedTar(tool: string, args: string[]): string {
  const result = spawnSync(tool, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error("RTK archive listing/extraction failed.");
  }
  return result.stdout;
}

async function main(): Promise<void> {
  const os = process.env.RUNNER_OS ?? "";
  const arch = process.env.RUNNER_ARCH ?? "";
  const spec = selectedArchive(os, arch);
  assertHost(os, arch);
  const githubPath = await validateCommandFile(
    process.env.GITHUB_PATH,
    "GITHUB_PATH",
  );
  const githubOutput = await validateCommandFile(
    process.env.GITHUB_OUTPUT,
    "GITHUB_OUTPUT",
  );
  const tool = archiveTool(os);
  const workspace = await freshWorkspace(process.env.RUNNER_TEMP ?? "");
  const response = await fetch(spec.url, {
    signal: AbortSignal.timeout(60_000),
  });
  const bytes = await readBoundedResponse(response, spec.bytes);
  verifyArchiveBytes(bytes, spec);
  const archive = join(workspace.root, spec.archive);
  await writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
  verifyArchiveListing(checkedTar(tool, ["-tf", archive]), spec.binary);
  checkedTar(tool, ["-xf", archive, "-C", workspace.extraction, spec.binary]);
  await installRegularBinary(
    join(workspace.extraction, spec.binary),
    join(workspace.bin, spec.binary),
  );
  // No --version execution here; subsequent CI commands establish runtime use.
  await publishWorkspace(workspace, githubPath, githubOutput);
  console.log(
    `Verified pinned RTK archive for ${os}-${arch}; fresh stage path exported.`,
  );
}

if (import.meta.main) await main();
