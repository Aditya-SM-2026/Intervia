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
import tempfile
import time
import wave
from pathlib import Path

from livekit import rtc
from livekit.agents import AgentSession
from livekit.agents.voice.recorder_io import RecorderIO

logger = logging.getLogger("intervia.audio")

# The encoder flushes the last seconds of audio on close; a stuck flush must
# not hold up the interview's completion record.
STOP_TIMEOUT_SECONDS = 30.0
# HR's voice is mixed in as a separate mono track; 16 kHz is plenty for speech.
HR_SAMPLE_RATE = 16_000


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
    """

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._path: Path | None = None
        self._directory: tempfile.TemporaryDirectory[str] | None = None
        self._writer: wave.Wave_write | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self._started_at: float | None = None
        self._open = False
        self._frames = 0

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
            writer = wave.open(str(path), "wb")  # noqa: SIM115 - kept open for the call
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(HR_SAMPLE_RATE)
            self._directory = directory
            self._path = path
            self._writer = writer
            self._started_at = time.time()
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
        writer = self._writer
        if writer is None:
            return
        try:
            async for event in stream:
                if not self._open or self._writer is None:
                    break
                self._writer.writeframes(bytes(event.frame.data))
                self._frames += 1
        except Exception as error:  # noqa: BLE001
            logger.debug("HR audio stream ended: %s", error)

    async def stop(self) -> Path | None:
        """Closes every stream and returns the file, or None when empty."""
        self._open = False
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
            self._tasks.clear()
        writer, path = self._writer, self._path
        self._writer = None
        if writer is not None:
            try:
                writer.close()
            except Exception as error:  # noqa: BLE001
                logger.warning("HR audio file could not be closed cleanly: %s", error)
        if path is None:
            return None
        if self._frames == 0:
            return None
        try:
            return path if path.exists() and path.stat().st_size > 0 else None
        except OSError:
            return None

    def discard(self) -> None:
        self._discard_directory()

    def _discard_directory(self) -> None:
        if self._directory is not None:
            try:
                self._directory.cleanup()
            except Exception as error:  # noqa: BLE001
                logger.debug("HR audio temp dir not removed: %s", error)
            self._directory = None
        self._path = None
