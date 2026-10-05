import { describe, expect, mock, test } from "bun:test";
import { createPostHogRuntime, type PostHogClient } from "./posthog-runtime";

const client = {} as PostHogClient;

describe("optional PostHog runtime", () => {
  test("shares SDK initialization across concurrent analytics calls", async () => {
    const load = mock(async () => client);
    const initialize = mock(() => {});
    const runtime = createPostHogRuntime(load, initialize);

    expect(await Promise.all([runtime.get(), runtime.get()])).toEqual([
      client,
      client,
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(runtime.peek()).toBe(client);
  });

  test("a blocked SDK resolves unavailable without rejecting or retrying", async () => {
    const load = mock(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const initialize = mock(() => {});
    const runtime = createPostHogRuntime(load, initialize);

    expect(await runtime.get()).toBeNull();
    expect(await runtime.get()).toBeNull();
    expect(runtime.peek()).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(initialize).not.toHaveBeenCalled();
  });

  test("SDK initialization failures cannot escape into the app", async () => {
    const initialize = mock(() => {
      throw new Error("Storage access denied");
    });
    const runtime = createPostHogRuntime(async () => client, initialize);

    expect(await runtime.get()).toBeNull();
    expect(runtime.peek()).toBeNull();
    expect(await runtime.get()).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  test("times out a stalled SDK and never initializes a late result", async () => {
    let finishLoad!: (client: PostHogClient) => void;
    const delayed = new Promise<PostHogClient>((resolve) => {
      finishLoad = resolve;
    });
    const initialize = mock(() => {});
    const runtime = createPostHogRuntime(() => delayed, initialize, 10);

    expect(await runtime.get()).toBeNull();
    finishLoad(client);
    await delayed;
    await Promise.resolve();
    expect(initialize).not.toHaveBeenCalled();
    expect(runtime.peek()).toBeNull();
    expect(await runtime.get()).toBeNull();
  });

  test("analytics can be queued without waiting for SDK loading", async () => {
    let finishLoad!: (client: PostHogClient) => void;
    const delayed = new Promise<PostHogClient>((resolve) => {
      finishLoad = resolve;
    });
    const capture = mock(() => {});
    const runtime = createPostHogRuntime(
      () => delayed,
      () => {},
    );

    expect(runtime.run(capture)).toBeUndefined();
    expect(runtime.peek()).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    finishLoad(client);
    await runtime.get();
    expect(capture).toHaveBeenCalledWith(client);
  });

  test("throwing SDK operations are contained and disable further calls", async () => {
    const load = mock(async () => client);
    const runtime = createPostHogRuntime(load, () => {});
    await runtime.get();

    runtime.run(() => {
      throw new Error("Capture unavailable");
    });
    await Promise.resolve();
    expect(runtime.peek()).toBeNull();
    const nextAction = mock(() => {});
    runtime.run(nextAction);
    await Promise.resolve();
    expect(nextAction).not.toHaveBeenCalled();
    expect(await runtime.get()).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
