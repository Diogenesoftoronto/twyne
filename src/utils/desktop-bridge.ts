/**
 * Desktop shell bridge.
 *
 * The Electrobun desktop app loads the hosted web app in a native window at
 * `https://twyne.love/?platform=desktop&localAi=1&localPort=<port>`. This
 * module reads those URL params once so the rest of the web app can tell it is
 * running inside the desktop shell and discover the local LiteRT endpoint that
 * the desktop's Bun process exposes on loopback.
 *
 * On the plain web (no params) every getter is inert, so importing this is
 * safe and the local-AI surface stays hidden.
 */

interface DesktopContext {
  isDesktop: boolean;
  localAi: boolean;
  localPort: number | null;
}

let _ctx: DesktopContext | null = null;

function read(): DesktopContext {
  if (_ctx) return _ctx;
  if (typeof window === "undefined" || !window.location) {
    return { isDesktop: false, localAi: false, localPort: null };
  }
  const params = new URLSearchParams(window.location.search);
  const isDesktop = params.get("platform") === "desktop";
  const localAi = isDesktop && (params.get("localAi") === "1" || params.get("localAi") === "true");
  const portRaw = params.get("localPort");
  const localPort = portRaw && /^\d+$/.test(portRaw) ? parseInt(portRaw, 10) : null;
  _ctx = { isDesktop, localAi, localPort };
  return _ctx;
}

export function isDesktopShell(): boolean {
  return read().isDesktop;
}

/**
 * True when the desktop shell explicitly advertised a local model endpoint.
 *
 * The desktop app only includes `localAi=1&localPort=<n>` after it has chosen
 * to launch the bundled LiteRT server. Treat those params as the authoritative
 * capability signal so panels that normalize settings during first mount do
 * not miss the managed provider while PostHog flags are still loading.
 */
export function isDesktopLocalAiAvailable(): boolean {
  const ctx = read();
  return ctx.isDesktop && ctx.localAi && ctx.localPort !== null;
}

/** OpenAI-compatible base URL for the desktop's local LiteRT server, or null. */
export function localAiBaseUrl(): string | null {
  const ctx = read();
  if (!isDesktopLocalAiAvailable() || ctx.localPort === null) return null;
  return `http://127.0.0.1:${ctx.localPort}/v1`;
}

/** Default model id for the desktop local provider. */
export const LOCAL_MODEL_ID = "gemma-4-e4b";

/** Stable provider id for the auto-registered local provider. */
export const LOCAL_PROVIDER_ID = "desktop-litert-local";

export function resetDesktopContextForTests(): void {
  _ctx = null;
}
