/**
 * Desktop-only native LiteRT-LM server manager.
 *
 * When the desktop build is produced with local AI enabled
 * (`TWYNE_DESKTOP_LOCAL_AI=true`), this spawns the bundled LiteRT-LM server
 * binary serving Gemma 4 E4B over an OpenAI-compatible API on loopback. The
 * web app (loaded in the window) discovers the endpoint via URL params and
 * talks to it through the existing `litert` provider — no model code ships in
 * the browser bundle.
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
  process.env.LITERT_SERVER_STARTUP_TIMEOUT_MS ?? "20000",
  10,
);
const STARTUP_POLL_MS = 150;

function enabled(): boolean {
  const v = process.env.TWYNE_DESKTOP_LOCAL_AI;
  return v === "true" || v === "1";
}

/** Resolve the bundled LiteRT-LM server binary path (overridable via env). */
function serverBinPath(): string {
  return resolve(process.env.LITERT_SERVER_BIN ?? "./bin/litert-lm-server");
}

/** Resolve the Gemma 4 E4B LiteRT model path (overridable via env). */
function modelPath(): string {
  return resolve(
    process.env.LOCAL_MODEL_PATH ?? "./models/gemma-4-e4b.litertlm",
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
      proc.exited.then(() => true, () => true),
      Bun.sleep(STARTUP_POLL_MS).then(() => false),
    ]);
    if (exited) return "exited";
  }

  return "timeout";
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
  let proc: Subprocess;
  try {
    // Expected CLI contract: `<bin> --model <path> --host 127.0.0.1 --port <n>`
    // exposing an OpenAI-compatible /v1 API. Adjust flags to match the chosen
    // LiteRT-LM server build.
    proc = spawn({
      cmd: [
        bin,
        "--model",
        model,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
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
