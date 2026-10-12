/** Read-only binary inspection plus a fresh JSON receipt. Never builds/runs a
 * helper. Required missing inputs fail; old reference files are not overwritten.
 * Use: rtk proxy bun .../generate-reference.ts --out FRESH_JSON_PATH */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readBinaryDependencies } from "../../packaging/binary-deps";
import {
  canonicalDirectory,
  freshDestination,
  readRegular,
} from "../../packaging/files";
import { currentPlatform, loadContract } from "../../packaging/stage";

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--out")
    throw new Error("Usage: generate-reference.ts --out FRESH_JSON_PATH");
  const out = await freshDestination(process.argv[3]);
  const root = await canonicalDirectory(resolve(import.meta.dir, "../.."));
  const release = await canonicalDirectory(join(root, "target/release"));
  const platform = currentPlatform();
  const contract = await loadContract();
  const format = { linux: "elf", macos: "macho", windows: "pe" }[platform];
  const describe = (bytes: Buffer, mode: number) => ({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mode,
  });
  const binaries: Record<string, unknown> = {};
  for (const spec of contract.executables) {
    const name =
      platform === "windows" ? `${spec.targetName}.exe` : spec.targetName;
    let input;
    try {
      input = await readRegular(release, name);
    } catch (error) {
      if (
        !spec.required &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        binaries[spec.id] = { present: false, required: false };
        continue;
      }
      throw error;
    }
    const dependencies = readBinaryDependencies(input.bytes);
    if (dependencies.format !== format || !dependencies.architecture)
      throw new Error(`Unrecognized ${platform} release binary: ${name}`);
    binaries[spec.id] = {
      present: true,
      ...describe(input.bytes, input.mode),
      dependencies,
    };
  }
  const assets: Record<string, unknown> = {};
  const files = new Set([
    ...contract.notices.files,
    ...contract.platformMetadata[platform].map((entry) => entry.source),
    ...contract.icons[platform].map((entry) => entry.source),
  ]);
  for (const relative of [...files].sort()) {
    const input = await readRegular(root, relative);
    assets[relative] = describe(input.bytes, input.mode);
  }
  const reference = {
    schemaVersion: 2,
    generator: "desktop/gpui/fixtures/distribution/generate-reference.ts",
    platform,
    scope:
      "Header/hash inspection of all declared host release executables and explicit metadata/notice inputs, not staging/runtime/install/signing proof. Glob completeness is checked by stage/verify separately.",
    binaries,
    assets,
  };
  await writeFile(out, JSON.stringify(reference, null, 2) + "\n", {
    flag: "wx",
    mode: 0o644,
  });
  console.log("Wrote fresh binary-header/hash receipt; no executable was run.");
}
if (import.meta.main) await main();
