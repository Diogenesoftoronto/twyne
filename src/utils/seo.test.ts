import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  TWYNE_HOME_STRUCTURED_DATA,
  TWYNE_SITE_ORIGIN,
  canonicalUrl,
  isPrivateWorkspacePath,
} from "./seo";

describe("Twyne search metadata", () => {
  test("canonicalizes every request onto the public origin", () => {
    expect(
      canonicalUrl(
        new URL("https://preview.example/docs/?utm_source=test#shortcuts"),
      ),
    ).toBe(`${TWYNE_SITE_ORIGIN}/docs`);
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

  test("robots advertises the canonical sitemap and leaves noindex pages crawlable", async () => {
    const robots = await readFile(resolve(publicDir, "robots.txt"), "utf8");
    expect(robots).toContain(`Sitemap: ${TWYNE_SITE_ORIGIN}/sitemap.xml`);
    expect(robots).toContain("Allow: /");
    expect(robots).not.toContain("Disallow: /editor");
  });

  test("sitemap contains only absolute production URLs", async () => {
    const sitemap = await readFile(resolve(publicDir, "sitemap.xml"), "utf8");
    const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(locations.length).toBeGreaterThan(5);
    expect(locations.every((url) => url.startsWith(TWYNE_SITE_ORIGIN))).toBe(
      true,
    );
  });

  test("llms.txt follows the heading, summary, and link-list shape", async () => {
    const llms = await readFile(resolve(publicDir, "llms.txt"), "utf8");
    expect(llms.startsWith("# Twyne\n\n> ")).toBe(true);
    expect(llms).toContain("## Docs");
    expect(llms).toContain(`${TWYNE_SITE_ORIGIN}/docs/index.html.md`);
  });
});
