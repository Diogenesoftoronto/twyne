import type { StorybookConfig } from "storybook-framework-qwik";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "storybook-framework-qwik",
  core: {
    // Don't phone home with anonymous usage telemetry.
    disableTelemetry: true,
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    // Qwik 2 validates Vite's base strictly. Storybook supplies `./` for a
    // portable static build, but its preview is served from the site root.
    base: "/",
  }),
};

export default config;
