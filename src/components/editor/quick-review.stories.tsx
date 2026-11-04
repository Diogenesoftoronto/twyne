import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { LiveReviewStatus } from "../writing-tools/live-review-status";
import { ModalCardStage, passage } from "./modal-card.fixtures";

type Mode =
  | "finding"
  | "waiting"
  | "checking"
  | "clear"
  | "unavailable"
  | "signed-out"
  | "unconfigured";
interface QuickReviewStoryProps {
  mode: Mode;
  finding:
    | "Needs context"
    | "Check evidence"
    | "Possible repetition"
    | "Meaning is unclear";
  tentative: boolean;
  open: boolean;
}
const notices = {
  unavailable: {
    label: "Quick review unavailable; writing is saved as usual",
    reason: "unavailable",
  },
  "signed-out": {
    label: "Connect your account for quick review",
    reason: "signed out",
  },
  unconfigured: {
    label: "Set up a model for quick review",
    reason: "unconfigured",
  },
};

/** Mount the production decoration and native popover, without starting inference. */
const QuickReviewPreview = component$<QuickReviewStoryProps>((props) => {
  const mount = useSignal<HTMLElement>();
  const revision = useSignal(0);
  const ready = useSignal(false);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    if (!track(() => ready.value)) return;
    const mode = track(() => props.mode);
    const label = track(() => props.finding);
    const tentative = track(() => props.tentative);
    const open = track(() => props.open);
    track(() => revision.value);
    let disposed = false;
    let dispose = () => {};
    cleanup(() => {
      disposed = true;
      dispose();
    });
    const [
      { Editor },
      { StarterKit },
      {
        QuickReview,
        QUICK_REVIEW_COPY,
        renderQuickReviewFinding,
        clearQuickReviewFinding,
      },
    ] = await Promise.all([
      import("@tiptap/core"),
      import("@tiptap/starter-kit"),
      import("./extensions/quick-review"),
    ]);
    if (disposed || !mount.value) return;
    const publish = (label: string, detail = "", reason = "") => {
      window.dispatchEvent(
        new CustomEvent("twyne:quick-review", {
          detail: {
            folioId: "storybook-inline-quick-review",
            label,
            detail,
            reason,
          },
        }),
      );
    };
    let closePopover = () => {};
    const editor = new Editor({
      element: mount.value,
      extensions: [StarterKit, QuickReview],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: passage }] },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "At nine each morning, the doors opened to anyone who needed a chair. A student spread her notes beside the atlas.",
              },
            ],
          },
        ],
      },
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Quick-review manuscript",
          "aria-multiline": "true",
          style:
            "min-height: 16rem; outline: none; font: 1.1rem/1.8 var(--font-serif);",
        },
      },
      onUpdate: () => {
        closePopover();
        publish("Waiting for a pause…");
      },
    });
    // The status listener is mounted before delivering this simulated reading.
    const frame = requestAnimationFrame(() => {
      if (mode === "finding") {
        closePopover = renderQuickReviewFinding(
          editor,
          0,
          editor.state.doc.firstChild!.nodeSize,
          { label, tentative },
          () => {
            closePopover();
            clearQuickReviewFinding(editor);
            publish("No clear issue in this passage");
          },
        );
        publish(
          `${tentative ? "Possibly: " : ""}${label}`,
          QUICK_REVIEW_COPY[label],
        );
        if (open)
          mount.value
            ?.querySelector<HTMLButtonElement>(".twyne-quick-review-marker")
            ?.click();
      } else if (mode in notices) {
        const notice = notices[mode as keyof typeof notices];
        publish(notice.label, "", notice.reason);
      } else {
        publish(
          {
            waiting: "Waiting for a pause…",
            checking: "Checking this passage…",
            clear: "No clear issue in this passage",
          }[mode as "waiting" | "checking" | "clear"],
        );
      }
    });
    dispose = () => {
      cancelAnimationFrame(frame);
      closePopover();
      editor.destroy();
    };
  });

  return (
    <ModalCardStage
      status="Simulated inline review. Open the ? marker or expand the finding above the manuscript. Edits stay in this story."
      onReset$={() => {
        // Reset only this fixture's notice, leaving other session dismissals intact.
        const notice = notices[props.mode as keyof typeof notices];
        if (notice) {
          try {
            const key = "twyne:review-notices-dismissed";
            const dismissed: string[] = JSON.parse(
              sessionStorage.getItem(key) ?? "[]",
            );
            sessionStorage.setItem(
              key,
              JSON.stringify(dismissed.filter((text) => text !== notice.label)),
            );
          } catch {
            /* The preview still resets when session storage is unavailable. */
          }
        }
        revision.value++;
        ready.value = false;
      }}
    >
      <article
        class="twyne-editor paper-sheet"
        style="max-width: 42rem; margin-top: 2rem; padding: 2rem;"
      >
        <h1 style="font: 1.75rem/1.3 var(--font-display); margin-bottom: 1rem;">
          The public room
        </h1>
        <LiveReviewStatus
          key={revision.value}
          folioId="storybook-inline-quick-review"
          onReady$={() => {
            ready.value = true;
          }}
        />
        <div ref={mount} />
      </article>
    </ModalCardStage>
  );
});

const meta = {
  title: "Editor/InlineQuickReview",
  component: QuickReviewPreview,
  parameters: { layout: "fullscreen" },
  args: {
    mode: "finding",
    finding: "Check evidence",
    tentative: false,
    open: false,
  },
  argTypes: {
    mode: {
      control: "select",
      options: [
        "finding",
        "waiting",
        "checking",
        "clear",
        "unavailable",
        "signed-out",
        "unconfigured",
      ],
    },
    finding: {
      control: "select",
      options: [
        "Needs context",
        "Check evidence",
        "Possible repetition",
        "Meaning is unclear",
      ],
    },
  },
} satisfies Meta<typeof QuickReviewPreview>;
export default meta;
type Story = StoryObj<typeof QuickReviewPreview>;
export const CheckEvidence: Story = {};
export const NeedsContext: Story = { args: { finding: "Needs context" } };
export const PossibleRepetition: Story = {
  args: { finding: "Possible repetition" },
};
export const UnclearMeaning: Story = {
  args: { finding: "Meaning is unclear" },
};
export const TentativeFinding: Story = { args: { tentative: true } };
export const PassageFeedbackOpen: Story = { args: { open: true } };
export const WaitingForPause: Story = { args: { mode: "waiting" } };
export const CheckingPassage: Story = { args: { mode: "checking" } };
export const NoClearIssue: Story = { args: { mode: "clear" } };
export const ReviewUnavailable: Story = { args: { mode: "unavailable" } };
export const SignedOut: Story = { args: { mode: "signed-out" } };
export const ModelNotConfigured: Story = { args: { mode: "unconfigured" } };
export const MobileFeedback: Story = {
  args: { open: true },
  globals: { viewport: { value: "phone", isRotated: false } },
};
