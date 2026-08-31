const manifestPath = new URL("../package.json", import.meta.url);
const manifest = (await Bun.file(manifestPath).json()) as { version?: unknown };
const version = manifest.version;

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message: string): never {
  console.error(`Release check failed: ${message}`);
  process.exit(1);
}

function git(args: string[], allowFailure = false) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!allowFailure && result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    fail(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }

  return result;
}

if (typeof version !== "string" || !semverPattern.test(version)) {
  fail(`package.json has an invalid version: ${String(version)}`);
}

const expectedTag = `v${version}`;
const tagRef = `refs/tags/${expectedTag}`;
const tagType = git(["cat-file", "-t", tagRef], true);

if (tagType.exitCode !== 0) {
  fail(`missing ${expectedTag}; create releases with bun run release:version`);
}

if (tagType.stdout.toString().trim() !== "tag") {
  fail(
    `${expectedTag} is not an annotated tag, so git push --follow-tags will skip it`,
  );
}

const taggedManifestResult = git(["show", `${expectedTag}:package.json`]);
let taggedVersion: unknown;

try {
  taggedVersion = JSON.parse(taggedManifestResult.stdout.toString()).version;
} catch {
  fail(`${expectedTag} does not contain a readable package.json`);
}

if (taggedVersion !== version) {
  fail(
    `${expectedTag} contains package version ${String(taggedVersion)}, expected ${version}`,
  );
}

const tagsAtHead = git(["tag", "--points-at", "HEAD", "--list", "v*"])
  .stdout.toString()
  .split("\n")
  .map((tag) => tag.trim())
  .filter(Boolean);
const unexpectedHeadTags = tagsAtHead.filter((tag) => tag !== expectedTag);

if (unexpectedHeadTags.length > 0) {
  fail(
    `HEAD has version ${version} but is tagged ${unexpectedHeadTags.join(", ")}`,
  );
}

console.log(`Release version ${version} matches annotated tag ${expectedTag}.`);
