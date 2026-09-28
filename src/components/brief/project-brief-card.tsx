import { component$, useSignal, type PropFunction } from "@qwik.dev/core";
import type { ProjectBrief } from "../../types";
import { isAnswered, probeSummaryLine } from "../../utils/dossier-probes";
import type { BriefEdition } from "../../utils/brief-history";

interface ProjectBriefCardProps {
  brief: ProjectBrief | null;
  editions?: BriefEdition[];
  onStartInterview$: PropFunction<() => void>;
}

export const ProjectBriefCard = component$(
  ({ brief, editions = [], onStartInterview$ }: ProjectBriefCardProps) => {
    const selectedEditionId = useSignal<string | null>(null);
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

    const selectedEdition = editions.find(
      (edition) => edition.id === selectedEditionId.value,
    );
    const displayedBrief = selectedEdition?.brief ?? brief;
    const { answers } = displayedBrief;
    const answeredProbes = (displayedBrief.probes ?? []).filter(isAnswered);
    const title = answers.workingTitle.trim() || "Untitled dossier";

    return (
      <article
        key={`${brief.updatedAt}-${selectedEdition?.id ?? "current"}`}
        class="filed-dossier-paper relative p-4 pt-10"
        aria-label={`${selectedEdition ? "Earlier edition" : "Filed dossier"}: ${title}`}
      >
        <div class="filed-dossier-paper__tab" aria-hidden="true">
          {selectedEdition ? "Earlier edition" : "Dossier"}
        </div>
        <div class="absolute top-2 right-3">
          <span class="stamp">{selectedEdition ? "Edition" : "Filed"}</span>
        </div>

        <p class="dept-label">
          {selectedEdition ? "Earlier filed copy" : "Current filed copy"}
        </p>
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
          {selectedEdition ? "Saved" : "Refiled"}{" "}
          {formatFiledAt(selectedEdition?.savedAt ?? brief.updatedAt)}
        </p>

        {editions.length > 0 && (
          <details class="mt-3 border-y border-[var(--color-paper-3)] py-2">
            <summary class="cursor-pointer text-[10px] tracking-[0.12em] text-[var(--color-ink-muted)]">
              Earlier editions · {editions.length}
            </summary>
            <p class="mt-1 text-[10px] text-[var(--color-ink-muted)]">
              Saved on this device.
            </p>
            <div class="mt-2 grid gap-1.5">
              <button
                type="button"
                class={`w-full border px-2 py-1.5 text-left text-[11px] ${
                  selectedEdition
                    ? "border-[var(--color-paper-3)]"
                    : "field-live"
                }`}
                aria-pressed={!selectedEdition}
                onClick$={() => (selectedEditionId.value = null)}
              >
                Current filed copy
              </button>
              {editions.map((edition) => (
                <button
                  key={edition.id}
                  type="button"
                  class={`w-full border px-2 py-1.5 text-left text-[11px] ${
                    selectedEdition?.id === edition.id
                      ? "field-live"
                      : "border-[var(--color-paper-3)]"
                  }`}
                  aria-pressed={selectedEdition?.id === edition.id}
                  onClick$={() => (selectedEditionId.value = edition.id)}
                >
                  <span class="block truncate text-[var(--color-ink)]">
                    {edition.brief.answers.workingTitle.trim() ||
                      "Untitled dossier"}
                  </span>
                  <span class="text-[10px] text-[var(--color-ink-muted)]">
                    {formatFiledAt(edition.savedAt)}
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}

        <dl class="mt-4 space-y-3">
          <BriefRow label="Format" value={answers.format} />
          <BriefRow label="Audience" value={answers.audience} />
          <BriefRow label="Goal" value={answers.goal} />
          <BriefRow label="Tone" value={answers.tone} />
          <BriefRow label="Non-negotiables" value={answers.constraints} />
          <BriefRow label="Success signal" value={answers.successSignal} />
        </dl>

        {(displayedBrief.probes?.length ?? 0) > 0 && (
          <section class="mt-4 border-t border-[var(--color-paper-3)] pt-3">
            <p class="dept-label">Particulars</p>
            <ol class="mt-2 space-y-2">
              {displayedBrief.probes?.map((probe, index) => (
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
            {displayedBrief.attachments.length} references
          </span>
        </div>

        <button
          onClick$={onStartInterview$}
          class="btn-paper mt-3 w-full"
          title={
            selectedEdition
              ? "Refine the current brief"
              : "Open the current filed dossier"
          }
        >
          {selectedEdition ? "Refine current brief" : "Open filed dossier"}
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
