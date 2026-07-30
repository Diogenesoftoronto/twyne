import { $ } from "@builder.io/qwik";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { createAppError } from "../../utils/application-errors";
import { ApplicationNotice } from "./application-notice";

const meta = {
  title: "UI/ApplicationNotice",
  component: ApplicationNotice,
  args: {
    onRetry$: $(() => {}),
    onRecovery$: $(() => {}),
    onDismiss$: $(() => {}),
  },
} satisfies Meta<typeof ApplicationNotice>;

export default meta;
type Story = StoryObj<typeof ApplicationNotice>;

export const ValidationFailed: Story = {
  args: {
    error: createAppError("VALIDATION_FAILED", {
      referenceId: "err_form_2c17",
      source: "validation",
      validationKey: "email_invalid",
    }),
    variant: "warning",
    recoveryLabel: "Use the form",
  },
};

export const ProviderUnavailable: Story = {
  args: {
    error: createAppError("PROVIDER_ERROR", {
      referenceId: "err_room_4f92",
      source: "provider",
    }),
    recoveryLabel: "Open AI settings",
    recoveryHref: "/settings/",
  },
};

export const ServiceOutage: Story = {
  args: {
    error: createAppError("NETWORK_UNAVAILABLE", {
      referenceId: "err_outage_88b2",
    }),
    variant: "outage",
    title: "Twyne is having trouble connecting",
  },
};

export const SignInRequired: Story = {
  args: {
    error: createAppError("AUTHENTICATION_REQUIRED", {
      referenceId: "err_auth_3821",
    }),
    recoveryLabel: "Sign in",
  },
};

export const UnexpectedWithReference: Story = {
  args: {
    error: createAppError("INTERNAL_ERROR", {
      referenceId: "err_01J5QG8T4H6K2D9",
    }),
  },
};

export const Compact: Story = {
  args: {
    error: createAppError("NETWORK_UNAVAILABLE", {
      referenceId: "err_sync_119a",
    }),
    compact: true,
  },
};
