/**
 * Plays spoken-reply audio arriving over the agent data channel
 * (ai-audio-chunk messages, complete audio segments per chunk). Segments are
 * decoded and scheduled back-to-back so a sentence starts the moment its
 * predecessor finishes. end() resolves once playback of the reply has drained.
 */
export class AgentAudioPlayer {
  private context: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private lastScheduledEnd = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  onDrained: (() => void) | null = null;

  get isPlaying(): boolean {
    return this.playing;
  }

  async enqueue(mimeType: string, base64: string): Promise<void> {
    this.context ??= new AudioContext();
    const context = this.context;
    await context.resume().catch(() => {});
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    const buffer = await context.decodeAudioData(bytes.buffer, undefined, () => {
      throw new Error(`Could not decode reply audio (${mimeType}).`);
    });
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.05, this.lastScheduledEnd);
    source.start(startAt);
    this.lastScheduledEnd = startAt + buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source);
    };
    this.playing = true;
  }

  /** Called when the worker signals the reply is complete. */
  end(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    const check = () => {
      const context = this.context;
      if (!context || context.currentTime >= this.lastScheduledEnd - 0.05) {
        this.playing = false;
        this.drainTimer = null;
        this.onDrained?.();
        return;
      }
      this.drainTimer = setTimeout(check, 250);
    };
    this.drainTimer = setTimeout(check, 250);
  }

  /**
   * Barge-in: stop all scheduled playback immediately and forget the queue so
   * the next reply starts from silence. The AudioContext is kept for reuse.
   */
  interrupt(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.sources = [];
    this.lastScheduledEnd = 0;
    this.playing = false;
  }

  stop(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.sources = [];
    this.playing = false;
    void this.context?.close();
    this.context = null;
  }
}