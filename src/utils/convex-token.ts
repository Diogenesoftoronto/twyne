/** Honor Convex's refresh requests rather than returning an expired bootstrap token. */
export function createConvexTokenFetcher(
  load: () => Promise<string | null>,
  isCurrent: () => boolean,
) {
  let cached: string | null = null;
  let pending: Promise<string | null> | null = null;
  return async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (!isCurrent()) return null;
    if (cached && !forceRefreshToken) return cached;
    if (!pending) {
      pending = load()
        .then((token) => {
          cached = isCurrent() ? token : null;
          return cached;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}
