"""
Per-clip video measurement for the v2 integrity analysis.

Reads one clip of the candidate recording and writes compact per-frame
measurements as JSON. It does no judging: calibration, clustering, reading
and lip-sync detection happen across the whole interview in features.py,
because they need every answer at once.

Frame sampling follows what each moment is for:
  - while the candidate answers, and in the pause before an answer: every
    frame (15 fps on LiveKit recordings), needed for reading sweeps and
    lip movement;
  - while the interviewer speaks: about 5 fps, enough for the gaze baseline;
  - elsewhere: about 2 fps, for presence only.

Dark or soft webcam frames are enhanced before landmarking (gamma, local
contrast, light denoise), and small faces are re-detected on an upscaled
frame, so low-cost webcams in dim rooms still give usable eye and lip points.

Usage:
  python measure_video.py --video clip.mp4 --windows-file w.json --offset 300 \
      [--phone-model yolox_nano.onnx]

Output (stdout, one JSON object):
  { fps, frames: [[t, role, face, gx, vy, mar, open, facePx, lum, enhanced]],
    samples: [[t, faces, phone, persons, sharpness]] }
where t is seconds on the recording clock and role is
  "a" answering, "p" pause before answering, "l" interviewer speaking, "o" other.
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
except Exception as error:  # pragma: no cover
    print(json.dumps({"error": f"mediapipe unavailable: {error}"}))
    sys.exit(2)

from objects import PhoneDetector

# Face Mesh landmark indices (478 points, refine_landmarks=True).
NOSE_TIP, CHIN = 1, 152
LEFT_EYE_OUTER, LEFT_EYE_INNER = 33, 133
RIGHT_EYE_INNER, RIGHT_EYE_OUTER = 362, 263
LEFT_MOUTH, RIGHT_MOUTH = 61, 291
LEFT_IRIS, RIGHT_IRIS = 468, 473
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 159, 145
RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = 386, 374
UPPER_LIP_INNER, LOWER_LIP_INNER = 13, 14

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

# Gaze combination: iris offset inside the eye (moves when only the eyes move)
# plus head pose (moves when the whole head turns). Units are roughly -1..1.
IRIS_SCALE = 0.2
YAW_SCALE = 25.0
PITCH_SCALE = 20.0
IRIS_WEIGHT = 0.65
HEAD_WEIGHT = 0.35

MIN_FACE_PX = 110
# Enhancement kicks in below this mean brightness (0-255).
ENHANCE_BELOW = 105.0
TARGET_LEVEL = 0.47  # gamma target, as a share of full brightness

_CLAHE = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))


def luminance(frame) -> float:
    return float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean())


def enhance(frame, level: float):
    """Brighten and clean up a dark frame; normal frames pass through untouched.

    Gamma lifts the shadows towards a mid-grey target, CLAHE restores local
    contrast around the eyes and lips, and a small bilateral filter removes
    the sensor noise that dark webcam frames carry, without blurring edges.
    """
    if level >= ENHANCE_BELOW:
        return frame, False
    mean = max(1.0, level) / 255.0
    gamma = min(1.0, max(0.35, math.log(TARGET_LEVEL) / math.log(mean)))
    table = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.uint8)
    lifted = cv2.LUT(frame, table)
    lab = cv2.cvtColor(lifted, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)
    merged = cv2.cvtColor(cv2.merge((_CLAHE.apply(lightness), a, b)), cv2.COLOR_LAB2BGR)
    return cv2.bilateralFilter(merged, 5, 30, 5), True


def detect(frame, mesh):
    """Landmarks for the main face, re-detecting upscaled when it is small."""
    height, width = frame.shape[:2]
    result = mesh.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    shape = result.multi_face_landmarks[0].landmark if result.multi_face_landmarks else None
    face_px = 0.0
    if shape is not None and len(shape) >= 478:
        xs = [point.x for point in shape]
        face_px = (max(xs) - min(xs)) * width
        if face_px >= MIN_FACE_PX or width >= 1600:
            return shape, face_px
    scale = 2.0 if shape is None else min(3.0, MIN_FACE_PX / max(1.0, face_px))
    if scale <= 1.05:
        return shape, face_px
    enlarged = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    again = mesh.process(cv2.cvtColor(enlarged, cv2.COLOR_BGR2RGB))
    if again.multi_face_landmarks and len(again.multi_face_landmarks[0].landmark) >= 478:
        better = again.multi_face_landmarks[0].landmark
        xs = [point.x for point in better]
        return better, (max(xs) - min(xs)) * width
    return shape, face_px


def iris_offset(shape, outer, inner, iris) -> tuple[float, float]:
    ox, oy = shape[outer].x, shape[outer].y
    ix, iy = shape[inner].x, shape[inner].y
    width = max(1e-6, abs(ix - ox))
    return ((shape[iris].x - (ox + ix) / 2) / width, (shape[iris].y - (oy + iy) / 2) / width)


def eye_open(shape, top, bottom, outer, inner) -> float:
    return abs(shape[top].y - shape[bottom].y) / max(1e-6, abs(shape[inner].x - shape[outer].x))


def head_angles(shape, size) -> tuple[float, float]:
    points = np.array(
        [(shape[i].x * size[0], shape[i].y * size[1]) for i in MODEL_LANDMARKS], dtype=np.float64
    )
    camera = np.array(
        [[size[0], 0, size[0] / 2], [0, size[0], size[1] / 2], [0, 0, 1]], dtype=np.float64
    )
    ok, rvec, _ = cv2.solvePnP(MODEL_POINTS, points, camera, np.zeros((4, 1)), flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return 0.0, 0.0
    rot, _ = cv2.Rodrigues(rvec)
    yaw = math.degrees(math.atan2(-rot[0][2], math.hypot(rot[1][2], rot[2][2])))
    pitch = -math.degrees(math.atan2(rot[1][2], rot[2][2]))
    # solvePnP can return the face model flipped about its x-axis, which puts
    # a level head at about +/-180 degrees of pitch. Folded back, a level head
    # reads as about 0. (Unfolded, this read every frontal face as "looking
    # down", which is what the old analyser reported for honest candidates.)
    if pitch > 90:
        pitch -= 180
    elif pitch < -90:
        pitch += 180
    return yaw, pitch


def mouth_aperture(shape) -> float:
    """Inner-lip opening over mouth width: rises and falls with speech."""
    width = max(1e-6, math.hypot(shape[RIGHT_MOUTH].x - shape[LEFT_MOUTH].x, shape[RIGHT_MOUTH].y - shape[LEFT_MOUTH].y))
    opening = math.hypot(
        shape[LOWER_LIP_INNER].x - shape[UPPER_LIP_INNER].x,
        shape[LOWER_LIP_INNER].y - shape[UPPER_LIP_INNER].y,
    )
    return opening / width


def face_sharpness(frame, shape) -> float:
    """Variance of the Laplacian over the face box: low means a soft, blurry picture."""
    height, width = frame.shape[:2]
    xs = [point.x for point in shape]
    ys = [point.y for point in shape]
    x0, x1 = max(0, int(min(xs) * width)), min(width, int(max(xs) * width))
    y0, y1 = max(0, int(min(ys) * height)), min(height, int(max(ys) * height))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return 0.0
    crop = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(crop, cv2.CV_64F).var())


def role_at(t: float, windows: list[dict]) -> str:
    for item in windows:
        if item["start"] <= t < item["end"]:
            return "a"
    for item in windows:
        if item.get("questionEnd") is not None and item["questionEnd"] <= t < item["start"]:
            return "p"
        if item["questionStart"] <= t < item["start"]:
            # Without a known question end, the last 4 s before the answer are the pause.
            if item.get("questionEnd") is None and t >= item["start"] - 4.0:
                return "p"
            return "l"
    return "o"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--windows-file", required=True)
    parser.add_argument("--offset", type=float, default=0.0)
    parser.add_argument("--phone-model", default="")
    args = parser.parse_args()

    with open(args.windows_file, encoding="utf-8") as handle:
        windows = json.load(handle)

    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        print(json.dumps({"error": "video could not be opened"}))
        sys.exit(2)
    fps = capture.get(cv2.CAP_PROP_FPS) or 15.0
    if not math.isfinite(fps) or fps <= 1 or fps > 120:
        fps = 15.0
    size = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))

    mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    counter = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.6)
    phones = PhoneDetector(args.phone_model) if args.phone_model else None

    listen_step = max(1, int(round(fps / 5)))
    other_step = max(1, int(round(fps / 2)))
    sample_every = 1.0  # seconds, for face counts, phones and sharpness

    frames: list[list] = []
    samples: list[list] = []
    next_sample = 0.0
    index = 0
    while True:
        if not capture.grab():
            break
        t_local = index / fps
        t = args.offset + t_local
        role = role_at(t, windows)
        step = 1 if role in ("a", "p") else listen_step if role == "l" else other_step
        want_sample = role in ("a", "p") and t >= next_sample
        if index % step != 0 and not want_sample:
            index += 1
            continue
        ok, frame = capture.retrieve()
        if not ok:
            index += 1
            continue
        if frame.shape[1] != size[0] or frame.shape[0] != size[1]:
            size = (frame.shape[1], frame.shape[0])
        level = luminance(frame)
        picture, enhanced = enhance(frame, level)
        shape, face_px = detect(picture, mesh)
        if shape is None:
            frames.append([round(t, 3), role, 0, 0, 0, 0, 0, 0, round(level, 1), int(enhanced)])
        else:
            left = iris_offset(shape, LEFT_EYE_OUTER, LEFT_EYE_INNER, LEFT_IRIS)
            right = iris_offset(shape, RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_IRIS)
            yaw, pitch = head_angles(shape, size)
            gx = IRIS_WEIGHT * ((left[0] + right[0]) / 2 / IRIS_SCALE) + HEAD_WEIGHT * (yaw / YAW_SCALE)
            vy = IRIS_WEIGHT * ((left[1] + right[1]) / 2 / IRIS_SCALE) + HEAD_WEIGHT * (pitch / PITCH_SCALE)
            openness = (
                eye_open(shape, LEFT_EYE_TOP, LEFT_EYE_BOTTOM, LEFT_EYE_OUTER, LEFT_EYE_INNER)
                + eye_open(shape, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM, RIGHT_EYE_INNER, RIGHT_EYE_OUTER)
            ) / 2
            frames.append([
                round(t, 3), role, 1, round(gx, 4), round(vy, 4), round(mouth_aperture(shape), 4),
                round(openness, 4), round(face_px, 1), round(level, 1), int(enhanced),
            ])
        if want_sample:
            next_sample = t + sample_every
            detection = counter.process(cv2.cvtColor(picture, cv2.COLOR_BGR2RGB))
            faces = len(detection.detections or [])
            phone, persons = phones.detect(frame) if phones else (None, None)
            sharp = face_sharpness(picture, shape) if shape is not None else None
            samples.append([
                round(t, 2), faces,
                None if phone is None else round(phone, 3),
                persons,
                None if sharp is None else round(sharp, 1),
            ])
        index += 1

    capture.release()
    mesh.close()
    counter.close()
    print(json.dumps({"fps": fps, "frames": frames, "samples": samples}, separators=(",", ":")))


if __name__ == "__main__":
    main()
