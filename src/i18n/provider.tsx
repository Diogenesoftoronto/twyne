import {
  component$,
  createContextId,
  Slot,
  useContext,
  useContextProvider,
  useSignal,
  useVisibleTask$,
  type Signal,
} from "@qwik.dev/core";
import { GTProvider, useGT } from "gt-qwik";
import { setLocale } from "gt-qwik/runtime";
import dictionary from "./messages/en.json";
import french from "./catalogs/fr.json";
import es from "./catalogs/es.json";
import zh from "./catalogs/zh.json";
import hi from "./catalogs/hi.json";
import ja from "./catalogs/ja.json";
import {
  LANGUAGE_PREFERENCE_KEY,
  SUPPORTED_LOCALES,
  normalizeLanguagePreference,
  resolveAppLocale,
  type AppLocale,
  type LanguagePreference,
} from "./locale";

const LanguageContext = createContextId<Signal<LanguagePreference>>(
  "twyne.language-preference",
);
export const useLanguagePreference = () => useContext(LanguageContext);

export function persistLanguagePreference(preference: LanguagePreference) {
  document.documentElement.dataset.twyneLanguagePreference = preference;
  try {
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, preference);
  } catch {
    /* In-memory choice still works. */
  }
  try {
    document.cookie = `${LANGUAGE_PREFERENCE_KEY}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    /* Some embedded browsers disable cookies. */
  }
}

const LanguageSync = component$(() => {
  const state = useGT();
  const preference = useLanguagePreference();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      try {
        const stored = localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
        if (stored !== null)
          preference.value = normalizeLanguagePreference(stored);
      } catch {
        /* Retain the SSR/cookie preference when storage is unavailable. */
      }
      const sync = () => {
        document.documentElement.dataset.twyneLanguagePreference =
          preference.value;
        setLocale(
          state,
          resolveAppLocale(preference.value, navigator.languages),
        );
      };
      sync();
      window.addEventListener("languagechange", sync);
      cleanup(() => window.removeEventListener("languagechange", sync));
    },
    { strategy: "document-ready" },
  );
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track }) => {
      const locale = track(() => state.locale);
      document.documentElement.lang = locale;
      document.documentElement.dir = "ltr";
      document.body.lang = locale;
    },
    { strategy: "document-ready" },
  );
  return <Slot />;
});

export const AppI18nProvider = component$<{
  initialLocale: AppLocale;
  initialPreference: LanguagePreference;
}>((props) => {
  const preference = useSignal(props.initialPreference);
  useContextProvider(LanguageContext, preference);
  return (
    <GTProvider
      config={{
        defaultLocale: "en",
        locales: [...SUPPORTED_LOCALES],
        dictionary,
        catalogs: { fr: french, es, zh, hi, ja },
      }}
      initialLocale={props.initialLocale}
    >
      <LanguageSync>
        <Slot />
      </LanguageSync>
    </GTProvider>
  );
});
