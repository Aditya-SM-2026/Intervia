/**
 * Reassembles sentence audio that the agent split into multiple data-channel
 * pieces. The agent streams one sentence as `pieces` chunks (fields `piece`
 * and `pieces`); each piece alone is a truncated MP3 stream that would decode
 * as garbage if played on its own. Completed sentences are handed to the
 * player strictly in arrival order — consecutive sentences must never swap,
 * or the speech would play out of sequence.
 */
export class SentenceAssembler {
  private pending = new Map<
    number,
    { mimeType: string; pieces: (string | undefined)[]; received: number }
  >();
  /** Serializes decode+enqueue so sentences always reach the player in order. */
  private chain: Promise<void> = Promise.resolve();
  /** Fired with one complete sentence (mime + base64), in order. */
  onSentence: ((mimeType: string, base64: string) => Promise<void> | void) | null = null;

  /**
   * Adds one piece. `piece`/`pieces` are absent when the agent sent the whole
   * sentence in a single chunk (or an old agent is running) — pass it through.
   * Returns true when the piece belongs to the current reply.
   */
  add(
    sentence: number,
    piece: number | undefined,
    pieces: number | undefined,
    mimeType: string,
    data: string,
  ): void {
    if (piece === undefined || pieces === undefined || pieces <= 1) {
      this.chain = this.chain.then(() => this.onSentence?.(mimeType, data)).catch(() => {});
      return;
    }
    let entry = this.pending.get(sentence);
    if (!entry) {
      entry = { mimeType, pieces: new Array(pieces), received: 0 };
      this.pending.set(sentence, entry);
    }
    if (piece < 0 || piece >= pieces || entry.pieces[piece] !== undefined) return;
    entry.pieces[piece] = data;
    entry.received += 1;
    if (entry.received < pieces) return;
    this.pending.delete(sentence);
    const base64 = entry.pieces.join("");
    const completed = entry;
    this.chain = this.chain
      .then(() => this.onSentence?.(completed.mimeType, base64))
      .catch(() => {});
  }

  /** Drops any half-received sentences (interrupted reply or reply change). */
  reset(): void {
    this.pending.clear();
  }
}