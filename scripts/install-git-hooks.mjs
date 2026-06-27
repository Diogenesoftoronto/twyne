#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const isGitRepo = spawnSync("git", ["rev-parse", "--git-dir"], {
  stdio: "ignore",
});

if (isGitRepo.status !== 0) {
  process.exit(0);
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
