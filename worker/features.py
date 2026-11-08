"""
Interview-wide video features for the v2 integrity analysis.

Takes the per-frame measurements of every clip (measure_video.py) and the
audio envelope (audio.py) and works out, per answer:

1. Where the screen is for this person. While the interviewer speaks the
   candidate looks at the interview window, so the median gaze of those
   frames is "the screen" for this face, camera and laptop. Everything else
   is measured against it. This replaces the old rule that "centre" meant
   looking into the camera, which marked every honest laptop user as
   looking down.
2. A fixed spot off the screen. Off-screen gaze points from all answers are
   clustered (DBSCAN). A tight cluster that answer after answer returns to,
   and that the candidate does not use while listening, is the look of a
   phone, a second monitor or notes. Gaze that wanders to different places is
   thinking, which everyone does, and is not counted.
3. Line-by-line reading: slow drift one way, then a quick jump back, again
   and again, in the 15 fps gaze track.
4. Lip-sync: whether mouth opening rises and falls with the voice.
5. Second faces and phones, from the once-a-second samples.
6. Picture quality per answer, so the report can say when a dim or soft
   webcam limited what could be checked.

It does not decide anything about the candidate. The web app turns these
numbers into findings and an integrity level.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

T, ROLE, FACE, GX, VY, MAR, OPEN, FACEPX, LUM, ENH = range(10)

# Eyes closed or mid-blink below this openness: gaze unreadable.
MIN_OPEN = 0.03
# Spread floor, so a very steady listener does not make tiny moves look far.
MIN_SPREAD = 0.06
# How far (in spreads) from the screen centre a point counts as off the screen.
OFF_SCREEN_Z = 3.0
# The first seconds of an answer are where people look away to think.
THINKING_SECONDS = 2.0
# An answer "holds" a spot when this share of its (post-thinking) frames is in it.
HOLD_SHARE = 0.30
MIN_ANSWER_FRAMES = 15


def _usable(frame: list) -> bool:
    return bool(frame[FACE]) and frame[OPEN] >= MIN_OPEN


def baseline(frames: list[list]) -> dict[str, Any]:
    listening = [f for f in frames if f[ROLE] == "l" and _usable(f)]
    source = "listening"
    if len(listening) < 30:
        # Too little listening footage: most people look at the screen most of the time.
        listening = [f for f in frames if _usable(f)]
        source = "all"
    if not listening:
        return {"x": 0.0, "y": 0.0, "sx": MIN_SPREAD, "sy": MIN_SPREAD, "frames": 0, "source": "none"}
    xs = np.array([f[GX] for f in listening])
    ys = np.array([f[VY] for f in listening])
    cx, cy = float(np.median(xs)), float(np.median(ys))
    sx = max(MIN_SPREAD, 1.4826 * float(np.median(np.abs(xs - cx))))
    sy = max(MIN_SPREAD, 1.4826 * float(np.median(np.abs(ys - cy))))
    return {"x": cx, "y": cy, "sx": sx, "sy": sy, "frames": len(listening), "source": source}


def _z(frame: list, base: dict[str, Any]) -> tuple[float, float]:
    return (frame[GX] - base["x"]) / base["sx"], (frame[VY] - base["y"]) / base["sy"]


def direction_words(dx: float, dy: float) -> str:
    """Where a spot is, relative to the candidate's own screen position."""
    horizontal = "" if abs(dx) < 0.5 * max(abs(dy), 1e-6) else ("left" if dx < 0 else "right")
    vertical = "" if abs(dy) < 0.5 * max(abs(dx), 1e-6) else ("below" if dy > 0 else "above")
    if vertical and horizontal:
        return f"{vertical} and to the {horizontal} of the screen (as seen in the picture)"
    if vertical:
        return f"{vertical} the screen"
    return f"to the {horizontal} of the screen (as seen in the picture)"


def find_spots(answer_frames: dict[int, list[list]], listen_frames: list[list], base: dict[str, Any]) -> list[dict[str, Any]]:
    """Tight off-screen clusters in answer-time gaze, with which answers hold them."""
    from sklearn.cluster import DBSCAN

    points, owners = [], []
    for seq, frames in answer_frames.items():
        start = frames[0][T] if frames else 0
        for f in frames:
            zx, zy = _z(f, base)
            if math.hypot(zx, zy) > OFF_SCREEN_Z:
                points.append((f[GX], f[VY]))
                owners.append((seq, f[T] - start >= THINKING_SECONDS))
    if len(points) < 20:
        return []
    data = np.array(points)
    eps = max(0.06, 1.2 * (base["sx"] + base["sy"]) / 2)
    labels = DBSCAN(eps=eps, min_samples=max(10, len(points) // 100)).fit_predict(data)
    spots = []
    for label in sorted(set(labels) - {-1}):
        members = np.where(labels == label)[0]
        centre = data[members].mean(axis=0)
        spread = float(np.sqrt(((data[members] - centre) ** 2).sum(axis=1)).mean())
        per_answer: dict[int, int] = {}
        for i in members:
            seq, after_thinking = owners[i]
            if after_thinking:
                per_answer[seq] = per_answer.get(seq, 0) + 1
        held = []
        for seq, count in per_answer.items():
            measured = sum(
                1 for f in answer_frames[seq] if f[T] - answer_frames[seq][0][T] >= THINKING_SECONDS
            )
            if measured >= MIN_ANSWER_FRAMES and count / measured >= HOLD_SHARE:
                held.append(seq)
        near = sum(1 for f in listen_frames if math.hypot(f[GX] - centre[0], f[VY] - centre[1]) <= eps * 1.5)
        dx = (centre[0] - base["x"]) / base["sx"]
        dy = (centre[1] - base["y"]) / base["sy"]
        spots.append({
            "id": int(label),
            "x": round(float(centre[0]), 4),
            "y": round(float(centre[1]), 4),
            "distance": round(math.hypot(dx, dy), 2),
            "tightness": round(spread, 4),
            "where": direction_words(dx, dy),
            "heldAnswers": sorted(held),
            "listeningShare": round(near / max(1, len(listen_frames)), 3),
            "frames": int(len(members)),
        })
    spots.sort(key=lambda spot: (-len(spot["heldAnswers"]), -spot["frames"]))
    return spots[:3]


def reading_sweeps(frames: list[list], base: dict[str, Any], fps: float) -> dict[str, Any]:
    """Return sweeps of line-by-line reading in one answer's gaze track.

    A sweep is a quick horizontal jump (within about 0.3 s) after at least a
    second of slower drift the other way, i.e. the eyes reaching the end of a
    line and jumping back to the start of the next. Only consecutive frames
    are used; gaps from blinks or a lost face break the track.
    """
    if len(frames) < fps * 6:
        return {"sweeps": 0, "perMinute": 0.0, "direction": None}
    xs = np.array([f[GX] for f in frames])
    ts = np.array([f[T] for f in frames])
    # Light smoothing against landmark jitter.
    if len(xs) >= 5:
        kernel = np.ones(3) / 3
        xs = np.convolve(xs, kernel, mode="same")
    jump = max(0.12, 2.5 * base["sx"])
    max_jump_frames = max(2, int(round(0.3 * fps)))
    sweeps = {1: 0, -1: 0}
    i = int(fps)  # leave room for the drift before the first jump
    last_sweep_t = -10.0
    while i < len(xs) - max_jump_frames:
        if ts[i + max_jump_frames] - ts[i] > 0.5:  # broken track
            i += 1
            continue
        delta = xs[i + max_jump_frames] - xs[i]
        if abs(delta) >= jump and ts[i] - last_sweep_t >= 1.0:
            sign = 1 if delta > 0 else -1
            # Slow drift the other way over the previous 1-5 s.
            lo = np.searchsorted(ts, ts[i] - 5.0)
            hi = np.searchsorted(ts, ts[i] - 1.0)
            if hi > lo + fps * 0.5:
                drift = xs[i] - xs[lo]
                steps = np.diff(xs[lo : i + 1])
                steady = np.mean(np.sign(steps) == -sign) >= 0.5 if len(steps) else False
                if drift * sign < 0 and abs(drift) >= 0.5 * jump and steady:
                    sweeps[sign] += 1
                    last_sweep_t = ts[i]
                    i += max_jump_frames
                    continue
        i += 1
    main = 1 if sweeps[1] >= sweeps[-1] else -1
    count = sweeps[main]
    minutes = max(1e-6, (ts[-1] - ts[0]) / 60)
    return {"sweeps": int(count), "perMinute": round(count / minutes, 1), "direction": main}


def lip_sync(frames: list[list], env: np.ndarray, hop: float) -> dict[str, Any]:
    """Correlation between mouth opening and voice loudness during one answer."""
    faced = [f for f in frames if f[FACE] and f[FACEPX] >= 70]
    if len(faced) < 60 or len(env) == 0:
        return {"correlation": None, "lag": None, "voicedFrames": 0}
    ts = np.array([f[T] for f in faced])
    mar = np.array([f[MAR] for f in faced])
    best, best_lag = -2.0, 0.0
    floor = float(np.percentile(env, 30)) if len(env) else 0.0
    voiced_count = 0
    for step in range(-4, 5):
        lag = step / 15
        index = np.clip(((ts + lag) / hop).astype(int), 0, len(env) - 1)
        loud = env[index]
        voiced = loud > floor * 1.5
        if step == 0:
            voiced_count = int(voiced.sum())
        if loud.std() < 1e-9 or mar.std() < 1e-6:
            continue
        r = float(np.corrcoef(mar, loud)[0, 1])
        if math.isfinite(r) and r > best:
            best, best_lag = r, float(lag)
    if best == -2.0:
        return {"correlation": None, "lag": None, "voicedFrames": voiced_count}
    return {"correlation": round(best, 3), "lag": round(best_lag, 3), "voicedFrames": voiced_count}


def quality(frames: list[list], samples: list[list]) -> dict[str, Any]:
    if not frames:
        return {"brightness": None, "facePx": None, "sharpness": None, "measurable": 0.0, "enhanced": 0.0}
    usable = [f for f in frames if _usable(f)]
    faced = [f for f in frames if f[FACE]]
    sharp = [s[4] for s in samples if s[4] is not None]
    return {
        "brightness": round(float(np.mean([f[LUM] for f in frames])), 1),
        "facePx": round(float(np.median([f[FACEPX] for f in faced])), 1) if faced else None,
        "sharpness": round(float(np.median(sharp)), 1) if sharp else None,
        "measurable": round(len(usable) / len(frames), 3),
        "enhanced": round(sum(1 for f in frames if f[ENH]) / len(frames), 3),
    }


def build(
    answers: list[dict[str, Any]],
    frames: list[list],
    samples: list[list],
    fps: float,
    env: np.ndarray | None,
    hop: float,
) -> dict[str, Any]:
    frames.sort(key=lambda f: f[T])
    samples.sort(key=lambda s: s[0])
    base = baseline(frames)
    listen = [f for f in frames if f[ROLE] == "l" and _usable(f)]

    per_answer_frames: dict[int, list[list]] = {}
    per_answer_all: dict[int, list[list]] = {}
    for answer in answers:
        seq = int(answer["turnSeq"])
        start, end = float(answer["start"]), float(answer["end"])
        inside = [f for f in frames if start <= f[T] < end and f[ROLE] == "a"]
        per_answer_all[seq] = inside
        per_answer_frames[seq] = [f for f in inside if _usable(f)]

    spots = find_spots(per_answer_frames, listen, base) if base["frames"] else []
    main_spot = spots[0] if spots else None

    out_answers = []
    for answer in answers:
        seq = int(answer["turnSeq"])
        start, end = float(answer["start"]), float(answer["end"])
        usable = per_answer_frames[seq]
        everything = per_answer_all[seq]
        inside_samples = [s for s in samples if start <= s[0] < end]
        pause = [
            f for f in frames if f[ROLE] == "p" and start - 6 <= f[T] < start and _usable(f)
        ]
        item: dict[str, Any] = {
            "turnSeq": seq,
            "start": start,
            "end": end,
            "measuredFrames": len(usable),
            "totalFrames": len(everything),
            "quality": quality(everything, inside_samples),
        }
        if len(usable) >= MIN_ANSWER_FRAMES:
            z = [_z(f, base) for f in usable]
            on = sum(1 for zx, zy in z if math.hypot(zx, zy) <= OFF_SCREEN_Z)
            item["atScreenShare"] = round(on / len(usable), 3)
            mzx = float(np.median([p[0] for p in z]))
            mzy = float(np.median([p[1] for p in z]))
            item["medianOffset"] = [round(mzx, 2), round(mzy, 2)]
            item["reading"] = reading_sweeps(usable, base, fps)
            if main_spot is not None:
                after = [f for f in usable if f[T] - start >= THINKING_SECONDS]
                eps = max(0.06, 1.2 * (base["sx"] + base["sy"]) / 2)
                in_spot = [f for f in after if math.hypot(f[GX] - main_spot["x"], f[VY] - main_spot["y"]) <= eps * 1.5]
                item["spotShare"] = round(len(in_spot) / max(1, len(after)), 3)
                first = next(
                    (f[T] - start for f in usable if math.hypot(f[GX] - main_spot["x"], f[VY] - main_spot["y"]) <= eps * 1.5),
                    None,
                )
                item["spotOnset"] = None if first is None else round(first, 2)
            # Thinking looks wander; count distinct off-screen directions.
            off = [(zx, zy) for zx, zy in z if math.hypot(zx, zy) > OFF_SCREEN_Z]
            sectors = {int(((math.degrees(math.atan2(zy, zx)) + 360) % 360) // 45) for zx, zy in off}
            item["offScreenDirections"] = len(sectors)
        else:
            item["atScreenShare"] = None
            item["reason"] = _unreadable_reason(everything, end - start)
        if pause:
            zp = [_z(f, base) for f in pause]
            item["pauseOffScreenShare"] = round(
                sum(1 for zx, zy in zp if math.hypot(zx, zy) > OFF_SCREEN_Z) / len(zp), 3
            )
        if env is not None:
            item["lipSync"] = lip_sync(everything, env, hop)
        faces = [s[1] for s in inside_samples]
        phones = [s[2] for s in inside_samples if s[2] is not None]
        persons = [s[3] for s in inside_samples if s[3] is not None]
        item["multiFaceSeconds"] = int(sum(1 for count in faces if count >= 2))
        item["phoneSeconds"] = None if not phones and inside_samples else int(sum(1 for p in phones if p >= 0.45))
        item["extraPersonSeconds"] = None if not persons and inside_samples else int(sum(1 for p in persons if p >= 2))
        item["sampledSeconds"] = len(inside_samples)
        out_answers.append(item)

    # Stretches with no face at all, anywhere in the interview.
    absences = []
    run_start = None
    last_t = None
    for f in frames:
        if not f[FACE]:
            if run_start is None:
                run_start = f[T]
        elif run_start is not None:
            if f[T] - run_start >= 5.0:
                absences.append({"atSeconds": round(run_start, 1), "durationSeconds": round(f[T] - run_start, 1)})
            run_start = None
        last_t = f[T]
    if run_start is not None and last_t is not None and last_t - run_start >= 5.0:
        absences.append({"atSeconds": round(run_start, 1), "durationSeconds": round(last_t - run_start, 1)})

    return {
        "version": 2,
        "fps": fps,
        "baseline": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in base.items()},
        "spots": spots,
        "answers": out_answers,
        "absences": absences,
        "quality": quality(frames, samples),
        "faceSeen": any(f[FACE] for f in frames),
    }


def _unreadable_reason(frames: list[list], duration: float) -> str:
    if duration < 1.0:
        return "The candidate barely spoke here, so there was nothing to measure."
    if not frames:
        return "There is no picture at this point in the recording."
    faced = [f for f in frames if f[FACE]]
    if not faced:
        return "The candidate was not in the picture during this answer."
    if sum(1 for f in faced if f[LUM] < 45) >= 0.6 * len(faced):
        return "The picture was too dark to make out the eyes, even after brightening."
    if sum(1 for f in faced if f[OPEN] < MIN_OPEN) >= 0.6 * len(faced):
        return "The eyes were closed or hidden (glasses glare, angle) for most of this answer."
    if sum(1 for f in faced if f[FACEPX] < 80) >= 0.6 * len(faced):
        return "The face was too small in the picture to read the eyes."
    return "Too few clear frames to judge this answer."
