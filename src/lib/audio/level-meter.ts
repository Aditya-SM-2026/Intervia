/**
 * Reads live loudness from an audio track (the candidate's microphone or the
 * interviewer's voice) for on-screen meters. Analysis only: nothing here
 * changes or routes the audio that is actually sent or played.
 */

export interface LevelMeter {
  /** Fills `out` with one 0-1 level per band across the speech range. */
  readBands(out: Float32Array): void;
  /** Overall 0-1 loudness right now. */
  readLevel(): number;
  close(): void;
}

const FFT_SIZE = 256;
/** Bins covering roughly 170 Hz to 5 kHz at 48 kHz, where speech energy sits. */
const FIRST_BIN = 1;
const LAST_BIN = 28;

export function createLevelMeter(track: MediaStreamTrack): LevelMeter | null {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  let context: AudioContext;
  try {
    context = new AudioContextClass();
  } catch {
    return null;
  }
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  // Created after a click (join / enable devices), so this normally succeeds.
  void context.resume().catch(() => {});

  const bins = new Uint8Array(analyser.frequencyBinCount);

  return {
    readBands(out) {
      analyser.getByteFrequencyData(bins);
      const span = LAST_BIN - FIRST_BIN;
      for (let band = 0; band < out.length; band += 1) {
        const from = FIRST_BIN + Math.floor((band * span) / out.length);
        const to = Math.max(from + 1, FIRST_BIN + Math.floor(((band + 1) * span) / out.length));
        let sum = 0;
        for (let bin = from; bin < to; bin += 1) sum += bins[bin];
        out[band] = sum / (to - from) / 255;
      }
    },
    readLevel() {
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let bin = FIRST_BIN; bin < LAST_BIN; bin += 1) sum += bins[bin];
      return sum / (LAST_BIN - FIRST_BIN) / 255;
    },
    close() {
      source.disconnect();
      void context.close().catch(() => {});
    },
  };
}
