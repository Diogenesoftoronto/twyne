import {
  Node,
  mergeAttributes,
  type Editor,
  type NodeViewRenderer,
  type NodeViewRendererProps,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import {
  imageFilesFromList,
  selectImageFiles,
  type ImageUploadAdapter,
} from "../../../utils/image-upload";

export const IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const;
export type ImageWidthPreset = (typeof IMAGE_WIDTH_PRESETS)[number];
export type ImageAlignment = "left" | "center" | "right";
export type ImageUploadStatus = "ready" | "uploading" | "failed";

export interface ImageNodeAttributes {
  src: string;
  alt: string;
  caption: string;
  alignment: ImageAlignment;
  width: number;
  aspectRatio: number | null;
  imageId: string | null;
  offline: boolean;
  uploadId: string | null;
  uploadStatus: ImageUploadStatus;
  uploadProgress: number;
  uploadError: string | null;
}

export interface ImageNodeOptions {
  HTMLAttributes: Record<string, unknown>;
  uploadAdapter: ImageUploadAdapter | null;
  onUploadError?: (error: Error) => void;
}

interface PendingUpload {
  adapter: ImageUploadAdapter;
  file: File;
  previewUrl: string | null;
}

const pendingUploads = new Map<string, PendingUpload>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeImageWidth(value: unknown): number {
  const width = typeof value === "number" ? value : Number(value);
  return Number.isFinite(width) ? Math.round(clamp(width, 10, 100)) : 100;
}

export function imageWidthFromPointerDelta(
  startWidthPercent: number,
  deltaPixels: number,
  editorWidthPixels: number,
  edge: "left" | "right" = "right",
): number {
  if (!Number.isFinite(editorWidthPixels) || editorWidthPixels <= 0) {
    return normalizeImageWidth(startWidthPercent);
  }
  const direction = edge === "left" ? -1 : 1;
  return normalizeImageWidth(
    startWidthPercent + (direction * deltaPixels * 100) / editorWidthPixels,
  );
}

function normalizeAlignment(value: unknown): ImageAlignment {
  return value === "left" || value === "right" ? value : "center";
}

function normalizedProgress(value: unknown): number {
  const progress = typeof value === "number" ? value : Number(value);
  return Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
}

function figureStyle(width: number, alignment: ImageAlignment): string {
  const margins =
    alignment === "left"
      ? "margin-left: 0; margin-right: auto;"
      : alignment === "right"
        ? "margin-left: auto; margin-right: 0;"
        : "margin-left: auto; margin-right: auto;";
  return `width: ${normalizeImageWidth(width)}%; max-width: 100%; ${margins} break-inside: avoid; page-break-inside: avoid;`;
}

function imageStyle(aspectRatio: number | null): string {
  const ratio =
    typeof aspectRatio === "number" && aspectRatio > 0
      ? ` aspect-ratio: ${aspectRatio};`
      : "";
  return `display: block; width: 100%; height: auto;${ratio}`;
}

function parseImageAttributes(
  element: HTMLElement,
): Partial<ImageNodeAttributes> {
  const figure = element.matches("figure")
    ? element
    : element.closest("figure");
  const image = element.matches("img")
    ? (element as HTMLImageElement)
    : element.querySelector<HTMLImageElement>("img");
  const width = figure?.getAttribute("data-image-width") ?? "100";
  const ratio = figure?.getAttribute("data-image-aspect-ratio");
  return {
    src: image?.getAttribute("src") ?? "",
    alt: image?.getAttribute("alt") ?? "",
    caption: figure?.querySelector("figcaption")?.textContent ?? "",
    alignment: normalizeAlignment(figure?.getAttribute("data-image-align")),
    width: normalizeImageWidth(width),
    aspectRatio: ratio && Number(ratio) > 0 ? Number(ratio) : null,
    imageId: figure?.getAttribute("data-image-id") ?? null,
    offline: figure?.getAttribute("data-image-offline") === "true",
    uploadId: figure?.getAttribute("data-upload-id") ?? null,
    uploadStatus:
      figure?.getAttribute("data-upload-status") === "failed"
        ? "failed"
        : "ready",
    uploadProgress: 0,
    uploadError: figure?.getAttribute("data-upload-error") ?? null,
  };
}

function portableFigureAttributes(attrs: ImageNodeAttributes) {
  return {
    "data-type": "image",
    "data-image-align": normalizeAlignment(attrs.alignment),
    "data-image-width": String(normalizeImageWidth(attrs.width)),
    "data-image-aspect-ratio":
      attrs.aspectRatio && attrs.aspectRatio > 0
        ? String(attrs.aspectRatio)
        : null,
    "data-image-id": attrs.imageId,
    "data-image-offline": attrs.offline ? "true" : null,
    "data-upload-id": attrs.uploadId,
    "data-upload-status": attrs.uploadStatus,
    "data-upload-error": attrs.uploadError,
    "data-alt-text": attrs.alt,
    style: figureStyle(attrs.width, attrs.alignment),
  };
}

function createUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function previewUrl(file: File): string | null {
  try {
    return typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : null;
  } catch {
    return null;
  }
}

function releasePreview(upload: PendingUpload | undefined): void {
  if (!upload?.previewUrl) return;
  try {
    URL.revokeObjectURL(upload.previewUrl);
  } catch {
    // A preview URL is best-effort and is never manuscript content.
  }
}

function findImagePosition(editor: Editor, uploadId: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
      found = pos;
      return false;
    }
    return found === null;
  });
  return found;
}

function patchImageByUploadId(
  editor: Editor,
  uploadId: string,
  patch: Partial<ImageNodeAttributes>,
): boolean {
  const pos = findImagePosition(editor, uploadId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }),
  );
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The image could not be uploaded.";
}

async function runPendingUpload(
  editor: Editor,
  uploadId: string,
  onUploadError?: (error: Error) => void,
): Promise<boolean> {
  const pending = pendingUploads.get(uploadId);
  if (!pending) return false;
  patchImageByUploadId(editor, uploadId, {
    uploadStatus: "uploading",
    uploadProgress: 0,
    uploadError: null,
  });

  try {
    const uploaded = await pending.adapter.upload(pending.file, (progress) => {
      patchImageByUploadId(editor, uploadId, {
        uploadProgress: normalizedProgress(progress.progress),
      });
    });
    const stillPresent = patchImageByUploadId(editor, uploadId, {
      src: uploaded.src,
      imageId: uploaded.imageId,
      offline: uploaded.storage === "inline",
      uploadStatus: "ready",
      uploadProgress: 1,
      uploadError: null,
    });
    releasePreview(pending);
    pendingUploads.delete(uploadId);
    return stillPresent;
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error("The image could not be uploaded.");
    patchImageByUploadId(editor, uploadId, {
      uploadStatus: "failed",
      uploadError: errorMessage(error),
    });
    onUploadError?.(error);
    return false;
  }
}

export async function retryImageUpload(
  editor: Editor,
  uploadId: string,
  adapter: ImageUploadAdapter,
  replacement?: File,
  onUploadError?: (error: Error) => void,
): Promise<boolean> {
  let pending = pendingUploads.get(uploadId);
  if (replacement) {
    releasePreview(pending);
    pending = {
      adapter,
      file: replacement,
      previewUrl: previewUrl(replacement),
    };
    pendingUploads.set(uploadId, pending);
  } else if (!pending) {
    const [selected] = await selectImageFiles(false);
    if (!selected) return false;
    pending = { adapter, file: selected, previewUrl: previewUrl(selected) };
    pendingUploads.set(uploadId, pending);
  }
  return runPendingUpload(editor, uploadId, onUploadError);
}

export function insertImageFiles(
  editor: Editor,
  files: Iterable<File>,
  adapter: ImageUploadAdapter,
  position?: number,
  onUploadError?: (error: Error) => void,
): string[] {
  const uploadIds: string[] = [];
  let insertAt = position;

  for (const file of files) {
    const uploadId = createUploadId();
    const attrs: ImageNodeAttributes = {
      src: "",
      alt: file.name.replace(/\.[^.]+$/, ""),
      caption: "",
      alignment: "center",
      width: 100,
      aspectRatio: null,
      imageId: null,
      offline: false,
      uploadId,
      uploadStatus: "uploading",
      uploadProgress: 0,
      uploadError: null,
    };
    const command =
      insertAt == null
        ? editor.commands.insertContent({ type: "image", attrs })
        : editor.commands.insertContentAt(insertAt, { type: "image", attrs });
    if (!command) continue;

    pendingUploads.set(uploadId, {
      adapter,
      file,
      previewUrl: previewUrl(file),
    });
    uploadIds.push(uploadId);
    const insertedPos = findImagePosition(editor, uploadId);
    if (insertedPos !== null) insertAt = insertedPos + 1;
    void runPendingUpload(editor, uploadId, onUploadError);
  }
  return uploadIds;
}

export async function chooseAndInsertImages(
  editor: Editor,
  adapter: ImageUploadAdapter,
  position?: number,
  onUploadError?: (error: Error) => void,
): Promise<string[]> {
  const files = await selectImageFiles(true);
  return insertImageFiles(editor, files, adapter, position, onUploadError);
}

function updateNodeAttributes(
  props: NodeViewRendererProps,
  currentNode: ProseMirrorNode,
  patch: Partial<ImageNodeAttributes>,
): void {
  const pos = props.getPos();
  if (typeof pos !== "number") return;
  props.editor.view.dispatch(
    props.editor.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
      ...patch,
    }),
  );
}

export class ImageNodeView implements NodeView {
  dom: HTMLElement;

  private node: ProseMirrorNode;
  private readonly props: NodeViewRendererProps;
  private readonly options: ImageNodeOptions;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLElement;
  private readonly status: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly leftHandle: HTMLButtonElement;
  private readonly rightHandle: HTMLButtonElement;
  private cleanupResize: (() => void) | null = null;

  constructor(props: NodeViewRendererProps, options: ImageNodeOptions) {
    this.props = props;
    this.node = props.node;
    this.options = options;
    this.dom = document.createElement("figure");
    this.dom.className = "twyne-image-node";
    this.dom.setAttribute("contenteditable", "false");
    this.dom.tabIndex = 0;

    this.image = document.createElement("img");
    this.image.draggable = false;
    this.image.addEventListener("load", this.rememberAspectRatio);

    this.caption = document.createElement("figcaption");
    this.caption.className = "twyne-image-caption";

    this.status = document.createElement("div");
    this.status.className = "twyne-image-upload-status";
    this.status.setAttribute("role", "status");
    Object.assign(this.status.style, {
      position: "absolute",
      inset: "auto 0 0 0",
      padding: "0.4rem 0.55rem",
      background: "rgb(20 18 15 / 0.82)",
      color: "white",
      fontSize: "0.72rem",
    });

    this.retry = document.createElement("button");
    this.retry.type = "button";
    this.retry.textContent = "Retry upload";
    this.retry.dataset.imageRetry = "true";
    this.retry.addEventListener("click", this.retryUpload);
    Object.assign(this.retry.style, {
      marginLeft: "0.5rem",
      textDecoration: "underline",
      color: "inherit",
    });

    this.leftHandle = this.createResizeHandle("left");
    this.rightHandle = this.createResizeHandle("right");
    this.dom.append(
      this.image,
      this.caption,
      this.status,
      this.leftHandle,
      this.rightHandle,
    );
    Object.assign(this.dom.style, {
      position: "relative",
      boxSizing: "border-box",
    });
    this.render();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
    this.leftHandle.hidden = false;
    this.rightHandle.hidden = false;
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
    this.leftHandle.hidden = true;
    this.rightHandle.hidden = true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof globalThis.Node && target !== this.image;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.cleanupResize?.();
    this.image.removeEventListener("load", this.rememberAspectRatio);
    this.retry.removeEventListener("click", this.retryUpload);
  }

  private readonly rememberAspectRatio = () => {
    if (Number(this.node.attrs.aspectRatio) > 0) return;
    if (this.image.naturalWidth <= 0 || this.image.naturalHeight <= 0) return;
    updateNodeAttributes(this.props, this.node, {
      aspectRatio: this.image.naturalWidth / this.image.naturalHeight,
    });
  };

  private readonly retryUpload = () => {
    const uploadId = this.node.attrs.uploadId;
    const adapter = this.options.uploadAdapter;
    if (typeof uploadId !== "string" || !adapter) return;
    void retryImageUpload(
      this.props.editor,
      uploadId,
      adapter,
      undefined,
      this.options.onUploadError,
    );
  };

  private createResizeHandle(edge: "left" | "right"): HTMLButtonElement {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.hidden = true;
    handle.dataset.imageResize = edge;
    handle.setAttribute("aria-label", `Resize image from ${edge} edge`);
    Object.assign(handle.style, {
      position: "absolute",
      bottom: "0.3rem",
      [edge]: "0.3rem",
      width: "0.85rem",
      height: "0.85rem",
      border: "1px solid currentColor",
      borderRadius: "50%",
      background: "var(--color-paper, white)",
      cursor: "ew-resize",
    });
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = normalizeImageWidth(this.node.attrs.width);
      const editorWidth =
        this.props.editor.view.dom.getBoundingClientRect().width ||
        this.props.editor.view.dom.clientWidth ||
        1;
      const move = (moveEvent: PointerEvent) => {
        const width = imageWidthFromPointerDelta(
          startWidth,
          moveEvent.clientX - startX,
          editorWidth,
          edge,
        );
        updateNodeAttributes(this.props, this.node, { width });
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        this.cleanupResize = null;
      };
      this.cleanupResize?.();
      this.cleanupResize = finish;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
    });
    return handle;
  }

  private render(): void {
    const attrs = this.node.attrs as ImageNodeAttributes;
    const pending = attrs.uploadId ? pendingUploads.get(attrs.uploadId) : null;
    const visibleSrc = attrs.src || pending?.previewUrl || "";
    const portable = portableFigureAttributes(attrs);
    for (const [name, value] of Object.entries(portable)) {
      if (value == null) this.dom.removeAttribute(name);
      else this.dom.setAttribute(name, String(value));
    }
    this.dom.dataset.aspectRatioLocked = "true";
    if (visibleSrc) this.image.setAttribute("src", visibleSrc);
    else this.image.removeAttribute("src");
    this.image.alt = attrs.alt || "";
    this.image.style.cssText = imageStyle(attrs.aspectRatio);
    this.caption.textContent = attrs.caption || "";
    this.caption.hidden = !attrs.caption;

    if (attrs.uploadStatus === "uploading") {
      this.status.hidden = false;
      this.status.replaceChildren(
        `Uploading image… ${Math.round(normalizedProgress(attrs.uploadProgress) * 100)}%`,
      );
    } else if (attrs.uploadStatus === "failed") {
      this.status.hidden = false;
      this.status.replaceChildren(
        attrs.uploadError || "Upload failed.",
        this.retry,
      );
    } else {
      this.status.hidden = true;
      this.status.replaceChildren();
    }
  }
}

export const ImageNode = Node.create<ImageNodeOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {}, uploadAdapter: null };
  },

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      alignment: { default: "center" },
      width: { default: 100 },
      aspectRatio: { default: null },
      imageId: { default: null },
      offline: { default: false },
      uploadId: { default: null },
      uploadStatus: { default: "ready" },
      uploadProgress: { default: 0, rendered: false },
      uploadError: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        getAttrs: (element) => parseImageAttributes(element as HTMLElement),
      },
      {
        tag: "img[src]",
        getAttrs: (element) => parseImageAttributes(element as HTMLElement),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as ImageNodeAttributes;
    const children: unknown[] = [
      [
        "img",
        {
          src: attrs.src,
          alt: attrs.alt,
          style: imageStyle(attrs.aspectRatio),
        },
      ],
    ];
    if (attrs.caption) children.push(["figcaption", {}, attrs.caption]);
    return [
      "figure",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        portableFigureAttributes(attrs),
      ),
      ...children,
    ] as never;
  },

  renderText({ node }) {
    const attrs = node.attrs as ImageNodeAttributes;
    return attrs.alt ? `[Image: ${attrs.alt}]` : "[Image]";
  },

  addNodeView() {
    return ((props) =>
      new ImageNodeView(props, this.options)) as NodeViewRenderer;
  },

  addProseMirrorPlugins() {
    const adapter = this.options.uploadAdapter;
    if (!adapter) return [];
    const onUploadError = this.options.onUploadError;
    return [
      new Plugin({
        props: {
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFilesFromList(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            insertImageFiles(
              this.editor,
              files,
              adapter,
              at?.pos,
              onUploadError,
            );
            return true;
          },
          handlePaste: (_view, event) => {
            const files = imageFilesFromList(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            insertImageFiles(
              this.editor,
              files,
              adapter,
              undefined,
              onUploadError,
            );
            return true;
          },
        },
      }),
    ];
  },
});
