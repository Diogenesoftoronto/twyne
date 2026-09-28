/**
 * Tools the writer chose to keep.
 *
 * A saved tool is a template — the kind plus whatever the writer tuned — and
 * never the passage it was first used on, so it travels between pieces
 * without carrying one draft's words into another. Stored once for the
 * writer, not per folio.
 */
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import { TOOL_KINDS, type ToolKind } from "./struggle-signals";

export interface SavedToolConfig {
  /** Rhythm Strip: the comfortable sentence-length band, in words. */
  targetMin?: number;
  targetMax?: number;
  /** Claim Check: the kinds of support to ask for. */
  slots?: string[];
  /** Reader Questions: the reader to imagine. */
  angle?: string;
}

export interface SavedTool {
  id: string;
  kind: ToolKind;
  name: string;
  config: SavedToolConfig;
  savedAt: number;
}

const KEY = "saved-tools";
const MAX_SAVED = 24;
export const SAVED_TOOLS_EVENT = "twyne:saved-tools";

let storage = { load: loadMetaFromIdb, save: saveMetaToIdb };
export function __setSavedToolsStorageForTests(adapter: typeof storage | null) {
  storage = adapter ?? { load: loadMetaFromIdb, save: saveMetaToIdb };
}

function strings(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.slice(0, 60))
    .slice(0, max);
}

function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : undefined;
}

/** Plain data only — Qwik store proxies fail IndexedDB's structured clone. */
export function normalizeSavedTool(value: unknown): SavedTool | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!TOOL_KINDS.includes(raw.kind as ToolKind)) return null;
  const config = (raw.config ?? {}) as Record<string, unknown>;
  const clean: SavedToolConfig = {};
  const targetMin = int(config.targetMin, 1, 80);
  const targetMax = int(config.targetMax, 2, 120);
  if (targetMin !== undefined) clean.targetMin = targetMin;
  if (targetMax !== undefined) clean.targetMax = targetMax;
  const slots = strings(config.slots, 5);
  if (slots?.length) clean.slots = slots;
  if (typeof config.angle === "string" && config.angle.trim())
    clean.angle = config.angle.trim().slice(0, 200);
  return {
    id: raw.id,
    kind: raw.kind as ToolKind,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : String(raw.kind),
    config: clean,
    savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
  };
}

export async function loadSavedTools(): Promise<SavedTool[]> {
  const value = await storage.load<unknown[]>(KEY);
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSavedTool)
    .filter((tool): tool is SavedTool => tool !== null);
}

async function write(tools: SavedTool[]): Promise<void> {
  const plain = JSON.parse(JSON.stringify(tools)) as SavedTool[];
  await storage.save(KEY, plain);
  // The shared IDB helper absorbs failures; read back so a lost write is loud.
  const check = await loadSavedTools();
  if (check.length !== plain.length)
    throw new Error("Saved tools did not persist");
  window.dispatchEvent(new CustomEvent(SAVED_TOOLS_EVENT, { detail: check }));
}

export async function saveTool(
  tool: Omit<SavedTool, "id" | "savedAt">,
): Promise<SavedTool> {
  const saved = normalizeSavedTool({
    ...tool,
    id: `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
  });
  if (!saved) throw new Error("That tool could not be saved");
  const tools = await loadSavedTools();
  await write([saved, ...tools].slice(0, MAX_SAVED));
  return saved;
}

export async function removeSavedTool(id: string): Promise<void> {
  const tools = await loadSavedTools();
  await write(tools.filter((tool) => tool.id !== id));
}
