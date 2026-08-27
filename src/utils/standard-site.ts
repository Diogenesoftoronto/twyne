/**
 * Publish Twyne folios to Standard.site records in the writer's own PDS.
 *
 * The PDS is the source of truth. Twyne only keeps record keys in local IDB
 * so a re-publish updates the same records and an unpublish can remove the
 * document again. Public reading and verification routes derive their lookup
 * directly from the AT-URI encoded in the canonical Twyne URL.
 */

import type { Agent } from "@atproto/api";
import type { Folio, ProjectBrief } from "../types";
import { htmlToMarkdown, stripHtml } from "./exchange";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import {
  STANDARD_SITE_DOCUMENT_COLLECTION,
  STANDARD_SITE_ORIGIN,
  STANDARD_SITE_PUBLICATION_COLLECTION,
  parseAtUri,
  standardSiteDocumentPath,
  standardSiteDocumentUrl,
  standardSitePublicationUrl,
} from "./standard-site-paths";

const LEGACY_PUBLICATION_META_KEY = "atproto-publication";
const legacyDocMetaKey = (folioId: string) => `atproto-doc-${folioId}`;
const publicationMetaKey = (did: string) =>
  `atproto-publication:${encodeURIComponent(did)}`;
const docMetaKey = (did: string, folioId: string) =>
  `atproto-doc:${encodeURIComponent(did)}:${folioId}`;

export interface PublicationRef {
  uri: string;
  name: string;
  url: string;
}

interface DocumentRef {
  uri: string;
  rkey: string;
  publicationUri?: string;
  /** ISO timestamp of the first publish, preserved across re-publishes. */
  publishedAt: string;
}

export interface PublishResult {
  /** The document's at:// URI. */
  uri: string;
  /** The publication record this document belongs to. */
  publicationUri: string;
  /** A human-openable, Standard.site-verifiable reading URL. */
  viewerUrl: string;
  /** Fallback explorer URL that works for any record. */
  explorerUrl: string;
}

type UnknownRecord = Record<string, unknown>;

function repoDid(agent: Agent): string {
  const did = (agent as Agent & { did?: string }).did ?? agent.assertDid;
  if (!did) throw new Error("Agent has no DID");
  return did;
}

function rkeyFromUri(uri: string, collection: string): string {
  const parsed = parseAtUri(uri);
  if (!parsed || parsed.collection !== collection) {
    throw new Error(`PDS returned an invalid ${collection} URI`);
  }
  return parsed.rkey;
}

function publicationBelongsToDid(
  publication: PublicationRef | null,
  did: string,
): publication is PublicationRef {
  const parsed = publication?.uri ? parseAtUri(publication.uri) : null;
  return (
    !!parsed &&
    parsed.did === did &&
    parsed.collection === STANDARD_SITE_PUBLICATION_COLLECTION
  );
}

function documentBelongsToDid(
  document: DocumentRef | null,
  did: string,
): document is DocumentRef {
  const parsed = document?.uri ? parseAtUri(document.uri) : null;
  const publication = document?.publicationUri
    ? parseAtUri(document.publicationUri)
    : null;
  return (
    !!parsed &&
    parsed.did === did &&
    parsed.collection === STANDARD_SITE_DOCUMENT_COLLECTION &&
    (!publication ||
      (publication.did === did &&
        publication.collection === STANDARD_SITE_PUBLICATION_COLLECTION))
  );
}

async function loadPublicationRef(did: string): Promise<PublicationRef | null> {
  const scoped = await loadMetaFromIdb<PublicationRef>(publicationMetaKey(did));
  if (publicationBelongsToDid(scoped, did)) return scoped;

  const legacy = await loadMetaFromIdb<PublicationRef>(
    LEGACY_PUBLICATION_META_KEY,
  );
  if (!publicationBelongsToDid(legacy, did)) return null;
  await saveMetaToIdb(publicationMetaKey(did), legacy);
  await saveMetaToIdb(LEGACY_PUBLICATION_META_KEY, null);
  return legacy;
}

async function loadDocumentRef(
  did: string,
  folioId: string,
): Promise<DocumentRef | null> {
  const scoped = await loadMetaFromIdb<DocumentRef>(docMetaKey(did, folioId));
  if (documentBelongsToDid(scoped, did)) return scoped;

  const legacyKey = legacyDocMetaKey(folioId);
  const legacy = await loadMetaFromIdb<DocumentRef>(legacyKey);
  if (!documentBelongsToDid(legacy, did)) return null;
  await saveMetaToIdb(docMetaKey(did, folioId), legacy);
  await saveMetaToIdb(legacyKey, null);
  return legacy;
}

function publicationRecord(
  current: UnknownRecord | null,
  opts: { name: string; url: string },
): UnknownRecord {
  return {
    ...(current ?? {}),
    $type: STANDARD_SITE_PUBLICATION_COLLECTION,
    name: opts.name,
    url: opts.url,
    preferences:
      current?.preferences && typeof current.preferences === "object"
        ? current.preferences
        : { showInDiscover: true },
  };
}

function documentRecord(opts: {
  folio: Folio;
  html: string;
  brief: ProjectBrief | null;
  publicationUri: string;
  publishedAt: string;
  updatedAt: string;
  path?: string;
}): UnknownRecord {
  const title =
    opts.folio.name || opts.brief?.answers.workingTitle || "Untitled";
  const description = opts.brief?.answers.goal?.trim() || undefined;
  const markdown = htmlToMarkdown(opts.html);

  return {
    $type: STANDARD_SITE_DOCUMENT_COLLECTION,
    site: opts.publicationUri,
    title,
    ...(opts.path ? { path: opts.path } : {}),
    publishedAt: opts.publishedAt,
    updatedAt: opts.updatedAt,
    ...(description ? { description } : {}),
    textContent: stripHtml(opts.html),
    content: {
      $type: "at.markpub.markdown",
      text: {
        $type: "at.markpub.text",
        markdown,
      },
      flavor: "gfm",
      renderingRules: "marked",
    },
  };
}

async function putPublication(
  agent: Agent,
  uri: string,
  name: string,
): Promise<PublicationRef> {
  const parsed = parseAtUri(uri);
  if (
    !parsed ||
    parsed.collection !== STANDARD_SITE_PUBLICATION_COLLECTION ||
    parsed.did !== repoDid(agent)
  ) {
    throw new Error(
      "Cached Standard.site publication does not belong to this PDS",
    );
  }

  let current: UnknownRecord | null = null;
  try {
    const existing = await agent.com.atproto.repo.getRecord({
      repo: parsed.did,
      collection: STANDARD_SITE_PUBLICATION_COLLECTION,
      rkey: parsed.rkey,
    });
    current = existing.data.value as UnknownRecord;
  } catch {
    // A stale local cache is allowed to recreate its deterministic record.
  }

  const url = standardSitePublicationUrl(parsed.did, parsed.rkey);
  await agent.com.atproto.repo.putRecord({
    repo: parsed.did,
    collection: STANDARD_SITE_PUBLICATION_COLLECTION,
    rkey: parsed.rkey,
    record: publicationRecord(current, { name, url }),
  });

  const ref = { uri, name, url };
  await saveMetaToIdb(publicationMetaKey(parsed.did), ref);
  return ref;
}

/** Find, migrate, or create the writer's Twyne Standard.site publication. */
export async function ensurePublication(
  agent: Agent,
  opts: { name: string },
): Promise<PublicationRef> {
  const did = repoDid(agent);
  const cached = await loadPublicationRef(did);
  if (cached?.uri) {
    try {
      return await putPublication(agent, cached.uri, opts.name);
    } catch {
      await saveMetaToIdb(publicationMetaKey(did), null);
    }
  }

  try {
    const existing = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: STANDARD_SITE_PUBLICATION_COLLECTION,
      limit: 100,
    });
    const candidate = existing.data.records.find((entry) => {
      const value = entry.value as { url?: unknown };
      if (typeof value.url !== "string") return false;
      return (
        value.url === STANDARD_SITE_ORIGIN ||
        value.url.startsWith(`${STANDARD_SITE_ORIGIN}/at/`)
      );
    });
    if (candidate) return await putPublication(agent, candidate.uri, opts.name);
  } catch {
    // The collection may not exist yet. Creation below is the normal path.
  }

  // createRecord supplies the TID. We immediately put the same record with
  // its canonical URL once that key is known.
  const created = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: STANDARD_SITE_PUBLICATION_COLLECTION,
    record: publicationRecord(null, {
      name: opts.name,
      url: STANDARD_SITE_ORIGIN,
    }),
  });
  return await putPublication(agent, created.data.uri, opts.name);
}

/** Publish or update one folio as a Standard.site document. */
export async function publishDocument(
  agent: Agent,
  opts: {
    folio: Folio;
    html: string;
    brief: ProjectBrief | null;
    publication: PublicationRef;
  },
): Promise<PublishResult> {
  const { folio, html, brief, publication } = opts;
  const did = repoDid(agent);
  const publicationParts = parseAtUri(publication.uri);
  if (
    !publicationParts ||
    publicationParts.did !== did ||
    publicationParts.collection !== STANDARD_SITE_PUBLICATION_COLLECTION
  ) {
    throw new Error("Standard.site publication does not belong to this PDS");
  }

  const now = new Date().toISOString();
  const prior = await loadDocumentRef(did, folio.id);
  const publishedAt = prior?.publishedAt || now;

  let uri: string;
  let rkey: string;
  if (prior?.rkey) {
    rkey = prior.rkey;
    const result = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: STANDARD_SITE_DOCUMENT_COLLECTION,
      rkey,
      record: documentRecord({
        folio,
        html,
        brief,
        publicationUri: publication.uri,
        path: standardSiteDocumentPath(rkey),
        publishedAt,
        updatedAt: now,
      }),
    });
    uri = result.data.uri;
  } else {
    const created = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: STANDARD_SITE_DOCUMENT_COLLECTION,
      record: documentRecord({
        folio,
        html,
        brief,
        publicationUri: publication.uri,
        publishedAt,
        updatedAt: now,
      }),
    });
    uri = created.data.uri;
    rkey = rkeyFromUri(uri, STANDARD_SITE_DOCUMENT_COLLECTION);
    const updated = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: STANDARD_SITE_DOCUMENT_COLLECTION,
      rkey,
      record: documentRecord({
        folio,
        html,
        brief,
        publicationUri: publication.uri,
        path: standardSiteDocumentPath(rkey),
        publishedAt,
        updatedAt: now,
      }),
    });
    uri = updated.data.uri;
  }

  const ref: DocumentRef = {
    uri,
    rkey,
    publicationUri: publication.uri,
    publishedAt,
  };
  await saveMetaToIdb(docMetaKey(did, folio.id), ref);

  const viewerUrl = standardSiteDocumentUrl(did, publicationParts.rkey, rkey);
  return {
    uri,
    publicationUri: publication.uri,
    viewerUrl,
    explorerUrl: `https://pdsls.dev/${encodeURIComponent(uri)}`,
  };
}

/** Return the locally-known PDS publication state for a folio, if any. */
export async function loadPublishedDocument(
  folioId: string,
  did: string,
): Promise<PublishResult | null> {
  const doc = await loadDocumentRef(did, folioId);
  const publication = await loadPublicationRef(did);
  if (!doc?.uri || !publication?.uri) return null;
  const documentParts = parseAtUri(doc.uri);
  const publicationParts = parseAtUri(publication.uri);
  if (
    !documentParts ||
    !publicationParts ||
    documentParts.did !== publicationParts.did
  ) {
    return null;
  }
  return {
    uri: doc.uri,
    publicationUri: publication.uri,
    viewerUrl: standardSiteDocumentUrl(
      documentParts.did,
      publicationParts.rkey,
      documentParts.rkey,
    ),
    explorerUrl: `https://pdsls.dev/${encodeURIComponent(doc.uri)}`,
  };
}

/** Delete the folio's Standard.site document from the writer's PDS. */
export async function unpublishDocument(
  agent: Agent,
  folioId: string,
): Promise<boolean> {
  const did = repoDid(agent);
  const prior = await loadDocumentRef(did, folioId);
  if (!prior?.uri) return false;
  const parsed = parseAtUri(prior.uri);
  if (
    !parsed ||
    parsed.did !== did ||
    parsed.collection !== STANDARD_SITE_DOCUMENT_COLLECTION
  ) {
    throw new Error(
      "Published Standard.site document does not belong to this PDS",
    );
  }
  await agent.com.atproto.repo.deleteRecord({
    repo: parsed.did,
    collection: STANDARD_SITE_DOCUMENT_COLLECTION,
    rkey: parsed.rkey,
  });
  await saveMetaToIdb(docMetaKey(did, folioId), null);
  return true;
}
