import { component$, useComputed$, useSignal } from "@qwik.dev/core";
import type { ManualGuide } from "./manual-guide-types";

/** A real application view paired with one deliberate action at a time. */
export const ManualWalkthrough = component$<{ id: string; guide: ManualGuide }>(
  ({ id, guide }) => {
    const selected = useSignal(0);
    const step = useComputed$(() => guide.steps[selected.value]);
    if (!guide.steps.length) return null;

    return (
      <figure class="manual-walkthrough" aria-labelledby={`${id}-guide-title`}>
        <figcaption class="manual-walkthrough-heading">
          <p class="manual-plate-label">At the desk · A visual walkthrough</p>
          <h3 id={`${id}-guide-title`}>{guide.title}</h3>
          <p>{guide.summary}</p>
        </figcaption>
        <ol
          class="manual-walkthrough-steps"
          aria-label={`${guide.title}: steps`}
        >
          {guide.steps.map((item, index) => (
            <li key={item.title}>
              <button
                type="button"
                aria-pressed={selected.value === index}
                aria-controls={`${id}-guide-instruction`}
                onClick$={() => (selected.value = index)}
              >
                <span class="manual-step-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.title}
              </button>
            </li>
          ))}
        </ol>
        <div class="manual-walkthrough-image">
          <a
            href={step.value.image}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open full-size view: ${step.value.title}`}
          >
            <img
              src={step.value.image}
              alt={step.value.alt}
              width={step.value.width}
              height={step.value.height}
              loading="eager"
              decoding="async"
            />
            <span class="manual-walkthrough-enlarge" aria-hidden="true">
              Open full-size ↗
            </span>
          </a>
        </div>
        <div
          class="manual-walkthrough-instruction"
          id={`${id}-guide-instruction`}
          aria-live="polite"
          aria-atomic="true"
        >
          <p class="manual-step-position">
            Step {selected.value + 1} of {guide.steps.length}
          </p>
          <h4>{step.value.title}</h4>
          <p>{step.value.instruction}</p>
        </div>
        {guide.note && <p class="manual-walkthrough-note">{guide.note}</p>}
        <details class="manual-written-steps">
          <summary>Read all the steps</summary>
          <ol>
            {guide.steps.map((item) => (
              <li key={item.title}>
                <strong>{item.title}.</strong> {item.instruction}
              </li>
            ))}
          </ol>
        </details>
        <div class="manual-print-steps">
          <ol>
            {guide.steps.map((item) => (
              <li key={item.title}>
                <strong>{item.title}.</strong> {item.instruction}
              </li>
            ))}
          </ol>
        </div>
      </figure>
    );
  },
);
