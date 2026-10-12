import { createAuthClient } from "better-auth/client";
import type { BetterAuthClientPlugin } from "better-auth";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { randomUUID } from "node:crypto";
import { validateCatalog } from "./catalog";
import { accountDisplayName } from "../../../../src/utils/account-display";

export interface ConnectedProfile {
  siteUrl: string;
  convexUrl: string;
  callbackOrigin: string;
}
export interface AccountIdentity {
  issuer: string;
  subject: string;
  tokenIdentifier: string;
}
export interface SessionReceipt {
  account: AccountIdentity;
  leaseId: string;
  displayName: string;
  email: string;
  persistence: "keychain" | "sessionOnly";
}
/** Implementations must use the OS credential store, never a library file. */
export interface CredentialVault {
  load(): Promise<string | null>;
  save(cookieJar: string): Promise<boolean>;
  clear(): Promise<void>;
}
type ErrorKind =
  | "invalidRequest"
  | "signedOut"
  | "stale"
  | "unavailable"
  | "unknownOutcome"
  | "syncConflict";
export class ConnectedError extends Error {
  constructor(readonly kind: ErrorKind) {
    super(
      {
        invalidRequest: "Twyne could not use this request.",
        signedOut: "Sign in to Twyne to continue.",
        stale: "The active account changed before this request completed.",
        unavailable: "Twyne could not connect. Please try again.",
        unknownOutcome:
          "The connection was lost after sending this request. Its outcome is unknown.",
        syncConflict:
          "This workspace changed on another device. Refresh it before trying again.",
      }[kind],
    );
  }
}
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const COOKIE_KEY = "better-auth_cookie";
const identityRef = makeFunctionReference<"query">("native:session");
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function publicDisplayName(user: Record<string, unknown>): string {
  return accountDisplayName({
    name: typeof user.name === "string" ? user.name : undefined,
    handle: typeof user.handle === "string" ? user.handle : undefined,
  });
}
function origin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.origin !== value ||
      parsed.username ||
      parsed.password ||
      !(
        parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
      )
    )
      throw 0;
    return parsed.origin;
  } catch {
    throw new ConnectedError("invalidRequest");
  }
}
export function validateProfile(profile: ConnectedProfile): ConnectedProfile {
  // These URLs are operator configuration. Syntax never establishes callback
  // registration: the native host separately checks Twyne/provider approval.
  return {
    siteUrl: origin(profile.siteUrl),
    convexUrl: origin(profile.convexUrl),
    callbackOrigin: origin(profile.callbackOrigin),
  };
}
class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
type AuthClient = ReturnType<typeof createClient>;
function createClient(
  profile: ConnectedProfile,
  storage: MemoryStorage,
  fetcher: typeof fetch,
) {
  return createAuthClient({
    baseURL: profile.siteUrl,
    // Source has the same installed Better Fetch generic mismatch. The plugin
    // is runtime-compatible; keep this cast at that dependency boundary.
    plugins: [
      crossDomainClient({ storage }) as unknown as BetterAuthClientPlugin,
      convexClient(),
    ],
    fetchOptions: {
      headers: { Origin: profile.callbackOrigin },
      customFetchImpl: fetcher,
      throw: false,
      retry: 0,
      redirect: "error",
    },
  });
}

/**
 * Resident SDK transport. Only public receipts/data cross the GPUI IPC pipe;
 * cookies and freshly issued Convex JWTs stay inside this process. Every
 * operation gets its own HTTP client and is qualified by a session generation.
 */
export class ConnectedSession {
  readonly profile: ConnectedProfile;
  #epoch = 0;
  #controller = new AbortController();
  #storage = new MemoryStorage();
  #auth: AuthClient;
  #receipt: SessionReceipt | null = null;
  #signingIn = false;
  #vaultQueue: Promise<unknown> = Promise.resolve();
  #vault: CredentialVault;
  #network: typeof fetch;
  constructor(
    profile: ConnectedProfile,
    vault: CredentialVault,
    network: typeof fetch = fetch,
  ) {
    this.profile = validateProfile(profile);
    this.#vault = vault;
    this.#network = network;
    this.#auth = this.#makeAuth();
  }
  #requireEpoch(epoch: number): void {
    if (epoch !== this.#epoch) throw new ConnectedError("stale");
  }
  #fetch(expectedOrigin: string, epoch = this.#epoch): typeof fetch {
    const lifetime = this.#controller.signal;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      this.#requireEpoch(epoch);
      const request = new Request(input, init);
      if (new URL(request.url).origin !== expectedOrigin)
        throw new ConnectedError("invalidRequest");
      // The pinned Bun runtime supports any(); the installed DOM types lag it.
      const signal = (
        AbortSignal as typeof AbortSignal & {
          any(signals: AbortSignal[]): AbortSignal;
        }
      ).any([lifetime, request.signal, AbortSignal.timeout(35_000)]);
      const response = await this.#network(request, {
        redirect: "error",
        signal,
      });
      this.#requireEpoch(epoch);
      if (
        (response.status >= 300 && response.status < 400) ||
        (response.url && new URL(response.url).origin !== expectedOrigin)
      )
        throw new ConnectedError("unavailable");
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        if (reader)
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > MAX_RESPONSE_BYTES)
              throw new ConnectedError("unavailable");
            chunks.push(chunk.value);
          }
      } catch (error) {
        await reader?.cancel().catch(() => {});
        throw error;
      } finally {
        reader?.releaseLock();
      }
      this.#requireEpoch(epoch);
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      // Preserve the Source SDK's Set-Better-Auth-Cookie processing exactly.
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(
        [204, 205, 304].includes(response.status) ? null : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers,
        },
      );
    }) as typeof fetch;
  }
  #makeAuth(): AuthClient {
    return createClient(
      this.profile,
      this.#storage,
      this.#fetch(this.profile.siteUrl),
    );
  }
  #reset(): void {
    this.#epoch++;
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#storage = new MemoryStorage();
    this.#receipt = null;
    this.#auth = this.#makeAuth();
  }
  #publicReceipt(): SessionReceipt | null {
    return this.#receipt && structuredClone(this.#receipt);
  }
  #vaultWork<T>(work: () => Promise<T>): Promise<T> {
    // Sign-out's deletion must follow any save already in progress. Otherwise
    // a late keychain write could restore credentials after sign-out.
    const result = this.#vaultQueue.catch(() => {}).then(work);
    this.#vaultQueue = result;
    return result;
  }
  async #confirmed(
    userId: string,
    epoch: number,
  ): Promise<{
    client: ConvexHttpClient;
    account: AccountIdentity;
    user: Record<string, unknown>;
  }> {
    const auth = this.#auth;
    const refreshed = await auth.getSession({
      query: { disableCookieCache: true },
    });
    this.#requireEpoch(epoch);
    const data = record(refreshed.data),
      user = record(data?.user),
      session = record(data?.session);
    if (refreshed.error) throw new ConnectedError("unavailable");
    if (
      !user ||
      user.id !== userId ||
      session?.userId !== userId ||
      typeof session.id !== "string" ||
      !session.id
    )
      throw new ConnectedError("signedOut");
    const result = record(
      await auth.$fetch("/convex/token", { method: "GET", throw: false }),
    );
    this.#requireEpoch(epoch);
    const token = record(result?.data)?.token;
    if (result?.error) throw new ConnectedError("unavailable");
    if (!result || typeof token !== "string" || !token || token.length > 65_536)
      throw new ConnectedError("signedOut");
    const client = new ConvexHttpClient(this.profile.convexUrl, {
      fetch: this.#fetch(this.profile.convexUrl, epoch),
      logger: false,
      // Canonical HTTPS custom deployments are allowed operator configuration.
      skipConvexDeploymentUrlCheck: true,
    });
    // This is a verified API in the pinned SDK, omitted from its public types.
    (client as ConvexHttpClient & { setDebug(value: boolean): void }).setDebug(
      false,
    );
    client.setAuth(token);
    const account = record(await client.query(identityRef, {}));
    this.#requireEpoch(epoch);
    if (
      !account ||
      typeof account.issuer !== "string" ||
      account.issuer.replace(/\/$/, "") !== this.profile.siteUrl ||
      account.subject !== userId ||
      account.tokenIdentifier !== `${account.issuer}|${userId}`
    )
      throw new ConnectedError("signedOut");
    return { client, account: account as unknown as AccountIdentity, user };
  }
  async #remember(epoch: number): Promise<"keychain" | "sessionOnly"> {
    const jar =
      record(JSON.parse(this.#storage.getItem(COOKIE_KEY) ?? "{}")) ?? {};
    const cookies = Object.fromEntries(
      Object.entries(jar).filter(([name]) => name.includes(".session_token")),
    );
    // Persist only the session cookie in the credential store; not cached JWTs,
    // provider capabilities, or account/document metadata.
    let saved = false;
    try {
      saved = await this.#vaultWork(() => {
        this.#requireEpoch(epoch);
        return this.#vault.save(JSON.stringify(cookies));
      });
    } catch {
      /* session-only; the epoch check below still rejects stale work */
    }
    this.#requireEpoch(epoch);
    return saved ? "keychain" : "sessionOnly";
  }
  async redeem(input: {
    code: string;
    verifier: string;
    origin: string;
  }): Promise<SessionReceipt> {
    if (this.#signingIn) throw new ConnectedError("invalidRequest");
    if (
      input.origin !== this.profile.callbackOrigin ||
      !input.code ||
      input.code.length > 2048 ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)
    )
      throw new ConnectedError("invalidRequest");
    this.#signingIn = true;
    this.#reset();
    const epoch = this.#epoch;
    try {
      await this.#vaultWork(() => this.#vault.clear());
      this.#requireEpoch(epoch);
      const redeemed = await this.#auth.$fetch("/sign-in/notorganic", {
        method: "POST",
        body: input,
      });
      this.#requireEpoch(epoch);
      const issuedId = record(record(redeemed.data)?.user)?.id;
      if (redeemed.error || typeof issuedId !== "string" || !issuedId)
        throw new ConnectedError("signedOut");
      const confirmed = await this.#confirmed(issuedId, epoch);
      const persistence = await this.#remember(epoch);
      this.#receipt = {
        account: confirmed.account,
        leaseId: randomUUID(),
        persistence,
        displayName: publicDisplayName(confirmed.user),
        email:
          typeof confirmed.user.email === "string" &&
          !confirmed.user.email.endsWith("@notorganic.invalid")
            ? confirmed.user.email
            : "",
      };
      return this.#publicReceipt()!;
    } catch (error) {
      if (epoch === this.#epoch) this.#reset();
      throw error instanceof ConnectedError
        ? error
        : new ConnectedError("unavailable");
    } finally {
      this.#signingIn = false;
    }
  }
  async restore(): Promise<SessionReceipt | null> {
    if (this.#receipt || this.#signingIn) return this.#publicReceipt();
    const epoch = this.#epoch;
    try {
      const saved = await this.#vaultWork(() => this.#vault.load());
      this.#requireEpoch(epoch);
      if (!saved) return null;
      if (saved.length > 65_536 || !record(JSON.parse(saved)))
        throw new ConnectedError("unavailable");
      this.#storage.setItem(COOKIE_KEY, saved);
      const refreshed = await this.#auth.getSession({
        query: { disableCookieCache: true },
      });
      this.#requireEpoch(epoch);
      const userId = record(record(refreshed.data)?.user)?.id;
      if (refreshed.error) throw new ConnectedError("unavailable");
      if (typeof userId !== "string" || !userId)
        throw new ConnectedError("signedOut");
      const confirmed = await this.#confirmed(userId, epoch);
      const persistence = await this.#remember(epoch);
      this.#receipt = {
        account: confirmed.account,
        leaseId: randomUUID(),
        persistence,
        displayName: publicDisplayName(confirmed.user),
        email:
          typeof confirmed.user.email === "string" &&
          !confirmed.user.email.endsWith("@notorganic.invalid")
            ? confirmed.user.email
            : "",
      };
      return this.#publicReceipt();
    } catch (error) {
      if (epoch === this.#epoch) this.#reset();
      if (error instanceof ConnectedError && error.kind === "signedOut") {
        await this.#vaultWork(() => this.#vault.clear());
        return null;
      }
      throw error instanceof ConnectedError
        ? error
        : new ConnectedError("unavailable");
    }
  }
  async signOut(): Promise<void> {
    const previous = this.#storage;
    this.#reset();
    const auth = createClient(
      this.profile,
      previous,
      this.#fetch(this.profile.siteUrl),
    );
    // Clear remembered credentials even when the network is unavailable.
    await this.#vaultWork(() => this.#vault.clear());
    try {
      const result = await auth.signOut();
      if (result.error) throw 0;
    } catch {
      throw new ConnectedError("unavailable");
    }
  }
  async request(
    leaseId: string,
    operation: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const receipt = this.#receipt;
    if (!receipt) throw new ConnectedError("signedOut");
    if (receipt.leaseId !== leaseId) throw new ConnectedError("stale");
    const routes = {
      "sync.pull": ["query", "sync:pullAll"],
      "sync.push": ["mutation", "sync:pushAll"],
      "knowledge.sources": ["action", "knowledge:sources"],
      "knowledge.resources": ["action", "knowledge:resources"],
      "knowledge.read": ["action", "knowledge:read"],
      "knowledge.call": ["action", "knowledge:call"],
    } as const;
    if (!Object.hasOwn(routes, operation))
      throw new ConnectedError("invalidRequest");
    if (operation.startsWith("knowledge.")) {
      const identifier = (value: unknown, limit: number) => {
        if (typeof value !== "string" || !value || value.length > limit)
          throw new ConnectedError("invalidRequest");
      };
      if (operation !== "knowledge.sources") identifier(args.sourceId, 256);
      if (operation === "knowledge.read") identifier(args.uri, 4096);
      if (operation === "knowledge.call") {
        identifier(args.tool, 256);
        if (
          !record(args.arguments) ||
          JSON.stringify(args.arguments).length > 60_000
        )
          throw new ConnectedError("invalidRequest");
      }
    }
    const [kind, path] = routes[operation as keyof typeof routes];
    const epoch = this.#epoch;
    let confirmed: {
      client: ConvexHttpClient;
      account: AccountIdentity;
      user: Record<string, unknown>;
    };
    try {
      confirmed = await this.#confirmed(receipt.account.subject, epoch);
    } catch (error) {
      if (
        error instanceof ConnectedError &&
        error.kind === "signedOut" &&
        epoch === this.#epoch
      ) {
        this.#reset();
        try {
          await this.#vaultWork(() => this.#vault.clear());
        } catch {
          throw new ConnectedError("unavailable");
        }
      }
      throw error instanceof ConnectedError
        ? error
        : new ConnectedError("unavailable");
    }
    if (
      confirmed.account.issuer !== receipt.account.issuer ||
      confirmed.account.subject !== receipt.account.subject ||
      confirmed.account.tokenIdentifier !== receipt.account.tokenIdentifier
    )
      throw new ConnectedError("stale");
    this.#requireEpoch(epoch);
    let sent = false;
    try {
      sent = true;
      const result =
        kind === "query"
          ? await confirmed.client.query(
              makeFunctionReference<"query">(path),
              args,
            )
          : kind === "mutation"
            ? await confirmed.client.mutation(
                makeFunctionReference<"mutation">(path),
                args,
              )
            : await confirmed.client.action(
                makeFunctionReference<"action">(path),
                args,
              );
      this.#requireEpoch(epoch);
      if (operation === "knowledge.sources") validateCatalog(result);
      return result;
    } catch (error) {
      // Source pushAll rejects the stale revision before performing any write.
      // This acknowledged rejection is distinct from a lost mutation response.
      if (
        operation === "sync.push" &&
        error instanceof ConvexError &&
        record(error.data)?.code === "SYNC_CONFLICT"
      )
        throw new ConnectedError("syncConflict");
      // A failed/lost response to a write or tool call is never automatically
      // retried. The parent reconciles sync heads or presents an unknown result.
      if (sent && (kind === "mutation" || operation === "knowledge.call"))
        throw new ConnectedError("unknownOutcome");
      throw error instanceof ConnectedError
        ? error
        : new ConnectedError("unavailable");
    }
  }
  dispose(): void {
    this.#reset();
  }
}
