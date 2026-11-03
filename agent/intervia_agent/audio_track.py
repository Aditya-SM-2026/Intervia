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
from pathlib import Path

from livekit.agents import AgentSession
from livekit.agents.voice.recorder_io import RecorderIO

logger = logging.getLogger("intervia.audio")

# The encoder flushes the last seconds of audio on close; a stuck flush must
# not hold up the interview's completion record.
STOP_TIMEOUT_SECONDS = 30.0


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
