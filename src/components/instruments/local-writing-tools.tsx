import {
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
  noSerialize,
  type NoSerialize,
  type PropFunction,
  useStylesScoped$,
  $,
} from "@qwik.dev/core";
import {
  LOCAL_WRITING_PACKS,
  cosineSimilarity,
  type LocalWritingPack,
} from "../../utils/local-writing-manifest";
import {
  downloadLocalWriting,
  removeLocalWriting,
  localWritingStatus,
  localWritingSupported,
  embedWritingPassages,
  decodeWritingAudio,
  transcribeWritingAudio,
  stopLocalWriting,
} from "../../utils/local-writing-models";
import type { ModelDownloadState } from "../../utils/models-cache";
import { inFlowController } from "../editor/extensions/struggle-tracker";
import { completeSentence } from "../../utils/sentence-ledger";
import { InstrumentArt } from "./instrument-art";
import { InstrumentMotion, InstrumentMotionPart } from "./instrument-motion";

type Recording = { stop(): Promise<Blob>; cancel(): void };
async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const result = new Promise<Blob>((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
  });
  recorder.start();
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    return result;
  };
  const timer = setTimeout(() => void stop(), 60_000);
  return {
    stop,
    cancel: () => {
      void stop();
    },
  };
}
export const LocalWritingTools = component$<{
  selectedText?: string;
  onCandidate$?: PropFunction<() => void>;
}>((props) => {
  useStylesScoped$(`
    .local-tools { font:.9rem/1.6 var(--font-sans); }
    h2 { font:600 1.6rem var(--font-display); margin:.5rem 0; }
    h3 { font:600 1.05rem var(--font-display); margin:0; }
    .pack { border-top:1px solid var(--color-paper-3); padding:1rem 0; }
    .pack p { margin:.4rem 0; max-width:65ch; }
    .meta { font:.75rem/1.5 var(--font-typewriter); color:var(--color-ink-light); }
    button { border:1px solid var(--color-ink); padding:.4rem .7rem; margin:.4rem .5rem .4rem 0; background:var(--color-paper-2); color:var(--color-ink); cursor:pointer; }
    button:disabled { opacity:.5; cursor:default; }
    textarea { display:block; width:100%; min-height:8rem; padding:.7rem; margin:.5rem 0; color:var(--color-ink); background:var(--color-paper); border:1px solid var(--color-ink-light); font:1rem/1.7 var(--font-serif); }
    progress { width:100%; accent-color:var(--color-ink); }
    blockquote { border-left:2px solid var(--color-ink-light); padding-left:.7rem; margin:.7rem 0; font-family:var(--font-serif); }
    .result { background:var(--color-paper-2); padding:1rem; }
    :focus-visible { outline:2px solid var(--color-ink); outline-offset:3px; }
  `);
  const statuses = useStore<
    Partial<Record<LocalWritingPack, ModelDownloadState>>
  >({});
  const supported = useSignal(false),
    busy = useSignal(""),
    notice = useSignal("");
  const passage = useSignal(props.selectedText ?? ""),
    transcript = useSignal("");
  const comparison = useStore<{
    pairs: Array<{ a: string; b: string; similarity: number }>;
  }>({ pairs: [] });
  const abort = useSignal<NoSerialize<AbortController>>();
  const recording = useSignal<NoSerialize<Recording>>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    supported.value = localWritingSupported();
    for (const key of Object.keys(LOCAL_WRITING_PACKS) as LocalWritingPack[])
      void localWritingStatus(key).then((value) => (statuses[key] = value));
    cleanup(() => {
      abort.value?.abort();
      recording.value?.cancel();
      stopLocalWriting();
    });
  });
  const download = $(async (pack: LocalWritingPack) => {
    busy.value = pack;
    notice.value = "";
    abort.value = noSerialize(new AbortController());
    try {
      await downloadLocalWriting(pack, {
        signal: abort.value?.signal,
        onProgress: (value) => (statuses[pack] = value),
      });
      statuses[pack] = await localWritingStatus(pack);
      notice.value = "Pack downloaded and loaded on this device.";
    } catch (error) {
      notice.value =
        error instanceof Error
          ? error.message
          : "The pack could not be loaded.";
      statuses[pack] = await localWritingStatus(pack);
    } finally {
      busy.value = "";
      abort.value = undefined;
    }
  });
  const transcribe = $(async (blob: Blob) => {
    busy.value = "transcribing";
    notice.value = "";
    try {
      transcript.value = await transcribeWritingAudio(
        await decodeWritingAudio(blob),
      );
    } catch (error) {
      notice.value =
        error instanceof Error ? error.message : "Transcription failed.";
    } finally {
      busy.value = "";
    }
  });
  return (
    <section class="local-tools" aria-label="On-device writing tools">
      <InstrumentArt kind="sentence-bench" size="compact" />
      <h2>A few tools to keep on your device</h2>
      <p>
        Download only the packs you want. Your writing and recordings stay on
        this device during these operations. Model files come from Hugging Face;
        the shared inference runtime comes from jsDelivr and is cached
        separately. English is the supported language for these packs.
      </p>
      <p class="meta">
        No account credit. The first load takes longer. Keep this page available
        until a download and its first load finish; browser storage can be
        evicted.
      </p>
      {!supported.value && (
        <p role="status">
          These packs require browser workers, WebAssembly and local storage.
        </p>
      )}
      {(Object.keys(LOCAL_WRITING_PACKS) as LocalWritingPack[]).map((pack) => (
        <div class="pack" key={pack}>
          <h3>{LOCAL_WRITING_PACKS[pack].label}</h3>
          <p>{LOCAL_WRITING_PACKS[pack].description}</p>
          <p class="meta">
            {(
              LOCAL_WRITING_PACKS[pack].files.reduce(
                (sum, f) => sum + f.size,
                0,
              ) / 1_000_000
            ).toFixed(1)}{" "}
            MB model pack ·{" "}
            {statuses[pack]?.phase === "ready"
              ? "Saved on this device"
              : "Not fully downloaded"}
          </p>
          {busy.value === pack && (
            <progress
              max={1}
              value={statuses[pack]?.progress ?? 0}
              aria-label={`Download ${LOCAL_WRITING_PACKS[pack].label}`}
            />
          )}
          <button
            type="button"
            disabled={!supported.value || !!busy.value}
            onClick$={() => download(pack)}
          >
            {statuses[pack]?.phase === "ready"
              ? "Load / check pack"
              : "Download & load"}
          </button>
          {!!statuses[pack]?.downloadedBytes && (
            <button
              type="button"
              disabled={!!busy.value}
              onClick$={async () => {
                await removeLocalWriting(pack);
                statuses[pack] = await localWritingStatus(pack);
              }}
            >
              Remove pack
            </button>
          )}
          {busy.value === pack && (
            <button
              type="button"
              onClick$={() => {
                abort.value?.abort();
                stopLocalWriting();
              }}
            >
              Stop download
            </button>
          )}
        </div>
      ))}
      <section class="pack">
        <h3>Compare nearby passages</h3>
        <label>
          Passages, separated by a blank line
          <textarea
            value={passage.value}
            maxLength={16000}
            onInput$={(_, el) => (passage.value = el.value)}
          />
        </label>
        <button
          type="button"
          disabled={!!busy.value || statuses.embeddings?.phase !== "ready"}
          onClick$={async () => {
            busy.value = "comparing";
            notice.value = "";
            try {
              const pieces = passage.value
                .split(/\n\s*\n/)
                .map((t) => t.trim())
                .filter(Boolean);
              if (pieces.length < 2)
                throw new Error(
                  "Add at least two passages separated by a blank line.",
                );
              const vectors = await embedWritingPassages(pieces);
              comparison.pairs = pieces.slice(1).map((b, i) => ({
                a: pieces[i],
                b,
                similarity: cosineSimilarity(vectors[i], vectors[i + 1]),
              }));
            } catch (error) {
              notice.value =
                error instanceof Error ? error.message : "Comparison failed.";
            } finally {
              busy.value = "";
            }
          }}
        >
          Compare on this device
        </button>
        <InstrumentMotion state={comparison.pairs.length ? "arrive" : "rest"}>
          <InstrumentMotionPart part="result">
            {comparison.pairs.map((pair, i) => (
              <div class="result" key={i}>
                <p class="meta">
                  Neighbouring passages {i + 1} / {i + 2} · cosine similarity{" "}
                  {pair.similarity.toFixed(2)}
                </p>
                <blockquote>{pair.a}</blockquote>
                <blockquote>{pair.b}</blockquote>
                <p>
                  Look for repeated work or a missing transition. This number
                  does not establish either.
                </p>
              </div>
            ))}
          </InstrumentMotionPart>
        </InstrumentMotion>
      </section>
      <section class="pack">
        <h3>Say what you mean</h3>
        <p>
          Record up to one minute, or choose an audio clip. Review and edit the
          transcript before using it.
        </p>
        {!recording.value ? (
          <button
            type="button"
            disabled={!!busy.value || statuses.speech?.phase !== "ready"}
            onClick$={async () => {
              try {
                recording.value = noSerialize(await startRecording());
                notice.value =
                  "Recording; microphone stops automatically after one minute.";
              } catch {
                notice.value =
                  "Microphone access was unavailable. You can choose an audio file.";
              }
            }}
          >
            Start recording
          </button>
        ) : (
          <button
            type="button"
            onClick$={async () => {
              const audio = await recording.value!.stop();
              recording.value = undefined;
              await transcribe(audio);
            }}
          >
            Stop & transcribe
          </button>
        )}
        <label>
          Choose audio{" "}
          <input
            type="file"
            accept="audio/*"
            disabled={
              !!busy.value ||
              !!recording.value ||
              statuses.speech?.phase !== "ready"
            }
            onChange$={async (_, el) => {
              const file = el.files?.[0];
              if (file) await transcribe(file);
              el.value = "";
            }}
          />
        </label>
        {transcript.value && (
          <>
            <label>
              Your editable transcript
              <textarea
                value={transcript.value}
                onInput$={(_, el) => (transcript.value = el.value)}
              />
            </label>
            <p class="meta">
              Spoken wording · Whisper tiny.en · may contain transcription
              errors
            </p>
            <button
              type="button"
              disabled={
                !completeSentence(transcript.value) ||
                !props.selectedText?.trim()
              }
              onClick$={async () => {
                const controller = inFlowController();
                controller?.openKind("sentence-lab", props.selectedText);
                if (await controller?.acceptSpokenCandidate(transcript.value))
                  await props.onCandidate$?.();
                else
                  notice.value =
                    "The sentence changed, or the transcript needs a grammar correction. Review it before trying again.";
              }}
            >
              Use as a sentence candidate
            </button>
            {!props.selectedText?.trim() && (
              <p>
                Select a sentence in the manuscript before opening these tools
                to compare it with your transcript.
              </p>
            )}
          </>
        )}
      </section>
      {busy.value && (
        <p role="status">
          {busy.value === "transcribing"
            ? "Transcribing on this device…"
            : busy.value === "comparing"
              ? "Comparing on this device…"
              : "Downloading and preparing the pack…"}
        </p>
      )}
      {notice.value && <p role="status">{notice.value}</p>}
    </section>
  );
});
