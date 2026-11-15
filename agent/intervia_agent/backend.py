"""HTTP client for the web app's agent API.

The web app owns storage; the worker reads the interview context from it and
writes turns, events and the completion record back. Writes are buffered and
never raise into the interview: losing a batch must not break a live call.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("intervia.backend")

FLUSH_INTERVAL_SECONDS = 3.0
REQUEST_TIMEOUT_SECONDS = 15.0
# A half-hour interview is a few tens of megabytes.
AUDIO_TIMEOUT_SECONDS = 180.0
# End-of-interview reports are retried: the web app may be starting up (it
# scales to zero) or briefly busy, and a lost report costs the scorecard or
# the interviewer's voice in the recording.
REPORT_ATTEMPTS = 3
REPORT_BACKOFF_SECONDS = (2.0, 6.0)


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def iso_from_epoch(seconds: float) -> str:
    return (
        datetime.fromtimestamp(seconds, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


class Backend:
    def __init__(self, web_url: str, secret: str, interview_id: str) -> None:
        self._base = f"{web_url}/api/agent/interviews/{interview_id}"
        self._client = httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={"Authorization": f"Bearer {secret}"} if secret else {},
        )
        self._turns: list[dict[str, Any]] = []
        self._events: list[dict[str, Any]] = []
        self._flush_lock = asyncio.Lock()
        self._flush_task: asyncio.Task[None] | None = None

    async def fetch_context(self) -> Any | None:
        try:
            response = await self._client.get(self._base)
            response.raise_for_status()
            return response.json()
        except Exception as error:  # noqa: BLE001 - the interview runs on a fallback plan
            logger.error("could not load interview context: %s", error)
            return None

    def add_turn(self, turn: dict[str, Any]) -> None:
        self._turns.append(turn)

    def add_event(self, event_type: str, data: dict[str, Any] | None = None, at: str | None = None) -> None:
        self._events.append({"type": event_type, "at": at or iso_now(), "data": data or {}})

    def start(self) -> None:
        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._flush_loop())

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
            await self.flush()

    async def flush(self) -> None:
        async with self._flush_lock:
            if not self._turns and not self._events:
                return
            turns, events = self._turns, self._events
            self._turns, self._events = [], []
            try:
                response = await self._client.post(
                    f"{self._base}/events", json={"turns": turns, "events": events}
                )
                response.raise_for_status()
            except Exception as error:  # noqa: BLE001
                logger.error("could not persist %d turns / %d events: %s", len(turns), len(events), error)
                # Keep them for the next attempt, ahead of anything newer.
                self._turns = turns + self._turns
                self._events = events + self._events

    async def upload_audio(self, path: Path, started_at: str) -> bool:
        """Sends the interview's two-sided audio file to the web app.

        Called once, before the completion record: the web app mixes it into
        the candidate's video when the interview ends. A failed upload costs
        the interviewer's voice in the recording, never the interview record.
        """
        try:
            body = await asyncio.to_thread(path.read_bytes)
        except OSError as error:
            logger.error("could not read interview audio: %s", error)
            return False
        try:
            await self._post_with_retries(
                f"{self._base}/audio",
                content=body,
                headers={
                    "Content-Type": "audio/ogg",
                    "X-Audio-Started-At": started_at,
                },
                timeout=AUDIO_TIMEOUT_SECONDS,
            )
            logger.info("uploaded %.1f MB of interview audio", len(body) / 1024 / 1024)
            return True
        except Exception as error:  # noqa: BLE001
            logger.error("could not upload interview audio: %s", error)
            return False

    async def upload_hr_audio(self, path: Path, started_at: str) -> bool:
        """Sends HR's own microphone track to the web app.

        Kept separate from the two-sided track: the mixer folds all three
        voices into the report recording.
        """
        try:
            body = await asyncio.to_thread(path.read_bytes)
        except OSError as error:
            logger.error("could not read HR audio: %s", error)
            return False
        try:
            await self._post_with_retries(
                f"{self._base}/audio",
                content=body,
                headers={
                    "Content-Type": "audio/wav",
                    "X-Audio-Started-At": started_at,
                    "X-Audio-Kind": "hr",
                },
                timeout=AUDIO_TIMEOUT_SECONDS,
            )
            logger.info("uploaded %.1f MB of HR audio", len(body) / 1024 / 1024)
            return True
        except Exception as error:  # noqa: BLE001
            logger.error("could not upload HR audio: %s", error)
            return False

    async def complete(self, payload: dict[str, Any]) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            self._flush_task = None
        await self.flush()
        try:
            await self._post_with_retries(f"{self._base}/complete", json=payload)
        except Exception as error:  # noqa: BLE001
            logger.error("could not record interview completion: %s", error)

    async def _post_with_retries(self, url: str, **kwargs: Any) -> httpx.Response:
        """POST, tried up to REPORT_ATTEMPTS times on network errors, 429 and 5xx.

        A 4xx other than 429 is the web app refusing the request on purpose, so
        it is not repeated. Both end-of-interview calls are safe to repeat.
        """
        for attempt in range(REPORT_ATTEMPTS):
            try:
                response = await self._client.post(url, **kwargs)
                if response.status_code != 429 and response.status_code < 500:
                    response.raise_for_status()
                    return response
                error: Exception = httpx.HTTPStatusError(
                    f"{response.status_code}", request=response.request, response=response
                )
            except httpx.HTTPStatusError:
                raise
            except Exception as caught:  # noqa: BLE001 - network trouble: retry
                error = caught
            if attempt + 1 >= REPORT_ATTEMPTS:
                raise error
            delay = REPORT_BACKOFF_SECONDS[min(attempt, len(REPORT_BACKOFF_SECONDS) - 1)]
            logger.warning("%s failed (%s), retrying in %.0f s", url.rsplit("/", 1)[-1], error, delay)
            await asyncio.sleep(delay)
        raise RuntimeError("unreachable")

    async def aclose(self) -> None:
        await self._client.aclose()
