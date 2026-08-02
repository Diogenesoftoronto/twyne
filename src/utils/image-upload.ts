import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const ACCEPTED_IMAGE_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];
export type ImageUploadPhase =
  | "reading"
  | "requesting-url"
  | "uploading"
  | "saving"
  | "complete";

export interface ImageUploadProgress {
  /** Overall completion in the inclusive range 0..1. */
  progress: number;
  phase: ImageUploadPhase;
}

export interface UploadedImage {
  src: string;
  storage: "convex" | "inline";
  imageId: string | null;
  contentType: AcceptedImageType;
  size: number;
}

export type ImageUploadTransport = (
  uploadUrl: string,
  file: File,
  onProgress: (progress: number) => void,
) => Promise<string>;

type MutationClient = Pick<ConvexClient, "mutation">;

export type ImageUploadAdapterOptions =
  | {
      mode: "online";
      client: MutationClient;
      folioId: string | (() => string);
      transport?: ImageUploadTransport;
    }
  | {
      mode: "offline";
      readDataUrl?: (file: File) => Promise<string>;
    };

export interface ImageUploadAdapter {
  readonly mode: "online" | "offline";
  upload(
    file: File,
    onProgress?: (progress: ImageUploadProgress) => void,
  ): Promise<UploadedImage>;
}

const acceptedImageTypes = new Set<string>(ACCEPTED_IMAGE_TYPES);

export function validateImageFile(file: File): AcceptedImageType {
  const contentType = file.type.trim().toLowerCase();
  if (!acceptedImageTypes.has(contentType)) {
    throw new Error("Choose a PNG, JPEG, GIF, or WebP image.");
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error("The selected image is empty.");
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("Images must be 10 MB or smaller.");
  }
  return contentType as AcceptedImageType;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("The image could not be read.")),
    );
    reader.addEventListener("abort", () =>
      reject(new Error("Reading the image was cancelled.")),
    );
    reader.readAsDataURL(file);
  });
}

/**
 * Upload with XMLHttpRequest so progress reflects bytes sent, rather than only
 * the request lifecycle. Convex upload URLs return `{ storageId }` as JSON.
 */
export const uploadToConvexStorage: ImageUploadTransport = (
  uploadUrl,
  file,
  onProgress,
) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.responseType = "json";
    request.setRequestHeader("Content-Type", file.type);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(clampProgress(event.loaded / event.total));
      }
    });
    request.addEventListener("error", () =>
      reject(new Error("The image upload could not reach storage.")),
    );
    request.addEventListener("abort", () =>
      reject(new Error("The image upload was cancelled.")),
    );
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        reject(
          new Error(`Image storage rejected the upload (${request.status}).`),
        );
        return;
      }
      let response: unknown = request.response;
      if (typeof response === "string") {
        try {
          response = JSON.parse(response);
        } catch {
          response = null;
        }
      }
      const storageId =
        response && typeof response === "object" && "storageId" in response
          ? (response as { storageId?: unknown }).storageId
          : null;
      if (typeof storageId !== "string" || !storageId) {
        reject(new Error("Storage did not return an image identifier."));
        return;
      }
      onProgress(1);
      resolve(storageId);
    });
    request.send(file);
  });

/**
 * Create an explicit online or offline adapter. Online failures are allowed to
 * surface so callers can retain a retryable node; they never fall back to a
 * data URL. Offline mode deliberately keeps the image inline.
 */
export function createImageUploadAdapter(
  options: ImageUploadAdapterOptions,
): ImageUploadAdapter {
  if (options.mode === "offline") {
    return {
      mode: "offline",
      async upload(file, onProgress) {
        const contentType = validateImageFile(file);
        onProgress?.({ phase: "reading", progress: 0 });
        const src = await (options.readDataUrl ?? readFileAsDataUrl)(file);
        onProgress?.({ phase: "complete", progress: 1 });
        return {
          src,
          storage: "inline",
          imageId: null,
          contentType,
          size: file.size,
        };
      },
    };
  }

  return {
    mode: "online",
    async upload(file, onProgress) {
      const contentType = validateImageFile(file);
      const folioId =
        typeof options.folioId === "function"
          ? options.folioId()
          : options.folioId;
      if (!folioId.trim())
        throw new Error("Choose a folio before adding an image.");

      onProgress?.({ phase: "requesting-url", progress: 0 });
      const { uploadUrl } = await options.client.mutation(
        api.images.generateUploadUrl,
        { contentType, size: file.size },
      );

      const transport = options.transport ?? uploadToConvexStorage;
      const storageId = await transport(uploadUrl, file, (progress) => {
        onProgress?.({
          phase: "uploading",
          progress: 0.05 + clampProgress(progress) * 0.85,
        });
      });

      onProgress?.({ phase: "saving", progress: 0.95 });
      const saved = await options.client.mutation(api.images.saveImage, {
        folioId,
        storageId: storageId as Id<"_storage">,
      });
      onProgress?.({ phase: "complete", progress: 1 });
      return {
        src: saved.url,
        storage: "convex",
        imageId: String(saved.imageId),
        contentType,
        size: file.size,
      };
    },
  };
}

export function imageFilesFromList(
  files: ArrayLike<File> | null | undefined,
): File[] {
  if (!files) return [];
  return Array.from(files).filter((file) =>
    acceptedImageTypes.has(file.type.trim().toLowerCase()),
  );
}

/** Open the native chooser without requiring a file-input in shared markup. */
export function selectImageFiles(multiple = true): Promise<File[]> {
  if (typeof document === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPTED_IMAGE_TYPES.join(",");
    input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);

    const finish = () => {
      const files = imageFilesFromList(input.files);
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    input.click();
  });
}
