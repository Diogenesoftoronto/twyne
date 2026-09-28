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
        loadFonts([regular, bold, italic, boldItalic, mono], { assets: false }),
      ],
    });
    compiler.addSource("/main.typ", data.source);
    for (const asset of data.assets)
      compiler.mapShadow(asset.path, asset.bytes);
    send({ type: "progress", message: "Typesetting your PDF…" });
    const result = await compiler.runWithWorld(
      { mainFilePath: "/main.typ", inputs: {} },
      (world) => world.pdf({ diagnostics: "full" }),
    );
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
    const buffer = new ArrayBuffer(result.result.byteLength);
    const bytes = new Uint8Array(buffer);
    bytes.set(result.result);
    scope.postMessage({ type: "pdf", bytes } satisfies TypstCompileResponse, [
      buffer,
    ]);
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
