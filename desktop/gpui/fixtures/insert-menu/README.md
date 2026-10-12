# In-document insertion

`src/insert_menu/` is independent of the writing-room host. Source's 17 editable,
collapsed-selection commands supply the catalog, descriptions, grouping, search
terms and keywords. Native adds `insert.link` at the user's request. The differential
filter check compares the Source subset separately from that addition.

Regenerate or check these fixtures by running the actual original registry:

```bash
rtk proxy bun desktop/gpui/tools/sync-insert-menu.ts --check
rtk proxy bun desktop/gpui/tools/sync-insert-menu.ts
```

`source-receipt.json` records the initial snapshot's input hashes. Regeneration
does not rewrite that historical receipt. Later capture/build receipts record
their own inputs.

`capture-source.ts` drives the real web editor in an isolated browser and IDB
library. It records the menu's actual fonts, bounds and styles and exercises
filtering, arrows, Escape and heading insertion. It waits for Source's asynchronous
command completion before typing the heading's content.

```bash
rtk proxy bun desktop/gpui/fixtures/insert-menu/capture-source.ts /tmp/new-source-insert-capture
```

The local Vite reference must already be running on `127.0.0.1:5207` (override
`TWYNE_INSERT_SOURCE_URL` with another loopback origin). This is browser evidence,
not Electrobun-host or real-account evidence.

Native `tools/capture-native.py` accepts `slash`, `slash-filtered`, and `slash-form`.
Use a synthetic `.twyne`/HTML fixture whose final paragraph ends with `/` or
`/table`. Capture mode only places the caret and opens the menu; it does not
insert a diagnostic slash into the user's writing. Run with an immutable build
and isolated library.

Markdown and rich adapters apply the query removal and insertion as one undoable
edit. Native parameter forms leave the query untouched until commit, including
when cancelled; Source removes its query before opening a parameter dialog.
Native also clamps the popup to the visible window. Exact parameter-dialog styling
and Source shortcut hints remain comparison work.

`native-acceptance.json` records the October 5 immutable build, fixture/source
hashes, actual native title/menu/form captures, and the passing 115-test desktop
suite. Artifact paths point to local verification output. These checks establish
the recorded local interactions and pixels, not full desktop parity or live sync.

Sakana's bounded catalog/filter/Markdown/review outputs are retained under
`advisory-*`. Each has a root adoption review. Only the fuzzy scorer was adopted
as model-produced code; its results are checked against 21 actual Source queries.
