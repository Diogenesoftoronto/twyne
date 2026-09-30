import { component$ } from "@qwik.dev/core";
import { resolvePageBorder, type LayoutSettings } from "../../types";
import { pageBorderArtwork } from "../../utils/page-ornaments";

/** Page furniture only; never becomes part of the editable manuscript. */
export const PageBorder = component$<{ layout: LayoutSettings }>((props) => {
  const style = resolvePageBorder(props.layout);
  if (style === "none") return null;
  const artwork = pageBorderArtwork(props.layout);
  return (
    <span
      class={["manuscript-border", { "manuscript-border--ornate": !!artwork }]}
      data-border-style={style}
      aria-hidden="true"
      style={artwork ? { borderImageSource: `url("${artwork}")` } : undefined}
    />
  );
});
