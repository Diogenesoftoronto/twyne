import { $ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import type { ImageNodeAttributes } from "./extensions/image-node";
import { ImageInspector } from "./image-inspector";

const ready: ImageNodeAttributes = {
  src: "https://example.com/plate.jpg",
  alt: "Reading room with tall windows",
  caption: "The north reading room, late afternoon.",
  alignment: "center",
  width: 72,
  aspectRatio: 1.5,
  imageId: "img-story-1",
  offline: false,
  uploadId: null,
  uploadStatus: "ready",
  uploadProgress: 1,
  uploadError: null,
};

const meta = {
  title: "Editor/ImageInspector",
  component: ImageInspector,
  decorators: [
    (Story) => <div class="w-80 max-w-[calc(100vw-2rem)]">{Story()}</div>,
  ],
  args: {
    attributes: ready,
    onPatch$: $(() => {}),
    onChooseFiles$: $(() => {}),
    onRetry$: $(() => {}),
    onRemove$: $(() => {}),
  },
} satisfies Meta<typeof ImageInspector>;

export default meta;
type Story = StoryObj<typeof ImageInspector>;

export const Ready: Story = {};

export const Uploading: Story = {
  args: {
    attributes: {
      ...ready,
      uploadStatus: "uploading",
      uploadProgress: 0.42,
      imageId: null,
      uploadId: "upload-story-1",
    },
  },
};

export const Failed: Story = {
  args: {
    attributes: {
      ...ready,
      uploadStatus: "failed",
      uploadProgress: 0.6,
      uploadError: "The connection dropped mid-upload.",
    },
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
