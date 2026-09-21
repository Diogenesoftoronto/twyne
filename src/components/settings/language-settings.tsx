import { component$ } from "@qwik.dev/core";
import { useGT } from "gt-qwik";
import { setLocale, translate } from "gt-qwik/runtime";
import { SiteSelect } from "../ui/site-select";
import {
  useLanguagePreference,
  persistLanguagePreference,
} from "../../i18n/provider";
import {
  normalizeLanguagePreference,
  resolveAppLocale,
} from "../../i18n/locale";

export const LanguageSettings = component$(() => {
  const state = useGT();
  const preference = useLanguagePreference();
  return (
    <section class="folio p-5" aria-labelledby="language-heading">
      <h2
        id="language-heading"
        class="text-base font-semibold"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {translate(state, "language.title")}
      </h2>
      <p class="text-xs text-[var(--color-ink-light)] mt-1 max-w-2xl">
        {translate(state, "language.description")}
      </p>
      <div class="mt-4 max-w-sm">
        <SiteSelect
          value={preference.value}
          ariaLabel={translate(state, "language.title")}
          options={[
            { value: "auto", label: translate(state, "language.automatic") },
            { value: "en", label: "English" },
            { value: "fr", label: "Français" },
            { value: "es", label: "Español" },
            { value: "zh", label: "简体中文" },
            { value: "hi", label: "हिन्दी" },
            { value: "ja", label: "日本語" },
          ]}
          onChange$={(value) => {
            const next = normalizeLanguagePreference(value);
            preference.value = next;
            persistLanguagePreference(next);
            setLocale(state, resolveAppLocale(next, navigator.languages));
          }}
        />
      </div>
      {state.locale !== "en" && (
        <p class="text-xs text-[var(--color-ink-muted)] mt-3">
          {translate(state, "language.partial")}
        </p>
      )}
    </section>
  );
});
