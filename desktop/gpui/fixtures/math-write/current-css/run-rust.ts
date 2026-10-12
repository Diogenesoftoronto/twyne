// Cached host compiler/artifacts only. No Cargo, Devenv or dependency changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dir, "../../../../..");
const deps = path.join(root, "desktop/gpui/target/debug/deps");
const rustc =
  process.env.MATH_WRITE_RUSTC ??
  "/home/diogenes/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc";
const version = spawnSync("rtk", ["proxy", rustc, "--version"], {
  encoding: "utf8",
});
if (version.status !== 0) throw new Error("Cached host rustc is unavailable.");
const compiler = version.stdout.trim();
const externs = ["serde", "serde_json", "uuid"].flatMap((name) => {
  const candidate = fs
    .readdirSync(deps)
    .filter((file) => file.startsWith(`lib${name}-`) && file.endsWith(".rlib"))
    .map((file) => path.join(deps, file))
    .filter((file) => fs.readFileSync(file).includes(Buffer.from(compiler)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!candidate)
    throw new Error(`No cached ${name}; no Cargo/install fallback is allowed.`);
  return ["--extern", `${name}=${candidate}`];
});
const scratch = fs.mkdtempSync(
  path.join(os.tmpdir(), "twyne-current-css-rust-"),
);
function run(command: string[]) {
  const result = spawnSync("rtk", ["proxy", ...command], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PATH: `/usr/bin:${process.env.PATH}` },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Direct compiler check failed (${result.status}). MATH_WRITE_RUSTC must match cached artifacts; no Cargo fallback runs.`,
    );
}
try {
  const flags = [
    "--edition=2024",
    "-L",
    `dependency=${deps}`,
    ...externs,
    "-Dwarnings",
  ];
  run([
    rustc,
    ...flags,
    "--crate-type=lib",
    "desktop/gpui/src/math_write.rs",
    "-o",
    path.join(scratch, "math_write.rlib"),
  ]);
  const test = path.join(scratch, "math-write-tests");
  run([
    rustc,
    ...flags,
    "--test",
    "desktop/gpui/src/math_write.rs",
    "-o",
    test,
  ]);
  run([test]);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
