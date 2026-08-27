import { describe, expect, test, vi } from "vitest";
import {
  loadStandardSiteDocument,
  loadStandardSitePublication,
  renderStandardSiteMarkdown,
} from "./standard-site-reader.server";

const did = "did:plc:abcdefghijklmnopqrstuvwx";
const webDid = "did:web:identity.example.com:writers:alice";
const publicationRkey = "3mabcde234567";
const documentRkey = "3mzyxwv765432";
const publicationUri = `at://${did}/site.standard.publication/${publicationRkey}`;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetcher() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "plc.directory") {
      return json({
        id: did,
        service: [
          {
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example.com",
          },
        ],
      });
    }
    if (url.hostname === "identity.example.com") {
      return json({
        id: webDid,
        service: [
          {
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example.com",
          },
        ],
      });
    }
    const collection = url.searchParams.get("collection");
    if (url.pathname.endsWith("getRecord")) {
      if (collection === "site.standard.publication") {
        return json({
          uri: publicationUri,
          value: {
            $type: "site.standard.publication",
            name: "A Writer",
            description: "Essays from the desk.",
            url: `https://twyne.love/at/${encodeURIComponent(did)}/${publicationRkey}`,
          },
        });
      }
      return json({
        uri: `at://${did}/site.standard.document/${documentRkey}`,
        value: {
          $type: "site.standard.document",
          site: publicationUri,
          path: `/${documentRkey}`,
          title: "A Piece",
          description: "The short description.",
          publishedAt: "2026-08-03T12:00:00.000Z",
          updatedAt: "2026-08-03T13:00:00.000Z",
          textContent: "Hello World",
          content: {
            $type: "at.markpub.markdown",
            text: {
              $type: "at.markpub.text",
              markdown:
                "# Hello\n\n[bad](javascript:alert(1))\n\n<script>alert(1)</script>",
            },
          },
        },
      });
    }
    return json({
      records: [
        {
          uri: `at://${did}/site.standard.document/${documentRkey}`,
          value: {
            $type: "site.standard.document",
            site: publicationUri,
            path: `/${documentRkey}`,
            title: "A Piece",
            publishedAt: "2026-08-03T12:00:00.000Z",
          },
        },
      ],
    });
  });
}

describe("Standard.site public reader", () => {
  test("loads a verified publication and its matching documents", async () => {
    const result = await loadStandardSitePublication(
      did,
      publicationRkey,
      fetcher(),
    );
    expect(result.publication).toMatchObject({
      uri: publicationUri,
      name: "A Writer",
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].url).toContain(`/${documentRkey}`);
  });

  test("resolves a self-hosted did:web identity through its DID document", async () => {
    const webPublicationUri = `at://${webDid}/site.standard.publication/${publicationRkey}`;
    const webFetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "identity.example.com") {
        expect(url.pathname).toBe("/writers/alice/did.json");
        return json({
          id: webDid,
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://pds.example.com",
            },
          ],
        });
      }
      if (url.pathname.endsWith("getRecord")) {
        return json({
          uri: webPublicationUri,
          value: {
            $type: "site.standard.publication",
            name: "A Self-hosted Writer",
            url: `https://twyne.love/at/${encodeURIComponent(webDid)}/${publicationRkey}`,
          },
        });
      }
      return json({ records: [] });
    });

    const result = await loadStandardSitePublication(
      webDid,
      publicationRkey,
      webFetcher,
    );

    expect(result.publication.uri).toBe(webPublicationUri);
    expect(webFetcher).toHaveBeenCalledWith(
      "https://identity.example.com/writers/alice/did.json",
      expect.any(Object),
    );
  });

  test("rejects private did:web resolution targets before fetching", async () => {
    const blockedFetcher = vi.fn();
    for (const blockedDid of ["did:web:localhost", "did:web:localhost."]) {
      await expect(
        loadStandardSitePublication(
          blockedDid,
          publicationRkey,
          blockedFetcher,
        ),
      ).rejects.toThrow("Unsupported ATProto DID");
    }
    expect(blockedFetcher).not.toHaveBeenCalled();
  });

  test("loads Markpub content and renders it without executable HTML or links", async () => {
    const result = await loadStandardSiteDocument(
      did,
      publicationRkey,
      documentRkey,
      fetcher(),
    );
    expect(result.document.html).toContain("<h1>Hello</h1>");
    expect(result.document.html).not.toContain("<script>");
    expect(result.document.html).not.toContain('href="javascript:');
    expect(result.document.html).toContain("&lt;script&gt;");
  });

  test("escapes raw HTML while preserving safe links", () => {
    const html = renderStandardSiteMarkdown(
      "<img src=x onerror=alert(1)>\n\n[site](https://example.com)",
    );
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="nofollow ugc"');
  });
});
