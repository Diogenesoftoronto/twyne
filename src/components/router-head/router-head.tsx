import { component$ } from "@builder.io/qwik";
import { useDocumentHead, useLocation } from "@builder.io/qwik-city";

/** Canonical production origin. Used as a fallback when no request origin is
 * available; absolute social URLs prefer the live request origin so embeds
 * resolve correctly on both the Railway URL and twyne.love. */
const SITE = "https://twyne.love";

/**
 * The RouterHead component is placed inside of the document `<head>` element.
 */
export const RouterHead = component$(() => {
  const head = useDocumentHead();
  const loc = useLocation();

  const origin = loc.url.origin || SITE;
  const ogImage = `${origin}/og-image.png`;
  const pageUrl = loc.url.href;

  // Keys (name or property) a route already declared — render site-wide
  // social defaults only when the route hasn't overridden them.
  const declared = new Set(
    head.meta.map((m) => m.property ?? m.name).filter(Boolean) as string[],
  );

  const title = head.title || "Twyne — An Editorial Room for Writers";
  const description =
    (head.meta.find((m) => m.name === "description")?.content as string) ??
    "Twyne is a writer-first editing room. Start from an interview, then draft with a brief, editorial personas, rubric review, and citation detection.";

  const socialDefaults: Array<{
    property?: string;
    name?: string;
    content: string;
  }> = [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Twyne" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: pageUrl },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Twyne — The Editorial Room" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ].filter((m) => !declared.has((m.property ?? m.name) as string));

  return (
    <>
      <title>{title}</title>

      <link rel="canonical" href={pageUrl} />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      {/* Favicons / app icons */}
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="icon" type="image/png" sizes="32x32" href="/icon-192.png" />
      <link rel="alternate icon" href="/favicon.ico" sizes="48x48" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      <meta name="theme-color" content="#9c1a1f" />

      {/* Site-wide social defaults (routes may override any key) */}
      {socialDefaults.map((m) => (
        <meta key={m.property ?? m.name} {...m} />
      ))}

      {head.meta.map((m) => (
        <meta key={m.key} {...m} />
      ))}

      {head.links.map((l) => (
        <link key={l.key} {...l} />
      ))}

      {head.styles.map((s) => (
        <style
          key={s.key}
          {...s.props}
          {...(s.props?.dangerouslySetInnerHTML
            ? {}
            : { dangerouslySetInnerHTML: s.style })}
        />
      ))}

      {head.scripts.map((s) => (
        <script
          key={s.key}
          {...s.props}
          {...(s.props?.dangerouslySetInnerHTML
            ? {}
            : { dangerouslySetInnerHTML: s.script })}
        />
      ))}
    </>
  );
});
