import { component$, useStyles$ } from "@qwik.dev/core";
import styles from "./editor-loading-screen.css?inline";

/** Rendered with the route HTML, before local folios have been restored. */
export const EditorLoadingScreen = component$(() => {
  useStyles$(styles);

  return (
    <main class="editor-loading" aria-label="Editor loading">
      <header class="editor-loading__masthead" aria-hidden="true">
        <span class="editor-loading__wordmark">
          Twyne<span>.</span>
        </span>
        <span class="editor-loading__department">The writer’s room</span>
      </header>

      <div class="editor-loading__desk">
        <div class="editor-loading__page">
          <div class="editor-loading__page-head" aria-hidden="true">
            <span>Manuscript</span>
            <span class="editor-loading__registration">+</span>
          </div>

          <div class="editor-loading__status" role="status" aria-live="polite">
            <h1>
              Opening your manuscript<span aria-hidden="true">…</span>
            </h1>
            <p>Getting your writing desk ready.</p>
          </div>

          <div class="editor-loading__proof" aria-hidden="true">
            <span class="editor-loading__line editor-loading__line--title" />
            <div class="editor-loading__paragraph">
              <span class="editor-loading__line" />
              <span class="editor-loading__line" />
              <span class="editor-loading__line" />
              <span class="editor-loading__line editor-loading__line--short" />
            </div>
            <div class="editor-loading__paragraph">
              <span class="editor-loading__line" />
              <span class="editor-loading__line" />
              <span class="editor-loading__line editor-loading__line--medium" />
            </div>
            <span class="editor-loading__caret" />
          </div>

          <div class="editor-loading__page-foot" aria-hidden="true">
            <span class="editor-loading__activity">
              <span />
            </span>
            <span>Setting the type</span>
          </div>
        </div>
      </div>
    </main>
  );
});
