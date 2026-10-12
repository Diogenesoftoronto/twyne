import {
  ConnectedError,
  ConnectedSession,
  type ConnectedProfile,
  type CredentialVault,
} from "./session";
import { PlatformCredentialVault } from "./vault";

const MAX_LINE_BYTES = 32 * 1024 * 1024;
const MAX_IN_FLIGHT = 4;
let session: ConnectedSession | null = null;
const pending = new Set<string>();
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new ConnectedError("invalidRequest");
  return value;
}
function fields(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new ConnectedError("invalidRequest");
}
const volatileVault: CredentialVault = {
  async load() {
    return null;
  },
  async save() {
    return false;
  },
  async clear() {},
};
async function dispatch(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (method === "init") {
    if (session) throw new ConnectedError("invalidRequest");
    fields(params, ["profile", "storage"]);
    const profile = record(params.profile);
    if (
      !profile ||
      !["platform", "sessionOnly"].includes(string(params.storage))
    )
      throw new ConnectedError("invalidRequest");
    fields(profile, ["siteUrl", "convexUrl", "callbackOrigin"]);
    const configured: ConnectedProfile = {
      siteUrl: string(profile.siteUrl),
      convexUrl: string(profile.convexUrl),
      callbackOrigin: string(profile.callbackOrigin),
    };
    session = new ConnectedSession(
      configured,
      params.storage === "platform"
        ? new PlatformCredentialVault(configured)
        : volatileVault,
    );
    return { protocol: 1 };
  }
  if (!session) throw new ConnectedError("signedOut");
  switch (method) {
    case "restore":
      fields(params, []);
      return session.restore();
    case "redeem":
      fields(params, ["code", "verifier", "origin"]);
      return session.redeem({
        code: string(params.code),
        verifier: string(params.verifier),
        origin: string(params.origin),
      });
    case "signOut":
      fields(params, []);
      await session.signOut();
      return null;
    case "request": {
      fields(params, ["leaseId", "operation", "arguments"]);
      const args = record(params.arguments);
      if (!args) throw new ConnectedError("invalidRequest");
      return session.request(
        string(params.leaseId),
        string(params.operation),
        args,
      );
    }
    default:
      throw new ConnectedError("invalidRequest");
  }
}
async function output(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(JSON.stringify(value) + "\n", (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
async function accept(line: Uint8Array): Promise<void> {
  let id: string | null = null;
  try {
    const message = record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)),
    );
    if (!message) throw new ConnectedError("invalidRequest");
    fields(message, ["v", "id", "method", "params"]);
    if (
      message.v !== 1 ||
      typeof message.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(message.id)
    )
      throw new ConnectedError("invalidRequest");
    id = message.id;
    const method = string(message.method),
      params = record(message.params);
    if (
      !params ||
      pending.has(id) ||
      (pending.size >= MAX_IN_FLIGHT && method !== "signOut")
    )
      throw new ConnectedError("invalidRequest");
    pending.add(id);
    try {
      const result = await dispatch(method, params);
      await output({ v: 1, id, ok: true, result });
    } finally {
      pending.delete(id);
    }
  } catch (error) {
    const safe =
      error instanceof ConnectedError
        ? error
        : new ConnectedError("unavailable");
    await output({
      v: 1,
      id,
      ok: false,
      error: { kind: safe.kind, message: safe.message },
    });
  }
}
async function run(): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const active = new Set<Promise<void>>();
  let fragments: Uint8Array[] = [],
    length = 0;
  function add(bytes: Uint8Array): void {
    length += bytes.byteLength;
    if (length > MAX_LINE_BYTES) throw new ConnectedError("invalidRequest");
    fragments.push(bytes);
  }
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      let start = 0;
      for (let index = 0; index < next.value.byteLength; index++) {
        if (next.value[index] !== 10) continue;
        add(next.value.subarray(start, index));
        const line = new Uint8Array(length);
        let offset = 0;
        for (const part of fragments) {
          line.set(part, offset);
          offset += part.byteLength;
        }
        fragments = [];
        length = 0;
        start = index + 1;
        const task = accept(line);
        active.add(task);
        void task.finally(() => active.delete(task)).catch(() => {});
      }
      add(next.value.subarray(start));
    }
    if (length) throw new ConnectedError("invalidRequest");
  } finally {
    // Closing the native host pipe invalidates every account-qualified request.
    session?.dispose();
    reader.releaseLock();
    await Promise.allSettled(active);
  }
}
if (process.argv[2] === "--version") {
  console.log("Twyne connected helper, protocol 1");
} else if (process.argv[2] === "--stdio-v1" && process.argv.length === 3) {
  try {
    await run();
  } catch {
    process.exitCode = 1;
  }
} else {
  process.exitCode = 2;
}
