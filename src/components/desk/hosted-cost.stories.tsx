import { component$, useSignal } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import { HostedCost, type HostedCostState } from "./hosted-cost";

const HostedCostPreview = component$<{
  partial?: boolean;
  unavailable?: boolean;
  unverified?: boolean;
}>((props) => {
  const state = useSignal<HostedCostState>(
    props.unavailable ? "error" : "ready",
  );
  const refreshed = useSignal(false);
  return (
    <main
      class="bg-[var(--color-paper)] p-5 text-[var(--color-ink)]"
      style="max-width:60rem"
    >
      <HostedCost
        state={state.value}
        summary={{
          billedMicrousd: refreshed.value ? 18500 : 12000,
          settledRequests: refreshed.value ? 4 : 3,
          unresolvedRequests: refreshed.value ? 0 : 1,
          unverifiedCostRequests: props.unverified ? 2 : 0,
          unverifiedCostMicrousd: props.unverified ? 10000 : 0,
          truncated: props.partial ?? false,
        }}
        onRefresh$={() => {
          refreshed.value = true;
          state.value = "ready";
        }}
      />
      <p class="text-sm">
        Fictional billing evidence. Refresh simulates a newly settled request.
      </p>
    </main>
  );
});
export default {
  title: "Desk/HostedCost",
  component: HostedCostPreview,
} satisfies Meta<typeof HostedCostPreview>;
type Story = StoryObj<typeof HostedCostPreview>;
export const Confirmed: Story = {};
export const Partial: Story = { args: { partial: true } };
export const Unavailable: Story = { args: { unavailable: true } };
export const UnverifiedCosts: Story = { args: { unverified: true } };
