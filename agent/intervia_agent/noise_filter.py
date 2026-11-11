"""Open-source noise filter for the interruption detector.

Runs DTLN (Dual-signal Transformation LSTM Network, MIT licence, see
``models/dtln``) on the candidate's audio before the local voice detector
hears it. That detector is what stops the interviewer when the candidate
starts talking; fed raw audio, a fan, a keyboard or a door could set it off
and cut a question in half. Fed cleaned audio, only real speech does.

Gemini still hears the original audio. Tests with Indian English speech
showed the cleaned audio helps with clicks and chatter but costs a word or
two under steady fan noise, which speech models already handle well. So the
filter is used where it can only help: deciding whether the candidate spoke.
The interview recording is untouched as well.

Safe by design:
- Strength (``NOISE_FILTER_LEVEL``, 0 to 1, default 0.8) blends the cleaned
  audio with some of the original, capping removal at about 14 dB, so a quiet
  candidate is always still detected.
- If the filter fails in any way, the detector gets the original audio for
  the rest of the interview, exactly as before the filter existed.
- ``NOISE_FILTER=off`` switches it off entirely. It is **off by default**: the
  ONNX models run inside the voice detector's audio path, and on a small agent
  VM that blocked the event loop for 200 ms per frame, which stutters the
  interviewer's own voice. Enable it (``NOISE_FILTER=on``) only where there is
  CPU to spare.

DTLN works on 16 kHz audio in 8 ms steps; its delay is 32 ms.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

import numpy as np
from livekit import rtc
from livekit.agents import vad

logger = logging.getLogger("intervia.noise_filter")

SAMPLE_RATE = 16000
BLOCK_LEN = 512
BLOCK_SHIFT = 128
MODEL_DIR = Path(__file__).parent / "models" / "dtln"
DEFAULT_LEVEL = 0.8


class BlockProcessor(Protocol):
    """One mono float32 block in, the same number of samples out."""

    def process(self, audio: np.ndarray) -> np.ndarray: ...


class DtlnDenoiser:
    """DTLN, one 128-sample step at a time, blended with the original.

    The two models carry their LSTM state from step to step. The cleaned
    signal lags the input by three steps (384 samples), so the original is
    delayed by the same amount before blending.
    """

    def __init__(
        self, level: float = DEFAULT_LEVEL, model_dir: Path = MODEL_DIR
    ) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        # One thread each: several interviews share a small VM.
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        self._mask_model = ort.InferenceSession(
            str(model_dir / "model_1.onnx"), options, providers=providers
        )
        self._signal_model = ort.InferenceSession(
            str(model_dir / "model_2.onnx"), options, providers=providers
        )
        self._mask_in, self._mask_state_in = (
            i.name for i in self._mask_model.get_inputs()
        )
        self._signal_in, self._signal_state_in = (
            i.name for i in self._signal_model.get_inputs()
        )
        self._mask_state = np.zeros((1, 2, 128, 2), dtype=np.float32)
        self._signal_state = np.zeros((1, 2, 128, 2), dtype=np.float32)
        self._in = np.zeros(BLOCK_LEN, dtype=np.float32)
        self._out = np.zeros(BLOCK_LEN, dtype=np.float32)
        self._dry = np.zeros(BLOCK_LEN - BLOCK_SHIFT, dtype=np.float32)
        self.level = min(1.0, max(0.0, level))

    def process(self, block: np.ndarray) -> np.ndarray:
        self._in[:-BLOCK_SHIFT] = self._in[BLOCK_SHIFT:]
        self._in[-BLOCK_SHIFT:] = block
        spectrum = np.fft.rfft(self._in)
        magnitude = np.abs(spectrum).astype(np.float32)
        mask, self._mask_state = self._mask_model.run(
            None,
            {
                self._mask_in: magnitude.reshape(1, 1, -1),
                self._mask_state_in: self._mask_state,
            },
        )
        estimate = np.fft.irfft(spectrum * mask.reshape(-1)).astype(np.float32)
        cleaned, self._signal_state = self._signal_model.run(
            None,
            {
                self._signal_in: estimate.reshape(1, 1, -1),
                self._signal_state_in: self._signal_state,
            },
        )
        self._out[:-BLOCK_SHIFT] = self._out[BLOCK_SHIFT:]
        self._out[-BLOCK_SHIFT:] = 0.0
        self._out += cleaned.reshape(-1)
        wet = self._out[:BLOCK_SHIFT]
        dry = self._dry[:BLOCK_SHIFT].copy()
        self._dry[:-BLOCK_SHIFT] = self._dry[BLOCK_SHIFT:]
        self._dry[-BLOCK_SHIFT:] = block
        return (self.level * wet + (1.0 - self.level) * dry).astype(np.float32)


class BlockFilter:
    """Runs a block processor over audio frames of any length.

    Frames (20 ms, 320 samples at 16 kHz) and blocks (128 samples) do not
    line up, so samples are queued and processed in whole blocks. One block
    of silence up front keeps the output from ever running short, so no gap
    is inserted mid-speech; it is the only extra delay (8 ms).
    """

    def __init__(self, processor: BlockProcessor, block: int) -> None:
        self._processor = processor
        self._block = block
        self._pending = np.zeros(0, dtype=np.float32)
        self._ready = np.zeros(block, dtype=np.float32)

    def process_frame(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
        samples = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0
        self._pending = np.concatenate([self._pending, samples])
        while self._pending.size >= self._block:
            block, self._pending = (
                self._pending[: self._block],
                self._pending[self._block :],
            )
            cleaned = np.asarray(
                self._processor.process(np.ascontiguousarray(block)), dtype=np.float32
            )
            if cleaned.shape != block.shape:
                raise ValueError(
                    f"block of {block.size} samples came back as {cleaned.size}"
                )
            self._ready = np.concatenate([self._ready, cleaned])
        wanted = samples.size
        if self._ready.size < wanted:  # cannot happen with the one-block lead
            padding = np.zeros(wanted - self._ready.size, dtype=np.float32)
            self._ready = np.concatenate([padding, self._ready])
        out, self._ready = self._ready[:wanted], self._ready[wanted:]
        pcm = (np.clip(out, -1.0, 1.0) * 32767.0).astype(np.int16)
        return rtc.AudioFrame(
            data=pcm.tobytes(),
            sample_rate=frame.sample_rate,
            num_channels=1,
            samples_per_channel=wanted,
        )


class FilteredVAD(vad.VAD):
    """A voice detector that hears the candidate through the noise filter."""

    def __init__(
        self,
        inner: vad.VAD,
        make_processor: Callable[[], tuple[BlockProcessor, int]] | None = None,
    ) -> None:
        super().__init__(capabilities=inner.capabilities)
        self._inner = inner
        self._make_processor = make_processor or _dtln
        inner.on(
            "metrics_collected", lambda metrics: self.emit("metrics_collected", metrics)
        )

    @property
    def model(self) -> str:
        return self._inner.model

    @property
    def provider(self) -> str:
        return self._inner.provider

    def stream(self) -> vad.VADStream:
        return _FilteredVADStream(self._inner.stream(), self._make_processor)  # type: ignore[return-value]


class _FilteredVADStream:
    """The inner detector's stream, with each pushed frame cleaned first."""

    def __init__(
        self,
        inner: vad.VADStream,
        make_processor: Callable[[], tuple[BlockProcessor, int]],
    ) -> None:
        self._inner = inner
        self._make_processor = make_processor
        self._filter: BlockFilter | None = None
        self._failed = False

    def push_frame(self, frame: rtc.AudioFrame) -> None:
        self._inner.push_frame(self._clean(frame))

    def _clean(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
        if self._failed or frame.num_channels != 1 or frame.sample_rate != SAMPLE_RATE:
            return frame
        try:
            if self._filter is None:
                self._filter = BlockFilter(*self._make_processor())
            return self._filter.process_frame(frame)
        except Exception as error:  # noqa: BLE001 (the detector falls back to raw audio)
            self._failed = True
            logger.error("noise filter stopped, detector hears raw audio: %s", error)
            return frame

    def flush(self) -> None:
        self._inner.flush()

    def end_input(self) -> None:
        self._inner.end_input()

    async def aclose(self) -> None:
        await self._inner.aclose()

    def __aiter__(self) -> _FilteredVADStream:
        return self

    async def __anext__(self) -> vad.VADEvent:
        return await self._inner.__anext__()

    def __getattr__(self, name: str) -> object:
        return getattr(self._inner, name)


def _dtln() -> tuple[BlockProcessor, int]:
    level = filter_level()
    logger.info("noise filter on: DTLN at %d Hz, level %.2f", SAMPLE_RATE, level)
    return DtlnDenoiser(level), BLOCK_SHIFT


def noise_filter_enabled() -> bool:
    """Off unless NOISE_FILTER is explicitly on and the models are present.

    Off by default: the filter's ONNX inference runs on the agent's event loop,
    and on the deployment VM that stalled audio for hundreds of milliseconds per
    frame, which made the interviewer's voice break up mid-sentence.
    """
    if os.environ.get("NOISE_FILTER", "").strip().lower() not in {
        "on",
        "1",
        "true",
        "yes",
    }:
        return False
    return (MODEL_DIR / "model_1.onnx").is_file() and (MODEL_DIR / "model_2.onnx").is_file()


def filter_level() -> float:
    try:
        return min(
            1.0, max(0.0, float(os.environ.get("NOISE_FILTER_LEVEL", DEFAULT_LEVEL)))
        )
    except ValueError:
        return DEFAULT_LEVEL
