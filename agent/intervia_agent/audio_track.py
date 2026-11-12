"""One audio file of the whole interview, both sides.

LiveKit's participant egress records only the candidate's own tracks, so the
recording a recruiter plays has one side of the conversation. This writes the
interviewer's voice as well: `RecorderIO` from livekit-agents records the
candidate on the left channel and what the interviewer actually played on the
right, on one shared timeline, and accounts for interruptions.

The file is a stereo OGG on the agent's own disk; the web app stores it and
mixes it into the video (see src/lib/recordings/mix.ts).
"""

from __future__ import annotations

import asyncio
import logging
import struct
import tempfile
import time
from pathlib import Path
from typing import Any

from livekit import rtc
from livekit.agents import AgentSession
from livekit.agents.voice.recorder_io import RecorderIO

logger = logging.getLogger("intervia.audio")

# The encoder flushes the last seconds of audio on close; a stuck flush must
# not hold up the interview's completion record.
STOP_TIMEOUT_SECONDS = 30.0
# HR's voice is mixed in as a separate mono track; 16 kHz is plenty for speech.
HR_SAMPLE_RATE = 16_000
HR_BYTES_PER_SAMPLE = 2
# Frames are collected and written in one go, off the event loop: writing the
# WAV on the audio loop (Python's wave module rewrites the header on each call)
# blocked it for over 200 ms in testing, which stutters the interviewer's voice.
HR_FLUSH_BYTES = 64_000
WAV_HEADER_BYTES = 44


def _wav_header(data_bytes: int) -> bytes:
    """A canonical 44-byte mono 16-bit PCM WAV header."""
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_bytes,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        HR_SAMPLE_RATE,
        HR_SAMPLE_RATE * HR_BYTES_PER_SAMPLE,
        HR_BYTES_PER_SAMPLE,
        16,
        b"data",
        data_bytes,
    )


class InterviewAudio:
    """Records both sides of one interview to a single stereo OGG."""

    def __init__(self, session: AgentSession) -> None:
        self._session = session
        self._recorder: RecorderIO | None = None
        self._path: Path | None = None
        self._directory: tempfile.TemporaryDirectory[str] | None = None
        self._started_at: float | None = None

    @property
    def started_at(self) -> float | None:
        return self._started_at

    async def start(self) -> bool:
        """Begins recording. Failures are logged: an interview never stops for this."""
        self._started_at = time.time()
        input_audio = self._session.input.audio
        output_audio = self._session.output.audio
        if input_audio is None or output_audio is None:
            logger.warning("interview audio not recorded: session has no audio streams")
            return False
        try:
            directory = tempfile.TemporaryDirectory(prefix="interview-audio-")
            self._directory = directory
            path = Path(directory.name) / "interview.ogg"

            recorder = RecorderIO(agent_session=self._session)
            self._session.input.audio = recorder.record_input(input_audio)
            self._session.output.audio = recorder.record_output(output_audio)
            await recorder.start(output_path=path)

            self._recorder = recorder
            self._path = path
            return True
        except Exception as error:  # noqa: BLE001 - recording must never break the call
            logger.warning("interview audio could not be recorded: %s", error)
            # Put the streams back so playback is unaffected.
            self._session.input.audio = input_audio
            self._session.output.audio = output_audio
            self._path = None
            return False

    async def stop(self) -> Path | None:
        """Finishes the file and returns it, or None when nothing was captured."""
        recorder, path = self._recorder, self._path
        self._recorder = None
        if recorder is None or path is None:
            return None
        try:
            await asyncio.wait_for(recorder.aclose(), STOP_TIMEOUT_SECONDS)
        except Exception as error:  # noqa: BLE001
            logger.warning("interview audio could not be closed cleanly: %s", error)
        try:
            return path if path.exists() and path.stat().st_size > 0 else None
        except OSError:
            return None

    def discard(self) -> None:
        """Removes the temporary file once it has been uploaded."""
        if self._directory is not None:
            try:
                self._directory.cleanup()
            except Exception as error:  # noqa: BLE001 - leftover temp files are harmless
                logger.debug("interview audio temp dir not removed: %s", error)
            self._directory = None


class InterviewHrAudio:
    """Records the HR participant's microphone to its own mono WAV.

    RecorderIO only captures the linked participant (the candidate) and the
    agent, so HR's voice is recorded from their published microphone track
    directly. The web app mixes this file into the report recording alongside
    the other two voices.

    The file's clock starts with HR's first audio frame, not when the file was
    opened: HR often joins minutes into the interview, and the web app uses
    ``started_at`` to place their voice on the recording's timeline.
    """

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._path: Path | None = None
        self._directory: tempfile.TemporaryDirectory[str] | None = None
        self._file: Any | None = None
        self._buffer = bytearray()
        self._bytes_written = 0
        self._tasks: set[asyncio.Task[None]] = set()
        self._started_at: float | None = None
        self._open = False

    @property
    def started_at(self) -> float | None:
        return self._started_at

    def start(self) -> bool:
        """Opens the file. Failures only cost HR's voice in the mix."""
        if self._open:
            return True
        try:
            directory = tempfile.TemporaryDirectory(prefix="interview-hr-audio-")
            path = Path(directory.name) / "hr-audio.wav"
            handle = open(path, "wb")  # noqa: SIM115 - kept open for the call
            # A placeholder header; the real one is written when the call ends.
            handle.write(b"\0" * WAV_HEADER_BYTES)
            self._directory = directory
            self._path = path
            self._file = handle
            self._buffer = bytearray()
            self._bytes_written = 0
            self._started_at = None
            self._open = True
            return True
        except Exception as error:  # noqa: BLE001 - recording never breaks the call
            logger.warning("HR audio could not be recorded: %s", error)
            self._discard_directory()
            return False

    def attach(self, participant: rtc.RemoteParticipant) -> None:
        """Starts a stream for an HR participant's microphone, if present yet."""
        if not self._open:
            return
        for publication in participant.track_publications.values():
            if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.track:
                self.attach_track(publication.track)
                return

    def attach_track(self, track: rtc.Track) -> None:
        """Records one already-subscribed audio track (HR's microphone)."""
        if not self._open:
            return
        try:
            stream = rtc.AudioStream(track, sample_rate=HR_SAMPLE_RATE, num_channels=1)
        except Exception as error:  # noqa: BLE001
            logger.warning("HR audio track could not be opened: %s", error)
            return
        task = asyncio.create_task(self._drain(stream))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _drain(self, stream: rtc.AudioStream) -> None:
        if self._file is None:
            return
        first = True
        try:
            async for event in stream:
                if not self._open or self._file is None:
                    break
                if first:
                    first = False
                    if self._started_at is None:
                        self._started_at = time.time()
                    else:
                        # HR dropped and rejoined: keep the file as one
                        # timeline by filling the silence they were away for.
                        expected = int(
                            (time.time() - self._started_at) * HR_SAMPLE_RATE
                        ) * HR_BYTES_PER_SAMPLE
                        missing = expected - (self._bytes_written + len(self._buffer))
                        if missing > HR_SAMPLE_RATE:
                            self._buffer += b"\0" * missing
                self._buffer += bytes(event.frame.data)
                if len(self._buffer) >= HR_FLUSH_BYTES:
                    await self._flush()
        except Exception as error:  # noqa: BLE001
            logger.debug("HR audio stream ended: %s", error)

    async def _flush(self) -> None:
        if not self._buffer:
            return
        data = bytes(self._buffer)
        self._buffer.clear()
        self._bytes_written += len(data)
        await asyncio.to_thread(self._write, data)

    def _write(self, data: bytes) -> None:
        handle = self._file
        if handle is None:
            return
        handle.write(data)

    async def stop(self) -> Path | None:
        """Closes every stream and returns the file, or None when empty."""
        self._open = False
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
            self._tasks.clear()
        await self._flush()
        handle, path = self._file, self._path
        self._file = None
        if handle is not None:
            try:
                handle.seek(0)
                handle.write(_wav_header(self._bytes_written))
                handle.close()
            except Exception as error:  # noqa: BLE001
                logger.warning("HR audio file could not be closed cleanly: %s", error)
        if path is None or self._bytes_written == 0:
            return None
        try:
            return path if path.exists() and path.stat().st_size > WAV_HEADER_BYTES else None
        except OSError:
            return None

    def discard(self) -> None:
        self._discard_directory()

    def _discard_directory(self) -> None:
        handle = self._file
        self._file = None
        if handle is not None:
            try:
                handle.close()
            except Exception as error:  # noqa: BLE001
                logger.debug("HR audio file not closed: %s", error)
        if self._directory is not None:
            try:
                self._directory.cleanup()
            except Exception as error:  # noqa: BLE001
                logger.debug("HR audio temp dir not removed: %s", error)
            self._directory = None
        self._path = None
