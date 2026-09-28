const WORKLET = `class TwynePcm extends AudioWorkletProcessor {
 constructor(){super();this.samples=new Int16Array(2400);this.index=0;}
 process(inputs){const channel=inputs[0]?.[0];if(!channel)return true;
 for(const value of channel){const s=Math.max(-1,Math.min(1,value));this.samples[this.index++]=s<0?s*32768:s*32767;
 if(this.index===2400){this.port.postMessage(this.samples.buffer,[this.samples.buffer]);this.samples=new Int16Array(2400);this.index=0;}}return true;}
} registerProcessor('twyne-pcm',TwynePcm);`;

/** A single audio clock for microphone capture and speech, with echo cancellation. */
export async function liveVoiceAudio(
  onChunk: (audio: string, level: number) => void,
) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Live voice needs microphone access over HTTPS.");
  const context = new AudioContext({ sampleRate: 24_000 });
  // Resume in the initiating gesture, before the microphone permission prompt.
  const resumed = context.resume();
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let silent: GainNode | null = null;
  let nextTime = 0;
  let stopped = false;
  const playing = new Set<AudioBufferSourceNode>();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    if (node) node.port.onmessage = null;
    node?.disconnect();
    source?.disconnect();
    silent?.disconnect();
    playing.forEach((audio) => {
      try {
        audio.stop();
      } catch {
        /* ended */
      }
    });
    playing.clear();
    void context.close();
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    await resumed;
    if (context.sampleRate !== 24_000 || !context.audioWorklet)
      throw new Error("This browser cannot capture Live audio at 24 kHz.");
    const url = URL.createObjectURL(
      new Blob([WORKLET], { type: "application/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "twyne-pcm");
    silent = context.createGain();
    silent.gain.value = 0;
    node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (stopped) return;
      const bytes = new Uint8Array(data);
      const pcm = new Int16Array(data);
      let sum = 0;
      for (const sample of pcm) sum += (sample / 32768) ** 2;
      onChunk(
        btoa(String.fromCharCode(...bytes)),
        Math.min(1, Math.sqrt(sum / pcm.length) * 5),
      );
    };
    source.connect(node);
    node.connect(silent);
    silent.connect(context.destination);
    return {
      stop,
      mute(value: boolean) {
        stream?.getAudioTracks().forEach((track) => {
          track.enabled = !value;
        });
      },
      play(base64: string, onEnd: () => void) {
        if (stopped) return;
        if (context.state !== "running")
          throw new Error(
            "Audio playback is paused by your browser. End the session and start again.",
          );
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        if (!bytes.length || bytes.length % 2)
          throw new Error("Invalid Live audio.");
        const pcm = new DataView(bytes.buffer);
        const buffer = context.createBuffer(1, bytes.length / 2, 24_000);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = pcm.getInt16(i * 2, true) / 32768;
        if (nextTime - context.currentTime > 5)
          throw new Error(
            "Speech playback fell behind. Reconnect to continue.",
          );
        const audio = context.createBufferSource();
        audio.buffer = buffer;
        audio.connect(context.destination);
        playing.add(audio);
        audio.onended = () => {
          audio.disconnect();
          playing.delete(audio);
          if (!playing.size) onEnd();
        };
        const start = Math.max(context.currentTime, nextTime);
        nextTime = start + buffer.duration;
        audio.start(start);
      },
    };
  } catch (error) {
    stop();
    throw error;
  }
}
