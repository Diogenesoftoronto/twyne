# eslint-plugin-qwik-guards

Shared ESLint guardrails for Qwik projects. The rules cover an empty-list
reconciliation path and plain-function JSX form wrappers, both of which have
caused fields to be replaced and lose focus in Twyne.

The empty-array runtime failure was reproduced on **Qwik 2.0.0-rc.4**. The form
wrapper rule covers a historical **Qwik 2 beta.42** failure, checked against the
actual source before and after its fix; that older runtime was not rerun during
plugin verification. Enable this preset deliberately in affected projects. It
does not detect your installed Qwik version or establish behavior on other
versions. It complements
`eslint-plugin-qwik` and does not replace it.

## Install in another project

Registry installation:

```sh
npm install --save-dev eslint-plugin-qwik-guards
```

The package is build-free ESM, has no runtime dependencies, and expects ESLint 9 and
Node 20.19 or newer. TypeScript projects keep their existing TypeScript ESLint
parser configuration.

To share a checkout or prerelease without a registry, produce a portable archive
from this package directory:

```sh
npm pack --pack-destination /tmp
```

In the target project:

```sh
npm install --save-dev /tmp/eslint-plugin-qwik-guards-0.1.0.tgz
```

Add the preset to the project's existing flat ESLint config, after its parser
configuration. Restrict `files` to the project's Qwik source roots if it contains
other frameworks:

```js
import qwikGuards from "eslint-plugin-qwik-guards";

export default [
  // Existing ESLint, Qwik, and TypeScript configurations go here.
  {
    ...qwikGuards.configs.recommended,
    files: ["src/**/*.{jsx,tsx}"],
  },
];
```

The preset enables `qwik-guards/no-empty-array-before-sibling` and
`qwik-guards/no-plain-jsx-form-wrapper` at `warn` severity.
To block merges after existing sites have been reviewed, override the rules to
`error` in a later config entry, or use ESLint's `--max-warnings 0` policy.

## Empty arrays before siblings

```tsx
// Warning: when this list is empty, the following dialog can be recreated.
<div>
  {items.filter(matches).map(renderItem)}
  <dialog key="stable">...</dialog>
</div>;

// Guard the actual rendered list, including any filtering.
const cards = items.filter(matches).map(renderItem);
<div>
  {cards.length > 0 ? cards : null}
  <dialog key="stable">...</dialog>
</div>;
```

It recognizes array-specific methods such as `map`, `filter`, and `flatMap`,
`Array.from`, empty array literals, spread-only array literals, and simple `const`
aliases. It follows conditional expressions and recognizes common nonempty-length
guards. A guard on the original array does not make a filtered result nonempty.

Terminal lists, comments, attribute values, recognized length guards, and visibly
nonempty inline literals do not trigger a warning. An element around the list
also gives it its own parent boundary. The rule has no automatic fix: adding a
wrapper can affect layout, and guards must apply to the correct result.

This is syntax-based analysis. It does not trace arbitrary helper returns,
parameters, store properties, or mutations across a program, and it deliberately
does not infer arrays from string-compatible methods such as `slice` and `concat`.
A clean lint result does not prove that every input retains focus.

## Plain-function JSX form wrappers

`qwik-guards/no-plain-jsx-form-wrapper` warns when a plain function is rendered
as a JSX component around editable content:

```tsx
const Folio = (props) => <main>{props.leaf}</main>;

// Warning: the brief's historical failure used this layout boundary.
<Folio leaf={<input value={answer} />} />;

// For a hook-free layout, render directly in the caller's reactive tree.
Folio({ leaf: <input value={answer} /> });
```

The rule recognizes local functions and aliases. With typed parser services
(`typescript-eslint`'s `projectService: true` or `project` configuration), it also
resolves imported functions such as Twyne's `DossierFolio`. Without type
information, imported wrappers are not checked. The plugin does not load a
TypeScript compiler itself or change your parser's project configuration.

The warning is limited to native input, textarea, select, or contenteditable
subtrees visible at the call site or in the resolved function body. It leaves
icons, read-only layouts, and `component$` boundaries quiet. It does not trace
every custom field component or JSX-valued variable. Calling a hook-bearing
component directly is unsafe; a stable `component$` boundary is an alternative,
but changing a layout to use projection requires checking prop reactivity.

## Historical regression coverage

- **Expanded persona note, 2026-11-05:** an empty streaming-card list before a
  keyed dialog caused dialog/textarea replacement during typing. Before/after
  fixtures verify the empty-array warning and its final-list length guard.
- **Brief answer grading, commit `633726a23d137ee3ef666d0c831706147557b9a2`:**
  asynchronous strength results replaced the active field under
  `<DossierFolio leaf={...} />`. The new rule warns on the original source at
  `633726a2^` and accepts the direct `DossierFolio({...})` call in `633726a2`.
  Reduced fixtures retain the imported function and editable JSX-valued prop.
- **Sync-triggered editor reloads, commit `7f644cce`:** these arose from sync
  event/data flow, not either JSX shape. This plugin does not claim to detect
  them. Twyne's `e2e/sync-multi-tab.e2e.ts` checks remount counts, and its
  `src/utils/convex-sync.test.ts` covers the sync behavior. The brief also retains
  DOM identity, caret, and delayed-result tests in `e2e/brief-signin.e2e.ts`.

The fixture tests are self-contained and do not require the Twyne Git history.
Fixture comments record which parts are reduced from a committed fix and which
are proposed workarounds. These checks prove lint detection, not browser behavior.

## Verify and maintain

```sh
npm test
```

The Node test suite covers unsafe list shapes, safe guards, aliases, TSX,
stable-key regressions, the public preset, and an offline tarball installation in
a separate consumer directory. Imported-wrapper regression fixtures use typed
parser services. The packed consumer uses the host's ESLint peer
through a symlink; the plugin itself is installed from the archive with no links
back to this checkout. ESLint 9.32.0 is the currently tested peer version.
The archive smoke test runs through this package's explicit test command;
Twyne's regular Bun suite runs the rule, preset, and application integration
tests without requiring Node/npm subprocesses.

Before removing this guard after a Qwik upgrade, check the browser behavior:

1. Render an empty mapped list before an open dialog containing a controlled
   textarea. Retain references to both DOM nodes.
2. Type several characters with real keyboard events, allowing reactive updates
   between characters.
3. Verify that both DOM identities are unchanged and that the textarea remains
   `document.activeElement` after every character.
4. Repeat through the affected application's full expanded-note reply flow.
5. For the form-wrapper guard, repeat with a plain-function JSX wrapper around
   the field and an asynchronous prop update, then with its corrected boundary.

Rule tests check detection; these DOM identity and focus assertions check the
runtime regression. Twyne also keeps a separate integration test confirming that
its ESLint config warns on the original persona-note pattern and accepts the
guarded version, without requiring the bug to remain in application code.
