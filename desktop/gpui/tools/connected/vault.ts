import { createHash } from "node:crypto";
import {
  ConnectedError,
  type ConnectedProfile,
  type CredentialVault,
} from "./session";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type CredentialCommand = (
  args: string[],
  secret?: string,
) => Promise<CommandResult>;
async function boundedText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65_536) throw new ConnectedError("unavailable");
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function secretTool(
  args: string[],
  secret?: string,
): Promise<CommandResult> {
  const executable = Bun.which("secret-tool");
  if (!executable) throw new ConnectedError("unavailable");
  // Direct exec with argument arrays, no shell. The credential is supplied on
  // stdin, never argv, environment, a temporary file or an application log.
  const child = Bun.spawn([executable, ...args], {
    stdin: secret === undefined ? "ignore" : new Blob([secret]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      boundedText(child.stdout),
      boundedText(child.stderr),
      child.exited,
    ]);
    return { code, stdout, stderr };
  } catch {
    child.kill("SIGKILL");
    await child.exited;
    throw new ConnectedError("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

/** Linux Secret Service; other platforms remain explicitly session-only. */
export class PlatformCredentialVault implements CredentialVault {
  #attributes: string[];
  #command: CredentialCommand;
  #supported: boolean;
  constructor(
    profile: ConnectedProfile,
    command: CredentialCommand = secretTool,
    supported = process.platform === "linux" &&
      Boolean(Bun.which("secret-tool")),
  ) {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          profile.siteUrl,
          profile.convexUrl,
          profile.callbackOrigin,
        ]),
      )
      .digest("hex");
    this.#attributes = ["application", "twyne-gpui", "profile", key];
    this.#command = command;
    this.#supported = supported;
  }
  async load(): Promise<string | null> {
    if (!this.#supported) return null;
    const result = await this.#command(["lookup", ...this.#attributes]);
    // libsecret distinguishes an absent item (exit 1, no error text) from a
    // service/unlock failure (exit 1 with error text). Never surface stderr.
    if (result.code === 1 && !result.stderr) return null;
    if (result.code !== 0 || result.stderr)
      throw new ConnectedError("unavailable");
    return result.stdout || null;
  }
  async save(cookieJar: string): Promise<boolean> {
    if (!this.#supported) return false;
    if (!cookieJar || cookieJar.length > 65_536 || cookieJar.includes("\n"))
      throw new ConnectedError("invalidRequest");
    const result = await this.#command(
      ["store", "--label=Twyne", ...this.#attributes],
      cookieJar,
    );
    return result.code === 0 && !result.stderr;
  }
  async clear(): Promise<void> {
    if (!this.#supported) return;
    const result = await this.#command(["clear", ...this.#attributes]);
    if (
      (result.code === 0 && !result.stderr) ||
      (result.code === 1 && !result.stderr)
    )
      return;
    throw new ConnectedError("unavailable");
  }
}
