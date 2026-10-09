/// <reference types="vite/client" />
/**
 * Prompt loader. Each `.md` file in `prompts/` becomes a string accessible
 * here. Frontmatter (between `---` fences at the top of a file) is parsed
 * into a small record; the body becomes the template body.
 *
 * `{name}` placeholders in the body are substituted by `renderPrompt()`
 * — language-agnostic, zero-dep, matches what every LLM prompt tutorial
 * already writes as "placeholder syntax". Unresolved placeholders are left
 * literal so a forgotten rename shows up as `{goal}` in the prompt
 * instead of silently dropping the line.
 *
 * The checked-in catalog packages the same templates for browser builds,
 * Convex's esbuild bundler, and Bun. `bun run prompts:compile` regenerates
 * it from Markdown; `prompts:check` rejects stale generated content.
 * Vite development uses a direct glob so Markdown edits still hot reload.
 */

import { promptCatalog } from "../generated/prompt-catalog";

export interface PromptFrontmatter {
  /** Author-supplied short description for prompt-learning notes. */
  notes?: string;
  /** Free-form version string ("1", "1.2", "2024-10-08"). */
  version?: string;
  /** Suggested model choice. Treated as advisory on the BYOK path. */
  model?: string;
  /** Last optimization pass — written by evals/optimize-prompts.py. */
  lastOptimized?: string;
  /** Free-form anything else. Not consumed by the loader. */
  [key: string]: unknown;
}

export interface LoadedPrompt {
  /** Frontmatter at the top of the file, `{}` when absent. */
  frontmatter: PromptFrontmatter;
  /** Body text with the frontmatter stripped. Holds `{var}` placeholders. */
  body: string;
}

type RawModule = string | { default: string } | undefined;

/** Strip YAML-ish frontmatter from a markdown file body. */
function splitFrontmatter(raw: string): {
  frontmatter: PromptFrontmatter;
  body: string;
} {
  // Frontmatter must be the very first line, fenced by `---` on its own line
  // and closed with `---` on its own line. Keeps the loader honest: anything
  // that doesn't match is treated as pure body so we never silently drop text.
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  // After the opening `---`, look for the closing fence `\n---`. The fence
  // is three `-`s; the next char should be a newline (or EOF) so the fence
  // sits on its own line.
  const closeSearch = raw.indexOf("\n---", 3);
  if (closeSearch < 0) return { frontmatter: {}, body: raw };
  const fenceEnd = closeSearch + 4; // covers "\n---"
  const afterFence = raw[fenceEnd]; // first char after the fence (or undefined)
  if (afterFence !== undefined && afterFence !== "\n") {
    return { frontmatter: {}, body: raw };
  }
  // Block between the two fences, excluding the opening `---`.
  const block = raw.slice(3, closeSearch).trim();
  const bodyStart = fenceEnd + (afterFence === "\n" ? 1 : 0);
  const body = raw.slice(bodyStart).replace(/^\n/, "");
  return { frontmatter: parseFrontmatterBlock(block), body };
}

/**
 * Tiny key-value frontmatter parser. Each non-empty line is `key: value`.
 * Values are unquoted strings; quoted values have the wrapping double or
 * single quotes stripped. Comments (`# …`) and blank lines are ignored. No
 * nested structures — frontmatter is intentionally minimal so a writer
 * can edit it without learning YAML.
 */
function parseFrontmatterBlock(block: string): PromptFrontmatter {
  const out: PromptFrontmatter = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function unwrap(mod: RawModule): string {
  if (typeof mod === "string") return mod;
  if (mod && typeof mod === "object" && "default" in mod) {
    return String((mod as { default: unknown }).default ?? "");
  }
  return "";
}

/** Path → LoadedPrompt (relative to the repo's `prompts/` directory). */
const cache = new Map<string, LoadedPrompt>();

/**
 * Resolve a basename (e.g. `"persona-system"`) or a path-with-extension
 * (e.g. `"blocks/writer-profile"`) to the loaded prompt. Missing or empty
 * templates fail before a caller can send an empty prompt to a provider.
 */
function load(name: string): LoadedPrompt {
  const cached = cache.get(name);
  if (cached) return cached;

  // Map basename to a `?raw` module key. glob keys are absolute paths from
  // the project root, e.g. "/prompts/persona-system.md".
  const tryVariants = [
    name.endsWith(".md") ? name : `${name}.md`,
    `/prompts/${name.replace(/^\//, "")}${name.endsWith(".md") ? "" : ".md"}`,
    `/prompts/blocks/${name.replace(/^\//, "")}${name.endsWith(".md") ? "" : ".md"}`,
  ];

  let raw = "";
  for (const key of tryVariants) {
    const mod = rawModules[key];
    if (mod != null) {
      raw = unwrap(mod);
      break;
    }
  }

  const loaded = splitFrontmatter(raw);
  if (!loaded.body.trim()) {
    throw new Error(`Missing or empty prompt template: ${name}`);
  }
  cache.set(name, loaded);
  return loaded;
}

/**
 * Only Vite transforms glob calls. Do not guard on the runtime existence
 * of `import.meta.glob`: Vite erases the call, not such a guard. Other
 * runtimes always use the bundled catalog and need no filesystem access.
 */
const rawModules = ((): Record<string, RawModule> => {
  try {
    if (import.meta.env?.DEV) {
      return import.meta.glob<string>("/prompts/**/*.md", {
        query: "?raw",
        eager: true,
        import: "default",
      });
    }
  } catch {
    // Bun and Convex do not supply Vite's compile-time import.meta helpers.
  }
  return promptCatalog;
})();

/**
 * Substitute `{name}` placeholders in a template body. Unknown keys are
 * left literal so a missed substitution is visibly wrong in the prompt
 * rather than silently dropped.
 */
export function renderPrompt(
  body: string,
  vars: Record<string, string | number | undefined>,
): string {
  return body.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Fetch the loaded prompt (body + frontmatter) by basename. */
export function getPrompt(name: string): LoadedPrompt {
  return load(name);
}

/** Convenience: render a prompt by basename with the given vars. */
export function prompt(
  name: string,
  vars: Record<string, string | number | undefined> = {},
): string {
  const loaded = load(name);
  return renderPrompt(loaded.body, vars);
}

/** Read only the frontmatter for a prompt — useful for editor/admin views. */
export function promptFrontmatter(name: string): PromptFrontmatter {
  return load(name).frontmatter;
}

/**
 * Stable, typed map of every prompt this app ships with. New prompts go
 * here once and become available as `prompts.personaSystem` etc. The
 * values are loader functions so the body is only pulled when asked for,
 * keeping the bundle's parse cost lazy.
 */
export const promptNames = {
  // Group A — named system prompts.
  personaSystem: "persona-system",
  editorialProtocol: "editorial-protocol",
  synthesisSystem: "synthesis-system",
  rubricReviewSystem: "rubric-review-system",
  evidenceJudgeSystem: "evidence-judge-system",
  integrityJudgeSystem: "integrity-judge-system",
  targetFitJudgeSystem: "target-fit-judge-system",
  customCriterionSystem: "custom-criterion-system",
  sufficiencyJudgeSystem: "sufficiency-judge-system",
  citationFormatSystem: "citation-format-system",
  sourceSummarizeSystem: "source-summarize-system",
  missingSourceDetectorSystem: "missing-source-detector-system",
  webSearchSystem: "web-search-system",
  dossierCheckSystem: "dossier-check-system",
  interviewSystem: "interview-system",
  researchExtractSystem: "research-extract-system",

  // Group B — single-file {var} substitutions for user-prompt bodies.
  evidenceJudgeUser: "evidence-judge-user",
  integrityJudgeUser: "integrity-judge-user",
  targetFitJudgeUser: "target-fit-judge-user",
  customCriterionUser: "custom-criterion-user",
  sufficiencyJudgeUser: "sufficiency-judge-user",
  synthesisUserBody: "synthesis-user-body",
  rubricReviewUserBody: "rubric-review-brief",
  rubricReviewUserBrief: "rubric-review-brief",
  citationFormatUser: "citation-format-user",
  sourceSummarizeUser: "source-summarize-user",
  missingSourceDetectorUser: "missing-source-detector-user",
  webSearchUser: "web-search-user",
  dossierCheckUser: "dossier-check-user",
  researchExtractUser: "research-extract-user",

  // Group C — small blocks the TS assembler concatenates conditionally.
  personaBackstory: "blocks/persona-backstory",
  personaDoctrine: "blocks/persona-doctrine",
  personaVoiceprint: "blocks/persona-voiceprint",
  personaSignatureMoves: "blocks/persona-signature-moves",
  personaAvoid: "blocks/persona-avoid",
  personaSampleLines: "blocks/persona-sample-lines",
  personaFallbackVoice: "blocks/persona-fallback-voice",
  userBrief: "blocks/user-brief",
  userBriefNone: "blocks/user-brief-none",
  writerProfileHeader: "blocks/writer-profile-header",
  writerProfileName: "blocks/writer-profile-name",
  writerProfileNameMissing: "blocks/writer-profile-name-missing",
  writerProfileFeedbackPressure: "blocks/writer-profile-feedback-pressure",
  writerProfileContext: "blocks/writer-profile-context",
  writerProfileContextMissing: "blocks/writer-profile-context-missing",
  writerProfileGuidance: "blocks/writer-profile-guidance",
  writerProfileGuidanceMissing: "blocks/writer-profile-guidance-missing",
  userDraft: "blocks/user-draft",
  userDraftEmpty: "blocks/user-draft-empty",
  userTrajectory: "blocks/user-trajectory",
  userNewMaterial: "blocks/user-new-material",
  userAnchor: "blocks/user-anchor",
  userConvoHeader: "blocks/user-convo-header",
  userNewMessage: "blocks/user-new-message",
  instructionFeedback: "blocks/instruction-feedback",
  instructionFeedbackNew: "blocks/instruction-feedback-new",
  instructionElaborate: "blocks/instruction-elaborate",
  instructionRiff: "blocks/instruction-riff",
  instructionAnalyze: "blocks/instruction-analyze",
  instructionRewrite: "blocks/instruction-rewrite",
  synthesisMemoBlock: "blocks/synthesis-memo-block",
  particularsHeader: "blocks/particulars-header",
  rubricGrade: "blocks/rubric-grade",
  rubricJudgesHeader: "blocks/rubric-judges-header",
  rubricStaticHeader: "blocks/rubric-static-header",
  rubricDraftHeader: "blocks/rubric-draft-header",
  rubricReviewBrief: "blocks/rubric-review-brief",
  attachmentsHeader: "blocks/attachments-header",
  attachmentLink: "blocks/attachment-link",
  attachmentDocExcerpt: "blocks/attachment-doc-excerpt",
  attachmentDocOmitted: "blocks/attachment-doc-omitted",
  clientInterviewSystem: "blocks/client-interview-system",
  clientInterviewRefineAppendix: "blocks/refine-appendix",
  clientInterviewManuscriptAppendix: "blocks/manuscript-appendix",
  refineAppendix: "blocks/refine-appendix",
  manuscriptAppendix: "blocks/manuscript-appendix",
  researchExtractExisting: "blocks/research-extract-existing",
  researchExtractExistingEmpty: "blocks/research-extract-existing-empty",
  researchExtractExtra: "blocks/research-extract-extra",
  researchExtractAnchorHint: "blocks/research-extract-anchor-hint",
  sourceSummarizeAuthor: "blocks/source-summarize-author",
  sourceSummarizeUrl: "blocks/source-summarize-url",
  missingSourceExisting: "blocks/missing-source-existing",
  missingSourceExistingEmpty: "blocks/missing-source-existing-empty",
  citationFormatContext: "blocks/citation-format-context",
  personaOpeningDevilWithDraft: "blocks/persona-opening-devil-with-draft",
  personaOpeningDevilEmpty: "blocks/persona-opening-devil-empty",
  personaOpeningAngelWithDraft: "blocks/persona-opening-angel-with-draft",
  personaOpeningAngelEmpty: "blocks/persona-opening-angel-empty",
  personaOpeningScholarWithDraft: "blocks/persona-opening-scholar-with-draft",
  personaOpeningScholarEmpty: "blocks/persona-opening-scholar-empty",
  personaOpeningEditorWithDraft: "blocks/persona-opening-editor-with-draft",
  personaOpeningEditorEmpty: "blocks/persona-opening-editor-empty",
  personaOpeningReaderWithDraft: "blocks/persona-opening-reader-with-draft",
  personaOpeningReaderEmpty: "blocks/persona-opening-reader-empty",
} as const;

export type PromptName = (typeof promptNames)[keyof typeof promptNames];
