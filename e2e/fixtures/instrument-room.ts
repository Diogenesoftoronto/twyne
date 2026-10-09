import { expect, type Page, type Route } from "@playwright/test";
import type { UserComment } from "../../src/utils/user-comments";
import {
  INSTRUMENT_MANUSCRIPT,
  INSTRUMENT_SENTENCE,
  INSTRUMENT_REPEAT,
} from "./instruments";

/** Fictional transports: this proves application wiring, never live model quality. */
export const JUDGEMENT_ENDPOINT = "https://judgement-fixture.invalid";
export const REPLY_ENDPOINT = "https://reply-fixture.invalid/v1";
export const FOLIO_ID = "instrument-room-browser-fixture";
export const CUSTOM_EDITOR = {
  id: "fixture-night-editor",
  name: "The Night Editor",
  role: "A custom continuity reader",
  icon: "N",
  color: "#334455",
  description:
    "A fictional custom editor used to test honest portrait identity.",
  focus: "Continuity in the writer's exact passage",
  criticalMethod:
    "Compare the current source with the writer's stated question.",
  voice: "Brief and concrete.",
};
export const FIXTURE_REPLY =
  "Browser transport fixture — not live editorial advice. Keep the source and the unapplied comparison distinct; this reply changes no manuscript words.";
export const SCENE_SOURCE =
  "A quiet room waited above the shop. We opened the window and listened to the rain.";

export const manuscript = (page: Page) => page.locator(".ProseMirror").first();
export const room = (page: Page) =>
  page.getByRole("region", { name: "Ask the editorial room", exact: true });

export interface JudgementWireRequest {
  model: string;
  state: Record<string, string>;
  questions: Record<
    string,
    {
      type: string;
      instructions: string;
      criteria?: Record<string, null> | string[];
    }
  >;
}
export interface ReplyWireRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
}

export function editorChoiceResponse(
  request: JudgementWireRequest,
  personaId: string | "none",
) {
  const cast = JSON.parse(request.state.editors) as Array<{
    choice: string;
    id: string;
    name: string;
  }>;
  const selected =
    personaId === "none"
      ? "none"
      : cast.find((persona) => persona.id === personaId)?.choice;
  if (!selected)
    throw new Error(`Fixture editor absent from request: ${personaId}`);
  const labels = Object.keys(request.questions.editor.criteria ?? {});
  if (!labels.includes(selected))
    throw new Error("Fixture choice is not allowed");
  return {
    model: "fixture-judgement-not-live",
    answers: {
      editor: {
        type: "choice",
        choice: selected,
        confidence: 0.91,
        probabilities: Object.fromEntries(
          labels.map((label) => [
            label,
            label === selected ? 0.91 : 0.09 / (labels.length - 1),
          ]),
        ),
      },
    },
    usage: { input_tokens: 16, output_tokens: 2 },
  };
}

function replyStream(
  text = FIXTURE_REPLY,
  model = "fixture-comment-reply-not-live",
) {
  const base = {
    id: "fixture-reply-not-live",
    object: "chat.completion.chunk",
    created: 1,
    model,
  };
  return (
    [
      {
        ...base,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: text },
            finish_reason: null,
          },
        ],
      },
      {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 16, completion_tokens: 13, total_tokens: 29 },
      },
    ]
      .map((value) => `data: ${JSON.stringify(value)}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

/** Install only transport-boundary fixtures; the room and reply agent stay real. */
export async function installRoomTransports(
  page: Page,
  input: {
    choose?: string;
    holdJudgement?: Promise<void>;
    judgementAvailable?: boolean;
  } = {},
) {
  const judgements: JudgementWireRequest[] = [];
  const replies: ReplyWireRequest[] = [];
  const research: ReplyWireRequest[] = [];
  const wordings: ReplyWireRequest[] = [];
  const meaning: JudgementWireRequest[] = [];
  const paragraphs: JudgementWireRequest[] = [];
  const threads: JudgementWireRequest[] = [];
  const fulfillJudgement = async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
      return;
    }
    const request = route.request().postDataJSON() as JudgementWireRequest;
    const questionKeys = Object.keys(request.questions);
    if (
      questionKeys.length &&
      questionKeys.every((key) =>
        /^p\d+_(evidence|integrity|pacing|voice|tense)$/.test(key),
      )
    ) {
      // The existing paragraph review shares this selected endpoint; its fixture is separate from room routing.
      expect(questionKeys.length).toBeLessThanOrEqual(20);
      expect(JSON.stringify(request.state)).toContain(INSTRUMENT_REPEAT);
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([key, question]) => {
          if (question.type === "score") {
            expect(Array.isArray(question.criteria)).toBe(true);
            const labels = question.criteria as string[];
            expect(labels).toHaveLength(5);
            return [
              key,
              {
                type: "score",
                score: 2,
                confidence: 0.7,
                legend: Object.fromEntries(
                  labels.map((label, i) => [String(i), label]),
                ),
                probabilities: Object.fromEntries(
                  labels.map((_, i) => [String(i), i === 2 ? 0.7 : 0.075]),
                ),
              },
            ];
          }
          expect(question.type).toBe("choice");
          const labels = Object.keys(question.criteria ?? {});
          expect(labels).toContain("Past-tense narration");
          return [
            key,
            {
              type: "choice",
              choice: "Past-tense narration",
              confidence: 0.7,
              probabilities: Object.fromEntries(
                labels.map((label) => [
                  label,
                  label === "Past-tense narration"
                    ? 0.7
                    : 0.3 / (labels.length - 1),
                ]),
              ),
            },
          ];
        }),
      );
      paragraphs.push(request);
      await route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          model: "fixture-paragraph-review-not-live",
          usage: { input_tokens: 16, output_tokens: 4 },
          answers,
        }),
      });
      return;
    }
    if (
      questionKeys.length &&
      questionKeys.every((key) => /^(exists|relation)\d+$/.test(key))
    ) {
      // Existing Threads verification reads only the exact code-owned span IDs.
      const spans = JSON.parse(request.state.spans) as Record<string, string>;
      const pairs = JSON.parse(request.state.pairs) as Record<
        string,
        { first: string; second: string }
      >;
      expect(Object.keys(pairs).length).toBeLessThanOrEqual(12);
      expect(Object.values(spans)).toContain(INSTRUMENT_REPEAT);
      for (const pair of Object.values(pairs)) {
        expect(pair.first).not.toBe(pair.second);
        expect(spans[pair.first]).toBeTruthy();
        expect(spans[pair.second]).toBeTruthy();
      }
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([key, question]) => {
          if (key.startsWith("exists")) {
            expect(question.type).toBe("noul");
            return [key, { type: "noul", noul: 0.8 }];
          }
          expect(question.type).toBe("choice");
          const labels = Object.keys(question.criteria ?? {});
          expect(labels).toEqual([
            "repeats",
            "supports",
            "contradicts",
            "sets up",
            "pays off",
            "answers",
            "refers back to",
            "no real relation",
          ]);
          return [
            key,
            {
              type: "choice",
              choice: "repeats",
              confidence: 0.8,
              probabilities: Object.fromEntries(
                labels.map((label) => [
                  label,
                  label === "repeats" ? 0.8 : 0.2 / (labels.length - 1),
                ]),
              ),
            },
          ];
        }),
      );
      threads.push(request);
      await route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          model: "fixture-thread-verification-not-live",
          usage: { input_tokens: 16, output_tokens: 4 },
          answers,
        }),
      });
      return;
    }
    if (!request.questions.editor) {
      // Existing Sentence bench meaning checks are independent of room routing.
      expect(
        Object.keys(request.questions).every((key) => /^meaning\d+$/.test(key)),
      ).toBe(true);
      expect(
        Object.values(request.questions).every(
          (question) => question.type === "noul",
        ),
      ).toBe(true);
      expect(request.state.original).toBeTruthy();
      expect(request.state.paragraph).toContain(request.state.original);
      meaning.push(request);
      await route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          model: "fixture-meaning-not-live",
          usage: { input_tokens: 16, output_tokens: 2 },
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { type: "noul", noul: 0.82 },
            ]),
          ),
        }),
      });
      return;
    }
    expect(Object.keys(request.questions)).toEqual(["editor"]);
    expect(["sentence", "threads", "scene"]).toContain(
      request.state.instrument,
    );
    judgements.push(request);
    await input.holdJudgement;
    await route.fulfill({
      status: input.judgementAvailable === false ? 503 : 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        input.judgementAvailable === false
          ? { error: "Labelled browser fixture: judgement unavailable" }
          : editorChoiceResponse(request, input.choose ?? "editor"),
      ),
    });
  };
  await page.route(`${JUDGEMENT_ENDPOINT}/v1/systemone`, fulfillJudgement);
  await page.route("**/api/provider/", async (route) => {
    expect(route.request().headers()["x-twyne-provider-url"]).toBe(
      `${REPLY_ENDPOINT}/chat/completions`,
    );
    const request = route.request().postDataJSON() as ReplyWireRequest;
    const system =
      request.messages.find((message) => message.role === "system")?.content ??
      "";
    const prompt =
      request.messages.find((message) => message.role === "user")?.content ??
      "";
    if (request.model === "fixture-research-not-live") {
      // The existing automatic Apparatus pass is explicitly accounted for.
      expect(request.stream).not.toBe(true);
      expect(system).toContain("proactive research librarian");
      expect(prompt).toContain("FACT-CHECK UP TO");
      expect(prompt).toContain(INSTRUMENT_REPEAT);
      research.push(request);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "fixture-research-not-live",
          object: "chat.completion",
          created: 1,
          model: request.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"targets":[]}' },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 16, completion_tokens: 4, total_tokens: 20 },
        }),
      });
      return;
    }
    if (request.model === "fixture-wordings-not-live") {
      expect(request.stream).toBe(true);
      expect(system).toContain("You fill one small tool inside a writing app");
      expect(prompt).toContain("SENTENCE:");
      expect(prompt).toContain("/elements/tool/props/variants/-");
      wordings.push(request);
      const variant =
        "Browser fixture wording only: we decided to find a quiet room.";
      await route.fulfill({
        contentType: "text/event-stream",
        body: replyStream(
          JSON.stringify({
            op: "add",
            path: "/elements/tool/props/variants/-",
            value: variant,
          }),
          request.model,
        ),
      });
      return;
    }
    expect(request.model).toBe("fixture-comment-reply-not-live");
    expect(request.stream).toBe(true);
    expect(prompt).toContain("A focused question for");
    replies.push(request);
    await route.fulfill({
      contentType: "text/event-stream",
      body: replyStream(),
    });
  });
  return {
    judgements,
    replies,
    research,
    wordings,
    meaning,
    paragraphs,
    threads,
  };
}

export async function seedRoom(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__instrument-room-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Fictional room fixture</title>",
    }),
  );
  await page.goto("/__instrument-room-seed");
  await page.evaluate(
    async ({ html, folioId, judgementEndpoint, replyEndpoint, custom }) => {
      const dbPath = "/src/utils/idb.ts";
      const castPath = "/src/utils/personas.ts";
      const db = await import(/* @vite-ignore */ dbPath);
      const { PERSONAS } = await import(/* @vite-ignore */ castPath);
      const now = Date.now();
      await db.saveFoliosToIdb([
        {
          id: folioId,
          name: "The map and the ledger",
          type: "draft",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await db.saveFolioContentToIdb(folioId, html);
      await db.saveActiveFolioIdToIdb(folioId);
      await db.savePersonasToIdb([...PERSONAS, custom]);
      await db.saveAiSettingsToIdb({
        advancedMode: true,
        defaultProviderId: "fixture-prose",
        providers: [
          {
            id: "fixture-prose",
            name: "Browser transport fixture — not live",
            type: "openai-compatible",
            apiKey: "fictional-fixture-key-not-a-secret",
            baseUrl: replyEndpoint,
            defaultModel: "fixture-prose-not-live",
            apiMode: "chat",
          },
        ],
        perFeature: {
          "research-extract": { model: "fixture-research-not-live" },
          "in-flow-tool": { model: "fixture-wordings-not-live" },
          "comment-reply": { model: "fixture-comment-reply-not-live" },
        },
        showProviderTags: true,
        judgement: {
          source: "endpoint",
          endpointUrl: judgementEndpoint,
          endpointModel: "fixture-judgement-not-live",
        },
      });
      await db.saveMetaToIdb("live-review-enabled", false);
      await db.saveMetaToIdb("signin-toast-dismissed", true);
      localStorage.setItem("living-desk-open", "false");
      localStorage.setItem(
        "twyne:editor:view:v1",
        JSON.stringify({ zenMode: false, compositorOpen: false }),
      );
    },
    {
      html: INSTRUMENT_MANUSCRIPT,
      folioId: FOLIO_ID,
      judgementEndpoint: JUDGEMENT_ENDPOINT,
      replyEndpoint: REPLY_ENDPOINT,
      custom: CUSTOM_EDITOR,
    },
  );
  await page.goto("/editor/");
  await expect(manuscript(page)).toContainText(INSTRUMENT_SENTENCE);
  await page.evaluate(() => document.fonts.ready);
}

/** Native range setup only; every instrument action uses the actual visible UI. */
export async function selectRoomPassage(
  page: Page,
  text: string,
  expectActions = true,
) {
  await manuscript(page).evaluate((root, text) => {
    (root as HTMLElement).focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let plain = "",
      node: Node | null;
    while ((node = walker.nextNode())) {
      nodes.push(node as Text);
      plain += node.textContent ?? "";
    }
    const start = plain.indexOf(text);
    if (start < 0) throw new Error("Fixture passage is absent");
    const range = document.createRange();
    let offset = 0,
      began = false;
    for (const node of nodes) {
      const end = offset + node.length;
      if (!began && start >= offset && start < end) {
        range.setStart(node, start - offset);
        began = true;
      }
      if (began && start + text.length <= end) {
        range.setEnd(node, start + text.length - offset);
        break;
      }
      offset = end;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(text);
  if (expectActions)
    await expect(
      page.getByRole("toolbar", { name: /^Actions for/ }),
    ).toBeVisible();
}

export async function draftRoomText(page: Page) {
  return manuscript(page).evaluate((root) => {
    const copy = root.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(".sentence-bench-ghost,.ld-ghost")
      .forEach((node) => node.remove());
    return copy.textContent;
  });
}

/** Read the real local comment store; no UI or application response is injected. */
export async function savedRoomComments(page: Page): Promise<UserComment[]> {
  return page.evaluate(async (folioId) => {
    const path = "/src/utils/user-comments.ts";
    const { loadUserComments } = await import(/* @vite-ignore */ path);
    return (await loadUserComments()).filter(
      (comment: UserComment) => comment.folioId === folioId,
    );
  }, FOLIO_ID);
}
