import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${resolve("src/assets/live-voice-benchmark.wav")}`,
    ],
  },
});

async function openVoiceFixtureEditor(page: Page) {
  await page.route("**/__voice-close-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Seed</title>",
    }),
  );
  await page.goto("/__voice-close-seed");
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const id = "voice-close-regression";
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id,
        name: "Voice desk regression",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(
      id,
      "<p>A draft that stays responsive.</p>",
    );
    await idb.saveBriefToIdb(id, {
      answers: {
        workingTitle: "Voice desk regression",
        format: "Essay",
        audience: "Readers",
        goal: "Explain",
        tone: "Plain",
        constraints: "",
        successSignal: "",
      },
      attachments: [],
      completedAt: now,
      updatedAt: now,
    });
  });
  await page.goto("/editor/");
}

test("closing the idle voice desk leaves the editor responsive and allows reopening", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openVoiceFixtureEditor(page);
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toContainText("A draft that stays responsive.");
  const desk = page.getByRole("complementary", { name: "Live voice desk" });
  for (let i = 0; i < 3; i++) {
    await expect
      .poll(async () => {
        await page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent("twyne:live-voice-open", { detail: {} }),
          ),
        );
        return desk.isVisible();
      })
      .toBe(true);
    await desk
      .getByRole("button", { name: "Close voice desk", exact: true })
      .click();
    await expect(desk).toBeHidden();
    // A starved renderer cannot answer this timer or accept the next edit.
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("responsive"), 50)),
      ),
    ).toBe("responsive");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText(` Still writing ${i}.`);
    await expect(editor).toContainText(`Still writing ${i}.`);
  }
  expect(errors).toEqual([]);
});

test.describe("hosted Live in the browser", () => {
  test.describe.configure({ timeout: 75_000 });
  test("waits for Convex auth, then sends microphone frames and receives a reply", async ({
    page,
    context,
  }) => {
    test.skip(
      !process.env.VITE_CONVEX_URL && !process.env.PUBLIC_CONVEX_URL,
      "Set a Convex URL for the browser fixture. Calls are intercepted.",
    );
    await context.grantPermissions(["microphone"]);
    await page.route(/\/api\/auth\//, (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: {
          "access-control-allow-origin":
            route.request().headers().origin ?? "*",
          "access-control-allow-credentials": "true",
        },
        body: "null",
      }),
    );
    const commands: string[] = [];
    let audioSent = false;
    await page.routeWebSocket(/\/api\/live$/, (socket) => {
      socket.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        commands.push(event.type);
        const send = (value: object) => socket.send(JSON.stringify(value));
        if (event.type === "twyne.live.connect") {
          expect(event.authorization).toBe("DPoP fixture");
          send({ type: "twyne.live.ready" });
        } else if (event.type === "session.start") {
          expect(event.session.instructions).toContain("Twyne");
          send({ type: "session.started" });
        } else if (event.type === "session.input_audio.append" && !audioSent) {
          expect(event.audio.length).toBeGreaterThan(0);
          audioSent = true;
          send({
            type: "session.output_audio.delta",
            delta: Buffer.alloc(4800).toString("base64"),
          });
          send({
            type: "session.output_transcript.delta",
            delta: "The voice fixture received your microphone.",
            start_ms: 0,
            end_ms: 100,
          });
        } else if (event.type === "session.close") {
          send({ type: "session.closed" });
        }
      });
    });
    await openVoiceFixtureEditor(page);
    await expect(page.locator(".ProseMirror").first()).toContainText(
      "A draft that stays responsive.",
    );
    await page.evaluate(async () => {
      const urls = performance
        .getEntriesByType("resource")
        .map(({ name }) => name);
      const browserUrl = urls.find((url) =>
        url.includes("/convex_browser.js"),
      )!;
      const serverUrl = urls.find((url) => url.includes("/convex_server.js"))!;
      const { ConvexClient } = await import(/* @vite-ignore */ browserUrl);
      const { getFunctionName } = await import(/* @vite-ignore */ serverUrl);
      const authUrl = "/src/utils/auth-client.ts";
      const { authClient } = await import(/* @vite-ignore */ authUrl);
      const fixture = {
        actions: [] as string[],
        authenticate: undefined as (() => void) | undefined,
      };
      Object.assign(window, { hostedLiveFixture: fixture });
      ConvexClient.prototype.setAuth = (
        _: unknown,
        done: (ok: boolean) => void,
      ) => {
        fixture.authenticate = () => done(true);
      };
      ConvexClient.prototype.onUpdate = () => () => {};
      ConvexClient.prototype.query = async (ref: unknown) =>
        getFunctionName(ref) === "preferences:list" ? [] : null;
      ConvexClient.prototype.mutation = async () => ({});
      ConvexClient.prototype.action = async (ref: unknown) => {
        const name = getFunctionName(ref);
        fixture.actions.push(name);
        if (name === "liveVoice:access")
          return {
            eligible: true,
            welcome: true,
            availableMicros: 1_000_000,
            sessionBudgetMicros: 500_000,
            consentGranted: true,
          };
        if (name === "liveVoice:connect")
          return {
            authorization: "DPoP fixture",
            dpop: "fixture",
            idempotencyKey: "fixture",
            maxCostMicrousd: 500_000,
          };
        return null;
      };
      authClient.useSession.set({
        ...authClient.useSession.get(),
        isPending: false,
        data: {
          user: {
            id: "hosted-live-fixture",
            name: "Voice fixture",
            email: "voice@example.test",
          },
          session: { id: "hosted-live-fixture-session" },
        },
      });
    });
    const fixture = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              hostedLiveFixture: {
                actions: string[];
                authenticate?: () => void;
              };
            }
          ).hostedLiveFixture.actions,
      );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!(
              window as unknown as {
                hostedLiveFixture?: { authenticate?: () => void };
              }
            ).hostedLiveFixture?.authenticate,
        ),
      )
      .toBe(true);
    const desk = page.getByRole("complementary", { name: "Live voice desk" });
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("twyne:live-voice-open", { detail: {} }),
      ),
    );
    await expect(desk).toContainText("Waiting for your account to connect");
    expect(await fixture()).not.toContain("liveVoice:access");
    await page.evaluate(() =>
      (
        window as unknown as { hostedLiveFixture: { authenticate: () => void } }
      ).hostedLiveFixture.authenticate(),
    );
    await expect.poll(fixture).toContain("liveVoice:access");
    const start = desk.getByRole("button", { name: "Start talking" });
    await expect(start).toBeEnabled();
    await start.click();
    await expect.poll(() => commands).toContain("session.start");
    await expect(desk).toContainText(
      "The voice fixture received your microphone.",
    );
    await desk.getByRole("button", { name: "End", exact: true }).click();
    await expect(desk).toContainText("Conversation ended");
    expect(await fixture()).toContain("liveVoice:connect");
    expect(commands.slice(0, 3)).toEqual([
      "twyne.live.connect",
      "session.start",
      "session.input_audio.append",
    ]);
  });
});
