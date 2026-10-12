"""HTTP client for the web app's agent API.

The web app owns storage; the worker reads the interview context from it and
writes turns, events and the completion record back. Writes are buffered and
never raise into the interview: losing a batch must not break a live call.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger("intervia.backend")

FLUSH_INTERVAL_SECONDS = 3.0
REQUEST_TIMEOUT_SECONDS = 15.0


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

    async def complete(self, payload: dict[str, Any]) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            self._flush_task = None
        await self.flush()
        try:
            response = await self._client.post(f"{self._base}/complete", json=payload)
            response.raise_for_status()
        except Exception as error:  # noqa: BLE001
            logger.error("could not record interview completion: %s", error)

    async def aclose(self) -> None:
        await self._client.aclose()
