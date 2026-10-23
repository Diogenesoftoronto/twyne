/**
 * Reading app eval reports back: for `--baseline`, and for `compare.ts`.
 *
 * A report spec is a report file, a directory of them, or a path prefix
 * (`reports/app-evals/notorganic-fixed-20261023` picks up every suite of that
 * run). Several reports of one suite, such as the rounds of `--repeat`, merge
 * into one case per case_id holding each metric's mean across the runs, which
 * is the less noisy baseline to compare against.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { metricValue, type CaseLike } from "./stats";

/** The parts of a report this module reads; run.ts's SuiteReport fits it. */
export interface ReportLike {
  suite: string;
  experiment?: string;
  model?: string;
  judge?: string;
  startedAt?: string;
  cases: CaseLike[];
}

export function reportPaths(spec: string): string[] {
  if (existsSync(spec) && statSync(spec).isDirectory())
    return readdirSync(spec)
      .filter(
        (name) =>
          name.endsWith(".json") && !name.endsWith("-repeatability.json"),
      )
      .sort()
      .map((name) => join(spec, name));
  if (existsSync(spec)) return [spec];
  const dir = dirname(spec);
  const prefix = basename(spec);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith(".json") &&
        !name.endsWith("-repeatability.json"),
    )
    .sort()
    .map((name) => join(dir, name));
}

export function readReports(specs: string[]): ReportLike[] {
  const paths = [...new Set(specs.flatMap(reportPaths))];
  if (!paths.length)
    throw new Error(`No reports found for ${specs.join(", ")}`);
  return paths.flatMap((path) => {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as
      | ReportLike
      | ReportLike[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter(
      (r) => r && typeof r.suite === "string" && Array.isArray(r.cases),
    );
  });
}

export function bySuite(reports: ReportLike[]): Map<string, ReportLike[]> {
  const out = new Map<string, ReportLike[]>();
  for (const report of reports)
    out.set(report.suite, [...(out.get(report.suite) ?? []), report]);
  return out;
}

/**
 * One case per case_id across several runs of a suite: each metric's score
 * is its mean over successful runs that scored it; harness includes failures.
 * Labels, items and raw output come from the first successful run when present.
 */
export function averageRuns(reports: ReportLike[]): CaseLike[] {
  if (reports.length === 1) return reports[0].cases;
  const merged = new Map<
    string,
    { first: CaseLike; sums: Map<string, { total: number; n: number }> }
  >();
  for (const report of reports)
    for (const c of report.cases) {
      if (c.skipped) continue;
      const entry = merged.get(c.case_id) ?? { first: c, sums: new Map() };
      if (entry.first.ok === false && c.ok !== false) entry.first = c;
      for (const name of Object.keys(c.scores)) {
        const value = metricValue(c, name);
        if (value === null) continue;
        const sum = entry.sums.get(name) ?? { total: 0, n: 0 };
        sum.total += value;
        sum.n += 1;
        entry.sums.set(name, sum);
      }
      merged.set(c.case_id, entry);
    }
  return [...merged.values()].map(({ first, sums }) => ({
    ...first,
    scores: Object.fromEntries(
      [...new Set([...Object.keys(first.scores), ...sums.keys()])].map(
        (name) => {
          const sum = sums.get(name);
          const score = first.scores[name] ?? { score: null };
          return [
            name,
            sum
              ? { ...score, score: sum.total / sum.n }
              : { ...score, score: null },
          ];
        },
      ),
    ),
  }));
}

export function describe(reports: ReportLike[]): string {
  const first = reports[0];
  const name = first.experiment ?? first.suite;
  return reports.length > 1
    ? `${name} (+${reports.length - 1} more run(s), averaged)`
    : name;
}
