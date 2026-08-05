import type { RequestHandler } from "@builder.io/qwik-city";
import {
  loadStandardSitePublication,
  standardSiteRouteDid,
} from "../../utils/standard-site-reader.server";

/**
 * Qwik's route discovery ignores a source directory whose name starts with a
 * dot. A catch-all lets the exact Standard.site well-known path reach a route
 * handler while every other unmatched path remains a normal 404.
 */
export const onGet: RequestHandler = async ({ params, send, cacheControl }) => {
  const segments = (params.standardSiteVerification ?? "").split("/");
  if (
    segments.length !== 5 ||
    segments[0] !== ".well-known" ||
    segments[1] !== "site.standard.publication" ||
    segments[2] !== "at"
  ) {
    send(
      new Response("Not found\n", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
    return;
  }

  try {
    const did = standardSiteRouteDid(segments[3]);
    const { publication } = await loadStandardSitePublication(did, segments[4]);
    cacheControl({
      public: true,
      maxAge: 60,
      sMaxAge: 300,
      staleWhileRevalidate: 3_600,
    });
    send(
      new Response(`${publication.uri}\n`, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
  } catch {
    send(
      new Response("Standard.site publication not found\n", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=30",
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
  }
};
