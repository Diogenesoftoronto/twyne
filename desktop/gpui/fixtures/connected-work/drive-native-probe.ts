import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const [native, helper, output] = process.argv.slice(2).map((path) => resolve(path));
if (!native || !helper || !output) throw new Error("Native probe, connected helper and fresh output directory are required");
await mkdir(output, { recursive: false, mode: 0o700 });
const toolDispatched = resolve(output, "tool-dispatched");
const requests: { path: string; function?: string }[] = [];
let release!: () => void;
const delayedTool = new Promise<void>((done) => { release = done; });
let signOutRequests = 0, toolCalls = 0;
const cookie = "better-auth.session_token=fixture-session";
const token = "fixture-convex-token-not-a-real-jwt";
// The fixture selects a currently free loopback port. This synthetic approval
// is confined to the probe; production registrations require a fixed origin.
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return new Response(null); } });
const callbackOrigin = reservation.url.origin;
reservation.stop(true);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const url = new URL(request.url), raw = request.method === "POST" ? await request.text() : "";
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    requests.push({ path: url.pathname, function: typeof body.path === "string" ? body.path : undefined });
    if (url.pathname.startsWith("/api/auth/")) {
      if (request.headers.get("origin") !== callbackOrigin) return new Response(null, { status: 403 });
      if (url.pathname === "/api/auth/sign-in/notorganic") {
        if (body.code !== "fixture-code" || body.verifier !== Buffer.alloc(32, 1).toString("base64url") || body.origin !== callbackOrigin)
          return new Response(null, { status: 400 });
        return Response.json({ user: { id: "fixture-writer" } }, {
          headers: { "Set-Better-Auth-Cookie": `${cookie}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax` },
        });
      }
      if (request.headers.get("better-auth-cookie") !== cookie) return Response.json(null);
      if (url.pathname === "/api/auth/get-session") {
        if (url.searchParams.get("disableCookieCache") !== "true") return new Response(null, { status: 400 });
        return Response.json({ session: { id: "fixture-session-id", userId: "fixture-writer" },
          user: { id: "fixture-writer", name: "Fixture Writer", email: "fixture@notorganic.invalid" } });
      }
      if (url.pathname === "/api/auth/convex/token") return Response.json({ token });
      if (url.pathname === "/api/auth/sign-out") { signOutRequests++; release(); return Response.json({ success: true }); }
    }
    if (request.headers.get("authorization") !== `Bearer ${token}` || request.headers.has("better-auth-cookie") || request.headers.has("cookie"))
      return new Response(null, { status: 401 });
    if (body.path === "native:session") return Response.json({ status: "success", value: {
      issuer: url.origin, subject: "fixture-writer", tokenIdentifier: `${url.origin}|fixture-writer`,
    }, logLines: [] });
    if (body.path === "sync:pullAll") return Response.json({ status: "success", value: {
      syncRevision: 7, folios: [{ id: "remote-folio", name: "Fixture folio" }],
      folioContent: [{ folioId: "remote-folio", html: "<p>Fixture writing.</p>", format: "html", updatedAt: 1 }],
    }, logLines: [] });
    if (body.path === "sync:pushAll") return Response.json({ status: "error", errorMessage: "Fixture revision conflict",
      errorData: { code: "SYNC_CONFLICT", expectedRevision: 6, currentRevision: 7 }, logLines: [] }, { status: 560 });
    if (body.path === "knowledge:sources") return Response.json({ status: "success", value: {
      data: [{ id: "fixture-source", label: "Fixture notes", resources_allowed: true,
        tools: [{ name: "search", title: 5, description: null, inputSchema: { type: "object", properties: { query: { type: "string" } } } }] }],
    }, logLines: [] });
    if (body.path === "knowledge:call") {
      toolCalls++;
      await writeFile(toolDispatched, "fixture tool dispatched\n");
      await delayedTool;
      return Response.json({ status: "success", value: { text: "A late fixture result" }, logLines: [] });
    }
    return new Response(null, { status: 404 });
  },
});
const fixture = resolve(output, "fixture.json"), receipt = resolve(output, "native-receipt.json");
const callbackReady = resolve(output, "callback-ready.json");
await writeFile(fixture, JSON.stringify({ helper, siteUrl: server.url.origin, convexUrl: server.url.origin,
  callbackOrigin, toolDispatched, callbackReady, output: receipt }, null, 2) + "\n");
const browser = await chromium.launch({ executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome", headless: true });
try {
  const child = Bun.spawn(["rtk", "proxy", native, fixture], { stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  let code: number, stdout: string, stderr: string;
  let browserReceipt: { queryRemoved: boolean; errors: string[] };
  try {
    const finished = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    let callback: { origin: string; state: string; synthetic: boolean } | null = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { callback = JSON.parse(await readFile(callbackReady, "utf8")); break; } catch { await Bun.sleep(10); }
    }
    if (!callback || callback.origin !== callbackOrigin || !callback.synthetic) throw new Error("The native callback listener was not ready");
    const context = await browser.newContext();
    await context.route("**/*", (route) => new URL(route.request().url()).origin === callbackOrigin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.name));
    await page.goto(`${callbackOrigin}/auth/notorganic/?state=${encodeURIComponent(callback.state)}&code=fixture-code`, { waitUntil: "load" });
    await expect(page).toHaveURL(`${callbackOrigin}/auth/notorganic/`);
    if (errors.length) throw new Error("The native callback history cleanup did not execute");
    browserReceipt = { queryRemoved: true, errors };
    [code, stdout, stderr] = await finished;
    await context.close();
  }
  finally { clearTimeout(timeout); }
  await writeFile(resolve(output, "native.log"), stdout + stderr);
  if (code !== 0) throw new Error("The native loopback probe failed; see the private-data-free fixture log");
  if (stdout.includes("fixture-session") || stdout.includes(token) || stderr.includes("fixture-session") || stderr.includes(token))
    throw new Error("A synthetic credential escaped into the native process output");
  if (toolCalls !== 1 || signOutRequests !== 1) throw new Error("The expected fixture dispatch counts did not match");
  const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
  await writeFile(resolve(output, "transport-receipt.json"), JSON.stringify({
    status: "passed", scope: "Executed compiled Rust bridge and Bun SDK helper against a synthetic local HTTP backend",
    native: { path: native, sha256: await hash(native) }, helper: { path: helper, sha256: await hash(helper) },
    requests, toolCalls, signOutRequests, browser: browserReceipt, credentialStoreAccessed: false, userLibraryTouched: false,
    nativeReceipt: receipt, realConvexAuthenticationProven: false, productionRegistrationProven: false,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", output, toolCalls, signOutRequests }));
} finally { release(); server.stop(true); await browser.close(); }
