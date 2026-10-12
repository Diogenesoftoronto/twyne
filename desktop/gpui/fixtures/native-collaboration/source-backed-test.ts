import { describe, expect, test } from "bun:test";
import reference from "./source-reference.json";
import { buildReference, collaboration, publishing, micropub, sourceRole, pmReference } from "./source-functions";
import { accountDisplayName, accountName } from "../../../../src/utils/account-display";
import { publishViaMicropub } from "../../../../src/utils/micropub";

describe("actual original Source contract observations", () => {
  test("regenerates every retained vector from original functions and exact source hashes", async () => {
    const priorFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("Real fetch is forbidden in this fixture"); }) as typeof fetch;
    try { expect(await buildReference()).toEqual(reference); }
    finally { globalThis.fetch = priorFetch; }
  });

  test("embedded emails and JS whitespace cannot become public labels", () => {
    expect(accountName("Name a@b.co")).toBeUndefined();
    expect(accountName("Name\u00a0a@b.co")).toBeUndefined();
    expect(accountName("\ufeff Poet \ufeff")).toBe("Poet");
    expect(accountName("\u0085Poet\u0085")).toBe("\u0085Poet\u0085");
    expect(accountDisplayName({ name: "Name private@example.com", email: "private@example.com" })).toBe("Writer");
  });

  test("Unicode and malformed markup expose the old native sanitizer defects", () => {
    expect(publishing.sanitizeHtml("<p>東京 😀 e\u0301</p>")).toBe("<p>東京 😀 e\u0301</p>");
    expect(publishing.sanitizeHtml("İ<script>東京</script><p>😀</p>")).toBe("İ<p>😀</p>");
    expect(publishing.sanitizeHtml("<script>unterminated 東京")).toBe("<script>unterminated 東京");
    expect(publishing.sanitizeHtml("<embedding>keep</embedding><embed x>")).toBe("<embedding>keep</embedding>");
    expect(publishing.sanitizeHtml("<p\ufeffonload=x>東京</p>")).toBe("<p>東京</p>");
    expect(publishing.sanitizeHtml("<p\u0085onload=x>東京</p>")).toBe("<p\u0085onload=x>東京</p>");
    expect(publishing.sanitizeHtml("<ſcript>x</ſcript>")).toBe("<ſcript>x</ſcript>");
  });

  test("real NFKD and slice order preserve compatibility and a final clipped hyphen", () => {
    expect(publishing.slugify("ﬃ ＡＢＣ ①")).toBe("ffi-abc-1");
    expect(publishing.slugify("ø ß æ œ")).toBe("");
    expect(publishing.slugify("a".repeat(47) + " z")).toBe("a".repeat(47) + "-");
    expect(publishing.slugify("e\u0301 e\u1ab0")).toBe("e-e");
  });

  test("URL parsing rejects poisoned localhost strings before injected dispatch", async () => {
    expect(micropub.safeEndpoint(" HTTPS://EXAMPLE.COM:443/a/../micropub ")).toBe("https://example.com/micropub");
    for (const endpoint of ["http://localhost.evil/x", "http://127.0.0.1.evil/x", "http://localhost@evil.example/x"]) {
      let calls = 0;
      await expect(publishViaMicropub({ endpoint, token: "fixture-only", title: "title", html: "<p>x</p>" }, async () => {
        calls++; return new Response(null, { status: 201 });
      })).rejects.toThrow("HTTPS");
      expect(calls).toBe(0);
    }
    let calls = 0;
    await expect(publishViaMicropub({ endpoint: "https://example.com", token: "\ufeff \ufeff", title: "x", html: "x" }, async () => {
      calls++; return new Response(null, { status: 201 });
    })).rejects.toThrow("token");
    expect(calls).toBe(0);
  });

  test("original Micropub rejects injected failed responses without claiming publication", async () => {
    let calls = 0;
    await expect(publishViaMicropub({ endpoint: "https://example.com", token: "fixture-only", title: "x", html: "x" }, async () => {
      calls++; return new Response(null, { status: 403 });
    })).rejects.toThrow("403");
    expect(calls).toBe(1);
    expect(reference.micropubForms[0].body).toContain("Caf%C3%A9+%26+%E6%9D%B1%E4%BA%AC+%7E*%27");
    expect(reference.micropubForms[0].authorizationPresent).toBe(true);
    expect(reference.micropubForms[0].headers).not.toHaveProperty("authorization");
  });

  test("server identity and accepted scoped membership are separate from caller labels", async () => {
    await expect(collaboration.requireIdentity({ userId: "caller-owner", auth: { async getUserIdentity() { return null; } } })).rejects.toThrow("signed in");
    expect((await sourceRole("owner", "pending", ["owner"])).ok).toBe(false);
    expect((await sourceRole("owner", "accepted", ["owner"], false)).ok).toBe(false);
    expect((await sourceRole("commenter", "accepted", ["owner", "editor"])).ok).toBe(false);
    const accepted = await sourceRole("editor", "accepted", ["owner", "editor"]);
    expect(accepted.ok).toBe(true);
    expect(accepted.queries).toEqual([{ lixId: "lix-owned", userId: "server-token-identifier" }]);
  });

  test("real PM tree positions include UTF16, node boundaries and atoms", () => {
    const pm = pmReference();
    expect(pm.contentSize).toBe(12);
    expect(pm.textScalarCount).toBe(5);
    expect(pm.textUtf16Count).toBe(6);
    expect(pm.decorations).toEqual([{ from: 0, to: 12, kind: "inline" }, { from: 12, to: 12, kind: "widget" }, { from: 13, to: 13, kind: "widget" }]);
    expect(pm.nativeScalarConversionImplemented).toBe(false);
  });
});
