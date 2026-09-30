# The House and the fluid desk

The manuscript remains the centre of the workspace. Comments, editorial notes,
sources, books, records and connections to past writing share its margins. The
existing side panels remain available for deliberate browsing.

## Names and inheritance

| Name       | Meaning                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| House      | The writer's reusable defaults and standards.                                                                             |
| Collection | A series of folios sharing context. A folio belongs to at most one collection.                                            |
| Folio      | One piece of writing, with its own dossier.                                                                               |
| Dossier    | Audience, purpose, form, tone, constraints and supporting material for a piece. `ProjectBrief` is the internal type name. |
| Charter    | Required or preferred standards, scoped to the House, collection or folio.                                                |
| Edition    | A saved version of the dossier.                                                                                           |
| Amendment  | A proposed change prompted by the draft, applied only when the writer files it.                                           |
| Register   | The history of context changes and their provenance.                                                                      |

Nonempty folio fields override collection fields, which override House fields.
Working titles belong only to folios. Legacy interview stand-ins yield to shared
context; blank fields inherit. Charters accumulate across all applicable scopes.
A later manual edit supersedes an earlier amendment's provenance.

`/house/` exposes the cabinet, the register and developer diagnostics. Links from
the Library, the folio menu and dossier refinement keep the active folio in view.
The context preview shows inherited fields and standards; individual tools add
their own instructions, excerpts and source material. Token counts are estimates.

`loadModelBriefForFolio` creates a read-only effective dossier for review, research,
the editorial room and contextual tools. It never saves inherited values into the
folio. Editing, export and edition history continue to use the original dossier.
House changes refresh active model context; applying an amendment refreshes the
saved dossier too.

## Interaction contract

- Hovering or focusing a passage marker reveals its associated margin card and
  connections. Clicking a comment or persona note unfolds its full conversation
  in that margin slot. Suggestions use the same placement service.
- One conversation owns the foreground at a time. Switching preserves separate
  unsent reply drafts for the mounted editor session; reloading does not preserve
  those unsent drafts. Sent replies retain the existing storage behavior.
- On narrow screens or with automatic margin reading disabled, the existing
  anchored card provides the fallback. Ambient dock cards yield to open threads,
  tools and selection actions. Open margin cards adapt to viewport changes.
- Cards follow document scrolling and step around tools and expanded threads.
  Escape closes the active conversation. Selection actions yield while a thread
  or suggestion is open.
- Manual focus remains available. Automatic focus fades workspace chrome without
  collapsing the writer's side panels. Interacting with controls or a conversation
  prevents automatic focus from hiding them. A manual exit overrides automatic
  focus temporarily.

`flow-state.ts` reads typing cadence; `flow-profile.ts` learns pause thresholds and
item preferences locally. Working shows a small selection, settling holds new
items, flow clears ambient cards, and stuck favors one relevant item plus its
connections. `flow-conductor.ts` combines these signals with budgeted Jev calls.
Local connections are candidates, not claims of semantic certainty. Drift checks
propose amendments rather than silently rewriting the dossier.

Cover lookups can be disabled in review controls. Book titles go to Open Library;
record titles go to MusicBrainz and covers come from the Cover Art Archive.
Cadence profiles stay on this device. Diagnostics may contain draft excerpts,
titles, dossier changes and model decisions: inspect an export before sharing it.

## Storage and sync

`house-store.ts` serializes local edits, verifies IndexedDB writes and emits
`twyne:house-changed`. Each edit advances the whole snapshot's timestamp, including
collection membership changes and withdrawals. House state sync runs on both the
House page and the editor, with a live Convex subscription and reconnect refresh.

House, collections and charter use the newer complete snapshot; this is
last-write-wins, not a per-field collaborative merge. Ledger entries are unioned
by ID. A stale server upload may contribute history but cannot replace a newer
snapshot. Local history retains 500 entries; server history is paginated. Signed-out
writing remains local. The current local House is shared within the browser profile,
as with the existing local folio store.

The margin handshake lives in `margin-surface.ts`: a card reserves a slot before
the editor mounts its full conversation, then receives geometry updates. Pending
reservations survive the old card closing. Editor request tokens prevent slower
opens from replacing a more recently selected conversation.

## Verification

Focused tests cover inheritance, provenance, quiet-mode surfacing, focus overrides,
card collision placement, snapshot deletion semantics, account isolation and stale
uploads. Browser checks exercise the House cabinet and tabs, comment/note/suggestion
switching, separate reply drafts, Escape, scrolling and mobile resizing. A live
authenticated two-device sync and funded model-generation session remain separate
integration checks; local browser fixtures and mocked backend tests do not prove them.
