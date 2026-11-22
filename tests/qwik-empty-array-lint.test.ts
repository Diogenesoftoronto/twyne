import { expect, test } from "bun:test";
import { ESLint } from "eslint";

test("Twyne's config detects the persona-note pattern and accepts its guard", async () => {
  const eslint = new ESLint();
  const filePath = "src/components/personas/personas-panel.tsx";
  const ruleId = "qwik-guards/no-empty-array-before-sibling";
  // Use the real component's configuration without requiring its live source
  // to retain the bug once the application workaround is implemented.
  const [unsafe] = await eslint.lintText(
    "export const fixture = <div>{personas.filter(isStreaming).map(renderCard)}<dialog key='note-sheet'><textarea /></dialog></div>",
    { filePath },
  );
  expect(unsafe.fatalErrorCount).toBe(0);
  const warning = unsafe.messages.find((message) => message.ruleId === ruleId);
  expect(warning?.severity).toBe(1);
  expect(warning?.message).toContain(
    "losing input focus even with stable keys",
  );
  const [safe] = await eslint.lintText(
    "const cards = personas.filter(isStreaming).map(renderCard); export const fixture = <div>{cards.length ? cards : null}<dialog key='note-sheet'><textarea /></dialog></div>",
    { filePath },
  );
  expect(safe.fatalErrorCount).toBe(0);
  expect(safe.messages.filter((message) => message.ruleId === ruleId)).toEqual(
    [],
  );
});

test("Twyne's typed config catches the former dossier wrapper and accepts stable boundaries", async () => {
  const eslint = new ESLint();
  const filePath = "src/components/onboarding/anti-tabula-rasa.tsx";
  const ruleId = "qwik-guards/no-plain-jsx-form-wrapper";
  const [unsafe] = await eslint.lintText(
    'import { DossierFolio } from "./dossier-folio"; export const fixture = <DossierFolio surface="form" leaf={<input />} chrome={null} dossier={null} />;',
    { filePath },
  );
  expect(unsafe.fatalErrorCount).toBe(0);
  expect(
    unsafe.messages.filter((message) => message.ruleId === ruleId),
  ).toHaveLength(1);

  for (const code of [
    'import { DossierFolio } from "./dossier-folio"; export const fixture = DossierFolio({ surface: "form", leaf: <input />, chrome: null, dossier: null });',
    'import { component$ } from "@qwik.dev/core"; const Stable = component$((props: { leaf: any }) => <main>{props.leaf}</main>); export const fixture = <Stable leaf={<textarea />} />;',
  ]) {
    const [safe] = await eslint.lintText(code, { filePath });
    expect(safe.fatalErrorCount).toBe(0);
    expect(
      safe.messages.filter((message) => message.ruleId === ruleId),
    ).toEqual([]);
  }
});
