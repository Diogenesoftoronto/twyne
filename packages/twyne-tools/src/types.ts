export type FolioType = "draft" | "notes" | "outline";

export interface Folio {
  id?: string;
  name: string;
  type?: FolioType;
  createdAt?: number;
  updatedAt?: number;
  layout?: unknown;
  header?: string;
  footer?: string;
  [key: string]: unknown;
}

export const FOLIO_INCLUDES = [
  "content",
  "brief",
  "feedback",
  "rubric",
  "suggestions",
  "citations",
] as const;

export type FolioInclude = (typeof FOLIO_INCLUDES)[number];

export interface FolioBundle {
  folio: Folio;
  html?: string;
  contentUpdatedAt?: number | null;
  brief?: unknown;
  feedback?: unknown;
  rubric?: unknown;
  suggestions?: unknown[];
  citations?: CitationEntry[];
  [key: string]: unknown;
}

export interface CitationEntry {
  id?: string;
  title: string;
  folioId?: string;
  author?: string;
  url?: string;
  doi?: string;
  citationKey?: string;
  accessedAt?: number;
  [key: string]: unknown;
}

export interface SearchResult {
  folio: Folio;
  snippet: string;
  score: number;
}

export interface PutFolioInput {
  folio: Folio;
  html?: string;
  brief?: unknown;
  expectedUpdatedAt?: number;
}

export interface IntegrationRequest {
  operation: string;
  [key: string]: unknown;
}

export interface IntegrationSuccess<T> {
  ok: true;
  data: T;
}

export interface IntegrationFailure {
  ok: false;
  error: string;
}

export const PERSONA_IDS = [
  "devil",
  "angel",
  "scholar",
  "editor",
  "reader",
] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
export type ResponseLocale = "en" | "fr" | "es" | "zh" | "hi" | "ja";
export type ProjectBrief = Record<string, unknown>;
export type EditorInstruction =
  | "feedback"
  | "elaborate"
  | "riff"
  | "rewrite-suggestion";

export interface EditorNote {
  personaId: string;
  personaName: string;
  text: string;
  type: "critique" | "suggestion" | "encouragement" | "perspective";
  provider: string;
  anchor?: string;
  anchors?: string[];
  extractions?: unknown[];
  traceId?: string;
  [key: string]: unknown;
}

export interface EditorSummary {
  id: string;
  name: string;
  role: string;
  description: string;
  focus: string;
  [key: string]: unknown;
}

export interface RubricScore {
  score: number;
  rationale: string;
  provider: string;
  [key: string]: unknown;
}

export interface RubricGrade {
  grade: string;
  combined: number;
  judgeMean: number;
  minJudge: number;
  staticTotal: number;
  staticFeedback: string[];
  judges: Array<RubricScore & { personaId: string }>;
  sufficiency: RubricScore;
  evidence: RubricScore;
  integrity: RubricScore;
  targetFit: RubricScore;
  custom: Array<RubricScore & { label: string }>;
  review: { text: string; provider: string } | null;
  [key: string]: unknown;
}

export interface DossierCheckResult {
  observations: Array<Record<string, unknown>>;
  provider: string;
  [key: string]: unknown;
}

export interface InterviewTurnResult {
  kind: "question" | "synthesis";
  text?: string;
  brief?: ProjectBrief;
  confidence?: Record<string, unknown>;
  draft?: Record<string, unknown>;
  probe?: Record<string, unknown>;
  provider: string;
  model: string;
  traceId?: string;
  [key: string]: unknown;
}

/** Exactly one source is required; MCP and CLI validate this before a request. */
export interface DraftInput {
  folioId?: string;
  draftText?: string;
  brief?: ProjectBrief | null;
  responseLocale?: ResponseLocale;
}

export interface ConveneRoomInput extends DraftInput {
  personaIds?: PersonaId[];
  writerProfile?: Record<string, unknown>;
  newMaterial?: unknown;
  trajectory?: unknown;
}

export interface AskEditorInput extends DraftInput {
  personaId: PersonaId;
  instruction?: EditorInstruction;
  userMessage?: string;
  priorMessages?: Array<Record<string, unknown>>;
  anchor?: string;
  writerProfile?: Record<string, unknown>;
}

export interface SuggestRewriteInput extends DraftInput {
  personaId: PersonaId;
  original: string;
  level: "sentence" | "paragraph";
  writerProfile?: Record<string, unknown>;
}

export interface SuggestRewriteResult {
  replacement: string;
  rationale: string;
  provider: string;
  [key: string]: unknown;
}

export interface GradeDraftInput extends DraftInput {
  criteria?: Array<{ label: string; description: string }>;
}

export interface CheckDossierInput extends DraftInput {
  brief: ProjectBrief | null;
}

export interface InterviewTurnInput {
  messages: Array<{ author: "writer" | "interviewer"; text: string }>;
  mode: "first-run" | "refine";
  currentBrief?: ProjectBrief | null;
  startingMaterial?: string | null;
  responseLocale?: ResponseLocale;
}

export type ResearchTargetKind =
  | "quote"
  | "work"
  | "person"
  | "statistic"
  | "claim"
  | "event";

export interface ResearchTarget {
  id: string;
  kind: ResearchTargetKind;
  anchor: string;
  reason: string;
  query: string;
  importance: number;
  [key: string]: unknown;
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  author?: string;
  publisher?: string;
  date?: string;
  why?: string;
  [key: string]: unknown;
}

export interface ResearchTargetsResult {
  strategy: "hosted" | "model";
  provider: string;
  mode: "fiction" | "nonfiction" | "general";
  targets: ResearchTarget[];
  candidates?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ResearchSourcesResult {
  provider: string;
  results: ResearchSource[];
  ranked: ResearchSource[];
  [key: string]: unknown;
}

export interface FindResearchTargetsInput {
  folioId?: string;
  draftText?: string;
  brief?: ProjectBrief | null;
  strategy?: "hosted" | "model";
  maxTargets?: number;
  existingSources?: string[];
  [key: string]: unknown;
}

export interface SearchResearchSourcesInput {
  target: {
    kind: ResearchTargetKind;
    anchor: string;
    query: string;
    reason?: string;
    [key: string]: unknown;
  };
  maxResults?: number;
  [key: string]: unknown;
}
