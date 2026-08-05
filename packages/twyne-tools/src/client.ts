import { loadCredentials, normalizeApiUrl, type Credentials } from "./config.js";
import type {
  CitationEntry,
  Folio,
  FolioBundle,
  FolioInclude,
  IntegrationFailure,
  IntegrationRequest,
  IntegrationSuccess,
  PutFolioInput,
  SearchResult,
} from "./types.js";

export interface TwyneClientOptions {
  apiUrl: string;
  accessToken: string;
  fetch?: typeof globalThis.fetch;
}

export class TwyneApiError extends Error {
  readonly status: number;
  readonly operation: string;

  constructor(message: string, status: number, operation: string) {
    super(message);
    this.name = "TwyneApiError";
    this.status = status;
    this.operation = operation;
  }
}

function endpointFor(apiUrl: string): string {
  const normalized = normalizeApiUrl(apiUrl);
  if (normalized.endsWith("/api/integrations/v1")) return normalized;
  return `${normalized}/api/integrations/v1`;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const message = (body as Record<string, unknown>).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export class TwyneClient {
  readonly endpoint: string;
  readonly accessToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: TwyneClientOptions) {
    this.endpoint = endpointFor(options.apiUrl);
    this.accessToken = options.accessToken.trim();
    if (!this.accessToken) throw new Error("Twyne access token is required");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("This runtime does not provide fetch");
  }

  static async fromEnvironment(): Promise<TwyneClient> {
    const credentials = await loadCredentials();
    return TwyneClient.fromCredentials(credentials);
  }

  static fromCredentials(credentials: Pick<Credentials, "apiUrl" | "accessToken">): TwyneClient {
    return new TwyneClient(credentials);
  }

  async request<T>(request: IntegrationRequest, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "@twyne/tools",
        },
        body: JSON.stringify(request),
        signal,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TwyneApiError(`Could not reach Twyne: ${detail}`, 0, request.operation);
    }

    const text = await response.text();
    let body: IntegrationSuccess<T> | IntegrationFailure | undefined;
    try {
      body = text ? (JSON.parse(text) as IntegrationSuccess<T> | IntegrationFailure) : undefined;
    } catch {
      throw new TwyneApiError(
        `Twyne returned a non-JSON response (${response.status})`,
        response.status,
        request.operation,
      );
    }
    if (!response.ok || !body || body.ok !== true) {
      throw new TwyneApiError(
        errorMessage(body, `Twyne request failed (${response.status})`),
        response.status,
        request.operation,
      );
    }
    return body.data;
  }

  listFolios(signal?: AbortSignal): Promise<Folio[]> {
    return this.request({ operation: "folios.list" }, signal);
  }

  getFolio(
    folioId: string,
    include?: FolioInclude[],
    signal?: AbortSignal,
  ): Promise<FolioBundle | null> {
    return this.request(
      {
        operation: "folios.get",
        folioId,
        ...(include ? { include } : {}),
      },
      signal,
    );
  }

  putFolio(input: PutFolioInput, signal?: AbortSignal): Promise<Folio> {
    const request: IntegrationRequest = { operation: "folios.put", folio: input.folio };
    if (input.html !== undefined) request.html = input.html;
    if (input.brief !== undefined) request.brief = input.brief;
    if (input.expectedUpdatedAt !== undefined) {
      request.expectedUpdatedAt = input.expectedUpdatedAt;
    }
    return this.request(request, signal);
  }

  searchFolios(search: string, limit = 20, signal?: AbortSignal): Promise<SearchResult[]> {
    return this.request({ operation: "folios.search", search, limit }, signal);
  }

  getFeedback(folioId: string, signal?: AbortSignal): Promise<unknown> {
    return this.request({ operation: "feedback.get", folioId }, signal);
  }

  listCitations(
    filters: { folioId?: string; search?: string } = {},
    signal?: AbortSignal,
  ): Promise<CitationEntry[]> {
    return this.request({ operation: "citations.list", ...filters }, signal);
  }

  putCitations(
    folioId: string,
    entries: CitationEntry[],
    signal?: AbortSignal,
  ): Promise<{ saved: number }> {
    return this.request({ operation: "citations.put", folioId, entries }, signal);
  }
}
