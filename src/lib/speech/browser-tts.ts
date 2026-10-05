/**
 * Text-to-speech via the browser's SpeechSynthesis API. The AI agent's reply
 * text arrives over the LiveKit data channel and is spoken aloud here.
 *
 * Ominibot's API is text-only and no separate TTS credentials are configured,
 * so browser-side synthesis is the voice for v1 (documented in README).
 */

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speakText(text: string, onEnd: () => void): void {
  if (!isSpeechSynthesisSupported()) {
    onEnd();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;

  // Some browsers (notably headless ones) can hang without firing onend;
  // a duration-estimate fallback keeps the conversation moving.
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(fallback);
    onEnd();
  };
  const fallback = window.setTimeout(finish, estimateDurationMs(text));

  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
}

/** Rough spoken-duration estimate: ~400ms per word plus a start buffer. */
function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(3000, words * 400 + 1500);
}

export function cancelSpeech(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}