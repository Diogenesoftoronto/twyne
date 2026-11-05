import { describe, expect, test } from "bun:test";
import {
  describeResearchRoute,
  keepGroundedSources,
  resolveResearchRoute,
  sourcesInToolOutput,
} from "./research-route";
import type { SearchBackendConfig } from "../types";

const noKey: SearchBackendConfig = {
  id: "keenable",
  apiKey: "",
  baseUrl: "",
  resultsPath: "",
};
const keenable: SearchBackendConfig = { ...noKey, apiKey: "kn-key" };
const openai = { name: "OpenAI", live: true };
const ollama = { name: "Ollama", live: false };

describe("automatic research route", () => {
  test("a signed-in writer searches through the account, keys or not", () => {
    expect(
      resolveResearchRoute({
        provider: "hosted",
        searchBackend: keenable,
        signedIn: true,
        searchModel: openai,
      }),
    ).toEqual({ kind: "account" });
  });

  test("signed out, a search key comes before the AI key", () => {
    expect(
      resolveResearchRoute({
        provider: "hosted",
        searchBackend: keenable,
        signedIn: false,
        searchModel: openai,
      }),
    ).toEqual({ kind: "search-api", name: "Keenable" });
  });

  test("signed out without a search key, a model that can search is used", () => {
    const route = resolveResearchRoute({
      provider: "hosted",
      searchBackend: noKey,
      signedIn: false,
      searchModel: openai,
    });
    expect(route).toEqual({
      kind: "model-web-search",
      name: "OpenAI",
      live: true,
    });
    expect(describeResearchRoute(route)).toBe(
      "Searching with OpenAI web search on your key",
    );
  });

  test("signed out with only a model that cannot search, there is no route", () => {
    expect(
      resolveResearchRoute({
        provider: "hosted",
        searchBackend: noKey,
        signedIn: false,
        searchModel: ollama,
      }),
    ).toEqual({ kind: "none" });
  });

  test("explicit choices are honoured, and an explicit key route needs its key", () => {
    expect(
      resolveResearchRoute({
        provider: "search-api",
        searchBackend: noKey,
        signedIn: true,
        searchModel: null,
      }),
    ).toEqual({ kind: "none" });
    expect(
      resolveResearchRoute({
        provider: "model-web-search",
        searchBackend: noKey,
        signedIn: true,
        searchModel: ollama,
      }),
    ).toEqual({ kind: "model-web-search", name: "Ollama", live: false });
    expect(
      resolveResearchRoute({
        provider: "search-api",
        searchBackend: { ...noKey, id: "custom", baseUrl: "https://s.test" },
        signedIn: false,
        searchModel: null,
      }),
    ).toEqual({ kind: "search-api", name: "Custom JSON endpoint" });
  });
});

describe("grounded model search", () => {
  const offered = [
    { url: "https://www.nasa.gov/history/first-flight/", title: "NASA" },
    { url: "https://en.wikipedia.org/wiki/Made_Up_Page", title: "Invented" },
    { url: "https://airandspace.si.edu/stories/kitty-hawk", title: "NASM" },
  ];

  test("keeps only the pages the search returned", () => {
    expect(
      keepGroundedSources(offered, [
        { url: "https://nasa.gov/history/first-flight?utm_source=openai" },
        { url: "https://en.wikipedia.org/wiki/Wright_Flyer" },
      ]).map((r) => r.title),
    ).toEqual(["NASA"]);
  });

  test("Google's redirect citations match on the site they name", () => {
    expect(
      keepGroundedSources(offered, [
        {
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          title: "si.edu",
        },
        {
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/def",
          title: "airandspace.si.edu",
        },
      ]).map((r) => r.title),
    ).toEqual(["NASM"]);
  });

  test("a search that returned nothing keeps nothing", () => {
    expect(keepGroundedSources(offered, [])).toEqual([]);
  });
});

describe("search tool output", () => {
  test("reads OpenAI's web_search sources", () => {
    expect(
      sourcesInToolOutput({
        action: { type: "search", query: "wright brothers 1903" },
        sources: [
          { type: "url", url: "https://www.nps.gov/wrbr/first-flight.htm" },
          { type: "url", url: "https://www.loc.gov/item/wright" },
        ],
      }).map((s) => s.url),
    ).toEqual([
      "https://www.nps.gov/wrbr/first-flight.htm",
      "https://www.loc.gov/item/wright",
    ]);
  });

  test("reads Anthropic's web_search results with their titles", () => {
    expect(
      sourcesInToolOutput([
        {
          type: "web_search_result",
          url: "https://airandspace.si.edu/wright-flyer",
          title: "1903 Wright Flyer",
          encryptedContent: "…",
        },
      ]),
    ).toEqual([
      {
        url: "https://airandspace.si.edu/wright-flyer",
        title: "1903 Wright Flyer",
      },
    ]);
  });

  test("ignores output with no web URLs", () => {
    expect(
      sourcesInToolOutput({ text: "no sources", url: "mailto:x" }),
    ).toEqual([]);
  });
});
