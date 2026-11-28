import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

test.use({
  serviceWorkers: "block",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    return route.abort();
  });
});

async function seed(page: Page) {
  await page.route("**/__recovery-seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__recovery-seed");
}

test("the dossier interview recovers a failed answer without duplicating the turn", async ({
  page,
}) => {
  const answer = "I am writing for municipal library directors.";
  const question = "What should those directors do after reading it?";
  const prompts: string[] = [];
  let providerAvailable = false;
  await page.route("**/__interview-fixture/chat/completions", async (route) => {
    prompts.push(JSON.stringify(route.request().postDataJSON()));
    if (!providerAvailable) {
      await route.fulfill({
        status: 402,
        json: {
          error: {
            message: "Fixture credits exhausted",
            code: "insufficient_credits",
          },
        },
      });
      return;
    }
    const chunk = {
      id: "interview-fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "interview-fixture",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content:
              question +
              '\nDOSSIER: {"brief":{"audience":"Municipal library directors"},"confidence":{"audience":"high"}}',
          },
          finish_reason: "stop",
        },
      ],
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
    });
  });
  await seed(page);
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    await idb.saveWriterSettingsToIdb(
      {
        ...(await idb.loadWriterSettingsFromIdb()),
        interviewStyle: "conversational",
      },
      false,
    );
    await idb.saveAiSettingsToIdb(
      {
        advancedMode: true,
        providers: [
          {
            id: "interview-fixture",
            name: "Interview fixture",
            type: "openai-compatible",
            baseUrl: location.origin + "/__interview-fixture",
            apiKey: "fixture",
            defaultModel: "interview-fixture",
          },
        ],
        defaultProviderId: "interview-fixture",
        perFeature: {},
        showProviderTags: false,
      },
      false,
    );
  });
  await page.goto("/dossier/create/");
  const composer = page.getByRole("textbox", {
    name: "Your answer",
    exact: true,
  });
  await composer.fill(answer.replace("library", "librxary"));
  await composer.evaluate((field: HTMLTextAreaElement) => {
    const caret = field.value.indexOf("xary") + 1;
    field.setSelectionRange(caret, caret);
    Object.assign(window, { dossierComposer: field });
  });
  await composer.press("Backspace");
  await expect(composer).toHaveValue(answer);
  await expect
    .poll(() =>
      composer.evaluate((field: HTMLTextAreaElement) => ({
        sameNode: Reflect.get(window, "dossierComposer") === field,
        focused: document.activeElement === field,
        caret: field.selectionStart,
      })),
    )
    .toEqual({
      sameNode: true,
      focused: true,
      caret: answer.indexOf("library") + 4,
    });
  await composer.press("Enter");
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(page.getByText(answer, { exact: true })).toHaveCount(1);
  const unsent = "A new thought I am still drafting";
  await composer.fill(unsent);
  await composer.evaluate((field: HTMLTextAreaElement) => {
    field.setSelectionRange(2, 5, "backward");
    Object.assign(window, { dossierComposer: field });
  });
  providerAvailable = true;
  await retry.click();
  await expect(page.getByText(question, { exact: true })).toBeVisible();
  await expect(page.getByText(answer, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveValue(unsent);
  expect(
    await composer.evaluate((field: HTMLTextAreaElement) => ({
      sameNode: Reflect.get(window, "dossierComposer") === field,
      start: field.selectionStart,
      end: field.selectionEnd,
      direction: field.selectionDirection,
    })),
  ).toEqual({ sameNode: true, start: 2, end: 5, direction: "backward" });
  await expect(retry).toHaveCount(0);
  expect(prompts).toHaveLength(2);
  expect(prompts.every((prompt) => prompt.split(answer).length === 2)).toBe(
    true,
  );
  expect(prompts.every((prompt) => !prompt.includes(unsent))).toBe(true);
});

test("Live keeps the microphone and conversation after a failed delegation", async ({
  page,
  context,
}) => {
  test.skip(
    (!process.env.VITE_CONVEX_URL && !process.env.PUBLIC_CONVEX_URL) ||
      !process.env.VITE_CONVEX_SITE_URL,
    "Set synthetic Convex and auth URLs for the browser fixture.",
  );
  await context.grantPermissions(["microphone"]);
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ json: null }),
  );
  const messages: Array<{
    type: string;
    delegation_id?: string;
    content?: string;
  }> = [];
  const sessions: WebSocketRoute[] = [];
  await page.routeWebSocket("**/api/live", (socket) => {
    sessions.push(socket);
    socket.onMessage((wire) => {
      const message = JSON.parse(String(wire));
      messages.push(message);
      if (message.type === "twyne.live.connect")
        socket.send(JSON.stringify({ type: "twyne.live.ready" }));
      if (message.type === "session.start")
        socket.send(JSON.stringify({ type: "session.started" }));
      if (message.type === "session.close")
        socket.send(
          JSON.stringify({ type: "session.closed", usage: { seconds: 1 } }),
        );
    });
  });
  await seed(page);
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const id = "live-recovery";
    const now = Date.now();
    await idb.saveFoliosToIdb([
      {
        id,
        name: "Live recovery",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await idb.saveActiveFolioIdToIdb(id);
    await idb.saveFolioContentToIdb(id, "<p>The manuscript stays open.</p>");
    await idb.saveBriefToIdb(id, {
      answers: {
        workingTitle: "Live recovery",
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
  await expect(page.locator(".ProseMirror").first()).toContainText(
    "The manuscript stays open.",
  );
  await page.evaluate(async () => {
    const resource = (module: string) =>
      performance.getEntriesByType("resource").find(({ name }) =>
        name.includes(`/convex_${module}.js`),
      )?.name;
    const authPath = "/src/utils/auth-client.ts";
    const [{ ConvexClient }, { getFunctionName }, { authClient }] =
      await Promise.all([
        import(/* @vite-ignore */ resource("browser")!),
        import(/* @vite-ignore */ resource("server")!),
        import(/* @vite-ignore */ authPath),
      ]);
    let delegation = 0;
    // Stub the authenticated Convex client while exercising the desk, actual
    // browser microphone capture, and same-origin Live WebSocket.
    ConvexClient.prototype.setAuth = (
      _: unknown,
      done?: (ok: boolean) => void,
    ) => done?.(true);
    ConvexClient.prototype.onUpdate = () => () => {};
    ConvexClient.prototype.query = async (ref: unknown) =>
      getFunctionName(ref) === "preferences:list" ? [] : null;
    ConvexClient.prototype.mutation = async () => ({});
    ConvexClient.prototype.action = async (ref: unknown) => {
      const name = getFunctionName(ref);
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
          idempotencyKey: "live-recovery",
          maxCostMicrousd: 500_000,
        };
      if (name !== "liveVoice:interpret") return null;
      if (++delegation === 1) throw new Error("Fixture provider unavailable");
      return {
        kind: "answer",
        text: "The next request succeeded.",
        original: "",
        target: "",
      };
    };
    authClient.useSession.set({
      ...authClient.useSession.get(),
      isPending: false,
      data: {
        user: { id: "live-recovery-user", name: "Live recovery fixture" },
        session: { id: "live-recovery-session" },
      },
    });
  });
  const desk = page.getByRole("complementary", { name: "Live voice desk" });
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("twyne:live-voice-open")),
      );
      return desk.isVisible();
    })
    .toBe(true);
  await desk.getByRole("button", { name: "Start talking" }).click();
  await expect(desk).toHaveAttribute("data-status", "listening");
  const audioChunks = () =>
    messages.filter((message) => message.type === "session.input_audio.append")
      .length;
  await expect.poll(audioChunks).toBeGreaterThan(0);
  const send = (event: object) => sessions[0]!.send(JSON.stringify(event));
  const delegate = (id: string) =>
    send({
      type: "session.delegation.created",
      delegation: { id, target: "client" },
    });
  send({
    type: "session.input_transcript.delta",
    delta: "Please read this passage.",
  });
  delegate("failed");
  await expect(
    desk.getByText("That action couldn’t finish. You can ask again."),
  ).toBeVisible();
  await expect
    .poll(() => messages.find((message) => message.delegation_id === "failed"))
    .toMatchObject({
      type: "session.commentary.append",
      content: "That action couldn’t finish. You can ask again.",
    });
  send({ type: "error", error: { code: "invalid_live_event" } });
  await expect(
    desk.getByText("Live couldn’t complete the last request."),
  ).toBeVisible();
  await expect(desk).toHaveAttribute("data-status", "listening");
  const chunksAfterFailure = audioChunks();
  delegate("recovered");
  await expect
    .poll(() =>
      messages.find((message) => message.delegation_id === "recovered"),
    )
    .toMatchObject({
      type: "session.commentary.append",
      content: "The next request succeeded.",
    });
  send({
    type: "session.output_transcript.delta",
    delta: "The next request succeeded.",
  });
  await expect(desk.getByLabel("Conversation captions")).toContainText(
    "The next request succeeded.",
  );
  await expect(desk.getByLabel("Conversation captions")).toContainText(
    "Please read this passage.",
  );
  await expect.poll(audioChunks).toBeGreaterThan(chunksAfterFailure);
  expect(sessions).toHaveLength(1);
  await desk.getByRole("button", { name: "End", exact: true }).click();
  await expect(desk).toHaveAttribute("data-status", "idle");
  await expect(
    desk.getByText("Conversation ended", { exact: true }),
  ).toBeVisible();
});
