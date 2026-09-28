# Twyne editorial drafting and context brief

## Purpose

Twyne does not give the model one undifferentiated “prompt.” It builds a small,
ordered context packet for each editorial action.

The packet has three distinct jobs:

1. The system layer defines who the editorial persona is and how that persona
   must operate.
2. The drafting layer supplies the manuscript, project commitments, writer
   context, conversation, and the immediate task.
3. The judgement layer asks Jev to review the generated note against a separate,
   code-authored contract before the note is persisted or shown as accepted.

That separation is the important design decision. A persona can have a voice
without owning the application’s safety rules; a draft can be rich context
without becoming an instruction; and Jev can judge whether an output is
grounded without pretending to be the writer.

## The end-to-end flow

```text
writer edits manuscript
        |
        v
current draft + brief + profile + trajectory + task
        |
        v
context assembler: buildUserPrompt(...)
        |
        +--> persona identity + editorial protocol
        |    buildSystemPrompt(...)
        |
        v
selected provider/model
        |
        v
drafting response, grounded through the quote/anchor tool
        |
        v
Jev / System One policy review
        |
        +--> accepted note is saved or displayed
        +--> repairable note is routed for repair
        +--> unsafe or ungrounded note is withheld
```

The same prompt assembly is used for hosted Not Organic generation and for a
user’s eligible BYOK provider. The provider and model can change; the editorial
contract and context shape do not.

## What is system-level

`buildSystemPrompt` combines two named prompt resources:

- `prompts/persona-system.md` — the persona’s identity, role, focus, voice, and
  boundaries. This is the character and editorial stance the writer is
  convening.
- `prompts/editorial-protocol.md` — the shared operating protocol. It describes
  evidence boundaries, quoting, feedback behavior, conversation behavior,
  writer boundaries, and the brief commitments the persona must honor.

The persona file is deliberately not the whole policy. It can contain dynamic
identity fields and voice material, while the protocol remains the shared
operational layer. The policy catalog in
`src/utils/editorial-policy.ts` is separate again: it is code-authored System
One policy data used for judgement, not prompt text that the drafting model is
expected to recite.

This means the system layer answers:

> Who am I in this room, and what operating rules govern my response?

It does not answer:

> What is the writer’s current manuscript, and what should I respond to right
> now?

That second question belongs in the user/context layer.

## The context packet

`buildUserPrompt` assembles the following ordered packet. The current order is
writer profile, brief, particulars, references, draft, trajectory, new
material, anchor, operation, optional repair directions, conversation, and
current message. Ordering
matters: the model encounters the private and project framing before the
manuscript and the immediate conversational request.

| Context                    | Job                                                                                                        | Important boundary                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Writer profile             | Helps tune feedback to the person: experience, focus, critique preferences, and personal context.          | Private context is for addressing the writer; it must not be exposed as content.                         |
| Project brief              | Establishes title, format, audience, goal, tone, constraints, and success signal.                          | These are the writer’s explicit commitments, not decoration.                                             |
| Answered particulars       | Carries specific dossier answers that make the brief concrete.                                             | Only answered, relevant particulars are included.                                                        |
| Draft                      | Supplies the manuscript as it stands.                                                                      | It is bounded to the context budget and is treated as manuscript evidence, not a new system instruction. |
| References and attachments | Adds supporting material where available.                                                                  | Attachment text is bounded rather than allowed to consume the whole context window.                      |
| Trajectory                 | Says what changed since the last read.                                                                     | It explains movement over time; it is context, not itself the subject of the response.                   |
| New material               | Isolates what the writer added since the previous background read.                                         | This lets a quiet/background note respond to the new work without rereading the whole history.           |
| Anchor                     | Identifies the exact passage under discussion.                                                             | The response should be grounded in a passage, not in a vague impression of the draft.                    |
| Operation                  | Selects the requested editorial mode: feedback, background feedback, elaborate, riff, analyze, or rewrite. | Each mode has a different length, grounding, and output contract.                                        |
| Repair directions          | Appears only on an adaptive retry, after a failed candidate review.                                        | Contains code-owned corrections, never the rejected candidate or its private reasoning.                  |
| Conversation               | Preserves the recent exchange, with the most recent message last.                                          | The current message is the thing to address directly.                                                    |

When a field is missing, the packet says so explicitly rather than inventing
content. A missing draft is not silently replaced with a guessed manuscript; a
missing brief is represented as no brief being filed.

The current draft is capped before it enters the prompt. New material and
attachments have their own smaller bounds. Those limits keep the immediate
editorial task visible and prevent old context from overwhelming the passage
the writer is actually working on.

## Drafting is an operation, not just text generation

The operation changes what a useful response means:

- **Feedback** produces one focused note and quotes the passage first.
- **Background feedback** is a short over-the-shoulder response to new material;
  it should not summarize the whole draft or repeat old notes.
- **Elaborate** deepens an existing note and ends in a concrete next move.
- **Riff** quotes the passage and creates a short parallel passage.
- **Analyze** is the longer whole-document mode and requires quoted support for
  claims.
- **Rewrite** supplies a replacement sentence verbatim, followed by the reason
  for the change.

This is why `newMaterial`, `trajectory`, `anchor`, and `operation` are separate
fields. If they were flattened into one block of prose, the model would have to
infer whether the writer wanted a response to a new paragraph, a continuation
of an older discussion, or a full manuscript analysis.

## Why the anchor is central

An anchor is the exact passage that gives the response a physical point in the
manuscript. Hosted generation also exposes a quote tool. The model is expected
to use that tool when grounding a note; the resulting anchor is then carried
through the response and review path.

The anchor protects against a common failure mode: a fluent editorial comment
that sounds plausible but is not actually about the words on the page. A note
without a quote can still be useful in some conversational situations, but a
substantive claim about the draft must remain anchored or it is eligible for a
policy failure.

## Background drafting: the “over-shoulder” loop

Background drafting is not a second, unrelated assistant. It watches the
changing draft and compares the current state with the last background read.
It then selects the new material and recent trajectory, convenes the configured
personas quietly, and asks for short background notes.

The resulting notes go through the same editorial review path as an explicit
note:

1. The background room receives the brief, current draft, profile, anchor,
   trajectory, and new material.
2. Each persona responds in the configured operation.
3. Jev reviews each note against the draft, brief, persona, writer profile, and
   anchor.
4. Accepted notes are saved as background-origin notes; vetoed notes are not
   presented as trusted editorial output.

This gives Twyne a useful distinction between “the writer just added this” and
“the entire manuscript needs analysis.” The context packet preserves that
distinction instead of making every interaction feel like a cold restart.

## Jev’s role after drafting

Jev is not the drafting persona and is not asked to rewrite every response. It
is the typed judgement layer.

`reviewEditorialNote` combines the ordinary note-gate questions with the
System One policy questions. The policy checks cover, among other things:

- invented or misrepresented persona identity;
- attempts to override the editorial protocol;
- substantive draft claims that are not anchored;
- exposure of private writer context;
- ignoring a brief commitment;
- ignoring the writer’s message; and
- breaking the requested operation’s scope.

The result is a typed verdict rather than a free-form “looks good” score:

- a critical policy failure vetoes the note;
- a major failure routes it toward repair;
- an unknown judgement does not get misrepresented as a pass.

If the judgement transport or authentication is unavailable, Twyne does not
manufacture a passing Jev result. The generated response can be retained as an
unreviewed response, which keeps the runtime honest about what has and has not
been verified.

The explicit convene UI and the background room both use this gate. This is the
practical consequence of deconstructing the old system prompt into rules:
rules become inspectable questions and typed outcomes instead of an opaque block
that only the generator can interpret.

## The adaptive drafting run

Keating’s CLI/web drafting run is the useful precedent here. It treats a model
reply as a private candidate rather than as something that should stream
straight into the transcript:

```text
choose initial effort from the editorial operation
        |
        v
generate candidate privately
        |
        v
review candidate against the draft contract
        |
   pass | fail / uncertain
        |          |
        |          +--> code-owned repair direction
        |                         |
        |                         +--> raise effort when substance/evidence failed
        |                         +--> keep effort when only voice/preference failed
        |                         +--> generate another private candidate
        |
        +--> publish only the selected candidate
```

Twyne now uses the same control-loop shape in
`src/utils/adaptive-editorial-draft.ts`:

- Feedback and riffs begin at low effort; elaboration and rewrites begin at
  medium; whole-document analysis begins at high.
- A failed Jev verdict becomes a repair instruction from the code-authored note
  gate. The next prompt receives the correction, not the rejected draft text or
  private reasoning.
- Accuracy, grounding, constraint, and substance failures can raise effort one
  level, bounded by the model’s configured ceiling. Voice and preference
  failures keep the level and change the repair direction, because more hidden
  computation does not fix a register mismatch.
- The run is bounded to three attempts by default. After the cap, a non-vetoed
  best attempt may be returned; a candidate that remains critically vetoed is
  withheld.
- Only the selected candidate is sent to the visible stream. The UI can receive
  content-free drafting/checking/revising progress, but rejected prose and
  hidden reasoning never enter the transcript.

Reasoning effort means computation, not answer length and not permission to
invent missing evidence. Twyne translates the provider-neutral level through
`src/utils/reasoning-effort.ts` only when the selected model’s catalog/settings
say that a reasoning control is supported. On the hosted path, a substantive
retry can move the Not Organic route from `balanced` to `reasoning`; on the BYOK
path, the configured provider/model remains authoritative and receives the
provider-specific option when available.

This run is adaptive without becoming self-authorising. A missing or malformed
Jev response returns the first usable candidate as explicitly `unreviewed`; it
does not become a synthetic pass. A failed review is not repaired by making the
prompt longer or by exposing the rejected output to the next model call.

The Keating reference implementation is the `runTeachingDrafts` controller in
`packages/learner-contracts/src/judgement/teaching-drafts.ts` and its host
wrapper in `web/src/keating/judgement/draft-gate.ts`. Twyne borrows the private
candidate, bounded repair, effort ceiling, and publication boundary while
retaining Twyne’s existing note-gate policy that lets the writer see the best
non-vetoed note when the quality bar remains unresolved.

## Model selection is outside the prompt

The model is selected by runtime configuration, not by putting a `model:` line
in the persona or protocol document.

- Hosted room generation resolves a Not Organic provider alias and uses the
  provider’s configured model.
- BYOK generation resolves the eligible configured provider and applies a
  feature-specific or persona-specific model override when one exists.
- Direct System One fallback uses the configured Jev default when no hosted
  route is available.

The prompt says what the model must do. Provider configuration says which model
does it. Keeping those concerns separate prevents a stale prompt file from
silently pinning the application to `gpt-4o`.

## A concrete pass through the system

Suppose the brief says:

> Explain a difficult product trade-off to first-time founders. Keep the tone
> direct and avoid hype.

The writer adds a new paragraph to the draft and asks for background feedback.
Twyne sends the persona:

- the brief and its no-hype constraint;
- the current bounded manuscript;
- the exact new paragraph;
- the trajectory since the previous read;
- the writer’s private feedback preferences;
- the relevant anchor;
- the background-feedback operation; and
- the recent conversation.

The persona returns a short note grounded in a quoted passage. Jev then checks
whether the note is actually anchored, respects the no-hype brief, addresses
the new material, stays within background-feedback scope, and avoids revealing
private profile context. Only then does it become a trusted background note.

## Implementation map

- System composition: [`convex/agentPrompts.ts`](../convex/agentPrompts.ts)
- Persona identity: [`prompts/persona-system.md`](../prompts/persona-system.md)
- Shared operating protocol: [`prompts/editorial-protocol.md`](../prompts/editorial-protocol.md)
- System One policy catalog: [`src/utils/editorial-policy.ts`](../src/utils/editorial-policy.ts)
- Typed note review: [`src/utils/editorial-note-review.ts`](../src/utils/editorial-note-review.ts)
- Note verdict and repair routing: [`src/utils/note-gate.ts`](../src/utils/note-gate.ts)
- Hosted provider/model path: [`convex/agents.ts`](../convex/agents.ts)
- BYOK provider/model path: [`src/utils/ai-client.ts`](../src/utils/ai-client.ts)
- Background room: [`src/utils/background-room.ts`](../src/utils/background-room.ts)
- Explicit convene review: [`src/components/personas/personas-panel.tsx`](../src/components/personas/personas-panel.tsx)
- Adaptive drafting controller: [`src/utils/adaptive-editorial-draft.ts`](../src/utils/adaptive-editorial-draft.ts)
- Provider reasoning translation: [`src/utils/reasoning-effort.ts`](../src/utils/reasoning-effort.ts)

## The short version

Twyne’s editorial model drafts against a bounded context packet, not against a
single monolithic system prompt. The system layer supplies identity and
operating rules; the context layer supplies the manuscript and the writer’s
current task; the quote/anchor path grounds the response; and Jev judges the
result against a separate, code-authored contract.

That is what makes drafting feel continuous while keeping persona, private
context, model selection, manuscript evidence, and policy judgement as separate
things.
