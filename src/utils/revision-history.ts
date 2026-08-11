import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

export interface RevisionSnapshot {
  id: string;
  folioId: string;
  html: string;
  createdAt: number;
  label: string;
  source: "automatic" | "manual" | "feedback" | "rubric";
  wordCount: number;
}

export interface RevisionComparison {
  wordsBefore: number;
  wordsAfter: number;
  wordsChanged: number;
  paragraphsBefore: number;
  paragraphsAfter: number;
}

export interface RevisionTask {
  id: string;
  folioId: string;
  title: string;
  detail?: string;
  sourceId?: string;
  source: "feedback" | "suggestion" | "manual";
  status: "open" | "done";
  createdAt: number;
  completedAt?: number;
}

const MAX_REVISIONS = 50;
const AUTO_INTERVAL_MS = 5 * 60_000;
let storage = { load: loadMetaFromIdb, save: saveMetaToIdb };

/** Test seam that avoids process-wide module mocks leaking into other suites. */
export function __setRevisionStorageForTests(
  adapter: typeof storage | null,
): void {
  storage = adapter ?? { load: loadMetaFromIdb, save: saveMetaToIdb };
}

function historyKey(folioId: string): string {
  return `revision-history:${folioId}`;
}

function tasksKey(folioId: string): string {
  return `revision-tasks:${folioId}`;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function words(html: string): string[] {
  const text = plainText(html);
  return text
    ? text
        .toLocaleLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/^\W+|\W+$/g, ""))
        .filter(Boolean)
    : [];
}

function paragraphs(html: string): number {
  return (html.match(/<(?:p|h[1-6]|li|blockquote)\b/gi) ?? []).length;
}

export async function loadRevisionHistory(
  folioId: string,
): Promise<RevisionSnapshot[]> {
  const history = await storage.load<RevisionSnapshot[]>(historyKey(folioId));
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (entry) =>
        entry &&
        entry.folioId === folioId &&
        typeof entry.html === "string" &&
        typeof entry.createdAt === "number",
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_REVISIONS);
}

export async function createRevisionSnapshot(args: {
  folioId: string;
  html: string;
  label?: string;
  source?: RevisionSnapshot["source"];
  now?: number;
  force?: boolean;
}): Promise<RevisionSnapshot | null> {
  if (!args.folioId) return null;
  const now = args.now ?? Date.now();
  const source = args.source ?? "manual";
  const history = await loadRevisionHistory(args.folioId);
  const latest = history[0];
  if (latest?.html === args.html && !args.force) return null;
  if (
    source === "automatic" &&
    !args.force &&
    latest &&
    now - latest.createdAt < AUTO_INTERVAL_MS
  ) {
    return null;
  }
  const snapshot: RevisionSnapshot = {
    id: crypto.randomUUID(),
    folioId: args.folioId,
    html: args.html,
    createdAt: now,
    label:
      args.label?.trim() ||
      (source === "automatic" ? "Writing checkpoint" : "Saved revision"),
    source,
    wordCount: words(args.html).length,
  };
  await storage.save(
    historyKey(args.folioId),
    [snapshot, ...history].slice(0, MAX_REVISIONS),
  );
  return snapshot;
}

export async function loadRevisionTasks(
  folioId: string,
): Promise<RevisionTask[]> {
  const tasks = await storage.load<RevisionTask[]>(tasksKey(folioId));
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(
      (task) =>
        task &&
        task.folioId === folioId &&
        typeof task.title === "string" &&
        (task.status === "open" || task.status === "done"),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createRevisionTask(args: {
  folioId: string;
  title: string;
  detail?: string;
  sourceId?: string;
  source?: RevisionTask["source"];
  now?: number;
}): Promise<RevisionTask | null> {
  const title = args.title.trim();
  if (!args.folioId || !title) return null;
  const tasks = await loadRevisionTasks(args.folioId);
  if (args.sourceId && tasks.some((task) => task.sourceId === args.sourceId)) {
    return null;
  }
  const task: RevisionTask = {
    id: crypto.randomUUID(),
    folioId: args.folioId,
    title,
    detail: args.detail?.trim() || undefined,
    sourceId: args.sourceId,
    source: args.source ?? "manual",
    status: "open",
    createdAt: args.now ?? Date.now(),
  };
  await storage.save(tasksKey(args.folioId), [task, ...tasks]);
  return task;
}

export async function setRevisionTaskStatus(
  folioId: string,
  taskId: string,
  status: RevisionTask["status"],
  now = Date.now(),
): Promise<RevisionTask[]> {
  const tasks = await loadRevisionTasks(folioId);
  const next = tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status,
          completedAt: status === "done" ? now : undefined,
        }
      : task,
  );
  await storage.save(tasksKey(folioId), next);
  return next;
}

export function compareRevisions(
  beforeHtml: string,
  afterHtml: string,
): RevisionComparison {
  const before = words(beforeHtml);
  const after = words(afterHtml);
  const beforeCounts = new Map<string, number>();
  for (const word of before) {
    beforeCounts.set(word, (beforeCounts.get(word) ?? 0) + 1);
  }
  let shared = 0;
  for (const word of after) {
    const count = beforeCounts.get(word) ?? 0;
    if (count > 0) {
      shared += 1;
      beforeCounts.set(word, count - 1);
    }
  }
  return {
    wordsBefore: before.length,
    wordsAfter: after.length,
    wordsChanged: before.length + after.length - 2 * shared,
    paragraphsBefore: paragraphs(beforeHtml),
    paragraphsAfter: paragraphs(afterHtml),
  };
}
