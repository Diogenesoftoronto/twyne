import type {
  Finding,
  PresenceRow,
  SectionInfo,
} from "../living-desk-contract";
import type { NameGroup } from "./naming";
import { finding } from "./segment";

export function analyzePresence(
  groups: NameGroup[],
  sections: SectionInfo[],
): { rows: PresenceRow[]; findings: Finding[] } {
  const entities = groups.filter((g) => g.mentions.length >= 2);
  const rows = entities.map((g) => ({
    entity: g.canonical,
    variants: g.variants,
    counts: sections.map(
      (s) => g.mentions.filter((o) => o.section === s.index).length,
    ),
  }));
  const findings: Finding[] = [];
  if (sections.length >= 3)
    entities.forEach((g, i) => {
      const counts = rows[i].counts;
      const present = counts.flatMap((n, index) => (n ? [index] : []));
      const gaps = present
        .slice(1)
        .flatMap((section, j) =>
          section > present[j] + 1
            ? [{ before: present[j], after: section }]
            : [],
        );
      if (!gaps.length) return;
      const missing = gaps.flatMap((gap) =>
        sections.slice(gap.before + 1, gap.after),
      );
      const title = missing
        .map((s) => (s.title.length <= 24 ? s.title : `§${s.index + 1}`))
        .join(", ");
      const occurrences = gaps
        .flatMap((gap) => [
          g.mentions.filter((o) => o.section === gap.before).at(-1)!,
          g.mentions.find((o) => o.section === gap.after)!,
        ])
        .map((o) => ({
          ...o,
          id: `presence:${g.canonical}:${o.from}`,
          fix: undefined,
          flagged: false,
          label: g.canonical,
        }));
      findings.push({
        ...finding(
          `presence:${g.canonical.toLowerCase()}`,
          "presence",
          `${g.canonical} drops out of ${title}`,
          `${missing.length} section${missing.length === 1 ? "" : "s"} between appearances`,
          occurrences,
        ),
        level: "section",
        criterion: "structure",
        impact: null,
        state: "open",
        actions: ["jump"],
      });
    });
  return { rows, findings };
}
