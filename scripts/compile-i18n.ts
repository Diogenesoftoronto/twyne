import { hash } from "gt-qwik/runtime";
import source from "../src/i18n/messages/en.json";
import { SUPPORTED_LOCALES } from "../src/i18n/locale";

// Compile readable translations to canonical GT ICU hashes, failing on gaps.
for (const locale of SUPPORTED_LOCALES.filter((locale) => locale !== "en")) {
  const translated = await Bun.file(
    new URL(`../src/i18n/messages/${locale}.json`, import.meta.url),
  ).json();
  const catalog: Record<string, string> = {};
  function compile(
    english: Record<string, unknown>,
    target: Record<string, unknown>,
    path = "",
  ) {
    for (const [id, value] of Object.entries(english)) {
      const key = path ? `${path}.${id}` : id;
      if (typeof value === "string") {
        if (typeof target[id] !== "string" || !target[id].trim())
          throw new Error(`Missing ${locale} translation: ${key}`);
        catalog[hash(value)] = target[id];
      } else if (value && typeof value === "object") {
        compile(
          value as Record<string, unknown>,
          (target[id] ?? {}) as Record<string, unknown>,
          key,
        );
      }
    }
  }
  compile(source, translated);
  await Bun.write(
    new URL(`../src/i18n/catalogs/${locale}.json`, import.meta.url),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  console.log(`Compiled ${Object.keys(catalog).length} ${locale} UI messages.`);
}
