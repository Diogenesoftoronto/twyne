import { component$, useSignal } from "@qwik.dev/core";
import { useGT } from "gt-qwik";

/** One film, selected by the same locale as the rest of Twyne. */
export const LaunchFilm = component$(() => {
  const language = useGT();
  const failedLanguage = useSignal("");
  const locale = language.locale === "fr" ? "fr" : "en";
  const french = locale === "fr";
  const source = `/assets/launch/the-room-${locale}.mp4`;

  return (
    <figure class="launch-film" lang={locale}>
      <figcaption class="launch-film__caption">
        <div>
          <h2 class="launch-film__title">
            {french ? "Entrez dans l’atelier" : "Step into the room"}
          </h2>
          <p class="launch-film__description">
            {french
              ? "Un dossier, cinq éditeurs et votre prochain texte."
              : "A brief, five editors, and your next draft."}
          </p>
        </div>
        <span class="launch-film__duration">
          {french ? "Le film · 1 min" : "The film · 1 min"}
        </span>
      </figcaption>
      <video
        key={locale}
        class="launch-film__player"
        controls
        playsInline
        preload="none"
        width={1280}
        height={720}
        poster={`/assets/launch/the-room-${locale}.jpg`}
        src={source}
        aria-label={french ? "Twyne : l’atelier éditorial" : "Twyne: The Room"}
        onError$={() => (failedLanguage.value = locale)}
      >
        <track
          kind="captions"
          src={`/assets/launch/the-room-${locale}.vtt`}
          srclang={locale}
          label={french ? "Français" : "English"}
        />
        <a href={source}>
          {french ? "Télécharger le film" : "Download the film"}
        </a>
      </video>
      <div class="launch-film__footnote">
        <p>
          {french
            ? "Version française. Voix de synthèse."
            : "English edition. AI narration."}
        </p>
        <a href={source} download>
          {failedLanguage.value === locale
            ? french
              ? "Lecture indisponible. Télécharger le film."
              : "Playback unavailable. Download the film."
            : french
              ? "Télécharger le film"
              : "Download the film"}
        </a>
      </div>
    </figure>
  );
});
