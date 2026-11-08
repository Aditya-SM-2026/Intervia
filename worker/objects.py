"""
Phone and second-person detection with YOLOX-Nano (Apache 2.0, ONNX).

Runs about once a second while the candidate answers. It is optional: when
the model file or onnxruntime is missing, detect() returns (None, None) and
the report says the check did not run.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

INPUT = 416
STRIDES = (8, 16, 32)
# COCO class ids in the YOLOX release models.
PERSON = 0
CELL_PHONE = 67


class PhoneDetector:
    def __init__(self, model_path: str) -> None:
        self.session = None
        if not model_path or not os.path.exists(model_path):
            return
        try:
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            self.session = ort.InferenceSession(model_path, options, providers=["CPUExecutionProvider"])
            self.input_name = self.session.get_inputs()[0].name
            grids, strides = [], []
            for stride in STRIDES:
                size = INPUT // stride
                xs, ys = np.meshgrid(np.arange(size), np.arange(size))
                grids.append(np.stack((xs, ys), 2).reshape(-1, 2))
                strides.append(np.full((size * size, 1), stride))
            self.grids = np.concatenate(grids, 0).astype(np.float32)
            self.strides = np.concatenate(strides, 0).astype(np.float32)
        except Exception:
            self.session = None

    def detect(self, frame) -> tuple[float | None, int | None]:
        """(best phone confidence, number of people) in one BGR frame."""
        if self.session is None:
            return None, None
        height, width = frame.shape[:2]
        ratio = min(INPUT / height, INPUT / width)
        resized = cv2.resize(frame, (int(width * ratio), int(height * ratio)), interpolation=cv2.INTER_LINEAR)
        padded = np.full((INPUT, INPUT, 3), 114, dtype=np.uint8)
        padded[: resized.shape[0], : resized.shape[1]] = resized
        blob = padded.transpose(2, 0, 1)[None].astype(np.float32)
        output = self.session.run(None, {self.input_name: blob})[0][0]
        # Released YOLOX ONNX models return raw grid offsets; decode them.
        output[:, :2] = (output[:, :2] + self.grids) * self.strides
        output[:, 2:4] = np.exp(output[:, 2:4]) * self.strides
        scores = output[:, 4:5] * output[:, 5:]
        phone = float(scores[:, CELL_PHONE].max())
        person_scores = scores[:, PERSON]
        keep = person_scores > 0.5
        persons = 0
        if keep.any():
            boxes = output[keep, :4]
            xyxy = np.stack(
                [boxes[:, 0] - boxes[:, 2] / 2, boxes[:, 1] - boxes[:, 3] / 2, boxes[:, 0] + boxes[:, 2] / 2, boxes[:, 1] + boxes[:, 3] / 2],
                1,
            )
            indices = cv2.dnn.NMSBoxes(
                [[float(b[0]), float(b[1]), float(b[2] - b[0]), float(b[3] - b[1])] for b in xyxy],
                [float(s) for s in person_scores[keep]],
                0.5,
                0.45,
            )
            persons = len(indices) if indices is not None else 0
        return phone, persons
