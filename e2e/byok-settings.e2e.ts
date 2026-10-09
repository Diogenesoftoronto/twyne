import { expect, test, type Page } from "@playwright/test";

const storageKey = "twyne.ai-settings.current";
const savedProvider = {
  id: "byok-regression-provider",
  name: "Regression provider",
  type: "openai",
  apiKey: "test-key-never-sent",
  defaultModel: "test-model",
  availableModels: ["test-model"],
};

async function seedByok(page: Page) {
  await page.route("**/__byok-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>BYOK seed</title>",
    }),
  );
  await page.goto("/__byok-seed");
  await page.evaluate(
    async ({ storageKey, provider }) => {
      localStorage.clear();
      const path = "/src/utils/idb.ts";
      const { saveAiSettingsToIdb } = await import(/* @vite-ignore */ path);
      await saveAiSettingsToIdb({
        advancedMode: true,
        providers: [provider],
        defaultProviderId: provider.id,
        perFeature: {
          "persona-feedback": {
            providerId: provider.id,
            model: provider.defaultModel,
          },
        },
        showProviderTags: true,
      });
      if (!localStorage.getItem(storageKey))
        throw new Error("Fixture did not persist");
    },
    { storageKey, provider: savedProvider },
  );
}

async function blockSettingsWrites(page: Page) {
  await page.evaluate((storageKey) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === storageKey)
        throw new DOMException("Test quota failure", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (
        mode === "readwrite" &&
        (stores === "ai-settings" || Array.from(stores).includes("ai-settings"))
      ) {
        throw new DOMException("Test IDB failure", "InvalidStateError");
      }
      return transaction.call(this, stores, mode, options);
    };
  }, storageKey);
}

test("BYOK off persists across reload even while the model catalog is delayed", async ({
  page,
}) => {
  await seedByok(page);
  let releaseCatalog!: () => void;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route("https://models.dev/api.json", async (route) => {
    await catalogGate;
    await route.fulfill({
      json: {
        openai: {
          id: "openai",
          name: "OpenAI",
          npm: "@ai-sdk/openai",
          env: ["OPENAI_API_KEY"],
          models: {
            "catalog-model": { id: "catalog-model", name: "Catalog model" },
          },
        },
      },
    });
  });
  await page.goto("/settings/");
  const toggle = page.getByRole("button", {
    name: "Bring your own key",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
  const catalogResponse = page.waitForResponse("https://models.dev/api.json");
  releaseCatalog();
  await catalogResponse;
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const persisted = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(persisted.advancedMode).toBe(false);
  expect(persisted.providers).toContainEqual(savedProvider);
  expect(persisted.defaultProviderId).toBe(savedProvider.id);
  expect(persisted.perFeature["persona-feedback"].providerId).toBe(
    savedProvider.id,
  );
  // Resolve language features without contacting an AI provider. Null selects
  // their existing hosted fallback despite the preserved BYOK configuration.
  expect(
    await page.evaluate(async () => {
      const idbPath = "/src/utils/idb.ts";
      const aiPath = "/src/utils/ai-client.ts";
      const { loadAiSettingsFromIdb } = await import(
        /* @vite-ignore */ idbPath
      );
      const { normalizeAiSettings, resolveFeatureConfig } = await import(
        /* @vite-ignore */ aiPath
      );
      const settings = normalizeAiSettings(await loadAiSettingsFromIdb());
      return ["persona-feedback", "interview-turn", "rubric-judge"].map(
        (feature) => resolveFeatureConfig(settings, feature),
      );
    }),
  ).toEqual([null, null, null]);
});

test("failed BYOK save restores the toggle and shows an error", async ({
  page,
}) => {
  await seedByok(page);
  await page.route("https://models.dev/api.json", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto("/settings/");
  const toggle = page.getByRole("button", {
    name: "Bring your own key",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await blockSettingsWrites(page);
  await toggle.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be saved" }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toBeEnabled();
  await expect(page.getByText("Settings saved", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).advancedMode,
      storageKey,
    ),
  ).toBe(true);
});

test("onboarding reports a failed BYOK save and allows retry", async ({
  page,
}) => {
  await seedByok(page);
  await page.goto("/onboarding/");
  await page.getByRole("button", { name: "Just check things out" }).click();
  const toggle = page.getByRole("switch", { name: "Bring your own key" });
  await expect(toggle).toBeChecked();
  await blockSettingsWrites(page);
  await toggle.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be saved" }),
  ).toBeVisible();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
});
