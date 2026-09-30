/** Public account identity, kept separate from the private contact address. */
export interface AccountIdentity {
  name?: string | null;
  handle?: string | null;
  image?: string | null;
  email?: string | null;
}

export interface AccountProfile {
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
}

export function accountName(
  value: string | null | undefined,
): string | undefined {
  const name = value?.trim();
  // Old sessions may have an email in the name field. Never expose that as
  // a label, tooltip, accessible name, initial, or collaborator identity.
  if (!name || /\S+@\S+/.test(name) || name.startsWith("did:"))
    return undefined;
  return name;
}

export function accountAvatarUrl(
  value: string | null | undefined,
): string | undefined {
  const url = value?.trim();
  if (!url || /[\\\s]/.test(url)) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function accountDisplayName(
  user: AccountIdentity | null | undefined,
  profile?: AccountProfile | null,
): string {
  return (
    accountName(profile?.displayName) ||
    accountName(user?.name) ||
    accountName(profile?.handle) ||
    accountName(user?.handle) ||
    "Writer"
  );
}

export function accountInitials(name: string): string {
  const safeName = accountName(name);
  if (!safeName) return "W";
  const words = safeName.split(/\s+/);
  return (
    Array.from(words[0])[0] +
    (words.length > 1 ? Array.from(words[words.length - 1])[0] : "")
  ).toLocaleUpperCase();
}

/** Merge only authenticated profile fields; email stays available privately. */
export function withAccountProfile<T extends AccountIdentity>(
  user: T,
  profile: AccountProfile | null,
): T & { name: string; image: string | undefined; handle: string | undefined } {
  return {
    ...user,
    name: accountDisplayName(user, profile),
    image: accountAvatarUrl(profile?.avatarUrl) || accountAvatarUrl(user.image),
    handle: accountName(profile?.handle) || accountName(user.handle),
  };
}
