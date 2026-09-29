import {
  $,
  component$,
  noSerialize,
  Slot,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import type { EditorPanelState } from "./editor-state";
import type { ProjectBrief } from "../../types";
import type {
  createTypstSession,
  TypstSessionState,
} from "../../utils/typst/session";
import { buildFolioExportPayload } from "../../utils/folio-export";

type Session = Awaited<ReturnType<typeof createTypstSession>>;

export const TypstWorkspace = component$<{
  store: EditorPanelState;
  editor?: NoSerialize<import("@tiptap/core").Editor>;
  readOnly?: boolean;
  folioName: string;
  brief?: ProjectBrief | null;
}>((props) => {
  useStyles$(`
    .typst-workspace{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0}
    .typst-bar{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.45rem .8rem;border-bottom:1px solid var(--color-paper-3);font-size:.75rem;background:var(--color-paper)}
    .typst-bar button,.typst-bar a{padding:.3rem .55rem;border-radius:.2rem}
    .typst-bar button[aria-pressed=true]{background:var(--color-ink);color:var(--color-paper)}
    .typst-bar button:disabled{opacity:.45;cursor:default}
    .typst-status{margin-left:auto;color:var(--color-ink-light)}
    .typst-panes{display:flex;flex:1;min-height:0;overflow:hidden}
    .typst-writing,.typst-source{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
    .typst-source-editor{flex:1;min-height:12rem;overflow:auto}
    .typst-source-note{padding:.65rem 1rem;font-size:.75rem;border-bottom:1px solid var(--color-paper-3)}
    .typst-proof{flex:1;min-width:0;overflow:auto;background:var(--color-paper-soft);padding:1rem;border-left:1px solid var(--color-paper-3)}
    .typst-proof figure{margin:0 auto 1.4rem;max-width:54rem}
    .typst-proof img{display:block;width:100%;height:auto;background:white;box-shadow:0 1px 8px #0002}
    .typst-proof figcaption{text-align:center;font-size:.7rem;color:var(--color-ink-light);padding:.5rem}
    .typst-error{padding:.6rem 1rem;font-size:.8rem;white-space:pre-wrap;max-height:10rem;overflow:auto;border-bottom:1px solid var(--color-paper-3)}
    .typst-workspace [hidden]{display:none!important}
    .twyne-raw-typst{padding:1rem;border:1px dashed var(--color-ink-light);font-size:.8rem;white-space:pre-wrap;overflow-wrap:anywhere}
    .twyne-raw-typst:before{content:'Typst source block';display:block;font-family:var(--font-ui);font-size:.7rem;opacity:.6;margin-bottom:.5rem}
    .twyne-raw-typst-inline{font-family:monospace;background:var(--color-paper-soft)}
    @media(max-width:850px){.typst-proof.typst-split{display:none}.typst-split-toggle{display:none}.typst-status{width:100%;margin-left:0}}
  `);
  const state = useStore<TypstSessionState>({
    source: "",
    dirty: false,
    conflict: false,
    status: "Preparing typesetter…",
    error: "",
    pages: [],
    pdfUrl: "",
    applying: false,
  });
  const mode = useSignal<"write" | "source" | "proof">("write");
  const split = useSignal(false);
  const session = useSignal<NoSerialize<Session>>();
  const code =
    useSignal<
      NoSerialize<
        ReturnType<
          (typeof import("./typst-code-editor"))["mountTypstCodeEditor"]
        >
      >
    >();
  const sourceMount = useSignal<HTMLElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    props.store.typstView = track(() => mode.value);
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const editor = track(() => props.editor);
    const folioId = track(() => props.store.activeFolioId);
    if (!editor || !folioId || !sourceMount.value) return;
    let disposed = false;
    let current: Session | undefined;
    let codeEditor:
      | ReturnType<
          (typeof import("./typst-code-editor"))["mountTypstCodeEditor"]
        >
      | undefined;
    cleanup(() => {
      disposed = true;
      current?.destroy();
      codeEditor?.destroy();
      session.value = undefined;
      code.value = undefined;
      props.store.typstSourcePending = false;
      props.store.typstView = "write";
    });
    try {
      const [{ createTypstSession }, { mountTypstCodeEditor }] =
        await Promise.all([
          import("../../utils/typst/session"),
          import("./typst-code-editor"),
        ]);
      if (disposed) return;
      codeEditor = mountTypstCodeEditor(sourceMount.value, "", {
        readOnly: true,
        onChange: (source) => current?.changeSource(source),
        onApply: () => {
          void current?.apply();
        },
      });
      code.value = noSerialize(codeEditor);
      current = await createTypstSession({
        editor,
        folioId,
        readOnly: !!props.readOnly,
        onState: (next) => {
          if (disposed) return;
          Object.assign(state, next);
          props.store.typstSourcePending = next.dirty || next.applying;
          codeEditor?.setSource(next.source);
          codeEditor?.setReadOnly(
            !current || !!props.readOnly || next.applying,
          );
        },
        getPayload: (source) =>
          buildFolioExportPayload({
            folioId,
            folioName: props.folioName,
            brief: props.brief,
            layout: props.store.layout,
            header: props.store.headerText,
            footer: props.store.footerText,
            typstSource: source,
          }),
        onPages: (count) => {
          props.store.pageCount = count;
          props.store.paginationActive = false;
        },
      });
      if (disposed) {
        current.destroy();
        return;
      }
      session.value = noSerialize(current);
      codeEditor.setReadOnly(!!props.readOnly || state.applying);
      if (state.dirty) mode.value = "source";
    } catch (error) {
      if (!disposed) {
        state.error = String(error);
        state.status = "Typesetter unavailable";
      }
    }
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => JSON.stringify(props.store.layout));
    track(() => props.store.headerText);
    track(() => props.store.footerText);
    session.value?.refreshProof();
  });
  const saveSourceCopy = $(() => {
    const url = URL.createObjectURL(
      new Blob([state.source], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.folioName || "Untitled"}.typ`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return (
    <section class="typst-workspace" aria-label="Manuscript workspace">
      <div class="typst-bar">
        <div role="group" aria-label="Editor view">
          <button
            type="button"
            aria-pressed={mode.value === "write"}
            onClick$={() => {
              mode.value = "write";
            }}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={mode.value === "source"}
            onClick$={() => {
              mode.value = "source";
              code.value?.focus();
            }}
          >
            Source
          </button>
          <button
            type="button"
            aria-pressed={mode.value === "proof"}
            onClick$={() => {
              mode.value = "proof";
            }}
          >
            Proof
          </button>
        </div>
        {mode.value !== "proof" && (
          <button
            type="button"
            class="typst-split-toggle"
            aria-pressed={split.value}
            onClick$={() => {
              split.value = !split.value;
            }}
          >
            Show proof
          </button>
        )}
        {state.dirty && (
          <>
            <button
              type="button"
              disabled={!!props.readOnly || state.applying || state.conflict}
              onClick$={async () => {
                await session.value?.apply();
              }}
            >
              {" "}
              {state.applying ? "Applying…" : "Apply source"}
            </button>
            <button
              type="button"
              disabled={state.applying}
              onClick$={async () => {
                await session.value?.discard();
              }}
            >
              Discard source changes
            </button>
          </>
        )}
        {mode.value === "source" && (
          <button type="button" onClick$={saveSourceCopy}>
            Save source copy
          </button>
        )}
        {state.pdfUrl && !state.error && (
          <a
            href={state.pdfUrl}
            download={`${props.folioName || "Untitled"}.pdf`}
          >
            {state.dirty ? "Draft PDF" : "PDF"}
          </a>
        )}
        <span class="typst-status" role="status">
          {state.status}
        </span>
      </div>
      {state.conflict && (
        <p class="typst-error" role="alert">
          The manuscript changed while you were editing source. Save your source
          copy, then discard these source changes to load the latest manuscript.
        </p>
      )}
      {state.error && (
        <pre class="typst-error" role="alert">
          {state.error}
        </pre>
      )}
      <div class="typst-panes">
        <div class="typst-writing" hidden={mode.value !== "write"}>
          <Slot />
        </div>
        <div class="typst-source" hidden={mode.value !== "source"}>
          <p class="typst-source-note">
            {state.dirty
              ? "Source changes are kept on this device. Apply them to update the manuscript. ⌘/Ctrl Enter to apply."
              : "Edit native Typst here. Custom Typst remains intact as source blocks in Write."}
          </p>
          <div ref={sourceMount} class="typst-source-editor" />
        </div>
        <div
          class={{ "typst-proof": true, "typst-split": mode.value !== "proof" }}
          hidden={mode.value !== "proof" && !split.value}
          aria-label="Typeset pages"
        >
          {!state.pages.length && <p>Typeset pages will appear here.</p>}
          {state.pages.map((page, index) => (
            <figure key={page}>
              <img
                src={page}
                width={800}
                height={1130}
                alt={`Typeset page ${index + 1}`}
              />
              <figcaption>
                Page {index + 1} of {state.pages.length}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
});
