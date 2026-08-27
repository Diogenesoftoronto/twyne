import { marked, Renderer } from "marked";
import {
  STANDARD_SITE_DOCUMENT_COLLECTION,
  STANDARD_SITE_PUBLICATION_COLLECTION,
  decodeStandardSiteDid,
  documentAtUri,
  isTid,
  publicationAtUri,
  standardSiteDocumentPath,
  standardSiteDocumentUrl,
  standardSitePublicationUrl,
} from "./standard-site-paths";

const MAX_RECORD_BYTES = 1_050_000;
const REQUEST_TIMEOUT_MS = 7_000;
const PLC_DID_RE = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB_PREFIX = "did:web:";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface StandardSitePublication {
  uri: string;
  did: string;
  rkey: string;
  name: string;
  description: string | null;
  url: string;
}

export interface StandardSiteDocumentSummary {
  uri: string;
  rkey: string;
  title: string;
  description: string | null;
  publishedAt: string;
  updatedAt: string | null;
  url: string;
}

export interface StandardSiteDocument extends StandardSiteDocumentSummary {
  textContent: string;
  markdown: string | null;
  html: string;
}

export interface StandardSitePublicationPage {
  publication: StandardSitePublication;
  documents: StandardSiteDocumentSummary[];
}

export interface StandardSiteDocumentPage {
  publication: StandardSitePublication;
  document: StandardSiteDocument;
}

function recordObject(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringField(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isDisallowedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) ||
    normalized.startsWith("[")
  );
}

function safeServiceEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isDisallowedHost(url.hostname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function didWebDocumentUrl(did: string): string | null {
  if (!did.startsWith(DID_WEB_PREFIX)) return null;
  const encodedSegments = did.slice(DID_WEB_PREFIX.length).split(":");
  if (encodedSegments.length === 0 || encodedSegments.some((part) => !part)) {
    return null;
  }

  try {
    const host = decodeURIComponent(encodedSegments[0]);
    const origin = new URL(`https://${host}`);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.port ||
      origin.pathname !== "/" ||
      isDisallowedHost(origin.hostname)
    ) {
      return null;
    }

    const path = encodedSegments.slice(1).map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (
        !decoded ||
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        [...decoded].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127;
        })
      ) {
        throw new Error("Invalid did:web path");
      }
      return encodeURIComponent(decoded);
    });
    return path.length === 0
      ? `${origin.origin}/.well-known/did.json`
      : `${origin.origin}/${path.join("/")}/did.json`;
  } catch {
    return null;
  }
}

async function fetchJson(
  url: string | URL,
  fetcher: Fetcher,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`ATProto request failed (${response.status})`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_RECORD_BYTES)
      throw new Error("ATProto record is too large");
    const text = await response.text();
    if (text.length > MAX_RECORD_BYTES)
      throw new Error("ATProto record is too large");
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePds(did: string, fetcher: Fetcher): Promise<string> {
  const resolutionUrl = PLC_DID_RE.test(did)
    ? `https://plc.directory/${encodeURIComponent(did)}`
    : didWebDocumentUrl(did);
  if (!resolutionUrl) throw new Error("Unsupported ATProto DID");
  const document = recordObject(await fetchJson(resolutionUrl, fetcher));
  if (document?.id !== did) throw new Error("ATProto DID document mismatch");
  const services = Array.isArray(document?.service) ? document.service : [];
  for (const candidate of services) {
    const service = recordObject(candidate);
    if (
      service?.type !== "AtprotoPersonalDataServer" &&
      service?.id !== "#atproto_pds"
    ) {
      continue;
    }
    const endpoint = safeServiceEndpoint(service?.serviceEndpoint);
    if (endpoint) return endpoint;
  }
  throw new Error("ATProto PDS service is unavailable");
}

async function getRecord(
  did: string,
  collection: string,
  rkey: string,
  fetcher: Fetcher,
  pds?: string,
): Promise<UnknownRecord> {
  const endpoint = pds ?? (await resolvePds(did, fetcher));
  const url = new URL("/xrpc/com.atproto.repo.getRecord", endpoint);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set("rkey", rkey);
  const envelope = recordObject(await fetchJson(url, fetcher));
  const value = recordObject(envelope?.value);
  if (!value) throw new Error("ATProto record is malformed");
  return value;
}

async function listDocumentRecords(
  did: string,
  fetcher: Fetcher,
  pds: string,
): Promise<Array<{ uri: string; value: UnknownRecord }>> {
  const url = new URL("/xrpc/com.atproto.repo.listRecords", pds);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", STANDARD_SITE_DOCUMENT_COLLECTION);
  url.searchParams.set("limit", "100");
  url.searchParams.set("reverse", "true");
  const envelope = recordObject(await fetchJson(url, fetcher));
  const records = Array.isArray(envelope?.records) ? envelope.records : [];
  return records.flatMap((candidate) => {
    const entry = recordObject(candidate);
    const uri = typeof entry?.uri === "string" ? entry.uri : null;
    const value = recordObject(entry?.value);
    return uri && value ? [{ uri, value }] : [];
  });
}

function parsePublication(
  did: string,
  rkey: string,
  value: UnknownRecord,
): StandardSitePublication {
  const uri = publicationAtUri(did, rkey);
  const expectedUrl = standardSitePublicationUrl(did, rkey);
  const name = stringField(value, "name")?.trim();
  const url = stringField(value, "url")?.replace(/\/$/, "");
  if (
    value.$type !== STANDARD_SITE_PUBLICATION_COLLECTION ||
    !name ||
    url !== expectedUrl
  ) {
    throw new Error("Standard.site publication is not verified for this URL");
  }
  return {
    uri,
    did,
    rkey,
    name,
    description: stringField(value, "description")?.trim() || null,
    url,
  };
}

function safeHref(value: string, image = false): string | null {
  const trimmed = value.trim();
  if (/^(?:\/|#|\.\/|\.\.\/)/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") return trimmed;
    if (!image && url.protocol === "mailto:") return trimmed;
  } catch {
    // Invalid and non-relative URLs are deliberately dropped.
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderStandardSiteMarkdown(markdown: string): string {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const safe = safeHref(href);
    if (!safe) return label;
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(safe)}"${titleAttr} rel="nofollow ugc">${label}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const safe = safeHref(href, true);
    if (!safe) return escapeHtml(text);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${titleAttr}>`;
  };
  return marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  }) as string;
}

function markdownContent(value: UnknownRecord): string | null {
  const content = recordObject(value.content);
  if (content?.$type !== "at.markpub.markdown") return null;
  const text = recordObject(content.text);
  return stringField(text ?? {}, "markdown");
}

function documentSummary(
  did: string,
  publicationRkey: string,
  uri: string,
  value: UnknownRecord,
): StandardSiteDocumentSummary | null {
  const match = /^at:\/\/[^/]+\/site\.standard\.document\/([^/?#]+)$/.exec(uri);
  const rkey = match?.[1] ?? "";
  if (!isTid(rkey)) return null;
  const expectedSite = publicationAtUri(did, publicationRkey);
  const expectedPath = standardSiteDocumentPath(rkey);
  const title = stringField(value, "title")?.trim();
  const publishedAt = stringField(value, "publishedAt");
  if (
    value.$type !== STANDARD_SITE_DOCUMENT_COLLECTION ||
    value.site !== expectedSite ||
    value.path !== expectedPath ||
    !title ||
    !publishedAt ||
    Number.isNaN(Date.parse(publishedAt))
  ) {
    return null;
  }
  return {
    uri: documentAtUri(did, rkey),
    rkey,
    title,
    description: stringField(value, "description")?.trim() || null,
    publishedAt,
    updatedAt: stringField(value, "updatedAt"),
    url: standardSiteDocumentUrl(did, publicationRkey, rkey),
  };
}

export function standardSiteRouteDid(segment: string): string {
  const did = decodeStandardSiteDid(segment);
  if (!did) throw new Error("Invalid ATProto DID route");
  return did;
}

export async function loadStandardSitePublication(
  did: string,
  publicationRkey: string,
  fetcher: Fetcher = fetch,
): Promise<StandardSitePublicationPage> {
  if (!isTid(publicationRkey)) throw new Error("Invalid publication key");
  const pds = await resolvePds(did, fetcher);
  const publicationValue = await getRecord(
    did,
    STANDARD_SITE_PUBLICATION_COLLECTION,
    publicationRkey,
    fetcher,
    pds,
  );
  const publication = parsePublication(did, publicationRkey, publicationValue);
  const records = await listDocumentRecords(did, fetcher, pds);
  const documents = records
    .map(({ uri, value }) => documentSummary(did, publicationRkey, uri, value))
    .filter((document): document is StandardSiteDocumentSummary => !!document)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { publication, documents };
}

export async function loadStandardSiteDocument(
  did: string,
  publicationRkey: string,
  documentRkey: string,
  fetcher: Fetcher = fetch,
): Promise<StandardSiteDocumentPage> {
  if (!isTid(publicationRkey) || !isTid(documentRkey)) {
    throw new Error("Invalid Standard.site record key");
  }
  const pds = await resolvePds(did, fetcher);
  const [publicationValue, documentValue] = await Promise.all([
    getRecord(
      did,
      STANDARD_SITE_PUBLICATION_COLLECTION,
      publicationRkey,
      fetcher,
      pds,
    ),
    getRecord(
      did,
      STANDARD_SITE_DOCUMENT_COLLECTION,
      documentRkey,
      fetcher,
      pds,
    ),
  ]);
  const publication = parsePublication(did, publicationRkey, publicationValue);
  const uri = documentAtUri(did, documentRkey);
  const summary = documentSummary(did, publicationRkey, uri, documentValue);
  if (!summary)
    throw new Error("Standard.site document is not verified for this URL");
  const markdown = markdownContent(documentValue);
  const textContent = stringField(documentValue, "textContent") ?? "";
  const html = markdown
    ? renderStandardSiteMarkdown(markdown)
    : `<p>${escapeHtml(textContent)
        .replace(/\n{2,}/g, "</p><p>")
        .replace(/\n/g, "<br>")}</p>`;
  return {
    publication,
    document: { ...summary, textContent, markdown, html },
  };
}
