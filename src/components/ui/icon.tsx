import { component$ } from "@builder.io/qwik";
import {
  renderTwyneIconSvg,
  type TwyneIconName,
  type TwyneIconOptions,
} from "../../utils/icon-system";

interface IconProps extends TwyneIconOptions {
  name: TwyneIconName;
}

/** The only product-facing entry point for Reicon SVGs. */
export const Icon = component$<IconProps>((props) => (
  <span
    class="inline-flex shrink-0 items-center justify-center leading-none [&>svg]:block"
    dangerouslySetInnerHTML={renderTwyneIconSvg(props.name, props)}
  />
));
