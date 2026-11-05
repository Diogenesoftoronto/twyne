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

Each surface gets one idea that belongs to a press room and nowhere else. The table lists what it is, what it says, and why it suits that surface.

### The manuscript (lane A)

| Surface | The idea | What it communicates |
|---|---|---|
| Typing | **Wet ink.** New words are set in a slightly bluer, wetter ink until they are stored on the device, then dry to black over `--dur-dry`. Uses the CSS Custom Highlight API, so no DOM, layout or transform is touched. | Your words are safe the moment they dry. If ink stays wet, the save hasn't landed. |
| Caret | A vermilion caret, the editor's pencil. Never smoothed or animated, because Word's gliding caret is the cautionary tale. | Where the hand is. Instant. |
| Selection | Non-photo blue, the copy editor's proof pencil, instead of the system highlight. | A marked passage, ready for a decision. |
| Selection popover | Slides up off the line like a slip pushed across the desk. Every AI action carries its destination tag. | Which actions stay here and which send the passage to a model, before you press. |
| Section drag | The ⋮⋮ handle becomes a type slug that lifts on grab, and the drop is a vermilion composing rule. | Moving a section is moving set type: the whole block goes. |
| File drop | "Drop a plate" with the destination written on the docket: kept in the manuscript on this device, or uploaded to your account's storage. | Where the image will live before you let go. |
| The desk lamp | A soft light pools on the paper's grain behind the page. It drifts with the hour and leans toward the pointer only when you are not typing. | The room is lit and inhabited, and quiet while you write. |

### The editor chrome (lane B)

| Surface | The idea | What it communicates |
|---|---|---|
| Drawer | Folios slide out like a drawer of filed sheets. The active folio wears a tab, and switching moves the tab. | Which manuscript is on the desk. |
| Masthead | The wordmark's ink sits still while you type. The infinite wobble now plays only at rest, as ambient life. | A press at rest and a press at work. |
| Save and sync | One status line instead of two dots. It reads *set* on save, *on the wire* while syncing, and *filed* when the account has it. | Exactly where the latest words are. |
| Menus and popovers | One arrival everywhere: `--dur-arrive` with `--ease-slip` from the trigger side. One scrim value. | Menus belong to what opened them. |
| Publish and share | Publish is a ceremony: the button inks in vermilion as the page goes out. Unpublish and stop-sharing are held, not clicked. | Public actions look public, and permanent ones resist a slip. |
| Zen and flow | Chrome eases out as one sheet, not piece by piece, and returns the same way. | The room steps back as a whole when you write. |

### The writers' room (lane C)

| Surface | The idea | What it communicates |
|---|---|---|
| An editor reading | The portrait of an editor who is reading wears a slow pencil-mark ring, its progress tied to the real stream (reasoning → writing → filed). There is no spinner. | Who is reading your draft right now, and how far they have got. |
| A note arriving | The note is set like a slip pushed onto the board. On filing it takes a small ink impression in the editor's colour. | Something new is on the board, and from whom. |
| Asking the room | Each AI button carries its destination tag (model or credit). | Before pressing: whose model reads this, and whether it costs. |
| The rubric verdict | The grade stamp presses with an ink-impression shader: a halftone corona with mis-registered vermilion and cobalt. Ceremony class, played once per new verdict. | The judgement is in, and it is weighty. |
| Marginalia | Strike draws a line through the card. Erase is held. | Settled versus gone. |
| Apparatus | Sources being searched carry a reading tick in cobalt. When found they file with a mustard flash. | Research is happening and something was found. |

### My Desk (lane D)

| Surface | The idea | What it communicates |
|---|---|---|
| Opening the ledger | Figures are set like a composing stick: numerals roll into place once on arrival and never again while the page is open. | A dossier being prepared for you. |
| Range | Switching range keeps the old figures in place and re-sets only what changed. No flash of the loader. | The same desk, a different window of time. |
| Heatmap | Selecting a day presses its cell, and the selected-day aside slides in like a ledger page. | Which day you are reading. |
| Charts | Bars rise from the baseline once, on arrival. | Activity accumulating, not decoration. |
| Patterns | When a pattern unlocks it gets a small *filed* stamp. | Evidence has accumulated. |
| Hosted charges | Money figures use the credit ink, and refreshing re-sets only the changed numerals. | This is the part that costs. |

## Performance contract

- Nothing new runs per keystroke beyond `markTyping()` (a timer reset) and, for wet ink, one range append per transaction.
- The derived save path (`twyne:draft-saved`) drives drying, so drying costs nothing while the writer is typing.
- Shaders render on a small canvas, at most 256 CSS px on a side and at half resolution. They run for a ceremony and then free the context. They never run behind the manuscript on a loop.
- The desk lamp is a CSS gradient on a registered property. It is set on pointer idle and once a minute for the hour, never per frame.
- `bun run test:typing` is the arbiter. A change that moves its numbers is a regression, whatever it looks like.

## Adding to it

New motion names a row in the joy ledger. It says what it communicates, uses only the tokens above, has a `still` state that keeps the meaning, and carries `data-ambient` if nobody asked for it. If it sends anything anywhere, it carries a consequence.
