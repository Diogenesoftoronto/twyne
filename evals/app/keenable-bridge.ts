/**
 * A local stand-in for Not Organic's web search, for evals.
 *
 * Not Organic searches through Keenable (`apps/gateway/src/web.ts` in
 * notorganic-provider). Until its gateway is rebuilt with the rotated key,
 * `/v1/web/search` answers 502, so research evals cannot reach a real search
 * engine through the app's `notorganic` provider. This bridge makes the same
 * upstream call the gateway makes — `POST /v1/search` with `mode: "pro"`,
 * keeping only HTTPS results — and serves it in the shape the app's `custom`
 * research provider reads. The eval then measures the search a hosted writer
 * will get, billed to the Keenable account behind KEENABLE_API_KEY instead
 * of the eval wallet.
 */
import { createServer, type Server } from "node:http";

export interface KeenableBridge {
  /** Point RESEARCH_SEARCH_URL here. */
  url: string;
  searches: number;
  close(): Promise<void>;
}

const KEENABLE_ORIGIN = "https://api.keenable.ai";

export async function startKeenableBridge(
  apiKey: string,
): Promise<KeenableBridge> {
  let searches = 0;
  const server: Server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: { query?: unknown; max_results?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const query =
      typeof body.query === "string" ? body.query.slice(0, 4096) : "";
    const limit = Math.max(1, Math.min(50, Number(body.max_results) || 10));
    if (!query.trim()) {
      res.writeHead(400).end();
      return;
    }
    searches += 1;
    try {
      const upstream = await fetch(`${KEENABLE_ORIGIN}/v1/search`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "X-API-Key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ query, max_results: limit, mode: "pro" }),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `keenable ${upstream.status}` }));
        return;
      }
      const payload = (await upstream.json()) as { results?: unknown };
      const results = (Array.isArray(payload.results) ? payload.results : [])
        .slice(0, limit)
        .filter(
          (r): r is Record<string, unknown> =>
            !!r &&
            typeof r === "object" &&
            typeof (r as { url?: unknown }).url === "string" &&
            /^https:\/\//.test((r as { url: string }).url),
        )
        .map((r) => ({
          url: r.url,
          title: String(r.title ?? ""),
          snippet: String(r.snippet ?? r.description ?? ""),
          ...(typeof r.published_at === "string"
            ? { date: r.published_at }
            : {}),
          publisher: (() => {
            try {
              return new URL(String(r.url)).hostname.replace(/^www\./, "");
            } catch {
              return undefined;
            }
          })(),
        }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results }));
    } catch (error) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "bridge failed",
        }),
      );
    }
  });
  await new Promise<void>((done) =>
    server.listen(0, "127.0.0.1", () => done()),
  );
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/v1/search`,
    get searches() {
      return searches;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
