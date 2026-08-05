/**
 * Canonical URL and AT-URI helpers for Twyne's Standard.site publisher.
 *
 * A publication lives below `/at/<did>/<publication-rkey>` and its documents
 * use their own record key as a relative path. Keeping both record keys in the
 * public URL makes the verification endpoints deterministic without coupling
 * an ATProto-only writer to Twyne account state.
 */

export const STANDARD_SITE_ORIGIN = "https://twyne.love";
export const STANDARD_SITE_PUBLICATION_COLLECTION = "site.standard.publication";
export const STANDARD_SITE_DOCUMENT_COLLECTION = "site.standard.document";

const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+(?::[A-Za-z0-9._:%-]+)*$/;
const TID_RE = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

export interface AtUriParts {
  did: string;
  collection: string;
  rkey: string;
}

export function isAtprotoDid(value: string): boolean {
  return DID_RE.test(value);
}

export function isTid(value: string): boolean {
  return TID_RE.test(value);
}

export function parseAtUri(uri: string): AtUriParts | null {
  const match = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!match) return null;
  const [, did, collection, rkey] = match;
  if (!isAtprotoDid(did) || !collection || !isTid(rkey)) return null;
  return { did, collection, rkey };
}

export function decodeStandardSiteDid(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return isAtprotoDid(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function requireRouteParts(did: string, rkey: string): void {
  if (!isAtprotoDid(did)) throw new Error("Invalid ATProto DID");
  if (!isTid(rkey)) throw new Error("Invalid ATProto record key");
}

export function standardSitePublicationPath(
  did: string,
  publicationRkey: string,
): string {
  requireRouteParts(did, publicationRkey);
  return `/at/${encodeURIComponent(did)}/${publicationRkey}`;
}

export function standardSitePublicationUrl(
  did: string,
  publicationRkey: string,
  origin = STANDARD_SITE_ORIGIN,
): string {
  return `${origin.replace(/\/$/, "")}${standardSitePublicationPath(did, publicationRkey)}`;
}

export function standardSiteDocumentPath(documentRkey: string): string {
  if (!isTid(documentRkey)) throw new Error("Invalid ATProto record key");
  return `/${documentRkey}`;
}

export function standardSiteDocumentUrl(
  did: string,
  publicationRkey: string,
  documentRkey: string,
  origin = STANDARD_SITE_ORIGIN,
): string {
  return `${standardSitePublicationUrl(did, publicationRkey, origin)}${standardSiteDocumentPath(documentRkey)}`;
}

export function standardSiteVerificationPath(
  did: string,
  publicationRkey: string,
): string {
  return `/.well-known/site.standard.publication${standardSitePublicationPath(did, publicationRkey)}`;
}

export function publicationAtUri(did: string, rkey: string): string {
  requireRouteParts(did, rkey);
  return `at://${did}/${STANDARD_SITE_PUBLICATION_COLLECTION}/${rkey}`;
}

export function documentAtUri(did: string, rkey: string): string {
  requireRouteParts(did, rkey);
  return `at://${did}/${STANDARD_SITE_DOCUMENT_COLLECTION}/${rkey}`;
}
