import type { Preview } from "storybook-framework-qwik";
import "../src/global.css";
import { THEME_PRESETS } from "../src/utils/theme";

/**
 * Components are styled almost entirely with `var(--color-*)`, so a story
 * that looks right on cream can still be unreadable on another preset. The
 * toolbar switches `data-theme` on `<html>`, the same attribute the app sets,
 * which makes every story a theme test for free.
 */
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Twyne palette",
      defaultValue: "editorial",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        dynamicTitle: true,
        items: THEME_PRESETS.map((preset) => ({
          value: preset.id,
          title: preset.label,
        })),
      },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.setAttribute(
        "data-theme",
        String(context.globals.theme ?? "editorial"),
      );
      return Story();
    },
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
