import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const name =
  process.platform === "win32" ? "twyne-connected.exe" : "twyne-connected";
const directory = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dir, "../target/release");
await mkdir(directory, { recursive: true });
const child = Bun.spawn(
  [
    process.execPath,
    "build",
    "--compile",
    "--minify",
    resolve(import.meta.dir, "connected/main.ts"),
    "--outfile",
    resolve(directory, name),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await child.exited) throw new Error("The connected helper did not build.");
