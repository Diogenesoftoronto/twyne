export const OFFLINE_CACHE_PREFIX = "twyne-offline-";
export const OFFLINE_CACHE_VERSION = "v2";
export const OFFLINE_SHELL_CACHE = `${OFFLINE_CACHE_PREFIX}${OFFLINE_CACHE_VERSION}-shell`;
export const OFFLINE_STATIC_CACHE = `${OFFLINE_CACHE_PREFIX}${OFFLINE_CACHE_VERSION}-static`;

/**
 * These routes render a content-free application shell. Manuscripts and other
 * writer data remain in IndexedDB/Lix; no route response containing that data
 * belongs in Cache Storage.
 */
const WRITING_SHELL_PATHS = new Set([
  "/analysis/",
  "/apparatus/",
  "/desk/",
  "/dossier/create/",
  "/dossier/refine/",
  "/editor/",
  "/library/",
  "/onboarding/",
  "/personas/",
  "/revisions/",
  "/rubric/",
  "/settings/",
]);

export const REQUIRED_OFFLINE_SHELLS = ["/editor/", "/dossier/create/"];

export const OPTIONAL_OFFLINE_STATIC_PATHS = [
  "/manifest.json",
  "/assets/griffin-mark.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];

const STATIC_ROOT_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/manifest.json",
  "/og-image.png",
  "/twyne-wordmark.svg",
]);

function withTrailingSlash(pathname: string): string {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

export function offlineShellPath(pathname: string): string | undefined {
  const canonical = withTrailingSlash(pathname);
  return WRITING_SHELL_PATHS.has(canonical) ? canonical : undefined;
}

/**
 * Only files produced by the client build or checked into public assets may be
 * cached at runtime. Request destination is intentionally not trusted: an API
 * can return an image or script while still containing private/user data.
 */
export function isCacheableStaticUrl(url: URL, appOrigin: string): boolean {
  if (url.origin !== appOrigin) return false;
  return (
    url.pathname.startsWith("/build/") ||
    url.pathname.startsWith("/assets/") ||
    STATIC_ROOT_PATHS.has(url.pathname)
  );
}

export function hasSensitiveRequestHeaders(request: Request): boolean {
  return (
    request.headers.has("authorization") ||
    request.headers.has("range") ||
    request.headers.has("x-qwik-fullpath") ||
    request.headers.has("x-qwik-route-path")
  );
}

export function shouldCacheStaticRequest(
  request: Request,
  url: URL,
  appOrigin: string,
): boolean {
  return (
    request.method === "GET" &&
    !hasSensitiveRequestHeaders(request) &&
    isCacheableStaticUrl(url, appOrigin)
  );
}

export function canStorePublicResponse(response: Response): boolean {
  if (
    !response.ok ||
    response.status === 206 ||
    response.type === "opaque" ||
    response.redirected
  ) {
    return false;
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  if (/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl)) return false;

  const vary = response.headers.get("vary") ?? "";
  if (/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(vary)) {
    return false;
  }

  return (
    !response.headers.has("set-cookie") &&
    !response.headers.has("content-range")
  );
}
