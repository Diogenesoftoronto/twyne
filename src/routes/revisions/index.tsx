import type { RequestHandler } from "@builder.io/qwik-city";

/** Preserve old bookmarks while keeping version history inside the editor. */
export const onGet: RequestHandler = ({ redirect }) => {
  throw redirect(302, "/editor/?panel=history");
};
