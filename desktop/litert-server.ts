/**
 * Desktop-only native LiteRT-LM server manager.
 *
 * When the desktop build is produced with local AI enabled
 * (`TWYNE_DESKTOP_LOCAL_AI=true`), this imports the bundled OpenBMB MiniCPM5
 * LiteRT-LM bundle into the local registry, then starts LiteRT-LM's
 * OpenAI-compatible server on loopback. The web app (loaded in the window)
 * discovers the endpoint via URL params and talks to it through the existing
 * `litert` provider — no model code ships in the browser bundle.
 *
 * Everything here is best-effort: if the flag is off or the binary/model are
 * not bundled, `startLocalAiServer()` returns null and the desktop runs as the
 * normal thin remote shell.
 */
import { spawn, type Subprocess } from "bun";
import { existsSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";

export interface LocalAiServer {
  port: number;
  stop: () => void;
}

const STARTUP_TIMEOUT_MS = Number.parseInt(
  process.env.LITERT_LM_STARTUP_TIMEOUT_MS ??
    process.env.LITERT_SERVER_STARTUP_TIMEOUT_MS ??
    "20000",
  10,
);
const STARTUP_POLL_MS = 150;

function enabled(): boolean {
  const v = process.env.TWYNE_DESKTOP_LOCAL_AI;
  return v === "true" || v === "1";
}

/** Resolve the bundled LiteRT-LM CLI path (overridable via env). */
function serverBinPath(): string {
  return resolve(process.env.LITERT_LM_BIN ?? "./bin/litert-lm");
}

const LOCAL_MODEL_ID = "minicpm5-2b";

/** Resolve the bundled MiniCPM5-2B LiteRT model path (overridable via env). */
function modelPath(): string {
  return resolve(
    process.env.LOCAL_MODEL_PATH ?? "./models/MiniCPM5-2B_int4.litertlm",
  );
}

/** Find a free TCP port on loopback. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

async function isPortAcceptingConnections(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForServerReady(
  proc: Subprocess,
  port: number,
): Promise<"ready" | "exited" | "timeout"> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isPortAcceptingConnections(port)) {
      return "ready";
    }

    const exited = await Promise.race([
      proc.exited.then(
        () => true,
        () => true,
      ),
      Bun.sleep(STARTUP_POLL_MS).then(() => false),
    ]);
    if (exited) return "exited";
  }

  return "timeout";
}

/** Check whether LiteRT-LM already has the Twyne model in its registry. */
async function modelIsRegistered(bin: string): Promise<boolean> {
  let proc: Subprocess;
  try {
    proc = spawn({ cmd: [bin, "list"], stdout: "pipe", stderr: "ignore" });
  } catch {
    return false;
  }

  const output =
    proc.stdout && typeof proc.stdout !== "number"
      ? await new Response(proc.stdout).text()
      : "";
  const exitCode = await proc.exited;
  return (
    exitCode === 0 &&
    output.split(/\s+/).some((value) => value === LOCAL_MODEL_ID)
  );
}

/** Register the bundled model under the id sent by Twyne's OpenAI client. */
async function importModel(bin: string, model: string): Promise<boolean> {
  if (await modelIsRegistered(bin)) return true;

  let proc: Subprocess;
  try {
    proc = spawn({
      cmd: [bin, "import", model, LOCAL_MODEL_ID],
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (err) {
    console.error("[twyne:litert] failed to import local model:", err);
    return false;
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`[twyne:litert] model import exited with status ${exitCode}`);
    return false;
  }
  return true;
}

/**
 * Start the local model server. Returns the live endpoint info, or null when
 * local AI is disabled or its assets are missing.
 */
export async function startLocalAiServer(): Promise<LocalAiServer | null> {
  if (!enabled()) return null;

  const bin = serverBinPath();
  const model = modelPath();
  if (!existsSync(bin) || !existsSync(model)) {
    console.warn(
      `[twyne:litert] local AI enabled but assets missing — bin=${existsSync(bin)} model=${existsSync(model)}; running as thin shell.`,
    );
    return null;
  }

  const port = await freePort();
  if (!(await importModel(bin, model))) return null;

  let proc: Subprocess;
  try {
    // LiteRT-LM serves models from its registry. The import above binds the
    // bundled file to LOCAL_MODEL_ID; `serve` exposes the OpenAI-compatible
    // /v1 API that the web app already speaks.
    proc = spawn({
      cmd: [bin, "serve", "--host", "127.0.0.1", "--port", String(port)],
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (err) {
    console.error("[twyne:litert] failed to spawn local server:", err);
    return null;
  }

  const status = await waitForServerReady(proc, port);
  if (status !== "ready") {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
    console.error(
      `[twyne:litert] local model server ${status} before it was ready on 127.0.0.1:${port}`,
    );
    return null;
  }

  console.log(`[twyne:litert] local model server on 127.0.0.1:${port}`);
  return {
    port,
    stop: () => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    },
  };
}
