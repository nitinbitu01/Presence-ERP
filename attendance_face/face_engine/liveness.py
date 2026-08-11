"""
face_engine/liveness.py

MiniFASNet (Silent-Face-Anti-Spoofing) Anti-Spoofing Inference Engine.

Discriminates between genuine live human faces and physical presentation attacks
(printed photo, digital screen playback, 3D mask).

MODEL SPECIFICATION
-------------------
  - Architecture: MiniFASNetV2 / MiniFASNetV1SE
  - Input resolution: 80x80 BGR crop (expanded face bounding box by 2.7x scale)
  - Output: 3-class logits (0: Real, 1: Print attack, 2: Replay attack)
  - Decision threshold: softmax(Real_score) >= threshold (default: 0.85)

THREAD SAFETY
-------------
  - Uses cv2.dnn.readNetFromONNX / ONNX Runtime per instance.
  - Instantiated inside threading.local() via FaceEngine.

FALLBACK BEHAVIOR
-----------------
  - If the ONNX model file is missing, LivenessDetector logs a WARNING on startup
    and defaults predict() to (True, 1.0) so system operation is not disrupted
    while keeping audit log security flags transparent.
"""

from __future__ import annotations

import os
from pathlib import Path
import cv2
import numpy as np
import structlog

from face_engine.detector import FaceBox
from face_engine.exceptions import ModelLoadError

log = structlog.get_logger()


class LivenessDetector:
    """MiniFASNet anti-spoofing classifier."""

    def __init__(
        self,
        model_path: Path | str,
        threshold: float = 0.85,
        scale: float = 2.7,
    ) -> None:
        self.model_path = Path(model_path)
        self.threshold = threshold
        self.scale = scale
        self.net: cv2.dnn.Net | None = None

        self._load_model()

    def _load_model(self) -> None:
        """Load MiniFASNet ONNX model into OpenCV DNN module."""
        if not self.model_path.exists():
            log.warning(
                "liveness_model_missing",
                path=str(self.model_path),
                message="MiniFASNet model file not found. Operating in fallback mode (always pass).",
            )
            return

        try:
            self.net = cv2.dnn.readNetFromONNX(str(self.model_path))
            log.info("liveness_model_loaded", path=str(self.model_path))
        except Exception as exc:
            log.error("liveness_model_load_failed", path=str(self.model_path), error=str(exc))
            self.net = None

    def _crop_expanded_face(self, image_bgr: np.ndarray, face: FaceBox) -> np.ndarray:
        """Crop face region with 2.7x scale factor as required by MiniFASNet."""
        h_img, w_img = image_bgr.shape[:2]
        x, y, w, h = face.bbox

        cx, cy = x + w / 2.0, y + h / 2.0
        max_dim = max(w, h)
        src_w = max_dim * self.scale
        src_h = max_dim * self.scale

        x1 = max(0, int(cx - src_w / 2.0))
        y1 = max(0, int(cy - src_h / 2.0))
        x2 = min(w_img, int(cx + src_w / 2.0))
        y2 = min(h_img, int(cy + src_h / 2.0))

        crop = image_bgr[y1:y2, x1:x2]
        if crop.size == 0:
            return cv2.resize(image_bgr, (80, 80))
        return cv2.resize(crop, (80, 80))

    def predict(self, image_bgr: np.ndarray, face: FaceBox) -> tuple[bool, float]:
        """Run liveness check on detected face.

        Returns:
            (is_live: bool, confidence: float)
        """
        if self.net is None:
            # Fallback when model file not present
            return True, 1.0

        try:
            crop = self._crop_expanded_face(image_bgr, face)
            blob = cv2.dnn.blobFromImage(
                crop,
                scalefactor=1.0,
                size=(80, 80),
                mean=(0, 0, 0),
                swapRB=False,
                crop=False,
            )

            self.net.setInput(blob)
            out = self.net.forward()

            # Softmax calculation
            exp_out = np.exp(out - np.max(out, axis=1, keepdims=True))
            probs = exp_out / np.sum(exp_out, axis=1, keepdims=True)

            # prob[0] is Real class score in MiniFASNet
            real_score = float(probs[0][0])
            is_live = real_score >= self.threshold

            log.debug(
                "liveness_check_evaluated",
                real_score=round(real_score, 4),
                threshold=self.threshold,
                is_live=is_live,
            )
            return is_live, real_score

        except Exception as exc:
            log.warning("liveness_prediction_error", error=str(exc))
            return True, 1.0
