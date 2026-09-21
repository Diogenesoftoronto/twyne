# Architecture

## State and Qwik serialization

`createGTState(config, initialLocale?)` creates a fresh object with its own active locale. Dictionary and catalog data are shared read-only configuration references; callers should not mutate them through one state and expect isolation from another. `setLocale` mutates only the supplied state's locale.

`GTProvider` wraps that data in Qwik's reactive `useStore` and provides it through `GTContext`. The state contains ordinary serializable data, without class instances or process-global active locale. Independent SSR trees can therefore choose different languages. Tests cover separate states and separate provider renders.

`useGT` returns the context. The module-level `translate(state, id, variables)` is safe to call in render code and QRL handlers that capture state. `useTranslate` returns an ordinary closure for render-only use; capturing that closure in a lazy handler is unsupported.

`setLocaleQrl` calls the same runtime setter and increments a revision field. Normal rendering tracks the store's locale directly, so Twyne's Settings handler uses the simpler module-level setter.

## GT compatibility

Only `src/gt-bridge.ts` imports `gt-i18n/internal`. Its `hash` helper passes the source message, ICU format and optional context/length metadata to `hashMessage`. The compatibility test calls the real installed GT CLI dictionary extractor and compares the resulting `metadata.hash`. The CLI itself computes a canonical source hash; this test proves agreement rather than assuming identical implementation.

The upstream internal API is version-sensitive. `gt-i18n` is pinned to 1.0.28; `@generaltranslation/format` is pinned to 0.1.9 for ICU formatting and locale helpers. Upgrade them with extractor and formatting tests.

Catalogs are `Record<string, string>` keyed by source hash. Dictionary leaves are strings or GT-style tuples carrying metadata; nested paths are resolved through own properties only. Missing translations use the source message and source locale's plural rules. Selected messages are returned unchanged if ICU formatting throws. They are never interpreted as raw HTML.

## Locale policy

The reusable package resolves requested locales against configured locales and falls back to the configured default. It exports direction and header-parsing helpers but does not read storage, mutate the document or render a language selector.

Twyne owns its policy: English source/fallback, French as the first translation, ordered browser preferences in Automatic mode, explicit Settings override, and cookie/localStorage persistence. Web browser language is the proxy for OS preferences.

## Build contract

`vite build --mode lib` selects the installed Qwik optimizer's library emission. The package configuration explicitly names Qwik entries `.qwik.mjs` and declares the `qwik` entry in package.json so the consumer optimizer processes their inline QRLs. Without those filenames, a package can build and render in development yet fail production resume.

Qwik and its subpaths remain external; the host supplies the framework runtime. `gt-qwik/runtime` contains no Qwik components. The host app generates its own manifest during its build. The library's generated manifest is not a replacement.

The package ships ESM and declarations. Other framework versions, CJS consumption, hosted runtime translation, UI controls and automatic persistence are outside the tested contract. It remains a private local package; see the release document for artifact verification and future naming decisions.
