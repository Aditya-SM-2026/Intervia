"""Video analysis worker for Intervia.

Receives one job from the web app (which recording, which answer windows),
measures on-camera gaze with OpenCV + MediaPipe, and posts the result back to
the web app. It never talks to the database: the web app stays the only
writer, which keeps the schema in one place.

    POST /analyse   { roomId, recording, startedAt, answers, hiddenCount, hiddenSeconds }
    GET  /healthz
"""

from __future__ import annotations

import os
import threading
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException

from pipeline import run_job

app = FastAPI(title="Intervia video analysis worker")


def _secret_ok(provided: str | None) -> bool:
    expected = (os.environ.get("INTERNAL_SECRET") or "").strip()
    return bool(expected) and provided == expected


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/analyse", status_code=202)
def analyse(
    payload: dict[str, Any],
    background: BackgroundTasks,
    x_internal_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    if not _secret_ok(x_internal_secret):
        raise HTTPException(status_code=401, detail="Not allowed.")

    room_id = str(payload.get("roomId") or "").strip()
    recording = payload.get("recording") or {}
    if not room_id or not recording.get("bucket") or not recording.get("path"):
        raise HTTPException(status_code=400, detail="roomId and recording are required.")

    # Answer right away: Cloud Tasks treats a 2xx as delivered, and the work
    # itself can take a minute on a cold container.
    background.add_task(run_job, payload)
    return {"ok": True, "queued": True, "roomId": room_id}


@app.post("/analyse-sync")
def analyse_sync(
    payload: dict[str, Any],
    x_internal_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    """Same work, but waits. Used for local testing and diagnostics."""
    if not _secret_ok(x_internal_secret):
        raise HTTPException(status_code=401, detail="Not allowed.")
    run_job(payload)
    return {"ok": True}


def run_standalone(payload: dict[str, Any]) -> None:
    """Entry point for Cloud Run jobs and one-off CLI runs."""
    run_job(payload)


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--job":
        with open(sys.argv[2], "r", encoding="utf-8") as handle:
            run_standalone(json.load(handle))
    else:
        import uvicorn

        uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
