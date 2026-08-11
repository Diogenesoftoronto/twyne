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
