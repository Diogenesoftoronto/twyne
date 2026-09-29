import mathFont from "../../assets/typst/LibertinusMath-Regular.otf?url";
import manuscriptFont0 from "../../assets/typst/dmsans-DMSans-Italic-opsz-wght.ttf?url";
import manuscriptFont1 from "../../assets/typst/dmsans-DMSans-opsz-wght.ttf?url";
import manuscriptFont2 from "../../assets/typst/fraunces-Fraunces-Italic-SOFT-WONK-opsz-wght.ttf?url";
import manuscriptFont3 from "../../assets/typst/fraunces-Fraunces-SOFT-WONK-opsz-wght.ttf?url";
import manuscriptFont4 from "../../assets/typst/librebaskerville-LibreBaskerville-Italic-wght.ttf?url";
import manuscriptFont5 from "../../assets/typst/librebaskerville-LibreBaskerville-wght.ttf?url";
import manuscriptFont6 from "../../assets/typst/lora-Lora-Italic-wght.ttf?url";
import manuscriptFont7 from "../../assets/typst/lora-Lora-wght.ttf?url";
import manuscriptFont8 from "../../assets/typst/specialelite-SpecialElite-Regular.ttf?url";
import { createTypstRenderer } from "@myriaddreamin/typst.ts/renderer";
import rendererWasmUrl from "@myriaddreamin/typst-ts-renderer/wasm?url";
import { createTypstCompiler } from "@myriaddreamin/typst.ts/compiler";
import { loadFonts } from "@myriaddreamin/typst.ts/options.init";
import wasmUrl from "@myriaddreamin/typst-ts-web-compiler/wasm?url";
import regular from "../../assets/typst/LibertinusSerif-Regular.otf?url";
import bold from "../../assets/typst/LibertinusSerif-Bold.otf?url";
import italic from "../../assets/typst/LibertinusSerif-Italic.otf?url";
import boldItalic from "../../assets/typst/LibertinusSerif-BoldItalic.otf?url";
import mono from "../../assets/typst/DejaVuSansMono.ttf?url";
import type { TypstCompileRequest, TypstCompileResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: TypstCompileResponse) => scope.postMessage(message);

// One export per worker: termination releases the WASM heap, manuscript, and images.
scope.onmessage = async ({ data }: MessageEvent<TypstCompileRequest>) => {
  try {
    send({ type: "progress", message: "Loading the typesetter…" });
    const compiler = createTypstCompiler();
    await compiler.init({
      getModule: () => wasmUrl,
      beforeBuild: [
        loadFonts(
          [
            regular,
            bold,
            italic,
            boldItalic,
            mono,
            mathFont,
            manuscriptFont0,
            manuscriptFont1,
            manuscriptFont2,
            manuscriptFont3,
            manuscriptFont4,
            manuscriptFont5,
            manuscriptFont6,
            manuscriptFont7,
            manuscriptFont8,
          ],
          { assets: false },
        ),
      ],
    });
    compiler.addSource("/main.typ", data.source);
    for (const asset of data.assets)
      compiler.mapShadow(asset.path, asset.bytes);
    send({ type: "progress", message: "Typesetting your PDF…" });
    const compiled = await compiler.runWithWorld(
      { mainFilePath: "/main.typ", inputs: {} },
      async (world) => ({
        pdf: await world.pdf({ diagnostics: "full" }),
        vector: await world.vector({ diagnostics: "full" }),
      }),
    );
    const result = compiled.pdf;
    if (!result.result) {
      const details = result.diagnostics
        ?.map((d) => d.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(details || "The typesetter could not create a PDF.");
    }
    // Missing glyph warnings matter: do not hand the writer a PDF with lost text.
    const missingGlyph = result.diagnostics?.find((d) =>
      /missing glyph|no glyph|does not contain.*glyph|no font found for|no font.*supports.*character/i.test(
        d.message,
      ),
    );
    if (missingGlyph)
      throw new Error(
        "The bundled fonts cannot display part of this manuscript. Use PDF… to export it with your editor fonts.",
      );
    if (!compiled.vector.result)
      throw new Error("The typesetter could not render the proof.");
    send({ type: "progress", message: "Rendering proof pages…" });
    const renderer = createTypstRenderer();
    await renderer.init({ getModule: () => rendererWasmUrl });
    const proof = await renderer.runWithSession(
      { format: "vector", artifactContent: compiled.vector.result },
      async (session) => ({
        svg: await session.renderSvg({
          data_selection: { body: true, defs: true, css: true, js: false },
        }),
        pageSizes: session
          .retrievePagesInfo()
          .map((page) => ({ width: page.width, height: page.height })),
      }),
    );
    const buffer = new ArrayBuffer(result.result.byteLength);
    const bytes = new Uint8Array(buffer);
    bytes.set(result.result);
    scope.postMessage(
      { type: "pdf", bytes, ...proof } satisfies TypstCompileResponse,
      [buffer],
    );
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The typesetter could not create a PDF.",
    });
  }
};
