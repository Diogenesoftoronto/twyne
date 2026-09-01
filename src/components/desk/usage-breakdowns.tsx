import { component$ } from "@qwik.dev/core";
import type {
  FeatureBreakdownEntry,
  ProviderBreakdownEntry,
} from "../../utils/usage-summary";
import { ChartTable } from "./chart-table";

export const UsageBreakdowns = component$<{
  kind: "features" | "models";
  features: FeatureBreakdownEntry[];
  providers: ProviderBreakdownEntry[];
}>((props) => {
  const rows =
    props.kind === "features"
      ? props.features.map((row) => ({
          key: row.feature,
          label: row.feature,
          actions: row.logicalActions,
          generations: row.generations,
          cost: row.actualCostMicrousd + row.estimatedCostMicrousd,
        }))
      : props.providers.flatMap((provider) =>
          provider.models.map((model) => ({
            key: `${provider.provider}:${model.model}`,
            label: `${provider.provider} / ${model.model}`,
            actions: model.logicalActions,
            generations: model.generations,
            cost: model.actualCostMicrousd + model.estimatedCostMicrousd,
          })),
        );
  if (!rows.length)
    return (
      <p class="py-6 text-sm text-[var(--color-ink-muted)]">
        No {props.kind === "features" ? "feature" : "provider or model"}{" "}
        evidence is available for this range.
      </p>
    );
  const maximum = Math.max(1, ...rows.map((row) => row.generations));
  return (
    <div>
      <ol class="divide-y divide-dotted divide-[var(--color-ink-muted)]">
        {rows.map((row) => (
          <li
            key={row.key}
            class="grid grid-cols-[minmax(8rem,1fr)_3fr_auto] items-center gap-3 py-3"
          >
            <span class="truncate text-sm font-medium">{row.label}</span>
            <span class="h-2 bg-[var(--color-paper-3)]">
              <i
                class="block h-full bg-[var(--color-cobalt)]"
                style={{ width: `${(row.generations / maximum) * 100}%` }}
              />
            </span>
            <span class="text-xs tabular-nums text-[var(--color-ink-muted)]">
              {row.generations}
            </span>
          </li>
        ))}
      </ol>
      <ChartTable
        caption={`${props.kind} usage breakdown`}
        columns={[
          {
            key: "name",
            label: props.kind === "features" ? "Feature" : "Provider / model",
          },
          { key: "actions", label: "Actions" },
          { key: "generations", label: "Generations" },
          { key: "cost", label: "Known cost" },
        ]}
        rows={rows.map((row) => ({
          key: row.key,
          cells: {
            name: row.label,
            actions: row.actions,
            generations: row.generations,
            cost: `$${(row.cost / 1_000_000).toFixed(4)}`,
          },
        }))}
      />
    </div>
  );
});
