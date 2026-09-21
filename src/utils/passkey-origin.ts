/** WebAuthn credentials belong to the frontend, not the Convex API host. */
export function passkeyOriginOptions(siteUrl: string) {
  const site = new URL(siteUrl);
  const production =
    site.hostname === "twyne.love" || site.hostname === "www.twyne.love";
  return {
    rpID: production ? "twyne.love" : site.hostname,
    rpName: "Twyne",
    origin: production
      ? ["https://twyne.love", "https://www.twyne.love"]
      : site.origin,
  };
}
