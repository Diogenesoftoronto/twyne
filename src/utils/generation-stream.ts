import {
  extractTaggedReasoning,
  hasOpenReasoningBlock,
} from "./interview-stream";
import { stripReasoningTags } from "./reasoning-tags";

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
    const text = stripReasoningTags(rawText);

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
 * Keep token-rate provider events from forcing token-rate component renders.
 * The latest cumulative snapshot is delivered once per animation frame.
 */
export function createFrameCoalescer<T>(
  callback: (value: T) => void,
): {
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
