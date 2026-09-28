import { component$ } from "@qwik.dev/core";
import { StampShader } from "./stamp-shader";
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
  const highest = props.grade.trim().toUpperCase() === "A+";
  return (
    <div
      class={[
        "rubric-grade-stamp",
        `rubric-grade-stamp--${props.size ?? "compact"}`,
        `rubric-grade-stamp--${tier}`,
        { "rubric-grade-stamp--highest": highest },
        { "rubric-grade-stamp--animated": props.animated },
      ]}
      style={{
        color: props.color,
        "--rubric-stamp-image": `url("${asset}")`,
      }}
      role="img"
      aria-label={`Overall grade ${props.grade}, ${props.score} of 100`}
    >
      {props.animated && (tier === "a" || tier === "b") && (
        <StampShader
          key={props.grade}
          strength={highest ? 3 : tier === "a" ? 2 : 1}
        />
      )}
    </div>
  );
});
