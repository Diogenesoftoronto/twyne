import {
  LIVE_ACTIONS,
  parseLiveAction,
  type LiveAction,
} from "./live-voice-contract";

/** Parse the checkpoint's tool-call markup without executing or guessing an action. */
export function parseLocalLiveToolCall(text: string): LiveAction | null {
  const call = text
    .trim()
    .match(
      /^<tool_call>\s*<function=([a-z_]+)>\s*([\s\S]*?)\s*<\/function>\s*<\/tool_call>$/,
    );
  if (!call || !LIVE_ACTIONS.includes(call[1] as LiveAction["kind"]))
    return null;
  const fields: Record<string, string> = { text: "", original: "", target: "" };
  const seen = new Set<string>();
  const pattern =
    /<parameter=(text|original|target)>\s*([\s\S]*?)\s*<\/parameter>/g;
  let end = 0;
  for (const match of call[2].matchAll(pattern)) {
    if (call[2].slice(end, match.index).trim() || seen.has(match[1]))
      return null;
    const value = match[2];
    if (value.includes("<parameter=") || value.includes("</parameter>"))
      return null;
    fields[match[1]] = value;
    seen.add(match[1]);
    end = (match.index ?? 0) + match[0].length;
  }
  if (call[2].slice(end).trim()) return null;
  try {
    return parseLiveAction(JSON.stringify({ kind: call[1], ...fields }));
  } catch {
    return null;
  }
}
