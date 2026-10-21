"""
Local on-camera gaze analysis for Intervia interview recordings.

Replaces the per-clip vision-LLM call in
src/lib/interviews/video-analysis.service.ts with a fully local pipeline:

  OpenCV reads sampled frames -> MediaPipe Face Mesh (with iris refinement)
  -> head pose via solvePnP + iris offset inside each eye
  -> a direction per frame (the same 10 directions the report uses)
  -> majority direction per answer window, plus moments worth watching.

It is told where each question and answer happens (the same schedule the
LLM prompt gets) and emits the same JSON shape the service parses, so the
scoring code downstream does not change.

Usage:
  python analyse.py --video clip.mp4 --answers '[{"id":1,...}]' [--fps 2]

Answers are clip-local: `questionStart`, `start` and `end` are seconds from
the start of THIS clip. Output is a single JSON object:
  { faceVisible, answers: [{id, whileListening, whileAnswering, steady,
     reading, note}], moments: [{at, durationSeconds, kind, description}] }
where `at` is "mm:ss" from the start of the clip.
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import cv2
import numpy as np

try:
    import mediapipe as mp
except Exception as error:  # pragma: no cover - environment without mediapipe
    print(json.dumps({"error": f"mediapipe unavailable: {error}"}))
    sys.exit(2)

# Face Mesh landmark indices (478 points, refine_landmarks=True).
NOSE_TIP = 1
CHIN = 152
LEFT_EYE_OUTER = 33
LEFT_EYE_INNER = 133
RIGHT_EYE_INNER = 362
RIGHT_EYE_OUTER = 263
LEFT_MOUTH = 61
RIGHT_MOUTH = 291
LEFT_IRIS = 468
RIGHT_IRIS = 473
# Eye-opening pairs for a blink / closed-eyes check.
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 159, 145
RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = 386, 374

# Generic 3D face model (nose tip, chin, eye corners, mouth corners), used
# with solvePnP against the corresponding 2D landmarks.
MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, -330.0, -65.0),
        (-225.0, 170.0, -135.0),
        (225.0, 170.0, -135.0),
        (-150.0, -150.0, -125.0),
        (150.0, -150.0, -125.0),
    ],
    dtype=np.float64,
)
MODEL_LANDMARKS = [NOSE_TIP, CHIN, LEFT_EYE_OUTER, RIGHT_EYE_OUTER, LEFT_MOUTH, RIGHT_MOUTH]

DIRECTIONS = [
    "centre", "left", "right", "up", "down",
    "up_left", "up_right", "down_left", "down_right", "unclear",
]

# Direction thresholds on the combined gaze score. gx is horizontal
# (negative = the viewer's left), vy vertical (positive = down), both roughly
# in -1..1. Centre means looking at the screen around the camera.
CENTRE = 0.25
# Iris offset inside the eye, in eye-width units: this is what actually
# tracks the eyeball when the head stays still. Head pose fills in when the
# whole head turns.
IRIS_SCALE = 0.2
YAW_SCALE = 25.0   # degrees of yaw that counts as a full horizontal look-away
PITCH_SCALE = 20.0
IRIS_WEIGHT = 0.65
HEAD_WEIGHT = 0.35

# A frame stretch with no detectable face longer than this becomes a moment.
NO_FACE_MOMENT_SECONDS = 5.0
# An answer is judged only if enough frames inside it could be read.
MIN_ANSWER_FRAMES = 3


def eye_metrics(shape, outer, inner, iris) -> tuple[float, float]:
    """Iris offset in eye-width units: (horizontal, vertical)."""
    ox, oy = shape[outer].x, shape[outer].y
    ix, iy = shape[inner].x, shape[inner].y
    cx, cy = shape[iris].x, shape[iris].y
    width = max(1e-6, abs(ix - ox))
    return ((cx - (ox + ix) / 2) / width, (cy - (oy + iy) / 2) / width)


def eye_open(shape, top, bottom, outer, inner) -> float:
    opening = abs(shape[top].y - shape[bottom].y)
    width = max(1e-6, abs(shape[inner].x - shape[outer].x))
    return opening / width


def head_angles(shape, size) -> tuple[float, float]:
    """(yaw, pitch) in degrees. yaw>0 = looking to the viewer's right,
    pitch>0 = looking down in the picture."""
    points = np.array([(shape[i].x * size[0], shape[i].y * size[1]) for i in MODEL_LANDMARKS],
                      dtype=np.float64)
    ok, rvec, _ = cv2.solvePnP(
        MODEL_POINTS, points,
        np.array([[size[0], 0, size[0] / 2], [0, size[0], size[1] / 2], [0, 0, 1]],
                 dtype=np.float64),
        np.zeros((4, 1)),
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        return 0.0, 0.0
    rot, _ = cv2.Rodrigues(rvec)
    yaw = math.degrees(math.atan2(-rot[0][2], math.hypot(rot[1][2], rot[2][2])))
    pitch = -math.degrees(math.atan2(rot[1][2], rot[2][2]))
    return yaw, pitch


def classify(gx: float, vy: float) -> str:
    horizontal = "centre" if abs(gx) < CENTRE else ("right" if gx > 0 else "left")
    vertical = "centre" if abs(vy) < CENTRE else ("down" if vy > 0 else "up")
    if horizontal == "centre" and vertical == "centre":
        return "centre"
    if horizontal == "centre":
        return vertical
    if vertical == "centre":
        return horizontal
    return f"{vertical}_{horizontal}"


def clock(seconds: float) -> str:
    whole = max(0, int(round(seconds)))
    return f"{whole // 60}:{whole % 60:02d}"


def mode_directions(directions: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in directions:
        counts[item] = counts.get(item, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def looks_like_reading(sequence: list[str], vertical: list[float]) -> bool:
    """Small steady left/right sweeps, line by line: several horizontal
    direction changes while the eyes stay near the screen's height."""
    horizontal = [d if d in ("left", "right") else None for d in sequence]
    changes = 0
    last = None
    for item in horizontal:
        if item is None or item == last:
            continue
        if last is not None:
            changes += 1
        last = item
    low_vertical = bool(vertical) and float(np.mean(np.abs(vertical))) < 0.35
    return changes >= 4 and low_vertical


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--answers", default="[]")
    parser.add_argument("--answers-file")
    parser.add_argument("--fps", type=float, default=2.0)
    args = parser.parse_args()

    if args.answers_file:
        with open(args.answers_file, encoding="utf-8") as handle:
            schedule = json.load(handle)
    else:
        schedule = json.loads(args.answers) if args.answers.strip() else []

    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        print(json.dumps({"error": "video could not be opened"}))
        sys.exit(2)

    source_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(source_fps / max(0.2, args.fps))))
    size = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))

    mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    frames: list[dict] = []  # {t, direction, gx, vy, face}
    index = 0
    total_frames = 0
    faced_frames = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % step == 0:
            t = index / source_fps
            result = mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            shape = None
            if result.multi_face_landmarks:
                shape = result.multi_face_landmarks[0].landmark
            if shape is None or len(shape) < 478:
                frames.append({"t": t, "direction": "unclear", "gx": 0.0, "vy": 0.0, "face": False})
            else:
                total_frames += 1
                iris_left = eye_metrics(shape, LEFT_EYE_OUTER, LEFT_EYE_INNER, LEFT_IRIS)
                iris_right = eye_metrics(shape, RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_IRIS)
                iris_x = (iris_left[0] + iris_right[0]) / 2
                iris_y = (iris_left[1] + iris_right[1]) / 2
                yaw, pitch = head_angles(shape, size)
                gx = IRIS_WEIGHT * (iris_x / IRIS_SCALE) + HEAD_WEIGHT * (yaw / YAW_SCALE)
                vy = IRIS_WEIGHT * (iris_y / IRIS_SCALE) + HEAD_WEIGHT * (pitch / PITCH_SCALE)
                direction = classify(gx, vy)
                openness = (
                    eye_open(shape, LEFT_EYE_TOP, LEFT_EYE_BOTTOM, LEFT_EYE_OUTER, LEFT_EYE_INNER)
                    + eye_open(shape, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM, RIGHT_EYE_INNER, RIGHT_EYE_OUTER)
                ) / 2
                if openness < 0.06:
                    direction = "unclear"  # eyes closed or blinked
                faced_frames += 1
                frames.append({"t": t, "direction": direction, "gx": gx, "vy": vy, "face": True})
        index += 1
    capture.release()
    mesh.close()

    duration = index / source_fps if source_fps else 0.0

    # --- per-answer gaze -----------------------------------------------------
    answers_out = []
    for item in schedule:
        answer_id = int(item["id"])
        q_start = float(item.get("questionStart", item.get("start", 0)))
        start = float(item.get("start", 0))
        end = float(item.get("end", start))
        listening = [f for f in frames if q_start <= f["t"] < start]
        answering = [f for f in frames if start <= f["t"] < end]
        usable = [f for f in answering if f["direction"] != "unclear"]
        if len(usable) < MIN_ANSWER_FRAMES:
            answers_out.append({
                "id": answer_id,
                "whileListening": "unclear",
                "whileAnswering": "unclear",
                "steady": False,
                "reading": False,
                "note": "" if not answering else "Too few clear frames to judge this answer.",
            })
            continue
        listening_usable = [f for f in listening if f["direction"] != "unclear"]
        listening_mode = mode_directions([f["direction"] for f in listening_usable])
        while_listening = next(iter(listening_mode), "unclear") if listening_usable else "unclear"

        counts = mode_directions([f["direction"] for f in usable])
        while_answering, top_count = next(iter(counts.items()), ("unclear", 0))
        steady = top_count / len(usable) >= 0.7
        reading = looks_like_reading(
            [f["direction"] for f in usable], [abs(f["vy"]) for f in usable],
        )
        note_parts = [f"looked {while_answering} for most of the answer"]
        away = sum(1 for f in usable if f["direction"] != "centre")
        if away:
            note_parts.append(f"off the screen for {round(100 * away / len(usable))}% of it")
        answers_out.append({
            "id": answer_id,
            "whileListening": while_listening,
            "whileAnswering": while_answering,
            "steady": steady,
            "reading": reading,
            "note": "; ".join(note_parts)[:300],
        })

    # --- moments -------------------------------------------------------------
    moments = []
    run_start = None
    for f in frames + [{"t": duration + 1, "face": False}]:
        if not f["face"]:
            if run_start is None:
                run_start = f["t"]
        else:
            if run_start is not None and f["t"] - run_start >= NO_FACE_MOMENT_SECONDS:
                moments.append({
                    "at": clock(run_start),
                    "durationSeconds": round(f["t"] - run_start),
                    "kind": "left_frame",
                    "description": f"The candidate is not visible in the picture for about {round(f['t'] - run_start)} seconds.",
                })
            run_start = None

    face_visible = faced_frames > 0 and faced_frames >= max(2, int(0.05 * max(1, total_frames)))
    print(json.dumps({
        "faceVisible": face_visible,
        "answers": answers_out,
        "moments": moments,
    }))


if __name__ == "__main__":
    main()