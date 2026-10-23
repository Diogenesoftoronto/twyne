// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import { requestSharedReview } from "./shared-reconciliation-dialog";

const describeBrowser =
  typeof import.meta.glob === "function" ? describe : describe.skip;
const copies = {
  local: {
    html: "<p><strong>Local first.</strong></p><p>Anchor.</p><p>Local last.</p>",
  },
  shared: { html: "<p>Shared first.</p><p>Anchor.</p><p>Shared last.</p>" },
};
const buttons = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".shared-review-dialog button, .shared-review-banner button",
    ),
  );
const click = (name: string) =>
  buttons()
    .find((button) => button.textContent === name)!
    .click();

describeBrowser("shared review interaction", () => {
  beforeAll(() => {
    // jsdom has no native dialog implementation. Focus trapping and Escape are
    // exercised by the real-browser suite; model open/close for DOM assertions.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
  });
  test("review later keeps choices; applying preserves a mix and holds the modal until committed", async () => {
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decision = requestSharedReview({
      ...copies,
      role: "owner",
      isCurrent: () => true,
      settled,
    });
    const radio = document.querySelectorAll<HTMLInputElement>(
      'input[aria-label="Keep shared passage"]',
    )[1];
    radio.click();
    const preview = document.querySelector(
      '[aria-label="Preview of your choices"]',
    )!;
    expect(preview.textContent).toContain("Local first.");
    expect(preview.textContent).toContain("Shared last.");
    expect(preview.textContent).not.toContain("Local last.");
    click("Review later");
    expect(document.querySelector<HTMLDialogElement>("dialog")!.open).toBe(
      false,
    );
    click("Review saved changes");
    expect(radio.checked).toBe(true);
    click("Apply choices and resume sharing");
    expect(await decision).toEqual({
      html: "<p><strong>Local first.</strong></p><p>Anchor.</p><p>Shared last.</p>",
    });
    expect(document.querySelector<HTMLDialogElement>("dialog")!.open).toBe(
      true,
    );
    expect(
      buttons()
        .filter((button) => button.closest("dialog"))
        .every((button) => button.disabled),
    ).toBe(true);
    release();
    await settled;
    await Promise.resolve();
    expect(document.querySelector("dialog")).toBeNull();
  });

  test("comment access opens only the unchanged shared manuscript", async () => {
    const decision = requestSharedReview({
      ...copies,
      role: "commenter",
      isCurrent: () => true,
    });
    expect(
      Array.from(
        document.querySelectorAll<HTMLInputElement>("dialog input"),
      ).every((input) => input.disabled),
    ).toBe(true);
    expect(
      buttons().some(
        (button) => button.textContent === "Apply choices and resume sharing",
      ),
    ).toBe(false);
    click("Open shared copy");
    expect(await decision).toEqual(copies.shared);
  });

  test("navigation cancels a paused request without applying a copy", async () => {
    vi.useFakeTimers();
    let current = true;
    const decision = requestSharedReview({
      ...copies,
      role: "owner",
      isCurrent: () => current,
    });
    click("Review later");
    current = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(await decision).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.querySelector(".shared-review-banner")).toBeNull();
    vi.useRealTimers();
  });

  test("the preview exposes link destinations and renders manuscript HTML without executable elements", async () => {
    const html =
      '<p><a href="javascript:alert(1)">Read this</a><img src="https://example.test/tracker" onerror="alert(1)" alt="Drawing"><svg onload="alert(1)"></svg></p>';
    const decision = requestSharedReview({
      local: { html },
      shared: { html: "<p>Shared</p>" },
      role: "owner",
      isCurrent: () => true,
    });
    const preview = document.querySelector(
      '[aria-label="Preview of your choices"]',
    )!;
    expect(
      preview.querySelector("img, svg, script, a, [onerror], [onload]"),
    ).toBeNull();
    expect(preview.textContent).toContain("Link: javascript:alert(1)");
    expect(preview.textContent).toContain("Image: Drawing");
    click("Apply choices and resume sharing");
    await decision;
  });
});
