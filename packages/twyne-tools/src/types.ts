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
