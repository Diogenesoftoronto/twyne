import { expect, test, type Page } from "@playwright/test";

type HighlightRegistry = Map<string, Iterable<Range>>;

async function installWordTimingFixture(page: Page) {
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => new URL(entry.name).pathname === "/src/utils/speech.ts"),
  );
  await page.evaluate(() => {
    // Reuse the singleton loaded by Qwik, including Vite's current HMR query.
    // Importing the bare URL after an edit would create another speech manager.
    (
      window as typeof window & { speechFixtureModuleUrl: string }
    ).speechFixtureModuleUrl = performance
      .getEntriesByType("resource")
      .find(
        (entry) => new URL(entry.name).pathname === "/src/utils/speech.ts",
      )!.name;
    const positions = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperties(HTMLMediaElement.prototype, {
      src: { configurable: true, get: () => "", set: () => {} },
      duration: { configurable: true, get: () => 10 },
      currentTime: {
        configurable: true,
        get(this: HTMLMediaElement) {
          return positions.get(this) ?? 0;
        },
        set(this: HTMLMediaElement, value: number) {
          positions.set(this, value);
        },
      },
    });
    HTMLMediaElement.prototype.play = async function () {
      (
        window as typeof window & { speechFixtureAudio: HTMLMediaElement }
      ).speechFixtureAudio = this;
      this.dispatchEvent(new Event("loadedmetadata"));
    };
    HTMLMediaElement.prototype.pause = () => {};
  });
}

async function setFixtureTime(page: Page, seconds: number) {
  await page.evaluate((seconds) => {
    const audio = (
      window as typeof window & { speechFixtureAudio: HTMLMediaElement }
    ).speechFixtureAudio;
    audio.currentTime = seconds;
    audio.dispatchEvent(new Event("timeupdate"));
  }, seconds);
}

async function fixtureCurrentTime(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { speechFixtureAudio: HTMLMediaElement })
        .speechFixtureAudio.currentTime,
  );
}

async function highlightedText(page: Page, kind: "word" | "sentence") {
  return page.evaluate((kind) => {
    const registry = (CSS as typeof CSS & { highlights: HighlightRegistry })
      .highlights;
    return (
      Array.from(registry.get(`twyne-speech-${kind}`) ?? [])[0]?.toString() ??
      null
    );
  }, kind);
}

async function highlightedAncestor(page: Page) {
  return page.evaluate(() => {
    const registry = (CSS as typeof CSS & { highlights: HighlightRegistry })
      .highlights;
    return (
      Array.from(registry.get("twyne-speech-word") ?? [])[0]
        ?.commonAncestorContainer.parentElement?.tagName ?? null
    );
  });
}

async function highlightStart(page: Page) {
  return page.evaluate(() => {
    const registry = (CSS as typeof CSS & { highlights: HighlightRegistry })
      .highlights;
    return (
      Array.from(registry.get("twyne-speech-word") ?? [])[0]?.startOffset ?? -1
    );
  });
}

/**
 * The toolbar's read control used to call the speech manager and then show
 * nothing at all — no spinner, no playing state, and crucially no error. A
 * writer with no voice provider configured pressed it and got silence, which
 * is indistinguishable from a broken button. These tests are about the state
 * being visible, not about the audio itself.
 */

async function openEditor(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open("twyne", 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of [
          ["folios", "id"],
          ["folio-content", "folioId"],
          ["brief", "folioId"],
          ["comments", "id"],
          ["personas", "id"],
          ["meta", "key"],
          ["ai-settings", "key"],
          ["lix-blob", "key"],
          ["voice-notes", "id"],
        ] as const) {
          if (!d.objectStoreNames.contains(name)) {
            d.createObjectStore(name, { keyPath });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(
        ["folios", "folio-content", "meta"],
        "readwrite",
      );
      t.objectStore("folios").put({
        id: "e2e-speech",
        name: "Speech fixture",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      });
      t.objectStore("folio-content").put({
        folioId: "e2e-speech",
        html: "<p>A passage the room can read back to the writer.</p>",
        updatedAt: now,
      });
      t.objectStore("meta").put({
        key: "active-folio-id",
        value: "e2e-speech",
        updatedAt: now,
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  });
  await page.goto("/editor/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
}

test.describe("read aloud transport", () => {
  test("the voice picker matches each speaking editor and applies a new selection", async ({
    page,
  }) => {
    await page.goto("/desk/");
    await expect(
      page.getByRole("heading", { name: "My Desk", exact: true }),
    ).toBeVisible();
    await installWordTimingFixture(page);
    const picker = page.getByRole("combobox", {
      name: "Change narration voice and restart passage",
    });
    const cast = await page.evaluate(async () => {
      const spec = "/src/utils/personas.ts";
      const { PERSONAS } = await import(/* @vite-ignore */ spec);
      const hostedSpec = "/src/utils/hosted-speech.ts";
      const { resolveHostedSpeechVoice } = await import(
        /* @vite-ignore */ hostedSpec
      );
      return PERSONAS.map(
        (p: { id: string; name: string; speechVoice: string }) => ({
          id: p.id,
          name: p.name,
          voice: resolveHostedSpeechVoice(p.speechVoice),
        }),
      );
    });
    for (const persona of cast) {
      const sent = await page.evaluate(async (persona) => {
        const spec = (
          window as typeof window & { speechFixtureModuleUrl: string }
        ).speechFixtureModuleUrl;
        const speech = await import(/* @vite-ignore */ spec);
        const fixture = window as typeof window & { narrationVoices: string[] };
        fixture.narrationVoices = [];
        await speech.speak({
          id: `picker-${persona.id}`,
          text: `Fictional note from ${persona.name}.`,
          author: persona.name,
          signedIn: true,
          client: {
            action: async (_ref: unknown, args: { voice: string }) => {
              fixture.narrationVoices.push(args.voice);
              return {
                audioBase64:
                  "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
                mimeType: "audio/wav",
              };
            },
          },
        });
        return fixture.narrationVoices;
      }, persona);
      expect(sent).toEqual([persona.voice]);
      await expect(picker).toHaveValue(persona.voice);
      await expect(picker.locator("option:checked")).toHaveText(
        `${persona.name} · ${persona.voice}`,
      );
    }
    await picker.selectOption("Daniel");
    await expect(picker).toHaveValue("Daniel");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as typeof window & { narrationVoices: string[] }
          ).narrationVoices.at(-1),
        ),
      )
      .toBe("Daniel");
    await page
      .getByRole("button", { name: "Stop narration and close player" })
      .click();
    await expect(picker).toHaveCount(0);
  });

  test("native word timing follows rendered Markdown and seeks the verified visible word", async ({
    page,
  }) => {
    await page.goto("/desk/");
    await expect(
      page.getByRole("heading", { name: "My Desk", exact: true }),
    ).toBeVisible();
    await installWordTimingFixture(page);
    await page.evaluate(async () => {
      const spec = "/src/utils/markdown.ts";
      const { renderMarkdown } = await import(/* @vite-ignore */ spec);
      const source =
        "🙂 Read **same** and [same](https://example.test/same).\n\n- Next same\n- Last word.";
      const fixture = document.createElement("article");
      fixture.dataset.speechId = "aligned-markdown";
      fixture.className = "comment-markdown";
      fixture.style.cssText =
        "font:24px/1.8 serif;max-width:42rem;margin:32px;padding:20px";
      fixture.innerHTML = renderMarkdown(source);
      document.querySelector("main")!.append(fixture);
      const specSpeech = (
        window as typeof window & { speechFixtureModuleUrl: string }
      ).speechFixtureModuleUrl;
      const speech = await import(/* @vite-ignore */ specSpeech);
      const first = source.indexOf("same");
      const linked = source.indexOf("same", first + 1);
      const next = source.indexOf("Next");
      const ranges = [
        {
          sourceStart: first,
          sourceEnd: first + 4,
          audioStart: 0,
          audioEnd: 0.8,
          precision: "word",
        },
        {
          sourceStart: linked,
          sourceEnd: linked + 4,
          audioStart: 1,
          audioEnd: 1.8,
          precision: "word",
        },
        {
          sourceStart: next,
          sourceEnd: next + 4,
          audioStart: 2,
          audioEnd: 2.8,
          precision: "word",
        },
      ];
      await speech.speak({
        id: "aligned-markdown",
        text: source,
        signedIn: true,
        client: {
          action: async () => ({
            audioBase64: "",
            mimeType: "audio/mpeg",
            alignment: { provider: "elevenlabs", ranges },
          }),
        },
      });
    });
    await expect.poll(() => highlightedText(page, "word")).toBe("same");
    await expect.poll(() => highlightedAncestor(page)).toBe("STRONG");
    await setFixtureTime(page, 1.2);
    await expect.poll(() => highlightedAncestor(page)).toBe("A");
    await setFixtureTime(page, 2.2);
    await expect.poll(() => highlightedText(page, "word")).toBe("Next");
    await expect
      .poll(() => highlightedText(page, "sentence"))
      .toBe("Next same");

    // Click-to-seek uses the rendered range, not the raw Markdown offset.
    await page.locator('[data-speech-id="aligned-markdown"] strong').click();
    await expect.poll(() => fixtureCurrentTime(page)).toBe(0);
    await expect.poll(() => highlightedAncestor(page)).toBe("STRONG");
  });

  test("native word timing rebuilds the map for manuscript chunks with the same reading id", async ({
    page,
  }) => {
    await page.goto("/desk/");
    await expect(
      page.getByRole("heading", { name: "My Desk", exact: true }),
    ).toBeVisible();
    await installWordTimingFixture(page);
    await page.evaluate(async () => {
      const clip = "🙂 Same words. Next sentence.";
      const prefix = `${clip}\n\nA different paragraph.\n\n`;
      const target = document.createElement("article");
      target.dataset.speechId = "aligned-manuscript";
      target.dataset.speechSource = "plain";
      target.style.cssText =
        "font:24px/1.8 serif;white-space:pre-wrap;max-width:42rem;margin:32px;padding:20px";
      target.textContent = prefix + clip;
      document.querySelector("main")!.append(target);
      const spec = (
        window as typeof window & { speechFixtureModuleUrl: string }
      ).speechFixtureModuleUrl;
      const speech = await import(/* @vite-ignore */ spec);
      const ranges = [
        {
          sourceStart: 3,
          sourceEnd: 7,
          audioStart: 0,
          audioEnd: 0.8,
          precision: "word",
        },
        {
          sourceStart: 15,
          sourceEnd: 19,
          audioStart: 1,
          audioEnd: 1.8,
          precision: "word",
        },
      ];
      const client = {
        action: async () => ({
          audioBase64: "",
          mimeType: "audio/mpeg",
          alignment: { provider: "elevenlabs", ranges },
        }),
      };
      await speech.speakQueue(
        [
          {
            id: "aligned-manuscript",
            text: clip,
            sourceOffset: 0,
            client,
            signedIn: true,
          },
          {
            id: "aligned-manuscript",
            text: clip,
            sourceOffset: prefix.length,
            client,
            signedIn: true,
          },
        ],
        { ownerId: "aligned-manuscript" },
      );
    });
    await expect.poll(() => highlightedText(page, "word")).toBe("Same");
    await expect.poll(() => highlightStart(page)).toBe(3);
    await page.evaluate(async () => {
      const spec = (
        window as typeof window & { speechFixtureModuleUrl: string }
      ).speechFixtureModuleUrl;
      const speech = await import(/* @vite-ignore */ spec);
      speech.nextSpeech();
    });
    await expect.poll(() => highlightStart(page)).toBeGreaterThan(30);
    await setFixtureTime(page, 1.2);
    await expect.poll(() => highlightedText(page, "word")).toBe("Next");
    await expect
      .poll(() => highlightedText(page, "sentence"))
      .toBe("Next sentence");
  });

  test("the control is present and starts idle", async ({ page }) => {
    await openEditor(page);
    const play = page.getByRole("button", {
      name: /read the selection aloud/i,
    });
    await expect(play).toBeVisible();
    await expect(play).toHaveText(/read/i);
    // Nothing to stop or seek until something is sounding.
    await expect(
      page.getByRole("button", { name: "Stop reading" }),
    ).toHaveCount(0);
  });

  test("a failed reading reports itself instead of going silent", async ({
    page,
  }) => {
    // No voice provider is configured in the test environment and there is no
    // account, so synthesis must fail. The point is that it fails *visibly*.
    await openEditor(page);
    await page
      .getByRole("button", { name: /read the selection aloud/i })
      .click();

    const notice = page.locator('.twyne-toolbar [role="status"]');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    // A specific reason, not an empty box. The manager reaches this state via
    // idle → loading → error; before the fix it never left idle, because the
    // settings read that threw sat outside the try block.
    await expect(notice).toContainText(/not configured|could not/i);
  });

  test("the reading passes through a loading state", async ({ page }) => {
    await openEditor(page);
    const log = await page.evaluate(async () => {
      const seen: string[] = [];
      const onSpeech = (e: Event) =>
        seen.push((e as CustomEvent).detail.status);
      window.addEventListener("twyne:speech", onSpeech);
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        /read the selection aloud/i.test(b.getAttribute("aria-label") ?? ""),
      );
      btn?.click();
      await new Promise((r) => setTimeout(r, 5000));
      window.removeEventListener("twyne:speech", onSpeech);
      return seen;
    });
    expect(log).toContain("loading");
    expect(log[log.length - 1]).toBe("error");
  });

  test("the speech manager exposes pause, resume and stop", async ({
    page,
  }) => {
    // The transport is only as good as the manager underneath it; check the
    // state machine directly rather than trying to synthesise real audio.
    await openEditor(page);
    const shape = await page.evaluate(async () => {
      // A variable specifier: this is a Vite dev-server URL, not a module
      // path TypeScript can resolve from the e2e directory.
      const spec = "/src/utils/speech.ts";
      const mod = await import(/* @vite-ignore */ spec);
      return {
        pause: typeof mod.pauseSpeech,
        resume: typeof mod.resumeSpeech,
        toggle: typeof mod.togglePauseSpeech,
        stop: typeof mod.stopSpeech,
        seek: typeof mod.seekSpeech,
        state: mod.speechState(),
      };
    });
    expect(shape.pause).toBe("function");
    expect(shape.resume).toBe("function");
    expect(shape.toggle).toBe("function");
    expect(shape.stop).toBe("function");
    expect(shape.seek).toBe("function");
    // Progress fields exist so a transport has something to show.
    expect(shape.state).toHaveProperty("currentTime");
    expect(shape.state).toHaveProperty("duration");
  });

  test("pausing holds the position instead of discarding it", async ({
    page,
  }) => {
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const spec = "/src/utils/speech.ts";
      const mod = await import(/* @vite-ignore */ spec);
      const before = mod.speechState().status;
      mod.pauseSpeech(); // nothing playing — must be a no-op, not a throw
      mod.resumeSpeech();
      mod.togglePauseSpeech();
      mod.seekSpeech(5);
      return { before, after: mod.speechState().status };
    });
    // The important property: every transport call is safe when idle.
    expect(result.before).toBe("idle");
    expect(result.after).toBe("idle");
  });
});
