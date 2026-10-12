// Real offline adapter, real Tiptap image extension, real browser FileReader.
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createImageUploadAdapter } from "../../../../src/utils/image-upload";
import {
  ImageNode,
  insertImageFiles,
} from "../../../../src/components/editor/extensions/image-node";

type Input = { filename: string; mime: string; base64: string };
declare global {
  interface Window {
    importImageFixture: (input: Input) => Promise<unknown>;
  }
}
window.importImageFixture = async (input) => {
  const bytes = Uint8Array.from(atob(input.base64), (character) =>
    character.charCodeAt(0),
  );
  const file = new File([bytes], input.filename, { type: input.mime });
  const adapter = createImageUploadAdapter({ mode: "offline" });
  const uploaded = await adapter.upload(file);
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, ImageNode.configure({ uploadAdapter: adapter })],
    content: "<p>Before.</p>",
  });
  try {
    insertImageFiles(editor, [file], adapter);
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        const image = editor
          .getJSON()
          .content?.find((node) => node.type === "image");
        if (
          image?.attrs?.uploadStatus === "ready" &&
          image.attrs.aspectRatio > 0
        )
          return resolve();
        if (Date.now() >= deadline)
          return reject(
            new Error("Original image node did not finish loading."),
          );
        setTimeout(check, 5);
      };
      check();
    });
    const image = element.querySelector("img")!;
    const node = editor
      .getJSON()
      .content!.find((node) => node.type === "image")!;
    const uploadId = node.attrs!.uploadId;
    return {
      uploaded,
      attrs: { ...node.attrs, uploadId: "<upload-id>" },
      html: editor.getHTML().replaceAll(uploadId, "<upload-id>"),
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    editor.destroy();
    element.remove();
  }
};
