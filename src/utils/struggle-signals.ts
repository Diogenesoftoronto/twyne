/**
 * Struggle signals — what the writer is wrestling with, read from how they
 * edit rather than from what they wrote.
 *
 * Everything here is local and pure. The tracker records counters per
 * paragraph as transactions land; nothing leaves the machine while the writer
 * types. On a pause the counters are committed into a version history and
 * scored, and only a paragraph that crosses the threshold is offered to the
 * classifier.
 *
 * The four readings map one-to-one onto the in-flow tools:
 *
 *   sentence-lab      the same sentence rewritten again and again
 *   rhythm-strip      sentences split and joined, a long paragraph churning
 *   claim-check       hedges put in and taken out — unsure how hard to claim
 *   reader-questions  a stall at the end of a paragraph after cutting
 */

export type ToolKind =
  | "sentence-lab"
  | "rhythm-strip"
  | "claim-check"
  | "reader-questions";

export const TOOL_KINDS: readonly ToolKind[] = [
  "sentence-lab",
  "rhythm-strip",
  "claim-check",
  "reader-questions",
];

export const TOOL_LABELS: Record<ToolKind, string> = {
  "sentence-lab": "Sentence bench",
  "rhythm-strip": "Rhythm Strip",
  "claim-check": "Claim Check",
  "reader-questions": "Reader Questions",
};

/** Paragraph-local counters. Plain data so it can be cloned and tested. */
export interface BlockActivity {
  /** Text as of the last recorded edit. */
  text: string;
  /** Text as of the last committed pause; the baseline for the next commit. */
  committed: string;
  /** Committed versions, oldest first, capped at {@link MAX_VERSIONS}. */
  versions: string[];
  inserted: number;
  deleted: number;
  undos: number;
  /** Rewrite count keyed by sentence index; reset when the sentence count moves. */
  rewrites: Record<number, number>;
  /** Earlier wordings of each rewritten sentence, oldest first. */
  attempts: Record<number, string[]>;
  sentenceCountChanges: number;
  hedgeFlips: number;
  /** Length when tracking began, for churn against net growth. */
  startLength: number;
  firstAt: number;
  lastEditAt: number;
  /** Last time the paragraph grew by a meaningful amount. */
  lastGrowthAt: number;
  /** Set after a dismissal; no reading fires until it has passed. */
  cooldownUntil: number;
}

export interface StruggleReading {
  /** 0..1 — the strongest single signal. */
  score: number;
  /** Tool kinds whose rule fired, strongest first. */
  hints: Array<{ kind: ToolKind; strength: number; reason: string }>;
  /** When `sentence-lab` fired: which sentence, by index. */
  sentenceIndex?: number;
}

export const MAX_VERSIONS = 4;
const MAX_ATTEMPTS = 5;
export const STRUGGLE_THRESHOLD = 0.5;
/** Growth below this many characters does not count as progress. */
const GROWTH_CHARS = 12;
/** A stall is this long without growth, after the writer has been cutting. */
const STALL_MS = 40_000;

const HEDGE =
  /\b(perhaps|maybe|arguably|possibly|probably|somewhat|seems?|appears?|might|may|could|likely|suggests?|in some ways|to some extent|i think|i believe)\b/gi;

export function hedgeCount(text: string): number {
  return text.match(HEDGE)?.length ?? 0;
}

export interface SentenceSpan {
  text: string;
  /** Offsets into the paragraph text. */
  from: number;
  to: number;
}

/**
 * Sentence boundaries, deliberately simple: terminal punctuation followed by
 * whitespace. Abbreviations split wrongly now and then; the tools show the
 * writer's own words back to them, so a bad split is visible and harmless.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const from = match.index + lead;
    spans.push({ text: trimmed, from, to: from + trimmed.length });
  }
  return spans;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function emptyActivity(text: string, now: number): BlockActivity {
  return {
    text,
    committed: text,
    versions: text.trim() ? [text] : [],
    inserted: 0,
    deleted: 0,
    undos: 0,
    rewrites: {},
    attempts: {},
    sentenceCountChanges: 0,
    hedgeFlips: 0,
    startLength: text.length,
    firstAt: now,
    lastEditAt: now,
    lastGrowthAt: now,
    cooldownUntil: 0,
  };
}

/**
 * Count one edit. Called per transaction for each touched paragraph, so it
 * must stay O(paragraph): a common prefix/suffix trim, no diff library.
 */
export function recordEdit(
  activity: BlockActivity,
  after: string,
  now: number,
  options: { undo?: boolean } = {},
): BlockActivity {
  const before = activity.text;
  if (before === after) return activity;
  let start = 0;
  const min = Math.min(before.length, after.length);
  while (start < min && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < min - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const removed = before.length - start - end;
  const added = after.length - start - end;
  const grew = after.length - activity.committed.length >= GROWTH_CHARS;
  return {
    ...activity,
    text: after,
    inserted: activity.inserted + added,
    deleted: activity.deleted + removed,
    undos: activity.undos + (options.undo ? 1 : 0),
    lastEditAt: now,
    lastGrowthAt: grew ? now : activity.lastGrowthAt,
  };
}

/**
 * Fold everything since the last pause into one version. This is where
 * sentence rewrites and hedge flips are counted — per pause, not per
 * keystroke, so typing a sentence out letter by letter is not "rewriting" it.
 */
export function commitVersion(activity: BlockActivity): BlockActivity {
  const previous = activity.committed;
  const current = activity.text;
  if (previous === current) return activity;

  const before = splitSentences(previous);
  const after = splitSentences(current);
  let { rewrites, attempts, sentenceCountChanges, hedgeFlips } = activity;

  if (before.length !== after.length) {
    // The indices no longer mean the same thing either way. But only an edit
    // with untouched text after it is a split or a join — starting a new
    // sentence at the end, or cutting the last one, is ordinary writing.
    if (sharedTail(previous, current) >= 3) sentenceCountChanges++;
    rewrites = {};
    attempts = {};
  } else {
    const changed = after
      .map((sentence, i) => (sentence.text !== before[i].text ? i : -1))
      .filter((i) => i >= 0);
    // Exactly one sentence reworded, and not merely extended at its end —
    // extending is writing forward, not wrestling with it.
    if (changed.length === 1) {
      const i = changed[0];
      const was = before[i].text;
      const now = after[i].text;
      const extended = now.startsWith(was.replace(/[.!?…]+$/, ""));
      if (!extended && was.length >= 12) {
        rewrites = { ...rewrites, [i]: (rewrites[i] ?? 0) + 1 };
        const prior = attempts[i] ?? [];
        attempts = {
          ...attempts,
          [i]: [...prior.filter((a) => a !== was), was].slice(-MAX_ATTEMPTS),
        };
      }
    }
  }

  if (hedgeCount(previous) !== hedgeCount(current)) hedgeFlips++;

  const versions = [...activity.versions, current].slice(-MAX_VERSIONS);
  return {
    ...activity,
    committed: current,
    versions,
    rewrites,
    attempts,
    sentenceCountChanges,
    hedgeFlips,
  };
}

/** Length of the common ending, ignoring trailing space and punctuation. */
function sharedTail(a: string, b: string): number {
  const x = a.replace(/[\s.!?…"'”’)\]]+$/, "");
  const y = b.replace(/[\s.!?…"'”’)\]]+$/, "");
  let n = 0;
  while (
    n < x.length &&
    n < y.length &&
    x[x.length - 1 - n] === y[y.length - 1 - n]
  )
    n++;
  return n;
}

/** Score a paragraph. Pure: `now` is passed in so tests can age a stall. */
export function readStruggle(
  activity: BlockActivity,
  now: number,
  context: { cursorAtEnd?: boolean } = {},
): StruggleReading {
  if (now < activity.cooldownUntil) return { score: 0, hints: [] };
  const hints: StruggleReading["hints"] = [];
  const text = activity.text;
  const sentences = splitSentences(text);
  const words = wordCount(text);

  let sentenceIndex: number | undefined;
  let most = 0;
  for (const [key, count] of Object.entries(activity.rewrites)) {
    if (count > most && Number(key) < sentences.length) {
      most = count;
      sentenceIndex = Number(key);
    }
  }
  if (most >= 3) {
    hints.push({
      kind: "sentence-lab",
      strength: Math.min(1, 0.6 + (most - 3) * 0.1),
      reason: `You've reworded one sentence ${most} times.`,
    });
  }

  const churn =
    (activity.inserted + activity.deleted) /
    Math.max(40, Math.abs(text.length - activity.startLength) + 40);
  if (
    sentences.length >= 3 &&
    (activity.sentenceCountChanges >= 2 || (churn >= 4 && words >= 80))
  ) {
    hints.push({
      kind: "rhythm-strip",
      strength: Math.min(
        0.9,
        0.5 +
          activity.sentenceCountChanges * 0.1 +
          Math.max(0, churn - 4) * 0.02,
      ),
      reason:
        activity.sentenceCountChanges >= 2
          ? "You've been splitting and joining sentences here."
          : "This paragraph keeps being reworked.",
    });
  }

  if (activity.hedgeFlips >= 2 && words >= 10) {
    hints.push({
      kind: "claim-check",
      strength: Math.min(0.9, 0.5 + (activity.hedgeFlips - 2) * 0.15),
      reason: "You've been adding and removing qualifiers.",
    });
  }

  if (
    context.cursorAtEnd &&
    words >= 25 &&
    activity.deleted >= 40 &&
    now - activity.lastGrowthAt >= STALL_MS &&
    now - activity.lastEditAt >= 8_000
  ) {
    hints.push({
      kind: "reader-questions",
      strength: 0.5,
      reason: "You've paused here after cutting.",
    });
  }

  hints.sort((a, b) => b.strength - a.strength);
  return {
    score: hints[0]?.strength ?? 0,
    hints,
    sentenceIndex,
  };
}

/** Quiet a paragraph after the writer dismisses its tool. */
export function coolDown(
  activity: BlockActivity,
  now: number,
  ms = 5 * 60_000,
): BlockActivity {
  return { ...activity, cooldownUntil: now + ms };
}
