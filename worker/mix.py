"""One mixing job: fold the interviewer's (and HR's) voice into the candidate's video.

The web app decides everything about the mix (which files, how each voice is
shifted onto the video's clock, the audio filter) and sends it here, so the
heavy part (downloading the video and re-encoding the audio) runs on this
worker instead of the website. The video stream is copied, not re-encoded.

    POST /mix  { roomId, inputs: {video, audio, hr?}, filters: [primary, fallback],
                 container, output: {bucket, path}, mimeType, startedAt, recordingId }
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote

from pipeline import FFMPEG, access_token, download, log, post_to_web

MIX_TIMEOUT_SECONDS = 900
SAFE_OBJECT = re.compile(r"^[A-Za-z0-9._/\-]{1,512}$")
SAFE_BUCKET = re.compile(r"^[a-z0-9._\-]{3,222}$")


class MixError(Exception):
    pass


def _object(value: Any, label: str) -> tuple[str, str]:
    if not isinstance(value, dict):
        raise MixError(f"{label} is missing")
    bucket, path = str(value.get("bucket") or ""), str(value.get("path") or "")
    if not SAFE_BUCKET.match(bucket) or not SAFE_OBJECT.match(path) or ".." in path:
        raise MixError(f"{label} is not a valid storage object")
    return bucket, path


def _ffmpeg_args(video: Path, audio: Path, hr: Path | None, output: Path, filter_graph: str, container: str) -> list[str]:
    return [
        FFMPEG, "-y", "-i", str(video), "-i", str(audio),
        *(["-i", str(hr)] if hr else []),
        "-filter_complex", filter_graph,
        "-map", "0:v", "-map", "[mixed]",
        "-c:v", "copy",
        "-c:a", "aac" if container == "mp4" else "libopus",
        "-b:a", "96k", "-ar", "48000",
        *(["-movflags", "+faststart"] if container == "mp4" else []),
        "-shortest", str(output),
    ]


def _upload(bucket: str, path: str, source: Path, mime_type: str) -> None:
    url = (
        "https://storage.googleapis.com/upload/storage/v1/b/"
        f"{quote(bucket, safe='')}/o?uploadType=media&name={quote(path, safe='')}"
    )
    with source.open("rb") as handle:
        request = urllib.request.Request(
            url,
            data=handle,
            method="POST",
            headers={
                "Authorization": f"Bearer {access_token()}",
                "Content-Type": mime_type,
                "Content-Length": str(source.stat().st_size),
            },
        )
        with urllib.request.urlopen(request, timeout=600) as response:
            if response.status >= 300:
                raise MixError(f"upload failed ({response.status})")
    log(f"uploaded gs://{bucket}/{path} ({source.stat().st_size // 1024} KiB)")


def run_mix(payload: dict[str, Any]) -> None:
    """Builds, stores and reports one mix. Raises on failure, so the queue retries."""
    room_id = str(payload.get("roomId") or "")
    if not re.match(r"^[A-Za-z0-9_\-]{1,120}$", room_id):
        raise MixError("roomId is invalid")
    inputs = payload.get("inputs") or {}
    video_obj = _object(inputs.get("video"), "video")
    audio_obj = _object(inputs.get("audio"), "audio")
    hr_obj = _object(inputs.get("hr"), "hr") if inputs.get("hr") else None
    out_bucket, out_path = _object(payload.get("output"), "output")
    container = str(payload.get("container") or "")
    if container not in ("mp4", "webm"):
        raise MixError("container must be mp4 or webm")
    filters = [f for f in (payload.get("filters") or []) if isinstance(f, str) and f]
    if not filters:
        raise MixError("no audio filter given")
    mime_type = "video/mp4" if container == "mp4" else "video/webm"

    started = time.time()
    log(f"mix for room {room_id}")
    with tempfile.TemporaryDirectory(prefix="intervia-mix-") as tmp:
        work = Path(tmp)
        video = work / f"candidate.{container}"
        audio = work / "agent-audio.ogg"
        hr = work / "hr-audio.wav" if hr_obj else None
        download(*video_obj, video)
        download(*audio_obj, audio)
        if hr_obj and hr:
            download(*hr_obj, hr)
        output = work / f"mixed.{container}"

        last_error = ""
        for filter_graph in filters:
            result = subprocess.run(
                _ffmpeg_args(video, audio, hr, output, filter_graph, container),
                capture_output=True,
                text=True,
                timeout=MIX_TIMEOUT_SECONDS,
            )
            if result.returncode == 0 and output.exists() and output.stat().st_size > 0:
                break
            last_error = result.stderr[-400:]
            log(f"mix attempt failed, trying the next filter: {last_error[-200:]}")
        else:
            raise MixError(f"ffmpeg could not mix: {last_error}")

        _upload(out_bucket, out_path, output, mime_type)

    accepted = post_to_web(
        "/api/internal/mix-result",
        {
            "roomId": room_id,
            "bucket": out_bucket,
            "path": out_path,
            "mimeType": mime_type,
            "recordingId": str(payload.get("recordingId") or f"mixed-{room_id}"),
            "startedAt": str(payload.get("startedAt") or ""),
        },
    )
    if not accepted:
        raise MixError("the web app did not accept the mix result")
    log(f"mix for room {room_id} done in {time.time() - started:.1f}s")
