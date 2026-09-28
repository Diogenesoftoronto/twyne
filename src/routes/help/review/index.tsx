import { WRITING_LENSES } from "../../../utils/writing-lenses";
import { component$ } from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import { LegalPage } from "../../../components/legal/legal-page";

export default component$(() => (
  <LegalPage
    title="Review guide"
    lead="Grades, passage checks, and second readings."
  >
    <h2>Automatic review</h2>
    <p class="doc-p">
      When review is enabled, saved writing and relevant dossier information are
      sent to the configured AI service after a pause. Use the Automatic review
      switch in the Tools board to pause or resume review. Findings are
      suggestions; Twyne does not rewrite your draft.
    </p>
    <h2>Grades</h2>
    <p class="doc-p">
      The rubric grades your draft against its criteria. Open a criterion to
      read its reasoning, or open “How this was scored” for the calculation
      behind a grade. Grades are estimates to help you revise, not a verdict on
      your writing.
    </p>
    <h2>Writing checks</h2>
    <p class="doc-p">
      Jev runs these checks during automatic review when the required material
      is available, even with the Tools board closed. Open a check to inspect
      its latest reading. Choose different revisions or add a focus when you
      want to steer it, then use “Run this check”. Audience changes and edits to
      saved material persist automatically. The checks report on supplied text;
      they do not rewrite the draft.
    </p>
    {WRITING_LENSES.map((lens) => (
      <section key={lens.id}>
        <h3>{lens.label}</h3>
        <p class="doc-p">{lens.description}</p>
        <p class="doc-p">
          {
            {
              reader:
                "Uses your saved draft and intended reader. Each paragraph is assessed with earlier paragraphs, so a later explanation cannot hide confusion at the point it occurs. A deliberate unanswered question can be useful; missing context can block understanding.",
              revision:
                "Choose an earlier and a later draft. The result compares five qualities separately, so you can see when a clearer edit also loses detail or voice.",
              voice:
                "Choose two drafts and save examples of writing that feels like you. The check uses those examples to assess whether the edit preserved, strengthened, or smoothed away a distinctive quality.",
              promises:
                "Uses your saved draft to pair setups, explicit questions, and promised explanations with possible answers elsewhere in the reviewed text. You can mark an expectation as intentionally left open.",
              scraps:
                "Save passages you might reuse. The check compares them with your draft or an optional target passage and suggests their possible role. It does not insert them or choose an exact insertion point.",
              room: "Requires at least two saved editor notes from Cast. The result compares pairs of notes to distinguish repeated advice, compatible suggestions, and changes that require you to choose between them.",
              circling:
                "Requires at least three draft snapshots and examines up to the latest four. Add an optional passage or question to focus the comparison. It describes changes in the text, not your state of mind.",
              research:
                "Save a claim and its supporting source excerpt. The check flags wording that exceeds or contradicts that excerpt. Optional earlier wording lets it assess how the claim changed. It does not fetch links or establish whether the source is true.",
            }[lens.id]
          }
        </p>
      </section>
    ))}
    <h2>Coverage and availability</h2>
    <p class="doc-p">
      A reading may cover only part of a long draft. The coverage line
      identifies the material checked. Open “Limited reading” for limits or
      incomplete checks. If a reading is unavailable, review your AI settings
      and try refreshing it. A previous reading may no longer match your latest
      draft.
    </p>
    <p class="doc-p">
      <Link href="/settings/">Open AI settings</Link> ·{" "}
      <Link href="/editor/">Return to the desk</Link>
    </p>
  </LegalPage>
));

export const head: DocumentHead = { title: "Review guide · Twyne" };
