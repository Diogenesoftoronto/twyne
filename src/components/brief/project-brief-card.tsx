import { component$, type PropFunction } from "@builder.io/qwik";
import type { ProjectBrief } from "../../types";
import { isAnswered, probeSummaryLine } from "../../utils/dossier-probes";

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
    const answeredProbes = (brief.probes ?? []).filter(isAnswered);
    const title = answers.workingTitle.trim() || "Untitled dossier";

    return (
      <article
        key={brief.updatedAt}
        class="filed-dossier-paper relative p-4 pt-10"
        aria-label={`Filed dossier: ${title}`}
      >
        <div class="filed-dossier-paper__tab" aria-hidden="true">
          Dossier
        </div>
        <div class="absolute top-2 right-3">
          <span class="stamp">Filed</span>
        </div>

        <p class="dept-label">Current filed copy</p>
        <h3
          id="filed-dossier-title"
          class="mt-1 text-base leading-tight text-[var(--color-ink)]"
          style="font-family: var(--font-display); font-weight: 700;"
        >
          {title}
        </h3>
        <p
          class="mt-1 text-[10px] leading-4 text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          Refiled {formatFiledAt(brief.updatedAt)}
        </p>

        <dl class="mt-4 space-y-3">
          <BriefRow label="Format" value={answers.format} />
          <BriefRow label="Audience" value={answers.audience} />
          <BriefRow label="Goal" value={answers.goal} />
          <BriefRow label="Tone" value={answers.tone} />
          <BriefRow label="Non-negotiables" value={answers.constraints} />
          <BriefRow label="Success signal" value={answers.successSignal} />
        </dl>

        {(brief.probes?.length ?? 0) > 0 && (
          <section class="mt-4 border-t border-[var(--color-paper-3)] pt-3">
            <p class="dept-label">Particulars</p>
            <ol class="mt-2 space-y-2">
              {brief.probes?.map((probe, index) => (
                <li
                  key={probe.id}
                  class="text-[11px] leading-5 text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                >
                  <span
                    class="mr-1 text-[var(--color-vermilion)]"
                    style="font-family: var(--font-typewriter);"
                  >
                    {index + 1}.
                  </span>
                  {isAnswered(probe)
                    ? probeSummaryLine(probe)
                    : `${probe.prompt} · Awaiting an answer`}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div class="mt-4 flex items-center justify-between gap-3 border-t border-[var(--color-paper-3)] pt-3 text-[11px] text-[var(--color-ink-muted)]">
          <span style="font-family: var(--font-typewriter);">
            {answeredProbes.length} particulars answered
          </span>
          <span style="font-family: var(--font-typewriter);">
            {brief.attachments.length} references
          </span>
        </div>

        <button
          onClick$={onStartInterview$}
          class="btn-paper mt-3 w-full"
          title="Open the current filed dossier"
        >
          Open filed dossier
        </button>
      </article>
    );
  },
);

function formatFiledAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

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
