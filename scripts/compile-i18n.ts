import { hash } from "gt-qwik/runtime";
import { SUPPORTED_LOCALES } from "../src/i18n/locale";

/**
 * Each catalog set is one English source dictionary plus its translations,
 * compiled to canonical GT ICU hashes. The app set is serialized on every
 * page; the landing set is kept separate so only the public landing page
 * carries its (much larger) copy.
 */
const CATALOG_SETS = [
  {
    name: "UI",
    messages: "../src/i18n/messages",
    catalogs: "../src/i18n/catalogs",
  },
  {
    name: "landing",
    messages: "../src/i18n/landing/messages",
    catalogs: "../src/i18n/landing/catalogs",
  },
] as const;

// Compile readable translations to canonical GT ICU hashes, failing on gaps.
for (const set of CATALOG_SETS) {
  const source = await Bun.file(
    new URL(`${set.messages}/en.json`, import.meta.url),
  ).json();
  for (const locale of SUPPORTED_LOCALES.filter((locale) => locale !== "en")) {
    const translated = await Bun.file(
      new URL(`${set.messages}/${locale}.json`, import.meta.url),
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
            throw new Error(
              `Missing ${locale} ${set.name} translation: ${key}`,
            );
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
      new URL(`${set.catalogs}/${locale}.json`, import.meta.url),
      JSON.stringify(catalog, null, 2) + "\n",
    );
    console.log(
      `Compiled ${Object.keys(catalog).length} ${locale} ${set.name} messages.`,
    );
  }
}
