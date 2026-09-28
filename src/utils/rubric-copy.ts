/**
 * The rubric's words, in one place.
 *
 * Written for a writer mid-draft: the verdict first, one number only when it
 * helps, then what to do. No statistics vocabulary — "standard deviation" and
 * "type-token ratio" are how the score is computed, not how to fix a draft.
 */

/** One word for a mark, so a row reads before its number does. */
export function scoreWord(score: number, max: number): string {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.8) return "strong";
  if (pct >= 0.6) return "solid";
  if (pct >= 0.4) return "uneven";
  return "weak";
}

/** The overall verdict, in a few words. */
export function gradeVerdict(score: number): string {
  if (score >= 80) return "A strong draft.";
  if (score >= 65) return "Getting there.";
  if (score >= 50) return "A working draft with clear gaps.";
  return "Early days — the next pass matters most.";
}

/** One concrete change for a criterion that scored low. */
export function nextMoveFor(id: string): string {
  const moves: Record<string, string> = {
    targetFit:
      "Reread who the brief is for and what it should do. Find the section that serves neither, then cut it or point it back.",
    thesis:
      "Say your main point in one sentence near the top. Then check that each section supports it.",
    evidence:
      "Pick your two shakiest claims and back each one with a source, an example or a number.",
    sufficiency:
      "Find the point you move past fastest and give it one more paragraph: an example, a consequence, or an objection answered.",
    integrity:
      "Swap claims about “always” and “everyone” for ones you can show. Cut the filler words.",
    structure:
      "Where the argument changes direction, add a break or a linking sentence. Cut a paragraph that repeats one before it.",
    pacing:
      "Break one long sentence into two or three, and join two short ones.",
    voice:
      "Rewrite your first line in the tone you want, and let it set the pitch for the rest.",
    vocabulary:
      "Swap three abstract words for concrete ones, and cut one piece of jargon per paragraph.",
    paragraph:
      "Split any paragraph longer than about six sentences, so each one does a single job.",
    engagement:
      "Give the reader a reason to keep going in the first 100 words: a stake, or a question.",
  };
  return (
    moves[id] ??
    "Make the one change that would lift this score most, then reread."
  );
}

const pct = (ratio: number) => Math.round(ratio * 100);

/** Plain feedback for the measured criteria. Each: verdict, detail, move. */
export const shapeFeedback = {
  structure(paragraphs: number, sentences: number, score: number): string {
    const count = `${paragraphs} paragraph${paragraphs === 1 ? "" : "s"}, ${sentences} sentence${sentences === 1 ? "" : "s"}.`;
    return score < 4
      ? `${count} That's too few parts to feel like a beginning, a turn and an ending.`
      : `${count} Enough parts to carry a beginning, a turn and an ending.`;
  },
  pacing(average: number, spread: number): string {
    const avg = `Your sentences average ${Math.round(average)} words`;
    if (spread < 5)
      return `${avg}, and most are about the same length. Mixing in some shorter ones will give the reader a beat.`;
    if (spread > 12)
      return `${avg}, but they swing from very short to very long. Even out the extremes.`;
    if (average > 24)
      return `${avg} — on the long side. Most readers are comfortable around 12 to 22.`;
    return `${avg}, with a healthy mix of lengths.`;
  },
  vocabulary(distinctRatio: number): string {
    const share = `About ${pct(distinctRatio)}% of your words are different words.`;
    if (distinctRatio < 0.35)
      return `${share} That's a lot of repetition — look for the words you lean on.`;
    if (distinctRatio > 0.6)
      return `${share} Very varied; check it still reads plainly.`;
    return `${share} A healthy range.`;
  },
  paragraphs(count: number, shortRatio: number, longRatio: number): string {
    const short = Math.round(shortRatio * count);
    const long = Math.round(longRatio * count);
    const mix = `${short} short and ${long} long, out of ${count} paragraph${count === 1 ? "" : "s"}.`;
    if (shortRatio > 0.5 && count >= 4)
      return `${mix} It reads in fragments; join the ones that share a point.`;
    if (longRatio > 0.3)
      return `${mix} Split the long ones where the subject changes.`;
    return `${mix} A comfortable mix.`;
  },
  /** Appended when relevance holds a measured score down. */
  capped(ceiling: number, fit: number): string {
    return `This score is held at ${ceiling}/10 or below because the draft is off brief (${fit}/10). Tidy sentences can't make up for writing about the wrong thing.`;
  },
  evidence(count: number, perThousand: number): string {
    return `${count} reference${count === 1 ? "" : "s"} found (${perThousand.toFixed(1)} per 1,000 words). This counts citations; it can't tell whether they hold up.`;
  },
  integrity(
    sweeping: number,
    filler: number,
    vague: number,
    repeated: number,
  ): string {
    return `${sweeping} sweeping claim${sweeping === 1 ? "" : "s"} with nothing behind ${sweeping === 1 ? "it" : "them"}, ${pct(filler)}% filler words, ${pct(vague)}% vague words, ${pct(repeated)}% repeated paragraphs. This is a word-pattern check, so it can miss subtle padding or flag deliberate emphasis.`;
  },
  unjudgedFit:
    "Not checked this time, so nothing is held down. Connect an AI provider in Settings to check the draft against the brief.",
  unreachableEditor:
    "This editor couldn't be reached, so this 5/10 is a placeholder, not a reading.",
};
