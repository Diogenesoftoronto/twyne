import { ConvexHttpClient } from "convex/browser";
import type { RequestHandler } from "@builder.io/qwik-city";
import { api } from "../../../convex/_generated/api";

const SITE_ORIGIN = "https://twyne.love";
const STATIC_PATHS = [
  "/",
  "/docs/",
  "/faq/",
  "/pricing/",
  "/blog/",
  "/downloads/",
  "/terms/",
  "/privacy/",
] as const;

type SitemapEntry = {
  path: string;
  lastmod?: number;
};

function convexUrl(): string | undefined {
  return (
    (import.meta.env.PUBLIC_CONVEX_URL as string | undefined) ??
    (import.meta.env.VITE_CONVEX_URL as string | undefined) ??
    process.env.PUBLIC_CONVEX_URL ??
    process.env.VITE_CONVEX_URL
  );
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

async function publicEntries(): Promise<SitemapEntry[]> {
  const url = convexUrl();
  if (!url) return [];

  try {
    const client = new ConvexHttpClient(url);
    const rows = await client.query(api.published.listForSitemap, {});
    return rows.flatMap((row) => {
      const path =
        row.kind === "blog"
          ? `/blog/${encodeURIComponent(row.slug)}/`
          : row.ownerHandle
            ? `/${encodeURIComponent(row.ownerHandle)}/${encodeURIComponent(row.slug)}/`
            : null;
      return path ? [{ path, lastmod: row.updatedAt }] : [];
    });
  } catch {
    // Keep the sitemap valid and useful for the static site if Convex is
    // temporarily unavailable. Dynamic URLs will appear on the next request.
    return [];
  }
}

function renderSitemap(entries: SitemapEntry[]): string {
  const unique = new Map(entries.map((entry) => [entry.path, entry]));
  const urls = [...unique.values()]
    .map(
      ({ path, lastmod }) =>
        `  <url><loc>${escapeXml(`${SITE_ORIGIN}${path}`)}</loc>${
          lastmod
            ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>`
            : ""
        }</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const onGet: RequestHandler = async ({ send, cacheControl }) => {
  const dynamicEntries = await publicEntries();
  const xml = renderSitemap([
    ...STATIC_PATHS.map((path) => ({ path })),
    ...dynamicEntries,
  ]);
  cacheControl({
    public: true,
    maxAge: 300,
    sMaxAge: 900,
    staleWhileRevalidate: 3600,
  });
  send(
    new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  );
};

export const _test = { escapeXml, renderSitemap };
