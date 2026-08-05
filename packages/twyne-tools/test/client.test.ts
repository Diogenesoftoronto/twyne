import { describe, expect, test } from "bun:test";
import { TwyneApiError, TwyneClient } from "../src/client.js";

describe("TwyneClient", () => {
  test("posts authenticated operations to the integration endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new TwyneClient({
      apiUrl: "https://twyne.example/",
      accessToken: "twyne_pat_secret",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Response.json({ ok: true, data: [{ id: "folio-1", name: "Draft" }] });
      }) as typeof fetch,
    });

    expect(await client.listFolios()).toEqual([{ id: "folio-1", name: "Draft" }]);
    expect(requests[0]?.url).toBe("https://twyne.example/api/integrations/v1");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer twyne_pat_secret",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ operation: "folios.list" });
  });

  test("surfaces API errors with operation and status", async () => {
    const client = new TwyneClient({
      apiUrl: "https://twyne.example/api/integrations/v1",
      accessToken: "twyne_pat_secret",
      fetch: (async () => Response.json({ ok: false, error: "Token revoked" }, { status: 401 })) as typeof fetch,
    });
    try {
      await client.getFeedback("folio-1");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TwyneApiError);
      expect(error).toMatchObject({ status: 401, operation: "feedback.get", message: "Token revoked" });
    }
  });
});
