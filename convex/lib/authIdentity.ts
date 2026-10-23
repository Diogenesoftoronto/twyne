/**
 * Match Convex's canonical `UserIdentity.tokenIdentifier` representation for
 * a JWT issuer and subject. The issuer must be kept byte-for-byte identical to
 * the auth provider configuration, including any intentional trailing slash.
 */
export function tokenIdentifierFromIssuerAndSubject(
  issuer: string | undefined,
  subject: string | undefined,
): string | null {
  return issuer && subject ? `${issuer}|${subject}` : null;
}

/**
 * The inverse of {@link tokenIdentifierFromIssuerAndSubject}: recover the
 * subject from a stored `tokenIdentifier`. Issuers are URLs and never contain
 * `|`, so the split happens at the first one; a value without a separator is
 * returned whole, which matches how `identity.subject || identity.tokenIdentifier`
 * degrades elsewhere.
 */
export function subjectFromTokenIdentifier(tokenIdentifier: string): string {
  const separator = tokenIdentifier.indexOf("|");
  return separator >= 0
    ? tokenIdentifier.slice(separator + 1) || tokenIdentifier
    : tokenIdentifier;
}

/**
 * Who a hosted call is for.
 *
 * The browser actions used to read this from `ctx.auth` wherever they needed
 * it — the sign-in gate, the rate-limit key, the Not Organic link lookup, the
 * usage ledger. The integration API authenticates with a personal access
 * token instead, so an httpAction calling in has no Convex identity at all.
 * Every feature's core therefore takes the caller explicitly: the public
 * actions resolve it from `ctx.auth`, the internal ones from the token's
 * owner. `tokenIdentifier` keys rate limits and usage; `subject` is the product
 * subject a Not Organic link is stored under.
 */
export interface HostedCaller {
  tokenIdentifier: string;
  subject: string;
}

export function callerFromIdentity(identity: {
  tokenIdentifier: string;
  subject?: string;
}): HostedCaller {
  return {
    tokenIdentifier: identity.tokenIdentifier,
    subject: identity.subject || identity.tokenIdentifier,
  };
}

/** A token owner is stored as `${issuer}|${subject}`; see above. */
export function callerFromTokenIdentifier(
  tokenIdentifier: string,
): HostedCaller {
  return {
    tokenIdentifier,
    subject: subjectFromTokenIdentifier(tokenIdentifier),
  };
}
