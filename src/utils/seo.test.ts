import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TWYNE_HOME_STRUCTURED_DATA,
  TWYNE_SITE_ORIGIN,
  canonicalUrl,
  isPrivateWorkspacePath,
} from "./seo";
import { _test as sitemap } from "../routes/sitemap.xml/index";

describe("Twyne search metadata", () => {
  test("canonicalizes every request onto the public origin", () => {
    expect(
      canonicalUrl(
        new URL("https://preview.example/docs/?utm_source=test#shortcuts"),
      ),
    ).toBe(`${TWYNE_SITE_ORIGIN}/docs/`);
    expect(canonicalUrl(new URL("http://localhost:5173/"))).toBe(
      `${TWYNE_SITE_ORIGIN}/`,
    );
  });

  test("marks workspace and authentication routes as private", () => {
    for (const path of [
      "/editor/",
      "/dossier/create/",
      "/settings/",
      "/auth/callback/",
      "/privacy-ledger/",
    ]) {
      expect(isPrivateWorkspacePath(path)).toBe(true);
    }
  });

  test("keeps public and published routes indexable", () => {
    for (const path of [
      "/",
      "/docs/",
      "/blog/a-field-note/",
      "/writer/published-piece/",
      "/at/did:plc:example/publication/document/",
    ]) {
      expect(isPrivateWorkspacePath(path)).toBe(false);
    }
  });

  test("publishes the required free software application offer", () => {
    const application = TWYNE_HOME_STRUCTURED_DATA["@graph"][1];
    expect(application.name).toBe("Twyne");
    expect(application.applicationCategory).toBe("DesignApplication");
    expect(application.offers).toEqual({
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    });
  });
});

describe("crawler discovery files", () => {
  const publicDir = resolve(import.meta.dir, "../../public");

  test("sitemap renders static and dynamic public URLs as absolute URLs", () => {
    const xml = sitemap.renderSitemap([
      { path: "/" },
      { path: "/blog/field-notes/", lastmod: Date.parse("2026-08-24") },
      { path: "/writer/a%26b/" },
    ]);
    expect(xml).toContain(`<loc>${TWYNE_SITE_ORIGIN}/</loc>`);
    expect(xml).toContain(
      `<loc>${TWYNE_SITE_ORIGIN}/blog/field-notes/</loc>`,
    );
    expect(xml).toContain(
      `<lastmod>2026-08-24T00:00:00.000Z</lastmod>`,
    );
    expect(xml).toContain(`${TWYNE_SITE_ORIGIN}/writer/a%26b/`);
    expect(xml).not.toContain("localhost");
  });

  test("llms.txt follows the heading, summary, and link-list shape", async () => {
    const llms = await readFile(resolve(publicDir, "llms.txt"), "utf8");
    expect(llms.startsWith("# Twyne\n\n> ")).toBe(true);
    expect(llms).toContain("## Docs");
    expect(llms).toContain(`${TWYNE_SITE_ORIGIN}/docs/index.html.md`);
  });
});
