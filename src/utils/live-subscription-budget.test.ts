import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A Convex live query re-runs and re-sends its whole result to every
 * subscribed tab whenever anything it read changes. Subscribing a tab to a
 * query that returns the whole account (every manuscript, note and brief)
 * turned each 4-second typing push into a full download and rewrite on every
 * open tab and device (fixed 2026-10-29). These queries are fetched on demand
 * only; tabs watch `sync.syncRevision` instead.
 */
const WHOLE_ACCOUNT_QUERIES = [
  "sync.pullAll",
  "sync.listFolioContent",
  "sync.listPersonaNotes",
  "sync.listPersonaReplies",
  "sync.listSuggestions",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

const root = new URL("..", import.meta.url).pathname;
const subscriptions = sources(root).flatMap((path) => {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/\.onUpdate\(\s*([^,]+),/g)].map((match) => ({
    path: path.slice(root.length),
    query: match[1]!.replace(/\s+/g, "").replace(/^\(api asany\)\./, "api."),
  }));
});

describe("live subscriptions", () => {
  test("the scan finds the app's subscriptions", () => {
    expect(subscriptions.length).toBeGreaterThan(8);
    expect(subscriptions).toContainEqual({
      path: "utils/convex-sync.ts",
      query: "api.sync.syncRevision",
    });
  });

  test("no tab subscribes live to a whole-account query", () => {
    const offending = subscriptions.filter(({ query }) =>
      WHOLE_ACCOUNT_QUERIES.some(
        (name) =>
          query === `api.${name}` ||
          query.includes(`"${name.replace(".", ":")}"`),
      ),
    );
    expect(offending).toEqual([]);
  });

  test("the sync revision query stays a single number", () => {
    const sync = readFileSync(
      new URL("../../convex/sync.ts", import.meta.url),
      "utf8",
    );
    const body = sync.slice(sync.indexOf("export const syncRevision"));
    const handler = body.slice(0, body.indexOf("\n});") + 4);
    expect(handler).toContain("returns: v.number()");
    expect(handler).not.toContain(".collect()");
  });
});
