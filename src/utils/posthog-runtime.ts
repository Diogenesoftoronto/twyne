import type posthog from "posthog-js";

export type PostHogClient = typeof posthog;
export const POSTHOG_LOAD_TIMEOUT_MS = 1500;

/** An optional SDK must never reject app work or wait indefinitely to load. */
export function createPostHogRuntime(
  load: () => Promise<PostHogClient>,
  initialize: (client: PostHogClient) => void,
  timeoutMs = POSTHOG_LOAD_TIMEOUT_MS,
) {
  let client: PostHogClient | null = null;
  let pending: Promise<PostHogClient | null> | null = null;
  let disabled = false;

  const disable = () => {
    disabled = true;
    client = null;
  };

  const get = (): Promise<PostHogClient | null> => {
    if (disabled) return Promise.resolve(null);
    if (pending) return pending;

    pending = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        disable();
        resolve(null);
      }, timeoutMs);

      void Promise.resolve()
        .then(load)
        .then((loaded) => {
          if (disabled) return;
          initialize(loaded);
          client = loaded;
          resolve(loaded);
        })
        .catch(() => {
          disable();
          resolve(null);
        })
        .finally(() => clearTimeout(timeout));
    });

    return pending;
  };

  const run = (action: (client: PostHogClient) => void): void => {
    void get().then((loaded) => {
      if (!loaded || disabled) return;
      try {
        action(loaded);
      } catch {
        disable();
      }
    });
  };

  return { get, run, disable, peek: () => client };
}
