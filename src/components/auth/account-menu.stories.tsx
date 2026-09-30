import { component$, useContextProvider, useSignal } from "@qwik.dev/core";
import { QwikRouterMockProvider } from "@qwik.dev/router";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { AuthContext, type AuthState } from "../../utils/auth-context";
import { ConvexProvider } from "../../utils/convex-context";
import { AccountMenu } from "./account-menu";

const PICTURE = "/assets/avatars/engraved-2026-09/owl.webp";

/** Synthetic account only: no cookies, credentials, or backend calls. */
const AccountMenuPreview = component$<{ picture?: string }>(({ picture }) => {
  const auth = useSignal<AuthState>({
    loading: false,
    provider: "convex",
    convexAuthenticated: true,
    user: {
      id: "synthetic-morgan-vale",
      email: "morgan.private@example.test",
      name: "Morgan Vale",
      image: picture,
    },
  });
  useContextProvider(AuthContext, auth);
  return (
    <QwikRouterMockProvider url="http://localhost/editor/">
      <ConvexProvider>
        <div
          class="paper-sheet p-8"
          style="width: min(32rem, 100%); min-height: 28rem;"
        >
          <div class="flex justify-end">
            <AccountMenu />
          </div>
          <div class="mt-80 flex flex-wrap gap-3">
            <button
              type="button"
              class="btn-paper"
              onClick$={() => {
                auth.value = {
                  ...auth.value,
                  user: { ...auth.value.user!, image: PICTURE },
                };
              }}
            >
              Show picture
            </button>
            <button
              type="button"
              class="btn-paper"
              onClick$={() => {
                auth.value = {
                  ...auth.value,
                  user: { ...auth.value.user!, image: undefined },
                };
              }}
            >
              Remove picture
            </button>
            <button
              type="button"
              class="btn-paper"
              onClick$={() => {
                auth.value = {
                  ...auth.value,
                  user: {
                    ...auth.value.user!,
                    image: "/missing-synthetic-avatar.webp",
                  },
                };
              }}
            >
              Use unavailable picture
            </button>
            <button
              type="button"
              class="btn-paper"
              onClick$={() => {
                auth.value = {
                  ...auth.value,
                  user: { ...auth.value.user!, name: "M. Vale" },
                };
              }}
            >
              Change name
            </button>
          </div>
        </div>
      </ConvexProvider>
    </QwikRouterMockProvider>
  );
});

export default {
  title: "Auth/AccountMenu",
  component: AccountMenuPreview,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AccountMenuPreview>;

type Story = StoryObj<typeof AccountMenuPreview>;
export const SignedIn: Story = { args: { picture: PICTURE } };
export const WithoutPicture: Story = {};
export const UnavailablePicture: Story = {
  args: { picture: "/missing-synthetic-avatar.webp" },
};
