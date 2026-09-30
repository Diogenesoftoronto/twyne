/**
 * Covers for the works a draft names — books from Open Library, records and
 * songs from MusicBrainz with art from the Cover Art Archive.
 *
 * Only the title (and a creator, when the draft gave one) leaves the device,
 * and only when the writer has cover lookups on. Results are cached for the
 * session and MusicBrainz is held to its one-request-a-second rule. Cards
 * show a title, creator, year and cover, and link out — never lyrics.
 */
import { loadMetaFromIdb } from "./idb";
import type { WorkCard } from "./flow-items";
import { COVER_LOOKUP_SETTING_KEY } from "./in-flow-events";

export { COVER_LOOKUP_SETTING_KEY };

type Medium = WorkCard["medium"];
type Fetch = typeof fetch;

const cache = new Map<string, WorkCard | null>();
let lastMusicBrainz = 0;

export async function coverLookupsEnabled(): Promise<boolean> {
  return (await loadMetaFromIdb<boolean>(COVER_LOOKUP_SETTING_KEY)) !== false;
}

export async function lookupWork(
  title: string,
  medium: Medium,
  options: { fetchImpl?: Fetch; enabled?: boolean; now?: () => number } = {},
): Promise<WorkCard | null> {
  const enabled = options.enabled ?? (await coverLookupsEnabled());
  if (!enabled || !title.trim() || medium === "film") return null;
  const key = `${medium}:${title.trim().toLowerCase()}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const fetchImpl = options.fetchImpl ?? fetch;
  let card: WorkCard | null = null;
  try {
    card =
      medium === "book"
        ? await openLibrary(title, fetchImpl)
        : await musicBrainz(title, medium, fetchImpl, options.now ?? Date.now);
  } catch {
    card = null;
  }
  cache.set(key, card);
  return card;
}

async function openLibrary(title: string, fetchImpl: Fetch): Promise<WorkCard | null> {
  const url = `https://openlibrary.org/search.json?${new URLSearchParams({
    q: title,
    limit: "1",
    fields: "key,title,author_name,first_publish_year,cover_i",
  })}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    docs?: Array<{
      key?: string;
      title?: string;
      author_name?: string[];
      first_publish_year?: number;
      cover_i?: number;
    }>;
  };
  const doc = body.docs?.[0];
  if (!doc?.title || !similarTitle(doc.title, title)) return null;
  return {
    medium: "book",
    title: doc.title,
    creator: doc.author_name?.[0],
    year: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    cover: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : undefined,
    url: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
  };
}

async function musicBrainz(
  title: string,
  medium: "album" | "song",
  fetchImpl: Fetch,
  now: () => number,
): Promise<WorkCard | null> {
  const wait = lastMusicBrainz + 1_100 - now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastMusicBrainz = now();
  const entity = medium === "album" ? "release-group" : "recording";
  const url = `https://musicbrainz.org/ws/2/${entity}/?${new URLSearchParams({
    query: medium === "album" ? `releasegroup:"${title}"` : `recording:"${title}"`,
    limit: "1",
    fmt: "json",
  })}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    "release-groups"?: MbItem[];
    recordings?: Array<MbItem & { releases?: Array<{ "release-group"?: { id?: string; title?: string } }> }>;
  };
  const item =
    medium === "album" ? body["release-groups"]?.[0] : body.recordings?.[0];
  if (!item?.title || !similarTitle(item.title, title)) return null;
  const group =
    medium === "album"
      ? item.id
      : (item as { releases?: Array<{ "release-group"?: { id?: string } }> })
          .releases?.[0]?.["release-group"]?.id;
  return {
    medium,
    title: item.title,
    creator: item["artist-credit"]?.[0]?.name,
    year: item["first-release-date"]?.slice(0, 4) || undefined,
    cover: group
      ? `https://coverartarchive.org/release-group/${group}/front-250`
      : undefined,
    url: item.id
      ? `https://musicbrainz.org/${entity}/${item.id}`
      : undefined,
  };
}

interface MbItem {
  id?: string;
  title?: string;
  "first-release-date"?: string;
  "artist-credit"?: Array<{ name?: string }>;
}

/** Search engines always return something; only keep a real match. */
export function similarTitle(found: string, wanted: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^\p{L}\p{N}]+/gu, "");
  const a = norm(found);
  const b = norm(wanted);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
}

export function __resetMediaCacheForTests(): void {
  cache.clear();
  lastMusicBrainz = 0;
}
