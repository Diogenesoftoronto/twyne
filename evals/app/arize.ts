/**
 * Arize hand-off for the app evals: datasets, experiments and traces.
 *
 * Datasets and experiments go through the `ax` CLI, which owns Arize
 * authentication (`ax profiles`). Each suite's corpus becomes a dataset named
 * for its content hash, so an experiment is always tied to the exact cases it
 * ran; editing a corpus starts a new dataset rather than silently changing an
 * old one. Runs are uploaded with flat `eval.<name>.score|label|explanation`
 * columns, which Arize reads as evaluation results.
 *
 * Traces go through the app's own OpenInference exporter
 * (`convex/arizeTracing.ts`): the local app is started with the Arize keys in
 * its environment, and each case runs inside a CHAIN span, so every model call
 * the app makes for that case lands in one trace.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Score } from "./scoring";
import { metricValue } from "./stats";

export interface AxOptions {
  space: string;
}

async function ax(args: string[], stdin?: string): Promise<string> {
  const child = spawn("ax", [...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(stdin ?? "");
  const code = await new Promise<number>((done) =>
    child.on("close", (exit) => done(exit ?? 1)),
  );
  if (code !== 0) {
    const detail = (stderr || stdout).replace(/\s+/g, " ").trim().slice(0, 400);
    throw new Error(`ax ${args.slice(0, 2).join(" ")} failed: ${detail}`);
  }
  return stdout;
}

/** `ax -o json` prints the payload after any status lines. */
function jsonFrom(output: string): unknown {
  const start = output.search(/[[{]/);
  if (start < 0) throw new Error("ax returned no JSON");
  return JSON.parse(output.slice(start));
}

export function corpusHash(rows: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex")
    .slice(0, 8);
}

/**
 * Find or create the dataset for a corpus. Returns the dataset ID and a map
 * from case_id to Arize example ID.
 */
export async function ensureDataset(
  options: AxOptions,
  name: string,
  rows: Array<Record<string, string | number | boolean> & { case_id: string }>,
): Promise<{ id: string; name: string; examples: Map<string, string> }> {
  let id: string | null = null;
  try {
    const found = jsonFrom(
      await ax([
        "datasets",
        "get",
        name,
        "--space",
        options.space,
        "-o",
        "json",
      ]),
    ) as { id?: string };
    id = found.id ?? null;
  } catch {
    id = null;
  }
  if (!id) {
    const created = jsonFrom(
      await ax(
        [
          "datasets",
          "create",
          "--name",
          name,
          "--space",
          options.space,
          "--file",
          "-",
          "-o",
          "json",
        ],
        JSON.stringify(rows),
      ),
    ) as { id?: string };
    if (!created.id)
      throw new Error(`ax did not return an ID for dataset ${name}`);
    id = created.id;
  }
  const exported = jsonFrom(
    await ax(["datasets", "export", id, "--stdout"]),
  ) as Array<{ id: string; additional_properties?: { case_id?: string } }>;
  const examples = new Map<string, string>();
  for (const example of exported) {
    const caseId = example.additional_properties?.case_id;
    if (caseId) examples.set(caseId, example.id);
  }
  return { id, name, examples };
}

export interface ExperimentRun {
  example_id: string;
  output: string;
  /** False when the case errored before it could be scored. */
  ok: boolean;
  error?: string;
  scores: Record<string, Score>;
  metadata: Record<string, string | number | null>;
}

/**
 * Quality uses the same conditional denominator as local reports. Arize's
 * rectangular numeric columns cannot represent missing scores: any metric
 * with missing values is label-only for this upload. Its scored rows retain
 * the exact value in the explanation, and missing rows carry explicit status.
 * Fully observed metrics stay numeric. Harness always measures execution.
 */
export function experimentRows(runs: ExperimentRun[]): {
  rows: Array<Record<string, unknown>>;
  labelOnly: string[];
} {
  const names = [
    ...new Set(["harness", ...runs.flatMap((run) => Object.keys(run.scores))]),
  ];
  const labelOnly = names.filter((name) =>
    runs.some((run) => metricValue(run, name) === null),
  );
  const metadataKeys = [
    ...new Set(runs.flatMap((run) => Object.keys(run.metadata))),
  ];
  const rows = runs.map((run) => {
    const row: Record<string, unknown> = {
      example_id: run.example_id,
      output: run.output,
    };
    for (const name of names) {
      const score = run.scores[name];
      const value =
        name === "harness" ? (run.ok ? 1 : 0) : metricValue(run, name);
      const status =
        value !== null
          ? "scored"
          : !run.ok
            ? "execution-error"
            : score?.label?.endsWith("error")
              ? score.label
              : "unscored";
      if (!labelOnly.includes(name)) row[`eval.${name}.score`] = value;
      row[`eval.${name}.label`] =
        name === "harness"
          ? run.ok
            ? "ran"
            : "error"
          : value === null
            ? status
            : score?.label
              ? `scored: ${score.label}`
              : `score ${value}`;
      row[`eval.${name}.explanation`] =
        name === "harness"
          ? (run.error ?? score?.explanation ?? "")
          : value === null
            ? `${status}: ${!run.ok ? (run.error ?? "the case did not run") : score?.explanation || score?.label || "metric unavailable or not applicable"}`
            : `${labelOnly.includes(name) ? `score=${value}; ` : ""}${score?.explanation ?? ""}`;
    }
    for (const key of metadataKeys) row[key] = run.metadata[key] ?? "";
    return row;
  });
  return { rows, labelOnly };
}

export async function uploadExperiment(
  datasetId: string,
  name: string,
  runs: ExperimentRun[],
): Promise<{ id: string | null; labelOnly: string[] }> {
  const { rows, labelOnly } = experimentRows(runs);
  const dir = await mkdtemp(join(tmpdir(), "twyne-arize-"));
  try {
    const file = join(dir, "runs.json");
    await writeFile(file, JSON.stringify(rows));
    const created = jsonFrom(
      await ax([
        "experiments",
        "create",
        "--name",
        name,
        "--dataset",
        datasetId,
        "--file",
        file,
        "-o",
        "json",
      ]),
    ) as { id?: string };
    return { id: created.id ?? null, labelOnly };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Run `task` inside an OpenInference CHAIN span named for the case. The span
 * is a no-op unless the app's Arize tracer has been registered.
 */
export async function withCaseSpan<T>(
  attributes: {
    suite: string;
    caseId: string;
    experiment: string;
    input: string;
  },
  task: () => Promise<{ value: T; output: string }>,
): Promise<{ value: T; traceId: string | null }> {
  const tracer = trace.getTracer("twyne-app-evals");
  return tracer.startActiveSpan(
    `eval.${attributes.suite}`,
    {
      attributes: {
        "openinference.span.kind": "CHAIN",
        // The OpenInference processor re-roots AI SDK spans whose parent does
        // not look like AI; an `ai.*` key keeps the case's model calls nested.
        "ai.telemetry.functionId": `eval.${attributes.suite}`,
        "input.value": attributes.input,
        "twyne.eval.suite": attributes.suite,
        "twyne.eval.case_id": attributes.caseId,
        "twyne.eval.experiment": attributes.experiment,
      },
    },
    async (span) => {
      const context = span.spanContext();
      const traceId = context.traceFlags ? context.traceId : null;
      try {
        const { value, output } = await task();
        span.setAttribute("output.value", output);
        span.setStatus({ code: SpanStatusCode.OK });
        return { value, traceId };
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
