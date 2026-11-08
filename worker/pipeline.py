"""One analysis job: download the recording, cut it, measure it, report it."""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote

import audio
import features

SEGMENT_SECONDS = 150
MAX_PARALLEL = int(os.environ.get("VIDEO_PARALLEL", "2"))
ANALYSER_TIMEOUT = 1200
# The web app writes the integrity summary while this request waits.
CALLBACK_TIMEOUT = 180
PHONE_MODEL = os.environ.get("PHONE_MODEL", "/models/yolox_nano.onnx")

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
                # Native frame rate (reading sweeps and lip movement need every
                # frame) with a light temporal denoise, which cleans up the
                # grain of dim webcam footage before landmarking.
                "-vf",
                "hqdn3d=1.5:1.5:4:4",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                str(target),
            ],
            timeout=300,
            check=True,
        )
        clips.append({"index": index, "offset": float(offset), "file": str(target)})
    return clips


def measure_clip(clip: dict[str, Any], answers: list[dict[str, Any]], workdir: Path) -> dict[str, Any] | None:
    """Per-frame measurements of one clip (measure_video.py), on the recording clock."""
    windows_file = workdir / f"windows-{clip['index']:03d}.json"
    windows_file.write_text(
        json.dumps(
            [
                {
                    "turnSeq": item.get("turnSeq"),
                    "questionStart": float(item.get("questionStart", item["start"])),
                    "questionEnd": None if item.get("questionEnd") is None else float(item["questionEnd"]),
                    "start": float(item["start"]),
                    "end": float(item["end"]),
                }
                for item in answers
            ]
        ),
        encoding="utf-8",
    )
    command = [
        sys.executable,
        str(Path(__file__).with_name("measure_video.py")),
        "--video",
        clip["file"],
        "--windows-file",
        str(windows_file),
        "--offset",
        str(clip["offset"]),
    ]
    if os.path.exists(PHONE_MODEL):
        command += ["--phone-model", PHONE_MODEL]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=ANALYSER_TIMEOUT)
    except subprocess.TimeoutExpired:
        log(f"clip {clip['index']}: measurement timed out")
        return None
    stdout = (result.stdout or "").strip()
    if result.returncode != 0 or not stdout.startswith("{"):
        log(f"clip {clip['index']}: measurement exited {result.returncode}: {(result.stderr or '')[-400:]}")
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        log(f"clip {clip['index']}: invalid JSON")
        return None


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
    log(f"job for room {room_id}: {len(answers)} answers")
    started = time.time()

    def fail(reason: str) -> None:
        callback({"roomId": room_id, "status": "failed", "reason": reason, "job": payload})

    with tempfile.TemporaryDirectory(prefix="intervia-worker-") as tmp:
        workdir = Path(tmp)
        source = workdir / "source"
        try:
            download(str(recording.get("bucket")), str(recording.get("path")), source)
        except Exception as error:
            fail(f"The worker could not read the recording: {error}")
            return

        duration = ffprobe_duration(source)
        try:
            clips = cut_clips(source, workdir, duration)
        except Exception as error:
            fail(f"The recording could not be prepared for analysis: {error}")
            return
        log(f"cut {len(clips)} clips in {time.time() - started:.0f}s")

        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
            measured = list(pool.map(lambda clip: measure_clip(clip, answers, workdir), clips))
        done = [item for item in measured if item]
        log(f"measured {len(done)}/{len(clips)} clips in {time.time() - started:.0f}s")
        if not done:
            fail("The video analysis did not complete. Regenerate to try again.")
            return

        frames: list[list] = []
        samples: list[list] = []
        for item in done:
            frames.extend(item.get("frames") or [])
            samples.extend(item.get("samples") or [])
        fps = float(done[0].get("fps") or 15.0)

        audio_result: dict[str, Any] = {"answers": {}, "transcriber": False, "voice": False}
        env = None
        hop = 1 / 30
        wav = audio.load_wav(str(source))
        if wav is not None:
            env, hop = audio.envelope(wav)
            try:
                audio_result = audio.analyse_answers(wav, answers)
            except Exception as error:  # audio is a bonus; never lose the video result
                log(f"audio analysis failed: {error}")
        log(f"audio done in {time.time() - started:.0f}s")

        analysis = features.build(answers, frames, samples, fps, env, hop)
        for item in analysis["answers"]:
            extra = audio_result["answers"].get(int(item["turnSeq"])) or {}
            item["delivery"] = extra.get("delivery")
            item["voiceSimilarity"] = extra.get("voiceSimilarity")
        analysis["checks"] = {
            "audio": wav is not None,
            "transcriber": bool(audio_result.get("transcriber")),
            "voice": bool(audio_result.get("voice")),
            "phone": os.path.exists(PHONE_MODEL),
        }
        analysis["partial"] = len(done) < len(clips)
        analysis["processingSeconds"] = round(time.time() - started)
        log(f"job for room {room_id} finished in {analysis['processingSeconds']}s")

        callback(
            {
                "roomId": room_id,
                "status": "analysed",
                "durationSeconds": duration,
                "totalSegments": len(clips),
                "segments": [],
                "analysis": analysis,
                "job": {
                    "hiddenCount": payload.get("hiddenCount", 0),
                    "hiddenSeconds": payload.get("hiddenSeconds", 0),
                },
            }
        )
