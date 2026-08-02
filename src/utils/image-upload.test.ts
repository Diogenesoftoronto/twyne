import { describe, expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  createImageUploadAdapter,
  imageFilesFromList,
  validateImageFile,
} from "./image-upload";

function imageFile(
  type = "image/png",
  size = 4,
  name = "illustration.png",
): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("image upload adapter", () => {
  test("online upload mints a URL, streams the file, and stores the returned URL", async () => {
    const calls: unknown[] = [];
    const client = {
      mutation: async (_reference: unknown, args: unknown) => {
        calls.push(args);
        return calls.length === 1
          ? { uploadUrl: "https://upload.example.test" }
          : {
              imageId: "image-1",
              folioId: "folio-1",
              url: "https://files.example.test/image-1",
              contentType: "image/png",
              size: 4,
              createdAt: 1,
            };
      },
    } as unknown as Pick<ConvexClient, "mutation">;
    const transported: string[] = [];
    const progress: number[] = [];
    const adapter = createImageUploadAdapter({
      mode: "online",
      client,
      folioId: "folio-1",
      transport: async (url, file, onProgress) => {
        transported.push(`${url}:${file.name}`);
        onProgress(0.5);
        return "storage-1";
      },
    });

    const result = await adapter.upload(imageFile(), (event) =>
      progress.push(event.progress),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ contentType: "image/png", size: 4 });
    expect(calls[1]).toEqual({
      folioId: "folio-1",
      storageId: "storage-1",
    });
    expect(transported).toEqual([
      "https://upload.example.test:illustration.png",
    ]);
    expect(result).toEqual({
      src: "https://files.example.test/image-1",
      storage: "convex",
      imageId: "image-1",
      contentType: "image/png",
      size: 4,
    });
    expect(progress.at(-1)).toBe(1);
  });

  test("online failures surface without silently producing a data URL", async () => {
    const client = {
      mutation: async () => ({ uploadUrl: "https://upload.example.test" }),
    } as unknown as Pick<ConvexClient, "mutation">;
    const adapter = createImageUploadAdapter({
      mode: "online",
      client,
      folioId: "folio-1",
      transport: async () => {
        throw new Error("network down");
      },
    });

    await expect(adapter.upload(imageFile())).rejects.toThrow("network down");
  });

  test("explicit offline mode retains a data URL", async () => {
    const adapter = createImageUploadAdapter({
      mode: "offline",
      readDataUrl: async () => "data:image/png;base64,AQIDBA==",
    });

    const result = await adapter.upload(imageFile());

    expect(result.storage).toBe("inline");
    expect(result.src).toStartWith("data:image/png;base64,");
    expect(result.imageId).toBeNull();
  });

  test("validates the same public type and size boundary as the backend", () => {
    expect(validateImageFile(imageFile("image/webp"))).toBe("image/webp");
    expect(() => validateImageFile(imageFile("image/svg+xml"))).toThrow(
      "PNG, JPEG, GIF, or WebP",
    );
    expect(() =>
      validateImageFile(imageFile("image/png", MAX_IMAGE_UPLOAD_BYTES + 1)),
    ).toThrow("10 MB or smaller");
  });

  test("drag, paste, and picker lists ignore non-image files", () => {
    const files = imageFilesFromList([
      imageFile(),
      new File(["notes"], "notes.txt", { type: "text/plain" }),
      imageFile("image/jpeg", 3, "photo.jpg"),
    ]);
    expect(files.map((file) => file.name)).toEqual([
      "illustration.png",
      "photo.jpg",
    ]);
  });
});
