type BrowserGlobalsLockState = {
  tail: Promise<void>;
};

const BROWSER_GLOBALS_LOCK_KEY = Symbol.for(
  "twyne.test.browser-globals-lock",
);

export async function lockBrowserGlobalsForTestFile(): Promise<() => void> {
  const g = globalThis as typeof globalThis & {
    [BROWSER_GLOBALS_LOCK_KEY]?: BrowserGlobalsLockState;
  };
  const state =
    g[BROWSER_GLOBALS_LOCK_KEY] ??
    (g[BROWSER_GLOBALS_LOCK_KEY] = { tail: Promise.resolve() });

  let release!: () => void;
  const previous = state.tail;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  return () => {
    release();
  };
}
