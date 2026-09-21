# gt-qwik

Unofficial General Translation adapter for Qwik 2: per-provider locale state, GT-compatible message hashes, and ICU interpolation from bundled catalogs.

## Local use

This is a **private local workspace package**, not the public npm placeholder with the same name. Twyne declares `"gt-qwik": "workspace:*"`. From the repository root:

```sh
bun install
bun run i18n:prepare
```

For a separate local project, build this package, run `npm pack --ignore-scripts`, and install that tarball. Do not use `bun add gt-qwik` from the public registry to obtain this implementation.

Supported versions: `@qwik.dev/core@2.0.0-beta.42` (peer), `gt-i18n@1.0.28`, and `@generaltranslation/format@0.1.9`. Qwik 1 and other Qwik 2 betas have not been validated.

## Provider and rendering

```tsx
import { component$ } from "@qwik.dev/core";
import { GTProvider, useGT } from "gt-qwik";
import { hash, translate } from "gt-qwik/runtime";

const config = {
  defaultLocale: "en",
  locales: ["en", "fr"],
  dictionary: { settings: { title: "Settings" } },
  catalogs: { fr: { [hash("Settings")]: "Paramètres" } },
};

const SettingsPanel = component$(() => {
  const state = useGT();
  return <h1>{translate(state, "settings.title")}</h1>;
});

export const App = component$<{ initialLocale: string }>((props) => (
  <GTProvider config={config} initialLocale={props.initialLocale}>
    <SettingsPanel />
  </GTProvider>
));
```

Provide `initialLocale="en"` for English or `"fr"` for French. For SSR, resolve the locale from the request/persisted preference and pass it to the root component:

```tsx
import {
  renderToStream,
  type RenderToStreamOptions,
} from "@qwik.dev/core/server";
import { App } from "./app";

export function render(opts: RenderToStreamOptions, locale: string) {
  return renderToStream(<App initialLocale={locale} />, opts);
}
```

Use the host application's normal Qwik Vite/SSR setup. Its build generates the client manifest; do not load the library's manifest into the app.

## Locale changes

Inside a component under the provider, capture the serializable state and call the module-level function from a handler:

```tsx
import { component$ } from "@qwik.dev/core";
import { useGT } from "gt-qwik";
import { setLocale } from "gt-qwik/runtime";

export const FrenchButton = component$(() => {
  const state = useGT();
  return <button onClick$={() => setLocale(state, "fr")}>Français</button>;
});
```

The library does not render controls or persist the choice. Twyne places its Automatic / English / Français control in Settings.

`useTranslate()` is a render-only convenience returning a regular function. Do not capture it in QRL handlers; capture `useGT()` state and call `translate(state, id, variables)` instead. `setLocaleQrl(state, locale)` is also available as a prebuilt QRL.

## API

| Export                                                           | Entry                     | Purpose                                        |
| ---------------------------------------------------------------- | ------------------------- | ---------------------------------------------- |
| `GTProvider`, `useGT`, `GTContext`                               | `gt-qwik`                 | Reactive per-tree Qwik context                 |
| `useTranslate`                                                   | `gt-qwik`                 | Synchronous render-only translation closure    |
| `setLocaleQrl`                                                   | `gt-qwik`                 | QRL locale setter                              |
| `createGTState`, `translate`, `setLocale`, `hash`                | `gt-qwik/runtime` or root | Plain-data runtime and canonical source hashes |
| `resolveLocale`, `parseAcceptLanguage`, `direction`, `readEntry` | `gt-qwik`                 | Locale and dictionary helpers                  |
| `GTConfig`, `GTState`, dictionary/catalog types                  | `gt-qwik`                 | TypeScript contracts                           |

Source dictionary leaves can be strings, `[string]`, or `[string, { $context?, $maxChars? }]`. Nested IDs use dot notation. Unknown IDs throw; absent catalog entries fall back to the source language. Malformed or uninterpolatable ICU currently returns the selected message unchanged. Translations remain text, never injected HTML.

## Verification and commands

From this package directory:

```sh
bun run check
bun run test   # builds first, then runs tests with the Qwik preload
bun run build
```

The package suite covers runtime behavior, actual GT extractor hashes and SSR. Twyne separately passed a production browser smoke for language detection, reactive Settings switching and persistence. This is evidence for the pinned integration, not a guarantee across frameworks or versions. No GT cloud translation, publication or deployment was performed.

- [Architecture](docs/architecture.md)
- [Translation workflow](docs/translation-workflow.md)
- [Local packaging and future release](docs/releasing.md)

MIT — see [LICENSE](LICENSE).
