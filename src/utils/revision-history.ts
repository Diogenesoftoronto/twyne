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

export interface RevisionPassageChange {
  before: string | null;
  after: string | null;
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

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
      const numeric =
        code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    },
  );
}

function passageText(html: string): string[] {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|div)>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split(/\n+/)
    .map((passage) => passage.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function findNearby(
  passages: string[],
  target: string,
  from: number,
  distance: number,
): number {
  const end = Math.min(passages.length, from + distance + 1);
  for (let index = from + 1; index < end; index += 1) {
    if (passages[index] === target) return index;
  }
  return -1;
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

/**
 * Return only the passages that differ between two manuscript versions.
 *
 * Exact passages are used as nearby anchors, so inserting one paragraph does
 * not make every paragraph below it look rewritten. The bounded look-ahead
 * keeps comparison linear for long manuscripts while still handling ordinary
 * editorial insertions and removals cleanly.
 */
export function compareRevisionPassages(
  beforeHtml: string,
  afterHtml: string,
): RevisionPassageChange[] {
  const before = passageText(beforeHtml);
  const after = passageText(afterHtml);
  const changes: RevisionPassageChange[] = [];
  const LOOK_AHEAD = 12;
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < before.length || afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (beforeIndex >= before.length) {
      changes.push({ before: null, after: after[afterIndex++] });
      continue;
    }
    if (afterIndex >= after.length) {
      changes.push({ before: before[beforeIndex++], after: null });
      continue;
    }

    const nextAfterAnchor = findNearby(
      after,
      before[beforeIndex],
      afterIndex,
      LOOK_AHEAD,
    );
    const nextBeforeAnchor = findNearby(
      before,
      after[afterIndex],
      beforeIndex,
      LOOK_AHEAD,
    );

    const afterDistance =
      nextAfterAnchor < 0
        ? Number.POSITIVE_INFINITY
        : nextAfterAnchor - afterIndex;
    const beforeDistance =
      nextBeforeAnchor < 0
        ? Number.POSITIVE_INFINITY
        : nextBeforeAnchor - beforeIndex;

    if (afterDistance < beforeDistance) {
      changes.push({ before: null, after: after[afterIndex++] });
    } else if (beforeDistance < afterDistance) {
      changes.push({ before: before[beforeIndex++], after: null });
    } else {
      changes.push({
        before: before[beforeIndex++],
        after: after[afterIndex++],
      });
    }
  }

  return changes;
}
