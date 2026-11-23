import { component$, Slot } from "@qwik.dev/core";
import { GTProvider, useGT } from "gt-qwik";
import dictionary from "../../i18n/landing/messages/en.json";
import fr from "../../i18n/landing/catalogs/fr.json";
import es from "../../i18n/landing/catalogs/es.json";
import zh from "../../i18n/landing/catalogs/zh.json";
import hi from "../../i18n/landing/catalogs/hi.json";
import ja from "../../i18n/landing/catalogs/ja.json";
import { SUPPORTED_LOCALES } from "../../i18n/locale";

const CATALOGS: Record<string, Record<string, string>> = { fr, es, zh, hi, ja };

/**
 * The landing page's copy lives in its own GT dictionary
 * (`src/i18n/landing/messages`) so the app-wide provider, which is serialized
 * on every page, does not carry it. This nested provider reads the locale the
 * app already resolved and hands the landing tree only that locale's catalog.
 *
 * Inside it, `useTranslate()` and `useGT()` resolve landing ids such as
 * `hero.h0`. If the app's locale changes after load, the key remounts the
 * provider with the new catalog.
 */
export const LandingI18n = component$(() => {
  const app = useGT();
  const locale = app.locale;
  const catalog = CATALOGS[locale];
  return (
    <GTProvider
      key={locale}
      config={{
        defaultLocale: "en",
        locales: [...SUPPORTED_LOCALES],
        dictionary,
        catalogs: catalog ? { [locale]: catalog } : {},
      }}
      initialLocale={locale}
    >
      <Slot />
    </GTProvider>
  );
});
