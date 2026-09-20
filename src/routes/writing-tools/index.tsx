import { component$ } from "@qwik.dev/core";
import type { DocumentHead } from "@qwik.dev/router";
import { WritingTools } from "../../components/writing-tools/writing-tools";

export default component$(() => <WritingTools />);
export const head: DocumentHead = { title: "Writing tools — Twyne" };
