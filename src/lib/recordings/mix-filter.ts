/** Pure: the ffmpeg audio filter for a mix, shared by the website and the worker request. */

/**
 * The audio filter chain for one mix: align each voice to the video's clock,
 * even out their levels and fold them into one mono track.
 *
 * The candidate is taken from the video's own microphone track whenever the
 * recording has one. The agent's recorder silences its candidate channel while
 * HR holds the floor (the input gate is closed so the model cannot hear over
 * HR), and it can also drop a stretch of audio when the voice session is
 * swapped, which used to leave silent holes in the report. The candidate's own
 * audio has neither problem. The agent is the right channel of the recorder's
 * stereo track, and HR is their own mono file.
 *
 * When the video has no audio track at all (an unusual browser/egress
 * combination) the recorder's two channels are folded together instead.
 */
export function audioFilter(
  deltaSeconds: number,
  hrDeltaSeconds: number | null,
  videoAudio: boolean,
): string {
  const offsetFor = (delta: number): string => {
    const ms = Math.round(Math.abs(delta) * 1000);
    if (ms === 0) return "";
    return delta > 0
      ? `adelay=${ms}:all=1,`
      : `atrim=start=${Math.abs(delta).toFixed(3)},asetpts=PTS-STARTPTS,`;
  };

  const parts: string[] = [];
  const labels: string[] = [];
  if (videoAudio) {
    parts.push("[0:a]aresample=48000,pan=mono|c0=c0[candidate]");
    labels.push("[candidate]");
    parts.push(
      `[1:a]${offsetFor(deltaSeconds)}pan=mono|c0=c1,aresample=48000[agent]`,
    );
    labels.push("[agent]");
  } else {
    parts.push(
      `[1:a]${offsetFor(deltaSeconds)}pan=mono|c0=0.5*c0+0.5*c1,aresample=48000[candidate]`,
    );
    labels.push("[candidate]");
  }

  // HR's microphone is its own mono file, recorded by the agent from the HR
  // participant's track. A small lift sits them level with the other voices.
  if (hrDeltaSeconds !== null) {
    parts.push(
      `[2:a]${offsetFor(hrDeltaSeconds)}aresample=48000,pan=mono|c0=c0,volume=1.5[hr]`,
    );
    labels.push("[hr]");
  }

  // A final limiter keeps the boosted voices from clipping, and loudnorm makes
  // the report comfortable to listen to whatever the room's levels were.
  parts.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
      `alimiter=limit=0.95:level=false,loudnorm=I=-16:TP=-1.5:LRA=11,` +
      // Pinned to mono: some inputs leave the layout open, and the encoder
      // then refuses the stream ("cannot select channel layout").
      `alimiter=limit=0.8:level=false,aresample=48000,aformat=channel_layouts=mono[mixed]`,
  );
  return parts.join(";");
}
