import type { RequestHandler } from "@builder.io/qwik-city";

/**
 * Stable per-platform desktop download links.
 *
 * Served at `/download/macos`, `/download/windows`, `/download/linux`. CI
 * publishes versioned assets (e.g. `twyne-desktop-macos-1.4.2.tar.gz`) to the
 * latest GitHub release, so there is no fixed file URL to hardcode. This
 * endpoint asks the GitHub API for the latest release, finds the asset whose
 * name starts with `twyne-desktop-<platform>`, and 302-redirects to it.
 *
 * On any miss (unknown platform, no matching asset, API failure) it falls back
 * to the human releases page rather than erroring, so a button always lands
 * somewhere useful.
 */

const REPO = "Diogenesoftoronto/twyne";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

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

export const onGet: RequestHandler = async ({ params, redirect, headers }) => {
  // Let CDNs/browsers cache the redirect briefly so we don't hammer GitHub's
  // unauthenticated rate limit (60 req/hr) on every button click.
  headers.set("Cache-Control", "public, max-age=900, s-maxage=900");

  const platform = PLATFORM_ALIASES[(params.platform ?? "").toLowerCase()];

  // Resolve the asset URL first; only throw the redirect once, afterwards, so
  // Qwik City's thrown-redirect control flow isn't caught by our own try/catch.
  let target = RELEASES_PAGE;
  if (platform) {
    try {
      const res = await fetch(LATEST_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "twyne-download-redirect",
        },
      });
      if (res.ok) {
        const release = (await res.json()) as { assets?: GitHubAsset[] };
        const prefix = `twyne-desktop-${platform}`;
        const asset = release.assets?.find((a) => a.name.startsWith(prefix));
        if (asset) {
          target = asset.browser_download_url;
        }
      }
    } catch {
      // Network/parse failure — fall back to the releases page below.
    }
  }

  throw redirect(302, target);
};
