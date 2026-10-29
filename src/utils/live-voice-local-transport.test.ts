import { expect, test } from "bun:test";
import { LocalLiveTransport } from "./live-voice-local-transport";

test("voice activity interrupts playback and turns worker messages into Live events", () => {
  const sent: Array<Record<string, unknown>> = [];
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null,
    postMessage: (data: Record<string, unknown>) => sent.push(data),
    terminate: () => {},
  };
  let clears = 0;
  const transport = new LocalLiveTransport(
    () => {},
    () => clears++,
    worker as unknown as Worker,
  );
  const events: Array<Record<string, any>> = [];
  transport.onmessage = ({ data }) => events.push(JSON.parse(data));
  transport.start();
  worker.onmessage?.({ data: { type: "loaded", id: 1 } });
  transport.send(
    JSON.stringify({
      type: "session.start",
      session: { instructions: "Help the writer." },
    }),
  );
  const audio = btoa(String.fromCharCode(...new Uint8Array(4800)));
  for (let i = 0; i < 3; i++)
    transport.send(
      JSON.stringify({ type: "session.input_audio.append", audio, level: 0.2 }),
    );
  for (let i = 0; i < 8; i++)
    transport.send(
      JSON.stringify({ type: "session.input_audio.append", audio, level: 0 }),
    );
  expect(clears).toBe(1);
  const asr = sent.at(-1)!;
  expect(asr.mode).toBe("asr");
  worker.onmessage?.({
    data: { type: "text", id: asr.id, delta: "Find the word." },
  });
  worker.onmessage?.({ data: { type: "done", id: asr.id } });
  const reply = sent.at(-1)!;
  expect(reply.mode).toBe("interleaved");
  worker.onmessage?.({
    data: {
      type: "text",
      id: reply.id,
      delta:
        "<tool_call><function=find><parameter=text>word</parameter></function></tool_call>",
    },
  });
  worker.onmessage?.({ data: { type: "done", id: reply.id } });
  expect(
    events.find((e) => e.type === "session.input_transcript.delta")?.delta,
  ).toBe("Find the word.");
  expect(
    events.find((e) => e.type === "session.delegation.created")?.delegation
      .action,
  ).toEqual({ kind: "find", text: "word", original: "", target: "" });
  transport.close();
});
