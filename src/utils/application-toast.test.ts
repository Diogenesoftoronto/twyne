import { describe, expect, test } from "bun:test";
import { createAppError } from "./application-errors";
import {
  APPLICATION_ERROR_TOAST_EVENT,
  connectApplicationErrorToastHost,
  showApplicationErrorToast,
  type ApplicationErrorToastDetail,
} from "./application-toast";

describe("application error toast delivery", () => {
  test("dispatches only the normalized error and reviewed presentation data", () => {
    let received: ApplicationErrorToastDetail | undefined;
    const eventTarget = {
      dispatchEvent(event: Event) {
        expect(event.type).toBe(APPLICATION_ERROR_TOAST_EVENT);
        received = (event as CustomEvent<ApplicationErrorToastDetail>).detail;
        return true;
      },
    };
    const connection = connectApplicationErrorToastHost();

    const error = createAppError("AUTHENTICATION_REQUIRED", {
      source: "convex",
      referenceId: "err_sync-auth",
      metadata: { operation: "delete-comment" },
    });
    showApplicationErrorToast(
      error,
      {
        title: "Comment sync is paused",
        dedupeKey: "comment-sync",
      },
      eventTarget,
    );

    expect(received).toEqual({
      error,
      title: "Comment sync is paused",
      dedupeKey: "comment-sync",
    });
    connection.disconnect();
  });

  test("keeps startup failures until the global host connects", () => {
    const error = createAppError("AUTHENTICATION_FAILED", {
      referenceId: "err_early-auth",
      source: "auth",
    });
    showApplicationErrorToast(
      error,
      { dedupeKey: "early-auth" },
      { dispatchEvent: () => true },
    );

    const connection = connectApplicationErrorToastHost();
    expect(connection.pending).toEqual([{ error, dedupeKey: "early-auth" }]);
    connection.disconnect();
  });
});
