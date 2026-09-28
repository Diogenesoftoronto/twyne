# Not Organic–native sign-in and data

Status: implemented 2026-09-23. Creem, email OTP, passkeys and Bluesky-as-identity are removed.

Twyne now works the way Keating does: one Not Organic account (a DID, usually on `pds.notorganic.info`) is the
writer's identity. Their wallet, plan, inference and synced data all hang off that account.

## How sign-in works

1. **Browser** (`src/utils/notorganic-connect.ts`, `startNotOrganicSignIn`): PKCE against
   `id.notorganic.info/authorize`.
   - `client_id` = the page origin.
   - `redirect_uri` = `${origin}/auth/notorganic/`.
   - `scope` = `wallet:read`, `product` = `twyne`.
   - The attempt (state, verifier, returnTo) lives in sessionStorage.
2. **Callback page** (`src/routes/auth/notorganic/`): posts `{code, verifier, origin}` to the Better Auth
   endpoint `POST /api/auth/sign-in/notorganic`.
3. **Server** (`convex/lib/notorganicSignIn.ts`, wired in `convex/auth.ts`):
   - checks that `origin` is in `trustedOrigins`;
   - redeems the code server-side (`redeemProviderLink`), so there is no gateway CORS and no caller-supplied
     DID.
4. **Mapping the DID to a user:** the verified DID becomes a Better Auth `account` row with
   `providerId: "notorganic"`, `accountId: <did>`.
   - New users get a user row with an undeliverable placeholder email: `<sha256(did)[:16]>@notorganic.invalid`.
     The UI hides it.
   - The display name is the Not Organic handle, refreshed on each sign-in.
5. **Session and DID link:** `onSignedIn` writes the `providerIdentities` link (`saveVerifiedLink`), and a normal
   Better Auth session is issued (crossDomain cookie). Convex auth is unchanged:
   - `identity.subject` = Better Auth user id;
   - `tokenIdentifier` = `${CONVEX_SITE_URL}|${userId}`.

Server-side wallet/inference calls still use the product-assertion exchange keyed by the linked DID
(`convex/lib/notorganic.ts`).

## Entitlement

`convex/lib/entitlement.ts` `userIsPro` reads the Not Organic wallet and applies `hasCurrentTwynePlan`
(`src/utils/subscription-plan.ts`). The pricing page reads the same wallet. There is no local subscriptions
table.

## ATProto / Bluesky

ATProto is a **publishing connection**, not an identity:

- The Share dialog's "Your own repo" section has a handle field and a "Connect PDS" button that start ATProto
  OAuth.
- `/auth/callback/` restores that publishing session (`auth.value.atproto`).
- `auth.value.provider` is always `"convex"`.

## Legacy accounts

Email/passkey accounts were deprecated with no migration path; nobody held a Creem subscription. The tooling is
in `convex/legacyAccounts.ts` (all functions internal):

```sh
npx convex run legacyAccounts:sendDeprecationNotices '{"dryRun":true}'
npx convex run legacyAccounts:sendDeprecationNotices '{"dryRun":false}'
npx convex run legacyAccounts:retireLegacyAccounts '{"dryRun":true}'
npx convex run legacyAccounts:retireLegacyAccounts '{"dryRun":false}'
```

- Add `--prod` to target production.
- Notices are recorded in `legacyAccountNotices`, so re-running never emails anyone twice.
- Retirement reuses the account-deletion job (`scheduleAccountDeletion`), which purges synced data and the
  Better Auth user.

## Open items

- The gateway maps `https://twyne.love` as a public client for product `twyne`. `www.twyne.love` and the desktop
  loopback origin need their own registration, otherwise sign-in from them is rejected at `/authorize`.
- Optional, as in Keating: encrypt synced folio content with `/v1/sync/account-key` so the server holds
  ciphertext.
- PDS publishing on `pds.notorganic.info` depends on the scope fallback noted in `publishing-from-twyne.md`.
