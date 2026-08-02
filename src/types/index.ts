export interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;
  icon: string;
  description: string;
  focus: string;
  /**
   * Short fictional history used for role play and continuity. This is kept
   * separate from the writing instructions so an editor can have a life
   * without turning every response into exposition about that life.
   */
  backstory?: string;
  /**
   * The editor's critical doctrine: what they notice first, what they believe
   * good writing owes the reader, and how they decide what must change.
   */
  criticalMethod?: string;
  /**
   * Rich voice specification — diction, sentence rhythm, signature moves, and
   * what this editor never does. Injected into the system prompt so the five
   * personas read as genuinely different writers. Optional and backward
   * compatible: when absent, the generic shared wording is used.
   */
  voice?: string;
  /** Recurring rhetorical habits that make this editor recognizable. */
  signatureMoves?: string[];
  /** Words, tones, structures, and other-persona behaviors this editor avoids. */
  avoidances?: string[];
  /** One or two few-shot lines written in this persona's voice. */
  sampleLines?: string[];
  /**
   * Provider voice used when this editor is read aloud (e.g. "onyx").
   * The `voice` lore above doubles as the TTS voice direction, so the two
   * together are what make five editors sound like five people.
   */
  speechVoice?: string;
  /**
   * Per-provider voice overrides, keyed by {@link AiProviderType}. Providers
   * name voices in incompatible ways — OpenAI uses names like "onyx", Fish
   * Audio uses a 32-character voice-model id — so a single field cannot serve
   * both. {@link Persona.speechVoice} is the fallback when a provider has no
   * entry here.
   */
  speechVoices?: Partial<Record<AiProviderType, string>>;
  /** Optional per-persona generation prefs (honored on the BYOK client path). */
  providerId?: string;
  model?: string;
  temperature?: number;
}

export interface PersonaFeedback {
  /** Folio whose manuscript this note belongs to. */
  folioId?: string;
  personaId: string;
  personaName: string;
  personaColor: string;
  feedback: string;
  paragraphIndex?: number;
  timestamp: number;
  type: "encouragement" | "suggestion" | "critique" | "perspective";
  /** Exact sentence from the draft this note is pinned to, when one was found. */
  anchor?: string;
  /** Stable id shared between the feed card and the inline mark in the manuscript. */
  noteId?: string;
  /** Title of the brief the note was filed against, for the timeline. */
  briefTitle?: string;
  /**
   * How this note came to exist. `"convened"` (the default when absent) means
   * the writer asked; `"background"` means the room read new material on its
   * own while the writer was working, and the note should be presented more
   * quietly.
   */
  origin?: "convened" | "background";
}

/** Payload of the `twyne:persona-notes` window event: notes to pin inline. */
export interface PersonaNotePayload {
  id: string;
  author: string;
  color: string;
  label: string;
  note: string;
  quote: string;
  briefTitle?: string;
}

export interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  score: number;
  maxScore: number;
  feedback: string;
}

/**
 * One line of the writer's rubric configuration.
 *
 * The spine — the criteria Twyne ships — stays fixed so a score means the same
 * thing from one pass to the next, and so the trend line is honest. What the
 * writer controls is the weighting, whether a spine criterion is shown at all,
 * and any number of criteria of their own that the room will judge alongside
 * them. Spine entries can be disabled and reweighted but never deleted; that
 * is what keeps two runs comparable.
 */
export interface RubricCriterionSpec {
  id: string;
  label: string;
  description: string;
  source: "spine" | "custom";
  enabled: boolean;
  /** Relative weight within the criteria list. 1 is the default. */
  weight: number;
}

/** The criteria Twyne ships. Order is the order they render in. */
export const SPINE_CRITERIA: ReadonlyArray<
  Pick<RubricCriterionSpec, "id" | "label" | "description">
> = [
  {
    id: "targetFit",
    label: "Target Fit",
    description:
      "Whether the draft is about the right thing, for the right reader — independent of how well it is written",
  },
  {
    id: "thesis",
    label: "Thesis & Argument",
    description: "Clarity and strength of the central argument",
  },
  {
    id: "evidence",
    label: "Evidence & Support",
    description: "Quality and relevance of supporting evidence",
  },
  {
    id: "sufficiency",
    label: "Sufficiency & Development",
    description:
      "Whether the draft develops enough on-topic material to earn its thesis or goal",
  },
  {
    id: "integrity",
    label: "Bullshit Resistance",
    description: "Unsupported certainty, filler, vagueness, and repetition",
  },
  {
    id: "structure",
    label: "Organization & Flow",
    description: "Logical structure and transitions",
  },
  {
    id: "pacing",
    label: "Pacing & Rhythm",
    description: "Sentence length variation and cadence",
  },
  {
    id: "voice",
    label: "Voice & Tone",
    description: "Consistency of voice for the named audience",
  },
  {
    id: "vocabulary",
    label: "Vocabulary & Diction",
    description: "Type-token ratio and word choice",
  },
  {
    id: "paragraph",
    label: "Paragraph Shape",
    description: "Balance of short and long paragraphs",
  },
  {
    id: "engagement",
    label: "Reader Engagement",
    description: "Whether the reader reaches the success signal",
  },
] as const;

/** One recorded rubric pass, for the trend line. */
export interface RubricHistoryEntry {
  /** Folio whose rubric run produced this point. */
  folioId?: string;
  at: number;
  overall: number;
  grade: string;
  targetFit?: number;
  perCriterion: Record<string, number>;
}

export interface RubricResult {
  /** Folio whose manuscript was graded. */
  folioId?: string;
  criteria: RubricCriterion[];
  overallScore: number;
  overallGrade: string;
  summary: string;
  timestamp: number;
  /** Per-persona judge scores, 0-10. */
  judges: import("../utils/rubric").JudgeResult[];
  /** Static-feature breakdown (length, pacing, evidence, …). */
  staticScore: import("../utils/rubric").StaticScore;
  /** Optional full-page narrative review, generated on demand. */
  review?: string;
  /** Provider tag for the narrative review. */
  reviewProvider?: string;
  /**
   * Relevance to the brief's audience and goal, 0-10, from the target-fit
   * judge. Caps the shape-derived criteria and scales the static weight in
   * the combined grade. Absent on results saved before the gate existed.
   */
  targetFit?: number;
  /**
   * The same criteria re-scored under the writer's own weights, 0-100. Shown
   * beside the editorial grade, never in place of it. Absent unless the
   * writer has customised their rubric.
   */
  writerScore?: number;
}

/** One editor's full-page memo on the whole document. */
export interface PersonaMemo {
  personaId: string;
  personaName: string;
  personaColor: string;
  text: string;
  anchor?: string;
  provider: string;
}

/** The expanded cast analysis: per-persona memos plus a combined synthesis. */
export interface RoomAnalysis {
  /** Folio whose manuscript the room analyzed. */
  folioId?: string;
  memos: PersonaMemo[];
  synthesis: string;
  synthesisProvider: string;
  briefTitle?: string;
  timestamp: number;
}

/* ── Document chrome — page layout, header, footer, running metadata ── */

export type DocWidth = "narrow" | "normal" | "wide";
export type DocMargin = "tight" | "normal" | "roomy";

export interface LayoutSettings {
  width: DocWidth;
  /**
   * Legacy coarse margin preset. Kept for backward compatibility and used as
   * the fallback when the numeric margins below are absent. New documents and
   * the layout sliders write the numeric fields instead.
   */
  margin: DocMargin;
  /**
   * Symmetric side margin, in rem. Falls back to {@link margin} when
   * undefined, and is itself the fallback for the independent left/right
   * values below — documents written before the ruler existed have only this.
   */
  marginX?: number;
  /** Left page margin, in rem. Falls back to {@link marginX}. */
  marginLeft?: number;
  /** Right page margin, in rem. Falls back to {@link marginX}. */
  marginRight?: number;
  /** Top (header) page margin, in rem. */
  marginTop?: number;
  /** Bottom (footer) page margin, in rem. */
  marginBottom?: number;
  /** Show brief title / author / date in the running header (print + reading view). */
  runningHeader: boolean;
  /** Show page numbers in the footer of printed/exported output. */
  pageNumbers: boolean;
  /** Show live margin/header/footer guide rules in the editor page. */
  showMarginGuides?: boolean;
  /**
   * Physical sheet the manuscript is set on. Absent on documents written
   * before pagination existed; {@link resolvePageSetup} fills in Letter.
   */
  paper?: PaperSize;
  /** Sheet orientation. Absent on pre-pagination documents — defaults to portrait. */
  orientation?: Orientation;
  /**
   * Whether the editor renders discrete page sheets or one continuous
   * column. Continuous is the pre-pagination behaviour and remains the
   * escape hatch for very long manuscripts.
   */
  pagination?: PaginationMode;
  /**
   * Display unit for the ruler readout only. Margins are *stored* in rem
   * regardless — this changes how they are shown, never how they are saved.
   */
  marginUnit?: MarginUnit;
}

export type PaperSize = "letter" | "a4" | "legal";
export type Orientation = "portrait" | "landscape";
export type PaginationMode = "paginated" | "continuous";
export type MarginUnit = "rem" | "in" | "mm";

/**
 * Paper dimensions in inches. Physical rather than typographic, so a sheet
 * is the same size no matter what the reader has done to their font size.
 */
export const PAPER_SIZE_IN: Record<PaperSize, { w: number; h: number }> = {
  letter: { w: 8.5, h: 11 },
  a4: { w: 8.2677, h: 11.6929 }, // 210 × 297 mm
  legal: { w: 8.5, h: 14 },
};

/**
 * CSS reference pixels per inch. Fixed by the CSS spec, and the value
 * Chrome's print engine uses when it lays out `@page`. This is the single
 * bridge between the rem-denominated margins the writer drags and the
 * inch-denominated sheet they print on — every conversion between the two
 * goes through here so the two units cannot drift apart.
 */
export const CSS_PX_PER_IN = 96;

export interface ResolvedPageSetup {
  paper: PaperSize;
  orientation: Orientation;
  pagination: PaginationMode;
  marginUnit: MarginUnit;
  /** Sheet width in inches, after orientation is applied. */
  widthIn: number;
  /** Sheet height in inches, after orientation is applied. */
  heightIn: number;
}

/**
 * Resolve the effective page setup for a layout.
 *
 * Every field is optional on {@link LayoutSettings} precisely so that a folio
 * saved before pagination existed still opens: it deserializes with all four
 * undefined and lands on Letter / portrait / paginated / rem. This is the
 * same generational-fallback discipline {@link resolveMargins} documents.
 */
export function resolvePageSetup(layout: LayoutSettings): ResolvedPageSetup {
  const paper = layout.paper ?? "letter";
  const orientation = layout.orientation ?? "portrait";
  const size = PAPER_SIZE_IN[paper] ?? PAPER_SIZE_IN.letter;
  const landscape = orientation === "landscape";
  return {
    paper,
    orientation,
    // Continuous is the default *view*: writers draft by scrolling, and
    // sheet view is the thing you switch to when you care what the page
    // looks like. Export does not read this fallback — print is paginated
    // whether or not the document ever expressed an opinion. See
    // `exchange.ts`, which resolves the print page model separately.
    pagination: layout.pagination ?? "continuous",
    marginUnit: layout.marginUnit ?? "rem",
    widthIn: landscape ? size.h : size.w,
    heightIn: landscape ? size.w : size.h,
  };
}

/**
 * Text-column width, in rem, for each {@link DocWidth}. Shared so the page,
 * the ruler above it, and the exported document cannot disagree about how
 * wide the page is.
 */
export const DOC_WIDTH_REM: Record<DocWidth, number> = {
  narrow: 36,
  normal: 48,
  wide: 62,
};

/** Side-margin rem values for the legacy coarse {@link DocMargin} presets. */
export const MARGIN_PRESET_REM: Record<DocMargin, number> = {
  tight: 1.5,
  normal: 3,
  roomy: 5,
};

/** Allowed range (rem) for each adjustable page margin. */
export const MARGIN_RANGE = {
  left: { min: 0, max: 8, step: 0.25 },
  right: { min: 0, max: 8, step: 0.25 },
  top: { min: 0, max: 8, step: 0.25 },
  bottom: { min: 0, max: 8, step: 0.25 },
} as const;

export interface ResolvedMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Resolve the effective numeric page margins (in rem) for a layout.
 *
 * Three generations of the setting have to keep rendering: the coarse
 * `margin` preset, the symmetric `marginX`, and the independent left/right
 * the ruler writes. Each falls back to the one before it, so an old document
 * opens with the page its writer chose rather than the current default.
 */
export function resolveMargins(layout: LayoutSettings): ResolvedMargins {
  const presetX = MARGIN_PRESET_REM[layout.margin] ?? MARGIN_PRESET_REM.normal;
  const x = layout.marginX ?? presetX;
  return {
    left: layout.marginLeft ?? x,
    right: layout.marginRight ?? x,
    top: layout.marginTop ?? (layout.margin === "roomy" ? 5 : 2.5),
    bottom: layout.marginBottom ?? (layout.margin === "roomy" ? 5 : 4),
  };
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  width: "normal",
  margin: "normal",
  marginX: 2,
  marginLeft: 2,
  marginRight: 2,
  marginTop: 1,
  marginBottom: 1,
  runningHeader: false,
  pageNumbers: true,
  showMarginGuides: false,
  paper: "letter",
  orientation: "portrait",
  // Deliberately unset, not "continuous". Leaving it absent is what lets the
  // screen and the printer disagree sensibly: the editor resolves an unset
  // value to continuous (writers draft by scrolling) while export resolves it
  // to paginated (a PDF is a physical object). Once the writer picks a mode
  // in the layout panel, that choice is explicit and both surfaces honour it.
  marginUnit: "rem",
};

export interface Comment {
  id: string;
  text: string;
  selectedText: string;
  from: number;
  to: number;
  author: string;
  timestamp: number;
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  text: string;
  author: string;
  timestamp: number;
}

export type PersonaReplyAuthor = "user" | "persona";

/** A single reply in a persona-note conversation. */
export interface PersonaReply {
  id: string;
  /** Folio whose room thread owns this reply. */
  folioId?: string;
  /** Note (PersonaFeedback.noteId) this reply is attached to. */
  noteId: string;
  author: string;
  authorKind: PersonaReplyAuthor;
  /** Set when authorKind === "persona". */
  personaId?: string;
  text: string;
  timestamp: number;
}

export interface DetectedCitation {
  id: string;
  text: string;
  from: number;
  to: number;
  type: "url" | "doi" | "isbn" | "author-year" | "footnote";
  lookupUrl?: string;
  metadata?: Record<string, string>;
}

/**
 * What kind of thing in a draft the Apparatus decides needs backing up.
 * The extractor (not a regex) chooses this per passage — works include
 * films, books, songs and plays; statistics are numeric claims; quotes
 * are attributed speech, however the draft found it.
 */
export type ResearchTargetKind =
  | "quote"
  | "work"
  | "person"
  | "statistic"
  | "claim"
  | "event";

/**
 * A citable thing the background agent pulled out of the draft. It is the
 * unit of auto-research: the apparatus hunts a source for exactly one of
 * these at a time, instead of googling the whole essay.
 */
export interface ResearchTarget {
  /** Stable id for the pass (used for UI keys, not persistence). */
  id: string;
  kind: ResearchTargetKind;
  /** The passage verbatim just as it appears in the draft. */
  anchor: string;
  /** Why this specific thing should not stand uncited. */
  reason: string;
  /** The precise query the search providers should receive for this target. */
  query: string;
  /** 1 (nice-to-have) to 5 (the argument collapses without it). */
  importance: number;
}

/** The target a background-saved bibliography entry was found for. */
export interface ResearchTargetRef {
  kind: ResearchTargetKind;
  anchor: string;
  query: string;
  reason?: string;
}

export interface DroppedAsset {
  type: "image" | "table" | "plot";
  data: string;
  position: number;
  caption?: string;
  metadata?: Record<string, string>;
}

export interface DocumentMeta {
  title: string;
  wordCount: number;
  characterCount: number;
  readingTime: number;
  lastEdited: number;
}

export interface ProjectInterviewAnswers {
  workingTitle: string;
  format: string;
  audience: string;
  goal: string;
  tone: string;
  constraints: string;
  successSignal: string;
}

export interface DossierAttachment {
  id: string;
  kind: "document" | "link";
  title: string;
  /** kind === "link" (or an optional source URL for a document). */
  url?: string;
  /** kind === "document": pasted/uploaded text, capped ~2000 chars. */
  text?: string;
  /** Required one-line note on why this matters to the piece. */
  why: string;
  addedAt: number;
}

/**
 * A typed follow-up question the interviewer generates from what it has
 * already learned. The seven prose fields say what the piece is; probes
 * sharpen the parts a paragraph of prose left soft — and because the answers
 * are structured rather than free text, the judges can use them directly.
 */
export type ProbeKind = "choice" | "multi" | "blanks" | "scale";

export interface DossierProbe {
  id: string;
  kind: ProbeKind;
  /** The question, as the writer reads it. */
  prompt: string;
  /** choice / multi: the options to pick from. */
  options?: string[];
  /** blanks: a sentence with `___` where the writer fills in, e.g.
   *  "The reader should leave ___ and do ___." */
  template?: string;
  /** scale: the range and what each end means. */
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  /** The writer's answer: string for choice, string[] for multi/blanks,
   *  number for scale. Absent until answered. */
  answer?: string | string[] | number;
  /** Which brief field this sharpens, when it maps cleanly to one. */
  relatesTo?: keyof ProjectInterviewAnswers;
}

export interface ProjectBrief {
  answers: ProjectInterviewAnswers;
  attachments: DossierAttachment[];
  completedAt: number;
  updatedAt: number;
  /**
   * Typed follow-ups the writer answered during the interview. Optional so
   * every brief saved before probes existed keeps working untouched.
   */
  probes?: DossierProbe[];
}

export interface Folio {
  id: string;
  name: string;
  type: "draft" | "notes" | "outline";
  createdAt: number;
  updatedAt: number;
  /** Tunable page layout (margins, width, running header, page numbers). */
  layout?: LayoutSettings;
  /** Optional free-text running header for the editor surface. */
  header?: string;
  /** Optional free-text running footer for the editor surface. */
  footer?: string;
}

export interface LixVersion {
  id: string;
  name: string;
}

export interface LixChangeProposal {
  id: string;
  sourceVersionId: string;
  targetVersionId: string;
  status: "open" | "accepted" | "rejected";
  authorName: string;
  createdAt: number;
}

export interface LixHistoryEntry {
  depth: number;
  data: unknown;
}

/* ── Editorial change proposals (editors propose edits to the manuscript) ── */

/** How large an edit a single suggestion makes. */
export type SuggestionKind = "sentence" | "paragraph";

/**
 * An editor's proposed rewrite of one block, backed by a Lix branch
 * (`versionId`). The original/replacement html lets the editor render an
 * inline tracked change; accepting merges the branch into the writer's
 * current version.
 */
export interface Suggestion {
  /** Proposal id; also the SuggestionMark id in the manuscript. */
  id: string;
  /** Folio whose manuscript owns this proposal. */
  folioId?: string;
  /** Lix version (branch) holding the proposed block edit. */
  versionId: string;
  personaId: string;
  personaName: string;
  color: string;
  /** Block (top-level Tiptap node) the edit targets. */
  blockId: string;
  /** The exact passage in the block this replaces (anchor for the mark). */
  original: string;
  /** Proposed replacement passage. */
  replacement: string;
  /** One-line justification, in the editor's voice. */
  rationale: string;
  kind: SuggestionKind;
  status: "open" | "accepted" | "rejected";
  createdAt: number;
}

/** Payload of the `twyne:suggestions` window event: edits to pin inline. */
export interface SuggestionPayload {
  id: string;
  versionId: string;
  author: string;
  color: string;
  original: string;
  replacement: string;
  rationale: string;
  /** Exact passage to locate and mark in the manuscript. */
  quote: string;
}

/* ── Tunable assistance (the editor-room settings) ── */

export type AssistanceLevel = "comments" | "sentence" | "paragraph";

/**
 * Writer-controlled settings for how much the room edits. `level` is the
 * room-wide ceiling; `perPersona` overrides it for individual editors;
 * the budgets cap a proactive "mark up my draft" pass.
 */
export interface RoomSettings {
  level: AssistanceLevel;
  /** Total proposals allowed per markup pass. */
  maxProposals: number;
  /** Separate, smaller budget for paragraph-class edits. */
  maxLargeEdits: number;
  /** Persona ids allowed to propose; empty means "all in scope". */
  personaScope: string[];
  /** Optional per-editor level override. */
  perPersona?: Record<string, AssistanceLevel>;
  /**
   * Whether the room reads new material on its own while the writer works.
   * Optional so settings saved before the background room existed keep
   * working; `undefined` is treated as on.
   */
  backgroundRoom?: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  level: "sentence",
  maxProposals: 6,
  maxLargeEdits: 2,
  personaScope: [],
  backgroundRoom: true,
};

/* ── Bibliography (re-exports from utils/bibliography) ─────────── */

export type { BibEntry, CitationStyle } from "../utils/bibliography";

/** Result of an LLM-formatted source summary. */
export interface SourceSummarizeResult {
  summary: string;
  keyClaims: string[];
  relevanceScore: number;
  provider: string;
}

/* ── Conversational interview / dossier check ──────────────────── */

export type InterviewStyle = "form" | "conversational";

export interface DossierObservation {
  field: keyof ProjectInterviewAnswers;
  current: string;
  suggested: string;
  reason: string;
}

export interface DossierCheckResult {
  observations: DossierObservation[];
  provider: string;
}

/* ── AI Provider & BYOK Configuration ───────────────────────────── */

export type AiProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "anthropic-compatible"
  | "openai-compatible"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "zai"
  | "minimax"
  // Voice only: Fish Audio speaks and transcribes but is not an LLM, so it
  // never counts as a provider for persona/rubric work.
  | "fishaudio"
  // Desktop-only: native LiteRT (Gemma 4 E4B) served on loopback by the
  // Electrobun shell. Auto-registered, never added by hand — see desktop-bridge.
  | "litert";

export interface AiProviderConfig {
  id: string;
  name: string;
  type: AiProviderType;
  /** Provider identifier from models.dev, when configured from its catalog. */
  modelsDevId?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  availableModels?: string[];
  /** Modality metadata for models discovered from models.dev. */
  modelModalities?: Record<string, AiModelModalities>;
}

export interface AiModelModalities {
  input: string[];
  output: string[];
}

export type AiFeature =
  | "persona-feedback"
  | "persona-reply"
  | "persona-rewrite"
  | "persona-analysis"
  | "room-synthesis"
  | "rubric-judge"
  | "rubric-review"
  | "voice-narration"
  | "voice-transcription"
  | "comment-reply"
  | "citation-format"
  | "source-summarize"
  | "source-detect-missing"
  | "research-web-search"
  | "research-extract"
  | "interview-turn"
  | "dossier-check";

/** Private context the room may use to speak to this writer as a person. */
export interface WriterProfile {
  /** Name the editors should use when addressing the writer. */
  displayName: string;
  /** Personal context that is useful to the room, one fact or detail per line. */
  personalFacts: string;
  /** How much pressure the writer wants in ordinary feedback. */
  feedbackStyle: "direct" | "balanced" | "gentle";
  /** Writer-authored guidance about what feedback should notice or avoid. */
  feedbackNotes: string;
}

export const DEFAULT_WRITER_PROFILE: WriterProfile = {
  displayName: "",
  personalFacts: "",
  feedbackStyle: "balanced",
  feedbackNotes: "",
};

/** Writer-level preferences (identity, feedback, and onboarding). */
export interface WriterSettings {
  /** Form-based AntiTabulaRasa vs the conversational interview. */
  interviewStyle: "form" | "conversational";
  /** Private, account-local context included in editorial-room prompts. */
  profile: WriterProfile;
}

export const DEFAULT_WRITER_SETTINGS: WriterSettings = {
  interviewStyle: "form",
  profile: { ...DEFAULT_WRITER_PROFILE },
};

export type ApparatusCitationStyle = "mla" | "apa" | "chicago";
export type ApparatusResearchProvider =
  | "hosted"
  | "tinyfish"
  | "model-web-search"
  | "web-mcp";

export interface ApparatusSettings {
  defaultCitationStyle: ApparatusCitationStyle;
  aiEnhanceCitations: boolean;
  flagMissingSources: boolean;
  researchProvider: ApparatusResearchProvider;
  tinyFishApiKey: string;
  tinyFishMaxResults: number;
  mcpEndpointUrl: string;
  mcpToolName: string;
  mcpBearerToken: string;
}

export const DEFAULT_APPARATUS_SETTINGS: ApparatusSettings = {
  defaultCitationStyle: "mla",
  aiEnhanceCitations: true,
  flagMissingSources: false,
  researchProvider: "hosted",
  tinyFishApiKey: "",
  tinyFishMaxResults: 8,
  mcpEndpointUrl: "",
  mcpToolName: "search",
  mcpBearerToken: "",
};

export interface AiFeatureOverride {
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  voice?: string;
  speed?: number;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  instructions?: string;
}

export interface AiSettings {
  advancedMode: boolean;
  providers: AiProviderConfig[];
  defaultProviderId: string | null;
  perFeature: Partial<Record<AiFeature, AiFeatureOverride>>;
  showProviderTags: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  advancedMode: false,
  providers: [],
  defaultProviderId: null,
  perFeature: {},
  showProviderTags: false,
};

/* ── Provider metadata (labels, defaults) ───────────────────────── */

export interface ProviderMeta {
  type: AiProviderType;
  label: string;
  defaultModels: string[];
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  apiKeyOptional?: boolean;
  defaultApiKey?: string;
  /**
   * Speaks and listens but cannot think. A voice-only provider is never
   * offered to the persona, rubric or interview features, and — crucially —
   * having one configured does not make {@link hasConfiguredAiProvider} true,
   * because those features would then take the BYOK path and find no model.
   */
  voiceOnly?: boolean;
}

/** Provider types that do speech but not language. */
export const VOICE_ONLY_PROVIDER_TYPES: ReadonlyArray<AiProviderType> = [
  "fishaudio",
];

export const PROVIDER_METAS: ProviderMeta[] = [
  {
    type: "openai",
    label: "OpenAI",
    defaultModels: ["gpt-5.5", "gpt-5.5-mini", "gpt-5.5-nano"],
    needsBaseUrl: false,
  },
  {
    type: "anthropic",
    label: "Anthropic",
    defaultModels: ["claude-sonnet-4-6", "claude-haiku-4-6"],
    needsBaseUrl: false,
  },
  {
    type: "anthropic-compatible",
    label: "Anthropic-compatible",
    defaultModels: ["claude-sonnet-4-6"],
    needsBaseUrl: true,
  },
  {
    type: "google",
    label: "Google",
    defaultModels: [
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ],
    needsBaseUrl: false,
  },
  {
    type: "openai-compatible",
    label: "OpenAI-compatible",
    defaultModels: [],
    needsBaseUrl: true,
  },
  {
    type: "deepseek",
    label: "DeepSeek",
    defaultModels: [],
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.deepseek.com",
  },
  {
    type: "openrouter",
    label: "OpenRouter",
    defaultModels: [],
    needsBaseUrl: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    type: "ollama",
    label: "Ollama",
    defaultModels: [],
    needsBaseUrl: true,
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    apiKeyOptional: true,
    defaultApiKey: "ollama",
  },
  {
    type: "zai",
    label: "Z.ai / GLM",
    defaultModels: [],
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
  },
  {
    type: "minimax",
    label: "MiniMax",
    defaultModels: [],
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.minimax.io/v1",
  },
  {
    type: "litert",
    label: "Local — Gemma 4 E4B",
    defaultModels: ["gemma-4-e4b"],
    needsBaseUrl: true,
  },
  {
    type: "fishaudio",
    label: "Fish Audio (voice only)",
    // Fish's v1 TTS endpoint documents s2-pro and s1. `asr-1` is the
    // transcription model and is kept available for voice notes.
    defaultModels: ["s2-pro", "s1", "asr-1"],
    needsBaseUrl: false,
    voiceOnly: true,
  },
];
