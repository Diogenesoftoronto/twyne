/**
 * Not Organic sign-in — the only way into a Twyne account.
 *
 * The browser runs PKCE against `id.notorganic.info` and posts the returned
 * code + verifier here. The code is redeemed server-side (no gateway CORS, no
 * caller-supplied DID), the verified DID is mapped to a Better Auth user via a
 * `notorganic` account row, and a normal Better Auth session is issued so every
 * Convex query keeps authenticating the way it always has.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

export const NOTORGANIC_PROVIDER_ID = "notorganic";
export const NOTORGANIC_SIGN_IN_PATH = "/auth/notorganic/";

export interface VerifiedNotOrganicAccount {
  did: string;
  sessionVersion: number;
  handle?: string;
}

/**
 * Better Auth requires a unique email. Not Organic accounts don't hand one
 * over, so the user row carries an undeliverable, DID-derived placeholder.
 */
export async function placeholderEmailForDid(did: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(did),
  );
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex}@notorganic.invalid`;
}

export function notOrganicSignIn(options: {
  redeem: (input: {
    code: string;
    verifier: string;
    /** The browser origin that started PKCE; it is the gateway client_id. */
    origin: string;
  }) => Promise<VerifiedNotOrganicAccount>;
  /** Persist the DID ↔ user link used for wallet, inference and entitlement. */
  onSignedIn: (
    input: VerifiedNotOrganicAccount & { userId: string },
  ) => Promise<void>;
}) {
  return {
    id: "notorganic-sign-in",
    endpoints: {
      signInNotOrganic: createAuthEndpoint(
        "/sign-in/notorganic",
        {
          method: "POST",
          body: z.object({
            code: z.string().min(1).max(2048),
            verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
            origin: z.string().url().max(256),
          }),
        },
        async (ctx) => {
          let verified: VerifiedNotOrganicAccount;
          try {
            verified = await options.redeem({
              ...ctx.body,
              origin: new URL(ctx.body.origin).origin,
            });
          } catch (error) {
            throw new APIError("UNAUTHORIZED", {
              message:
                error instanceof Error
                  ? error.message
                  : "Not Organic could not verify this sign-in.",
            });
          }
          const adapter = ctx.context.internalAdapter;
          const name = verified.handle ?? verified.did;
          const account = await adapter.findAccountByProviderId(
            verified.did,
            NOTORGANIC_PROVIDER_ID,
          );
          let user = account ? await adapter.findUserById(account.userId) : null;
          if (!user) {
            user = await adapter.createUser({
              email: await placeholderEmailForDid(verified.did),
              name,
              emailVerified: false,
            });
            if (account) {
              await adapter.updateAccount(account.id, { userId: user.id });
            } else {
              await adapter.linkAccount({
                accountId: verified.did,
                providerId: NOTORGANIC_PROVIDER_ID,
                userId: user.id,
              });
            }
          } else if (verified.handle && user.name !== verified.handle) {
            user = await adapter.updateUser(user.id, { name: verified.handle });
          }
          await options.onSignedIn({ ...verified, userId: user.id });
          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            user: { id: user.id, name: user.name, did: verified.did },
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
