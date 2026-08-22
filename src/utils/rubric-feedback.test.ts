import { describe, expect, test } from "bun:test";
import {
  rubricGradeStampAsset,
  rubricGradeTier,
  rubricSoundProfile,
} from "./rubric-feedback";

const ALL_GRADES = [
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F",
] as const;

describe("rubric feedback", () => {
  test("maps every letter grade to one visual and audio tier", () => {
    expect(rubricGradeTier("A+")).toBe("a");
    expect(rubricGradeTier("B-")).toBe("b");
    expect(rubricGradeTier("C")).toBe("c");
    expect(rubricGradeTier("D+")).toBe("revise");
    expect(rubricGradeTier("F")).toBe("revise");
  });

  test("gives every exact grade a distinct, restrained completion sound", () => {
    const profiles = ALL_GRADES.map(rubricSoundProfile);
    expect(new Set(profiles.map((profile) => profile.toneHz)).size).toBe(
      ALL_GRADES.length,
    );
    expect(profiles.every((profile) => profile.toneDuration <= 0.17)).toBe(
      true,
    );
    expect(profiles.every((profile) => profile.impactGain < 0.05)).toBe(true);
    expect(rubricSoundProfile("unknown")).toEqual(rubricSoundProfile("F"));
  });

  test("ships the transparent paper overlay and one stamp per grade", async () => {
    const paper = Bun.file("public/assets/rubric-proof-fibers.png");
    expect(await paper.exists()).toBe(true);
    expect(paper.size).toBeGreaterThan(10_000);

    const assets = ALL_GRADES.map(rubricGradeStampAsset);
    expect(new Set(assets).size).toBe(ALL_GRADES.length);
    for (const asset of assets) {
      expect(await Bun.file(`public${asset}`).exists()).toBe(true);
    }
    expect(rubricGradeStampAsset("unknown")).toBe(
      "/assets/rubric-stamps/f.svg",
    );
  });

  test("uses the same live grade stamp in the panel and full report", async () => {
    const [panel, report, stamp, styles] = await Promise.all([
      Bun.file("src/components/rubric/rubric-panel.tsx").text(),
      Bun.file("src/routes/rubric/index.tsx").text(),
      Bun.file("src/components/rubric/grade-stamp.tsx").text(),
      Bun.file("src/global.css").text(),
    ]);
    expect(panel).toContain("<GradeStamp");
    expect(panel).toContain("playRubricPaperCue");
    expect(panel).toContain("playRubricGradeCue");
    expect(panel).not.toContain("RubricSoundToggle");
    expect(panel).not.toContain("soundEnabled");
    expect(panel).not.toContain("twyne:rubric-sound");
    expect(report).toContain("<GradeStamp");
    expect(stamp).toContain("rubricGradeStampAsset");
    expect(stamp).not.toContain("rubric-grade-stamp__grade");
    expect(styles).toContain("/assets/rubric-proof-fibers.png");
    expect(styles).toContain("var(--rubric-stamp-image)");
    expect(styles).toContain(".rubric-grade-stamp--animated");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
