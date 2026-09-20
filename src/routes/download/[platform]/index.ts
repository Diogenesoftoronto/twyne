import type { RequestHandler } from "@qwik.dev/router";

/**
 * First-party desktop downloads, served at `/download/macos`,
 * `/download/windows`, `/download/linux`.
 *
 * CI publishes versioned assets (e.g. `twyne-desktop-macos-1.4.2.tar.gz`)
 * to the latest GitHub release, so there is no fixed file URL to hardcode.
 * This endpoint asks the GitHub API for the latest release, finds the asset
 * whose name starts with `twyne-desktop-<platform>`, and streams its bytes
 * back with a `Content-Disposition: attachment` header — the visitor never
 * leaves twyne.love and never sees github.com.
 *
 * The GitHub API answer (not the bytes) is cached in memory for 15 minutes
 * to stay inside the unauthenticated rate limit (60 req/hr). Set
 * `GITHUB_TOKEN` to raise that ceiling; the token never leaves the server.
 *
 * On any miss (unknown platform, no matching asset, API failure) it falls
 * back to our own downloads page rather than erroring, so a button always
 * lands somewhere useful.
 */

const REPO = "Diogenesoftoronto/twyne";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
/** Fallback when no matching asset can be resolved — keep visitors on our own site. */
const DOWNLOADS_PAGE = "/downloads/";
/** API answers may be reused this long before re-resolving. */
const RESOLVE_TTL_MS = 15 * 60_000;

interface CachedAsset {
  at: number;
  name: string | null;
  url: string | null;
}

const resolveCache = new Map<string, CachedAsset>();

/** Normalise common aliases to the asset-name platform token. */
const PLATFORM_ALIASES: Record<string, "macos" | "windows" | "linux"> = {
  macos: "macos",
  mac: "macos",
  osx: "macos",
  darwin: "macos",
  apple: "macos",
  windows: "windows",
  win: "windows",
  win64: "windows",
  linux: "linux",
};

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

async function resolveAsset(
  platform: "macos" | "windows" | "linux",
): Promise<{ name: string; url: string } | null> {
  const now = Date.now();
  const cached = resolveCache.get(platform);
  if (cached && now - cached.at < RESOLVE_TTL_MS) {
    return cached.url && cached.name
      ? { name: cached.name, url: cached.url }
      : null;
  }

  let found: { name: string; url: string } | null = null;
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "twyne-download-redirect",
    };
    const token =
      typeof process !== "undefined" ? process.env.GITHUB_TOKEN : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(LATEST_API, { headers });
    if (res.ok) {
      const release = (await res.json()) as { assets?: GitHubAsset[] };
      const prefix = `twyne-desktop-${platform}`;
      const asset = release.assets?.find((a) => a.name.startsWith(prefix));
      if (asset) found = { name: asset.name, url: asset.browser_download_url };
    }
  } catch {
    // Network/parse failure — fall through to the downloads page below.
  }

  resolveCache.set(platform, {
    at: now,
    name: found?.name ?? null,
    url: found?.url ?? null,
  });
  return found;
}

export const onGet: RequestHandler = async ({
  params,
  redirect,
  headers,
  status,
  getWritableStream,
}) => {
  const platform = PLATFORM_ALIASES[(params.platform ?? "").toLowerCase()];
  if (!platform) throw redirect(302, DOWNLOADS_PAGE);

  const asset = await resolveAsset(platform);
  if (!asset) throw redirect(302, DOWNLOADS_PAGE);

  // Stream the bytes through our own domain. The upstream host redirects
  // (release asset → object storage); fetch follows, we pipe the body
  // without buffering the whole bundle in memory. Only the fallback uses
  // a redirect, thrown afterwards, so Qwik City's thrown-redirect control
  // flow is never caught by our own try/catch.
  let upstream: Response;
  try {
    upstream = await fetch(asset.url, {
      headers: { "User-Agent": "twyne-download-redirect" },
    });
  } catch {
    throw redirect(302, DOWNLOADS_PAGE);
  }
  if (!upstream.ok || !upstream.body) throw redirect(302, DOWNLOADS_PAGE);

  status(200);
  headers.set("Content-Type", "application/gzip");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${asset.name.replace(/["\\]/g, "")}"`,
  );
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  // Versioned filenames are immutable; a short shared-cache window keeps
  // repeat downloads off the origin without risking staleness.
  headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");

  // Status and headers are snapshotted on first write; piping closes the
  // stream when the upstream body ends.
  await upstream.body.pipeTo(getWritableStream());
};
