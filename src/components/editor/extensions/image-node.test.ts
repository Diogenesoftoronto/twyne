import { describe, expect, test } from "bun:test";
import type { ImageUploadAdapter } from "../../../utils/image-upload";
import { withEditor } from "../test-harness";
import {
  ImageNode,
  imageWidthFromPointerDelta,
  insertImageFiles,
  normalizeImageWidth,
} from "./image-node";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("image node", () => {
  test("serializes alt text, caption, alignment, width, and aspect ratio portably", async () => {
    await withEditor(
      {
        extensions: [ImageNode],
        content:
          '<figure data-type="image" data-image-align="right" data-image-width="50" data-image-aspect-ratio="1.5"><img src="https://example.test/image.png" alt="A storm over a harbour"><figcaption>Weather moving in</figcaption></figure>',
      },
      ({ editor }) => {
        const attrs = editor.state.doc.firstChild?.attrs;
        expect(attrs).toMatchObject({
          src: "https://example.test/image.png",
          alt: "A storm over a harbour",
          caption: "Weather moving in",
          alignment: "right",
          width: 50,
          aspectRatio: 1.5,
        });

        const html = editor.getHTML();
        expect(html).toContain('alt="A storm over a harbour"');
        expect(html).toContain('data-alt-text="A storm over a harbour"');
        expect(html).toContain('data-image-align="right"');
        expect(html).toContain('data-image-width="50"');
        expect(html).toContain("<figcaption>Weather moving in</figcaption>");
        expect(html).toContain("height: auto");
      },
    );
  });

  test("NodeView exposes locked-ratio resize handles and visible caption", async () => {
    await withEditor(
      {
        extensions: [ImageNode],
        content:
          '<figure data-type="image" data-image-width="75"><img src="https://example.test/image.png" alt="Map"><figcaption>Route map</figcaption></figure>',
      },
      ({ host }) => {
        const figure = host.querySelector<HTMLElement>(".twyne-image-node")!;
        const image = figure.querySelector<HTMLImageElement>("img")!;
        expect(figure.dataset.aspectRatioLocked).toBe("true");
        expect(figure.style.width).toBe("75%");
        expect(image.style.height).toBe("auto");
        expect(figure.querySelector("figcaption")?.textContent).toBe(
          "Route map",
        );
        expect(figure.querySelector('[data-image-resize="left"]')).toBeTruthy();
        expect(
          figure.querySelector('[data-image-resize="right"]'),
        ).toBeTruthy();
      },
    );
  });

  test("resize arithmetic uses horizontal movement and preserves bounded width", () => {
    expect(imageWidthFromPointerDelta(50, 100, 1000, "right")).toBe(60);
    expect(imageWidthFromPointerDelta(50, 100, 1000, "left")).toBe(40);
    expect(imageWidthFromPointerDelta(95, 500, 1000, "right")).toBe(100);
    expect(normalizeImageWidth(1)).toBe(10);
  });

  test("successful uploads replace the pending marker with the returned URL", async () => {
    const adapter: ImageUploadAdapter = {
      mode: "online",
      async upload(_file, onProgress) {
        onProgress?.({ phase: "uploading", progress: 0.5 });
        return {
          src: "https://files.example.test/image-1",
          storage: "convex",
          imageId: "image-1",
          contentType: "image/png",
          size: 3,
        };
      },
    };

    await withEditor({ extensions: [ImageNode] }, async ({ editor }) => {
      insertImageFiles(
        editor,
        [new File([new Uint8Array(3)], "cover.png", { type: "image/png" })],
        adapter,
      );
      await settle();

      const attrs = editor.state.doc.firstChild?.attrs;
      expect(attrs).toMatchObject({
        src: "https://files.example.test/image-1",
        imageId: "image-1",
        uploadStatus: "ready",
        uploadProgress: 1,
        offline: false,
      });
      expect(editor.getHTML()).not.toContain("data:image");
      expect(editor.getHTML()).not.toContain("blob:");
    });
  });

  test("failed online uploads remain visible and retryable without serializing base64", async () => {
    const adapter: ImageUploadAdapter = {
      mode: "online",
      async upload() {
        throw new Error("Connection lost");
      },
    };

    await withEditor(
      { extensions: [ImageNode.configure({ uploadAdapter: adapter })] },
      async ({ editor, host }) => {
        const [uploadId] = insertImageFiles(
          editor,
          [new File([new Uint8Array(3)], "cover.png", { type: "image/png" })],
          adapter,
        );
        await settle();

        expect(uploadId).toBeString();
        expect(editor.state.doc.firstChild?.attrs).toMatchObject({
          src: "",
          uploadId,
          uploadStatus: "failed",
          uploadError: "Connection lost",
        });
        expect(host.querySelector("[data-image-retry]")).toBeTruthy();
        expect(editor.getHTML()).not.toContain("data:image");
        expect(editor.getHTML()).not.toContain("blob:");
      },
    );
  });

  test("explicit offline uploads retain their data URL and mark the node", async () => {
    const adapter: ImageUploadAdapter = {
      mode: "offline",
      async upload() {
        return {
          src: "data:image/png;base64,AQID",
          storage: "inline",
          imageId: null,
          contentType: "image/png",
          size: 3,
        };
      },
    };

    await withEditor({ extensions: [ImageNode] }, async ({ editor }) => {
      insertImageFiles(
        editor,
        [new File([new Uint8Array(3)], "cover.png", { type: "image/png" })],
        adapter,
      );
      await settle();

      expect(editor.state.doc.firstChild?.attrs).toMatchObject({
        src: "data:image/png;base64,AQID",
        offline: true,
        uploadStatus: "ready",
      });
      expect(editor.getHTML()).toContain('data-image-offline="true"');
      expect(editor.getHTML()).toContain("data:image/png;base64,AQID");
    });
  });
});
