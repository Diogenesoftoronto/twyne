/**
 * Statistics for app eval reports: how much a suite mean can be trusted, and
 * whether a change between two runs is bigger than the noise.
 *
 *  - Every metric mean carries a 95% interval. Cases that share a draft or a
 *    strong/weak pair are not independent (a pair-order score is copied onto
 *    both cases of its pair), so the standard error is cluster-robust and the
 *    interval's degrees of freedom count clusters, not cases. The interval is
 *    Wilson's on an effective sample size, which stays inside 0..1 and stays
 *    honest at 10/10 or nine 1s and a 0.8 (see `summarizeValues`).
 *  - Two runs are compared case by case. The delta's interval is the same
 *    cluster-robust t interval; the p-value comes from an exact sign-flip test
 *    over clusters, which makes no normality assumption and cannot call three
 *    flipped cases significant. A change is flagged only when both agree.
 *  - Evaluators that measure the same thing (Jev, the LLM judge, a
 *    deterministic check) are compared on the cases where all of them scored.
 *  - Repeated runs of one suite split the noise into run-to-run variance and
 *    differences between cases.
 */
import type { Score } from "./scoring";

/** The parts of a report case these statistics read. */
export interface CaseLike {
  case_id: string;
  /** Cases that are not independent share a cluster (a pair, a draft). */
  cluster?: string;
  /** Case attributes worth slicing by (quality, strategy, level). */
  facets?: Record<string, string>;
  ok?: boolean;
  skipped?: boolean;
  scores: Record<string, Score>;
  raw?: unknown;
}

export interface MetricSummary {
  mean: number | null;
  /** Cases with a score. */
  n: number;
  /** 95% interval for the mean; null with fewer than two clusters. */
  ci?: [number, number] | null;
  /** Cluster-robust standard error of the mean. */
  se?: number | null;
  /** Standard deviation across cases. */
  sd?: number | null;
  /** Independent units behind the mean: cases, or pairs and drafts. */
  clusters?: number;
  /**
   * The number of independent pass/fail trials that would pin the mean down
   * as tightly as these cases do: more than n when each case averages several
   * readings (five notes, four weaknesses), fewer when cases are clustered.
   */
  effectiveN?: number | null;
  /** `wilson`: z critical value; `wilson-t`: t on clusters − 1 degrees of freedom. */
  method?: "wilson" | "wilson-t" | null;
}

export const Z95 = 1.959963984540054;

/** Two-sided 95% critical values of Student's t for 1-30 degrees of freedom. */
const T975 = [
  Number.NaN,
  12.7062,
  4.3027,
  3.1824,
  2.7764,
  2.5706,
  2.4469,
  2.3646,
  2.306,
  2.2622,
  2.2281,
  2.201,
  2.1788,
  2.1604,
  2.1448,
  2.1314,
  2.1199,
  2.1098,
  2.1009,
  2.093,
  2.086,
  2.0796,
  2.0739,
  2.0687,
  2.0639,
  2.0595,
  2.0555,
  2.0518,
  2.0484,
  2.0452,
  2.0423,
];

/** The 97.5th percentile of Student's t with `df` degrees of freedom. */
export function tCritical(df: number): number {
  if (!(df >= 1)) return Number.NaN;
  if (df <= 30 && Number.isInteger(df)) return T975[df];
  // Cornish-Fisher expansion; within 1e-4 of the exact value above 30.
  const z = Z95;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
  );
}

/** Wilson score interval for a proportion `p` observed on `n` trials. */
export function wilson(p: number, n: number, z = Z95): [number, number] {
  if (!(n > 0)) return [0, 1];
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  // At 0/n or n/n one end is exact; do not let rounding move it.
  return [
    p <= 0 ? 0 : Math.max(0, center - half),
    p >= 1 ? 1 : Math.min(1, center + half),
  ];
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function average(values: number[]): number {
  return sum(values) / values.length;
}

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = average(values);
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Cluster-robust (CR1) standard error of a mean. With one case per cluster
 * it is the ordinary s/√n.
 */
export function clusterSe(
  values: number[],
  clusters: string[],
): { se: number | null; clusters: number } {
  const n = values.length;
  const totals = new Map<string, number>();
  if (n === 0) return { se: null, clusters: 0 };
  const m = average(values);
  values.forEach((v, i) =>
    totals.set(clusters[i], (totals.get(clusters[i]) ?? 0) + (v - m)),
  );
  const g = totals.size;
  if (g < 2) return { se: null, clusters: g };
  let squares = 0;
  for (const total of totals.values()) squares += total * total;
  return { se: Math.sqrt((g / (g - 1)) * squares) / n, clusters: g };
}

/**
 * Mean, spread and 95% interval of one metric over the cases that have it.
 *
 * Every score lives on 0..1 and many sit near an end (nine notes of ten
 * rated good), where a t interval on a handful of cases is far too narrow.
 * So the interval is Wilson's, on an effective sample size: the number of
 * pass/fail trials with the same variance of the mean, p(1 − p) / se², with
 * se cluster-robust (Korn and Graubard's interval for clustered proportions).
 * When the variance is estimated rather than implied by the mean, the
 * critical value is t on clusters − 1 degrees of freedom. Independent
 * pass/fail cases get the plain Wilson interval. When every value is the
 * same there is no design effect to estimate; count independent clusters.
 */
export function summarizeValues(
  points: Array<{ value: number | null | undefined; cluster: string }>,
): MetricSummary {
  const present = points.filter(
    (p): p is { value: number; cluster: string } =>
      typeof p.value === "number" && Number.isFinite(p.value),
  );
  const n = present.length;
  if (n === 0)
    return {
      mean: null,
      n: 0,
      ci: null,
      se: null,
      sd: null,
      clusters: 0,
      effectiveN: null,
      method: null,
    };
  const values = present.map((p) => p.value);
  const mean = average(values);
  const sd = sampleSd(values);
  const { se, clusters } = clusterSe(
    values,
    present.map((p) => p.cluster),
  );
  if (clusters < 2 || se === null)
    return {
      mean,
      n,
      ci: null,
      se: null,
      sd,
      clusters,
      effectiveN: null,
      method: null,
    };

  const p = clamp01(mean);
  const binary = values.every((v) => v === 0 || v === 1);
  // No variation cannot establish independence within a cluster. Use the
  // independent cluster count, invariant under within-cluster duplication.
  if (se === 0 || p * (1 - p) === 0)
    return {
      mean,
      n,
      ci: wilson(p, clusters),
      se,
      sd,
      clusters,
      effectiveN: clusters,
      method: "wilson",
    };
  if (binary && clusters === n)
    return {
      mean,
      n,
      ci: wilson(p, n),
      se,
      sd,
      clusters,
      effectiveN: n,
      method: "wilson",
    };
  const effectiveN = (p * (1 - p)) / (se * se);
  return {
    mean,
    n,
    ci: wilson(p, effectiveN, tCritical(clusters - 1)),
    se,
    sd,
    clusters,
    effectiveN,
    method: "wilson-t",
  };
}

/* ── Clusters and facets ─────────────────────────────────────────── */

/**
 * The cluster a case belongs to. Reports written since clusters were
 * recorded carry it; older ones are read from the case_id conventions:
 * research cases are `<draft>:<claim or strategy>`, rubric cases end in
 * `-strong` or `-weak`.
 */
export function clusterOf(suite: string, c: CaseLike): string {
  if (c.cluster) return c.cluster;
  if (suite.startsWith("research") && c.case_id.includes(":"))
    return c.case_id.slice(0, c.case_id.indexOf(":"));
  if (suite === "rubric") return c.case_id.replace(/-(strong|weak)$/, "");
  return c.case_id;
}

/** A case attribute, with the same fallback for reports that predate facets. */
export function facetOf(
  suite: string,
  c: CaseLike,
  name: string,
): string | undefined {
  const recorded = c.facets?.[name];
  if (recorded !== undefined) return recorded;
  if (suite === "rubric" && name === "quality")
    return c.case_id.match(/-(strong|weak)$/)?.[1];
  if (suite === "research-targets" && name === "strategy")
    return c.case_id.match(/:(hosted|model)$/)?.[1];
  return undefined;
}

/** Quality is conditional on execution; harness measures execution itself. */
export function metricValue(
  c: Pick<CaseLike, "ok" | "scores">,
  name: string,
): number | null {
  if (name === "harness") {
    const value = c.scores.harness?.score;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return c.ok === undefined ? null : c.ok ? 1 : 0;
  }
  if (c.ok === false) return null;
  const value = c.scores[name]?.score;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scored(c: CaseLike): boolean {
  return !c.skipped;
}

/**
 * Is this metric copied across each cluster rather than measured per case?
 * Older rubric reports did not mark their pair orderings, so those are
 * recognised by name.
 */
export function sharedMetric(
  suite: string,
  name: string,
  cases: CaseLike[],
): boolean {
  return (
    cases.some((c) => c.scores[name]?.sharedByCluster) ||
    (suite === "rubric" && /_order$/.test(name))
  );
}

/** Every metric in a suite's cases, with a cluster-aware interval. */
export function summarizeCases(
  suite: string,
  cases: CaseLike[],
): Record<string, MetricSummary> {
  const live = cases.filter(scored);
  const names = [...new Set(live.flatMap((c) => Object.keys(c.scores)))];
  return Object.fromEntries(
    names.map((name) => {
      let points = live.map((c) => ({
        value: metricValue(c, name),
        cluster: clusterOf(suite, c),
      }));
      if (sharedMetric(suite, name, live)) {
        const seen = new Set<string>();
        points = points.filter((p) => {
          if (typeof p.value !== "number" || seen.has(p.cluster)) return false;
          seen.add(p.cluster);
          return true;
        });
      }
      return [name, summarizeValues(points)];
    }),
  );
}

/**
 * The same summary for each value of a facet, when the cases carry two or
 * more values of it: research-targets' two strategies are two systems, and
 * their pooled mean describes neither.
 */
export function summarizeByFacet(
  suite: string,
  cases: CaseLike[],
  facet: string,
): Record<string, Record<string, MetricSummary>> | null {
  const values = [
    ...new Set(
      cases
        .map((c) => facetOf(suite, c, facet))
        .filter((v): v is string => !!v),
    ),
  ];
  if (values.length < 2) return null;
  return Object.fromEntries(
    values.sort().map((value) => [
      value,
      summarizeCases(
        suite,
        cases.filter((c) => facetOf(suite, c, facet) === value),
      ),
    ]),
  );
}

/* ── Paired comparison of two runs ───────────────────────────────── */

/** A seeded PRNG, so a Monte Carlo p-value is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two-sided sign-flip (permutation) test that the paired differences are
 * centred on zero. `totals` holds one summed difference per cluster. Exact up
 * to 16 non-zero clusters, Monte Carlo beyond.
 */
export function signFlipP(totals: number[], draws = 20_000): number {
  const nonzero = totals.filter((d) => Math.abs(d) > 1e-12);
  const k = nonzero.length;
  if (k === 0) return 1;
  const observed = Math.abs(sum(nonzero)) - 1e-9;
  let extreme = 0;
  if (k <= 16) {
    const all = 1 << k;
    for (let mask = 0; mask < all; mask++) {
      let s = 0;
      for (let j = 0; j < k; j++)
        s += mask & (1 << j) ? -nonzero[j] : nonzero[j];
      if (Math.abs(s) >= observed) extreme++;
    }
    return extreme / all;
  }
  const random = mulberry32(0x7779e);
  for (let r = 0; r < draws; r++) {
    let s = 0;
    for (const d of nonzero) s += random() < 0.5 ? -d : d;
    if (Math.abs(s) >= observed) extreme++;
  }
  return (extreme + 1) / (draws + 1);
}

/** Benjamini-Hochberg adjusted p-values (q), nulls left in place. */
export function benjaminiHochberg(
  ps: Array<number | null>,
): Array<number | null> {
  const ranked = ps
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => typeof x.p === "number")
    .sort((a, b) => a.p - b.p);
  const q: Array<number | null> = ps.map(() => null);
  let running = 1;
  for (let r = ranked.length - 1; r >= 0; r--) {
    running = Math.min(running, (ranked[r].p * ranked.length) / (r + 1));
    q[ranked[r].i] = running;
  }
  return q;
}

export interface MetricDelta {
  metric: string;
  /** Cases scored in both runs. */
  n: number;
  clusters: number;
  /** Means over the paired cases only. */
  base: number | null;
  next: number | null;
  delta: number | null;
  ci: [number, number] | null;
  /** Sign-flip test over clusters. */
  p: number | null;
  /** Benjamini-Hochberg across the metrics of this comparison. */
  q: number | null;
  /** Up or down beyond noise: the CI excludes zero and p < 0.05. */
  flag: "up" | "down" | null;
}

export interface Comparison {
  suite: string;
  base: string;
  next: string;
  /** Cases present in only one run are left out of every delta. */
  pairedCases: number;
  onlyBase: number;
  onlyNext: number;
  metrics: MetricDelta[];
}

export function comparePaired(
  suite: string,
  baseCases: CaseLike[],
  nextCases: CaseLike[],
  labels: { base: string; next: string } = {
    base: "baseline",
    next: "this run",
  },
): Comparison {
  const base = new Map(baseCases.filter(scored).map((c) => [c.case_id, c]));
  const next = new Map(nextCases.filter(scored).map((c) => [c.case_id, c]));
  const shared = [...next.keys()].filter((id) => base.has(id));
  const names = [
    ...new Set(
      shared
        .flatMap((id) => Object.keys(next.get(id)!.scores))
        .filter((name) =>
          shared.some((id) => base.get(id)!.scores[name] !== undefined),
        ),
    ),
  ];
  const metrics: MetricDelta[] = names.map((metric) => {
    const rows = shared.flatMap((id) => {
      const a = metricValue(base.get(id)!, metric);
      const b = metricValue(next.get(id)!, metric);
      return typeof a === "number" && typeof b === "number"
        ? [{ a, b, cluster: clusterOf(suite, next.get(id)!) }]
        : [];
    });
    if (!rows.length)
      return {
        metric,
        n: 0,
        clusters: 0,
        base: null,
        next: null,
        delta: null,
        ci: null,
        p: null,
        q: null,
        flag: null,
      };
    const deltas = rows.map((r) => r.b - r.a);
    const clusters = rows.map((r) => r.cluster);
    const delta = average(deltas);
    const { se, clusters: g } = clusterSe(deltas, clusters);
    const totals = new Map<string, number>();
    rows.forEach((r, i) =>
      totals.set(r.cluster, (totals.get(r.cluster) ?? 0) + deltas[i]),
    );
    const p = signFlipP([...totals.values()]);
    // Scores live on 0..1, so no difference can leave −1..1.
    const ci: [number, number] | null =
      se === null
        ? null
        : [
            Math.max(-1, delta - tCritical(g - 1) * se),
            Math.min(1, delta + tCritical(g - 1) * se),
          ];
    const beyond = ci !== null && p < 0.05 && (ci[0] > 0 || ci[1] < 0);
    return {
      metric,
      n: rows.length,
      clusters: g,
      base: average(rows.map((r) => r.a)),
      next: average(rows.map((r) => r.b)),
      delta,
      ci,
      p,
      q: null,
      flag: beyond ? (delta > 0 ? "up" : "down") : null,
    };
  });
  const q = benjaminiHochberg(metrics.map((m) => m.p));
  metrics.forEach((m, i) => (m.q = q[i]));
  return {
    suite,
    base: labels.base,
    next: labels.next,
    pairedCases: shared.length,
    onlyBase: [...base.keys()].filter((id) => !next.has(id)).length,
    onlyNext: [...next.keys()].filter((id) => !base.has(id)).length,
    metrics,
  };
}

/* ── Agreement between evaluators ────────────────────────────────── */

export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = average(x);
  const my = average(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    for (let k = i; k <= j; k++) out[order[k].i] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(x: number[], y: number[]): number | null {
  return pearson(ranks(x), ranks(y));
}

/** Fisher-z 95% interval for a correlation. */
export function correlationCi(
  r: number | null,
  n: number,
): [number, number] | null {
  if (r === null || n <= 3 || Math.abs(r) >= 1) return null;
  const z = Math.atanh(r);
  const half = Z95 / Math.sqrt(n - 3);
  return [Math.tanh(z - half), Math.tanh(z + half)];
}

/** Cohen's kappa after reading each value as pass (>= 0.5) or fail. */
export function kappa(
  x: number[],
  y: number[],
): { agree: number | null; kappa: number | null } {
  const n = x.length;
  if (!n) return { agree: null, kappa: null };
  const a = x.map((v) => v >= 0.5);
  const b = y.map((v) => v >= 0.5);
  const agree = a.filter((v, i) => v === b[i]).length / n;
  const pa = a.filter(Boolean).length / n;
  const pb = b.filter(Boolean).length / n;
  const chance = pa * pb + (1 - pa) * (1 - pb);
  return { agree, kappa: chance < 1 ? (agree - chance) / (1 - chance) : null };
}

export interface AgreementPair {
  a: string;
  b: string;
  n: number;
  pearson: number | null;
  pearsonCi: [number, number] | null;
  spearman: number | null;
  /** Share of cases both evaluators put on the same side of 0.5. */
  agree: number | null;
  kappa: number | null;
  /** Mean of a − b: which evaluator reads higher. */
  meanDiff: number | null;
}

export function agreementPair(
  a: string,
  b: string,
  x: number[],
  y: number[],
): AgreementPair {
  const r = pearson(x, y);
  const { agree, kappa: k } = kappa(x, y);
  return {
    a,
    b,
    n: x.length,
    pearson: r,
    pearsonCi: correlationCi(r, x.length),
    spearman: spearman(x, y),
    agree,
    kappa: k,
    meanDiff: x.length ? average(x.map((v, i) => v - y[i])) : null,
  };
}

/**
 * How well a reading separates known-good from known-bad cases: the chance a
 * random good case outscores a random bad one (ties count half).
 */
export function auc(good: number[], bad: number[]): number | null {
  if (!good.length || !bad.length) return null;
  let wins = 0;
  for (const g of good)
    for (const b of bad) wins += g > b ? 1 : g === b ? 0.5 : 0;
  return wins / (good.length * bad.length);
}

/* ── Repeatability across repeated runs ──────────────────────────── */

export interface Repeatability {
  metric: string;
  runs: number;
  /** Cases scored in every run. */
  cases: number;
  runMeans: number[];
  /** Standard deviation of the suite mean from run to run. */
  sdOfRunMeans: number | null;
  /** Pooled standard deviation of one case's score across runs. */
  withinCaseSd: number | null;
  /** What run-to-run noise alone does to a suite mean: withinCaseSd / √cases. */
  noiseSe: number | null;
  /** ICC(1): the share of score variance due to real differences between cases. */
  icc: number | null;
}

export function repeatability(runs: CaseLike[][]): Repeatability[] {
  const k = runs.length;
  if (k < 2) return [];
  const byId = runs.map(
    (cases) => new Map(cases.filter(scored).map((c) => [c.case_id, c])),
  );
  const names = [
    ...new Set(
      runs.flatMap((cases) => cases.flatMap((c) => Object.keys(c.scores))),
    ),
  ];
  return names.map((metric) => {
    const ids = [...byId[0].keys()].filter((id) =>
      byId.every((m) => m.has(id) && metricValue(m.get(id)!, metric) !== null),
    );
    const grid = ids.map((id) =>
      byId.map((m) => metricValue(m.get(id)!, metric) as number),
    );
    const n = grid.length;
    const runMeans = byId.map((_, r) =>
      n ? average(grid.map((row) => row[r])) : Number.NaN,
    );
    if (n < 2)
      return {
        metric,
        runs: k,
        cases: n,
        runMeans,
        sdOfRunMeans: null,
        withinCaseSd: null,
        noiseSe: null,
        icc: null,
      };
    const caseMeans = grid.map(average);
    const grand = average(caseMeans);
    const msw =
      sum(grid.map((row, i) => sum(row.map((v) => (v - caseMeans[i]) ** 2)))) /
      (n * (k - 1));
    const msb = (k * sum(caseMeans.map((m) => (m - grand) ** 2))) / (n - 1);
    const denominator = msb + (k - 1) * msw;
    return {
      metric,
      runs: k,
      cases: n,
      runMeans,
      sdOfRunMeans: sampleSd(runMeans),
      withinCaseSd: Math.sqrt(msw),
      noiseSe: Math.sqrt(msw / n),
      icc: denominator > 0 ? (msb - msw) / denominator : null,
    };
  });
}

/* ── Formatting ──────────────────────────────────────────────────── */

const fixed = (x: number | null | undefined, digits = 2) =>
  typeof x === "number" && Number.isFinite(x) ? x.toFixed(digits) : "-";
const signed = (x: number | null | undefined, digits = 2) =>
  typeof x === "number" && Number.isFinite(x)
    ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`
    : "-";

export function formatInterval(
  ci: [number, number] | null | undefined,
  sign = false,
): string {
  if (!ci) return "";
  const f = sign ? signed : fixed;
  return `[${f(ci[0])}, ${f(ci[1])}]`;
}

/** One printed line per metric: mean, 95% interval, cases and clusters. */
export function formatSummaryLines(
  summary: Record<string, MetricSummary>,
): string[] {
  return Object.entries(summary).map(([name, s]) => {
    const mean = s.mean === null ? "   -" : s.mean.toFixed(2);
    const ci = formatInterval(s.ci).padEnd(14);
    const units =
      s.clusters !== undefined && s.clusters < s.n
        ? `n=${s.n}, ${s.clusters} cluster${s.clusters === 1 ? "" : "s"}`
        : `n=${s.n}`;
    return `  ${name.padEnd(24)} ${mean}  ${ci} (${units})`;
  });
}

export function formatComparison(comparison: Comparison): string[] {
  const lines = [
    `  vs ${comparison.base}: ${comparison.pairedCases} case(s) paired by case_id` +
      (comparison.onlyBase || comparison.onlyNext
        ? ` (${comparison.onlyBase} only in the baseline, ${comparison.onlyNext} only here)`
        : ""),
    `    ${"metric".padEnd(24)} ${"base".padStart(5)} ${"now".padStart(5)} ${"Δ".padStart(6)}  ${"95% CI".padEnd(16)} ${"p".padStart(5)}`,
  ];
  if (comparison.metrics.some((m) => m.n > 0 && m.clusters < 5))
    lines.push(
      "    (fewer than five clusters paired: intervals are too wide to call any change)",
    );
  for (const m of comparison.metrics) {
    const mark = m.flag === "up" ? "▲" : m.flag === "down" ? "▼" : "";
    lines.push(
      `    ${m.metric.padEnd(24)} ${fixed(m.base).padStart(5)} ${fixed(m.next).padStart(5)} ${signed(m.delta).padStart(6)}  ${formatInterval(m.ci, true).padEnd(16)} ${fixed(m.p).padStart(5)} ${mark}`.trimEnd(),
    );
  }
  const moved = comparison.metrics.filter((m) => m.flag);
  const survive = moved.filter((m) => (m.q ?? 1) < 0.05);
  lines.push(
    `    ${moved.length} of ${comparison.metrics.length} metric(s) moved beyond noise (CI excludes 0 and sign-flip p < 0.05)` +
      (moved.length
        ? `; ${survive.length} survive Benjamini-Hochberg at q < 0.05`
        : ""),
  );
  return lines;
}

export function formatRepeatability(rows: Repeatability[]): string[] {
  if (!rows.length) return [];
  const lines = [
    `  run-to-run variance over ${rows[0].runs} runs`,
    `    ${"metric".padEnd(24)} ${"run means".padEnd(22)} ${"sd(mean)".padStart(8)} ${"case sd".padStart(8)} ${"noise se".padStart(8)} ${"icc".padStart(5)}`,
  ];
  for (const r of rows)
    lines.push(
      `    ${r.metric.padEnd(24)} ${r.runMeans
        .map((m) => fixed(m))
        .join(" ")
        .padEnd(
          22,
        )} ${fixed(r.sdOfRunMeans, 3).padStart(8)} ${fixed(r.withinCaseSd, 3).padStart(8)} ${fixed(r.noiseSe, 3).padStart(8)} ${fixed(r.icc).padStart(5)}`,
    );
  return lines;
}
