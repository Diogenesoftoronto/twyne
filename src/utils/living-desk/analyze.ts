import { analyzeStance, type StanceCache } from "./stance";
import { analyzeNaming } from "./naming";
import { analyzeStyle } from "./style-sheet";
import { analyzePresence } from "./presence";
import type { Segments } from "./segment";

export function analyzeDesk(segments: Segments, cache?: StanceCache) {
  const stance = analyzeStance(segments.blocks, cache);
  const naming = analyzeNaming(segments.blocks);
  const presence = analyzePresence(naming.groups, segments.sections);
  return {
    findings: [
      ...(stance.finding ? [stance.finding] : []),
      ...naming.findings,
      ...analyzeStyle(segments.blocks),
      ...presence.findings,
    ],
    presence: presence.rows,
    stance,
  };
}
