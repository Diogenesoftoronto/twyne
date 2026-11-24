/*
 * WHAT IS THIS FILE?
 *
 * It's the bundle entry point for `npm run preview`.
 * That is, serving your app built in production mode.
 *
 * Feel free to modify this file, but don't remove it!
 *
 * Learn more about Vite's preview command:
 * - https://vitejs.dev/config/preview-options.html#preview-options
 *
 */
import { createQwikRouter } from "@qwik.dev/router/middleware/node";
import { fileURLToPath } from "node:url";
import render from "./entry.ssr";
import { CUSTOM_DOMAIN_HEADER } from "../scripts/custom-domain-routing.mjs";

/**
 * The default export is the QwikCity adapter used by Vite preview.
 */
export default createQwikRouter({
  render,
  // Qwik 2 beta's middleware default is relative to its package, which points
  // outside this project once the entry is bundled into `server/`.
  static: { root: fileURLToPath(new URL("../dist", import.meta.url)) },
  // `server.js` sets this header only after resolving a writer's custom
  // domain (and strips any inbound copy), so pages there build canonical and
  // social URLs on that domain even when ORIGIN pins the Twyne origin.
  getOrigin: (req) => {
    const host = req.headers[CUSTOM_DOMAIN_HEADER];
    return typeof host === "string" && host ? `https://${host}` : null;
  },
});
