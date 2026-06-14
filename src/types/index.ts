export interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;
  icon: string;
  description: string;
  focus: string;
}

export interface PersonaFeedback {
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

export interface RubricResult {
  criteria: RubricCriterion[];
  overallScore: number;
  overallGrade: string;
  summary: string;
  timestamp: number;
  /** Per-persona judge scores, 0-10. */
  judges: import("../utils/rubric").JudgeResult[];
  /** Static-feature breakdown (length, pacing, evidence, …). */
  staticScore: import("../utils/rubric").StaticScore;
}

/* ── Document chrome — page layout, header, footer, running metadata ── */

export type DocWidth = "narrow" | "normal" | "wide";
export type DocMargin = "tight" | "normal" | "roomy";

export interface LayoutSettings {
  width: DocWidth;
  margin: DocMargin;
  /** Show brief title / author / date in the running header (print + reading view). */
  runningHeader: boolean;
  /** Show page numbers in the footer of printed/exported output. */
  pageNumbers: boolean;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  width: "normal",
  margin: "normal",
  runningHeader: false,
  pageNumbers: true,
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

export interface ProjectBrief {
  answers: ProjectInterviewAnswers;
  completedAt: number;
  updatedAt: number;
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
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  level: "sentence",
  maxProposals: 6,
  maxLargeEdits: 2,
  personaScope: [],
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
  | "openai-compatible";

export interface AiProviderConfig {
  id: string;
  name: string;
  type: AiProviderType;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
}

export type AiFeature =
  | "persona-feedback"
  | "persona-reply"
  | "persona-rewrite"
  | "rubric-judge"
  | "comment-reply"
  | "citation-format"
  | "source-summarize"
  | "source-detect-missing"
  | "interview-turn"
  | "dossier-check";

/** Writer-level preferences (how onboarding / interview behaves). */
export interface WriterSettings {
  /** Form-based AntiTabulaRasa vs the conversational interview. */
  interviewStyle: "form" | "conversational";
}

export interface AiFeatureOverride {
  providerId: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
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
}

export const PROVIDER_METAS: ProviderMeta[] = [
  {
    type: "openai",
    label: "OpenAI",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    needsBaseUrl: false,
  },
  {
    type: "anthropic",
    label: "Anthropic",
    defaultModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
    needsBaseUrl: false,
  },
  {
    type: "google",
    label: "Google",
    defaultModels: [
      "gemini-2.5-flash-preview-05-20",
      "gemini-2.5-pro-preview-06-05",
    ],
    needsBaseUrl: false,
  },
  {
    type: "openai-compatible",
    label: "OpenAI-compatible",
    defaultModels: ["anthropic/claude-sonnet-4-5"],
    needsBaseUrl: true,
  },
];
