export const TWYNE_SITE_ORIGIN = "https://twyne.love";

const PRIVATE_ROUTE_ROOTS = new Set([
  "analysis",
  "apparatus",
  "auth",
  "dossier",
  "editor",
  "library",
  "onboarding",
  "personas",
  "privacy-ledger",
  "revisions",
  "rubric",
  "settings",
  "signin",
]);

/** Canonicals always identify the public origin and never preserve tracking. */
export function canonicalUrl(url: URL): string {
  const path =
    url.pathname === "/" ? "/" : `${url.pathname.replace(/\/+$/, "")}/`;
  return new URL(path, TWYNE_SITE_ORIGIN).href;
}

/** Workspace and authentication shells are useful to users, not search results. */
export function isPrivateWorkspacePath(pathname: string): boolean {
  const root = pathname.replace(/^\/+/, "").split("/", 1)[0] ?? "";
  return PRIVATE_ROUTE_ROOTS.has(root);
}

export const TWYNE_HOME_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "Twyne",
      url: `${TWYNE_SITE_ORIGIN}/`,
      description:
        "A local-first editorial writing room for drafting with a brief, editorial personas, rubric review, and citation detection.",
    },
    {
      "@type": ["WebApplication", "SoftwareApplication"],
      name: "Twyne",
      url: `${TWYNE_SITE_ORIGIN}/`,
      image: `${TWYNE_SITE_ORIGIN}/og-image.png`,
      applicationCategory: "DesignApplication",
      operatingSystem: "Any",
      description:
        "A local-first writing workspace where a room of editorial personas reads from the writer's brief.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
} as const;
