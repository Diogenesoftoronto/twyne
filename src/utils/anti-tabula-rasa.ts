import type { ProjectBrief, ProjectInterviewAnswers } from "../types";

export const BRIEF_STORAGE_KEY = "twyne-project-brief";
export const DRAFT_STORAGE_KEY = "twyne-document";

export const DEFAULT_INTERVIEW_ANSWERS: ProjectInterviewAnswers = {
  workingTitle: "Untitled project",
  format: "Essay",
  audience: "A thoughtful reader who needs the point made clearly",
  goal: "Make the central argument feel inevitable and worth caring about",
  tone: "Clear, exact, and generous",
  constraints: "Keep the piece grounded in evidence and avoid generic filler",
  successSignal:
    "A reader should know what this is, who it is for, and why it matters",
};

export function createProjectBrief(
  answers: ProjectInterviewAnswers,
  previous?: ProjectBrief | null,
): ProjectBrief {
  const now = Date.now();
  return {
    answers: normalizeInterviewAnswers(answers),
    completedAt: previous?.completedAt ?? now,
    updatedAt: now,
  };
}

export function loadProjectBrief(): ProjectBrief | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BRIEF_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProjectBrief) : null;
  } catch {
    return null;
  }
}

export function saveProjectBrief(brief: ProjectBrief): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(brief));
  } catch {
    // storage unavailable
  }
}

export function loadDraftHtml(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(DRAFT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function loadDraftText(): string {
  return htmlToPlainText(loadDraftHtml());
}

export function saveDraftHtml(html: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, html);
  } catch {
    // storage unavailable
  }
}

export function buildStarterDocument(answers: ProjectInterviewAnswers): string {
  const normalized = normalizeInterviewAnswers(answers);
  const title = escapeHtml(normalized.workingTitle);

  return `
    <h1>${title}</h1>
    <p><strong>Anti-tabula rasa brief</strong>: this draft starts with context, not emptiness.</p>
    <h2>Working context</h2>
    <ul>
      <li><strong>Format:</strong> ${escapeHtml(normalized.format)}</li>
      <li><strong>Audience:</strong> ${escapeHtml(normalized.audience)}</li>
      <li><strong>Goal:</strong> ${escapeHtml(normalized.goal)}</li>
      <li><strong>Tone:</strong> ${escapeHtml(normalized.tone)}</li>
      <li><strong>Constraints:</strong> ${escapeHtml(normalized.constraints)}</li>
      <li><strong>Success signal:</strong> ${escapeHtml(normalized.successSignal)}</li>
    </ul>
    <h2>Starter prompt</h2>
    <blockquote>
      <p>${escapeHtml(normalized.goal)}</p>
    </blockquote>
    <p>Begin the draft here. The room will use the brief above as the anchor.</p>
  `.trim();
}

export function summarizeBrief(brief: ProjectBrief | null): string {
  const answers = brief?.answers ?? DEFAULT_INTERVIEW_ANSWERS;
  return `${answers.format} for ${answers.audience}. Goal: ${answers.goal}`;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|blockquote|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInterviewAnswers(
  answers: ProjectInterviewAnswers,
): ProjectInterviewAnswers {
  return {
    workingTitle:
      answers.workingTitle.trim() || DEFAULT_INTERVIEW_ANSWERS.workingTitle,
    format: answers.format.trim() || DEFAULT_INTERVIEW_ANSWERS.format,
    audience: answers.audience.trim() || DEFAULT_INTERVIEW_ANSWERS.audience,
    goal: answers.goal.trim() || DEFAULT_INTERVIEW_ANSWERS.goal,
    tone: answers.tone.trim() || DEFAULT_INTERVIEW_ANSWERS.tone,
    constraints:
      answers.constraints.trim() || DEFAULT_INTERVIEW_ANSWERS.constraints,
    successSignal:
      answers.successSignal.trim() || DEFAULT_INTERVIEW_ANSWERS.successSignal,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
