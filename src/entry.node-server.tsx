import { createQwikRouter } from "@qwik.dev/router/middleware/node";
import render from "./entry.ssr";

const { router, notFound } = createQwikRouter({
  render,
});

export { router, notFound };
