import { createLocalLiveInput } from "./live-voice-local-input";
import { parseLocalLiveToolCall } from "./live-voice-local-tools";
import { LIVE_ACTIONS } from "./live-voice-contract";

const descriptions: Record<string, string> = {
  answer: "Answer the writer briefly",
  find: "Find an exact manuscript phrase",
  replace: "Propose replacing an exact passage",
  append: "Propose appending text",
  research: "Search the web",
  open: "Open a panel",
  apply: "Apply the pending edit only after explicit approval",
  discard: "Discard the pending edit",
};
const tools = LIVE_ACTIONS.map((name) =>
  JSON.stringify({
    name,
    description: descriptions[name],
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        original: { type: "string" },
        target: { type: "string" },
      },
      required: [],
    },
  }),
).join("\n");
type WireEvent = { type: string; [key: string]: unknown };

/** An in-process relay with the event names used by the hosted Live client. */
export class LocalLiveTransport {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  readyState = 0;
  readonly bufferedAmount = 0;
  private worker: Worker;
  private instructions = "";
  private nextId = 0;
  private activeId = 0;
  private phase: "idle" | "asr" | "reply" = "idle";
  private transcript = "";
  private currentAudio: Float32Array | null = null;
  private muted = false;
  private closed = false;
  private history: string[] = [];
  private input = createLocalLiveInput({
    interrupt: () => {
      if (this.closed) return;
      this.activeId = ++this.nextId;
      this.phase = "idle";
      this.worker.postMessage({ type: "cancel", id: this.activeId });
      this.onClearAudio();
    },
    turn: (audio) => {
      if (this.closed || this.muted) return;
      this.currentAudio = audio;
      this.phase = "asr";
      this.transcript = "";
      this.activeId = ++this.nextId;
      this.worker.postMessage({
        type: "turn",
        id: this.activeId,
        audio,
        instructions: "",
        mode: "asr",
      });
    },
  });
  constructor(
    private readonly onAudio: (audio: Float32Array) => void,
    private readonly onClearAudio: () => void,
    worker?: Worker,
    private readonly route?: (
      worker: Worker,
    ) => Promise<"local" | "hosted" | "local-slow">,
    private readonly onHosted?: () => void,
  ) {
    this.worker =
      worker ??
      new Worker(
        new URL("../workers/live-voice-local.worker.ts", import.meta.url),
        { type: "module" },
      );
    this.worker.onmessage = ({ data }) => this.handleWorker(data);
    this.worker.onerror = () => this.fail("Local Live worker failed.");
  }
  start() {
    this.worker.postMessage({ type: "load", id: ++this.nextId });
  }
  private emit(event: WireEvent) {
    if (!this.closed) this.onmessage?.({ data: JSON.stringify(event) });
  }
  private fail(message: string) {
    if (!this.closed) this.onerror?.(new Error(message));
  }
  private handleWorker(data: {
    type: string;
    id: number;
    delta?: string;
    samples?: Float32Array;
    message?: string;
  }) {
    if (this.closed) return;
    if (data.type === "loaded") {
      void (async () => {
        try {
          const route = this.route ? await this.route(this.worker) : "local";
          if (this.closed) return;
          if (route === "hosted") {
            this.onHosted?.();
            return;
          }
          this.readyState = 1;
          if (route === "local-slow") this.emit({ type: "twyne.local.slow" });
          this.emit({ type: "twyne.live.ready" });
        } catch (error) {
          this.fail(
            error instanceof Error
              ? error.message
              : "Local Live benchmark failed.",
          );
        }
      })();
      return;
    }
    if (data.type === "error") {
      if (data.id === this.activeId || this.readyState === 0)
        this.fail(data.message || "Local Live failed.");
      return;
    }
    if (data.id !== this.activeId) return;
    if (data.type === "text" && typeof data.delta === "string")
      this.transcript += data.delta;
    if (
      data.type === "audio" &&
      this.phase === "reply" &&
      data.samples instanceof Float32Array
    )
      this.onAudio(data.samples);
    if (data.type !== "done") return;
    if (this.phase === "asr") {
      const text = this.transcript.trim();
      if (text) {
        this.emit({
          type: "session.input_transcript.delta",
          delta: text,
          start_ms: 0,
          end_ms: 0,
        });
        this.history.push(`Writer: ${text}`);
      }
      const audio = this.currentAudio;
      if (!audio || !text) {
        this.phase = "idle";
        return;
      }
      this.phase = "reply";
      this.transcript = "";
      this.activeId = ++this.nextId;
      this.worker.postMessage({
        type: "turn",
        id: this.activeId,
        audio,
        instructions: `Respond with interleaved text and audio.\n${this.instructions}\n\nRecent conversation:\n${this.history.slice(-12).join("\n")}\n\n<tools>\n${tools}\n</tools>`,
        mode: "interleaved",
      });
      return;
    }
    if (this.phase === "reply") {
      const text = this.transcript.trim();
      const action = parseLocalLiveToolCall(text);
      if (action)
        this.emit({
          type: "session.delegation.created",
          offset_ms: 0,
          delegation: { target: "client", id: crypto.randomUUID(), action },
        });
      else if (text) {
        this.emit({
          type: "session.output_transcript.delta",
          delta: text,
          start_ms: 0,
          end_ms: 0,
        });
        this.history.push(`Editor: ${text}`);
      }
      this.phase = "idle";
    }
  }
  send(raw: string) {
    if (this.closed) throw new Error("Local Live is closed.");
    const event = JSON.parse(raw) as WireEvent;
    if (event.type === "session.start") {
      const value = event.session as { instructions?: unknown };
      this.instructions =
        typeof value?.instructions === "string" ? value.instructions : "";
      this.emit({ type: "session.started" });
    } else if (
      event.type === "session.input_audio.append" &&
      !this.muted &&
      typeof event.audio === "string" &&
      typeof event.level === "number"
    )
      this.input.push(event.audio, event.level);
    else if (event.type === "session.input_audio.mute") {
      this.muted = true;
      this.input.reset();
    } else if (event.type === "session.input_audio.unmute") this.muted = false;
    else if (
      event.type === "session.commentary.append" &&
      typeof event.content === "string"
    )
      this.history.push(`Task result: ${event.content}`);
    else if (event.type === "session.close") {
      this.emit({ type: "session.closed" });
      this.close();
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.input.reset();
    this.worker.postMessage({ type: "close", id: ++this.nextId });
    this.worker.terminate();
  }
}
