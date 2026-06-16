/**
 * Twyne desktop — Electrobun main (Bun) process.
 *
 * Opens a single native window on the hosted Twyne web app. Everything that
 * makes Twyne work (Qwik SSR, Convex sync, Better Auth passkeys, ATProto
 * publishing) is served from the deployed site, so the desktop build ships no
 * application code of its own — it is a branded, self-updating shell.
 *
 * If the build was produced with local AI enabled, a native LiteRT-LM server
 * (Gemma 4 E4B) is started on loopback and advertised to the page via URL
 * params, so the web app can route AI through the local model.
 *
 * Point the window at a local dev server by setting TWYNE_DESKTOP_URL, e.g.
 *   TWYNE_DESKTOP_URL=http://localhost:5173 bun start
 */
import { BrowserWindow } from "electrobun/bun";
import { startLocalAiServer } from "./litert-server";

const BASE_URL = process.env.TWYNE_DESKTOP_URL ?? "https://twyne.love";

function withParams(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  u.searchParams.set("platform", "desktop");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const local = await startLocalAiServer();

const url = local
  ? withParams(BASE_URL, { localAi: "1", localPort: String(local.port) })
  : withParams(BASE_URL, {});

const win = new BrowserWindow({
  title: "Twyne",
  url,
  frame: {
    width: 1280,
    height: 860,
    x: 80,
    y: 60,
  },
  titleBarStyle: "hiddenInset",
});

// Tear the local model server down with the app.
if (local) {
  const shutdown = () => local.stop();
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
}

export { win };
