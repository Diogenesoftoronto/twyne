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
}

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

/* ── Folio (the writer's working document) ──────────────────────── */

export interface Folio {
  id: string;
  title: string;
  /** Optional short blurb / working subtitle. */
  subtitle?: string;
  /** Optional explicit word-count target. */
  targetWordCount?: number;
  /** Owner/created-by identifier (no auth model in BYOK mode). */
  ownerId?: string;
  createdAt: number;
  updatedAt: number;
  /** Last time the writer actually edited the document body. */
  lastEditedAt?: number;
  /** Optional archive flag — archived folios are hidden from the main list. */
  archived?: boolean;
  /** Tag list for ad-hoc grouping in the library view. */
  tags?: string[];
}

/* ── Lix types (versioned document store) ───────────────────────── */

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

/* ── AI provider configuration (BYOK, stored only in IndexedDB) ── */

export type AiProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible";

export type AiFeature =
  | "persona-feedback"
  | "persona-reply"
  | "persona-rewrite"
  | "rubric-judge"
  | "comment-reply"
  | "citation-format"
  | "source-summarize"
  | "source-detect-missing";

/* ── Client-side AI results (re-exported for the UI) ─────────────── */

/** Result of an LLM-formatted citation. */
export interface SourceSummarizeResult {
  summary: string;
  keyClaims: string[];
  relevanceScore: number;
  provider: string;
}

export interface AiProviderConfig {
  id: string;
  type: AiProviderType;
  /** Display label for the UI. */
  name: string;
  /** Provider API key — never leaves the browser. */
  apiKey: string;
  /** The default model id for this provider (e.g. "gpt-4o-mini"). */
  defaultModel: string;
  /** For openai-compatible: required base URL of the API. */
  baseUrl?: string;
  /** Free-form notes for the writer (shown in the settings panel). */
  notes?: string;
  /** When this provider was added to the settings. */
  addedAt?: number;
}

export interface AiFeatureOverride {
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiSettings {
  /** Master switch — when false, all BYOK calls short-circuit. */
  advancedMode: boolean;
  providers: AiProviderConfig[];
  defaultProviderId: string | null;
  perFeature: Partial<Record<AiFeature, AiFeatureOverride>>;
  /** Whether the UI shows "via openai" / "via anthropic" provider tags. */
  showProviderTags: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  advancedMode: false,
  providers: [],
  defaultProviderId: null,
  perFeature: {},
  showProviderTags: false,
};

export interface AiProviderMeta {
  type: AiProviderType;
  label: string;
  /** Help text shown beside the API-key field. */
  help: string;
  /** Default model ids to offer in the model picker. */
  defaultModels: string[];
  /** Whether this provider needs a baseUrl field. */
  needsBaseUrl: boolean;
  /** Whether this provider needs an API key. */
  needsApiKey: boolean;
  /** Human-readable placeholder for the model field. */
  modelPlaceholder: string;
}

export const PROVIDER_METAS: ReadonlyArray<AiProviderMeta> = [
  {
    type: "openai",
    label: "OpenAI",
    help: "Direct OpenAI API. Your key is stored only in this browser's IndexedDB.",
    defaultModels: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    needsBaseUrl: false,
    needsApiKey: true,
    modelPlaceholder: "gpt-4o-mini",
  },
  {
    type: "anthropic",
    label: "Anthropic",
    help: "Direct Anthropic API. Your key is stored only in this browser's IndexedDB.",
    defaultModels: [
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
    ],
    needsBaseUrl: false,
    needsApiKey: true,
    modelPlaceholder: "claude-3-5-sonnet-latest",
  },
  {
    type: "google",
    label: "Google AI",
    help: "Google Generative AI (Gemini). Your key is stored only in this browser's IndexedDB.",
    defaultModels: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"],
    needsBaseUrl: false,
    needsApiKey: true,
    modelPlaceholder: "gemini-1.5-flash",
  },
  {
    type: "openai-compatible",
    label: "OpenAI-compatible",
    help: "Any OpenAI-compatible endpoint (OpenRouter, Together, local Ollama, etc.). Provide the base URL.",
    defaultModels: ["default"],
    needsBaseUrl: true,
    needsApiKey: true,
    modelPlaceholder: "model-id",
  },
];
