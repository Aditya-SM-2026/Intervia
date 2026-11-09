import asyncio

import numpy as np
import pytest
from livekit import rtc

from intervia_agent.noise_filter import (
    BLOCK_SHIFT,
    SAMPLE_RATE,
    BlockFilter,
    DtlnDenoiser,
    FilteredVAD,
    noise_filter_enabled,
)


class Halve:
    """Stands in for the model: halves every sample, so its work is visible."""

    def __init__(self) -> None:
        self.calls = 0

    def process(self, audio: np.ndarray) -> np.ndarray:
        self.calls += 1
        return audio * 0.5


def frame(samples: np.ndarray, rate: int = SAMPLE_RATE) -> rtc.AudioFrame:
    pcm = samples.astype(np.int16)
    return rtc.AudioFrame(
        data=pcm.tobytes(),
        sample_rate=rate,
        num_channels=1,
        samples_per_channel=pcm.size,
    )


def pcm(out: rtc.AudioFrame) -> np.ndarray:
    return np.frombuffer(out.data, dtype=np.int16).astype(np.int32)


def test_frames_keep_their_length_and_no_gap_is_inserted():
    model = Halve()
    flt = BlockFilter(model, BLOCK_SHIFT)
    source = np.full(320 * 10, 8000, dtype=np.int16)
    outputs = [
        flt.process_frame(frame(source[i : i + 320]))
        for i in range(0, source.size, 320)
    ]
    assert all(out.samples_per_channel == 320 for out in outputs)
    joined = np.concatenate([pcm(out) for out in outputs])
    # One block of silence at the very start, then every sample filtered.
    assert np.all(joined[:BLOCK_SHIFT] == 0)
    assert np.all(np.abs(joined[BLOCK_SHIFT:] - 4000) <= 1)
    assert model.calls == source.size // BLOCK_SHIFT


class FakeStream:
    """Records what the wrapped detector stream receives."""

    def __init__(self) -> None:
        self.pushed: list[rtc.AudioFrame] = []
        self.closed = False

    def push_frame(self, frame: rtc.AudioFrame) -> None:
        self.pushed.append(frame)

    async def aclose(self) -> None:
        self.closed = True


class FakeVAD:
    """Stands in for silero: just enough of the detector interface."""

    def __init__(self) -> None:
        from livekit.agents.vad import VADCapabilities

        self.capabilities = VADCapabilities(update_interval=0.032)
        self.model = "silero"
        self.provider = "silero"
        self.last: FakeStream | None = None

    def on(self, *_args) -> None:
        pass

    def stream(self) -> FakeStream:
        self.last = FakeStream()
        return self.last


def test_the_detector_hears_cleaned_audio():
    inner = FakeVAD()
    detector = FilteredVAD(inner, lambda: (Halve(), BLOCK_SHIFT))  # type: ignore[arg-type]
    stream = detector.stream()
    source = np.full(320 * 4, 8000, dtype=np.int16)
    for i in range(0, source.size, 320):
        stream.push_frame(frame(source[i : i + 320]))
    heard = np.concatenate([pcm(f) for f in inner.last.pushed])
    assert np.all(np.abs(heard[BLOCK_SHIFT:] - 4000) <= 1)
    asyncio.run(stream.aclose())
    assert inner.last.closed


def test_a_failing_filter_lets_the_detector_hear_raw_audio():
    class Broken:
        def process(self, audio: np.ndarray) -> np.ndarray:
            raise RuntimeError("model crashed")

    inner = FakeVAD()
    stream = FilteredVAD(inner, lambda: (Broken(), BLOCK_SHIFT)).stream()  # type: ignore[arg-type]
    source = np.full(320, 1234, dtype=np.int16)
    stream.push_frame(frame(source))
    stream.push_frame(frame(source))
    assert all(
        np.array_equal(pcm(f), source.astype(np.int32)) for f in inner.last.pushed
    )


def test_other_sample_rates_reach_the_detector_untouched():
    inner = FakeVAD()
    stream = FilteredVAD(inner, lambda: (Halve(), BLOCK_SHIFT)).stream()  # type: ignore[arg-type]
    source = np.full(480, 999, dtype=np.int16)
    stream.push_frame(frame(source, rate=24000))
    assert np.array_equal(pcm(inner.last.pushed[0]), source.astype(np.int32))


def test_switch_off(monkeypatch):
    monkeypatch.setenv("NOISE_FILTER", "off")
    assert noise_filter_enabled() is False
    monkeypatch.setenv("NOISE_FILTER", "on")
    assert noise_filter_enabled() is True


def tone(seconds: float, freq: float, amplitude: float) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def run_dtln(audio: np.ndarray, level: float) -> np.ndarray:
    denoiser = DtlnDenoiser(level)
    blocks = audio[: audio.size // BLOCK_SHIFT * BLOCK_SHIFT].reshape(-1, BLOCK_SHIFT)
    return np.concatenate([denoiser.process(block) for block in blocks])


def rms_db(audio: np.ndarray) -> float:
    return 20 * np.log10(np.sqrt(np.mean(audio**2)) + 1e-12)


def test_dtln_removes_steady_noise():
    rng = np.random.default_rng(1)
    noise = (rng.standard_normal(SAMPLE_RATE * 3) * 0.05).astype(np.float32)
    out = run_dtln(noise, level=1.0)
    # Pure noise, fully filtered: at least 10 dB quieter after the first second.
    assert rms_db(out[SAMPLE_RATE:]) - rms_db(noise[SAMPLE_RATE:]) < -10


def test_the_blend_caps_how_much_is_removed():
    rng = np.random.default_rng(2)
    noise = (rng.standard_normal(SAMPLE_RATE * 3) * 0.05).astype(np.float32)
    out = run_dtln(noise, level=0.8)
    # A fifth of the original is always kept, so at most about 14 dB goes.
    assert rms_db(out[SAMPLE_RATE:]) - rms_db(noise[SAMPLE_RATE:]) > -15


@pytest.mark.parametrize("amplitude", [0.3, 0.02])
def test_dtln_output_stays_bounded(amplitude):
    out = run_dtln(tone(1.0, 220.0, amplitude), level=0.8)
    assert np.all(np.isfinite(out))
    assert np.max(np.abs(out)) < 1.0
