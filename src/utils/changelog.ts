/**
 * Minimal CHANGELOG.md reader for the downloads page's release-notes
 * section. The changelog is the release notes — parsed at build time from
 * the repo's own file so visitors read what changed without leaving the
 * site, and the notes can never drift from the published history.
 *
 * Only the structure below is understood; anything else passes through as
 * plain bullets. Keep entries in this shape:
 *
 *   ## 0.18.0
 *   <sub>2026-08-27</sub>
 *
 *   - First highlight…
 */

export interface ChangelogEntry {
  version: string;
  date: string | null;
  highlights: string[];
}

/** How many releases the downloads page shows. */
export const RELEASE_NOTES_COUNT = 3;
/** Bullets per release before the entry is trimmed. */
export const RELEASE_NOTES_BULLETS = 6;

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const sections = markdown.split(/^## /m);
  for (const section of sections.slice(1)) {
    const lines = section.split("\n");
    const version = lines[0]?.trim().replace(/^v/, "") ?? "";
    if (!version) continue;
    const date = section.match(/<sub>(\d{4}-\d{2}-\d{2})<\/sub>/)?.[1] ?? null;
    const highlights = lines
      .filter((line) => line.startsWith("- "))
      .map((line) =>
        line
          .replace(/^-+\s+/, "")
          .replace(/\*\*/g, "")
          .trim(),
      )
      .filter(Boolean)
      .slice(0, RELEASE_NOTES_BULLETS);
    entries.push({ version, date, highlights });
  }
  return entries;
}
