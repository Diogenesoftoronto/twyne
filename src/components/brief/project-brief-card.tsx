import { component$, type PropFunction } from "@builder.io/qwik";
import type { ProjectBrief } from "../../types";

interface ProjectBriefCardProps {
  brief: ProjectBrief | null;
  onStartInterview$: PropFunction<() => void>;
}

export const ProjectBriefCard = component$(
  ({ brief, onStartInterview$ }: ProjectBriefCardProps) => {
    if (!brief) {
      return (
        <div class="rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface)] p-4">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-ink-muted)]">
            Project brief
          </p>
          <p class="mt-2 text-sm font-medium text-[var(--color-ink)]">
            No brief yet
          </p>
          <p class="mt-1 text-sm leading-6 text-[var(--color-ink-light)]">
            Start the anti-tabula-rasa interview to seed the draft with context.
          </p>
          <button
            onClick$={onStartInterview$}
            class="mt-3 rounded-full bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-brand-dark)]"
          >
            Start interview
          </button>
        </div>
      );
    }

    const { answers } = brief;

    return (
      <div class="rounded-2xl border border-[var(--color-surface-3)] bg-[var(--color-surface)] p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-ink-muted)]">
              Project brief
            </p>
            <h3 class="mt-2 text-base font-semibold text-[var(--color-ink)]">
              {answers.workingTitle}
            </h3>
          </div>
          <button
            onClick$={onStartInterview$}
            class="rounded-full border border-[var(--color-surface-3)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            Refine
          </button>
        </div>

        <dl class="mt-4 space-y-3 text-sm">
          <BriefRow label="Format" value={answers.format} />
          <BriefRow label="Audience" value={answers.audience} />
          <BriefRow label="Goal" value={answers.goal} />
          <BriefRow label="Tone" value={answers.tone} />
        </dl>

        <p class="mt-4 text-xs leading-5 text-[var(--color-ink-muted)]">
          Constraints: {answers.constraints}
        </p>
      </div>
    );
  },
);

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt class="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--color-ink-muted)]">
        {label}
      </dt>
      <dd class="mt-1 text-sm leading-6 text-[var(--color-ink-light)]">
        {value}
      </dd>
    </div>
  );
}
