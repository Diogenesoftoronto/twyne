/**
 * The room of editors — system prompt builder and the local fallback
 * generator. The Convex action in `convex/agents.ts` calls into this module
 * when no remote provider is configured, or when the configured provider
 * fails. The prompt builder is also reused by the LLM-backed code path so
 * the voices stay consistent across providers.
 *
 * Intentionally no `"use node";` directive: this file is pure string
 * assembly with no Node.js built-ins, and it is also imported by the
 * Vite-bundled client code in `src/utils/{ai-client,ai-orchestrator}.ts`.
 * The Node runtime is opted into at the action boundary in
 * `convex/agents.ts`, which is the only file that needs it.
 */
import type { Persona, ProjectBrief } from "../src/types";
import { firstSubstantiveSentence } from "./agentTools";

export type FeedbackType =
  | "encouragement"
  | "suggestion"
  | "critique"
  | "perspective";

export interface AgentPersona {
  id: string;
  name: string;
  role: string;
  description: string;
  focus: string;
  /** Rich voice spec — distinct diction/rhythm/signature for this editor. */
  voice?: string;
  /** A few sample lines in this persona's voice, used as light few-shot. */
  sampleLines?: string[];
  /** Optional per-persona generation prefs (honored on the BYOK client path). */
  providerId?: string;
  model?: string;
  temperature?: number;
  /** Optional colour from the persona object; not used by the LLM prompt. */
  color?: string;
  icon?: string;
}

export interface AgentRequest {
  persona: AgentPersona;
  brief: ProjectBrief | null;
  draftText: string;
  /** Anchor sentence the note should pin to, if known. */
  anchor?: string;
  /** Prior conversation for follow-up turns. */
  priorMessages?: Array<{ author: "user" | "persona"; text: string }>;
  /** The user's follow-up question, if this is a reply. */
  userMessage?: string;
  /** Direct instruction the user is asking the persona to act on. */
  instruction?:
    | "feedback"
    | "elaborate"
    | "riff"
    | "rewrite-suggestion"
    | "analyze";
}

export interface AgentResponse {
  text: string;
  type: FeedbackType;
  provider: "rivet" | "anthropic" | "openai" | "bifrost" | "local";
  /** Soft signal of how confident the model is in the answer (0-1). */
  confidence?: number;
  /**
   * Exact draft passage the note pins to. Populated from the `quote_passage`
   * tool call (or deterministically for the local fallback) rather than
   * scraped from the reply text.
   */
  anchor?: string;
}

/* ── Prompt construction ────────────────────────────────────────── */

/**
 * The shared system prompt template. Each persona plugs in by name, role,
 * description and focus. The brief is given verbatim so the LLM knows
 * what the piece is for; the draft is summarised with a token budget so
 * large manuscripts don't blow past context windows.
 */
/**
 * The per-persona "how you write" block. This is what makes the five editors
 * sound like genuinely different people rather than one writer in five hats.
 * Falls back to nothing when a persona has no voice spec (older saved casts).
 */
function buildVoiceBlock(persona: AgentPersona): string {
  if (!persona.voice && (!persona.sampleLines || persona.sampleLines.length === 0)) {
    return "\nSpeak in your own voice. Do not sound like the other editors.\n";
  }
  const lines: string[] = [
    "\nWHO YOU ARE (your history and how you write — stay in this voice at all times; you are a specific person, not the other editors):",
  ];
  if (persona.voice) lines.push(persona.voice);
  if (persona.sampleLines && persona.sampleLines.length > 0) {
    lines.push(
      `Lines in your register, for calibration (do not reuse them verbatim):\n${persona.sampleLines
        .map((l) => `  — ${l}`)
        .join("\n")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The full system prompt a writer can preview on the /personas page. Shared so
 * the preview never drifts from what the editor is actually told.
 */
export function buildVoicePreview(persona: AgentPersona): string {
  return buildSystemPrompt(persona);
}

export function buildSystemPrompt(persona: AgentPersona): string {
  return `You are ${persona.name}, the ${persona.role} on the editorial board of "Twyne," a 1955-style magazine bullpen.

Voice and remit:
${persona.description}

You focus your reading on: ${persona.focus}.
${buildVoiceBlock(persona)}
You are one of five editors in residence. You will be given a project brief (the dossier the writer filed at the start) and a draft. Read the draft as a colleague would: do not flatter, do not pad, do not hedge. Speak in your own voice. Be willing to say "this is not yet working" if it is not. Keep replies between 60 and 220 words unless the writer asks for more.

You have a tool, \`quote_passage\`, that returns the exact text of a passage from the writer's draft. Use it instead of retyping passages from memory.

When you are asked to give feedback, you should:
- First call \`quote_passage\` with the sentence you are responding to, so your note pins to the real passage. If an anchor sentence is provided, quote that exact anchor.
- Do not make a claim about the draft unless you have first quoted the relevant passage with \`quote_passage\`.
- Then write your note as plain visible text: open with the single most important observation (no throat-clearing), distinguish what is working from what is not, and end with one concrete next move the writer can take.
- Always produce the note text itself — a tool call alone is not an answer.

When you are asked to elaborate on a previous note, stay grounded in the original claim and expand without contradicting yourself.

When you are asked to suggest a rewrite, give the replacement sentence verbatim, in the same voice, and explain why the change does the work better.

When the writer addresses you in conversation, answer the question they actually asked, then offer one follow-up you find interesting.

You will be given the brief verbatim. Honour it. The writer has committed to an audience, a goal, a tone, constraints and a success signal — your feedback is most useful when it is anchored to those commitments.`;
}

export function buildUserPrompt(req: AgentRequest): string {
  const brief = req.brief;
  const briefBlock = brief
    ? `PROJECT BRIEF (verbatim, do not invent new facts)
- Title: ${brief.answers.workingTitle}
- Format: ${brief.answers.format}
- Audience: ${brief.answers.audience}
- Goal: ${brief.answers.goal}
- Tone: ${brief.answers.tone}
- Constraints: ${brief.answers.constraints}
- Success signal: ${brief.answers.successSignal}

`
    : `PROJECT BRIEF: none filed — the writer is working without a dossier. Read for clarity and intent.\n\n`;

  const draftBlock = req.draftText.trim()
    ? `DRAFT (the manuscript as it stands — ${wordCount(req.draftText)} words)
"""
${clampForContext(req.draftText, 4500)}
"""

`
    : `DRAFT: empty. The writer has not yet written. Respond as if to a blank page and suggest the first move.\n\n`;

  const anchorBlock = req.anchor
    ? `ANCHOR SENTENCE (your note must pin to this exact sentence unless the writer asks a different question):\n"${req.anchor}"\n\n`
    : "";

  const instruction = req.instruction ?? "feedback";
  const instructionBlock =
    instruction === "feedback"
      ? `TASK: Give the writer a single focused note, in your voice, on this draft. First call quote_passage with the sentence you are responding to, then write the note.`
      : instruction === "elaborate"
        ? `TASK: The writer wants you to go deeper on a previous note. Call quote_passage for the passage under discussion, stay in your voice, expand your reasoning, and end with a concrete next move.`
        : instruction === "riff"
          ? `TASK: The writer wants a free-association riff. Call quote_passage for the passage that starts the riff, then write a short parallel passage in your voice that the writer can use as a counterweight.`
          : instruction === "analyze"
            ? `TASK: Write a FULL-PAGE analysis of the whole document, entirely in your voice. Stay strictly within your remit — do not do the other editors' jobs. Use quote_passage to ground every claim in an exact passage. Structure it as a flowing critique, not a checklist:
1. Your overall read of where the piece stands.
2. The single strongest passage, quoted, and why it works.
3. The load-bearing weakness, quoted, and what it costs the piece.
4. A walk through the draft in order, noting the moments that matter to you specifically.
5. One decisive next move the writer should make.
Write 400–700 words. This is a considered editorial memo, not a margin note.`
            : `TASK: The writer has asked for a specific rewrite. Give the replacement sentence verbatim, then explain the choice.`;

  const convoBlock =
    req.priorMessages && req.priorMessages.length > 0
      ? `\nPRIOR CONVERSATION (most recent last):\n${req.priorMessages
          .map((m) => `${m.author === "user" ? "WRITER" : "YOU"}: ${m.text}`)
          .join("\n\n")}\n\n`
      : "";

  const userMessageBlock = req.userMessage
    ? `\nWRITER'S NEW MESSAGE:\n"${req.userMessage}"\n\nAddress the message directly.\n`
    : "";

  return `${briefBlock}${draftBlock}${anchorBlock}${instructionBlock}${convoBlock}${userMessageBlock}`;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clampForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n[…draft trimmed for length…]\n\n${tail}`;
}

/* ── Local deterministic fallback ───────────────────────────────── */

/**
 * The original string-template feedback. Kept as a last-resort fallback
 * for environments without a configured LLM provider. The LLM paths in
 * `convex/agents.ts` call this only when both Rivet/agentOS and the
 * direct API paths fail, so the panel never breaks entirely.
 */
export function generateLocalFeedback(req: AgentRequest): AgentResponse {
  const answers = req.brief?.answers;
  const wordCountValue = wordCount(req.draftText);
  const hasBody = wordCountValue > 80;
  const audience = answers?.audience || "your intended reader";
  const goal = answers?.goal || "the central purpose of the piece";
  const tone = answers?.tone || "the chosen tone";
  const constraints = answers?.constraints || "the project constraints";
  const successSignal = answers?.successSignal || "the intended reader outcome";

  const map: Record<string, string> = {
    devil: hasBody
      ? `I am testing this against the stated goal: ${goal}. The draft needs sharper proof of why that goal follows from the argument on the page. Find one claim that ${audience} could reject, then add the strongest counterpoint before you answer it. The constraints are only useful if they are visible: ${constraints}.`
      : `The brief gives us a useful target, but the draft is still mostly setup. Write the risky version of the argument: what would make ${audience} disagree, and what evidence would force them to keep reading?`,
    angel: hasBody
      ? `The strongest thing here is that the piece already has a declared destination: ${goal}. Keep using that as the spine. When a paragraph directly helps ${audience}, protect it; that is where the draft starts feeling authored rather than assembled.`
      : `The context is doing useful work already. You have a reader, a goal, and a success signal before the first real paragraph. The next move can be specific: write toward ${successSignal}.`,
    scholar: hasBody
      ? `For ${audience}, evidence should be chosen for credibility, not decoration. Scan each major claim and mark whether it needs a source, an example, or a definition. The constraint to protect is: ${constraints}.`
      : `The research plan should follow the brief. Collect sources that help prove ${goal}, then keep a separate note for facts that are interesting but do not move ${audience} toward the success signal.`,
    editor: hasBody
      ? `Edit for the requested tone: ${tone}. If a sentence does not advance ${goal}, compress it or move it into notes. The current priority is not elegance in isolation; it is making every paragraph serve the reader outcome.`
      : `Use the brief as a style guide. Start with one paragraph in the target tone: ${tone}. Then revise the first sentence until it makes the piece's promise concrete.`,
    reader: hasBody
      ? `Reading as ${audience}, I need the opening to tell me why this matters now and what I will understand by the end. The success test is clear: ${successSignal}. Make that promise visible early.`
      : `As ${audience}, I would rather see a rough, direct opening than more setup. Tell me what problem I am walking into, then give me one reason to trust you.`,
  };

  const typeMap: Record<string, FeedbackType> = {
    devil: "critique",
    angel: "encouragement",
    scholar: "suggestion",
    editor: "suggestion",
    reader: "perspective",
  };

  const text =
    map[req.persona.id] ||
    "I read it, and I want to come back to you on one thing in particular.";

  return {
    text,
    type: typeMap[req.persona.id] || "perspective",
    provider: "local",
    confidence: 0.2,
    anchor: req.anchor ?? firstSubstantiveSentence(req.draftText),
  };
}

/* ── Synthesis + narrative review prompts ───────────────────────── */

export interface MemoForSynthesis {
  personaName: string;
  role: string;
  text: string;
}

/**
 * System prompt for the room's synthesis: a managing editor who has read all
 * five memos and must hand the writer a single verdict. Not one of the five
 * personas — a neutral chair who weighs them.
 */
export function buildSynthesisSystemPrompt(): string {
  return `You are the Managing Editor of "Twyne," a 1955-style magazine bullpen. Five editors have each filed a full analysis of the same draft. Your job is to synthesise their memos into one editorial verdict for the writer: where the room agrees, where it sharply disagrees, and what the writer should do first. You are even-handed and decisive. Do not impersonate the five editors; speak as the chair who weighs them. Quote an editor by name when their point is the crux.`;
}

export function buildSynthesisPrompt(
  memos: MemoForSynthesis[],
  brief: ProjectBrief | null,
): string {
  const briefBlock = brief
    ? `PROJECT BRIEF\n- Title: ${brief.answers.workingTitle}\n- Audience: ${brief.answers.audience}\n- Goal: ${brief.answers.goal}\n- Success signal: ${brief.answers.successSignal}\n\n`
    : "";
  const memoBlock = memos
    .map((m) => `### ${m.personaName} (${m.role})\n${m.text}`)
    .join("\n\n");
  return `${briefBlock}THE ROOM'S MEMOS:\n\n${memoBlock}\n\nWrite the synthesis (300–500 words): open with the room's overall verdict, name the strongest point of agreement, surface the sharpest disagreement and adjudicate it, and end with a prioritised list of the next two or three moves for the writer.`;
}

/**
 * Narrative review for the rubric. Explains the grade the judges + static
 * features already produced; does not re-score.
 */
export function buildRubricReviewSystemPrompt(): string {
  return `You are the Chief Critic of "Twyne." The galley-proof rubric has already scored this draft — judges' scores and a static-feature breakdown are given. Your job is to write the full-page narrative review that explains the grade in plain, honest prose and gives the writer a concrete revision plan. Do not invent new scores; interpret the ones you are given. Be candid; this is editorial pressure, not a self-esteem mirror.`;
}

export function buildRubricReviewPrompt(input: {
  combined: number;
  grade: string;
  judgeMean: number;
  staticTotal: number;
  judges: Array<{ personaId: string; score: number; rationale: string }>;
  staticFeedback: string[];
  brief: ProjectBrief | null;
  draftText: string;
}): string {
  const briefBlock = input.brief
    ? `PROJECT BRIEF\n- Audience: ${input.brief.answers.audience}\n- Goal: ${input.brief.answers.goal}\n- Success signal: ${input.brief.answers.successSignal}\n\n`
    : "";
  const judgeBlock = input.judges
    .map((j) => `- ${j.personaId}: ${j.score}/10 — ${j.rationale}`)
    .join("\n");
  const staticBlock = input.staticFeedback.map((f) => `- ${f}`).join("\n");
  return `${briefBlock}GRADE: ${input.combined}/100 (${input.grade}). Judge mean ${input.judgeMean.toFixed(1)}/10, static features ${input.staticTotal.toFixed(1)}/10.

JUDGES' VERDICTS:
${judgeBlock}

STATIC-FEATURE NOTES:
${staticBlock}

DRAFT (for reference):
"""
${clampForContext(input.draftText, 4000)}
"""

Write the review (400–600 words): explain what the grade means for a piece like this, walk through the weakest dimension and the strongest, reconcile any split between the judges and the static score, and close with a prioritised revision plan of three concrete steps.`;
}

/** Convert a Persona (UI) to an AgentPersona (LLM) shape. */
export function toAgentPersona(p: Persona): AgentPersona {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    description: p.description,
    focus: p.focus,
    voice: p.voice,
    sampleLines: p.sampleLines,
    providerId: p.providerId,
    model: p.model,
    temperature: p.temperature,
    color: p.color,
    icon: p.icon,
  };
}
