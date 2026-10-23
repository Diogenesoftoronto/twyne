/**
 * App evals: Twyne's model-backed features, driven through MCP and the CLI.
 *
 *   bun run eval:app                                  # every suite, mock model
 *   bun run eval:app -- --suite room --model notorganic --judge notorganic --arize --trace
 *   bun run eval:app -- --target live --suite rubric  # a deployment, via TWYNE_API_URL
 *
 * See evals/app/README.md for the suites, the scores and the Arize hand-off.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  agreementFor,
  formatAgreement,
  type ConstructResult,
} from "./agreement";
import {
  corpusHash,
  ensureDataset,
  uploadExperiment,
  withCaseSpan,
  type ExperimentRun,
} from "./arize";
import { connectMcp, type Connection, type McpDriver } from "./drivers";
import {
  createJudge,
  type ClairicAsk,
  type JevAsk,
  type JudgeMode,
} from "./judges";
import {
  startLocalApp,
  type AppModelMode,
  type LocalApp,
  type ResearchMode,
  type SystemOneMode,
  type UsageTotals,
} from "./local-app";
import {
  averageRuns,
  bySuite,
  describe,
  readReports,
  type ReportLike,
} from "./reports";
import { TwyneClient } from "../../packages/twyne-tools/src/client";
import type { Score } from "./scoring";
import {
  comparePaired,
  formatComparison,
  formatRepeatability,
  formatSummaryLines,
  repeatability,
  summarizeByFacet,
  summarizeCases,
  type Comparison,
  type MetricSummary,
  type Repeatability,
} from "./stats";
import { dossierSuite } from "./suites/dossier";
import { interviewSuite } from "./suites/interview";
import { researchSourcesSuite, researchTargetsSuite } from "./suites/research";
import { roomSuite } from "./suites/room";
import { rewriteSuite } from "./suites/rewrite";
import { rubricSuite } from "./suites/rubric";
import type { ScoredCase, Suite } from "./suites/types";

const SUITES = {
  room: roomSuite,
  rubric: rubricSuite,
  rewrite: rewriteSuite,
  dossier: dossierSuite,
  interview: interviewSuite,
  "research-targets": researchTargetsSuite,
  "research-sources": researchSourcesSuite,
} as const satisfies Record<string, Suite<{ case_id: string }>>;

type SuiteName = keyof typeof SUITES;

const HELP = `Twyne app evals

Usage: bun evals/app/run.ts [options]

  --suite NAMES        room, rubric, rewrite, dossier, interview, research-targets,
                       research-sources, or all (default all)
  --target local|live  in-process app (default) or TWYNE_API_URL + TWYNE_ACCESS_TOKEN
  --model MODE         local app's hosted model: mock (default), openai-compatible, notorganic
  --system-one MODE    review-gate judgements: mock, direct (TYPESAFE_API_KEY) or off
                       (default: mock with the mock model, direct when a key is set)
  --research MODE      auto-research search: mock, notorganic, keenable (KEENABLE_API_KEY),
                       custom (TWYNE_APP_SEARCH_URL) or off
                       (default: mock with the mock model, notorganic with notorganic)
  --driver mcp|mcp-stdio  MCP in-process (default) or twyne-mcp over stdio
  --judge MODE         none (default), notorganic, openai-compatible
  --jev                add Jev (calibrated judgements) and Clairic (typed extraction)
                       evaluators, asked through the app's own System One and extraction
  --case IDS           only these case_ids (comma-separated)
  --limit N            first N cases per suite
  --concurrency N      cases in flight per suite (default 2)
  --repeat N           run each suite N times and report run-to-run variance
                       (experiments end -r1..-rN; costs N times as much)
  --baseline SPECS     compare with earlier reports, paired by case_id: report files,
                       directories or a path prefix (comma-separated); several runs of
                       one suite are averaged per case
  --arize              upload each suite as an Arize dataset + experiment (ax CLI)
  --arize-space ID     Arize space (default ARIZE_SPACE_ID)
  --trace              export the app's spans to Arize (ARIZE_API_KEY, ARIZE_SPACE_ID)
  --project NAME       Arize tracing project (default twyne-app-evals)
  --experiment NAME    experiment name prefix (default app-<suite>-<model>-<time>)
  --out DIR            report directory (default reports/app-evals)
  --strict             exit 1 when any case fails to run

Compare reports after the fact with evals/app/compare.ts.
`;

export interface SuiteReport {
  suite: string;
  surface: string;
  experiment: string;
  target: string;
  model: string;
  driver: string;
  judge: string;
  /** Whether Jev and Clairic evaluators ran. */
  jev?: boolean;
  startedAt: string;
  /** With `--repeat`: which round this is. */
  round?: { index: number; of: number };
  /**
   * Each metric's mean with its 95% interval. Cases that share a draft or a
   * pair count as one cluster, so `clusters` is the effective sample size.
   */
  summary: Record<string, MetricSummary>;
  /** The summary per strategy, where a suite runs more than one. */
  byStrategy?: Record<string, Record<string, MetricSummary>>;
  errors: number;
  /** Hosted calls the in-process app made for this suite. */
  usage?: Omit<UsageTotals, "costMicrousd"> & { costMicrousd: number | null };
  /** Account billing observed during the suite; concurrent work may be included. */
  billed?: {
    microusd: number;
    settled: number;
    unresolved: number;
    scope: "account-window";
    truncated: boolean;
  } | null;
  arize?: { dataset: string; datasetId: string; experimentId: string | null };
  /** Upload failed after outputs were saved locally; safe to retry without inference. */
  uploadError?: string;
  /** Explicit denominators for quality metrics, evaluator errors and abstentions. */
  coverage?: Record<
    string,
    { scored: number; missing: number; errors: number; abstained: number }
  >;
  /** Evaluators that read the same construct, compared on shared cases. */
  agreement?: ConstructResult[];
  /** `--baseline`: this run (all rounds, averaged) against the baseline. */
  comparison?: Comparison;
  /** `--repeat`: variance across the rounds, on the last round's report. */
  repeatability?: Repeatability[];
  cases: Array<{
    case_id: string;
    /** Cases in one cluster (a strong/weak pair, one draft) are not independent. */
    cluster: string;
    /** Case attributes to slice by: quality, strategy, level, persona, mode. */
    facets?: Record<string, string>;
    ok: boolean;
    /** Never started: the run stopped after repeated provider failures. */
    skipped?: boolean;
    error?: string;
    latencyMs: number;
    traceId: string | null;
    scores: Record<string, Score>;
    output: string;
    raw: unknown;
  }>;
}

export interface RunOptions {
  suites: SuiteName[];
  target: "local" | "live";
  model: AppModelMode;
  systemOne?: SystemOneMode;
  research?: ResearchMode;
  driver: McpDriver["kind"];
  judge: JudgeMode;
  /** Add Jev and Clairic evaluators (through the app's own paths). */
  jev?: boolean;
  caseIds?: string[];
  limit?: number;
  concurrency: number;
  /** Run each suite this many times and report run-to-run variance. */
  repeat?: number;
  /** Earlier reports to compare with: files, directories or prefixes. */
  baseline?: string[];
  arize: boolean;
  arizeSpace?: string;
  trace: boolean;
  project: string;
  experiment?: string;
  out?: string;
  env: Readonly<Record<string, string | undefined>>;
  log?: (line: string) => void;
}

async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

function stamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-");
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Rate limits are per writer, so a live run retries what the limiter refused. */
async function withRetry<T>(live: boolean, task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !live ||
        attempt >= 3 ||
        !/rate|429|too many|slow down/i.test(message)
      )
        throw error;
      await sleep(20_000 * (attempt + 1));
    }
  }
}

const RETRYABLE = /too many requests|rate limited|overloaded/i;

/**
 * Jev and Clairic share one evaluator writer, whose rate limit (20 a minute
 * on the free tier) a large suite can outrun. A refusal waits out the window
 * the limiter names instead of becoming a jev-error.
 */
async function patiently<T extends { ok: boolean; error?: string }>(
  task: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let message: string;
    try {
      const value = await task();
      if (value.ok || !RETRYABLE.test(value.error ?? "") || attempt >= 4)
        return value;
      message = value.error ?? "";
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      if (!RETRYABLE.test(message) || attempt >= 4) throw error;
    }
    const seconds = Number(message.match(/in (\d+)\s*s/)?.[1]);
    await sleep(
      (Number.isFinite(seconds) ? seconds + 1 : 10 * (attempt + 1)) * 1000,
    );
  }
}

/** Case attributes worth slicing a suite by, where a corpus has them. */
const FACETS = [
  "quality",
  "strategy",
  "level",
  "personaId",
  "mode",
  "expectedBehavior",
  "genre",
  "kind",
];

function caseMeta(testCase: { case_id: string }): {
  cluster: string;
  facets?: Record<string, string>;
} {
  const fields = testCase as unknown as Record<string, unknown>;
  const cluster = [fields.cluster, fields.pair_id, fields.draft_id].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const facets = Object.fromEntries(
    FACETS.filter((key) => typeof fields[key] === "string").map((key) => [
      key,
      fields[key] as string,
    ]),
  );
  return {
    cluster: cluster ?? testCase.case_id,
    ...(Object.keys(facets).length ? { facets } : {}),
  };
}

function printReport(report: SuiteReport, log: (line: string) => void): void {
  const round = report.round
    ? ` (round ${report.round.index} of ${report.round.of})`
    : "";
  log(
    `\n${report.suite}${round} — ${report.surface} — ${report.cases.length} case(s), ${report.errors} error(s)`,
  );
  if (report.usage?.calls)
    log(
      `  hosted calls ${report.usage.calls}, tokens ${report.usage.inputTokens} in / ${report.usage.outputTokens} out` +
        (report.usage.costMicrousd !== null
          ? `, est. $${(report.usage.costMicrousd / 1e6).toFixed(4)}`
          : ""),
    );
  if (report.billed)
    log(
      `  account billing observed $${(report.billed.microusd / 1e6).toFixed(4)} (${report.billed.settled} settled` +
        (report.billed.unresolved
          ? `, ${report.billed.unresolved} still settling`
          : "") +
        (report.billed.truncated ? ", ledger page truncated" : "") +
        ")",
    );
  log(`  ${"metric".padEnd(24)} mean  95% CI`);
  for (const line of formatSummaryLines(report.summary)) log(line);
  for (const [strategy, summary] of Object.entries(report.byStrategy ?? {})) {
    log(`  strategy ${strategy}`);
    for (const line of formatSummaryLines(summary)) log(`  ${line}`);
  }
  for (const failed of report.cases.filter((c) => !c.ok && !c.skipped))
    log(`  ✗ ${failed.case_id}: ${failed.error}`);
  const skipped = report.cases.filter((c) => c.skipped).length;
  if (skipped)
    log(
      `  ⏸ ${skipped} case(s) not run: ${report.cases.find((c) => c.skipped)?.error}`,
    );
  for (const line of formatAgreement(report.agreement ?? [])) log(line);
}

export async function runAppEvals(options: RunOptions): Promise<SuiteReport[]> {
  const log = options.log ?? ((line: string) => console.log(line));
  const live = options.target === "live";
  const arizeSpace = options.arizeSpace ?? options.env.ARIZE_SPACE_ID;
  if (options.arize && !arizeSpace)
    throw new Error("--arize needs --arize-space or ARIZE_SPACE_ID");
  const rounds = Math.max(1, Math.floor(options.repeat ?? 1));
  // Read the baseline first: a typo should fail before any money is spent.
  const baseline = options.baseline?.length
    ? bySuite(readReports(options.baseline))
    : null;

  const tracing = options.trace
    ? {
        apiKey: options.env.ARIZE_API_KEY ?? "",
        spaceId: options.env.ARIZE_SPACE_ID ?? "",
        projectName: options.project,
        region: options.env.ARIZE_REGION,
      }
    : null;
  if (tracing && (!tracing.apiKey || !tracing.spaceId))
    throw new Error("--trace needs ARIZE_API_KEY and ARIZE_SPACE_ID");

  const judge = createJudge(options.judge, options.env);
  let app: LocalApp | null = null;
  let shared: Connection | null = null;
  if (live) {
    const apiUrl = options.env.TWYNE_API_URL;
    const token = options.env.TWYNE_ACCESS_TOKEN;
    if (!apiUrl || !token)
      throw new Error(
        "--target live needs TWYNE_API_URL and TWYNE_ACCESS_TOKEN",
      );
    shared = { apiUrl, token };
    if (tracing) {
      process.env.ARIZE_API_KEY = tracing.apiKey;
      process.env.ARIZE_SPACE_ID = tracing.spaceId;
      process.env.ARIZE_PROJECT_NAME = tracing.projectName;
      if (tracing.region) process.env.ARIZE_REGION = tracing.region;
    }
  } else {
    app = await startLocalApp({
      model: options.model,
      systemOne: options.systemOne,
      research: options.research,
      env: options.env,
      tracing,
    });
  }
  // Registers the OpenInference exporter when the Arize keys are present.
  const { flushArize } = await import("../../convex/arizeTracing");

  const modelLabel = live ? "deployment" : (app?.modelLabel ?? options.model);
  if (options.jev && !app)
    throw new Error(
      "--jev runs Jev and Clairic through the in-process app; use --target local",
    );
  const evaluator = options.jev && app ? app : null;
  const scoreContext = {
    judge,
    jev: evaluator
      ? (((request) => patiently(() => evaluator.judge(request))) as JevAsk)
      : null,
    extract: evaluator
      ? (((request) =>
          patiently(() => evaluator.extract(request))) as ClairicAsk)
      : null,
  };
  const reports: SuiteReport[] = [];
  // Out of credit and an outage look the same from here: the app reports the
  // provider unavailable. Three in a row stops the suite, so a drained wallet
  // ends it cleanly instead of filling the experiment with failures.
  let providerFailures = 0;
  let stopped: string | null = null;

  const writeReport = async (report: SuiteReport) => {
    if (!options.out) return;
    await mkdir(options.out, { recursive: true });
    await writeFile(
      join(options.out, `${report.experiment}.json`),
      JSON.stringify(report, null, 2),
    );
  };

  try {
    for (const suiteName of options.suites) {
      const suite = SUITES[suiteName] as Suite<{ case_id: string }>;
      let cases = suite.load();
      if (options.caseIds?.length)
        cases = cases.filter((c) => options.caseIds?.includes(c.case_id));
      if (options.limit) cases = cases.slice(0, options.limit);
      if (cases.length === 0) continue;

      const base = options.experiment
        ? `${options.experiment}-${suiteName}`
        : `app-${suiteName}-${options.target === "live" ? "live" : options.model}-${stamp()}`;
      const suiteReports: SuiteReport[] = [];

      for (let round = 1; round <= rounds; round++) {
        // A provider that fails one suite's alias can still serve the next.
        providerFailures = 0;
        stopped = null;
        const experiment = rounds > 1 ? `${base}-r${round}` : base;
        log(
          `▸ ${suiteName}${rounds > 1 ? ` (round ${round} of ${rounds})` : ""}: ${cases.length} case(s) via ${suite.surface} → ${modelLabel}`,
        );

        const usageBefore = await app?.usage();
        const suiteStarted = Date.now();
        let sharedMcp: McpDriver | null = null;
        if (shared) sharedMcp = await connectMcp(shared, options.driver);

        type CaseResult = SuiteReport["cases"][number] & {
          testCase: { case_id: string };
        };
        const checkpoint = options.out
          ? join(options.out, `${experiment}.cases.jsonl`)
          : null;
        if (checkpoint) await mkdir(options.out!, { recursive: true });
        let checkpointWrite = Promise.resolve();
        const saveCheckpoint = async (record: Record<string, unknown>) => {
          if (!checkpoint) return;
          checkpointWrite = checkpointWrite.then(() =>
            appendFile(checkpoint, JSON.stringify(record) + "\n"),
          );
          await checkpointWrite;
        };
        const executeCase = async (testCase: {
          case_id: string;
        }): Promise<CaseResult> => {
          const meta = caseMeta(testCase);
          if (stopped)
            return {
              case_id: testCase.case_id,
              ...meta,
              testCase,
              ok: false,
              skipped: true,
              error: stopped,
              latencyMs: 0,
              traceId: null,
              scores: {} as Record<string, Score>,
              output: `[skipped] ${stopped}`,
              raw: null,
            };
          const connection: Connection = shared ?? {
            apiUrl: app!.url,
            token: (await app!.newWriter(testCase.case_id)).token,
            ...(options.driver === "mcp" ? { fetch: app!.fetch } : {}),
          };
          const mcp =
            sharedMcp ?? (await connectMcp(connection, options.driver));
          const started = Date.now();
          try {
            const { value, traceId } = await withCaseSpan(
              {
                suite: suiteName,
                caseId: testCase.case_id,
                experiment,
                input: JSON.stringify(suite.example(testCase)).slice(0, 20_000),
              },
              async () => {
                const client = new TwyneClient({
                  apiUrl: connection.apiUrl,
                  accessToken: connection.token,
                  fetch: connection.fetch,
                });
                const run = await withRetry(live, () =>
                  suite.run({ mcp, connection, client }, testCase),
                );
                return { value: run, output: run.output };
              },
            );
            const latencyMs = Date.now() - started;
            await saveCheckpoint({
              phase: "generated",
              case_id: testCase.case_id,
              ...meta,
              latencyMs,
              traceId,
              raw: value.raw,
              output: value.output,
            });
            const scores = await suite.score(scoreContext, testCase, value.raw);
            providerFailures = 0;
            log(`  ✓ ${testCase.case_id} (${(latencyMs / 1000).toFixed(1)}s)`);
            return {
              case_id: testCase.case_id,
              ...meta,
              testCase,
              ok: true,
              latencyMs,
              traceId,
              scores,
              output: value.output,
              raw: value.raw,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            log(`  ✗ ${testCase.case_id}: ${message}`);
            if (/unavailable|insufficient|quota|credit|402/i.test(message)) {
              providerFailures += 1;
              if (providerFailures >= 3)
                stopped =
                  "stopped after 3 consecutive provider failures (out of credit or provider down)";
            }
            return {
              case_id: testCase.case_id,
              ...meta,
              testCase,
              ok: false,
              error: message,
              latencyMs: Date.now() - started,
              traceId: null,
              scores: {} as Record<string, Score>,
              output: `[error] ${message}`,
              raw: null,
            };
          } finally {
            if (!sharedMcp) await mcp.close();
          }
        };
        const runs = await pool(
          cases,
          live ? 1 : options.concurrency,
          async (testCase) => {
            const result = await executeCase(testCase);
            if (!result.skipped)
              result.scores.harness = {
                score: result.ok ? 1 : 0,
                label: result.ok ? "ran" : "error",
                explanation: result.error,
              };
            const { testCase: _case, ...record } = result;
            await saveCheckpoint({ phase: "scored", ...record });
            return result;
          },
        );
        await sharedMcp?.close();

        const scored: Array<ScoredCase<{ case_id: string }>> = runs
          .filter((r) => r.ok)
          .map((r) => ({ case: r.testCase, raw: r.raw, scores: r.scores }));
        suite.scoreAll?.(scored);
        for (const r of runs)
          if (!r.skipped)
            r.scores.harness = {
              score: r.ok ? 1 : 0,
              label: r.ok ? "ran" : "error",
              explanation: r.error,
            };

        const report: SuiteReport = {
          suite: suiteName,
          surface: suite.surface,
          experiment,
          target: options.target,
          model: modelLabel,
          driver: options.driver,
          judge: judge?.label ?? "none",
          jev: !!evaluator,
          startedAt: new Date(suiteStarted).toISOString(),
          ...(rounds > 1 ? { round: { index: round, of: rounds } } : {}),
          summary: {},
          errors: runs.filter((r) => !r.ok && !r.skipped).length,
          cases: runs.map(({ testCase: _case, ...rest }) => rest),
        };
        report.summary = summarizeCases(suiteName, report.cases);
        report.coverage = Object.fromEntries(
          [...new Set(report.cases.flatMap((c) => Object.keys(c.scores)))].map(
            (metric) => {
              const readings = report.cases.map((c) => c.scores[metric]);
              return [
                metric,
                {
                  scored: readings.filter(
                    (s) =>
                      typeof s?.score === "number" && Number.isFinite(s.score),
                  ).length,
                  missing: readings.filter((s) => !s).length,
                  errors: readings.filter((s) =>
                    /(?:judge|jev|clairic)-error$/.test(s?.label ?? ""),
                  ).length,
                  abstained: readings.filter(
                    (s) =>
                      s &&
                      s.score === null &&
                      !/(?:judge|jev|clairic)-error$/.test(s.label ?? ""),
                  ).length,
                },
              ];
            },
          ),
        );
        const byStrategy = summarizeByFacet(
          suiteName,
          report.cases,
          "strategy",
        );
        if (byStrategy) report.byStrategy = byStrategy;
        const agreement = agreementFor(suiteName, report.cases);
        if (agreement.length) report.agreement = agreement;
        const usageAfter = await app?.usage();
        if (usageBefore && usageAfter) {
          const unpriced = usageAfter.unpriced - usageBefore.unpriced;
          report.usage = {
            calls: usageAfter.calls - usageBefore.calls,
            inputTokens: usageAfter.inputTokens - usageBefore.inputTokens,
            outputTokens: usageAfter.outputTokens - usageBefore.outputTokens,
            unpriced,
            // Not Organic aliases carry no local price; the wallet is the ledger.
            costMicrousd: unpriced
              ? null
              : usageAfter.costMicrousd - usageBefore.costMicrousd,
          };
        }
        if (app && options.model === "notorganic") {
          // Settlement lags the response slightly; give the ledger a moment.
          await sleep(3_000);
          const billed = await app.billed(suiteStarted, Date.now());
          report.billed = billed
            ? {
                microusd: billed.billedMicrousd,
                settled: billed.settledRequests,
                unresolved: billed.unresolvedRequests,
                scope: "account-window",
                truncated: billed.truncated,
              }
            : null;
        }

        // A remote upload must never be the only copy of paid model outputs.
        await writeReport(report);
        if (options.arize && arizeSpace) {
          try {
            const examples = cases.map(
              (c) =>
                suite.example(c) as Record<
                  string,
                  string | number | boolean
                > & { case_id: string },
            );
            const dataset = await ensureDataset(
              { space: arizeSpace },
              `twyne-app-${suiteName}-${corpusHash(examples)}`,
              examples,
            );
            const experimentRuns: ExperimentRun[] = report.cases.flatMap(
              (c) => {
                const exampleId = dataset.examples.get(c.case_id);
                if (!exampleId || c.skipped) return [];
                return [
                  {
                    example_id: exampleId,
                    output: c.output,
                    ok: c.ok,
                    error: c.error,
                    scores: c.scores,
                    metadata: {
                      case_id: c.case_id,
                      target: report.target,
                      app_model: report.model,
                      driver: report.driver,
                      judge: report.judge,
                      latency_ms: c.latencyMs,
                      trace_id: c.traceId,
                    },
                  },
                ];
              },
            );
            const created = await uploadExperiment(
              dataset.id,
              experiment,
              experimentRuns,
            );
            report.arize = {
              dataset: dataset.name,
              datasetId: dataset.id,
              experimentId: created.id,
            };
            log(
              `  ↑ Arize: experiment "${experiment}" on dataset ${dataset.name}`,
            );
            if (created.labelOnly.length)
              log(
                `    uploaded as labels (not every case applies): ${created.labelOnly.join(", ")}`,
              );
          } catch (error) {
            report.uploadError =
              error instanceof Error ? error.message : String(error);
            log(
              `  ! Arize upload failed; local report preserved: ${report.uploadError}`,
            );
          }
        }

        printReport(report, log);
        reports.push(report);
        suiteReports.push(report);
        await writeReport(report);
      }

      // Across rounds and against the baseline, on the last round's report.
      const last = suiteReports[suiteReports.length - 1];
      let amended = false;
      if (suiteReports.length > 1) {
        last.repeatability = repeatability(suiteReports.map((r) => r.cases));
        for (const line of formatRepeatability(last.repeatability)) log(line);
        amended = true;
      }
      const before = baseline?.get(suiteName);
      if (before?.length) {
        last.comparison = comparePaired(
          suiteName,
          averageRuns(before),
          averageRuns(suiteReports as ReportLike[]),
          {
            base: describe(before),
            next: describe(suiteReports as ReportLike[]),
          },
        );
        for (const line of formatComparison(last.comparison)) log(line);
        amended = true;
      } else if (baseline) log(`  (no baseline report for ${suiteName})`);
      if (amended) await writeReport(last);
    }
  } finally {
    await flushArize();
    await app?.close();
  }
  return reports;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      suite: { type: "string", default: "all" },
      target: { type: "string", default: "local" },
      model: { type: "string", default: "mock" },
      "system-one": { type: "string" },
      research: { type: "string" },
      driver: { type: "string", default: "mcp" },
      judge: { type: "string", default: "none" },
      jev: { type: "boolean", default: false },
      case: { type: "string" },
      limit: { type: "string" },
      concurrency: { type: "string", default: "2" },
      repeat: { type: "string", default: "1" },
      baseline: { type: "string" },
      arize: { type: "boolean", default: false },
      "arize-space": { type: "string" },
      trace: { type: "boolean", default: false },
      project: { type: "string", default: "twyne-app-evals" },
      experiment: { type: "string" },
      out: { type: "string" },
      strict: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const suites = (
    values.suite === "all" ? Object.keys(SUITES) : values.suite.split(",")
  )
    .map((s) => s.trim())
    .filter(Boolean) as SuiteName[];
  for (const suite of suites)
    if (!(suite in SUITES)) throw new Error(`Unknown suite: ${suite}`);
  const choice = <T extends string>(
    value: string,
    allowed: readonly T[],
    flag: string,
  ): T => {
    if (!allowed.includes(value as T))
      throw new Error(`--${flag} must be one of ${allowed.join(", ")}`);
    return value as T;
  };
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new Error("--repeat must be a positive integer");
  const reports = await runAppEvals({
    suites,
    target: choice(values.target, ["local", "live"], "target"),
    model: choice(
      values.model,
      ["mock", "openai-compatible", "notorganic"],
      "model",
    ),
    systemOne: values["system-one"]
      ? choice<SystemOneMode>(
          values["system-one"],
          ["mock", "direct", "off"],
          "system-one",
        )
      : undefined,
    research: values.research
      ? choice<ResearchMode>(
          values.research,
          ["mock", "notorganic", "keenable", "custom", "off"],
          "research",
        )
      : undefined,
    driver: choice(values.driver, ["mcp", "mcp-stdio"], "driver"),
    judge: choice(
      values.judge,
      ["none", "notorganic", "openai-compatible"],
      "judge",
    ),
    jev: values.jev,
    caseIds: values.case
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    limit: values.limit ? Number(values.limit) : undefined,
    concurrency: Number(values.concurrency),
    repeat,
    baseline: values.baseline
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    arize: values.arize,
    arizeSpace: values["arize-space"],
    trace: values.trace,
    project: values.project,
    experiment: values.experiment,
    out:
      values.out ??
      join(fileURLToPath(new URL("../../reports/app-evals", import.meta.url))),
    env: { ...process.env },
  });
  const errors = reports.reduce(
    (sum, r) => sum + r.errors + (r.uploadError ? 1 : 0),
    0,
  );
  if (values.strict && errors > 0) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `[twyne:app-evals] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
