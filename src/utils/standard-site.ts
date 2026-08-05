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

const PUBLICATION_META_KEY = "atproto-publication";
const docMetaKey = (folioId: string) => `atproto-doc-${folioId}`;

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
  await saveMetaToIdb(PUBLICATION_META_KEY, ref);
  return ref;
}

/** Find, migrate, or create the writer's Twyne Standard.site publication. */
export async function ensurePublication(
  agent: Agent,
  opts: { name: string },
): Promise<PublicationRef> {
  const cached = await loadMetaFromIdb<PublicationRef>(PUBLICATION_META_KEY);
  if (cached?.uri) {
    try {
      return await putPublication(agent, cached.uri, opts.name);
    } catch {
      await saveMetaToIdb(PUBLICATION_META_KEY, null);
    }
  }

  const did = repoDid(agent);
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
  const prior = await loadMetaFromIdb<DocumentRef>(docMetaKey(folio.id));
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
  await saveMetaToIdb(docMetaKey(folio.id), ref);

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
): Promise<PublishResult | null> {
  const doc = await loadMetaFromIdb<DocumentRef>(docMetaKey(folioId));
  const publication =
    await loadMetaFromIdb<PublicationRef>(PUBLICATION_META_KEY);
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
  const prior = await loadMetaFromIdb<DocumentRef>(docMetaKey(folioId));
  if (!prior?.uri) return false;
  const parsed = parseAtUri(prior.uri);
  if (
    !parsed ||
    parsed.did !== repoDid(agent) ||
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
  await saveMetaToIdb(docMetaKey(folioId), null);
  return true;
}
