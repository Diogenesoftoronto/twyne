import { describe, expect, test } from "bun:test";
import { CHUNK_RECOVERY_SCRIPT, RECOVERY_KEY } from "./chunk-recovery";

/**
 * A stand-in window. `served` is the build the server now answers with (its
 * `q:manifest-hash`), or a status code when the page request itself fails.
 */
function harness(
  served: string | number = "build-b",
  storage = new Map<string, string>(),
  running = "build-a",
) {
  const events = new Map<string, (event: any) => void>();
  const probes: string[] = [];
  const logged: unknown[][] = [];
  let reloads = 0;
  const host = {
    navigator: { onLine: true },
    location: {
      href: "https://twyne.example/editor/",
      reload: () => {
        reloads++;
      },
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    document: {
      visibilityState: "visible",
      documentElement: {
        getAttribute: (name: string) =>
          name === "q:manifest-hash" ? running : null,
      },
      addEventListener: (name: string, callback: (event: any) => void) =>
        events.set(name, callback),
    },
    console: { error: (...args: unknown[]) => logged.push(args) },
    addEventListener: (name: string, callback: (event: any) => void) =>
      events.set(name, callback),
    fetch: async (url: string, init: RequestInit) => {
      probes.push(url);
      expect(init.cache).toBe("no-store");
      if (typeof served === "number") return new Response("", { status: served });
      return new Response(
        `<!DOCTYPE html><html q:manifest-hash="${served}"><body></body></html>`,
        { status: 200 },
      );
    },
  };
  // Exercise the bootstrap as a standalone script: it must have no module
  // closure dependency because it runs before Qwik can resume the root.
  new Function("window", CHUNK_RECOVERY_SCRIPT)(host);
  const reject = (message: string) =>
    events.get("unhandledrejection")!({ reason: new TypeError(message) });
  const qerror = (detail: Record<string, unknown>) =>
    events.get("qerror")!({ detail });
  return {
    host,
    storage,
    probes,
    logged,
    reloads: () => reloads,
    reject,
    qerror,
  };
}

const failure =
  "error loading dynamically imported module: https://twyne.example/build/q-old.js";
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("stale build recovery", () => {
  test("reloads once when a module fails and the server has a new build", async () => {
    const h = harness();
    h.reject(failure);
    h.reject(failure);
    await settle();
    expect(h.reloads()).toBe(1);
    expect(Number(h.storage.get(RECOVERY_KEY))).toBeGreaterThan(0);
    // The reloaded page must not loop on a build that is still broken.
    const next = harness("build-c", h.storage, "build-b");
    next.reject(failure);
    await settle();
    expect(next.reloads()).toBe(0);
    expect(next.probes).toHaveLength(0);
  });

  test("a later deploy heals the same tab again", async () => {
    const storage = new Map([[RECOVERY_KEY, String(Date.now() - 11 * 60_000)]]);
    const h = harness("build-b", storage);
    h.reject(failure);
    await settle();
    expect(h.reloads()).toBe(1);
  });

  test("answers Qwik's import errors and its 'failed to load' console report", async () => {
    const fromEvent = harness();
    fromEvent.qerror({ importError: "async", error: new TypeError("x") });
    await settle();
    expect(fromEvent.reloads()).toBe(1);

    const fromConsole = harness();
    fromConsole.host.console.error("qrl s_abc failed to load", {});
    await settle();
    expect(fromConsole.reloads()).toBe(1);
    // The original console still receives the report.
    expect(fromConsole.logged).toHaveLength(1);
  });

  test("does not reload when the build is unchanged or the check fails", async () => {
    for (const served of ["build-a", 500, 503]) {
      const h = harness(served);
      h.reject(failure);
      await settle();
      expect(h.reloads()).toBe(0);
    }
  });

  test("ignores errors that are not module failures", async () => {
    const h = harness();
    h.reject("fetch failed");
    h.reject("Cannot read properties of undefined");
    h.qerror({ error: new Error("a handler threw") });
    h.host.console.error("Something else went wrong");
    h.host.console.error("Image failed to load");
    await settle();
    expect(h.probes).toHaveLength(0);
    expect(h.reloads()).toBe(0);
  });

  test("checks the server at most once in 30 seconds", async () => {
    const h = harness("build-a");
    h.reject(failure);
    await settle();
    h.reject(failure);
    h.host.console.error("qrl s_abc failed to load", {});
    await settle();
    expect(h.probes).toHaveLength(1);
    expect(h.reloads()).toBe(0);
  });

  test("offline, hidden, or storage-blocked pages cannot enter a reload loop", async () => {
    const offline = harness();
    offline.host.navigator.onLine = false;
    offline.reject(failure);
    const hidden = harness();
    hidden.host.document.visibilityState = "hidden";
    hidden.reject(failure);
    const blocked = harness();
    blocked.host.sessionStorage.getItem = () => {
      throw new Error("blocked");
    };
    blocked.reject(failure);
    await settle();
    expect(offline.reloads() + hidden.reloads() + blocked.reloads()).toBe(0);
  });
});
