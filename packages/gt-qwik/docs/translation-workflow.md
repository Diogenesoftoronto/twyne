# Translation workflow

The adapter renders checked-in catalogs. It never calls a translation service. Twyne uses GT's JSON-file workflow, then compiles readable translations to source-message hashes.

## Source and translated files

Use nested strings for this JSON-file workflow:

```json
{ "settings": { "title": "Settings", "welcome": "Hello, {name}!" } }
```

Save that as `src/i18n/messages/en.json`, and matching French strings as `fr.json`:

```json
{ "settings": { "title": "Paramètres", "welcome": "Bonjour, {name} !" } }
```

The runtime also supports `[message, metadata]` dictionary tuples. Those are tested against GT's dictionary extractor, a different path from generic JSON-file translation. Do not assume the generic JSON translator preserves tuple metadata as translator instructions.

## GT CLI configuration

```json
{
  "defaultLocale": "en",
  "locales": ["en", "fr"],
  "files": { "json": { "include": ["src/i18n/messages/[locale].json"] } }
}
```

The installed CLI (2.21.3) does not detect this Qwik adapter for inline extraction. From Twyne's root, `bun run i18n:check` runs `gt translate --dry-run`: it finds the English JSON without uploading it. This checks discovery, not translation quality or complete ICU validity.

With a GT project and `GT_PROJECT_ID` / `GT_API_KEY` configured in the CLI environment, use `bun run i18n:translate`. Translation may incur charges. Keep credentials out of tracked files and client code. `gt download` retrieves translations when using a staged workflow. The cloud translate/download flow has not been exercised in this integration.

## Compile readable translations

GT's JSON output is keyed by dictionary path. The runtime catalog is keyed by the hash of the **English source**, not the French text. Twyne's `scripts/compile-i18n.ts` walks matching source/target objects and performs this transformation:

```ts
import { hash } from "gt-qwik/runtime";

const catalog = {
  [hash("Settings")]: "Paramètres",
  [hash("Hello, {name}!")]: "Bonjour, {name} !",
};
```

Run `bun run i18n:compile` after changing locale JSON. Commit the source, translated file and compiled catalog together. Twyne's builds prepare the local package and compile catalogs automatically.

Pass the English dictionary plus `{ fr: catalog }` to `GTProvider`. Missing translations use the English source and its ICU formatting rules.

## Evidence and boundaries

The initial nine French Twyne messages were authored locally. They are not output from a verified GT cloud run. The package's extractor test independently calls the installed CLI's internal `createDictionaryUpdates(filepath, errors, warnings)` against a temporary dictionary and checks `metadata.hash` against the runtime. That test is pinned to the installed CLI version; its internal import is not a public integration API for consumers.
