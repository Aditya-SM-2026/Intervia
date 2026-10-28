"""One analysis job: download the recording, cut it, measure it, report it."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote

SEGMENT_SECONDS = 150
MAX_PARALLEL = 3
ANALYSER_TIMEOUT = 600
CALLBACK_TIMEOUT = 60

# Binaries can be overridden for local runs (the container has them on PATH).
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


def log(message: str) -> None:
    print(f"[worker] {message}", flush=True)


def download(bucket: str, path: str, target: Path) -> None:
    # Local development: serve recordings from a folder instead of GCS, so the
    # whole hand-off can be tested without cloud credentials.
    local_dir = os.environ.get("WORKER_LOCAL_RECORDINGS")
    if local_dir:
        name = Path(path).name
        candidates = [Path(local_dir) / path, Path(local_dir) / name]
        for candidate in candidates:
            if candidate.exists():
                target.write_bytes(candidate.read_bytes())
                log(f"copied {target.stat().st_size // 1024} KiB from {candidate}")
                return
        raise FileNotFoundError(f"{path} not found under {local_dir}")

    # Plain HTTPS download: the JSON media endpoint accepts the Cloud Run
    # service account's token, so the worker needs no Google client libraries
    # (which would otherwise drag protobuf 5+ in and break MediaPipe).
    log(f"downloading gs://{bucket}/{path}")
    token = access_token()
    url = (
        "https://storage.googleapis.com/storage/v1/b/"
        f"{quote(bucket, safe='')}/o/{quote(path, safe='')}?alt=media"
    )
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=300) as response, target.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    log(f"downloaded {target.stat().st_size // 1024} KiB")


def access_token() -> str:
    """An access token for GCS: explicit for local runs, metadata on Cloud Run."""
    token = (os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN") or "").strip()
    if token:
        return token
    request = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return str(json.load(response).get("access_token") or "")


def ffprobe_duration(path: Path) -> float | None:
    try:
        out = subprocess.run(
            [
                FFPROBE,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=True,
        ).stdout.strip()
        return float(out)
    except Exception as error:  # pragma: no cover - depends on the media
        log(f"ffprobe failed: {error}")
        return None


def cut_clips(source: Path, workdir: Path, duration: float | None) -> list[dict[str, Any]]:
    if duration is None:
        duration = ffprobe_duration(source)
    if not duration:
        return [{"index": 0, "offset": 0.0, "file": str(source)}]

    count = max(1, math.ceil(duration / SEGMENT_SECONDS))
    clips: list[dict[str, Any]] = []
    for index in range(count):
        offset = index * SEGMENT_SECONDS
        target = workdir / f"clip-{index:03d}.mp4"
        subprocess.run(
            [
                FFMPEG,
                "-y",
                "-loglevel",
                "error",
                "-ss",
                str(offset),
                "-t",
                str(SEGMENT_SECONDS),
                "-i",
                str(source),
                "-an",
                # Three frames a second at a higher resolution: enough samples
                # for a steady reading, and a face large enough for eye landmarks.
                "-vf",
                "fps=3,scale=1280:-2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "30",
                "-pix_fmt",
                "yuv420p",
                str(target),
            ],
            timeout=300,
            check=True,
        )
        clips.append({"index": index, "offset": float(offset), "file": str(target)})
    return clips


def schedule_for(clip: dict[str, Any], answers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Answers whose middle falls in this clip, numbered from 1 like the prompt."""
    start = clip["offset"]
    end = start + SEGMENT_SECONDS
    schedule: list[dict[str, Any]] = []
    for answer in answers:
        middle = (float(answer["start"]) + float(answer["end"])) / 2
        if middle < start or middle >= end:
            continue
        schedule.append(
            {
                "id": len(schedule) + 1,
                "turnSeq": answer.get("turnSeq"),
                "absoluteStart": float(answer["start"]),
                "absoluteEnd": float(answer["end"]),
                "questionStart": max(start, float(answer.get("questionStart", answer["start"]))) - start,
                "start": max(start, float(answer["start"])) - start,
                "end": min(end, float(answer["end"])) - start,
            }
        )
    return schedule


def parse_clock(value: str) -> float | None:
    try:
        parts = [float(part) for part in str(value).strip().split(":")]
    except ValueError:
        return None
    if len(parts) not in (2, 3):
        return None
    total = 0.0
    for part in parts:
        total = total * 60 + part
    return total


def measure(clip: dict[str, Any], schedule: list[dict[str, Any]], workdir: Path) -> dict[str, Any] | None:
    answers_file = workdir / f"answers-{clip['index']:03d}.json"
    # analyse.py only needs the clip-local schedule.
    answers_file.write_text(
        json.dumps(
            [
                {
                    "id": item["id"],
                    "questionStart": item["questionStart"],
                    "start": item["start"],
                    "end": item["end"],
                }
                for item in schedule
            ]
        ),
        encoding="utf-8",
    )
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(Path(__file__).with_name("analyse.py")),
                "--video",
                clip["file"],
                "--answers-file",
                str(answers_file),
                "--fps",
                os.environ.get("VIDEO_ANALYSIS_FPS", "3"),
            ],
            capture_output=True,
            text=True,
            timeout=ANALYSER_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        log(f"clip {clip['index']}: analyser timed out")
        return None

    stdout = (result.stdout or "").strip()
    if result.returncode != 0 or not stdout.startswith("{"):
        log(f"clip {clip['index']}: analyser exited {result.returncode}: {(result.stderr or '')[-400:]}")
        return None
    try:
        report = json.loads(stdout)
    except json.JSONDecodeError:
        log(f"clip {clip['index']}: analyser printed invalid JSON")
        return None

    by_id = {item["id"]: item for item in schedule}
    answers = []
    for item in report.get("answers", []):
        scheduled = by_id.get(item.get("id"))
        if not scheduled:
            continue
        answers.append(
            {
                "turnSeq": scheduled.get("turnSeq"),
                "start": scheduled["absoluteStart"],
                "end": scheduled["absoluteEnd"],
                "whileListening": item.get("whileListening", "unclear"),
                "whileAnswering": item.get("whileAnswering", "unclear"),
                "steady": bool(item.get("steady")),
                "reading": bool(item.get("reading")),
                "note": str(item.get("note") or "")[:300],
                "reason": str(item["reason"])[:240] if item.get("reason") else None,
                "measuredFrames": int(item.get("measuredFrames") or 0),
                "totalFrames": int(item.get("totalFrames") or 0),
            }
        )
    moments = []
    for item in report.get("moments", []):
        at = parse_clock(str(item.get("at", "")))
        if at is None:
            continue
        moments.append(
            {
                "atSeconds": clip["offset"] + at,
                "durationSeconds": float(item.get("durationSeconds") or 0),
                "kind": item.get("kind") or "other",
                "description": str(item.get("description") or "")[:400],
            }
        )
    return {
        "offset": clip["offset"],
        "faceVisible": bool(report.get("faceVisible", True)),
        "model": "local-cv (opencv + mediapipe)",
        "answers": answers,
        "moments": moments,
    }


def callback(payload: dict[str, Any]) -> None:
    base = (os.environ.get("INTERVIA_WEB_URL") or "").rstrip("/")
    secret = (os.environ.get("INTERNAL_SECRET") or "").strip()
    if not base or not secret:
        log("callback skipped: INTERVIA_WEB_URL / INTERNAL_SECRET not set")
        return
    url = f"{base}/api/internal/video-result"
    body = json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None
    for attempt in range(1, 4):
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "x-internal-secret": secret},
        )
        try:
            with urllib.request.urlopen(request, timeout=CALLBACK_TIMEOUT) as response:
                log(f"callback ok ({response.status})")
                return
        except urllib.error.HTTPError as error:
            last_error = error
            log(f"callback failed ({error.code}), attempt {attempt}")
        except Exception as error:  # network trouble: retry
            last_error = error
            log(f"callback failed ({error}), attempt {attempt}")
    log(f"callback gave up: {last_error}")


def run_job(payload: dict[str, Any]) -> None:
    room_id = str(payload.get("roomId") or "")
    recording = payload.get("recording") or {}
    answers = payload.get("answers") or []
    log(f"job for room {room_id}")

    with tempfile.TemporaryDirectory(prefix="intervia-worker-") as tmp:
        workdir = Path(tmp)
        source = workdir / "source"
        try:
            download(str(recording.get("bucket")), str(recording.get("path")), source)
        except Exception as error:
            callback(
                {
                    "roomId": room_id,
                    "status": "failed",
                    "reason": f"The worker could not read the recording: {error}",
                    "job": payload,
                }
            )
            return

        duration = ffprobe_duration(source)
        try:
            clips = cut_clips(source, workdir, duration)
        except Exception as error:
            callback(
                {
                    "roomId": room_id,
                    "status": "failed",
                    "reason": f"The recording could not be prepared for analysis: {error}",
                    "job": payload,
                }
            )
            return

        schedules = [schedule_for(clip, answers) for clip in clips]
        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
            results = list(pool.map(lambda pair: measure(pair[0], pair[1], workdir), zip(clips, schedules)))

        segments = [item for item in results if item]
        if not segments:
            callback(
                {
                    "roomId": room_id,
                    "status": "failed",
                    "reason": "The video analysis did not complete. Regenerate to try again.",
                    "job": payload,
                }
            )
            return

        callback(
            {
                "roomId": room_id,
                "status": "analysed",
                "durationSeconds": duration,
                "totalSegments": len(clips),
                "segments": segments,
                "job": {
                    "hiddenCount": payload.get("hiddenCount", 0),
                    "hiddenSeconds": payload.get("hiddenSeconds", 0),
                },
            }
        )
