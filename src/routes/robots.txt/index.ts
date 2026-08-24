import type { RequestHandler } from "@builder.io/qwik-city";

const ROBOTS = `# Twyne — robots.txt
# Public pages are crawlable. Workspace and authentication routes emit a
# noindex robots meta tag so crawlers can see and honor the instruction.

User-agent: *
Allow: /
Disallow: /api/
Disallow: /oauth-client-metadata.json

Sitemap: https://twyne.love/sitemap.xml
`;

export const onGet: RequestHandler = ({ send, cacheControl }) => {
  cacheControl({ public: true, maxAge: 3600, sMaxAge: 3600 });
  send(
    new Response(ROBOTS, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    }),
  );
};
