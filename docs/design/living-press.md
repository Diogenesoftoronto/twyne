# The living press

Twyne's interface is a working press room, not a document viewer. Most editors animate to seem modern. Here, motion has three jobs:

1. **Answer.** When a writer presses something, the room shows that it took the press.
2. **Say where things go.** Every action that sends words somewhere looks like it is sending them there, in the same ink every time.
3. **Show that the room is alive.** Editors read, ink dries and the light moves. None of it gets in the way of writing.

This page is the contract for all of it. The tokens live in [`src/styles/motion.css`](../../src/styles/motion.css) (loaded after `global.css` through [`src/styles/press.css`](../../src/styles/press.css), so a surface sheet can refine a global rule at equal specificity), the levels and typing signal in [`src/utils/motion.ts`](../../src/utils/motion.ts), and the destinations in [`src/utils/consequence.ts`](../../src/utils/consequence.ts).

## Five rules

1. **The manuscript never moves.** Nothing translates, scales or reflows prose, and nothing lays out again because something animated. Ink may change colour on the page. Popovers, slips and margins move around the page, never on it.
2. **Frequency sets the budget.** The more often something happens, the less it may move.

   | How often | Example | Allowed |
   |---|---|---|
   | Every keystroke | typing, caret | colour only, at most one DOM write per burst, no transform |
   | Many times a minute | hover, a press | ≤ `--dur-press` / `--dur-release` (120 / 160 ms), 1px of travel |
   | A few times a minute | menus, popovers, a note arriving | ≤ `--dur-arrive` / `--dur-settle` (240 / 320 ms) |
   | A few times a session | a verdict, a publish, a first save | ≤ `--dur-ceremony` (900 ms), may use a shader |
   | Ambient | the desk lamp, an editor reading | slower than one cycle per 5 s, paused while typing |

   Keyboard-initiated actions skip their entrance where the result appears under the hands, as in command palettes and shortcuts.
3. **Consequence has one ink.** A control that sends something somewhere carries `data-consequence` and, wherever space allows, a [`<DestinationTag>`](../../src/components/ui/destination-tag.tsx). The ink is never the only cue. Every destination also has a word and a mark shape.
4. **Ambient life rests.** Anything nobody asked for carries `data-ambient` (or `.is-ambient`). It pauses while `html[data-typing]` is set, during flow and settling, and below the `full` level. Ambient work must not run per frame: it renders when its inputs change, not on a loop.
5. **Still is still.** `html[data-motion="still"]` collapses every duration. Colour and opacity changes remain, because WCAG 2.3.3 counts movement, not colour. So every state needs a colour or wording cue that does not depend on travel.

## Levels

The writer picks the level in **Preferences → Appearance → Motion**. It is stored on the device and stamped onto `<html data-motion>` before first paint.

| Level | Feedback & arrivals | Ceremonies | Ambient |
|---|---|---|---|
| `full` | yes | full length | yes, resting while typing |
| `calm` | yes | shortened (`--dur-ceremony` 360 ms) | no |
| `still` | no movement; colour only | no movement | no |

`system` (the default) resolves to `full`, or to `still` when the operating system asks for reduced motion. In script, use `allowsMotion("feedback" | "ceremony" | "ambient")` instead of reading `matchMedia` directly. Shaders must check it before allocating a context.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--ease-set` | `cubic-bezier(.22,1,.36,1)` | the house curve; most transitions |
| `--ease-lift` | `cubic-bezier(.55,0,1,.45)` | things leaving |
| `--ease-slip` | spring `linear()`, ~3% overshoot | paper in hand: slips, notes, popovers |
| `--ease-platen` | spring `linear()`, <1% overshoot | stamps, presses, anything heavy |
| `--dur-press` / `--dur-release` | 120 / 160 ms | presses, hovers |
| `--dur-arrive` / `--dur-settle` | 240 / 320 ms | menus, slips / panels, cards |
| `--dur-ceremony` | 900 ms | verdicts, publishing |
| `--dur-dry` | 1600 ms | fresh ink drying after a save |
| `--dur-breath` | 9 s | ambient cycles |
| `--lift-1/2/3` | 1px / .25rem / .6rem | travel distances |

Shared keyframes: `press-slip-in`, `press-slip-in-from-right`, `press-fade-in`, `press-ink-flash` (tint with `--flash-ink`), and `press-impress`. Utility classes: `.press-arrive`, `.press-arrive-right`, `.press-fade`.

## Consequence grammar

| `data-consequence` | Ink | Mark | Word | Means |
|---|---|---|---|---|
| `local` | ink-muted | hollow ring | device | stays on this device |
| `synced` | green | filled dot | account | copied to the writer's own account |
| `provider` | cobalt | filled dot | model | read by the writer's own model provider (BYOK) |
| `credit` | mustard | filled dot | credit | read by a hosted model; spends credit |
| `public` | vermilion | ring with dot | public | readable by anyone with the link, or a PDS |
| `erase` | deep vermilion | struck square | erases | removed and cannot be brought back here |

`aiConsequenceFor(settings)` / `loadAiConsequence()` decide between `provider` and `credit` from the writer's saved settings, so a tag tells the truth about the route a request will take.

**Guards scale with the loss.**

- Anything recoverable gets no confirmation. Undo is enough.
- A loss that is recoverable elsewhere (restore keeps a checkpoint) gets an inline confirm.
- A loss that cannot be recovered from here (erase synced history, stop sharing, unpublish) gets [`<HoldToConfirm>`](../../src/components/ui/hold-to-confirm.tsx). The platen comes down while the control is held, and releasing early drains the ink. Keyboard and assistive technology use a two-step press instead.

## The joy ledger

Each surface has one idea that belongs to a press room: what it is, and what it tells the writer. Everything listed here has shipped. Where a row was checked only through its CSS and component code, not live end to end (because it needs a signed-in account or a streaming model), the row says so.

### The manuscript

| Surface | The idea | What it communicates |
|---|---|---|
| Typing | **Wet ink.** Words set by hand sit in a bluer, wetter ink until IndexedDB has the draft, pass through a drying tone, then are just ink ([`extensions/wet-ink.ts`](../../src/components/editor/extensions/wet-ink.ts)). Painted with the CSS Custom Highlight API, so there is no DOM, layout or transform. Pastes, undo, drops and collaborators' edits arrive dry. | Your words are safe once they dry. Ink that stays wet means the save has not landed. |
| Caret | A vermilion caret, the editor's pencil. It never glides: Word's smoothed caret is the cautionary tale. | Where the hand is, instantly. |
| Selection | Non-photo blue, the copy editor's proof pencil, instead of the system highlight. | A marked passage, ready for a decision. |
| Selection toolbar | It slides up off the line once per new passage (a Web Animation on `translate`, so the toolbar is never re-mounted). Find sources and Ask an editor carry a docket mark in their destination ink, read from the writer's saved AI and Apparatus settings. | Before you press: what stays here and what is read by a model, and whose. |
| Section drag | The ⋮⋮ handle is a type slug that lights when its heading is hovered. The drag image is the section's heading on a slug. The drop target is a vermilion composing rule reading "set *Section* here". | Moving a section is moving set type: the whole block goes. |
| File drop | A docket that says where the plate will live: inline on this device when offline, your account's image storage when signed in, or that sign-in is needed. | Where the image goes, before you let go. |
| Moving the mouse | **The desk lamp.** A pool of light on the desk around the sheet ([`desk-lamp.ts`](../../src/components/editor/desk-lamp.ts)). It sits where the hour puts it (morning light from the left, evening from the right, warm at the day's ends) and leans toward the pointer when you are not typing. It is painted behind the page, so prose contrast never changes. | The room is lit and inhabited, and quiet while you write. |
| Scrolling | The lamp is fixed to the desk, so the paper slides under it. **The running foot**: the status bar names the section being read, set again from below as you cross into the next one ([`running-foot.ts`](../../src/components/editor/running-foot.ts)). Pressing it returns to that heading. | Where you are in a long manuscript, without a single line of prose moving. |

### The editor chrome

| Surface | The idea | What it communicates |
|---|---|---|
| Drawer | The active folio wears a vermilion tab that slips in on switch. The drawer's contents slide with it instead of being clipped. The toggle takes the editorial ink while the drawer is out. | Which manuscript is on the desk. |
| Masthead | The wordmark's hand-set wobble is ambient: it rests while you type, in flow, and below the full level. | A press at rest versus a press at work. |
| Save and sync | One line: "Saved 4s ago · held here / on the wire / filed", the route word in its consequence ink. "Filed" flashes once when the account has the words. | Exactly where the latest words are. |
| Menus and popovers | One arrival everywhere (File, account, sharing, compositor pickers, Typst status, shortcuts), and one scrim. | A menu belongs to what opened it. |
| Export | One "device" docket for the whole Export group. | Exports are files written here; nothing is sent. |
| Publish and share | Publish, PDS and Micropub carry the public docket and ink across when they succeed. Invite carries "invitee" (one named reader, not the public). Unpublish, Unpublish from PDS, removing a collaborator and Stop sharing are holds. *Checked by CSS and component only: needs a signed-in account.* | Public actions look public; permanent ones resist a slip. |
| Opening the editor | The "Setting the type…" gate waits 150 ms before it shows, so fast loads never flash it, and sets a line of slugs while it waits. | Work is happening, without a spinner. |
| Zen and flow | Zen eases the masthead and compositor out together. Flow keeps the global 1.2 s fade, because leaving for flow is ambient, not feedback. | The room steps back as a whole when you write. |

### The writers' room

| Surface | The idea | What it communicates |
|---|---|---|
| An editor reading | A pencil ring on the editor's portrait, tied to the real stream: reasoning traces a third of the ring, writing advances it with the characters received, and filing closes it. A faint shared mark shows while the background room is reading. *Checked by CSS and component only: needs a streaming model.* | Who is reading your draft now, and how far they have got. No spinner. |
| A note arriving | Filed notes slip onto the board, staggered at most 50 ms (capped at six). A note that has just been filed takes one ink impression in its editor's colour. A finished reply settles once. *Component only.* | Something new is on the board, and from whom. |
| Asking the room | One "The draft goes to · model / credit" docket under Get notes, Propose edits and Full analysis. Smaller dockets on reply, Ask for a fix, Send to editor, steering, the rubric's grade keys and Apparatus retry. | Whose model reads this, and whether it spends credit. |
| The verdict | **Ink squeezed from under the die.** At the moment the walnut die lands, a halftone in the grade's own ink is pushed out past the sunburst's rays, with a vermilion second plate a hair out of register. It spreads, holds and dries away within `--dur-ceremony`, and then the WebGL context is surrendered ([`stamp-shader.tsx`](../../src/components/rubric/stamp-shader.tsx)). It never plays on restore and never at still. The die itself now lands on the platen curve. | The judgement is in, and it is weighty. |
| Marginalia | Striking a comment rules a line through it. Erasing a comment, striking the room and removing a source are holds. | Settled versus gone. |
| Apparatus | A source being searched carries a cobalt reading tick (ambient). A found source files with one mustard flash. | Research is happening, and something was found. |
| Waiting | The editorial loader sets a line of slugs instead of spinning a ring. Its rotating wait lines stay. | A long wait, in the room's own terms. |
| Board tabs | The active underline slides between tabs. Unread badges press in once, only when the count rises. | Where you are, and what is new. |

### My Desk

| Surface | The idea | What it communicates |
|---|---|---|
| Opening the ledger | Figures are set like a composing stick: numerals roll into place once and re-set only when that figure changes. Readers get the whole value, never the digits. | A dossier being prepared for you. |
| Range | Switching keeps the old figures on the page, dimmed and `aria-busy`, and re-sets only what changed. The selected range is visibly inked (it showed only in `aria-pressed` before). | The same desk, through a different window of time. |
| Heatmap | Cells have a hover state and press when chosen. The selected-day aside slides in like a ledger page. | Which day you are reading. |
| Charts | Bars rise from the baseline once, on arrival or when their values change, and fills grow from the left. | Activity accumulating, not decoration. |
| Patterns | A pattern that crosses its evidence threshold gets a small *filed* stamp, once per device. | Evidence has accumulated. |
| Hosted charges | Money is printed in the credit ink under a credit docket. | This is the part that costs. |
| Tables and tabs | Data tables open with a turning marker. Usage tabs slide their indicator, crossfade their panel, and are a full keyboard tablist. | Ordinary controls, set in the house manner. |

## Performance contract

- Nothing new runs per keystroke beyond `markTyping()` (a timer reset) and, for wet ink, one range append per transaction, painted at most once a frame.
- The save path (`twyne:draft-saved`) drives drying, so drying costs nothing while the writer is typing.
- The running foot measures headings after the debounced `twyne:content` event. A scroll frame reads `scrollTop` and walks a cached list.
- The only shader is the verdict's. It runs on a canvas about 1.6× the stamp (never over 256 CSS px) for one ceremony, then loses its context. Nothing renders behind the manuscript on a loop.
- The desk lamp is a CSS gradient on two registered properties. They are written at most once a frame while the pointer moves, and once a minute for the hour.
- `bun run test:typing` is the arbiter. A change that moves its numbers is a regression, whatever it looks like.

## Adding to it

New motion names a row in the joy ledger. It says what it communicates, uses only the tokens above, has a `still` state that keeps the meaning, and carries `data-ambient` if nobody asked for it. If it sends anything anywhere, it carries a consequence.
