import { parse } from "yaml";

export interface Step {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  shell?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

export interface Workflow {
  permissions: Record<string, unknown>;
  jobs: {
    desktop: {
      "runs-on": string;
      strategy: { "fail-fast": boolean; matrix: { os: string[] } };
      defaults: { run: { shell: string } };
      permissions?: unknown;
      steps: Step[];
    };
  };
}

export interface ExecutableContract {
  schemaVersion: number;
  executables: {
    id: string;
    cargoBinary: string;
    windowsExtension: string;
    required: boolean;
  }[];
}

const BOOTSTRAP = "bun desktop/gpui/fixtures/distribution-ci/bootstrap-rtk.ts";
const STAGE_PATH = "${{ steps.rtk.outputs.stage_path }}";
const MATRIX = ["ubuntu-24.04", "macos-14", "windows-latest"];

function requireContract(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Bounded policy for the reviewed command subset, not a general Bash parser. */
export function logicalCommands(run: string): string[] {
  const commands: string[] = [];
  let pending = "";
  for (const line of run.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      requireContract(!pending, "Interrupted shell continuation.");
      continue;
    }
    pending += `${pending ? " " : ""}${trimmed}`;
    if (pending.endsWith("\\")) {
      pending = pending.slice(0, -1).trimEnd();
      continue;
    }
    // Keep the reviewed run steps free of extra unprefixed chain segments,
    // command substitutions, pipelines, or statements hidden in arguments.
    requireContract(
      !/[;&|`]/.test(pending) && !pending.includes("$("),
      "Unsupported shell chain/substitution in workflow command.",
    );
    commands.push(pending);
    pending = "";
  }
  requireContract(!pending, "Unfinished shell continuation.");
  requireContract(commands.length > 0, "Empty run step.");
  return commands;
}

export function sharedWorkflowState(
  current: string,
  before: string,
  after: string,
): "before" | "after" {
  if (current === before) return "before";
  if (current === after) return "after";
  throw new Error("Shared workflow drifted from both reviewed fixture states.");
}

export function validateWorkflow(
  source: string,
  executables: ExecutableContract,
): Workflow {
  const workflow = parse(source) as Workflow;
  requireContract(
    workflow && typeof workflow === "object",
    "Workflow must be a mapping.",
  );
  requireContract(
    Object.keys(workflow).every((key) =>
      ["name", "on", "permissions", "jobs"].includes(key),
    ),
    "Unreviewed workflow-level override.",
  );
  requireContract(
    same(workflow.permissions, { contents: "read" }),
    "Only contents:read is reviewed.",
  );
  requireContract(
    workflow.jobs && same(Object.keys(workflow.jobs), ["desktop"]),
    "Only the desktop job is reviewed.",
  );
  const job = workflow.jobs.desktop;
  requireContract(
    Object.keys(job).every((key) =>
      [
        "name",
        "runs-on",
        "strategy",
        "defaults",
        "steps",
        "permissions",
      ].includes(key),
    ),
    "Unreviewed job-level override.",
  );
  requireContract(
    !job.permissions,
    "Job permission overrides are not reviewed.",
  );
  requireContract(
    job["runs-on"] === "${{ matrix.os }}",
    "Runner must use the reviewed OS matrix.",
  );
  requireContract(
    job.strategy?.["fail-fast"] === false &&
      same(job.strategy.matrix.os, MATRIX),
    "Three-OS matrix changed.",
  );
  requireContract(
    same(job.defaults, { run: { shell: "bash" } }),
    "Commands need the reviewed Bash default.",
  );
  requireContract(Array.isArray(job.steps), "Missing workflow steps.");

  const steps = job.steps;
  const named = (name: string): [Step, number] => {
    const matches = steps
      .map((step, i) => [step, i] as const)
      .filter(([step]) => step.name === name);
    requireContract(matches.length === 1, `Need exactly one ${name} step.`);
    return [matches[0]![0], matches[0]![1]];
  };
  const action = (uses: string): [Step, number] => {
    const matches = steps
      .map((step, i) => [step, i] as const)
      .filter(([step]) => step.uses === uses);
    requireContract(matches.length === 1, `Need exactly one ${uses} action.`);
    return [matches[0]![0], matches[0]![1]];
  };

  const [, checkoutIndex] = action("actions/checkout@v5");
  const [, bunIndex] = action("oven-sh/setup-bun@v2");
  const [bootstrap, bootstrapIndex] = named(
    "Provision pinned RTK for command filtering",
  );
  requireContract(
    checkoutIndex === 0 && bunIndex === 1 && bootstrapIndex === 2,
    "Checkout/Bun/bootstrap order changed.",
  );
  requireContract(
    bootstrap.id === "rtk" && bootstrap.run === BOOTSTRAP,
    "Bootstrap must call the reviewed pinned module.",
  );
  requireContract(
    !bootstrap.env && !bootstrap.if,
    "Bootstrap cannot accept alternate pins or conditional provisioning.",
  );
  requireContract(
    steps.filter((step) => step.id === "rtk").length === 1,
    "RTK output binding must be unique.",
  );

  const expected = new Map<string, string[]>([
    [
      "Install document helper dependencies",
      ["rtk proxy bun install --frozen-lockfile"],
    ],
    [
      "Test distribution workflow contracts",
      ["rtk proxy bun test desktop/gpui/fixtures/distribution-ci"],
    ],
    [
      "Build and test local document helper",
      [
        "rtk proxy bun run desktop.gpui.build-helper",
        "rtk proxy bun test desktop/gpui/tools/semantic-worker.test.ts",
      ],
    ],
    [
      "Install Linux libraries",
      [
        "rtk proxy sudo apt-get update",
        "rtk proxy sudo apt-get install -y clang pkg-config libfontconfig1-dev libfreetype6-dev libxkbcommon-dev libxkbcommon-x11-dev libxcb1-dev libwayland-dev libssl-dev",
      ],
    ],
    [
      "Check formatting",
      ["rtk proxy cargo fmt --manifest-path desktop/gpui/Cargo.toml --check"],
    ],
    [
      "Check native app",
      [
        "rtk proxy cargo clippy --locked --manifest-path desktop/gpui/Cargo.toml -- -D warnings",
      ],
    ],
    [
      "Test local storage and exchange",
      [
        "rtk proxy cargo test --locked --no-default-features --manifest-path desktop/gpui/Cargo.toml",
      ],
    ],
    [
      "Test native UI",
      [
        "rtk proxy cargo test --locked --features ui-tests --manifest-path desktop/gpui/Cargo.toml",
      ],
    ],
    [
      "Build release executable",
      [
        "rtk proxy cargo build --locked --release --manifest-path desktop/gpui/Cargo.toml",
      ],
    ],
    [
      "Stage and verify the distribution tree",
      [
        "rtk proxy bun test desktop/gpui/fixtures/distribution/stage.test.ts",
        `rtk proxy bun desktop/gpui/packaging/stage.ts stage --out "${STAGE_PATH}"`,
        `rtk proxy bun desktop/gpui/packaging/stage.ts verify --out "${STAGE_PATH}"`,
      ],
    ],
  ]);

  for (const [i, step] of steps.entries()) {
    requireContract(
      Object.keys(step).every((key) =>
        ["name", "id", "uses", "if", "run", "shell", "env", "with"].includes(
          key,
        ),
      ),
      "Unreviewed step override.",
    );
    requireContract(
      !(step.uses && step.run),
      "A step cannot be both an action and a shell command.",
    );
    if (!step.run || i === bootstrapIndex) continue;
    requireContract(
      i > bootstrapIndex,
      "RTK command occurs before provisioning.",
    );
    requireContract(
      !step.shell || step.shell === "bash",
      "Unexpected shell override.",
    );
    const commands = logicalCommands(step.run);
    requireContract(
      commands.every((command) => command.startsWith("rtk proxy ")),
      "Each command must have its own RTK prefix.",
    );
    const expectedCommands = expected.get(step.name ?? "");
    requireContract(
      expectedCommands && same(commands, expectedCommands),
      `Unreviewed command in ${step.name ?? "unnamed step"}.`,
    );
  }
  for (const name of expected.keys()) named(name);
  const [install, installIndex] = named("Install document helper dependencies");
  const [, contractsIndex] = named("Test distribution workflow contracts");
  const [, helperIndex] = named("Build and test local document helper");
  const [, rustIndex] = action("dtolnay/rust-toolchain@stable");
  const [linux, linuxIndex] = named("Install Linux libraries");
  const [, cacheIndex] = action("Swatinem/rust-cache@v2");
  const [, fmtIndex] = named("Check formatting");
  const [, clippyIndex] = named("Check native app");
  const [, coreIndex] = named("Test local storage and exchange");
  const [, uiIndex] = named("Test native UI");
  const [, buildIndex] = named("Build release executable");
  const [stage, stageIndex] = named("Stage and verify the distribution tree");
  const [upload, uploadIndex] = action("actions/upload-artifact@v4");
  const order = [
    bootstrapIndex,
    installIndex,
    contractsIndex,
    helperIndex,
    rustIndex,
    linuxIndex,
    cacheIndex,
    fmtIndex,
    clippyIndex,
    coreIndex,
    uiIndex,
    buildIndex,
    stageIndex,
    uploadIndex,
  ];
  requireContract(
    order.every((n, i) => i === 0 || n > order[i - 1]!),
    "Build/check/stage/upload ordering changed.",
  );
  requireContract(steps.length === order.length + 2, "Unreviewed extra step.");
  requireContract(
    !install.if && linux.if === "runner.os == 'Linux'",
    "Dependency installation gating changed.",
  );
  for (const step of steps) {
    if (step !== linux)
      requireContract(!step.if, "Required step cannot be conditional.");
    if (step !== stage)
      requireContract(!step.env, "Unreviewed step environment override.");
  }
  requireContract(
    same(stage.env, { TWYNE_DISTRIBUTION_REQUIRE_REAL: "1" }),
    "Release executable fixture must be mandatory.",
  );
  requireContract(
    upload.with?.["if-no-files-found"] === "error",
    "Missing artifacts must fail.",
  );
  requireContract(
    typeof upload.with?.path === "string",
    "Artifact paths must be explicit.",
  );
  const paths = (upload.with.path as string)
    .trim()
    .split(/\r?\n/)
    .map((value) => value.trim());
  requireContract(
    new Set(paths).size === paths.length,
    "Duplicate artifact path.",
  );
  requireContract(
    executables.schemaVersion === 2 && executables.executables.length > 0,
    "Unsupported packaging contract.",
  );
  for (const spec of executables.executables) {
    requireContract(
      spec.required &&
        /^[a-z][a-z0-9-]+$/.test(spec.cargoBinary) &&
        spec.windowsExtension === ".exe",
      "Unexpected executable contract.",
    );
    for (const suffix of ["", spec.windowsExtension]) {
      requireContract(
        paths.includes(
          `desktop/gpui/target/release/${spec.cargoBinary}${suffix}`,
        ),
        `Missing ${spec.id} artifact${suffix}.`,
      );
    }
  }
  requireContract(
    paths.includes(`${STAGE_PATH}/**`),
    "Upload must carry the verified fresh stage tree.",
  );
  requireContract(
    !paths.some(
      (path) =>
        path.includes("runner.temp") || path.includes("twyne-distribution"),
    ),
    "Fixed temporary artifact destinations are not reviewed.",
  );
  for (const path of [
    "desktop/gpui/README.md",
    "desktop/gpui/PORT_PLAN.md",
    "desktop/gpui/assets/NOTICE.md",
    "desktop/gpui/assets/licenses/**",
    "desktop/gpui/assets/fonts/*OFL.txt",
    "desktop/gpui/assets/fonts/*LICENSE.txt",
    "desktop/gpui/assets/fonts/NOTICE",
    "desktop/gpui/vendor/gpui-base/LICENSE-APACHE",
    "desktop/gpui/licenses/",
  ]) {
    requireContract(
      paths.includes(path),
      "Existing notice/document artifact path removed.",
    );
  }
  return workflow;
}
