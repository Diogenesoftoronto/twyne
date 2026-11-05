import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { DEFAULT_APPARATUS_SETTINGS } from "../types";
import type { BibEntry } from "./bibliography";
import type { JudgementRequest, JudgementResult } from "./judgement-client";

/**
 * The research loop end to end, with the network replaced: a signed-in
 * writer's selection is searched, read and judged, and only what supports
 * the claim goes on file. Mocks spread the real modules and only take over
 * while `loop.active`, because Bun's module mocks are process-global.
 */
const loop: {
  active: boolean;
  bib: BibEntry[];
  searches: string[];
  fetches: string[];
  search: (query: string) => unknown;
  judge: (request: JudgementRequest) => JudgementResult;
} = {
  active: false,
  bib: [],
  searches: [],
  fetches: [],
  search: () => ({ results: [], provider: "notorganic" }),
  judge: () => ({ ok: false }),
};

const realIdb = await import("./idb");
mock.module("./idb", () => ({
  ...realIdb,
  loadAiSettingsFromIdb: async () =>
    loop.active ? null : realIdb.loadAiSettingsFromIdb(),
  loadApparatusSettingsFromIdb: async () =>
    loop.active
      ? { ...DEFAULT_APPARATUS_SETTINGS }
      : realIdb.loadApparatusSettingsFromIdb(),
}));
const realBib = await import("./bibliography");
mock.module("./bibliography", () => ({
  ...realBib,
  loadBibliography: async () =>
    loop.active ? [...loop.bib] : realBib.loadBibliography(),
  saveBibliography: async (all: BibEntry[]) => {
    if (loop.active) loop.bib = [...all];
    else await realBib.saveBibliography(all);
  },
}));
const realJudge = await import("./judgement-client");
mock.module("./judgement-client", () => ({
  ...realJudge,
  askJudgement: async (
    client: ConvexClient | null,
    request: JudgementRequest,
  ) =>
    loop.active ? loop.judge(request) : realJudge.askJudgement(client, request),
}));

const research = await import("./background-research");

const client = {
  action: async (ref: unknown, args: { query?: string; url?: string }) => {
    const name = getFunctionName(ref as never);
    if (name === "research:searchSources") {
      loop.searches.push(args.query!);
      return loop.search(args.query!);
    }
    if (name === "research:fetchSource") {
      loop.fetches.push(args.url!);
      return {
        provider: "notorganic",
        title: args.url,
        markdown: `Navigation and other page furniture that says nothing.\n\nOn December 17, 1903, the Wright brothers made the first powered flight at Kitty Hawk, lasting 12 seconds.`,
      };
    }
    throw new Error(`unexpected action ${name}`);
  },
} as unknown as ConvexClient;

const hit = (url: string) => ({
  title: url,
  url,
  snippet: "A page about early aviation and the brothers from Dayton, Ohio.",
});

/** Answer every source in a request with the verdict this URL should get. */
const judgeBy =
  (verdicts: Record<string, string>) =>
  (request: JudgementRequest): JudgementResult => ({
    ok: true,
    answers: Object.fromEntries(
      Object.keys(request.questions).map((id) => {
        const url = request.state[id].split("\n")[1];
        const choice = verdicts[url] ?? "unrelated";
        return [
          id,
          { type: "choice", choice, probabilities: { [choice]: 0.9 } },
        ];
      }),
    ),
  });

const CLAIM =
  "In 1903 the Wright brothers made the first powered flight at Kitty Hawk, and it lasted 12 seconds.";

beforeEach(() => {
  loop.active = true;
  loop.bib = [];
  loop.searches = [];
  loop.fetches = [];
  research.startBackgroundResearch({ client, brief: null, folioId: "folio" });
  research.setResearchSignedIn(true);
});

afterAll(() => {
  research.stopBackgroundResearch();
  research.setResearchSignedIn(false);
  loop.active = false;
});

describe("research loop", () => {
  test("tries another query when the first finds nothing that supports the claim", async () => {
    loop.search = () =>
      loop.searches.length === 1
        ? {
            provider: "notorganic",
            results: [hit("https://a.test/topic"), hit("https://b.test/topic")],
          }
        : { provider: "notorganic", results: [hit("https://nps.test/flight")] };
    loop.judge = judgeBy({ "https://nps.test/flight": "supports" });

    expect(await research.researchSelection({ anchor: CLAIM })).toEqual({
      ok: true,
    });

    expect(loop.searches.length).toBe(2);
    expect(loop.fetches).toEqual([
      "https://a.test/topic",
      "https://b.test/topic",
      "https://nps.test/flight",
    ]);
    expect(loop.bib.map((e) => [e.url, e.support])).toEqual([
      ["https://nps.test/flight", "supports"],
    ]);
    expect(loop.bib[0].evidence).toContain("lasting 12 seconds");
    const row = research.snapshot().progress[0];
    expect(row).toMatchObject({
      status: "found",
      count: 1,
      searches: 2,
      read: 3,
    });
  });

  test("a contradicting source is kept, flagged, and settles the claim as contradicted", async () => {
    loop.search = () => ({
      provider: "notorganic",
      results: [hit("https://other.test/says-1904")],
    });
    loop.judge = judgeBy({ "https://other.test/says-1904": "contradicts" });

    await research.researchSelection({ anchor: CLAIM });

    expect(loop.bib.map((e) => e.support)).toEqual(["contradicts"]);
    expect(research.snapshot().progress[0]).toMatchObject({
      status: "contradicted",
      contradicted: 1,
    });
  });

  test("search hits that never support the claim are not put on file", async () => {
    loop.search = () => ({
      provider: "notorganic",
      results: [hit(`https://unrelated.test/${loop.searches.length}`)],
    });
    loop.judge = judgeBy({});

    await research.researchSelection({ anchor: CLAIM });

    expect(loop.bib).toEqual([]);
    expect(research.snapshot().progress[0]).toMatchObject({
      status: "missed",
      searches: loop.searches.length,
    });
    expect(loop.searches.length).toBeGreaterThan(1);
  });
});
