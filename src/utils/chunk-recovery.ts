const RECOVERY_KEY = "twyne:chunk-recovery:v1";

/**
 * Heals a tab left open across a deploy. The page's code still names the
 * previous build's chunks; once those are gone, lazily loaded handlers fail
 * and parts of the page silently stop answering.
 *
 * The page records its build (`q:manifest-hash`). When a module fails to load
 * (Qwik's `qerror` event, a failed dynamic import, or a QRL that "failed to
 * load"), it asks the server which build the page is now served from. If that
 * build differs, it reloads once to pick up the current build. Nothing is
 * inferred from the error's wording beyond that it was a module failure: the
 * server's answer is the evidence. At most one such reload per ten minutes,
 * so a broken deploy cannot start a loop, while a tab open across several
 * deploys still heals after each one.
 *
 * Kept self-contained (no module closure) so it runs as an inline script
 * before any Qwik module is fetched.
 */
export function installChunkRecovery(
  host: Window & { console: Console },
): void {
  let checking = false;
  const describe = (reason: unknown): string => {
    if (typeof reason === "string") return reason;
    const error = reason as { message?: unknown } | null;
    return typeof error?.message === "string" ? error.message : "";
  };
  const recover = async (reason: unknown, importError: boolean) => {
    if (checking || host.navigator.onLine === false) return;
    if (
      !importError &&
      !/dynamically imported module|importing a module script failed|failed to fetch dynamically|qrl .* failed to load/i.test(
        describe(reason),
      )
    )
      return;
    const running = host.document.documentElement.getAttribute(
      "q:manifest-hash",
    );
    if (!running) return;
    try {
      const last = Number(
        host.sessionStorage.getItem("twyne:chunk-recovery:v1") ?? 0,
      );
      if (Date.now() - last < 10 * 60_000) return;
    } catch {
      // Without session storage there is no durable reload-loop guard.
      return;
    }
    checking = true;
    try {
      // A lost connection, an aborted request or a bug in a handler is not a
      // deploy. Reload only when the server now serves a different build.
      const response = await host.fetch(host.location.href, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      });
      if (!response.ok) return;
      const page = await response.text();
      const current = page.match(/q:manifest-hash="([^"]+)"/)?.[1];
      if (
        current &&
        current !== running &&
        host.document.visibilityState !== "hidden"
      ) {
        host.sessionStorage.setItem(
          "twyne:chunk-recovery:v1",
          String(Date.now()),
        );
        // The editor's pagehide path flushes the pending draft (and its
        // crash mirror) synchronously, so in-flight typing survives this.
        host.location.reload();
      }
    } catch {
      // Offline and cache failures must not start a reload loop.
    } finally {
      checking = false;
    }
  };
  host.document.addEventListener("qerror", (event) => {
    const detail = (
      event as CustomEvent<{ error?: unknown; importError?: unknown }>
    ).detail;
    void recover(detail?.error, Boolean(detail?.importError));
  });
  host.addEventListener("unhandledrejection", (event) => {
    void recover(event.reason, false);
  });
  // Qwik reports a QRL whose chunk failed to load on the console only.
  const consoleError = host.console.error.bind(host.console);
  host.console.error = (...args: unknown[]) => {
    consoleError(...args);
    if (typeof args[0] === "string" && / failed to load$/.test(args[0]))
      void recover(args[0], false);
  };
}

export const CHUNK_RECOVERY_SCRIPT = `(${installChunkRecovery.toString()})(window);`;
export { RECOVERY_KEY };
