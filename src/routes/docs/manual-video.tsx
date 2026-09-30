import { component$, useSignal } from "@qwik.dev/core";

export interface ManualFilm {
  id: string;
  title: string;
  duration: string;
  description: string;
  transcript: string;
  width: number;
  height: number;
  credit: string;
}

/** Optional, contextual films never begin playing while someone is reading. */
export const ManualVideo = component$<{ film: ManualFilm }>(({ film }) => {
  const failed = useSignal(false);
  const source = `/assets/manual/${film.id}.mp4`;
  return (
    <details
      class={`manual-video ${film.height > film.width ? "manual-video-portrait" : ""}`}
      onToggle$={(_, element) => {
        if (!element.open) element.querySelector("video")?.pause();
      }}
    >
      <summary>
        <span class="manual-video-watch">Watch</span>
        <span class="manual-video-name">{film.title}</span>
        <span class="manual-video-duration">{film.duration}</span>
      </summary>
      <figure>
        <figcaption>
          <p>{film.description}</p>
        </figcaption>
        <video
          controls
          playsInline
          preload="none"
          width={film.width}
          height={film.height}
          poster={`/assets/manual/${film.id}.jpg`}
          src={source}
          aria-label={film.title}
          onError$={() => (failed.value = true)}
        >
          <track
            kind="captions"
            src={`/assets/manual/${film.id}.vtt`}
            srclang="en"
            label="English"
            default
          />
          <a href={source}>Download {film.title}</a>
        </video>
        <div class="manual-video-footer">
          <p>{film.credit}</p>
          <a href={source} download>
            {failed.value
              ? "Playback unavailable. Download the video."
              : "Download video"}
          </a>
        </div>
        <details class="manual-video-transcript">
          <summary>Written description</summary>
          <p>{film.transcript}</p>
        </details>
      </figure>
    </details>
  );
});
