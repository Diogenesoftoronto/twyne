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
        <div class="folio p-4 pt-5">
          <p class="dept-label">The Dossier</p>
          <p
            class="mt-2 text-base text-[var(--color-ink)]"
            style="font-family: var(--font-display); font-weight: 600;"
          >
            No dossier filed.
          </p>
          <p
            class="mt-1.5 text-[13px] leading-6 text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif); font-style: italic;"
          >
            Sit for the interview to seed the draft with context. The room
            cannot read what hasn't been briefed.
          </p>
          <button onClick$={onStartInterview$} class="btn-press mt-4">
            Open the dossier
          </button>
        </div>
      );
    }

    const { answers } = brief;

    return (
      <div class="index-card p-4 pt-9 relative">
        {/* Filed stamp — top right corner */}
        <div class="absolute top-2 right-2">
          <span class="stamp">Filed</span>
        </div>

        <p class="dept-label">The Dossier</p>
        <h3
          class="mt-1 text-base leading-tight text-[var(--color-ink)]"
          style="font-family: var(--font-display); font-weight: 700;"
        >
          {answers.workingTitle}
        </h3>

        <dl class="mt-4 space-y-3">
          <BriefRow label="Format" value={answers.format} />
          <BriefRow label="Audience" value={answers.audience} />
          <BriefRow label="Goal" value={answers.goal} />
          <BriefRow label="Tone" value={answers.tone} />
        </dl>

        <p
          class="mt-4 pt-3 border-t border-dashed border-[var(--color-paper-3)] text-[11px] leading-5 text-[var(--color-ink-muted)]"
          style="font-family: var(--font-serif); font-style: italic;"
        >
          <span class="not-italic dept-label">Non-negotiables · </span>
          {answers.constraints}
        </p>

        <button
          onClick$={onStartInterview$}
          class="btn-paper mt-3 w-full"
          title="Reopen the interview"
        >
          ↻ Refine the dossier
        </button>
      </div>
    );
  },
);

function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt class="dept-label">{label}</dt>
      <dd
        class="mt-0.5 text-[13px] leading-6 text-[var(--color-ink-light)]"
        style="font-family: var(--font-serif);"
      >
        {value}
      </dd>
    </div>
  );
}
