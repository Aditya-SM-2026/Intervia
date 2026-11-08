"""
Audio measurements for the v2 integrity analysis.

- loudness envelope on the video's frame clock, for the lip-sync check;
- per answer, a verbatim re-transcription (faster-whisper, MIT) that keeps
  "um/uh" and repeated words, which the live transcript drops; from it, how
  the answer was spoken: hesitations, self-repeats, pauses, pace and how even
  the pace was. Read-aloud speech is smooth and even; thinking aloud is not;
- per answer, a voice fingerprint (WeSpeaker ResNet34, ONNX, CC-BY-4.0)
  compared with the candidate's other answers, to spot a different speaker.

Every part is optional. A missing model leaves its fields null, and the web
app reports that check as not run.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Any

import numpy as np

RATE = 16000
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
WHISPER_DIR = os.environ.get("WHISPER_MODEL_DIR", "/models/whisper-base")
SPEAKER_MODEL = os.environ.get("SPEAKER_MODEL", "/models/voxceleb_resnet34_LM.onnx")

FILLERS = {"um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "hm", "mm", "mhm"}
# Whisper drops fillers unless the prompt shows them being kept.
VERBATIM_PROMPT = "Umm, so, uh, I think, I think the, uh, the main thing was, hmm, let me think, like, um."
# An answer needs this much speech before its voice fingerprint means anything.
MIN_VOICE_SECONDS = 4.0


def log(message: str) -> None:
    print(f"[audio] {message}", flush=True)


def load_wav(source: str) -> np.ndarray | None:
    """The whole recording as 16 kHz mono float32, or None when it has no audio."""
    try:
        raw = subprocess.run(
            [FFMPEG, "-v", "error", "-i", source, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
            capture_output=True,
            timeout=600,
            check=True,
        ).stdout
    except Exception as error:
        log(f"audio extraction failed: {error}")
        return None
    if len(raw) < RATE * 4:
        return None
    return np.frombuffer(raw, dtype=np.float32).copy()


def envelope(wav: np.ndarray, hop_seconds: float = 1 / 30) -> tuple[np.ndarray, float]:
    """RMS loudness every hop, as (values, hop). Speech is band-limited first."""
    hop = max(1, int(RATE * hop_seconds))
    # A crude voice band: remove the DC/rumble with a first difference.
    voiced = np.diff(wav, prepend=wav[:1])
    frames = len(voiced) // hop
    if frames == 0:
        return np.zeros(0, dtype=np.float32), hop_seconds
    shaped = voiced[: frames * hop].reshape(frames, hop)
    return np.sqrt((shaped**2).mean(axis=1)).astype(np.float32), hop / RATE


def _slice(wav: np.ndarray, start: float, end: float) -> np.ndarray:
    a = max(0, int(start * RATE))
    b = min(len(wav), int(end * RATE))
    return wav[a:b] if b > a else np.zeros(0, dtype=np.float32)


class Transcriber:
    def __init__(self) -> None:
        self.model = None
        if not os.path.isdir(WHISPER_DIR):
            log(f"whisper model not found at {WHISPER_DIR}")
            return
        try:
            from faster_whisper import WhisperModel

            threads = int(os.environ.get("WHISPER_THREADS", "2"))
            self.model = WhisperModel(WHISPER_DIR, device="cpu", compute_type="int8", cpu_threads=threads)
        except Exception as error:
            log(f"whisper unavailable: {error}")

    def words(self, clip: np.ndarray) -> list[dict[str, Any]] | None:
        if self.model is None or len(clip) < RATE:
            return None
        try:
            segments, _ = self.model.transcribe(
                clip,
                language="en",
                beam_size=1,
                word_timestamps=True,
                initial_prompt=VERBATIM_PROMPT,
                condition_on_previous_text=False,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
            )
            out = []
            for segment in segments:
                for word in segment.words or []:
                    out.append({"w": word.word.strip(), "s": float(word.start), "e": float(word.end)})
            return out
        except Exception as error:
            log(f"transcription failed: {error}")
            return None


def delivery(words: list[dict[str, Any]] | None, window_start: float, window_end: float) -> dict[str, Any] | None:
    """How an answer was spoken, from word timings."""
    if not words or len(words) < 8:
        return None
    tokens = [re.sub(r"[^a-z']", "", item["w"].lower()) for item in words]
    fillers = sum(1 for token in tokens if token in FILLERS)
    content = [token for token in tokens if token and token not in FILLERS]
    repeats = 0
    for i in range(1, len(content)):
        if content[i] == content[i - 1] and len(content[i]) > 1:
            repeats += 1
    for i in range(3, len(content)):
        if content[i - 1] == content[i - 3] and content[i] == content[i - 2]:
            repeats += 1
    first, last = words[0]["s"], words[-1]["e"]
    spoken = max(0.5, last - first)
    gaps = [words[i]["s"] - words[i - 1]["e"] for i in range(1, len(words))]
    long_pauses = sum(1 for gap in gaps if gap >= 1.0)
    pause_time = sum(gap for gap in gaps if gap >= 0.3)
    # Pace in 4-second bins; read speech keeps a steadier pace than thinking aloud.
    bins: dict[int, int] = {}
    for item in words:
        bins[int((item["s"] - first) // 4)] = bins.get(int((item["s"] - first) // 4), 0) + 1
    counts = np.array([bins.get(i, 0) for i in range(int(spoken // 4) + 1)], dtype=np.float64)
    full = counts[:-1] if len(counts) > 2 else counts
    rate_cv = float(full.std() / full.mean()) if len(full) >= 3 and full.mean() > 0 else None
    per100 = 100.0 / max(1, len(tokens))
    return {
        "words": len(tokens),
        "spokenSeconds": round(spoken, 1),
        "wordsPerMinute": round(60 * len(content) / spoken, 1),
        "fillersPer100": round(fillers * per100, 2),
        "repeatsPer100": round(repeats * per100, 2),
        "longPauses": long_pauses,
        "pauseShare": round(pause_time / spoken, 3),
        "paceVariation": None if rate_cv is None else round(rate_cv, 3),
        "startDelay": round(max(0.0, first), 2),
    }


class SpeakerEmbedder:
    def __init__(self) -> None:
        self.session = None
        if not os.path.exists(SPEAKER_MODEL):
            log(f"speaker model not found at {SPEAKER_MODEL}")
            return
        try:
            import kaldi_native_fbank as knf
            import onnxruntime as ort

            self.knf = knf
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            self.session = ort.InferenceSession(SPEAKER_MODEL, options, providers=["CPUExecutionProvider"])
            self.input_name = self.session.get_inputs()[0].name
        except Exception as error:
            log(f"speaker model unavailable: {error}")
            self.session = None

    def _fbank(self, clip: np.ndarray) -> np.ndarray:
        opts = self.knf.FbankOptions()
        opts.frame_opts.dither = 0.0
        opts.frame_opts.samp_freq = RATE
        opts.frame_opts.frame_length_ms = 25
        opts.frame_opts.frame_shift_ms = 10
        opts.mel_opts.num_bins = 80
        fbank = self.knf.OnlineFbank(opts)
        # WeSpeaker models are trained on 16-bit scaled samples.
        fbank.accept_waveform(RATE, (clip * 32768.0).tolist())
        fbank.input_finished()
        feats = np.array([fbank.get_frame(i) for i in range(fbank.num_frames_ready)], dtype=np.float32)
        return feats - feats.mean(axis=0, keepdims=True)

    def embed(self, clip: np.ndarray) -> np.ndarray | None:
        if self.session is None or len(clip) < RATE * MIN_VOICE_SECONDS:
            return None
        try:
            feats = self._fbank(clip)
            if len(feats) < 100:
                return None
            output = self.session.run(None, {self.input_name: feats[None]})[0][0]
            norm = np.linalg.norm(output)
            return output / norm if norm > 0 else None
        except Exception as error:
            log(f"embedding failed: {error}")
            return None


def voiced_only(clip: np.ndarray, words: list[dict[str, Any]] | None) -> np.ndarray:
    """The parts of an answer where words were spoken, so silence and room noise
    do not dilute the voice fingerprint."""
    if not words:
        return clip
    parts = [_slice(clip, item["s"] - 0.05, item["e"] + 0.05) for item in words if item["e"] > item["s"]]
    parts = [part for part in parts if len(part)]
    return np.concatenate(parts) if parts else clip


def analyse_answers(wav: np.ndarray, answers: list[dict[str, Any]]) -> dict[str, Any]:
    """Per turnSeq: delivery measures and voice similarity to the candidate's other answers."""
    transcriber = Transcriber()
    embedder = SpeakerEmbedder()
    out: dict[int, dict[str, Any]] = {}
    embeddings: dict[int, np.ndarray] = {}
    for answer in answers:
        seq = int(answer["turnSeq"])
        start, end = float(answer["start"]), float(answer["end"])
        clip = _slice(wav, start, end + 0.5)
        words = transcriber.words(clip)
        out[seq] = {"delivery": delivery(words, start, end), "voiceSimilarity": None}
        embedding = embedder.embed(voiced_only(clip, words))
        if embedding is not None:
            embeddings[seq] = embedding
    if len(embeddings) >= 3:
        stack = np.stack(list(embeddings.values()))
        keys = list(embeddings.keys())
        for i, seq in enumerate(keys):
            # Leave-one-out reference: the candidate's voice across every other answer.
            others = np.delete(stack, i, axis=0).mean(axis=0)
            others /= max(1e-6, np.linalg.norm(others))
            out[seq]["voiceSimilarity"] = round(float(np.dot(stack[i], others)), 3)
    return {
        "answers": out,
        "transcriber": transcriber.model is not None,
        "voice": embedder.session is not None,
    }
