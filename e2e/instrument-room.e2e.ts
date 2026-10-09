import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { INSTRUMENT_REPEAT, INSTRUMENT_SENTENCE } from "./fixtures/instruments";
import {
  CUSTOM_EDITOR,
  FIXTURE_REPLY,
  FOLIO_ID,
  JUDGEMENT_ENDPOINT,
  SCENE_SOURCE,
  draftRoomText,
  installRoomTransports,
  manuscript,
  room,
  savedRoomComments,
  seedRoom,
  selectRoomPassage,
} from "./fixtures/instrument-room";

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("Application console:", message.text());
  });
  page.on("pageerror", (error) => console.error("Application error:", error));
});

const KNOWN_EDITOR = {
  id: "editor",
  name: "M. Le Stylo",
  role: "The Copy Chief",
};
const PROPOSAL = "We decided to leave in order to find a very quiet room.";
const SCENE_IDEA =
  "A brass lamp casts a narrow circle across the unopened ledger.";
const CHANGED_SENTENCE = "We chose to stay and open the very quiet room.";

async function openSentence(page: Page, source = INSTRUMENT_SENTENCE) {
  await selectRoomPassage(page, source);
  await page
    .getByRole("toolbar", { name: /^Actions for/ })
    .getByRole("button", { name: "Sentence bench", exact: true })
    .click();
  const invitation = room(page);
  await expect(
    invitation.getByRole("button", { name: "Ask the room", exact: true }),
  ).toBeEnabled();
  return invitation;
}
async function openThreads(page: Page) {
  await selectRoomPassage(page, INSTRUMENT_REPEAT);
  await page
    .getByRole("toolbar", { name: /^Actions for/ })
    .getByRole("button", { name: "Threads", exact: true })
    .click();
  const connection = page
    .getByRole("complementary", { name: "Threads", exact: true })
    .locator("li")
    .filter({ hasText: "The same wording occurs twice." });
  const invitation = connection.getByRole("region", {
    name: "Ask the editorial room",
    exact: true,
  });
  await expect(
    invitation.getByRole("button", { name: "Ask the room", exact: true }),
  ).toBeEnabled();
  return invitation;
}
async function openScene(page: Page) {
  await selectRoomPassage(page, SCENE_SOURCE);
  await page
    .getByRole("toolbar", { name: /^Actions for/ })
    .getByRole("button", { name: "Scene bench", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Writing instruments", exact: true }),
  ).toBeVisible();
  const invitation = room(page);
  await expect(
    invitation.getByRole("button", { name: "Ask the room", exact: true }),
  ).toBeEnabled();
  return invitation;
}
async function inspectInvitation(
  invitation: Locator,
  source: string,
  proposal?: string,
) {
  await invitation
    .locator("summary")
    .filter({ hasText: /^Inspect this invitation$/ })
    .click();
  const quoted = invitation.locator("blockquote");
  await expect(quoted.first()).toHaveText(source);
  if (proposal !== undefined) await expect(quoted.nth(1)).toHaveText(proposal);
}
async function assertSavedReply(
  page: Page,
  anchor: string,
  persona = KNOWN_EDITOR,
) {
  await expect
    .poll(async () =>
      (await savedRoomComments(page)).map((comment) => ({
        folioId: comment.folioId,
        anchor: comment.anchor,
        replies: comment.replies.map((reply) => ({
          personaId: reply.personaId,
          author: reply.author,
          text: reply.text,
        })),
      })),
    )
    .toEqual([
      {
        folioId: FOLIO_ID,
        anchor,
        replies: [
          { personaId: persona.id, author: persona.name, text: FIXTURE_REPLY },
        ],
      },
    ]);
  const [saved] = await savedRoomComments(page);
  const reply = page
    .locator(`[data-speech-id="comment-reply-${saved.replies[0].id}"]:visible`)
    .first();
  await expect(reply).toHaveText(FIXTURE_REPLY);
  const thread = page
    .locator(`[data-comment-id="${saved.id}"]:visible`)
    .filter({
      has: page.locator(
        `[data-speech-id="comment-reply-${saved.replies[0].id}"]`,
      ),
    })
    .first();
  const masthead = thread
    .locator(".persona-masthead")
    .filter({ hasText: persona.name })
    .first();
  await expect(masthead.locator(".persona-masthead__name")).toHaveText(
    persona.name,
  );
  await expect(masthead.locator(".persona-masthead__role")).toHaveText(
    persona.role,
  );
  await masthead.scrollIntoViewIfNeeded();
  await expect(masthead).toBeInViewport();
  await expect(reply).toBeInViewport();
  const headBox = await masthead.boundingBox(),
    replyBox = await reply.boundingBox();
  expect(headBox).not.toBeNull();
  expect(replyBox).not.toBeNull();
  expect(headBox!.y + headBox!.height).toBeLessThanOrEqual(replyBox!.y + 1);
  return { saved, masthead };
}
async function assertKnownPortrait(masthead: Locator) {
  const portrait = masthead.locator('[data-persona-portrait="editor"]');
  await expect(portrait).toHaveCount(1);
  await expect(portrait.locator("img")).toHaveAttribute(
    "src",
    "/assets/manual/editors/editor-transparent-480.webp",
  );
  await expect
    .poll(() =>
      portrait
        .locator("img")
        .evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
    )
    .toBe(true);
}
async function attachTransportProof(
  info: TestInfo,
  transport: Awaited<ReturnType<typeof installRoomTransports>>,
) {
  await info.attach("transport-proof", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        mission: info.title,
        proof:
          "Actual application UI, local persistence and provider transport wiring with labelled fictional network responses; no live account or model quality proof.",
        counts: Object.fromEntries(
          Object.entries(transport).map(([kind, requests]) => [
            kind,
            requests.length,
          ]),
        ),
        roomRequests: transport.judgements.map(({ state }) => ({
          instrument: state.instrument,
          source: state.source,
          question: state.question,
          unappliedProposal: state.unappliedProposal,
        })),
        replyModels: transport.replies.map(({ model }) => model),
      },
      null,
      2,
    ),
  });
}
async function attachMission(page: Page, info: TestInfo, name: string) {
  info.annotations.push({
    type: "proof-boundary",
    description:
      "Real application UI/persistence with labelled network fixtures; no live Jev, prose provider or signed-in account proof.",
  });
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

test("Sentence room selects a real editor and saves the exact unapplied comparison above an unchanged manuscript", async ({
  page,
}, info) => {
  const transport = await installRoomTransports(page);
  await seedRoom(page);
  const original = await draftRoomText(page);
  const invitation = await openSentence(page);
  expect(transport.judgements).toHaveLength(0);
  expect(transport.replies).toHaveLength(0);
  await page
    .locator(".sentence-bench")
    .getByRole("button", { name: /^Compare Use a verb:/ })
    .click();
  await expect(page.locator(".sentence-bench textarea")).toHaveValue(PROPOSAL);
  await inspectInvitation(invitation, INSTRUMENT_SENTENCE, PROPOSAL);
  expect(await draftRoomText(page)).toBe(original);
  await invitation
    .getByRole("button", { name: "Ask the room", exact: true })
    .scrollIntoViewIfNeeded();
  await attachMission(page, info, "desktop-room-invitation");
  await invitation
    .getByRole("button", { name: "Ask the room", exact: true })
    .click();
  const { saved, masthead } = await assertSavedReply(page, INSTRUMENT_SENTENCE);
  const storedInvitation = page
    .locator(`[data-comment-id="${saved.id}"]:visible`)
    .filter({ has: masthead })
    .first()
    .locator("details")
    .filter({
      has: page
        .locator("summary")
        .filter({ hasText: /^Passage and invitation details$/ }),
    });
  await expect(storedInvitation).toHaveCount(1);
  await expect(storedInvitation).toHaveJSProperty("open", false);
  expect(transport.judgements).toHaveLength(1);
  expect(transport.replies).toHaveLength(1);
  const selected = transport.judgements[0];
  expect(selected.state.instrument).toBe("sentence");
  expect(selected.state.source).toBe(INSTRUMENT_SENTENCE);
  expect(selected.state.unappliedProposal).toBe(PROPOSAL);
  expect(selected.state.question).toBe(
    "What might this wording lose or strengthen in its context?",
  );
  expect(saved.text).toContain(
    `Source passage (current manuscript; quoted evidence):\n${INSTRUMENT_SENTENCE}`,
  );
  expect(saved.text).toContain(
    `Unapplied proposal (comparison only; not inserted in the draft):\n${PROPOSAL}`,
  );
  expect(saved.text).toContain(selected.state.question);
  expect(saved.text).toContain(
    "Editor selection record (model choice, not a rationale or endorsement):",
  );
  expect(saved.text).toContain("Model: fixture-judgement-not-live");
  expect(saved.text).toContain("Confidence: 0.91");
  expect(
    transport.replies[0].messages.find((message) => message.role === "system")
      ?.content,
  ).toContain(KNOWN_EDITOR.name);
  expect(
    transport.replies[0].messages.find((message) => message.role === "user")
      ?.content,
  ).toContain(saved.text);
  await assertKnownPortrait(masthead);
  expect(await draftRoomText(page)).toBe(original);
  await attachMission(page, info, "sentence-real-anchored-room-reply");
  await storedInvitation.locator("summary").click();
  await expect(storedInvitation).toHaveJSProperty("open", true);
  await expect(storedInvitation).toContainText(INSTRUMENT_SENTENCE);
  await expect(storedInvitation).toContainText(PROPOSAL);
  await expect(storedInvitation).toContainText(
    "Model: fixture-judgement-not-live",
  );
  await expect(storedInvitation).toContainText(
    "Complete Choice distribution (weights compare editors, not comment quality):",
  );
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await page.reload();
  await expect.poll(() => draftRoomText(page)).toBe(original);
  const reloaded = await savedRoomComments(page);
  expect(reloaded).toHaveLength(1);
  expect(reloaded[0].text).toBe(saved.text);
  expect(reloaded[0].anchor).toBe(INSTRUMENT_SENTENCE);
  expect(reloaded[0].replies[0].text).toBe(FIXTURE_REPLY);
  expect(reloaded[0].replies[0].personaId).toBe(KNOWN_EDITOR.id);
  expect(transport.judgements).toHaveLength(1);
  expect(transport.replies).toHaveLength(1);
  await attachTransportProof(info, transport);
});

test("Threads room sends both actual recurrence spans and anchors one saved editorial reply", async ({
  page,
}, info) => {
  const transport = await installRoomTransports(page);
  await seedRoom(page);
  const original = await draftRoomText(page);
  const invitation = await openThreads(page);
  expect(transport.judgements).toHaveLength(0);
  expect(transport.replies).toHaveLength(0);
  await invitation
    .getByRole("button", { name: "Ask the room", exact: true })
    .click();
  const { saved, masthead } = await assertSavedReply(page, INSTRUMENT_REPEAT);
  expect(transport.judgements).toHaveLength(1);
  expect(transport.replies).toHaveLength(1);
  const request = transport.judgements[0];
  expect(request.state.instrument).toBe("threads");
  expect(
    request.state.source.match(/The ledger held every name we remembered\./g),
  ).toHaveLength(2);
  expect(request.state.source).toMatch(/^First passage \(sentence \d+\):\n/);
  expect(request.state.source).toContain("\n\nSecond passage (sentence ");
  expect(request.state.unappliedProposal).toBe("");
  expect(saved.text).toContain(request.state.source);
  expect(saved.text).toContain(request.state.question);
  expect(saved.text).toContain(
    "evidence to review, not a persona's endorsement",
  );
  await assertKnownPortrait(masthead);
  expect(await draftRoomText(page)).toBe(original);
  await attachMission(page, info, "threads-real-span-room-reply");
  await attachTransportProof(info, transport);
});

test("Scene room files source and a proposed detail separately through the real reply transport", async ({
  page,
}, info) => {
  const transport = await installRoomTransports(page);
  await seedRoom(page);
  const original = await draftRoomText(page);
  const invitation = await openScene(page);
  expect(transport.judgements).toHaveLength(0);
  expect(transport.replies).toHaveLength(0);
  await page.getByLabel("An idea to try", { exact: true }).fill(SCENE_IDEA);
  await inspectInvitation(invitation, SCENE_SOURCE, SCENE_IDEA);
  await invitation
    .getByRole("button", { name: "Ask the room", exact: true })
    .click();
  const { saved, masthead } = await assertSavedReply(page, SCENE_SOURCE);
  expect(transport.judgements).toHaveLength(1);
  expect(transport.replies).toHaveLength(1);
  const request = transport.judgements[0];
  expect(request.state.instrument).toBe("scene");
  expect(request.state.source).toBe(SCENE_SOURCE);
  expect(request.state.unappliedProposal).toBe(SCENE_IDEA);
  expect(saved.text).toContain(
    `Source passage (current manuscript; quoted evidence):\n${SCENE_SOURCE}`,
  );
  expect(saved.text).toContain(
    `Unapplied proposal (comparison only; not inserted in the draft):\n${SCENE_IDEA}`,
  );
  expect(saved.text).toContain(request.state.question);
  await assertKnownPortrait(masthead);
  expect(await draftRoomText(page)).toBe(original);
  await attachMission(page, info, "scene-unapplied-detail-room-reply");
  await attachTransportProof(info, transport);
});

test("A none judgement requests no critique and saves no margin thread", async ({
  page,
}, info) => {
  const transport = await installRoomTransports(page, { choose: "none" });
  await seedRoom(page);
  const original = await draftRoomText(page);
  const invitation = await openSentence(page);
  await invitation
    .getByRole("button", { name: "Ask the room", exact: true })
    .click();
  await expect(invitation.getByRole("status")).toHaveText(
    "The judgement model selected no editor for this question. No comment was requested. You can still choose an editor yourself.",
  );
  expect(transport.judgements).toHaveLength(1);
  expect(transport.replies).toHaveLength(0);
  expect(await savedRoomComments(page)).toEqual([]);
  expect(await draftRoomText(page)).toBe(original);
  await invitation
    .locator("summary")
    .filter({ hasText: /^Inspect selection distribution$/ })
    .click();
  await expect(invitation).toContainText("fixture-judgement-not-live");
  await expect(invitation).toContainText(
    "they do not verify a contribution's quality",
  );
  await attachMission(page, info, "none-means-no-editor-call");
  await attachTransportProof(info, transport);
});

test("A delayed judgement for changed source is dropped before a fresh source gets its own reply", async ({
  page,
}, info) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = await installRoomTransports(page, { holdJudgement: held });
  try {
    await seedRoom(page);
    const original = await draftRoomText(page);
    const invitation = await openSentence(page);
    await invitation
      .getByRole("button", { name: "Ask the room", exact: true })
      .click();
    await expect.poll(() => transport.judgements.length).toBe(1);
    // An open instrument suppresses the selection toolbar; native source editing remains available.
    await selectRoomPassage(page, INSTRUMENT_SENTENCE, false);
    await page.keyboard.insertText(CHANGED_SENTENCE);
    await expect(manuscript(page).locator("strong").first()).toHaveText(
      CHANGED_SENTENCE,
    );
    const finished = page.waitForResponse(
      (response) =>
        response.url() === `${JUDGEMENT_ENDPOINT}/v1/systemone` &&
        response.request().method() === "POST",
    );
    release();
    await (await finished).finished();
    const current = await openSentence(page, CHANGED_SENTENCE);
    await current
      .getByRole("button", { name: "Ask the room", exact: true })
      .click();
    const { saved, masthead } = await assertSavedReply(page, CHANGED_SENTENCE);
    expect(transport.judgements).toHaveLength(2);
    expect(transport.judgements.map((request) => request.state.source)).toEqual(
      [INSTRUMENT_SENTENCE, CHANGED_SENTENCE],
    );
    expect(transport.replies).toHaveLength(1);
    expect(saved.text).toContain(CHANGED_SENTENCE);
    expect(saved.text).not.toContain(INSTRUMENT_SENTENCE);
    await assertKnownPortrait(masthead);
    expect(await draftRoomText(page)).toBe(
      original!.replace(INSTRUMENT_SENTENCE, CHANGED_SENTENCE),
    );
    await attachMission(page, info, "old-source-dropped-new-source-replied");
    await attachTransportProof(info, transport);
  } finally {
    release();
  }
});

test("Narrow manual fallback preserves a custom editor identity without borrowing a resident face", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const transport = await installRoomTransports(page, {
    judgementAvailable: false,
  });
  await seedRoom(page);
  const original = await draftRoomText(page);
  const invitation = await openSentence(page);
  expect(transport.judgements).toHaveLength(0);
  expect(transport.replies).toHaveLength(0);
  await invitation
    .getByRole("button", { name: "Ask the room", exact: true })
    .click();
  await expect(invitation.getByRole("status")).toHaveText(
    "The selected judgement model could not choose an editor. You can choose one yourself.",
  );
  expect(transport.replies).toHaveLength(0);
  await invitation
    .locator("summary")
    .filter({ hasText: /^Choose an editor$/ })
    .click();
  await invitation
    .getByRole("combobox", { name: "Editor for this question", exact: true })
    .selectOption(CUSTOM_EDITOR.id);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  await invitation
    .getByRole("button", { name: "Ask chosen editor", exact: true })
    .scrollIntoViewIfNeeded();
  await attachMission(page, info, "narrow-room-invitation");
  await invitation
    .getByRole("button", { name: "Ask chosen editor", exact: true })
    .click();
  const { masthead } = await assertSavedReply(
    page,
    INSTRUMENT_SENTENCE,
    CUSTOM_EDITOR,
  );
  expect(transport.judgements).toHaveLength(1);
  expect(transport.replies).toHaveLength(1);
  const portrait = masthead.locator('[data-persona-portrait="initials"]');
  await expect(portrait).toHaveAttribute("data-portrait-fallback", "true");
  await expect(portrait.locator("img")).toHaveCount(0);
  await expect(portrait.locator(".persona-portrait__initials")).toHaveText(
    "TN",
  );
  await expect(
    masthead.locator('[data-persona-portrait="editor"]'),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  expect(await draftRoomText(page)).toBe(original);
  await attachMission(page, info, "narrow-custom-editor-honest-identity");
  await attachTransportProof(info, transport);
});
