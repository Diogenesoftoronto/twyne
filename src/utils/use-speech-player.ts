import { $, useStore, useVisibleTask$, type QRL } from "@qwik.dev/core";
import {
  currentSpeechVoiceMenu,
  nextSpeech,
  previousSpeech,
  restartSpeechWithVoice,
  retrySpeech,
  seekSpeech,
  speechState,
  stopSpeech,
  togglePauseSpeech,
  type SpeechState,
  type SpeechVoiceMenu,
} from "./speech";

export interface SpeechPlayerHook {
  state: SpeechState;
  voiceMenu: SpeechVoiceMenu;
  toggle$: QRL<() => void>;
  previous$: QRL<() => void>;
  next$: QRL<() => void>;
  stop$: QRL<() => void>;
  seek$: QRL<(seconds: number) => void>;
  changeVoice$: QRL<(voice: string) => Promise<void>>;
  retry$: QRL<() => Promise<void>>;
}

const EMPTY_VOICE_MENU: SpeechVoiceMenu = {
  provider: "",
  model: "",
  selected: "",
  options: [],
  allowsCustom: false,
};

/**
 * Reactive Qwik interface over the application-wide speech manager.
 * Components use this hook instead of each binding their own audio element or
 * duplicating event cleanup.
 */
export function useSpeechPlayer(): SpeechPlayerHook {
  const state = useStore<SpeechState>(speechState());
  const voiceMenu = useStore<SpeechVoiceMenu>({ ...EMPTY_VOICE_MENU });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      let voiceKey = "";
      let menuGeneration = 0;

      const sync = () => {
        const snapshot = speechState();
        Object.assign(state, snapshot);

        const nextKey = `${snapshot.id ?? ""}:${snapshot.status}:${snapshot.voice ?? ""}`;
        if (!snapshot.id || nextKey === voiceKey) return;
        voiceKey = nextKey;
        const mine = ++menuGeneration;
        void currentSpeechVoiceMenu().then((menu) => {
          if (mine !== menuGeneration || !menu) return;
          Object.assign(voiceMenu, menu);
        });
      };

      window.addEventListener("twyne:speech", sync);
      sync();
      cleanup(() => {
        menuGeneration += 1;
        window.removeEventListener("twyne:speech", sync);
      });
    },
    { strategy: "document-ready" },
  );

  return {
    state,
    voiceMenu,
    toggle$: $(() => togglePauseSpeech()),
    previous$: $(() => previousSpeech()),
    next$: $(() => nextSpeech()),
    stop$: $(() => stopSpeech()),
    seek$: $((seconds: number) => seekSpeech(seconds)),
    changeVoice$: $(async (voice: string) => restartSpeechWithVoice(voice)),
    retry$: $(async () => retrySpeech()),
  };
}
