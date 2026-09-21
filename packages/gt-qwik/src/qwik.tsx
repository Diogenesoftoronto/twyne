import {
  $,
  Slot,
  component$,
  createContextId,
  useContext,
  useContextProvider,
  useStore,
} from "@qwik.dev/core";
import type { QRL } from "@qwik.dev/core";
import {
  createGTState,
  setLocale as runtimeSetLocale,
  translate as runtimeTranslate,
} from "./runtime";
import type { GTConfig, GTState, TranslationVariables } from "./types";

/**
 * Reactive Qwik-friendly wrapper around the runtime state. Only the
 * `locale` field is reactive; `defaultLocale`, `locales`, `dictionary` and
 * `catalogs` stay plain data so the whole object survives Qwik pause/resume.
 */
export interface GTProviderState extends GTState {
  /** Bumped whenever `setLocale` mutates the state, so consumers can `useTask$` on it. */
  revision: number;
}

export const GTContext = createContextId<GTProviderState>("gt-qwik.state");

/** Props for {@link GTProvider}. */
export interface GTProviderProps {
  config: GTConfig;
  initialLocale?: string;
}

/**
 * Qwik provider component. Wraps children in a context that exposes the
 * per-tree translation state. Renders nothing extra, so consumers can place
 * the provider as high (or as low) as they need.
 */
export const GTProvider = component$<GTProviderProps>((props) => {
  const state = useStore<GTProviderState>({
    ...createGTState(props.config, props.initialLocale),
    revision: 0,
  });
  useContextProvider(GTContext, state);
  return <Slot />;
});

/**
 * Read the provider state from the surrounding Qwik context. Throws if no
 * provider is present so consumers fail loudly during development rather
 * than silently rendering English fallbacks.
 */
export function useGT(): GTProviderState {
  const state = useContext(GTContext, undefined);
  if (!state) {
    throw new Error(
      "[gt-qwik] useGT() called outside <GTProvider>. Wrap your tree first.",
    );
  }
  return state;
}

/**
 * Synchronous render-only convenience. Do not capture this ordinary closure
 * in a QRL event handler: use translate(state, id, variables) there instead.
 */
export function useTranslate(): (
  id: string,
  variables?: TranslationVariables,
) => string {
  const state = useGT();
  return (id, variables) => runtimeTranslate(state, id, variables);
}

/**
 * QRL that mutates the provider's locale. Pass to event handlers like
 * `onClick$={() => setLocaleQrl(state, "fr")}`. The provider re-renders on
 * the next microtask via the reactive store.
 */
export const setLocaleQrl: QRL<
  (state: GTProviderState, locale: string) => void
> = $((state: GTProviderState, locale: string) => {
  runtimeSetLocale(state, locale);
  state.revision += 1;
});
