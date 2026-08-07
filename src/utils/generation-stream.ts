import {
  extractTaggedReasoning,
  hasOpenReasoningBlock,
} from "./interview-stream";
import { stripReasoningTags, trimPartialReasoningTag } from "./reasoning-tags";

export type StreamPartStatus = "pending" | "running" | "complete";
export type StreamRunStatus = "running" | "complete" | "error";

/**
 * Framework-neutral equivalent of assistant-ui's message content-part state.
 * Text and reasoning have independent lifecycles; `activePart` tells a view
 * which part is currently receiving deltas.
 */
export interface GenerationStreamSnapshot {
  text: string;
  reasoning: string;
  activePart: "reasoning" | "text" | null;
  textStatus: StreamPartStatus;
  reasoningStatus: StreamPartStatus;
  status: StreamRunStatus;
}

export type GenerationStreamInput =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-end" }
  | { type: "finish" }
  | { type: "error" };

export function createGenerationStreamAccumulator(): {
  push: (input: GenerationStreamInput) => GenerationStreamSnapshot;
  snapshot: () => GenerationStreamSnapshot;
} {
  let rawText = "";
  let nativeReasoning = "";
  let textStarted = false;
  let reasoningStarted = false;
  let reasoningEnded = false;
  let status: StreamRunStatus = "running";

  const snapshot = (): GenerationStreamSnapshot => {
    const taggedReasoning = extractTaggedReasoning(rawText);
    const reasoning = [nativeReasoning.trim(), taggedReasoning]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n\n");
    const taggedReasoningRunning = hasOpenReasoningBlock(rawText);
    const reasoningRunning =
      status === "running" &&
      (taggedReasoningRunning ||
        (reasoningStarted && !reasoningEnded && !textStarted));
    // While tokens are still arriving, a trailing `<th` may yet become a
    // `<think>`; hold it back rather than paint and retract it.
    const stripped = stripReasoningTags(rawText);
    const text =
      status === "running" ? trimPartialReasoningTag(stripped) : stripped;

    return {
      text,
      reasoning,
      activePart:
        status !== "running"
          ? null
          : reasoningRunning
            ? "reasoning"
            : textStarted
              ? "text"
              : null,
      textStatus:
        textStarted && status === "running"
          ? "running"
          : textStarted
            ? "complete"
            : "pending",
      reasoningStatus: reasoningRunning
        ? "running"
        : reasoning
          ? "complete"
          : "pending",
      status,
    };
  };

  return {
    push(input) {
      switch (input.type) {
        case "text-delta":
          rawText += input.text;
          textStarted = true;
          break;
        case "reasoning-start":
          reasoningStarted = true;
          reasoningEnded = false;
          break;
        case "reasoning-delta":
          reasoningStarted = true;
          nativeReasoning += input.text;
          break;
        case "reasoning-end":
          reasoningEnded = true;
          break;
        case "finish":
          reasoningEnded = true;
          status = "complete";
          break;
        case "error":
          reasoningEnded = true;
          status = "error";
          break;
      }
      return snapshot();
    },
    snapshot,
  };
}

/**
 * A snapshot for callers holding finished text and no reasoning — the reset
 * before a retry, and the final value a generation commits to. Lets every
 * consumer of a stream callback take one shape, whether the text arrived a
 * token at a time or all at once.
 */
export function textSnapshot(
  text: string,
  status: StreamRunStatus = "complete",
): GenerationStreamSnapshot {
  return {
    text,
    reasoning: "",
    activePart: null,
    textStatus: text
      ? status === "running"
        ? "running"
        : "complete"
      : "pending",
    reasoningStatus: "pending",
    status,
  };
}

/**
 * Rebuild a snapshot from a persisted stream row.
 *
 * The server path stores the same three facts the accumulator derives — text,
 * reasoning, which one is arriving — so a note streamed from Convex reaches
 * the panel in the shape a note streamed in the browser does, and the view has
 * one case to render instead of two.
 */
export function snapshotFromRecord(row: {
  text: string;
  reasoning: string;
  phase: "reasoning" | "answer";
  status: StreamRunStatus;
}): GenerationStreamSnapshot {
  const running = row.status === "running";
  const reasoningActive = running && row.phase === "reasoning";
  return {
    text: row.text,
    reasoning: row.reasoning,
    activePart: !running ? null : reasoningActive ? "reasoning" : "text",
    textStatus: row.text ? (running ? "running" : "complete") : "pending",
    reasoningStatus: reasoningActive
      ? "running"
      : row.reasoning
        ? "complete"
        : "pending",
    status: row.status,
  };
}

/**
 * Keep token-rate provider events from forcing token-rate component renders.
 * The latest cumulative snapshot is delivered once per animation frame.
 */
export function createFrameCoalescer<T>(callback: (value: T) => void): {
  push: (value: T) => void;
  flush: () => void;
  cancel: () => void;
} {
  let pending: T | undefined;
  let scheduled = false;
  let frame: number | null = null;

  const deliver = () => {
    scheduled = false;
    frame = null;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    callback(value);
  };

  return {
    push(value) {
      pending = value;
      if (scheduled) return;
      scheduled = true;
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(deliver);
      } else {
        queueMicrotask(deliver);
      }
    },
    flush() {
      if (frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
      deliver();
    },
    cancel() {
      if (frame !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame);
      }
      frame = null;
      scheduled = false;
      pending = undefined;
    },
  };
}

/**
 * The same restraint as {@link createFrameCoalescer}, for a caller with no
 * frames to coalesce against.
 *
 * A server action publishing a note in flight pays a database transaction per
 * write, while the browser reading it repaints once per frame no matter how
 * many arrive — so writing at token rate buys the reader nothing and costs the
 * room a round trip per token, five streams at a time. This decides which
 * snapshots are worth the trip: the first one, a steady cadence after it, and
 * always the last.
 *
 * Only mid-flight snapshots are ever dropped. A terminal snapshot carries
 * everything accumulated since the last write, so nothing the model said is
 * lost by holding back the ones in between.
 */
export function createPublishGate(
  intervalMs: number,
  now: () => number = Date.now,
): (
  snapshot: Pick<GenerationStreamSnapshot, "text" | "reasoning" | "status">,
) => boolean {
  let lastText: string | null = null;
  let lastReasoning = "";
  let lastAt = -Infinity;

  return (snapshot) => {
    if (snapshot.status === "running") {
      // A step boundary or a tool call moves the stream on without changing a
      // character of what the reader sees.
      if (snapshot.text === lastText && snapshot.reasoning === lastReasoning) {
        return false;
      }
      if (now() - lastAt < intervalMs) return false;
    }
    lastText = snapshot.text;
    lastReasoning = snapshot.reasoning;
    lastAt = now();
    return true;
  };
}
