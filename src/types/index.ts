export interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;
  icon: string;
  description: string;
  focus: string;
  /**
   * Rich voice specification — diction, sentence rhythm, signature moves, and
   * what this editor never does. Injected into the system prompt so the five
   * personas read as genuinely different writers. Optional and backward
   * compatible: when absent, the generic shared wording is used.
   */
  voice?: string;
  /** One or two few-shot lines written in this persona's voice. */
  sampleLines?: string[];
  /** Optional per-persona generation prefs (honored on the BYOK client path). */
  providerId?: string;
  model?: string;
  temperature?: number;
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
  /** Optional full-page narrative review, generated on demand. */
  review?: string;
  /** Provider tag for the narrative review. */
  reviewProvider?: string;
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
  /** Side (left/right) page margin, in rem. Falls back to {@link margin} when undefined. */
  marginX?: number;
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
}

/** Side-margin rem values for the legacy coarse {@link DocMargin} presets. */
export const MARGIN_PRESET_REM: Record<DocMargin, number> = {
  tight: 1.5,
  normal: 3,
  roomy: 5,
};

/** Allowed slider range (rem) for each adjustable page margin. */
export const MARGIN_RANGE = {
  x: { min: 0, max: 8, step: 0.25 },
  top: { min: 0, max: 8, step: 0.25 },
  bottom: { min: 0, max: 8, step: 0.25 },
} as const;

/**
 * Resolve the effective numeric page margins (in rem) for a layout, applying
 * sensible fallbacks so documents saved before numeric margins existed still
 * render correctly.
 */
export function resolveMargins(layout: LayoutSettings): {
  x: number;
  top: number;
  bottom: number;
} {
  const presetX = MARGIN_PRESET_REM[layout.margin] ?? MARGIN_PRESET_REM.normal;
  const x = layout.marginX ?? presetX;
  const top = layout.marginTop ?? (layout.margin === "roomy" ? 5 : 2.5);
  const bottom = layout.marginBottom ?? (layout.margin === "roomy" ? 5 : 4);
  return { x, top, bottom };
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  width: "normal",
  margin: "normal",
  marginX: 3,
  marginTop: 2.5,
  marginBottom: 4,
  runningHeader: false,
  pageNumbers: true,
  showMarginGuides: false,
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

export interface ProjectBrief {
  answers: ProjectInterviewAnswers;
  attachments: DossierAttachment[];
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
  | "anthropic-compatible"
  | "openai-compatible"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "zai"
  | "minimax"
  // Desktop-only: native LiteRT (Gemma 4 E4B) served on loopback by the
  // Electrobun shell. Auto-registered, never added by hand — see desktop-bridge.
  | "litert";

export interface AiProviderConfig {
  id: string;
  name: string;
  type: AiProviderType;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  availableModels?: string[];
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
  | "comment-reply"
  | "citation-format"
  | "source-summarize"
  | "source-detect-missing"
  | "research-web-search"
  | "interview-turn"
  | "dossier-check";

/** Writer-level preferences (how onboarding / interview behaves). */
export interface WriterSettings {
  /** Form-based AntiTabulaRasa vs the conversational interview. */
  interviewStyle: "form" | "conversational";
}

export const DEFAULT_WRITER_SETTINGS: WriterSettings = {
  interviewStyle: "form",
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
  aiEnhanceCitations: false,
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
}

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
];
