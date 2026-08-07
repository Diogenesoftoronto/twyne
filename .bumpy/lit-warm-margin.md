---
twyne: minor
---

The room writes where you can see it, and models that think first stop costing
twice.

**Hosted notes arrive as they are written.** Convening the room without your own
API key used to mean five blank cards and a wait, because the server generated
each note in full before returning it. The hosted path now streams: each editor
publishes their note as it is composed, keyed by persona, so five cards fill in
at once and the wait is spent reading rather than watching a spinner. The panel
cannot tell whether a note came from your key or from ours — both paths deliver
the same snapshots into the same cards.

**Thinking is shown, not hidden or punished.** A model that reasons before
answering now says so — the card reads "thinking…" and offers the scratch work
folded away, instead of sitting empty for as long as the model works. And a
reply that opened a `<think>` block is no longer thrown away and asked for
again: the thinking was already stripped from what you read, so the second call
bought nothing. Twyne only regenerates when nothing visible survived at all,
which halves the cost and the wait on exactly the models that can least afford
either.

**Room to grow.** Three collections — your folios, your custom editors, your
bibliography — each used to be stored as a single record holding the whole list.
Every change rewrote the entire thing, and the list could not grow past the
database's per-record ceiling: a long enough bibliography would eventually have
stopped saving. Each is now stored an item at a time, so editing one folio
touches one folio, and nothing has a ceiling to hit. Existing accounts convert
themselves on their next save; the rest are converted in the background. Nothing
about this is visible from the app, which is the point.

**A harness for small local models.** `bun run eval:local` runs the real
production path — the same prompts, the same `quote_passage` tool — against any
OpenAI-compatible endpoint, with and without tools, so a candidate on-device
model can be judged on whether it can actually anchor a note to a passage.
