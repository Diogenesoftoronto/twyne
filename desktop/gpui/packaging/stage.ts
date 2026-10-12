/** Offline integrity staging. Never removes/replaces an existing destination.
 * Declared inputs are validated before exclusive output creation; an I/O failure
 * leaves our incomplete new directory for review. No executable is run.
 * macOS/Windows metadata is scaffold data, not an assembled/installed bundle. */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { readBinaryDependencies, type BinaryDependencies } from "./binary-deps";
import {
  canonicalDirectory,
  checkedChild,
  freshDestination,
  PackagingPathError,
  readRegular,
  readRegularPath,
  safeName,
  safeRelative,
} from "./files";

const GPUI_ROOT = resolve(import.meta.dir, "..");
const REPOSITORY_ROOT = resolve(GPUI_ROOT, "../..");
const CONTRACT_PATH = join(import.meta.dir, "twyne-packaging.json");
const MANIFEST_NAME = "distribution-manifest.json";
const MANIFEST_LIMIT = 8 * 1024 * 1024;
const FILE_LIMIT = 10_000;
export type Platform = "linux" | "macos" | "windows";
export interface ExecutableSpec {
  id: string;
  cargoBinary: string;
  targetName: string;
  required: boolean;
  wired: boolean;
  role: string;
  windowsExtension?: string;
  discovery?: string;
  wiringNote?: string;
}
export interface PathMapping {
  source: string;
  target: string;
}
export interface Contract {
  schemaVersion: number;
  identifiers: Record<string, string>;
  executables: ExecutableSpec[];
  notices: { files: string[]; globs: string[] };
  platformMetadata: Record<Platform, PathMapping[]>;
  icons: Record<Platform, PathMapping[]>;
  fileAssociations: { extension: string; mime: string; description: string }[];
  launch: Record<string, unknown>;
  versions: Record<string, string>;
}
export interface StagedFile {
  path: string;
  bytes: number;
  sha256: string;
  mode: number;
  /** Logical declared input root, not a host path. */ source: string;
  kind: "executable" | "metadata" | "icon" | "notice";
}
export interface StagedExecutable {
  id: string;
  path: string;
  targetName: string;
  required: boolean;
  sha256: string;
  bytes: number;
  mode: number;
  dependencies: BinaryDependencies;
}
export interface DistributionManifest {
  schemaVersion: 2;
  generator: "desktop/gpui/packaging/stage.ts";
  contractSha256: string;
  layout: "flat-executables-and-metadata";
  bundleStatus: "not-assembled";
  platform: Platform;
  product: "Twyne";
  appId: string;
  nativeCrateVersion: string;
  productVersion: string;
  versionMismatch: boolean;
  executables: StagedExecutable[];
  files: StagedFile[];
}
export interface VerifyIssue {
  code:
    | "missing-executable"
    | "unexpected-target-name"
    | "hash-mismatch"
    | "missing-notice"
    | "missing-metadata"
    | "byte-count-mismatch"
    | "unexpected-file"
    | "invalid-manifest"
    | "unsafe-path"
    | "unsafe-file"
    | "size-limit"
    | "mode-mismatch"
    | "binary-format"
    | "dependency-mismatch"
    | "contract-mismatch";
  detail: string;
  path?: string;
}
export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
}
interface Inputs {
  contractPath?: string;
  sourceRoot?: string;
}
export interface StageOptions extends Inputs {
  platform: Platform;
  releaseDir: string;
  /** Must not exist; parent must be a real existing dir. */ outDir: string;
  productVersion?: string;
  nativeCrateVersion?: string;
}
interface Plan {
  file: StagedFile;
  bytes: Buffer;
  executable?: StagedExecutable;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function platform(value: unknown): asserts value is Platform {
  assert(
    ["linux", "macos", "windows"].includes(value as string),
    "Unknown packaging platform.",
  );
}
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
export function currentPlatform(): Platform {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  throw new Error("Unsupported packaging host.");
}
function executableName(spec: ExecutableSpec, target: Platform): string {
  return safeName(
    target === "windows" ? `${spec.targetName}.exe` : spec.targetName,
  );
}
function parseGlob(pattern: unknown): {
  directory: string;
  prefix: string;
  suffix: string;
} {
  assert(
    typeof pattern === "string" && pattern.split("*").length === 2,
    "Notice globs require one filename wildcard.",
  );
  const directory = safeRelative(posix.dirname(pattern));
  const [prefix, suffix] = posix.basename(pattern).split("*");
  safeName(`${prefix}wildcard${suffix}`);
  return { directory, prefix, suffix };
}
function validateContract(value: unknown): asserts value is Contract {
  assert(
    object(value) &&
      value.schemaVersion === 2 &&
      object(value.identifiers) &&
      text(value.identifiers.appId),
    "Unsupported packaging contract.",
  );
  assert(
    Array.isArray(value.executables) &&
      value.executables.length > 0 &&
      value.executables.length < 100,
    "Invalid executable contract.",
  );
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const spec of value.executables) {
    assert(
      object(spec) &&
        text(spec.id) &&
        text(spec.cargoBinary) &&
        typeof spec.required === "boolean" &&
        typeof spec.wired === "boolean",
      "Invalid executable specification.",
    );
    const name = safeName(spec.targetName);
    assert(
      !ids.has(spec.id) && !names.has(name),
      "Duplicate executable identity/name.",
    );
    ids.add(spec.id);
    names.add(name);
  }
  assert(
    object(value.notices) &&
      Array.isArray(value.notices.files) &&
      value.notices.files.length > 0 &&
      Array.isArray(value.notices.globs),
    "Required notices are undeclared.",
  );
  for (const file of value.notices.files) safeRelative(file);
  for (const pattern of value.notices.globs) parseGlob(pattern);
  assert(
    object(value.platformMetadata) && object(value.icons),
    "Invalid platform mappings.",
  );
  for (const target of ["linux", "macos", "windows"] as const) {
    const metadata = value.platformMetadata[target];
    const icons = value.icons[target];
    assert(
      Array.isArray(metadata) && Array.isArray(icons),
      "Missing platform mappings.",
    );
    for (const mapping of [...metadata, ...icons]) {
      assert(object(mapping), "Invalid platform mapping.");
      safeRelative(mapping.source);
      safeRelative(mapping.target);
      assert(mapping.target !== MANIFEST_NAME, "Reserved mapping target.");
    }
  }
  assert(
    Array.isArray(value.fileAssociations) &&
      object(value.launch) &&
      object(value.versions),
    "Invalid packaging metadata.",
  );
}
async function contractData(
  path = CONTRACT_PATH,
): Promise<{ value: Contract; sha256: string }> {
  const { bytes } = await readRegularPath(path, MANIFEST_LIMIT);
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  validateContract(value);
  return { value, sha256: digest(bytes) };
}
export async function loadContract(path = CONTRACT_PATH): Promise<Contract> {
  return (await contractData(path)).value;
}
async function requiredNotices(
  root: string,
  contract: Contract,
): Promise<string[]> {
  const found = new Set(contract.notices.files.map(safeRelative));
  for (const pattern of contract.notices.globs) {
    const { directory, prefix, suffix } = parseGlob(pattern);
    const absolute = await checkedChild(root, directory, "directory");
    const entries = (await readdir(absolute)).sort();
    assert(entries.length <= FILE_LIMIT, "Notice inventory limit exceeded.");
    const matches = entries.filter(
      (name) => name.startsWith(prefix) && name.endsWith(suffix),
    );
    assert(
      matches.length > 0,
      `Required notice glob has no matches: ${pattern}`,
    );
    for (const name of matches)
      found.add(safeRelative(posix.join(directory, safeName(name))));
  }
  assert(found.size <= FILE_LIMIT, "Notice inventory limit exceeded.");
  return [...found].sort();
}
function mappings(
  contract: Contract,
  target: Platform,
  notices: string[],
): { mapping: PathMapping; kind: StagedFile["kind"] }[] {
  return [
    ...notices.map((source) => ({
      mapping: { source, target: `share/doc/twyne/${source}` },
      kind: "notice" as const,
    })),
    ...contract.platformMetadata[target].map((mapping) => ({
      mapping,
      kind: "metadata" as const,
    })),
    ...contract.icons[target].map((mapping) => ({
      mapping,
      kind: "icon" as const,
    })),
  ];
}
function dependenciesFor(
  bytes: Uint8Array,
  target: Platform,
): BinaryDependencies {
  const result = readBinaryDependencies(bytes);
  const wanted = { linux: "elf", macos: "macho", windows: "pe" }[target];
  assert(
    result.format === wanted && result.architecture !== null,
    `Expected a recognized ${wanted} executable for ${target}; this is not runtime proof.`,
  );
  return result;
}
async function versions(
  options: StageOptions,
): Promise<{ productVersion: string; nativeCrateVersion: string }> {
  const productVersion =
    options.productVersion ??
    JSON.parse(
      (
        await readRegularPath(
          join(REPOSITORY_ROOT, "package.json"),
          MANIFEST_LIMIT,
        )
      ).bytes.toString("utf8"),
    ).version;
  const nativeCrateVersion =
    options.nativeCrateVersion ??
    (await readRegularPath(join(GPUI_ROOT, "Cargo.toml"), MANIFEST_LIMIT)).bytes
      .toString("utf8")
      .match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert(
    text(productVersion) && text(nativeCrateVersion),
    "Missing concrete product/native versions.",
  );
  return { productVersion, nativeCrateVersion };
}
export async function stage(
  options: StageOptions,
): Promise<DistributionManifest> {
  platform(options.platform);
  const destination = await freshDestination(options.outDir);
  const root = await canonicalDirectory(options.sourceRoot ?? GPUI_ROOT);
  const release = await canonicalDirectory(options.releaseDir);
  assert(
    destination !== release &&
      !destination.startsWith(`${release}/`) &&
      !destination.startsWith(`${release}\\`),
    "Output cannot be inside its release input.",
  );
  const contract = await contractData(options.contractPath);
  const version = await versions(options);
  const plan: Plan[] = [];
  const targets = new Set([MANIFEST_NAME]);
  const add = (
    target: string,
    source: string,
    kind: StagedFile["kind"],
    input: { bytes: Buffer; mode: number },
  ): StagedFile => {
    const path = safeRelative(target);
    const folded = path.toLowerCase();
    assert(
      ![...targets].some(
        (other) =>
          folded === other ||
          folded.startsWith(`${other}/`) ||
          other.startsWith(`${folded}/`),
      ),
      `Duplicate target or file/directory collision: ${path}`,
    );
    targets.add(folded);
    assert(input.bytes.length > 0, `Required input is empty: ${source}`);
    const file: StagedFile = {
      path,
      source,
      kind,
      bytes: input.bytes.length,
      sha256: digest(input.bytes),
      mode: input.mode,
    };
    plan.push({ file, bytes: input.bytes });
    return file;
  };
  for (const spec of contract.value.executables) {
    const name = executableName(spec, options.platform);
    let input;
    try {
      input = await readRegular(release, name);
    } catch (error) {
      if (!spec.required && (error as NodeJS.ErrnoException).code === "ENOENT")
        continue;
      throw new Error(
        `Required or unsafe executable ${spec.id} (${name}) could not be staged.`,
        { cause: error },
      );
    }
    if (options.platform !== "windows") {
      assert(
        process.platform !== "win32",
        "POSIX mode preservation requires a POSIX host.",
      );
      assert(
        (input.mode & 0o111) !== 0,
        `POSIX executable ${name} has no executable permission.`,
      );
    }
    const dependencies = dependenciesFor(input.bytes, options.platform);
    const file = add(name, `release/${name}`, "executable", input);
    plan[plan.length - 1].executable = {
      id: spec.id,
      path: file.path,
      targetName: name,
      required: spec.required,
      sha256: file.sha256,
      bytes: file.bytes,
      mode: file.mode,
      dependencies,
    };
  }
  for (const { mapping, kind } of mappings(
    contract.value,
    options.platform,
    await requiredNotices(root, contract.value),
  ))
    add(
      mapping.target,
      `gpui/${mapping.source}`,
      kind,
      await readRegular(root, mapping.source),
    );
  assert(plan.length <= FILE_LIMIT, "Distribution inventory limit exceeded.");
  const manifest: DistributionManifest = {
    schemaVersion: 2,
    generator: "desktop/gpui/packaging/stage.ts",
    contractSha256: contract.sha256,
    layout: "flat-executables-and-metadata",
    bundleStatus: "not-assembled",
    platform: options.platform,
    product: "Twyne",
    appId: contract.value.identifiers.appId,
    ...version,
    versionMismatch: version.nativeCrateVersion !== version.productVersion,
    executables: plan.flatMap((item) =>
      item.executable ? [item.executable] : [],
    ),
    files: plan
      .map((item) => item.file)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  assert(bytes.length <= MANIFEST_LIMIT, "Manifest size limit exceeded.");
  // Exclusive reservation; never rm/rename over any existing or raced-in path.
  await mkdir(destination);
  for (const item of plan) {
    const path = join(destination, item.file.path);
    await mkdir(dirname(path), { recursive: true });
    const parent = posix.dirname(item.file.path);
    if (parent !== ".") await checkedChild(destination, parent, "directory");
    await writeFile(path, item.bytes, { flag: "wx", mode: item.file.mode });
    if (process.platform !== "win32") await chmod(path, item.file.mode);
  }
  await writeFile(join(destination, MANIFEST_NAME), bytes, {
    flag: "wx",
    mode: 0o644,
  });
  return manifest;
}
function validateDigest(file: Record<string, unknown>): void {
  assert(
    typeof file.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(file.sha256) &&
      Number.isSafeInteger(file.bytes) &&
      (file.bytes as number) > 0 &&
      (file.bytes as number) <= 1024 * 1024 * 1024 &&
      Number.isInteger(file.mode) &&
      (file.mode as number) >= 0 &&
      (file.mode as number) <= 0o777,
    "Invalid file digest/size/mode.",
  );
}
function validateManifest(
  value: unknown,
): asserts value is DistributionManifest {
  assert(
    object(value) &&
      value.schemaVersion === 2 &&
      value.generator === "desktop/gpui/packaging/stage.ts" &&
      value.layout === "flat-executables-and-metadata" &&
      value.bundleStatus === "not-assembled",
    "Unsupported or overstated manifest.",
  );
  platform(value.platform);
  assert(
    value.product === "Twyne" &&
      text(value.appId) &&
      text(value.productVersion) &&
      text(value.nativeCrateVersion) &&
      value.versionMismatch ===
        (value.productVersion !== value.nativeCrateVersion),
    "Invalid product/version metadata.",
  );
  assert(
    typeof value.contractSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(value.contractSha256),
    "Missing contract digest.",
  );
  assert(
    Array.isArray(value.files) &&
      Array.isArray(value.executables) &&
      value.files.length <= FILE_LIMIT &&
      value.executables.length < 100,
    "Invalid inventory.",
  );
  const paths = new Set([MANIFEST_NAME]);
  const ids = new Set<string>();
  const executablePaths = new Set<string>();
  for (const file of value.files) {
    assert(object(file), "Invalid file record.");
    const path = safeRelative(file.path).toLowerCase();
    safeRelative(file.source);
    assert(
      ![...paths].some(
        (other) =>
          path === other ||
          path.startsWith(`${other}/`) ||
          other.startsWith(`${path}/`),
      ),
      "Duplicate/reserved file path or file/directory collision.",
    );
    paths.add(path);
    assert(
      ["executable", "metadata", "icon", "notice"].includes(
        file.kind as string,
      ),
      "Invalid file kind.",
    );
    validateDigest(file);
  }
  for (const executable of value.executables) {
    assert(
      object(executable) &&
        text(executable.id) &&
        typeof executable.required === "boolean",
      "Invalid executable record.",
    );
    safeRelative(executable.path);
    safeName(executable.targetName);
    assert(
      !ids.has(executable.id) &&
        !executablePaths.has(executable.path as string),
      "Duplicate executable record.",
    );
    ids.add(executable.id);
    executablePaths.add(executable.path as string);
    validateDigest(executable);
    const dep = executable.dependencies;
    assert(
      object(dep) &&
        ["elf", "macho", "pe"].includes(dep.format as string) &&
        text(dep.architecture) &&
        (dep.interpreter === null || text(dep.interpreter)) &&
        Array.isArray(dep.libraries) &&
        dep.libraries.every(text) &&
        Array.isArray(dep.runpaths) &&
        dep.runpaths.every(text),
      "Invalid loader metadata.",
    );
  }
}
function sameDependencies(
  a: BinaryDependencies,
  b: BinaryDependencies,
): boolean {
  return (
    a.format === b.format &&
    a.architecture === b.architecture &&
    a.interpreter === b.interpreter &&
    JSON.stringify(a.libraries) === JSON.stringify(b.libraries) &&
    JSON.stringify(a.runpaths) === JSON.stringify(b.runpaths)
  );
}
export async function verify(
  outDir: string,
  options: Inputs & { manifest?: DistributionManifest } = {},
): Promise<VerifyResult> {
  const issues: VerifyIssue[] = [];
  const issue = (code: VerifyIssue["code"], detail: string, path?: string) =>
    issues.push({ code, detail, ...(path === undefined ? {} : { path }) });
  let root: string;
  let manifest: DistributionManifest;
  let contract: Awaited<ReturnType<typeof contractData>>;
  try {
    root = await canonicalDirectory(outDir);
    const input = await readRegular(root, MANIFEST_NAME, MANIFEST_LIMIT);
    const candidate: unknown =
      options.manifest ?? JSON.parse(input.bytes.toString("utf8"));
    validateManifest(candidate);
    manifest = candidate;
    contract = await contractData(options.contractPath);
  } catch (error) {
    issue(
      error instanceof PackagingPathError ? error.code : "invalid-manifest",
      (error as Error).message,
    );
    return { ok: false, issues };
  }
  if (
    manifest.contractSha256 !== contract.sha256 ||
    manifest.appId !== contract.value.identifiers.appId
  )
    issue(
      "contract-mismatch",
      "This exact packaging contract does not match the staged tree.",
    );
  const expected = new Map<
    string,
    { kind: StagedFile["kind"]; source: string }
  >();
  const ids = new Set<string>();
  for (const executable of manifest.executables) {
    const spec = contract.value.executables.find(
      (candidate) => candidate.id === executable.id,
    );
    if (!spec) {
      issue(
        "unexpected-target-name",
        "Unknown executable identity.",
        executable.path,
      );
      continue;
    }
    ids.add(spec.id);
    const name = executableName(spec, manifest.platform);
    expected.set(name, { kind: "executable", source: `release/${name}` });
    if (
      executable.path !== name ||
      executable.targetName !== name ||
      executable.required !== spec.required
    )
      issue(
        "unexpected-target-name",
        `Executable ${spec.id} must be staged at ${name}.`,
        executable.path,
      );
    const file = manifest.files.find(
      (candidate) => candidate.path === executable.path,
    );
    if (
      !file ||
      file.kind !== "executable" ||
      file.sha256 !== executable.sha256 ||
      file.bytes !== executable.bytes ||
      file.mode !== executable.mode
    )
      issue(
        "invalid-manifest",
        "Executable/file inventories disagree.",
        executable.path,
      );
  }
  for (const spec of contract.value.executables.filter(
    (candidate) => candidate.required,
  )) {
    const name = executableName(spec, manifest.platform);
    expected.set(name, { kind: "executable", source: `release/${name}` });
    if (!ids.has(spec.id))
      issue(
        "missing-executable",
        `Required executable ${spec.id} is absent.`,
        name,
      );
  }
  try {
    const sourceRoot = await canonicalDirectory(
      options.sourceRoot ?? GPUI_ROOT,
    );
    for (const { mapping, kind } of mappings(
      contract.value,
      manifest.platform,
      await requiredNotices(sourceRoot, contract.value),
    )) {
      if (expected.has(mapping.target)) {
        issue("invalid-manifest", "Contract mappings collide.", mapping.target);
        continue;
      }
      expected.set(mapping.target, { kind, source: `gpui/${mapping.source}` });
      const file = manifest.files.find(
        (entry) =>
          entry.path === mapping.target &&
          entry.kind === kind &&
          entry.source === `gpui/${mapping.source}`,
      );
      if (!file) {
        issue(
          kind === "notice" ? "missing-notice" : "missing-metadata",
          "Required original input is absent from inventory.",
          mapping.target,
        );
        continue;
      }
      try {
        const original = await readRegular(sourceRoot, mapping.source);
        if (
          file.sha256 !== digest(original.bytes) ||
          file.bytes !== original.bytes.length
        )
          issue(
            "hash-mismatch",
            "Declared notice/metadata/icon differs from original source bytes.",
            file.path,
          );
      } catch (error) {
        issue(
          kind === "notice" ? "missing-notice" : "missing-metadata",
          `Original input could not be read: ${(error as Error).message}`,
          mapping.target,
        );
      }
    }
  } catch (error) {
    issue(
      "missing-notice",
      `Required notice inventory could not be established: ${(error as Error).message}`,
    );
  }
  for (const file of manifest.files) {
    const requirement = expected.get(file.path);
    if (
      !requirement ||
      requirement.kind !== file.kind ||
      requirement.source !== file.source
    )
      issue(
        "unexpected-file",
        "File is not a declared input/target mapping.",
        file.path,
      );
    try {
      const input = await readRegular(root, file.path);
      if (digest(input.bytes) !== file.sha256)
        issue("hash-mismatch", "Staged bytes differ from manifest.", file.path);
      if (input.bytes.length !== file.bytes)
        issue(
          "byte-count-mismatch",
          "Staged size differs from manifest.",
          file.path,
        );
      if (process.platform !== "win32" && input.mode !== file.mode)
        issue(
          "mode-mismatch",
          "Staged POSIX permissions differ from source.",
          file.path,
        );
      if (file.kind === "executable") {
        const executable = manifest.executables.find(
          (entry) => entry.path === file.path,
        );
        if (!executable)
          issue(
            "invalid-manifest",
            "Executable file lacks an identity record.",
            file.path,
          );
        else {
          if (
            manifest.platform !== "windows" &&
            ((input.mode & 0o111) === 0 || (file.mode & 0o111) === 0)
          )
            issue(
              "mode-mismatch",
              "POSIX executable permission is absent.",
              file.path,
            );
          try {
            if (
              !sameDependencies(
                dependenciesFor(input.bytes, manifest.platform),
                executable.dependencies,
              )
            )
              issue(
                "dependency-mismatch",
                "Loader metadata differs from staged bytes.",
                file.path,
              );
          } catch (error) {
            issue("binary-format", (error as Error).message, file.path);
          }
        }
      }
    } catch (error) {
      issue(
        error instanceof PackagingPathError
          ? error.code
          : file.kind === "executable"
            ? "missing-executable"
            : file.kind === "notice"
              ? "missing-notice"
              : "missing-metadata",
        `Entry could not be safely read: ${(error as Error).message}`,
        file.path,
      );
    }
  }
  const allowed = new Set([
    MANIFEST_NAME,
    ...manifest.files.map((file) => file.path),
  ]);
  const directories = new Set<string>();
  for (const path of allowed) {
    let parent = posix.dirname(path);
    while (parent !== ".") {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
  }
  let seen = 0;
  const walk = async (prefix = "", depth = 0): Promise<void> => {
    assert(depth <= 32, "Distribution tree depth limit exceeded.");
    const directory = prefix
      ? await checkedChild(root, prefix, "directory")
      : root;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert(
        ++seen <= FILE_LIMIT * 2,
        "Distribution inventory limit exceeded.",
      );
      let path: string;
      try {
        path = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
      } catch (error) {
        issue("unsafe-path", (error as Error).message);
        continue;
      }
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        issue(
          "unsafe-file",
          "Symlinks/special files are invalid distribution entries.",
          path,
        );
        continue;
      }
      if (info.isDirectory()) {
        if (!directories.has(path))
          issue("unexpected-file", "Unexpected directory.", path);
        await walk(path, depth + 1);
      } else if (!allowed.has(path))
        issue("unexpected-file", "Unexpected file.", path);
    }
  };
  try {
    await walk();
  } catch (error) {
    issue(
      error instanceof PackagingPathError ? error.code : "unsafe-file",
      (error as Error).message,
    );
  }
  return { ok: issues.length === 0, issues };
}
if (import.meta.main) {
  const [command, ...argv] = process.argv.slice(2);
  assert(
    command === "stage" || command === "verify",
    "Usage: stage.ts <stage|verify> [--platform linux|macos|windows] [--release PATH] [--out FRESH_PATH]",
  );
  let target = currentPlatform();
  let releaseDir = join(GPUI_ROOT, "target/release");
  let outDir = join(GPUI_ROOT, "target/distribution");
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert(
      value && ["--platform", "--release", "--out"].includes(flag),
      "Unknown/incomplete argument.",
    );
    if (flag === "--platform") {
      platform(value);
      target = value;
    } else if (flag === "--release") releaseDir = resolve(value);
    else outDir = resolve(value);
  }
  if (command === "stage") {
    const manifest = await stage({ platform: target, releaseDir, outDir });
    console.log(
      `Staged ${manifest.files.length} files for ${target}; flat tree, OS bundle not assembled.`,
    );
  } else {
    const result = await verify(outDir);
    for (const issue of result.issues)
      console.error(`[${issue.code}] ${issue.path ?? ""}: ${issue.detail}`);
    if (!result.ok) process.exitCode = 1;
    else
      console.log(
        "Distribution integrity passed; runtime/install/bundle/signing remain unproved.",
      );
  }
}
