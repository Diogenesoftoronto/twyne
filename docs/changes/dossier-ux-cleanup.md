# Dossier UX cleanup — change summary

A focused pass on the dossier refinery (`/dossier/refine`) and dossier onboarding (`/dossier/create`) to fix three related UX problems:

1. The mode switch (Form / Conversation) was hidden when the writer switched into conversation — only the form side rendered the toggle, so there was no way back without the overloaded "Cancel / Use form" button the conversation chrome was carrying.
2. Several different "close" / "cancel" / "back" buttons were scattered across the dossier routes (top-bar back link, form "Close", conversation "Cancel", and a "Close" on the drift-report panel). They meant different things and made it hard to know what any given click would do.
3. There was no way to start the dossier over from scratch on the refinery page. The only way to "redo" the brief was to either pick a different mode (which kept the answers) or re-onboard from scratch (which lost the manuscript).

## What changed

### 1. Shared top bar — `src/components/onboarding/dossier-top-bar.tsx` (new)

A single component that owns the page-level chrome for both dossier routes:

- **Back link** (left): "← Back to desk" on `/dossier/refine`, "← Back home" on `/dossier/create` (when no folio exists yet).
- **Start over** (refine only): destructive, opens a confirm dialog rather than acting directly.
- **Mode switch** (right): right-aligned Form / Conversation pills, same shape in both directions, persistent across both modes so the writer can always switch back.

### 2. Plumbed existing-brief carry-over through the conversation

`Start over` writes the current folio draft into `localStorage` under a one-shot `twyne-starting-material` slot and routes to `/dossier/create/`. The create route reads it on hydration, then clears it. Both authoring surfaces (form and conversation) now consume it:

- **Form** (`AntiTabulaRasa`): new `initialMaterial` prop seeds the form's existing-material field.
- **Conversation** (`ConversationalInterview`): new `initialMaterial` prop is plumbed into the interview-turn request as `startingMaterial` and forwarded to both the Convex `runInterviewTurn` action and the client-side `runClientInterviewTurn` wrapper. The interview system prompt receives a `--- BEGIN MANUSCRIPT ---` block when present, so the AI orients its first question around the writer's draft rather than rediscovering it from scratch.

### 3. Removed in-body exit buttons

- `AntiTabulaRasa`: dropped its in-body `Close` button and the `onCancel$` prop (the top bar is now the only exit).
- `ConversationalInterview`: dropped its in-body `Cancel` button, the `cancelLabel` prop, and the `cancelOrUseForm` helper that overloaded the Cancel button to mean either "switch to form" or "leave the page". The conversation's `onCancel$` and `onUseForm$` props are kept because the ApplicationNotice recovery flow still uses them and the create route still passes `onUseForm$` for the mode-switch handler.
- Refine route: dropped `onCancel$` from both authoring surfaces; it now leaves via the top bar.

## Files touched

- **New**: `src/components/onboarding/dossier-top-bar.tsx`
- **`src/utils/anti-tabula-rasa.ts`** — added `STARTING_MATERIAL_KEY` constant and `loadStartingMaterial` / `saveStartingMaterial` / `clearStartingMaterial` helpers (lines 14–19, 135–157).
- **`src/components/onboarding/anti-tabula-rasa.tsx`** — new `initialMaterial` prop on `AntiTabulaRasaProps` (line 155); wired into the store's `existingMaterial` (line 207); dropped `onCancel$` prop and the in-body `Close` button (lines 527–535 removed, 169–172 updated).
- **`src/components/onboarding/conversational-interview.tsx`** — new `initialMaterial` prop (line 91); dropped `cancelLabel` (line 99 removed) and `cancelOrUseForm` helper (lines 448–462 removed); `startingMaterial` plumbed into both call sites (lines 287–293 and 333–335).
- **`src/utils/ai-client.ts`** — `InterviewTurnRequest.startingMaterial` added (line 2270); `runClientInterviewTurn` injects the manuscript into the system prompt (lines 2388–2402).
- **`convex/agents.ts`** — `runInterviewTurn` action gained an optional `startingMaterial` arg (lines 727–732); passed into `interviewSystemPrompt` (line 760); system prompt now appends a `--- BEGIN MANUSCRIPT ---` block when present (lines 605–607).
- **`src/routes/dossier/refine/index.tsx`** — replaced the inline top-bar div with `<DossierTopBar>` (lines 269–296 replaced); removed `onCancel$` from `AntiTabulaRasa` and `ConversationalInterview` (lines 411, 419); added `confirmStartOver` handler (lines 188–221) and a `<ThemedDialog>` for the destructive confirm (lines 425–440).
- **`src/routes/dossier/create/index.tsx`** — added `initialMaterial` to the route store (line 68); reads and clears `STARTING_MATERIAL_KEY` on hydration (lines 88–91); passes `initialMaterial` to both `ConversationalInterview` (line 234) and `AntiTabulaRasa` (line 274); restructured the route so every render path is wrapped in the shared `<DossierTopBar>`.

## What I didn't change

- The deeper architectural question — whether two parallel authoring surfaces (form vs conversation) should exist at all — was discussed in earlier turns and left open. This pass only fixes the immediate UX bugs: the mode switch is now visible in both directions, there is one exit per page, and Start over is a real affordance. A future pass could collapse the two surfaces into one component with the conversation as a per-field affordance on the form.
- `initialMaterial` is currently propagated only on the first-run (`/dossier/create`) path. The refine route already has its own brief context for the conversation, so passing the manuscript on top would be redundant for now. If we want refine-mode's conversation to also read the manuscript (e.g. after Start over followed by a re-visit to refine), we can add the same plumbing there too.

## How to verify

1. `bun run build.types` — passes.
2. `bun test` — 758 pass, 6 skip, 1 fail. The one failure (`voice-only providers > Fish Audio alone does not count as a language provider`) is a pre-existing flake in `src/utils/ai-client.test.ts` unrelated to these changes; passes when run on its own.
3. Manual: open `/dossier/refine`, confirm the top bar shows Back-to-desk on the left and Form / Conversation pills on the right. Click Conversation, confirm the pills stay and Conversation becomes the highlighted one. Click Start over, confirm the dialog mentions the manuscript will travel with the writer, confirm, land on `/dossier/create/` with the form pre-filled with the existing manuscript as starting material. Switch to Conversation in the top bar; the AI's first response should reference the manuscript text you already wrote.
