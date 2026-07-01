import type { StorybookConfig } from "storybook-framework-qwik";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "storybook-framework-qwik",
  core: {
    // Don't phone home with anonymous usage telemetry.
    disableTelemetry: true,
  },
};

export default config;
