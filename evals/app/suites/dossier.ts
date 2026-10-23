/**
 * The dossier check through the `twyne` CLI (`twyne dossier check --json`).
 *
 * This is the one suite that goes through the CLI rather than MCP, which
 * keeps the CLI's argument handling and JSON output under the same eval as
 * the model behind it. Each case drifts from its brief in planted ways; the
 * check should flag the brief fields the draft has outgrown or contradicted.
 * Aligned cases plant nothing, and the check should stay quiet on them.
 *
 * The deterministic scores compare field names: a drift counts as found
 * when an observation names one of its fields, and an observation counts as
 * on target when its field belongs to some drift. With `--jev`, Jev reads
 * the substance instead, in two requests: blind to the planted drifts, is
 * each observation true of the draft (`jev_obs_supported`); with them, does
 * some observation describe each drift (`jev_drift_recall`). Clairic reads
 * the word limits out of the brief and code counts the words, so a claim
 * that the draft runs long is checked against the count (`length_claims`).
 */
import {
  askClairic,
  askJev,
  CLAIRIC_LENGTH_FIELDS,
  jevDriftRequest,
  jevObservationRequest,
  jevShare,
  type ClairicAsk,
  type JevAsk,
} from "../judges";
import { pass, ratio, words, type Score } from "../scoring";
import { runCliJson } from "../drivers";
import { readJsonl } from "./load";
import type { ProjectBrief, Suite } from "./types";

const FIELDS = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
] as const;

export interface DossierCase {
  case_id: string;
  brief: ProjectBrief;
  draftText: string;
  drifts: Array<{ passage: string; issue: string }>;
}

interface Observation {
  field?: string;
  current?: string;
  suggested?: string;
  reason?: string;
}

function observationsOf(raw: unknown): Observation[] {
  const list = (raw as { observations?: unknown })?.observations;
  return Array.isArray(list) ? (list as Observation[]) : [];
}

function renderObservation(o: Observation): string {
  return `${o.field}: ${o.current ?? ""} -> ${o.suggested ?? ""} (${o.reason ?? ""})`;
}

/** What an observation claims about the draft, without the fix it proposes. */
function claimOf(o: Observation): string {
  return `${o.field}: ${o.current ?? ""} (${o.reason ?? ""})`;
}

/**
 * The brief fields a drift names. Issues lead with their fields
 * ("Tone and audience: ..."); without that label the whole sentence is read.
 */
function driftFields(issue: string): string[] {
  const label = issue.includes(":")
    ? issue.slice(0, issue.indexOf(":"))
    : issue;
  const lower = label
    .toLowerCase()
    .replace(/success ?signal/g, "successsignal")
    .replace(/working ?title/g, "workingtitle");
  return FIELDS.filter((field) => lower.includes(field.toLowerCase()));
}

/** A drift that says the draft runs past its word limit. */
const OVERRUN =
  /\b(past|over|beyond|exceed\w*)\b[^.;]{0,40}\b(limit|words?)\b/i;

function integer(reading: { value?: unknown } | undefined): number | null {
  return typeof reading?.value === "number" && Number.isFinite(reading.value)
    ? Math.round(reading.value)
    : null;
}

/** Jev's two readings of the observations. */
async function jevReadings(
  jev: JevAsk,
  testCase: DossierCase,
  observations: Observation[],
): Promise<{
  supported: Score;
  recall: Score;
  claimsOverrun: Score | undefined;
}> {
  const blind = jevObservationRequest({
    brief: testCase.brief.answers,
    draft: testCase.draftText,
    observations: observations.map(claimOf),
  });
  const keyed = jevDriftRequest({
    observations: observations
      .map((o, j) => `${j + 1}. ${claimOf(o)}`)
      .join("\n"),
    drifts: testCase.drifts.map((d) => d.issue),
  });
  const [blindAnswers, keyedAnswers] = await Promise.all([
    observations.length
      ? askJev(jev, blind.state, blind.questions)
      : Promise.resolve({}),
    askJev(jev, keyed.state, keyed.questions),
  ]);
  return {
    supported: jevShare(blindAnswers, blind.ids, {
      emptyLabel: "no observations",
    }),
    recall: jevShare(keyedAnswers, keyed.ids, {
      emptyLabel: "nothing to find",
    }),
    claimsOverrun: keyedAnswers.claims_overrun,
  };
}

/**
 * Does the app's claim about length match the count? Clairic supplies the
 * limit, code the count, Jev whether an observation claims an overrun.
 */
async function lengthClaims(
  extract: ClairicAsk,
  testCase: DossierCase,
  claimsOverrun: Score | undefined,
): Promise<Score> {
  const brief = testCase.brief.answers;
  const limits = await askClairic(extract, {
    state: `Format: ${brief.format ?? ""}\nConstraints: ${brief.constraints ?? ""}`,
    fields: CLAIRIC_LENGTH_FIELDS,
  });
  if (!limits.ok)
    return { score: null, label: "clairic-error", explanation: limits.error };
  if (typeof claimsOverrun?.score !== "number")
    return {
      score: null,
      label: "jev-error",
      explanation: claimsOverrun?.explanation ?? "no answer",
    };
  const count = words(testCase.draftText).length;
  const max = integer(limits.answers.max_words);
  const min = integer(limits.answers.min_words);
  const over = max !== null && count > max;
  const claimed = claimsOverrun.score >= 0.5;
  const corpusClaims = testCase.drifts.filter((d) =>
    OVERRUN.test(d.issue),
  ).length;
  const range =
    max === null
      ? "no word limit"
      : min !== null
        ? `${min}-${max} words`
        : `at most ${max} words`;
  return {
    score: claimed === over ? 1 : 0,
    label: over
      ? claimed
        ? "caught overrun"
        : "missed overrun"
      : claimed
        ? "false overrun"
        : "no false claim",
    explanation:
      `${count} words against ${range} (Clairic); the observations ${claimed ? "claim" : "do not claim"} an overrun (Jev ${claimsOverrun.score.toFixed(2)})` +
      (min !== null && count < min ? `; the draft is under its minimum` : "") +
      (corpusClaims && !over
        ? `; ${corpusClaims} planted drift(s) claim an overrun the count does not show`
        : ""),
  };
}

export const dossierSuite: Suite<DossierCase> = {
  name: "dossier",
  surface: "CLI twyne dossier check",
  load: () => readJsonl<DossierCase>("app/cases/dossier.jsonl"),

  async run({ connection }, testCase) {
    const raw = await runCliJson(
      connection,
      ["dossier", "check", "--brief", "{brief.json}", "--file", "{draft.txt}"],
      {
        "brief.json": JSON.stringify(testCase.brief),
        "draft.txt": testCase.draftText,
      },
    );
    return {
      raw,
      output:
        observationsOf(raw).map(renderObservation).join("\n") ||
        "(no observations)",
    };
  },

  async score({ jev, extract }, testCase, raw) {
    const observations = observationsOf(raw);
    const flagged = new Set(observations.map((o) => o.field));
    const drifts = testCase.drifts.map((drift) => driftFields(drift.issue));
    const found = drifts.map((fields) =>
      fields.some((field) => flagged.has(field)),
    );
    const driftNamed = new Set(drifts.flat());
    const onTarget = observations.filter((o) => driftNamed.has(o.field ?? ""));
    const malformed = observations.filter(
      (o) =>
        !FIELDS.includes(o.field as (typeof FIELDS)[number]) ||
        typeof o.suggested !== "string" ||
        typeof o.reason !== "string",
    );
    const scores: Record<string, Score> = {
      contract: pass(
        Array.isArray((raw as { observations?: unknown })?.observations) &&
          malformed.length === 0,
        malformed.length
          ? `${malformed.length} malformed observation(s)`
          : undefined,
      ),
      drift_recall: {
        // An aligned draft has nothing to find; field_precision covers it.
        score: ratio(found.filter(Boolean).length, drifts.length) ?? 1,
        label: drifts.length ? undefined : "nothing to find",
        explanation: `flagged ${[...flagged].join(", ") || "nothing"}; ${found.filter(Boolean).length}/${drifts.length} drifts named (${drifts.map((fields) => fields.join("+")).join(", ")})`,
        items: Object.fromEntries(
          found.map((hit, i) => [`d${i + 1}`, hit ? 1 : 0]),
        ),
      },
      field_precision: {
        // Strict: a fair observation about a field no drift names counts
        // against it. On an aligned draft every observation is a false alarm.
        score: ratio(onTarget.length, observations.length) ?? 1,
        label: observations.length ? undefined : "quiet",
        explanation: `${onTarget.length}/${observations.length} observations name a field a planted drift names`,
        items: Object.fromEntries(
          observations.map((o, j) => [
            `o${j + 1}`,
            driftNamed.has(o.field ?? "") ? 1 : 0,
          ]),
        ),
      },
      hosted: pass(
        (raw as { provider?: string })?.provider !== "local",
        (raw as { provider?: string })?.provider,
      ),
    };

    if (jev) {
      const readings = await jevReadings(jev, testCase, observations);
      scores.jev_obs_supported = readings.supported;
      scores.jev_drift_recall = readings.recall;
      if (extract)
        scores.length_claims = await lengthClaims(
          extract,
          testCase,
          readings.claimsOverrun,
        );
    }
    return scores;
  },

  example: (testCase) => ({
    case_id: testCase.case_id,
    draftText: testCase.draftText,
    brief: JSON.stringify(testCase.brief),
    drifts: JSON.stringify(testCase.drifts),
  }),
};
