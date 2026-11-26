/**
 * Labelled brief answers for the brief-strength evals.
 *
 * Two consumers read this file:
 *
 * - `src/utils/brief-strength.test.ts` holds the quick read and the level
 *   derivation to it, with no network.
 * - `evals/run-brief-strength.ts` sends the same answers to Jev and scores
 *   its readings.
 *
 * Labels are an editor's, made against the level definitions in
 * `src/utils/brief-facets.ts` before any model saw the answers. A band is
 * two levels wide only where a careful reader could defend either.
 */
import type { ConstraintKind, ProjectInterviewAnswers } from "../src/types";
import type { BriefField, StrengthLevel } from "../src/utils/brief-facets";

export type FixtureKind =
  /** Cue words with nothing behind them, written to flatter a heuristic. */
  | "gamed"
  /** Short and exact. A length-based reader undergrades these. */
  | "terse-sharp"
  /** Many words, no commitment. A length-based reader overgrades these. */
  | "vague-long"
  | "plain";

export interface FieldFixture {
  id: string;
  field: BriefField;
  text: string;
  kind: FixtureKind;
  /** Expected level, inclusive. */
  band: [StrengthLevel, StrengthLevel];
  /**
   * Facet labels, by facet id: true holds, false does not. A facet left out
   * is one a careful reader could call either way.
   */
  facets?: Record<string, boolean>;
  /** Constraints only: the acceptable kinds for each line, in order. */
  lines?: ConstraintKind[][];
  /** Constraints only: the writer declared none. */
  none?: boolean;
}

const B: ConstraintKind[] = ["hard", "editorial"];

export const FIELD_FIXTURES: FieldFixture[] = [
  /* ── Audience ─────────────────────────────────────────────── */
  {
    id: "audience-gamed-keywords",
    field: "audience",
    kind: "gamed",
    text: "who already knows has have skeptics doubt",
    band: [1, 1],
    facets: { reader: false, knows: false, wants: false, narrow: false },
  },
  {
    id: "audience-gamed-adjectives",
    field: "audience",
    kind: "gamed",
    text: "skeptical expert practitioners who already know and doubt and want things",
    band: [1, 2],
    facets: { knows: false, wants: false, narrow: false },
  },
  {
    id: "audience-gamed-negation",
    field: "audience",
    kind: "gamed",
    text: "Readers, not non-readers; people who know things but don't know other things, never everyone",
    band: [1, 1],
    facets: { reader: false, knows: false, wants: false, narrow: false },
  },
  {
    id: "audience-general",
    field: "audience",
    kind: "plain",
    text: "General readers",
    band: [1, 1],
    facets: { reader: false, knows: false, wants: false, narrow: false },
  },
  {
    id: "audience-vague-long",
    field: "audience",
    kind: "vague-long",
    text: "Anyone who is interested in technology and society and wants to learn more about how the modern world works, including students, professionals, and curious people of all ages and backgrounds",
    band: [1, 1],
    facets: { reader: false, knows: false, narrow: false },
  },
  {
    id: "audience-podcasts",
    field: "audience",
    kind: "plain",
    text: "People who like podcasts",
    band: [1, 2],
    facets: { knows: false, wants: false, narrow: false },
  },
  {
    id: "audience-nurses",
    field: "audience",
    kind: "plain",
    text: "Nurses",
    band: [1, 2],
    facets: { knows: false, wants: false },
  },
  {
    id: "audience-mock-partial",
    field: "audience",
    kind: "plain",
    text: "Hospital operations managers who want to understand AI without the vendor hype.",
    band: [2, 3],
    facets: { reader: true, knows: false },
  },
  {
    id: "audience-junior-oncall",
    field: "audience",
    kind: "plain",
    text: "Junior backend engineers at fintech startups, in their first on-call rotation",
    band: [2, 3],
    facets: { reader: true, wants: false },
  },
  {
    id: "audience-regret",
    field: "audience",
    kind: "plain",
    text: "Hospital operations managers who signed an AI scheduling contract and regret it.",
    band: [3, 4],
    facets: { reader: true, knows: true, wants: true },
  },
  {
    id: "audience-phd",
    field: "audience",
    kind: "plain",
    text: "First-year PhD students in ecology who have collected field data but never fit a mixed model, and are afraid of R",
    band: [3, 4],
    facets: { reader: true, knows: true, wants: true },
  },
  {
    id: "audience-planners-sharp",
    field: "audience",
    kind: "plain",
    text: "Transit planners who already know the ridership data but doubt that night service pays for itself, not commuters",
    band: [4, 4],
    facets: { reader: true, knows: true, wants: true, narrow: true },
  },
  {
    id: "audience-terse-icu",
    field: "audience",
    kind: "terse-sharp",
    text: "Night-shift ICU nurses who distrust any scheduling software after the 2023 rollout",
    band: [3, 4],
    facets: { reader: true, knows: true, wants: true },
  },
  {
    id: "audience-terse-cofounder",
    field: "audience",
    kind: "terse-sharp",
    text: "My co-founder, who thinks we should raise now and has never seen a down round",
    band: [3, 4],
    facets: { reader: true, knows: true, narrow: true },
  },

  /* ── Goal ─────────────────────────────────────────────────── */
  {
    id: "goal-gamed-verbs",
    field: "goal",
    kind: "gamed",
    text: "convince persuade change decide so that they act and believe",
    band: [1, 1],
    facets: { aim: false, change: false, single: false, missable: false },
  },
  {
    id: "goal-gamed-sentence",
    field: "goal",
    kind: "gamed",
    text: "So that readers will decide to believe and act and adopt and change, not just understand",
    band: [1, 2],
    facets: { aim: false, single: false, missable: false },
  },
  {
    id: "goal-inform",
    field: "goal",
    kind: "plain",
    text: "Inform people about climate change",
    band: [1, 1],
    facets: { aim: false, change: false, missable: false },
  },
  {
    id: "goal-good",
    field: "goal",
    kind: "plain",
    text: "Make it good and interesting",
    band: [1, 1],
    facets: { aim: false, change: false, missable: false },
  },
  {
    id: "goal-vague-long",
    field: "goal",
    kind: "vague-long",
    text: "I want to explore the many different facets of remote work, discuss its advantages and disadvantages, cover the history of how we got here, and talk about where things might be going in the future for companies and workers alike",
    band: [1, 2],
    facets: { change: false, single: false, missable: false },
  },
  {
    id: "goal-mock-partial",
    field: "goal",
    kind: "plain",
    text: "Explain why most hospital AI pilots stall.",
    band: [2, 2],
    facets: { aim: true, change: false, single: true },
  },
  {
    id: "goal-many",
    field: "goal",
    kind: "plain",
    text: "Raise awareness of burnout, get managers to change on-call policy, sell the book, and make readers feel seen",
    band: [2, 2],
    facets: { aim: true, single: false },
  },
  {
    id: "goal-rates",
    field: "goal",
    kind: "plain",
    text: "Readers finish understanding why interest-rate cuts take eighteen months to reach rents",
    band: [3, 4],
    facets: { aim: true, change: true, single: true },
  },
  {
    id: "goal-council-sharp",
    field: "goal",
    kind: "plain",
    text: "Convince council members to fund night routes rather than more parking",
    band: [4, 4],
    facets: { aim: true, change: true, single: true, missable: true },
  },
  {
    id: "goal-terse-board",
    field: "goal",
    kind: "terse-sharp",
    text: "Get the board to cancel the Epic renewal",
    band: [3, 4],
    facets: { aim: true, change: true, single: true, missable: true },
  },
  {
    id: "goal-terse-reviewer",
    field: "goal",
    kind: "terse-sharp",
    text: "The reviewer recommends acceptance without asking for a new experiment",
    band: [3, 4],
    facets: { aim: true, change: true, single: true, missable: true },
  },

  /* ── Tone ─────────────────────────────────────────────────── */
  {
    id: "tone-gamed-negatives",
    field: "tone",
    kind: "gamed",
    text: "not boring, never dull, without fluff, avoid bad writing",
    band: [1, 1],
    facets: { distinct: false, imitable: false },
  },
  {
    id: "tone-gamed-likes",
    field: "tone",
    kind: "gamed",
    text: "like a voice that sounds like a style, never not clear",
    band: [1, 1],
    facets: { distinct: false, imitable: false, avoid: false },
  },
  {
    id: "tone-engaging",
    field: "tone",
    kind: "plain",
    text: "Engaging",
    band: [1, 1],
    facets: { distinct: false, imitable: false, avoid: false },
  },
  {
    id: "tone-professional",
    field: "tone",
    kind: "plain",
    text: "Professional but friendly and clear",
    band: [1, 1],
    facets: { distinct: false, imitable: false, avoid: false },
  },
  {
    id: "tone-vague-long",
    field: "tone",
    kind: "vague-long",
    text: "The tone should be engaging and accessible while remaining professional, with clear language that keeps the reader interested throughout and is well written from start to finish",
    band: [1, 1],
    facets: { distinct: false, imitable: false, avoid: false },
  },
  {
    id: "tone-warm",
    field: "tone",
    kind: "plain",
    text: "Warm but unsentimental",
    band: [2, 3],
    facets: { distinct: true },
  },
  {
    id: "tone-placeholder",
    field: "tone",
    kind: "plain",
    text: "Calm, exact, and a little sharp where it matters",
    band: [2, 3],
    facets: { distinct: true, avoid: false },
  },
  {
    id: "tone-mechanic",
    field: "tone",
    kind: "plain",
    text: "Plainspoken, like a good mechanic explaining what's wrong with your car",
    band: [3, 3],
    facets: { distinct: true, imitable: true, avoid: false },
  },
  {
    id: "tone-terse-lab",
    field: "tone",
    kind: "terse-sharp",
    text: "Dry, like a lab notebook; no exclamation marks",
    band: [4, 4],
    facets: { distinct: true, imitable: true, avoid: true },
  },
  {
    id: "tone-terse-deadpan",
    field: "tone",
    kind: "terse-sharp",
    text: "Deadpan. Never winks.",
    band: [3, 4],
    facets: { distinct: true, avoid: true },
  },
  {
    id: "tone-field-guide",
    field: "tone",
    kind: "plain",
    text: "Like a field guide written by someone who has been bitten: precise, wary, never cute",
    band: [4, 4],
    facets: { distinct: true, imitable: true, avoid: true },
  },

  /* ── Format ───────────────────────────────────────────────── */
  {
    id: "format-gamed-units",
    field: "format",
    kind: "gamed",
    text: "Words pages blog not memo only",
    band: [1, 2],
    facets: { size: false, venue: false },
  },
  {
    id: "format-gamed-lengths",
    field: "format",
    kind: "gamed",
    text: "long short medium length essay article post piece of writing",
    band: [1, 2],
    facets: { size: false, venue: false },
  },
  {
    id: "format-piece",
    field: "format",
    kind: "plain",
    text: "A piece of writing",
    band: [1, 1],
    facets: { shape: false, size: false, venue: false },
  },
  {
    id: "format-essay",
    field: "format",
    kind: "plain",
    text: "Essay",
    band: [2, 2],
    facets: { shape: true, size: false, venue: false },
  },
  {
    id: "format-venue-only",
    field: "format",
    kind: "plain",
    text: "Blog post for the company engineering blog",
    band: [2, 2],
    facets: { shape: true, size: false, venue: true },
  },
  {
    id: "format-essay-length",
    field: "format",
    kind: "plain",
    text: "Essay, about 1,500 words",
    band: [3, 3],
    facets: { shape: true, size: true, venue: false },
  },
  {
    id: "format-newsletter-sharp",
    field: "format",
    kind: "plain",
    text: "Essay, about 1,500 words for a city newsletter",
    band: [4, 4],
    facets: { shape: true, size: true, venue: true },
  },
  {
    id: "format-terse-oped",
    field: "format",
    kind: "terse-sharp",
    text: "800-word op-ed, Globe and Mail",
    band: [4, 4],
    facets: { shape: true, size: true, venue: true },
  },
  {
    id: "format-terse-talk",
    field: "format",
    kind: "terse-sharp",
    text: "Ten-minute conference talk with slides",
    band: [3, 4],
    facets: { shape: true, size: true },
  },

  /* ── Success signal ───────────────────────────────────────── */
  {
    id: "signal-gamed-verbs",
    field: "successSignal",
    kind: "gamed",
    text: "They will share and reply and cite and not ignore 100%",
    band: [1, 1],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "signal-gamed-numbers",
    field: "successSignal",
    kind: "gamed",
    text: "10 people 20 shares 30 replies 100% engagement",
    band: [1, 2],
    facets: { earned: false },
  },
  {
    id: "signal-gamed-list",
    field: "successSignal",
    kind: "gamed",
    text: "Readers can and will state, explain, decide, sign, forward and quote",
    band: [1, 2],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "signal-like",
    field: "successSignal",
    kind: "plain",
    text: "People like it",
    band: [1, 1],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "signal-resonates",
    field: "successSignal",
    kind: "plain",
    text: "It resonates with the audience",
    band: [1, 1],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "signal-vague-long",
    field: "successSignal",
    kind: "vague-long",
    text: "The piece will have succeeded if readers come away feeling that it was a worthwhile use of their time and that they learned something valuable which stays with them for a long while afterwards",
    band: [1, 1],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "signal-writer",
    field: "successSignal",
    kind: "plain",
    text: "I feel proud of it when I read it back",
    band: [1, 1],
    facets: { observable: false, theirs: false, threshold: false },
  },
  {
    id: "signal-placeholder",
    field: "successSignal",
    kind: "plain",
    text: "A reader can state the thesis back to us and knows why it matters.",
    band: [2, 2],
    facets: { observable: true, theirs: true, threshold: false },
  },
  {
    id: "signal-views",
    field: "successSignal",
    kind: "plain",
    text: "It gets 10,000 views",
    band: [2, 3],
    facets: { observable: true, threshold: true },
  },
  {
    id: "signal-cfo",
    field: "successSignal",
    kind: "plain",
    text: "A manager forwards it to their CFO before the renewal meeting.",
    band: [3, 4],
    facets: { observable: true, theirs: true, threshold: true },
  },
  {
    id: "signal-terse-reviewers",
    field: "successSignal",
    kind: "terse-sharp",
    text: "Two of three reviewers stop asking for a control group",
    band: [4, 4],
    facets: { observable: true, theirs: true, threshold: true, earned: true },
  },
  {
    id: "signal-terse-dana",
    field: "successSignal",
    kind: "terse-sharp",
    text: "Dana forwards it to her CFO unprompted",
    band: [3, 4],
    facets: { observable: true, theirs: true, threshold: true },
  },
  {
    id: "signal-founders",
    field: "successSignal",
    kind: "plain",
    text: "At least five replies from founders who say they changed their pricing page",
    band: [4, 4],
    facets: { observable: true, theirs: true, threshold: true, earned: true },
  },

  /* ── Working title ────────────────────────────────────────── */
  {
    id: "title-untitled",
    field: "workingTitle",
    kind: "plain",
    text: "Untitled",
    band: [1, 1],
    facets: { named: false, angle: false },
  },
  {
    id: "title-draft",
    field: "workingTitle",
    kind: "plain",
    text: "Draft 2",
    band: [1, 1],
    facets: { named: false, angle: false },
  },
  {
    id: "title-gamed",
    field: "workingTitle",
    kind: "gamed",
    text: "title title working title name",
    band: [1, 1],
    facets: { named: false, angle: false },
  },
  {
    id: "title-topic",
    field: "workingTitle",
    kind: "plain",
    text: "Public Transit",
    band: [3, 3],
    facets: { named: true, angle: false },
  },
  {
    id: "title-pilot",
    field: "workingTitle",
    kind: "plain",
    text: "The Pilot That Never Ended",
    band: [3, 4],
    facets: { named: true },
  },
  {
    id: "title-claim",
    field: "workingTitle",
    kind: "terse-sharp",
    text: "Why Night Buses Pay for Themselves",
    band: [4, 4],
    facets: { named: true, angle: true },
  },

  /* ── Constraints ──────────────────────────────────────────── */
  {
    id: "constraints-empty",
    field: "constraints",
    kind: "plain",
    text: "",
    band: [0, 0],
    none: true,
  },
  {
    id: "constraints-none",
    field: "constraints",
    kind: "plain",
    text: "None",
    band: [0, 0],
    none: true,
  },
  {
    id: "constraints-na",
    field: "constraints",
    kind: "plain",
    text: "n/a",
    band: [0, 0],
    none: true,
  },
  {
    id: "constraints-gamed",
    field: "constraints",
    kind: "gamed",
    text: "must must must cite sources, keep it under max, not over",
    band: [1, 2],
  },
  {
    id: "constraints-gamed-rules",
    field: "constraints",
    kind: "gamed",
    text: "Must keep to the rules\nNever break the limits\nOnly use what is allowed",
    band: [1, 2],
    lines: [["uncheckable"], ["uncheckable"], ["uncheckable"]],
  },
  {
    id: "constraints-mock-mixed",
    field: "constraints",
    kind: "plain",
    text: "Under 1,800 words — the journal's hard limit\nEvery statistic cites a primary source\nAvoid sounding preachy\nMake it feel fresh",
    band: [2, 2],
    lines: [["hard"], ["editorial"], ["preference"], ["uncheckable"]],
  },
  {
    id: "constraints-uncheckable",
    field: "constraints",
    kind: "plain",
    text: "Make it feel fresh\nKeep it authentic\nShould be high quality",
    band: [1, 1],
    lines: [["uncheckable"], ["uncheckable"], ["uncheckable"]],
  },
  {
    id: "constraints-preferences",
    field: "constraints",
    kind: "plain",
    text: "I'd rather not use the word 'journey'\nPrefer short paragraphs if possible\nIdeally no footnotes",
    band: [2, 2],
    lines: [["preference"], ["preference"], ["preference"]],
  },
  {
    id: "constraints-hard",
    field: "constraints",
    kind: "plain",
    text: "Embargoed until March 3: do not mention the acquisition\nLegal must approve every quote from the deposition\nMaximum 900 words per the op-ed desk",
    band: [4, 4],
    lines: [["hard"], ["hard"], ["hard"]],
  },
  {
    id: "constraints-editorial",
    field: "constraints",
    kind: "plain",
    text: "No second person\nEvery section opens with a scene, not a claim\nNo statistics without a named source",
    band: [4, 4],
    lines: [["editorial"], ["editorial"], ["editorial"]],
  },
  {
    id: "constraints-semicolons",
    field: "constraints",
    kind: "plain",
    text: "Cite every claim; British spelling; try to keep it light; be true to myself",
    band: [2, 2],
    lines: [B, B, ["preference"], ["uncheckable"]],
  },
  {
    id: "constraints-terse",
    field: "constraints",
    kind: "terse-sharp",
    text: "No named patients. Max 1,200 words.",
    band: [4, 4],
    lines: [B, B],
  },
];

/* ── Whole briefs ───────────────────────────────────────────── */

export interface BriefFixture {
  id: string;
  answers: ProjectInterviewAnswers;
  /** Expected level per filled field. */
  bands: Partial<Record<BriefField, [StrengthLevel, StrengthLevel]>>;
  /**
   * Does the brief tell a stranger who reads it, what it must achieve and
   * how anyone would see that it worked? Null where the brief says all three
   * and then contradicts itself, which is the tension check's to catch.
   */
  sufficient: boolean | null;
  /** The pair in tension, any order; null when the brief is coherent. */
  tension: Array<[BriefField, BriefField]> | null;
  /** Fields a stranger's first question could fairly be about. */
  firstQuestion?: BriefField[];
  /** Should downstream judgements trust this brief? */
  loadBearing: boolean;
}

export const BRIEF_FIXTURES: BriefFixture[] = [
  {
    id: "brief-sharp-transit",
    answers: {
      workingTitle: "Why Night Buses Pay for Themselves",
      format: "Essay, about 1,500 words for a city newsletter",
      audience:
        "Transit planners who already know the ridership data but doubt that night service pays for itself, not commuters",
      goal: "Convince council members to fund night routes rather than more parking",
      tone: "Dry, like a lab notebook; no exclamation marks",
      constraints:
        "Under 1,500 words — the newsletter's limit\nEvery figure cites the 2024 ridership audit",
      successSignal:
        "Two of the five committee members cite the fare-recovery figure in the March budget session",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [4, 4],
      constraints: [4, 4],
      successSignal: [3, 4],
    },
    sufficient: true,
    tension: null,
    loadBearing: true,
  },
  {
    id: "brief-vague-everything",
    answers: {
      workingTitle: "Untitled",
      format: "Article",
      audience: "General readers",
      goal: "Inform people about technology",
      tone: "Engaging",
      constraints: "Make it good",
      successSignal: "People like it",
    },
    bands: {
      workingTitle: [1, 1],
      format: [2, 2],
      audience: [1, 1],
      goal: [1, 1],
      tone: [1, 1],
      constraints: [1, 1],
      successSignal: [1, 1],
    },
    sufficient: false,
    tension: null,
    firstQuestion: ["audience", "goal"],
    loadBearing: false,
  },
  {
    id: "brief-gamed-everything",
    answers: {
      workingTitle: "title title working title name",
      format: "Words pages blog not memo only",
      audience: "who already knows has have skeptics doubt",
      goal: "convince persuade change decide so that they act and believe",
      tone: "not boring, never dull, without fluff, avoid bad writing",
      constraints: "must must must cite sources, keep it under max, not over",
      successSignal: "They will share and reply and cite and not ignore 100%",
    },
    bands: {
      workingTitle: [1, 1],
      format: [1, 2],
      audience: [1, 1],
      goal: [1, 1],
      tone: [1, 1],
      constraints: [1, 2],
      successSignal: [1, 1],
    },
    sufficient: false,
    tension: null,
    firstQuestion: ["audience", "goal", "format"],
    loadBearing: false,
  },
  {
    id: "brief-long-vague",
    answers: {
      workingTitle: "Thoughts on the Future of Work",
      format:
        "Some kind of longer piece, maybe an article or possibly a series of posts depending on how it goes",
      audience:
        "Anyone who is interested in technology and society and wants to learn more about how the modern world works, including students, professionals, and curious people of all ages and backgrounds",
      goal: "I want to explore the many different facets of remote work, discuss its advantages and disadvantages, cover the history of how we got here, and talk about where things might be going in the future for companies and workers alike",
      tone: "The tone should be engaging and accessible while remaining professional, with clear language that keeps the reader interested throughout and is well written from start to finish",
      constraints:
        "It should be accurate and well researched and not too long or too short",
      successSignal:
        "The piece will have succeeded if readers come away feeling that it was a worthwhile use of their time and that they learned something valuable which stays with them for a long while afterwards",
    },
    bands: {
      workingTitle: [3, 3],
      format: [1, 2],
      audience: [1, 1],
      goal: [1, 2],
      tone: [1, 1],
      constraints: [1, 1],
      successSignal: [1, 1],
    },
    sufficient: false,
    tension: null,
    firstQuestion: ["audience", "goal"],
    loadBearing: false,
  },
  {
    id: "brief-terse-sharp",
    answers: {
      workingTitle: "Cancel Epic",
      format: "One-page memo for the March board packet",
      audience:
        "Our nine board members: three clinicians, six finance people, none of whom have used the scheduling module",
      goal: "Get the board to cancel the Epic renewal",
      tone: "Deadpan. Never winks.",
      constraints: "No named patients. One page.",
      successSignal:
        "The renewal is struck from the April agenda without a follow-up meeting",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [3, 4],
      constraints: [4, 4],
      successSignal: [3, 4],
    },
    sufficient: true,
    tension: null,
    loadBearing: true,
  },
  {
    id: "brief-mock-pilot",
    answers: {
      workingTitle: "The Pilot That Never Ended",
      format: "Feature, 1,800 words, for a healthcare operations journal",
      audience:
        "Hospital operations managers who signed an AI scheduling contract and regret it.",
      goal: "Explain why most hospital AI pilots stall.",
      tone: "Plainspoken, like a good mechanic explaining what's wrong with your car",
      constraints: "None",
      successSignal:
        "A manager forwards it to their CFO before the renewal meeting.",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [2, 2],
      tone: [3, 3],
      successSignal: [3, 4],
    },
    sufficient: true,
    tension: null,
    firstQuestion: ["goal"],
    // The goal is still what the piece covers, not what it changes.
    loadBearing: false,
  },
  {
    id: "brief-missing-landing",
    answers: {
      workingTitle: "Mixed Models Without Fear",
      format: "Tutorial, about 3,000 words, for the lab's methods wiki",
      audience:
        "First-year PhD students in ecology who have collected field data but never fit a mixed model, and are afraid of R",
      goal: "Each student fits a random-intercept model to their own data by the end of the afternoon",
      tone: "Patient and concrete, like a labmate at the next desk; never condescending",
      constraints: "",
      successSignal: "",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [3, 4],
    },
    sufficient: false,
    tension: null,
    firstQuestion: ["successSignal"],
    // No landing: nothing says what "worked" means.
    loadBearing: false,
  },
  {
    id: "brief-grant",
    answers: {
      workingTitle: "Counting What the Tide Takes",
      format:
        "Two-page project summary for the NSF Coastal SEES panel, single-spaced",
      audience:
        "Three panel reviewers: coastal geomorphologists who know the sediment-budget literature and have seen a dozen drone-survey proposals fail to deliver elevation models on time",
      goal: "The panel ranks the proposal fundable because they believe the monthly survey schedule is achievable with two field staff",
      tone: "Measured and specific, like a methods section written by someone who has done the fieldwork; no promotional adjectives",
      constraints:
        "Two pages maximum — the solicitation's limit\n11-point font or larger per NSF PAPPG\nNo unpublished data from the Hatteras pilot",
      successSignal:
        "At least two of three reviews rate feasibility Very Good or better and none asks how the survey cadence will be staffed",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [4, 4],
      constraints: [4, 4],
      successSignal: [4, 4],
    },
    sufficient: true,
    tension: null,
    loadBearing: true,
  },
  {
    id: "brief-personal-essay",
    answers: {
      workingTitle: "My Father's Ledger",
      format: "Personal essay, 2,500 words, for the Sunday magazine's Lives column",
      audience:
        "Adult children of immigrant shopkeepers who helped at the till as kids and have never told anyone they were embarrassed by it",
      goal: "They feel forgiven for the embarrassment and call a parent",
      tone: "Tender but unsparing; short declarative sentences; no nostalgia",
      constraints:
        "Do not name my brother\nKeep the ledger entries in the original Gujarati with translations in brackets",
      successSignal:
        "At least a dozen readers write to say they called their mother or father after reading it",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [4, 4],
      constraints: [4, 4],
      successSignal: [3, 4],
    },
    sufficient: true,
    tension: null,
    loadBearing: true,
  },
  {
    id: "brief-tension-tone-reader",
    answers: {
      workingTitle: "The First Month",
      format: "Leaflet, 600 words, handed out by community midwives",
      audience:
        "Parents in the first month after a stillbirth, given this by their midwife, who have not yet told most of their friends",
      goal: "They know which three practical things can wait and which one cannot",
      tone: "Snarky and irreverent, with plenty of jokes at the reader's expense",
      constraints: "No religious language\nNo statistics",
      successSignal:
        "Midwives report that parents bring the leaflet to the six-week appointment with the checklist filled in",
    },
    bands: {
      audience: [3, 4],
      goal: [3, 4],
      successSignal: [3, 4],
    },
    sufficient: null,
    tension: [["tone", "audience"]],
    loadBearing: false,
  },
  {
    id: "brief-tension-rule-landing",
    answers: {
      workingTitle: "The Quiet Books Problem",
      format: "Newsletter issue, about 900 words",
      audience:
        "Freelance designers who invoice five to ten clients a month and still reconcile payments by hand in a spreadsheet",
      goal: "They start a free trial of Ledgerly",
      tone: "Friendly and practical, like advice from a designer two years ahead of you",
      constraints:
        "Never mention Ledgerly or any product by name\nNo links and no calls to action",
      successSignal:
        "At least 50 readers click through and start a Ledgerly trial within a week",
    },
    bands: {
      audience: [3, 4],
      goal: [3, 4],
      successSignal: [3, 4],
    },
    sufficient: null,
    tension: [
      ["constraints", "successSignal"],
      ["constraints", "goal"],
    ],
    loadBearing: false,
  },
  {
    id: "brief-tension-form-goal",
    answers: {
      workingTitle: "Term Sheets, Clause by Clause",
      format: "A single 280-character social post",
      audience:
        "First-time founders who have just received their first Series A term sheet and have never negotiated one",
      goal: "They can negotiate every clause of the term sheet, from liquidation preference to drag-along rights, without a lawyer in the room",
      tone: "Direct and unhurried, like a mentor at a whiteboard",
      constraints: "None",
      successSignal:
        "A founder replies with a marked-up term sheet showing changes to at least four clauses",
    },
    bands: {
      audience: [3, 4],
      goal: [3, 4],
      successSignal: [3, 4],
    },
    sufficient: null,
    tension: [
      ["format", "goal"],
      ["goal", "successSignal"],
    ],
    loadBearing: false,
  },
  {
    id: "brief-tension-goal-landing",
    answers: {
      workingTitle: "The Case for the Pilot",
      format: "Internal memo, two pages",
      audience:
        "Regional CFOs who cut the analytics budget last year and think the dashboards went unused",
      goal: "They approve the 40,000-dollar pilot budget at the June review",
      tone: "Sober and numerate; no adjectives a CFO would roll their eyes at",
      constraints: "Two pages maximum\nNo vendor names",
      successSignal:
        "The memo wins the internal design award for its illustrations",
    },
    bands: {
      audience: [3, 4],
      goal: [3, 4],
    },
    sufficient: null,
    tension: [["goal", "successSignal"]],
    loadBearing: false,
  },
];

/* ── Held out ───────────────────────────────────────────────── */

/**
 * Written and labelled after the question wording was settled, and never
 * used to adjust it. The set above is the one the wording was tuned
 * against, so its scores flatter the design; these are the honest ones.
 */
export const HOLDOUT_FIELD_FIXTURES: FieldFixture[] = [
  {
    id: "h-audience-gamed",
    field: "audience",
    kind: "gamed",
    text: "experienced senior junior beginners and veterans who doubt, fear, want and need",
    band: [1, 1],
    facets: { reader: false, knows: false, wants: false },
  },
  {
    id: "h-audience-millennials",
    field: "audience",
    kind: "plain",
    text: "Millennials",
    band: [1, 1],
    facets: { reader: false, knows: false, wants: false },
  },
  {
    id: "h-audience-vague-long",
    field: "audience",
    kind: "vague-long",
    text: "This is for a broad audience of readers from many different walks of life who might be curious about the subject and who enjoy reading thoughtful content online in their spare time",
    band: [1, 1],
    facets: { reader: false, knows: false },
  },
  {
    id: "h-audience-investors",
    field: "audience",
    kind: "plain",
    text: "Investors who want returns",
    band: [1, 2],
    facets: { knows: false },
  },
  {
    id: "h-audience-teachers",
    field: "audience",
    kind: "plain",
    text: "High-school chemistry teachers",
    band: [2, 2],
    facets: { reader: true, knows: false, wants: false },
  },
  {
    id: "h-audience-landlords",
    field: "audience",
    kind: "plain",
    text: "Small landlords in Ontario with one or two units who have never filed an N4 and are scared of the tribunal",
    band: [3, 4],
    facets: { reader: true, knows: true, wants: true },
  },
  {
    id: "h-audience-terse-staff",
    field: "audience",
    kind: "terse-sharp",
    text: "Staff engineers who've been burned by a rewrite",
    band: [3, 4],
    facets: { reader: true, knows: true },
  },
  {
    id: "h-audience-terse-mother",
    field: "audience",
    kind: "terse-sharp",
    text: "My mother, who has never used a spreadsheet and thinks budgeting is for people in trouble",
    band: [3, 4],
    facets: { reader: true, knows: true, wants: true },
  },
  {
    id: "h-goal-gamed",
    field: "goal",
    kind: "gamed",
    text: "decide act believe adopt, so that after reading they will change and stop and start",
    band: [1, 1],
    facets: { aim: false, change: false, single: false },
  },
  {
    id: "h-goal-awareness",
    field: "goal",
    kind: "plain",
    text: "Raise awareness",
    band: [1, 1],
    facets: { aim: false, change: false },
  },
  {
    id: "h-goal-vague-long",
    field: "goal",
    kind: "vague-long",
    text: "The goal of this piece is to provide readers with a comprehensive and engaging overview of the subject matter so that they come away better informed and with a deeper appreciation of its many nuances",
    band: [1, 1],
    facets: { aim: false, change: false },
  },
  {
    id: "h-goal-cover",
    field: "goal",
    kind: "plain",
    text: "Describe how the city's composting program works",
    band: [2, 2],
    facets: { aim: true, change: false, single: true },
  },
  {
    id: "h-goal-two",
    field: "goal",
    kind: "plain",
    text: "Get readers to subscribe and also to rethink their relationship with their phones",
    band: [2, 2],
    facets: { aim: true, single: false },
  },
  {
    id: "h-goal-switch",
    field: "goal",
    kind: "plain",
    text: "Convince freelance illustrators to stop quoting hourly and switch to per-project pricing",
    band: [4, 4],
    facets: { aim: true, change: true, single: true, missable: true },
  },
  {
    id: "h-goal-terse",
    field: "goal",
    kind: "terse-sharp",
    text: "She says yes to the sabbatical",
    band: [3, 4],
    facets: { aim: true, change: true, single: true },
  },
  {
    id: "h-tone-gamed",
    field: "tone",
    kind: "gamed",
    text: "like no other, never without style, not like anything",
    band: [1, 1],
    facets: { distinct: false, imitable: false },
  },
  {
    id: "h-tone-informative",
    field: "tone",
    kind: "plain",
    text: "Informative and well written",
    band: [1, 1],
    facets: { distinct: false, imitable: false, avoid: false },
  },
  {
    id: "h-tone-vague-long",
    field: "tone",
    kind: "vague-long",
    text: "I'd like it to read smoothly and hold people's attention, striking a nice balance between being informative and being enjoyable, so that it feels polished and professional overall",
    band: [1, 1],
    facets: { distinct: false, imitable: false, avoid: false },
  },
  {
    id: "h-tone-wry",
    field: "tone",
    kind: "plain",
    text: "Wry",
    band: [2, 2],
    facets: { distinct: true, imitable: false, avoid: false },
  },
  {
    id: "h-tone-newyorker",
    field: "tone",
    kind: "plain",
    text: "The New Yorker's Talk of the Town: amused, exact, slightly distant",
    band: [3, 3],
    facets: { distinct: true, imitable: true, avoid: false },
  },
  {
    id: "h-tone-letter",
    field: "tone",
    kind: "terse-sharp",
    text: "Like a letter to a friend who is about to make the same mistake; no lecturing",
    band: [4, 4],
    facets: { distinct: true, imitable: true, avoid: true },
  },
  {
    id: "h-tone-terse-clinical",
    field: "tone",
    kind: "terse-sharp",
    text: "Clinical. No adjectives.",
    band: [3, 4],
    facets: { distinct: true, avoid: true },
  },
  {
    id: "h-format-gamed",
    field: "format",
    kind: "gamed",
    text: "1 2 3 words pages minutes of essay memo talk",
    band: [1, 2],
    facets: { size: false, venue: false },
  },
  {
    id: "h-format-something",
    field: "format",
    kind: "plain",
    text: "Something to post online",
    band: [1, 1],
    facets: { shape: false, size: false },
  },
  {
    id: "h-format-chapter",
    field: "format",
    kind: "plain",
    text: "Book chapter",
    band: [2, 2],
    facets: { shape: true, size: false, venue: false },
  },
  {
    id: "h-format-memo",
    field: "format",
    kind: "plain",
    text: "Two-page memo",
    band: [3, 3],
    facets: { shape: true, size: true, venue: false },
  },
  {
    id: "h-format-terse-talk",
    field: "format",
    kind: "terse-sharp",
    text: "Lightning talk, five minutes, for the PyData Berlin meetup",
    band: [4, 4],
    facets: { shape: true, size: true, venue: true },
  },
  {
    id: "h-signal-gamed",
    field: "successSignal",
    kind: "gamed",
    text: "reply forward share cite quote sign decide, by the deadline, at least some",
    band: [1, 2],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "h-signal-feedback",
    field: "successSignal",
    kind: "plain",
    text: "Good feedback",
    band: [1, 1],
    facets: { observable: false, threshold: false, earned: false },
  },
  {
    id: "h-signal-vague-long",
    field: "successSignal",
    kind: "vague-long",
    text: "I'll consider it a success if the people who read it find it genuinely interesting and maybe think about the topic a little differently than they did before they started reading",
    band: [1, 1],
    facets: { observable: false, threshold: false },
  },
  {
    id: "h-signal-happy",
    field: "successSignal",
    kind: "plain",
    text: "I'm happy with how it turned out",
    band: [1, 1],
    facets: { observable: false, theirs: false, threshold: false },
  },
  {
    id: "h-signal-explain",
    field: "successSignal",
    kind: "plain",
    text: "Readers can explain the difference between a Roth and a traditional IRA",
    band: [2, 2],
    facets: { observable: true, theirs: true, threshold: false },
  },
  {
    id: "h-signal-signups",
    field: "successSignal",
    kind: "plain",
    text: "Thirty people join the waitlist in the first week",
    band: [3, 4],
    facets: { observable: true, theirs: true, threshold: true },
  },
  {
    id: "h-signal-terse-editor",
    field: "successSignal",
    kind: "terse-sharp",
    text: "My editor accepts it without a second round of structural notes",
    band: [3, 4],
    facets: { observable: true, theirs: true, threshold: true },
  },
  {
    id: "h-title-tbd",
    field: "workingTitle",
    kind: "plain",
    text: "TBD",
    band: [1, 1],
    facets: { named: false },
  },
  {
    id: "h-title-topic",
    field: "workingTitle",
    kind: "plain",
    text: "Composting",
    band: [3, 3],
    facets: { named: true, angle: false },
  },
  {
    id: "h-title-claim",
    field: "workingTitle",
    kind: "terse-sharp",
    text: "Hourly Rates Are Killing Your Studio",
    band: [4, 4],
    facets: { named: true, angle: true },
  },
  {
    id: "h-constraints-none",
    field: "constraints",
    kind: "plain",
    text: "No constraints",
    band: [0, 0],
    none: true,
  },
  {
    id: "h-constraints-gamed",
    field: "constraints",
    kind: "gamed",
    text: "No bad stuff\nMust be right\nNever wrong, only good",
    band: [1, 2],
    lines: [["uncheckable"], ["uncheckable"], ["uncheckable"]],
  },
  {
    id: "h-constraints-mixed",
    field: "constraints",
    kind: "plain",
    text: "750 words max — the magazine's column length\nNo first-person plural\nI'd like to avoid clichés where possible\nIt should sing",
    band: [2, 2],
    lines: [["hard"], ["editorial"], ["preference", "uncheckable"], ["uncheckable"]],
  },
  {
    id: "h-constraints-legal",
    field: "constraints",
    kind: "plain",
    text: "Do not name the defendant: the publication ban is still in effect\nAll quotes must come from the public court record",
    band: [4, 4],
    lines: [["hard"], B],
  },
  {
    id: "h-constraints-prefs",
    field: "constraints",
    kind: "plain",
    text: "Would be nice to include a chart\nMaybe keep paragraphs under five sentences",
    band: [2, 2],
    lines: [["preference"], ["preference"]],
  },
  {
    id: "h-constraints-terse",
    field: "constraints",
    kind: "terse-sharp",
    text: "No em dashes. No listicles.",
    band: [4, 4],
    lines: [B, B],
  },
];

export const HOLDOUT_BRIEF_FIXTURES: BriefFixture[] = [
  {
    id: "h-brief-sharp-pricing",
    answers: {
      workingTitle: "Stop Quoting Hourly",
      format:
        "Workshop handout, two pages, for the March AIGA Toronto pricing session",
      audience:
        "Freelance illustrators three to five years in who quote hourly and have lost at least one client over a revised estimate",
      goal: "Each attendee rewrites one live quote as a per-project price before leaving the room",
      tone: "Blunt and practical, like a studio-mate who has seen your invoices; no hustle-culture slogans",
      constraints:
        "Two pages maximum\nNo rates below the CARFAC minimum fee schedule",
      successSignal:
        "At least half the room hands in a rewritten quote at the end of the session",
    },
    bands: {
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [4, 4],
      constraints: [4, 4],
      successSignal: [3, 4],
    },
    sufficient: true,
    tension: null,
    loadBearing: true,
  },
  {
    id: "h-brief-vague-blog",
    answers: {
      workingTitle: "My Blog Post",
      format: "Blog post",
      audience: "Anyone who might find it useful",
      goal: "Share my thoughts on productivity",
      tone: "Friendly and engaging",
      constraints: "Keep it interesting",
      successSignal: "Lots of people read it",
    },
    bands: {
      format: [2, 2],
      audience: [1, 1],
      goal: [1, 2],
      tone: [1, 1],
      constraints: [1, 1],
      successSignal: [1, 2],
    },
    sufficient: false,
    tension: null,
    firstQuestion: ["audience", "goal"],
    loadBearing: false,
  },
  {
    id: "h-brief-thin",
    answers: {
      workingTitle: "Remote Work Essay",
      format: "Essay",
      audience: "Managers",
      goal: "Argue that remote work is here to stay",
      tone: "Confident",
      constraints: "",
      successSignal: "Managers agree with it",
    },
    bands: {
      format: [2, 2],
      audience: [1, 2],
      tone: [1, 2],
      successSignal: [1, 2],
    },
    sufficient: false,
    tension: null,
    firstQuestion: ["audience", "goal", "successSignal"],
    loadBearing: false,
  },
  {
    id: "h-brief-solid-flood",
    answers: {
      workingTitle: "What the Flood Maps Miss",
      format: "Explainer, 1,200 words, for the regional paper's weekend section",
      audience:
        "Homeowners in the Elm Creek floodplain who checked the 2019 map, saw they were outside the line, and assumed they were safe",
      goal: "They understand that the map ignores storm-sewer backup and check their own street's sewer capacity",
      tone: "Calm and neighbourly; never alarmist",
      constraints: "None",
      successSignal:
        "The city's sewer-capacity lookup page gets at least 300 visits from the article's link in the first week",
    },
    bands: {
      workingTitle: [3, 4],
      format: [4, 4],
      audience: [3, 4],
      goal: [3, 4],
      tone: [3, 4],
      successSignal: [3, 4],
    },
    sufficient: true,
    tension: null,
    loadBearing: true,
  },
  {
    id: "h-brief-tension-reader-goal",
    answers: {
      workingTitle: "A Gentle Introduction to Kubernetes",
      format: "Tutorial, 2,000 words, for the company's onboarding wiki",
      audience:
        "New support hires in their first week who have never used a command line",
      goal: "They can debug a failing production cluster on their own by Friday",
      tone: "Reassuring and plain; no jargon without a definition",
      constraints: "No screenshots of the production console",
      successSignal:
        "A new hire closes a real cluster incident ticket unassisted in their first week",
    },
    bands: { audience: [3, 4], goal: [3, 4], successSignal: [3, 4] },
    sufficient: null,
    tension: [
      ["audience", "goal"],
      ["audience", "successSignal"],
      ["format", "goal"],
    ],
    loadBearing: false,
  },
  {
    id: "h-brief-tension-tone-goal",
    answers: {
      workingTitle: "Please Fund the Shelter",
      format: "Appeal letter, one page, mailed to past donors",
      audience:
        "Donors who gave between 50 and 500 dollars last year and have not yet renewed",
      goal: "They renew their gift at the same level or higher by December 31",
      tone: "Scolding and sarcastic: make them feel cheap for not having given already",
      constraints: "One page\nNo photographs of residents",
      successSignal:
        "Renewal rate among lapsed donors reaches 40 percent by year end",
    },
    bands: { audience: [3, 4], goal: [3, 4], successSignal: [3, 4] },
    sufficient: null,
    tension: [
      ["tone", "goal"],
      ["tone", "audience"],
    ],
    loadBearing: false,
  },
];
