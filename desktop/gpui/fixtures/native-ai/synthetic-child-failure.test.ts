import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { startLocalAiServer } from "../../../litert-server";

const SCRATCH_DIR = join(import.meta.dir, ".synthetic-scratch");

function setupScratch(): void {
  if (existsSync(SCRATCH_DIR)) {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  }
  mkdirSync(SCRATCH_DIR, { recursive: true });
}

function cleanupScratch(): void {
  if (existsSync(SCRATCH_DIR)) {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  }
}

describe("Synthetic LiteRT Server Child & Failure State Machine", () => {
  it("fails cleanly when TWYNE_DESKTOP_LOCAL_AI is disabled", async () => {
    const prevFlag = process.env.TWYNE_DESKTOP_LOCAL_AI;
    try {
      delete process.env.TWYNE_DESKTOP_LOCAL_AI;
      const server = await startLocalAiServer();
      expect(server).toBeNull();
    } finally {
      if (prevFlag !== undefined) process.env.TWYNE_DESKTOP_LOCAL_AI = prevFlag;
    }
  });

  it("fails cleanly with missing assets (missing bin or model)", async () => {
    setupScratch();
    const prevFlag = process.env.TWYNE_DESKTOP_LOCAL_AI;
    const prevBin = process.env.LITERT_LM_BIN;
    const prevModel = process.env.LOCAL_MODEL_PATH;

    try {
      process.env.TWYNE_DESKTOP_LOCAL_AI = "true";
      process.env.LITERT_LM_BIN = join(SCRATCH_DIR, "nonexistent-bin");
      process.env.LOCAL_MODEL_PATH = join(SCRATCH_DIR, "nonexistent-model");

      const server = await startLocalAiServer();
      expect(server).toBeNull();
    } finally {
      if (prevFlag !== undefined) process.env.TWYNE_DESKTOP_LOCAL_AI = prevFlag;
      else delete process.env.TWYNE_DESKTOP_LOCAL_AI;
      if (prevBin !== undefined) process.env.LITERT_LM_BIN = prevBin;
      else delete process.env.LITERT_LM_BIN;
      if (prevModel !== undefined) process.env.LOCAL_MODEL_PATH = prevModel;
      else delete process.env.LOCAL_MODEL_PATH;
      cleanupScratch();
    }
  });

  it("detects child failure when model import command exits non-zero", async () => {
    setupScratch();
    const mockBin = join(SCRATCH_DIR, "mock-litert-import-fail.sh");
    const mockModel = join(SCRATCH_DIR, "mock.litertlm");

    writeFileSync(
      mockBin,
      `#!/bin/sh
if [ "$1" = "list" ]; then
  echo "other-model"
  exit 0
fi
if [ "$1" = "import" ]; then
  echo "Import failure: corrupted weights" >&2
  exit 42
fi
exit 1
`,
      "utf8",
    );
    chmodSync(mockBin, 0o755);
    writeFileSync(mockModel, "dummy-weights", "utf8");

    const prevFlag = process.env.TWYNE_DESKTOP_LOCAL_AI;
    const prevBin = process.env.LITERT_LM_BIN;
    const prevModel = process.env.LOCAL_MODEL_PATH;

    try {
      process.env.TWYNE_DESKTOP_LOCAL_AI = "true";
      process.env.LITERT_LM_BIN = mockBin;
      process.env.LOCAL_MODEL_PATH = mockModel;

      const server = await startLocalAiServer();
      expect(server).toBeNull();
    } finally {
      if (prevFlag !== undefined) process.env.TWYNE_DESKTOP_LOCAL_AI = prevFlag;
      else delete process.env.TWYNE_DESKTOP_LOCAL_AI;
      if (prevBin !== undefined) process.env.LITERT_LM_BIN = prevBin;
      else delete process.env.LITERT_LM_BIN;
      if (prevModel !== undefined) process.env.LOCAL_MODEL_PATH = prevModel;
      else delete process.env.LOCAL_MODEL_PATH;
      cleanupScratch();
    }
  });

  it("detects child exit before ready and cleans up process", async () => {
    setupScratch();
    const mockBin = join(SCRATCH_DIR, "mock-litert-crash-on-serve.sh");
    const mockModel = join(SCRATCH_DIR, "mock.litertlm");

    writeFileSync(
      mockBin,
      `#!/bin/sh
if [ "$1" = "list" ]; then
  echo "minicpm5-2b"
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo "Fatal: CUDA/Vulkan driver missing" >&2
  exit 1
fi
exit 0
`,
      "utf8",
    );
    chmodSync(mockBin, 0o755);
    writeFileSync(mockModel, "dummy-weights", "utf8");

    const prevFlag = process.env.TWYNE_DESKTOP_LOCAL_AI;
    const prevBin = process.env.LITERT_LM_BIN;
    const prevModel = process.env.LOCAL_MODEL_PATH;
    const prevTimeout = process.env.LITERT_LM_STARTUP_TIMEOUT_MS;

    try {
      process.env.TWYNE_DESKTOP_LOCAL_AI = "true";
      process.env.LITERT_LM_BIN = mockBin;
      process.env.LOCAL_MODEL_PATH = mockModel;
      process.env.LITERT_LM_STARTUP_TIMEOUT_MS = "2000";

      const server = await startLocalAiServer();
      expect(server).toBeNull();
    } finally {
      if (prevFlag !== undefined) process.env.TWYNE_DESKTOP_LOCAL_AI = prevFlag;
      else delete process.env.TWYNE_DESKTOP_LOCAL_AI;
      if (prevBin !== undefined) process.env.LITERT_LM_BIN = prevBin;
      else delete process.env.LITERT_LM_BIN;
      if (prevModel !== undefined) process.env.LOCAL_MODEL_PATH = prevModel;
      else delete process.env.LOCAL_MODEL_PATH;
      if (prevTimeout !== undefined)
        process.env.LITERT_LM_STARTUP_TIMEOUT_MS = prevTimeout;
      else delete process.env.LITERT_LM_STARTUP_TIMEOUT_MS;
      cleanupScratch();
    }
  });

  it("detects timeout when child stays running but never opens loopback port", async () => {
    setupScratch();
    const mockBin = join(SCRATCH_DIR, "mock-litert-hang.sh");
    const mockModel = join(SCRATCH_DIR, "mock.litertlm");

    writeFileSync(
      mockBin,
      `#!/bin/sh
if [ "$1" = "list" ]; then
  echo "minicpm5-2b"
  exit 0
fi
if [ "$1" = "serve" ]; then
  # Sleep without listening on port
  sleep 30
  exit 0
fi
exit 0
`,
      "utf8",
    );
    chmodSync(mockBin, 0o755);
    writeFileSync(mockModel, "dummy-weights", "utf8");

    const prevFlag = process.env.TWYNE_DESKTOP_LOCAL_AI;
    const prevBin = process.env.LITERT_LM_BIN;
    const prevModel = process.env.LOCAL_MODEL_PATH;
    const prevTimeout = process.env.LITERT_LM_STARTUP_TIMEOUT_MS;

    try {
      process.env.TWYNE_DESKTOP_LOCAL_AI = "true";
      process.env.LITERT_LM_BIN = mockBin;
      process.env.LOCAL_MODEL_PATH = mockModel;
      // Set short 500ms timeout for synthetic test
      process.env.LITERT_LM_STARTUP_TIMEOUT_MS = "500";

      const start = Date.now();
      const server = await startLocalAiServer();
      const elapsed = Date.now() - start;

      expect(server).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(450);
      expect(elapsed).toBeLessThan(3000);
    } finally {
      if (prevFlag !== undefined) process.env.TWYNE_DESKTOP_LOCAL_AI = prevFlag;
      else delete process.env.TWYNE_DESKTOP_LOCAL_AI;
      if (prevBin !== undefined) process.env.LITERT_LM_BIN = prevBin;
      else delete process.env.LITERT_LM_BIN;
      if (prevModel !== undefined) process.env.LOCAL_MODEL_PATH = prevModel;
      else delete process.env.LOCAL_MODEL_PATH;
      if (prevTimeout !== undefined)
        process.env.LITERT_LM_STARTUP_TIMEOUT_MS = prevTimeout;
      else delete process.env.LITERT_LM_STARTUP_TIMEOUT_MS;
      cleanupScratch();
    }
  });

  it("handles clean startup, readiness acknowledgement, and stop() termination", async () => {
    setupScratch();
    const mockBin = join(SCRATCH_DIR, "mock-litert-success.ts");
    const mockModel = join(SCRATCH_DIR, "mock.litertlm");

    // TypeScript script that opens a loopback TCP listener on the passed port argument
    writeFileSync(
      mockBin,
      `#!/usr/bin/env bun
import { createServer } from "node:net";

const args = process.argv.slice(2);
if (args[0] === "list") {
  console.log("minicpm5-2b");
  process.exit(0);
}

if (args[0] === "serve") {
  const portIdx = args.indexOf("--port");
  const port = parseInt(args[portIdx + 1], 10);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log("Listening on " + port);
  });
  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}
`,
      "utf8",
    );
    chmodSync(mockBin, 0o755);
    writeFileSync(mockModel, "dummy-weights", "utf8");

    const prevFlag = process.env.TWYNE_DESKTOP_LOCAL_AI;
    const prevBin = process.env.LITERT_LM_BIN;
    const prevModel = process.env.LOCAL_MODEL_PATH;
    const prevTimeout = process.env.LITERT_LM_STARTUP_TIMEOUT_MS;

    try {
      process.env.TWYNE_DESKTOP_LOCAL_AI = "true";
      process.env.LITERT_LM_BIN = mockBin;
      process.env.LOCAL_MODEL_PATH = mockModel;
      process.env.LITERT_LM_STARTUP_TIMEOUT_MS = "5000";

      const server = await startLocalAiServer();
      expect(server).not.toBeNull();
      if (!server) return;

      expect(typeof server.port).toBe("number");
      expect(server.port).toBeGreaterThan(0);

      // Stop the server cleanly
      server.stop();
    } finally {
      if (prevFlag !== undefined) process.env.TWYNE_DESKTOP_LOCAL_AI = prevFlag;
      else delete process.env.TWYNE_DESKTOP_LOCAL_AI;
      if (prevBin !== undefined) process.env.LITERT_LM_BIN = prevBin;
      else delete process.env.LITERT_LM_BIN;
      if (prevModel !== undefined) process.env.LOCAL_MODEL_PATH = prevModel;
      else delete process.env.LOCAL_MODEL_PATH;
      if (prevTimeout !== undefined)
        process.env.LITERT_LM_STARTUP_TIMEOUT_MS = prevTimeout;
      else delete process.env.LITERT_LM_STARTUP_TIMEOUT_MS;
      cleanupScratch();
    }
  });
});
