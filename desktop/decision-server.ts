import { spawn, type Subprocess } from "bun";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Starts only the stdlib manager. Dependencies/weights need an explicit download. */
export function startDecisionServer(origin: string): { stop(): void } | null {
  const script = process.env.TWYNE_DECISION_SERVER
    ? resolve(process.env.TWYNE_DECISION_SERVER)
    : [
        resolve(import.meta.dir, "../../app.asar.unpacked/decision/server.py"),
        resolve(import.meta.dir, "../decision/server.py"),
        resolve(
          dirname(process.execPath),
          "../Resources/app.asar.unpacked/decision/server.py",
        ),
        resolve("./decision/server.py"),
        resolve("./desktop/decision/server.py"),
      ].find(existsSync);
  if (!script || !existsSync(script)) return null;
  let child: Subprocess;
  try {
    child = spawn({
      cmd: [process.env.TWYNE_PYTHON ?? "python3", script, "--origin", origin],
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    return null; // Settings explains how to start/install the helper.
  }
  return {
    stop: () => {
      try {
        child.kill("SIGINT");
      } catch {
        /* already stopped */
      }
    },
  };
}
