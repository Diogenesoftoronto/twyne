import {
  OFFLINE_CACHE_PREFIX,
  OFFLINE_SHELL_CACHE,
  OFFLINE_STATIC_CACHE,
  OPTIONAL_OFFLINE_STATIC_PATHS,
  REQUIRED_OFFLINE_SHELLS,
  canStorePublicResponse,
  offlineShellPath,
  shouldCacheStaticRequest,
} from "../utils/offline-cache-policy";

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const refreshedShells = new Set<string>();

function anonymousRequest(path: string, accept: string): Request {
  return new Request(new URL(path, worker.location.origin), {
    cache: "reload",
    credentials: "omit",
    headers: { Accept: accept },
  });
}

async function fetchAndStore(
  cache: Cache,
  request: Request,
): Promise<Response> {
  const response = await fetch(request);
  if (canStorePublicResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function fetchShellAndStore(cache: Cache, path: string): Promise<void> {
  const request = anonymousRequest(path, "text/html");
  const response = await fetch(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (!canStorePublicResponse(response) || !contentType.includes("text/html")) {
    throw new Error(`Offline shell ${path} did not return cacheable HTML`);
  }
  await cache.put(request, response);
}

async function refreshAnonymousShell(path: string): Promise<void> {
  if (refreshedShells.has(path)) return;
  refreshedShells.add(path);
  try {
    const cache = await caches.open(OFFLINE_SHELL_CACHE);
    await fetchShellAndStore(cache, path);
  } catch {
    // Being offline is expected. Permit another refresh attempt later in this
    // worker lifetime instead of pinning a failed attempt.
    refreshedShells.delete(path);
  }
}

async function networkFirstShell(
  request: Request,
  canonicalPath: string,
): Promise<Response> {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(OFFLINE_SHELL_CACHE);
    const cached = await cache.match(
      anonymousRequest(canonicalPath, "text/html"),
      { ignoreVary: true },
    );
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstBuildAsset(request: Request): Promise<Response> {
  const cache = await caches.open(OFFLINE_STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  return fetchAndStore(cache, request);
}

async function revalidateStaticAsset(request: Request): Promise<Response> {
  const cache = await caches.open(OFFLINE_STATIC_CACHE);
  return fetchAndStore(cache, request);
}

async function cachedStaticAsset(
  request: Request,
  update: Promise<Response>,
): Promise<Response> {
  const cache = await caches.open(OFFLINE_STATIC_CACHE);
  return (await cache.match(request)) ?? update;
}

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(OFFLINE_SHELL_CACHE);
      // The worker must not replace a known-good version unless its two core
      // anonymous shells are available. This leaves the active worker intact
      // when an update is installed over a flaky connection.
      await Promise.all(
        REQUIRED_OFFLINE_SHELLS.map((path) =>
          fetchShellAndStore(shellCache, path),
        ),
      );

      const staticCache = await caches.open(OFFLINE_STATIC_CACHE);
      await Promise.allSettled(
        OPTIONAL_OFFLINE_STATIC_PATHS.map((path) =>
          fetchAndStore(staticCache, anonymousRequest(path, "*/*")),
        ),
      );
    })(),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(OFFLINE_CACHE_PREFIX) &&
              name !== OFFLINE_SHELL_CACHE &&
              name !== OFFLINE_STATIC_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;

  const shellPath = offlineShellPath(url.pathname);
  if (request.mode === "navigate" && shellPath) {
    event.respondWith(networkFirstShell(request, shellPath));
    event.waitUntil(refreshAnonymousShell(shellPath));
    return;
  }

  if (shouldCacheStaticRequest(request, url, worker.location.origin)) {
    // Qwik build chunks are content-addressed. Public assets with stable names
    // revalidate in the background so a later deployment is not pinned by an
    // old logo, manifest, or font.
    if (url.pathname.startsWith("/build/")) {
      event.respondWith(cacheFirstBuildAsset(request));
      return;
    }

    const update = revalidateStaticAsset(request);
    event.waitUntil(update.then(() => undefined).catch(() => undefined));
    event.respondWith(cachedStaticAsset(request, update));
  }
});
