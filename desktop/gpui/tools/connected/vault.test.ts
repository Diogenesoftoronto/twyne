import { expect, test } from "bun:test";
import { PlatformCredentialVault, type CredentialCommand } from "./vault";
const profile = {
  siteUrl: "https://writer.convex.site",
  convexUrl: "https://writer.convex.cloud",
  callbackOrigin: "http://127.0.0.1:34115",
};

test("credential data travels only on stdin, bound to every configured origin", async () => {
  const calls: { args: string[]; stdin?: string }[] = [];
  const command: CredentialCommand = async (args, stdin) => {
    calls.push({ args, stdin });
    return { code: 0, stdout: "", stderr: "" };
  };
  const vault = new PlatformCredentialVault(profile, command, true);
  const secret =
    '{"better-auth.session_token":{"value":"synthetic-session","expires":null}}';
  expect(await vault.save(secret)).toBe(true);
  expect(calls[0].stdin).toBe(secret);
  expect(calls[0].args.join(" ")).not.toContain("synthetic-session");
  const other = new PlatformCredentialVault(
    { ...profile, callbackOrigin: "http://localhost:34115" },
    command,
    true,
  );
  await other.save(secret);
  expect(calls[0].args.at(-1)).not.toBe(calls[1].args.at(-1));
});
test("absent items are idempotent and service failures are redacted errors", async () => {
  let failed = false;
  const vault = new PlatformCredentialVault(
    profile,
    async () => ({
      code: 1,
      stdout: "",
      stderr: failed ? "fixture service error containing private data" : "",
    }),
    true,
  );
  expect(await vault.load()).toBeNull();
  await vault.clear();
  failed = true;
  await expect(vault.clear()).rejects.toMatchObject({ kind: "unavailable" });
  await expect(vault.load()).rejects.toThrow("Twyne could not connect");
});
test("an unsupported platform never writes a plaintext fallback", async () => {
  const vault = new PlatformCredentialVault(
    profile,
    async () => {
      throw new Error("Must not execute");
    },
    false,
  );
  expect(await vault.load()).toBeNull();
  expect(await vault.save("fixture-cookie")).toBe(false);
  await vault.clear();
});
