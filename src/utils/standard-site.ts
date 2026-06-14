/**
 * Publishing to a standard.site publication on the user's own ATProto PDS.
 *
 * Client-only: every call goes through an `@atproto/api` Agent built from a
 * live OAuth session (see src/utils/atproto.ts). Two records are involved:
 *
 *   site.standard.publication  — one per Twyne writer (named from the brief).
 *   site.standard.document     — one per folio, filed under the publication.
 *
 * We keep a single publication and re-use it; each folio maps to a document
 * whose rkey we persist in IDB so re-publishing updates in place rather than
 * forking a new record.
 *
 * Reference: mozzius/standard.horse and the site.standard lexicons.
 */

import type { Agent } from "@atproto/api";
import type { Folio, ProjectBrief } from "../types";
import { htmlToMarkdown, stripHtml } from "./exchange";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

const PUBLICATION_COLLECTION = "site.standard.publication";
const DOCUMENT_COLLECTION = "site.standard.document";

const PUBLICATION_META_KEY = "atproto-publication";
const docMetaKey = (folioId: string) => `atproto-doc-${folioId}`;

interface PublicationRef {
  uri: string;
  name: string;
  url: string;
}

interface DocumentRef {
  uri: string;
  rkey: string;
  /** ISO timestamp of the first publish, preserved across re-publishes. */
  publishedAt: string;
}

export interface PublishResult {
  /** The document's at:// URI. */
  uri: string;
  /** A human-openable viewer URL (publication site + path). */
  viewerUrl: string;
  /** Fallback explorer URL that works for any record. */
  explorerUrl: string;
}

function repoDid(agent: Agent): string {
  const did = (agent as any).did ?? agent.assertDid;
  if (!did) throw new Error("Agent has no DID");
  return did;
}

/**
 * Find or create the writer's single publication. The chosen URI is cached
 * in IDB so subsequent publishes reuse it without a list round-trip.
 */
export async function ensurePublication(
  agent: Agent,
  opts: { name: string; url: string },
): Promise<PublicationRef> {
  const cached = await loadMetaFromIdb<PublicationRef>(PUBLICATION_META_KEY);
  if (cached?.uri) return cached;

  const did = repoDid(agent);

  // Reuse the first existing publication in the repo if there is one.
  try {
    const existing = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: PUBLICATION_COLLECTION,
      limit: 1,
    });
    const first = existing.data.records[0];
    if (first) {
      const value = first.value as { name?: string; url?: string };
      const ref: PublicationRef = {
        uri: first.uri,
        name: value.name ?? opts.name,
        url: value.url ?? opts.url,
      };
      await saveMetaToIdb(PUBLICATION_META_KEY, ref);
      return ref;
    }
  } catch {
    // Collection may not exist yet — fall through to create.
  }

  const created = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: PUBLICATION_COLLECTION,
    record: {
      $type: PUBLICATION_COLLECTION,
      name: opts.name,
      url: opts.url,
    },
  });
  const ref: PublicationRef = {
    uri: created.data.uri,
    name: opts.name,
    url: opts.url,
  };
  await saveMetaToIdb(PUBLICATION_META_KEY, ref);
  return ref;
}

/**
 * Publish (or re-publish) a folio as a site.standard.document under the
 * given publication. First publish creates the record (server-assigned
 * TID rkey); subsequent publishes putRecord the same rkey.
 */
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
  const now = new Date().toISOString();
  const path = `/p/${folio.id}`;

  const title =
    folio.name || brief?.answers.workingTitle || "Untitled";
  const description = brief?.answers.goal || undefined;
  const markdown = htmlToMarkdown(html);
  const textContent = stripHtml(html);

  const prior = await loadMetaFromIdb<DocumentRef>(docMetaKey(folio.id));
  const publishedAt = prior?.publishedAt || now;

  const record: Record<string, unknown> = {
    $type: DOCUMENT_COLLECTION,
    site: publication.uri,
    title,
    path,
    publishedAt,
    updatedAt: now,
    description,
    textContent,
    content: [
      {
        $type: "at.markpub.markdown",
        text: {
          $type: "at.markpub.text",
          markdown,
        },
        flavor: "gfm",
      },
    ],
  };

  let uri: string;
  let rkey: string;

  if (prior?.rkey) {
    const res = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: DOCUMENT_COLLECTION,
      rkey: prior.rkey,
      record,
    });
    uri = res.data.uri;
    rkey = prior.rkey;
  } else {
    const res = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: DOCUMENT_COLLECTION,
      record,
    });
    uri = res.data.uri;
    rkey = uri.split("/").pop() || "";
  }

  const ref: DocumentRef = { uri, rkey, publishedAt };
  await saveMetaToIdb(docMetaKey(folio.id), ref);

  const viewerUrl = `${publication.url.replace(/\/$/, "")}${path}`;
  const explorerUrl = `https://pdsls.dev/at://${did}/${DOCUMENT_COLLECTION}/${rkey}`;

  return { uri, viewerUrl, explorerUrl };
}
