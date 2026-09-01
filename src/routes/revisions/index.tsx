import type { RequestHandler } from "@qwik.dev/router";

/** Preserve old bookmarks while keeping version history inside the editor. */
export const onGet: RequestHandler = ({ redirect }) => {
  throw redirect(302, "/editor/?panel=history");
};
