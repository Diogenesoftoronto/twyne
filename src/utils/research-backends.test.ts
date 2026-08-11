import { describe, expect, test } from "bun:test";
import {
  SEARCH_BACKENDS,
  searchBackend,
  toSources,
} from "./research-backends";
import type { SearchBackendConfig } from "../types";

const req = { query: "who said it", context: "a claim", maxResults: 5 };

function config(over: Partial<SearchBackendConfig> = {}): SearchBackendConfig {
  return { id: "tinyfish", apiKey: "k", baseUrl: "", resultsPath: "", ...over };
}

describe("search backend adapters", () => {
  test("each vendor gets its own auth header shape", () => {
    const auth = (id: SearchBackendConfig["id"]) => {
      const { init } = SEARCH_BACKENDS[id].buildRequest(req, config({ id }));
      return init.headers as Record<string, string>;
    };
    expect(auth("tinyfish").authorization).toBe("Bearer k");
    expect(auth("exa")["x-api-key"]).toBe("k");
    expect(auth("tavily").authorization).toBe("Bearer k");
    expect(auth("serper")["x-api-key"]).toBe("k");
    expect(auth("brave")["x-subscription-token"]).toBe("k");
  });

  test("brave sends a GET with query params, not a JSON body", () => {
    const { url, init } = SEARCH_BACKENDS.brave.buildRequest(
      req,
      config({ id: "brave" }),
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(new URL(url).searchParams.get("q")).toBe("who said it");
    expect(new URL(url).searchParams.get("count")).toBe("5");
  });

  test("a configured base URL overrides the built-in endpoint", () => {
    const { url } = SEARCH_BACKENDS.tinyfish.buildRequest(
      req,
      config({ baseUrl: "https://proxy.example.com/search" }),
    );
    expect(url).toBe("https://proxy.example.com/search");
  });

  test("extract finds each vendor's result array", () => {
    expect(
      SEARCH_BACKENDS.brave.extract(
        { web: { results: [{ url: "https://a" }] } },
        config(),
      ),
    ).toEqual([{ url: "https://a" }]);
    expect(
      SEARCH_BACKENDS.serper.extract({ organic: [{ url: "https://b" }] }, config()),
    ).toEqual([{ url: "https://b" }]);
  });

  test("custom follows an explicit results path", () => {
    expect(
      SEARCH_BACKENDS.custom.extract(
        { data: { results: [{ url: "https://c" }] } },
        config({ id: "custom", resultsPath: "data.results" }),
      ),
    ).toEqual([{ url: "https://c" }]);
  });

  test("custom finds the result array when no path is given", () => {
    expect(
      SEARCH_BACKENDS.custom.extract(
        { payload: { nested: { hits: [{ url: "https://d", title: "D" }] } } },
        config({ id: "custom" }),
      ),
    ).toEqual([{ url: "https://d", title: "D" }]);
  });

  test("an unknown backend id falls back rather than throwing", () => {
    expect(searchBackend("nope" as SearchBackendConfig["id"]).id).toBe("tinyfish");
  });
});

describe("toSources", () => {
  test("reads whichever field the vendor used for the snippet", () => {
    expect(
      toSources(
        [
          { url: "https://a", title: "A", description: "from description" },
          { url: "https://b", name: "B", text: "from text" },
        ],
        10,
      ),
    ).toEqual([
      { title: "A", url: "https://a", snippet: "from description" },
      { title: "B", url: "https://b", snippet: "from text" },
    ]);
  });

  test("drops entries without a usable http url", () => {
    expect(
      toSources(
        [
          { url: "not-a-url", title: "bad" },
          { title: "no url at all" },
          { url: "https://ok" },
        ],
        10,
      ).map((s) => s.url),
    ).toEqual(["https://ok"]);
  });

  test("dedupes by url and honours the cap", () => {
    const sources = toSources(
      [
        { url: "https://a" },
        { url: "https://a" },
        { url: "https://b" },
        { url: "https://c" },
      ],
      2,
    );
    expect(sources.map((s) => s.url)).toEqual(["https://a", "https://b"]);
  });

  test("falls back to the url as title", () => {
    expect(toSources([{ url: "https://a" }], 1)[0].title).toBe("https://a");
  });
});
