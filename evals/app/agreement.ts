/**
 * Which evaluators measure the same thing, suite by suite, and how far they
 * agree on the cases where all of them scored.
 *
 * An evaluator is one way of reading a construct: the LLM judge, Jev,
 * Clairic, a deterministic check, the app's own grade, or a label the corpus
 * planted. Agreement is computed on common support only (every evaluator
 * present), so a disagreement is never an artefact of different cases.
 * Item-level constructs compare per weakness, per fact, per drift, per note
 * or per field, which gives several readings per case; their n counts items,
 * and items of one case are not independent, so read their intervals as
 * optimistic. Where a construct has a planted answer (strong or weak drafts),
 * each evaluator's AUC says how well it separates the two, which is the most
 * direct evidence of whether to trust it.
 *
 * Specs read finished report cases, so they work on any report, including
 * ones written before the evaluators existed (they are skipped).
 */
import type { CaseLike } from "./stats";
import { agreementPair, auc, type AgreementPair } from "./stats";

type Reading = number | null | undefined | Record<string, number>;

export interface Evaluator {
  name: string;
  kind: "llm" | "jev" | "clairic" | "deterministic" | "app" | "corpus";
  read: (c: CaseLike) => Reading;
}

export interface Construct {
  name: string;
  level: "case" | "item";
  evaluators: Evaluator[];
  /** A planted answer the evaluators should separate (case level, 0 or 1). */
  gold?: { name: string; read: (c: CaseLike) => 0 | 1 | null };
}

const metric = (
  name: string,
  kind: Evaluator["kind"],
  as = name,
): Evaluator => ({
  name: as,
  kind,
  read: (c) => c.scores[name]?.score,
});

const itemsOf = (
  name: string,
  kind: Evaluator["kind"],
  as = name,
): Evaluator => ({
  name: as,
  kind,
  read: (c) => c.scores[name]?.items,
});

/**
 * Per-item readings recovered from an explanation such as
 * "devil: level 4; angel: level 3", for suites that do not record items.
 */
export function parseExplained(
  explanation: string | undefined,
  value: (label: string) => number | null,
): Record<string, number> | undefined {
  if (!explanation) return undefined;
  const out: Record<string, number> = {};
  for (const part of explanation.split(";")) {
    const match = part.trim().match(/^([\w-]+):\s*(.+)$/);
    if (!match) continue;
    const v = value(match[2].trim());
    if (v !== null && Number.isFinite(v)) out[match[1]] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const explained = (
  name: string,
  kind: Evaluator["kind"],
  value: (label: string) => number | null,
  as = name,
): Evaluator => ({
  name: as,
  kind,
  read: (c) => parseExplained(c.scores[name]?.explanation, value),
});

const level = (scale: (x: number) => number) => (label: string) => {
  const x = Number(label.match(/^level ([\d.]+)$/)?.[1]);
  return Number.isFinite(x) ? scale(x) : null;
};

const labelled = (map: Record<string, number>) => (label: string) =>
  label in map ? map[label] : null;

/** An app judgement on 1..10, scaled to 0..1. */
const appDimension = (key: string, as: string): Evaluator => ({
  name: as,
  kind: "app",
  read: (c) => {
    const score = (
      c.raw as Record<string, { score?: unknown } | undefined> | null
    )?.[key]?.score;
    return typeof score === "number" ? (score - 1) / 9 : null;
  },
});

const strongDraft = {
  name: "planted quality (strong=1, weak=0)",
  read: (c: CaseLike): 0 | 1 | null => {
    const quality =
      c.facets?.quality ?? c.case_id.match(/-(strong|weak)$/)?.[1];
    return quality === "strong" ? 1 : quality === "weak" ? 0 : null;
  },
};

const BRIEF = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

export const CONSTRUCTS: Record<string, Construct[]> = {
  room: [
    {
      name: "note value",
      level: "case",
      evaluators: [
        metric("note_value", "llm"),
        metric("jev_note_value", "jev"),
      ],
    },
    {
      name: "note value, per note",
      level: "item",
      evaluators: [
        explained(
          "note_value",
          "llm",
          level((x) => (x - 1) / 4),
        ),
        explained(
          "jev_note_value",
          "jev",
          level((x) => x / 4),
        ),
      ],
    },
    {
      name: "note is grounded in the draft, per note",
      level: "item",
      evaluators: [
        explained("faithfulness", "llm", labelled({ grounded: 1, generic: 0 })),
        explained("jev_grounded", "jev", labelled({ yes: 1, no: 0 })),
      ],
    },
  ],
  rubric: [
    {
      name: "draft quality",
      level: "case",
      evaluators: [
        {
          name: "app combined",
          kind: "app",
          read: (c) => {
            const combined = (c.raw as { combined?: unknown } | null)?.combined;
            return typeof combined === "number" ? combined / 100 : null;
          },
        },
        metric("jev_quality", "jev"),
      ],
      gold: strongDraft,
    },
    ...(
      [
        ["sufficiency", "jev_sufficiency"],
        ["evidence", "jev_evidence"],
        ["integrity", "jev_integrity"],
        ["targetFit", "jev_target_fit"],
      ] as const
    ).map(
      ([key, jev]): Construct => ({
        name: key,
        level: "case",
        evaluators: [appDimension(key, `app ${key}`), metric(jev, "jev")],
        gold: strongDraft,
      }),
    ),
    {
      name: "planted weakness named, per weakness",
      level: "item",
      evaluators: [
        itemsOf("weakness_recall", "llm"),
        itemsOf("jev_weakness_recall", "jev"),
      ],
    },
    {
      // Pair scores are copied onto both drafts of a pair; read each pair once.
      name: "pair ordered",
      level: "case",
      evaluators: (
        [
          ["pair_order", "app", "app pair_order"],
          ["jev_pair_order", "jev", "jev_pair_order"],
        ] as const
      ).map(([name, kind, as]) => ({
        name: as,
        kind,
        read: (c: CaseLike) =>
          strongDraft.read(c) === 1 ? c.scores[name]?.score : null,
      })),
    },
  ],
  rewrite: [
    {
      name: "rewrite improves the passage",
      level: "case",
      evaluators: [
        metric("improves", "llm"),
        metric("jev_rewrite", "jev"),
        {
          name: "deterministic (facts, size, changed)",
          kind: "deterministic",
          read: (c) => {
            const parts = ["preserves_facts", "size_rule", "changed"].map(
              (k) => c.scores[k]?.score,
            );
            return parts.every((p) => typeof p === "number")
              ? (parts as number[]).every((p) => p >= 1)
                ? 1
                : 0
              : null;
          },
        },
      ],
    },
    {
      name: "fact kept, per fact",
      level: "item",
      evaluators: [
        itemsOf("preserves_facts", "deterministic"),
        itemsOf("jev_keeps_facts", "jev"),
      ],
    },
  ],
  dossier: [
    {
      name: "drift found, per drift",
      level: "item",
      evaluators: [
        itemsOf("drift_recall", "deterministic"),
        itemsOf("jev_drift_recall", "jev"),
      ],
    },
    {
      name: "observation on target, per observation",
      level: "item",
      evaluators: [
        itemsOf("field_precision", "deterministic"),
        itemsOf("jev_obs_supported", "jev"),
      ],
    },
  ],
  interview: [
    {
      name: "field stated by the writer, per field",
      level: "item",
      evaluators: [
        itemsOf("clairic_field_recall", "clairic", "clairic stated"),
        itemsOf("jev_field_recall", "jev", "jev stated"),
        {
          name: "app filed",
          kind: "app",
          read: (c) => {
            const turn = c.raw as {
              kind?: string;
              brief?: Record<string, unknown>;
              draft?: { brief?: Record<string, unknown> };
            } | null;
            if (!turn) return null;
            const recorded =
              (turn.kind === "synthesis" ? turn.brief : turn.draft?.brief) ??
              {};
            return Object.fromEntries(
              BRIEF.map((f) => [
                f,
                typeof recorded[f] === "string" &&
                (recorded[f] as string).trim()
                  ? 1
                  : 0,
              ]),
            );
          },
        },
      ],
    },
    {
      name: "field recall",
      level: "case",
      evaluators: [
        metric("dossier_fields", "corpus", "dossier_fields (hand labels)"),
        metric("clairic_field_recall", "clairic"),
        metric("jev_field_recall", "jev"),
      ],
    },
  ],
  "research-sources": [
    {
      name: "a source settles the claim",
      level: "case",
      evaluators: [
        metric("settles", "llm"),
        metric("jev_settles", "jev"),
        metric("clairic_fact", "clairic"),
        metric("expected_source", "deterministic"),
      ],
    },
    {
      name: "declared scalar support (v2) vs source-settlement judgments",
      level: "case",
      evaluators: [
        metric("clairic_value_support_v2", "clairic"),
        metric("settles", "llm"),
        metric("jev_settles", "jev"),
      ],
    },
  ],
};

export interface ConstructResult {
  name: string;
  level: "case" | "item";
  evaluators: string[];
  /** Observations every evaluator scored (cases, or items). */
  n: number;
  cases: number;
  /** Each evaluator's mean on the common support. */
  means: Record<string, number>;
  pairs: AgreementPair[];
  /** AUC per evaluator against the planted answer, when there is one. */
  gold?: {
    name: string;
    positives: number;
    negatives: number;
    auc: Record<string, number | null>;
  };
}

function readingsOf(
  evaluator: Evaluator,
  cases: CaseLike[],
  level: Construct["level"],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cases) {
    const reading = evaluator.read(c);
    if (level === "case") {
      if (typeof reading === "number" && Number.isFinite(reading))
        out.set(c.case_id, reading);
    } else if (reading && typeof reading === "object") {
      for (const [item, value] of Object.entries(reading))
        if (typeof value === "number" && Number.isFinite(value))
          out.set(`${c.case_id}\u0000${item}`, value);
    }
  }
  return out;
}

export function agreementFor(
  suite: string,
  cases: CaseLike[],
): ConstructResult[] {
  const live = cases.filter((c) => !c.skipped && c.ok !== false);
  const results: ConstructResult[] = [];
  for (const construct of CONSTRUCTS[suite] ?? []) {
    const present = construct.evaluators
      .map((e) => ({ e, values: readingsOf(e, live, construct.level) }))
      .filter((x) => x.values.size > 0);
    const goldOf = construct.gold
      ? new Map(
          live.flatMap((c) => {
            const g = construct.gold!.read(c);
            return g === null ? [] : [[c.case_id, g] as const];
          }),
        )
      : null;
    if (present.length < (goldOf?.size ? 1 : 2)) continue;
    let keys = [...present[0].values.keys()].filter((k) =>
      present.every((x) => x.values.has(k)),
    );
    if (goldOf?.size && construct.level === "case")
      keys = keys.filter((k) => goldOf.has(k));
    if (!keys.length) continue;
    const series = present.map((x) => ({
      name: x.e.name,
      values: keys.map((k) => x.values.get(k)!),
    }));
    const pairs: AgreementPair[] = [];
    for (let i = 0; i < series.length; i++)
      for (let j = i + 1; j < series.length; j++)
        pairs.push(
          agreementPair(
            series[i].name,
            series[j].name,
            series[i].values,
            series[j].values,
          ),
        );
    const result: ConstructResult = {
      name: construct.name,
      level: construct.level,
      evaluators: series.map((s) => s.name),
      n: keys.length,
      cases: new Set(keys.map((k) => k.split("\u0000")[0])).size,
      means: Object.fromEntries(
        series.map((s) => [
          s.name,
          s.values.reduce((a, b) => a + b, 0) / s.values.length,
        ]),
      ),
      pairs,
    };
    if (goldOf?.size && construct.level === "case") {
      const labels = keys.map((k) => goldOf.get(k)!);
      result.gold = {
        name: construct.gold!.name,
        positives: labels.filter((g) => g === 1).length,
        negatives: labels.filter((g) => g === 0).length,
        auc: Object.fromEntries(
          series.map((s) => [
            s.name,
            auc(
              s.values.filter((_, i) => labels[i] === 1),
              s.values.filter((_, i) => labels[i] === 0),
            ),
          ]),
        ),
      };
    }
    results.push(result);
  }
  return results;
}

const f2 = (x: number | null | undefined) =>
  typeof x === "number" && Number.isFinite(x) ? x.toFixed(2) : "  -";

export function formatAgreement(results: ConstructResult[]): string[] {
  if (!results.length) return [];
  const lines = ["  evaluator agreement (on the cases every evaluator scored)"];
  for (const r of results) {
    const unit =
      r.level === "item" ? `${r.n} items in ${r.cases} cases` : `${r.n} cases`;
    lines.push(
      `    ${r.name} (${unit}); means ${Object.entries(r.means)
        .map(([k, v]) => `${k} ${v.toFixed(2)}`)
        .join(", ")}`,
    );
    for (const p of r.pairs)
      lines.push(
        `      ${`${p.a} ~ ${p.b}`.padEnd(46)} r ${f2(p.pearson)}  ρ ${f2(p.spearman)}  agree ${f2(p.agree)}  κ ${f2(p.kappa)}  Δ ${p.meanDiff === null ? "-" : (p.meanDiff >= 0 ? "+" : "−") + Math.abs(p.meanDiff).toFixed(2)}`,
      );
    if (r.gold)
      lines.push(
        `      AUC vs ${r.gold.name} (${r.gold.positives}/${r.gold.negatives}): ${Object.entries(
          r.gold.auc,
        )
          .map(([k, v]) => `${k} ${f2(v)}`)
          .join(", ")}`,
      );
  }
  return lines;
}
