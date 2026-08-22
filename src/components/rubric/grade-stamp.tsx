import { component$ } from "@builder.io/qwik";
import {
  rubricGradeStampAsset,
  rubricGradeTier,
} from "../../utils/rubric-feedback";

interface GradeStampProps {
  grade: string;
  score: number;
  color: string;
  size?: "compact" | "report";
  animated?: boolean;
}

/** A complete grade-specific impression, recolored by the active theme. */
export const GradeStamp = component$<GradeStampProps>((props) => {
  const tier = rubricGradeTier(props.grade);
  const asset = rubricGradeStampAsset(props.grade);
  return (
    <div
      class={[
        "rubric-grade-stamp",
        `rubric-grade-stamp--${props.size ?? "compact"}`,
        `rubric-grade-stamp--${tier}`,
        { "rubric-grade-stamp--animated": props.animated },
      ]}
      style={{
        color: props.color,
        "--rubric-stamp-image": `url("${asset}")`,
      }}
      role="img"
      aria-label={`Overall grade ${props.grade}, ${props.score} of 100`}
    />
  );
});
