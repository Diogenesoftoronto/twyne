import { afterEach, describe, expect, test } from "bun:test";
import {
  ConnectedError,
  ConnectedSession,
  type ConnectedProfile,
  type CredentialVault,
} from "./session";

class TestVault implements CredentialVault {
  saved: string | null = null;
  available = true;
  async load() {
    return this.saved;
  }
  async save(value: string) {
    if (!this.available) return false;
    this.saved = value;
    return true;
  }
  async clear() {
    this.saved = null;
  }
}
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const callbackOrigin = "http://127.0.0.1:34115";
  const vault = new TestVault();
  const requests: {
    path: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  let identitySubject = "writer";
  let sessionSubject: string | null = "writer";
  let sessionStatus = 200;
  let sessionName = "Writer",
    sessionHandle: string | undefined;
  let toolGate: ReturnType<typeof deferred> | null = null;
  let loseToolResponse = false;
  let toolCalls = 0;
  let catalog: unknown = {
    data: [
      {
        id: "notes",
        label: "Notes",
        resources_allowed: true,
        tools: [{ name: "search", inputSchema: { type: "object" } }],
      },
    ],
    revision: "fixture-metadata",
  };
  const token = "fixture-convex-token-not-a-real-jwt";
  const cookie = "better-auth.session_token=fixture-session";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const text = request.method === "POST" ? await request.text() : "";
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      requests.push({ path: url.pathname, headers: request.headers, body });
      if (url.pathname.startsWith("/api/auth/")) {
        if (request.headers.get("origin") !== callbackOrigin)
          return Response.json({ message: "Origin rejected" }, { status: 403 });
        if (url.pathname === "/api/auth/sign-in/notorganic") {
          if (
            body.origin !== callbackOrigin ||
            body.verifier !== "v".repeat(43) ||
            body.code !== "fixture-code"
          )
            return Response.json({ message: "Rejected" }, { status: 400 });
          return Response.json(
            { user: { id: "writer" } },
            {
              headers: {
                "Set-Better-Auth-Cookie": `${cookie}; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax`,
              },
            },
          );
        }
        if (request.headers.get("better-auth-cookie") !== cookie)
          return Response.json(null);
        if (url.pathname === "/api/auth/get-session") {
          if (url.searchParams.get("disableCookieCache") !== "true")
            return Response.json(null);
          if (sessionStatus !== 200)
            return Response.json(
              { message: "Fixture temporarily unavailable" },
              { status: sessionStatus },
            );
          if (sessionSubject === null) return Response.json(null);
          return Response.json({
            session: { id: "fixture-session-id", userId: sessionSubject },
            user: {
              id: sessionSubject,
              name: sessionName,
              handle: sessionHandle,
              email: "writer@notorganic.invalid",
            },
          });
        }
        if (url.pathname === "/api/auth/convex/token")
          return Response.json({ token });
        if (url.pathname === "/api/auth/sign-out")
          return Response.json({ success: true });
      }
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.get("authorization") !== `Bearer ${token}`)
          return Response.json({ status: "error", errorMessage: "No account" });
        if (
          request.headers.has("better-auth-cookie") ||
          request.headers.has("cookie")
        )
          return Response.json({
            status: "error",
            errorMessage: "Session credential crossed origins",
          });
        if (body.path === "native:session")
          return Response.json({
            status: "success",
            value: {
              issuer: url.origin,
              subject: identitySubject,
              tokenIdentifier: `${url.origin}|${identitySubject}`,
            },
            logLines: [],
          });
        if (body.path === "sync:pullAll")
          return Response.json({
            status: "success",
            value: { revision: 7 },
            logLines: [],
          });
        if (body.path === "sync:pushAll")
          return Response.json(
            {
              status: "error",
              errorMessage: "Fixture revision conflict",
              errorData: {
                code: "SYNC_CONFLICT",
                expectedRevision: 6,
                currentRevision: 7,
              },
              logLines: [],
            },
            { status: 560 },
          );
        if (body.path === "knowledge:sources")
          return Response.json({
            status: "success",
            value: catalog,
            logLines: [],
          });
        if (body.path === "knowledge:call") {
          toolCalls++;
          if (toolGate) await toolGate.promise;
          if (loseToolResponse)
            return new Response("fixture connection failure", { status: 502 });
          return Response.json({
            status: "success",
            value: { text: "Fixture result" },
            logLines: [],
          });
        }
      }
      return new Response("No fixture route", { status: 404 });
    },
  });
  servers.push(server);
  const profile: ConnectedProfile = {
    siteUrl: server.url.origin,
    convexUrl: server.url.origin,
    callbackOrigin,
  };
  const connected = new ConnectedSession(profile, vault);
  return {
    connected,
    vault,
    profile,
    requests,
    signIn: () =>
      connected.redeem({
        code: "fixture-code",
        verifier: "v".repeat(43),
        origin: callbackOrigin,
      }),
    changeIdentity: (value: string) => {
      identitySubject = value;
    },
    changeSession: (value: string | null) => {
      sessionSubject = value;
    },
    sessionStatus: (value: number) => {
      sessionStatus = value;
    },
    publicName: (name: string, handle?: string) => {
      sessionName = name;
      sessionHandle = handle;
    },
    holdTool: (gate: ReturnType<typeof deferred>) => {
      toolGate = gate;
    },
    loseTool: () => {
      loseToolResponse = true;
    },
    toolCalls: () => toolCalls,
    catalog: (value: unknown) => {
      catalog = value;
    },
  };
}
async function waitUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await Bun.sleep(5);
  }
  throw new Error("Fixture request did not arrive");
}

describe("resident connected SDK transport (local fixture, no real account)", () => {
  test("uses Source cross-domain cookies and a separately accepted Convex identity", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    expect(receipt.account).toEqual({
      issuer: f.profile.siteUrl,
      subject: "writer",
      tokenIdentifier: `${f.profile.siteUrl}|writer`,
    });
    expect(receipt.email).toBe("");
    expect(receipt.persistence).toBe("keychain");
    const publicJson = JSON.stringify(receipt);
    expect(publicJson).not.toContain("fixture-session");
    expect(publicJson).not.toContain("fixture-convex-token");
    expect(await f.connected.request(receipt.leaseId, "sync.pull", {})).toEqual(
      { revision: 7 },
    );
    expect(
      f.requests.filter(
        (request) => request.path === "/api/auth/sign-in/notorganic",
      ),
    ).toHaveLength(1);
    const saved = JSON.parse(f.vault.saved!);
    expect(Object.keys(saved)).toEqual(["better-auth.session_token"]);
    f.connected.dispose();
  });

  test("will not attach a session whose refreshed user or accepted identity changed", async () => {
    const f = fixture();
    f.changeSession("other");
    await expect(f.signIn()).rejects.toMatchObject({ kind: "signedOut" });
    expect(f.vault.saved).toBeNull();
    f.changeSession("writer");
    f.changeIdentity("other");
    await expect(f.signIn()).rejects.toMatchObject({ kind: "signedOut" });
    expect(f.vault.saved).toBeNull();
  });

  test("restores from the credential store only after fresh session and Convex checks", async () => {
    const f = fixture();
    const first = await f.signIn();
    f.connected.dispose();
    const restored = new ConnectedSession(f.profile, f.vault);
    const receipt = await restored.restore();
    expect(receipt?.account).toEqual(first.account);
    expect(receipt?.leaseId).not.toBe(first.leaseId);
    expect(await restored.request(receipt!.leaseId, "sync.pull", {})).toEqual({
      revision: 7,
    });
    restored.dispose();
  });

  test("session-only storage is explicit when the OS vault cannot save", async () => {
    const f = fixture();
    f.vault.available = false;
    expect((await f.signIn()).persistence).toBe("sessionOnly");
    expect(f.vault.saved).toBeNull();
  });

  test("a temporary auth outage preserves the current lease and remembered credentials", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    const saved = f.vault.saved;
    f.sessionStatus(503);
    await expect(
      f.connected.request(receipt.leaseId, "sync.pull", {}),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(f.vault.saved).toBe(saved);
    expect(
      f.requests.filter((request) => request.body.path === "sync:pullAll"),
    ).toHaveLength(0);
    f.sessionStatus(200);
    expect(await f.connected.request(receipt.leaseId, "sync.pull", {})).toEqual(
      { revision: 7 },
    );
    f.connected.dispose();
  });

  test("an auth outage during restore keeps credentials for a later retry", async () => {
    const f = fixture();
    const first = await f.signIn();
    const saved = f.vault.saved;
    f.connected.dispose();
    const restored = new ConnectedSession(f.profile, f.vault);
    f.sessionStatus(503);
    await expect(restored.restore()).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(f.vault.saved).toBe(saved);
    f.sessionStatus(200);
    const receipt = await restored.restore();
    expect(receipt?.account).toEqual(first.account);
    expect(await restored.request(receipt!.leaseId, "sync.pull", {})).toEqual({
      revision: 7,
    });
    restored.dispose();
  });

  test("an explicit session revocation removes the lease and remembered credentials", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    f.changeSession(null);
    await expect(
      f.connected.request(receipt.leaseId, "sync.pull", {}),
    ).rejects.toMatchObject({ kind: "signedOut" });
    expect(f.vault.saved).toBeNull();
    expect(await f.connected.restore()).toBeNull();
    await expect(
      f.connected.request(receipt.leaseId, "sync.pull", {}),
    ).rejects.toMatchObject({ kind: "signedOut" });
    expect(
      f.requests.filter((request) => request.body.path === "sync:pullAll"),
    ).toHaveLength(0);
  });

  test("malformed credential-store contents produce only a static connection error", async () => {
    const f = fixture();
    f.vault.saved = "{private-corrupt-credential";
    const error = await f.connected.restore().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ConnectedError);
    expect(error).toMatchObject({
      kind: "unavailable",
      message: "Twyne could not connect. Please try again.",
    });
    expect(f.requests).toHaveLength(0);
  });

  test("accepted receipts use Source public names without exposing legacy email or DID labels", async () => {
    const f = fixture();
    f.publicName("writer.private@example.test", "  morgan  ");
    expect((await f.signIn()).displayName).toBe("morgan");
    f.connected.dispose();
    f.publicName("did:plc:fixture", "did:plc:fixture");
    const restored = new ConnectedSession(f.profile, f.vault);
    expect((await restored.restore())?.displayName).toBe("Writer");
    restored.dispose();
  });

  test("sign-out rejects stale leases and invalidates an in-flight external tool result", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    const gate = deferred();
    f.holdTool(gate);
    const pending = f.connected
      .request(receipt.leaseId, "knowledge.call", {
        sourceId: "notes",
        tool: "search",
        arguments: { query: "fixture" },
      })
      .catch((error: unknown) => error);
    await waitUntil(() => f.toolCalls() === 1);
    const signingOut = f.connected.signOut();
    gate.resolve();
    await signingOut;
    expect(await pending).toMatchObject({ kind: "unknownOutcome" });
    expect(f.vault.saved).toBeNull();
    await expect(
      f.connected.request(receipt.leaseId, "sync.pull", {}),
    ).rejects.toMatchObject({ kind: "signedOut" });
    expect(f.toolCalls()).toBe(1);
  });

  test("a lost tool response is never retried", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    f.loseTool();
    await expect(
      f.connected.request(receipt.leaseId, "knowledge.call", {
        sourceId: "notes",
        tool: "search",
        arguments: {},
      }),
    ).rejects.toMatchObject({ kind: "unknownOutcome" });
    expect(f.toolCalls()).toBe(1);
  });

  test("an explicit Source CAS rejection remains a conflict and is not retried", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    await expect(
      f.connected.request(receipt.leaseId, "sync.push", {
        expectedRevision: 6,
      }),
    ).rejects.toMatchObject({ kind: "syncConflict" });
    expect(
      f.requests.filter((request) => request.body.path === "sync:pushAll"),
    ).toHaveLength(1);
  });

  test("knowledge argument admission uses exact JavaScript UTF-16 encoding", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    const argumentsAtLimit = { x: "🪼".repeat(29_996) };
    expect(JSON.stringify(argumentsAtLimit).length).toBe(60_000);
    await f.connected.request(receipt.leaseId, "knowledge.call", {
      sourceId: "source",
      tool: "search",
      arguments: argumentsAtLimit,
    });
    expect(f.toolCalls()).toBe(1);
    await expect(
      f.connected.request(receipt.leaseId, "knowledge.call", {
        sourceId: "source",
        tool: "search",
        arguments: { x: "🪼".repeat(29_997) },
      }),
    ).rejects.toMatchObject({ kind: "invalidRequest" });
    await expect(
      f.connected.request(receipt.leaseId, "knowledge.call", {
        sourceId: "",
        tool: "search",
        arguments: {},
      }),
    ).rejects.toMatchObject({ kind: "invalidRequest" });
    expect(f.toolCalls()).toBe(1);
  });

  test("knowledge source responses pass Source admission before crossing IPC", async () => {
    const f = fixture();
    const receipt = await f.signIn();
    expect(
      await f.connected.request(receipt.leaseId, "knowledge.sources", {}),
    ).toMatchObject({ revision: "fixture-metadata" });
    f.catalog({
      data: [
        {
          id: "notes",
          label: "Private invalid catalog",
          resources_allowed: true,
          tools: [{ name: "search", inputSchema: { type: "array" } }],
        },
      ],
    });
    await expect(
      f.connected.request(receipt.leaseId, "knowledge.sources", {}),
    ).rejects.toMatchObject({
      kind: "unavailable",
      message: "Twyne could not connect. Please try again.",
    });
  });

  test("a keychain save finishing after sign-out cannot leave remembered credentials", async () => {
    const f = fixture();
    const entered = deferred(),
      release = deferred();
    f.vault.save = async (value: string) => {
      entered.resolve();
      await release.promise;
      f.vault.saved = value;
      return true;
    };
    const pending = f.signIn().catch((error: unknown) => error);
    await entered.promise;
    const signedOut = f.connected.signOut();
    release.resolve();
    await signedOut;
    expect(await pending).toMatchObject({ kind: "stale" });
    expect(f.vault.saved).toBeNull();
  });

  test("rejects unapproved-origin redemption and non-catalog operations before sending", async () => {
    const f = fixture();
    await expect(
      f.connected.redeem({
        code: "fixture-code",
        verifier: "v".repeat(43),
        origin: "http://localhost:34115",
      }),
    ).rejects.toMatchObject({ kind: "invalidRequest" });
    expect(f.requests).toHaveLength(0);
    const receipt = await f.signIn();
    const before = f.requests.length;
    await expect(
      f.connected.request(receipt.leaseId, "account.delete", {}),
    ).rejects.toMatchObject({ kind: "invalidRequest" });
    await expect(
      f.connected.request("stale-lease", "sync.pull", {}),
    ).rejects.toMatchObject({ kind: "stale" });
    expect(f.requests).toHaveLength(before);
  });

  test("a redirect cannot send a session cookie to another origin", async () => {
    let foreignRequests = 0;
    const foreign = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        foreignRequests++;
        return Response.json({});
      },
    });
    servers.push(foreign);
    const site = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.redirect(foreign.url, 307);
      },
    });
    servers.push(site);
    const connected = new ConnectedSession(
      {
        siteUrl: site.url.origin,
        convexUrl: site.url.origin,
        callbackOrigin: "http://127.0.0.1:34115",
      },
      new TestVault(),
    );
    await expect(
      connected.redeem({
        code: "fixture-code",
        verifier: "v".repeat(43),
        origin: "http://127.0.0.1:34115",
      }),
    ).rejects.toBeInstanceOf(ConnectedError);
    expect(foreignRequests).toBe(0);
  });
});
