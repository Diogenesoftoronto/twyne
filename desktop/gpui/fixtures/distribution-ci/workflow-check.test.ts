import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import {
  logicalCommands,
  sharedWorkflowState,
  validateWorkflow,
  type ExecutableContract,
  type Workflow,
} from "./workflow-policy";

const HERE = dirname(import.meta.path);
const REPO = join(HERE, "../../../..");
const SHARED = join(REPO, ".github/workflows/gpui-desktop.yml");
const BEFORE = await readFile(join(HERE, "workflow.before.yml"), "utf8");
const AFTER = await readFile(join(HERE, "workflow.after.yml"), "utf8");
const PATCH = join(HERE, "workflow.patch");
const CONTRACT = JSON.parse(
  await readFile(
    join(REPO, "desktop/gpui/packaging/twyne-packaging.json"),
    "utf8",
  ),
) as ExecutableContract;

function changed(edit: (workflow: Workflow) => void): string {
  const workflow = parse(AFTER) as Workflow;
  edit(workflow);
  return stringify(workflow);
}

function named(workflow: Workflow, name: string) {
  const step = workflow.jobs.desktop.steps.find(
    (candidate) => candidate.name === name,
  );
  if (!step) throw new Error(`Missing test specimen step ${name}`);
  return step;
}

describe("unapplied CI proposal: structural and scratch-patch checks only", () => {
  test("retained after fixture satisfies required commands, ordering and actual packaging IDs", () => {
    const workflow = validateWorkflow(AFTER, CONTRACT);
    expect(workflow.jobs.desktop.steps).toHaveLength(16);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(CONTRACT.executables.map((spec) => spec.id)).toEqual([
      "desktop",
      "document",
      "math-write",
    ]);
  });

  test("current workflow may be either exact reviewed before or exact applied after", async () => {
    expect(["before", "after"]).toContain(
      sharedWorkflowState(await readFile(SHARED, "utf8"), BEFORE, AFTER),
    );
    expect(sharedWorkflowState(BEFORE, BEFORE, AFTER)).toBe("before");
    expect(sharedWorkflowState(AFTER, BEFORE, AFTER)).toBe("after");
    expect(() =>
      sharedWorkflowState(`${BEFORE}\n# unrelated drift\n`, BEFORE, AFTER),
    ).toThrow("drifted");
    expect(() => validateWorkflow(BEFORE, CONTRACT)).toThrow();
  });

  test("patch applies/reverses in a fresh copied tree and never writes the shared workflow", async () => {
    const sharedBefore = await readFile(SHARED, "utf8");
    const scratch = await mkdtemp(join(tmpdir(), "twyne-ci-patch-"));
    try {
      const target = join(scratch, ".github/workflows/gpui-desktop.yml");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, BEFORE);
      for (const args of [
        ["apply", "--check", PATCH],
        ["apply", PATCH],
        ["apply", "--reverse", "--check", PATCH],
      ]) {
        const result = spawnSync("rtk", ["proxy", "git", ...args], {
          cwd: scratch,
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr || result.stdout).toBe(0);
      }
      expect(await readFile(target, "utf8")).toBe(AFTER);
      const reverse = spawnSync(
        "rtk",
        ["proxy", "git", "apply", "--reverse", PATCH],
        { cwd: scratch, encoding: "utf8", timeout: 10_000 },
      );
      expect(reverse.status, reverse.stderr).toBe(0);
      expect(await readFile(target, "utf8")).toBe(BEFORE);
      expect(await readFile(SHARED, "utf8")).toBe(sharedBefore);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  test("logical command policy handles continuation and refuses hidden extra shell segments", () => {
    expect(
      logicalCommands(
        "rtk proxy bun test \\\n  one.test.ts\nrtk proxy cargo fmt",
      ),
    ).toEqual(["rtk proxy bun test one.test.ts", "rtk proxy cargo fmt"]);
    for (const run of [
      "rtk proxy bun test && cargo build",
      "rtk proxy bun test; cargo build",
      "rtk proxy bun test | cat",
      "rtk proxy bun test || true",
      "rtk proxy bun test `whoami`",
      "rtk proxy bun test $(whoami)",
      "rtk proxy bun test \\",
      "",
    ])
      expect(() => logicalCommands(run)).toThrow();
  });

  const negatives: [string, (workflow: Workflow) => void][] = [
    [
      "additional write permission",
      (w) => {
        w.permissions.contents = "write";
      },
    ],
    [
      "job permission elevation",
      (w) => {
        w.jobs.desktop.permissions = { contents: "write" };
      },
    ],
    [
      "matrix platform removed",
      (w) => {
        w.jobs.desktop.strategy.matrix.os.pop();
      },
    ],
    [
      "bootstrap before Bun",
      (w) => {
        const s = w.jobs.desktop.steps;
        [s[1], s[2]] = [s[2]!, s[1]!];
      },
    ],
    [
      "alternate bootstrap script",
      (w) => {
        named(w, "Provision pinned RTK for command filtering").run =
          "bun /tmp/unreviewed.ts";
      },
    ],
    [
      "caller-overridden archive pin",
      (w) => {
        named(w, "Provision pinned RTK for command filtering").env = {
          RTK_URL: "https://example.com/archive",
        };
      },
    ],
    [
      "lost RTK output id",
      (w) => {
        named(w, "Provision pinned RTK for command filtering").id = "other";
      },
    ],
    [
      "unprefixed old step",
      (w) => {
        named(w, "Check formatting").run =
          "cargo fmt --manifest-path desktop/gpui/Cargo.toml --check";
      },
    ],
    [
      "unprefixed chain segment",
      (w) => {
        named(w, "Check formatting").run += " && cargo build";
      },
    ],
    [
      "non-Bash shell",
      (w) => {
        named(w, "Build release executable").shell = "pwsh";
      },
    ],
    [
      "unlocked dependency install",
      (w) => {
        named(w, "Install document helper dependencies").run =
          "rtk proxy bun install";
      },
    ],
    [
      "skippable real executable fixture",
      (w) => {
        named(w, "Stage and verify the distribution tree").env = {
          TWYNE_DISTRIBUTION_REQUIRE_REAL: "0",
        };
      },
    ],
    [
      "stage before release build",
      (w) => {
        const s = w.jobs.desktop.steps;
        [s[13], s[14]] = [s[14]!, s[13]!];
      },
    ],
    [
      "fixed destination collision",
      (w) => {
        const s = named(w, "Stage and verify the distribution tree");
        s.run = s.run!.replaceAll(
          "steps.rtk.outputs.stage_path",
          "runner.temp",
        );
      },
    ],
    [
      "verify different tree",
      (w) => {
        const s = named(w, "Stage and verify the distribution tree");
        s.run = s.run!.replace(
          "stage.ts verify",
          "stage.ts verify --release /tmp/elsewhere",
        );
      },
    ],
    [
      "required core check conditional",
      (w) => {
        named(w, "Test local storage and exchange").if = "false";
      },
    ],
    [
      "failure ignored",
      (w) => {
        (named(w, "Check native app") as Record<string, unknown>)[
          "continue-on-error"
        ] = true;
      },
    ],
    [
      "required helper artifact missing",
      (w) => {
        const upload = w.jobs.desktop.steps.find(
          (s) => s.uses === "actions/upload-artifact@v4",
        )!;
        upload.with!.path = (upload.with!.path as string)
          .split("\n")
          .filter((p) => !p.trim().endsWith("/twyne-math-write"))
          .join("\n");
      },
    ],
    [
      "verified staged tree absent",
      (w) => {
        const upload = w.jobs.desktop.steps.find(
          (s) => s.uses === "actions/upload-artifact@v4",
        )!;
        upload.with!.path = (upload.with!.path as string)
          .split("\n")
          .filter((p) => !p.includes("steps.rtk.outputs.stage_path"))
          .join("\n");
      },
    ],
    [
      "missing upload allowed",
      (w) => {
        w.jobs.desktop.steps.find(
          (s) => s.uses === "actions/upload-artifact@v4",
        )!.with!["if-no-files-found"] = "ignore";
      },
    ],
    [
      "duplicate bootstrap step",
      (w) => {
        w.jobs.desktop.steps.push({
          ...named(w, "Provision pinned RTK for command filtering"),
        });
      },
    ],
    [
      "unreviewed extra shell step",
      (w) => {
        w.jobs.desktop.steps.push({
          name: "Other",
          run: "rtk proxy bun /tmp/script.ts",
        });
      },
    ],
  ];
  for (const [label, edit] of negatives)
    test(`rejects ${label}`, () =>
      expect(() => validateWorkflow(changed(edit), CONTRACT)).toThrow());

  test("new required packaging executable must also be uploaded", () => {
    const extra = structuredClone(CONTRACT);
    extra.executables.push({
      id: "new-helper",
      cargoBinary: "twyne-new-helper",
      windowsExtension: ".exe",
      required: true,
    });
    expect(() => validateWorkflow(AFTER, extra)).toThrow(
      "Missing new-helper artifact",
    );
  });
});
