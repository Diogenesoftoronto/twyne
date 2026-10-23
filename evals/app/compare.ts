/**
 * Read app eval reports back and say what they support.
 *
 *   bun evals/app/compare.ts BASE NEXT            # did anything move beyond noise?
 *   bun evals/app/compare.ts --stats REPORTS...    # 95% intervals and evaluator agreement
 *   bun evals/app/compare.ts --repeat REPORTS...   # run-to-run variance of one suite
 *
 * BASE, NEXT and REPORTS are report files, directories or path prefixes, so
 * `reports/app-evals/notorganic-full-20261023` names every suite of that run.
 * Several runs of a suite on one side of a comparison are averaged per case.
 * Reports written before intervals and clusters were recorded are read too:
 * the statistics are recomputed from the cases.
 */
import { parseArgs } from "node:util";
import { agreementFor, formatAgreement } from "./agreement";
import {
  averageRuns,
  bySuite,
  describe,
  readReports,
  type ReportLike,
} from "./reports";
import {
  comparePaired,
  formatComparison,
  formatRepeatability,
  formatSummaryLines,
  repeatability,
  facetOf,
  summarizeByFacet,
  summarizeCases,
} from "./stats";

const HELP = `Compare Twyne app eval reports

Usage:
  bun evals/app/compare.ts BASE NEXT           paired by case_id, per suite in both
  bun evals/app/compare.ts --stats SPECS...    per-metric 95% intervals and evaluator agreement
  bun evals/app/compare.ts --repeat SPECS...   run-to-run variance across runs of each suite

  SPECS are report files, directories or path prefixes; commas also separate them.
  --suite NAMES   only these suites
  --by FACET      also split by a case facet: strategy, quality, level, personaId, mode
  --json          print JSON instead of tables
`;

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      stats: { type: "boolean", default: false },
      repeat: { type: "boolean", default: false },
      suite: { type: "string" },
      by: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || !positionals.length) {
    console.log(HELP);
    return;
  }
  const specs = positionals
    .flatMap((p) => p.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const only = values.suite?.split(",").map((s) => s.trim());
  const keep = (reports: ReportLike[]) =>
    only ? reports.filter((r) => only.includes(r.suite)) : reports;
  const out: unknown[] = [];
  const print = (line: string) => {
    if (!values.json) console.log(line);
  };

  if (values.stats) {
    for (const report of keep(readReports(specs))) {
      const summary = summarizeCases(report.suite, report.cases);
      const by = values.by
        ? summarizeByFacet(report.suite, report.cases, values.by)
        : null;
      const agreement = agreementFor(report.suite, report.cases);
      out.push({
        suite: report.suite,
        experiment: report.experiment,
        summary,
        by,
        agreement,
      });
      print(
        `\n${report.suite} — ${report.experiment ?? "?"} — ${report.cases.length} case(s)`,
      );
      print(`  ${"metric".padEnd(24)} mean  95% CI`);
      for (const line of formatSummaryLines(summary)) print(line);
      for (const [value, part] of Object.entries(by ?? {})) {
        print(`  ${values.by} ${value}`);
        for (const line of formatSummaryLines(part)) print(`  ${line}`);
      }
      for (const line of formatAgreement(agreement)) print(line);
    }
  } else if (values.repeat) {
    for (const [suite, runs] of bySuite(keep(readReports(specs)))) {
      if (runs.length < 2) {
        print(`\n${suite}: one run only; variance needs two or more`);
        continue;
      }
      const rows = repeatability(runs.map((r) => r.cases));
      out.push({
        suite,
        runs: runs.map((r) => r.experiment),
        repeatability: rows,
      });
      print(`\n${suite} — ${runs.length} runs`);
      for (const line of formatRepeatability(rows)) print(line);
    }
  } else {
    if (positionals.length !== 2)
      throw new Error("A comparison takes two specs: BASE NEXT");
    const base = bySuite(keep(readReports([positionals[0]])));
    const next = bySuite(keep(readReports([positionals[1]])));
    for (const [suite, nextRuns] of next) {
      const baseRuns = base.get(suite);
      if (!baseRuns) {
        print(`\n${suite}: not in the baseline`);
        continue;
      }
      const baseCases = averageRuns(baseRuns);
      const nextCases = averageRuns(nextRuns);
      const labels = { base: describe(baseRuns), next: describe(nextRuns) };
      const comparison = comparePaired(suite, baseCases, nextCases, labels);
      out.push(comparison);
      print(`\n${suite} — ${describe(nextRuns)}`);
      for (const line of formatComparison(comparison)) print(line);
      const facet = values.by;
      if (facet) {
        const levels = [
          ...new Set(
            nextCases
              .map((c) => facetOf(suite, c, facet))
              .filter((v): v is string => !!v),
          ),
        ];
        for (const level of levels.sort()) {
          const pick = (cases: typeof nextCases) =>
            cases.filter((c) => facetOf(suite, c, facet) === level);
          const part = comparePaired(
            suite,
            pick(baseCases),
            pick(nextCases),
            labels,
          );
          out.push({ ...part, facet: { [facet]: level } });
          print(`  ${facet} ${level}`);
          for (const line of formatComparison(part)) print(`  ${line}`);
        }
      }
    }
  }
  if (values.json) console.log(JSON.stringify(out, null, 2));
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(
      `[twyne:app-evals] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
