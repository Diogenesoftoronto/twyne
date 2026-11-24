/**
 * Links and canonical URLs for a writer's public pages, which are served both
 * at twyne.love/{handle}/ and on the writer's own domain. On a custom domain
 * the server rewrites "/" to "/{handle}/", so the page's URL object still
 * carries the handle; these helpers strip it back off for anything shown or
 * linked. In production a non-Twyne host only ever reaches these routes
 * through that rewrite (server.js 404s unknown hosts).
 */

import { isTwyneHost } from "../../scripts/custom-domain-routing.mjs";

/** True when the page is being served on a writer's own domain. */
export function isCustomDomainUrl(url: URL): boolean {
  return !isTwyneHost(url.hostname);
}

/** Path to the writer's page, or one of their pieces, from this page. */
export function writerPagePath(
  url: URL,
  handle: string,
  slug?: string,
): string {
  if (isCustomDomainUrl(url)) return slug ? `/${slug}/` : "/";
  return slug ? `/${handle}/${slug}/` : `/${handle}/`;
}

/**
 * The public path for a rewritten custom-domain path: `/{handle}/x/` -> `/x/`.
 * Paths not under the handle are returned unchanged.
 */
export function stripHandlePrefix(pathname: string, handle: string): string {
  const prefix = `/${handle.toLowerCase()}`;
  const lower = pathname.toLowerCase();
  if (lower === prefix || lower === `${prefix}/`) return "/";
  if (lower.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}
