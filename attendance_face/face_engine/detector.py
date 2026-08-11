"""
face_engine/detector.py

YuNet face detector wrapper.

THREAD SAFETY
-------------
NOT thread-safe. Never share one FaceDetector instance across threads.
FaceEngine creates per-thread instances automatically via threading.local().
See engine.py for the threading pattern.

INPUT SIZE
----------
setInputSize(width, height) MUST be called before EVERY detect() call because
input images may vary in resolution. Omitting this causes SILENT detection
failures — no exception, just empty results or wrong bounding boxes.

IMAGE FORMAT
------------
Accepts BGR images (OpenCV native format).
YuNet itself does NOT require RGB conversion.
RGB conversion is handled in recognizer.py immediately before alignCrop().
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import cv2
import numpy as np
import structlog

from face_engine.config import Config
from face_engine.exceptions import (
    FaceEngineError,
    ModelChecksumError,
    ModelLoadError,
)

log = structlog.get_logger()


# ─── Data class (defined here to avoid circular imports with engine.py) ───────

from dataclasses import dataclass


@dataclass
class FaceBox:
    """Detected face with bounding box, landmarks, and YuNet raw output."""
    bbox: tuple[int, int, int, int]   # (x, y, w, h) in pixels
    landmarks: np.ndarray             # shape (5, 2) — YuNet 5-point landmarks
    confidence: float                 # 0.0–1.0
    raw_detection: np.ndarray         # Full YuNet output row, shape (1, 15)
    # raw_detection is passed DIRECTLY to FaceRecognizerSF.alignCrop().
    # Do NOT slice or modify it. Do NOT write a custom affine transform.


class FaceDetector:
    """Wraps cv2.FaceDetectorYN (YuNet)."""

    def __init__(self, config: Config) -> None:
        """Load YuNet model.

        Verifies SHA256 checksum before loading (if sha256 is set in config).
        Raises ModelChecksumError if checksum fails.
        Raises ModelLoadError if file is missing or cv2 cannot load it.
        """
        self.config = config
        model_path = config.models.detector_path()

        # ── File existence ────────────────────────────────────────────────
        if not model_path.exists():
            raise ModelLoadError(
                f"YuNet model not found: {model_path.resolve()}. "
                "Run: python scripts/setup_models.py"
            )

        # ── SHA256 verification ───────────────────────────────────────────
        expected_sha = config.models.detector.sha256.strip().lower()
        if expected_sha:
            actual_sha = self._sha256(model_path)
            if actual_sha != expected_sha:
                raise ModelChecksumError(
                    f"YuNet checksum mismatch for {model_path.name}. "
                    f"Expected: {expected_sha}  Actual: {actual_sha}. "
                    "Re-run: python scripts/setup_models.py"
                )

        # ── Load model ────────────────────────────────────────────────────
        t0 = time.perf_counter()
        try:
            self._yunet: cv2.FaceDetectorYN = cv2.FaceDetectorYN.create(
                model=str(model_path),
                config="",
                input_size=(
                    config.detection.input_size[0],
                    config.detection.input_size[1],
                ),
                score_threshold=0.0,    # We filter ourselves for full control
                nms_threshold=0.3,
                top_k=config.detection.max_faces_per_frame * 4,
                backend_id=cv2.dnn.DNN_BACKEND_DEFAULT,
                target_id=cv2.dnn.DNN_TARGET_CPU,
            )
        except cv2.error as exc:
            raise ModelLoadError(
                f"cv2 failed to load YuNet from {model_path}: {exc}"
            ) from exc

        load_ms = (time.perf_counter() - t0) * 1000
        log.info(
            "yunet_model_loaded",
            filename=model_path.name,
            load_ms=round(load_ms, 2),
            checksum_verified=bool(expected_sha),
        )

    # ─── Public API ──────────────────────────────────────────────────────────

    def detect(self, image_bgr: np.ndarray) -> list[FaceBox]:
        """Detect all faces in a BGR image.

        Rules:
        - setInputSize(w, h) is called on EVERY invocation (images vary in size).
        - Returns empty list for zero detections — never None, never raises for no-face.
        - Filters out detections below confidence_threshold.
        - Returns ALL faces sorted by confidence (descending), capped at max_faces_per_frame.

        Args:
            image_bgr: BGR image as numpy array, shape (H, W, 3).

        Returns:
            List of FaceBox dataclasses, possibly empty.

        Raises:
            FaceEngineError: If OpenCV raises an internal error during inference.
        """
        t0 = time.perf_counter()
        h, w = image_bgr.shape[:2]

        # CRITICAL: must call setInputSize on every frame
        self._yunet.setInputSize((w, h))

        try:
            _, detections = self._yunet.detect(image_bgr)
        except cv2.error as exc:
            raise FaceEngineError(
                f"YuNet detect() raised an OpenCV error: {exc}"
            ) from exc

        detect_ms = (time.perf_counter() - t0) * 1000

        # detect() returns None when zero faces found
        if detections is None:
            log.debug(
                "yunet_no_faces",
                frame_shape=(h, w),
                detect_ms=round(detect_ms, 2),
            )
            return []

        faces_before = len(detections)
        threshold = self.config.detection.confidence_threshold

        # Filter by confidence
        kept = [row for row in detections if float(row[14]) >= threshold]

        # Sort by confidence descending
        kept.sort(key=lambda r: float(r[14]), reverse=True)

        # Cap results
        kept = kept[: self.config.detection.max_faces_per_frame]

        log.debug(
            "yunet_detected",
            frame_shape=(h, w),
            faces_before_filter=faces_before,
            faces_after_filter=len(kept),
            detect_ms=round(detect_ms, 2),
        )

        if len(kept) == 0:
            log.warning(
                "yunet_all_filtered",
                faces_before_filter=faces_before,
                threshold=threshold,
            )
            return []

        return [self._row_to_facebox(row) for row in kept]

    def validate_for_enrollment(
        self,
        image_bgr: np.ndarray,
        employee_id: str,
    ) -> tuple[FaceBox | None, dict | None]:
        """Strict single-face validation for enrollment images.

        Returns (FaceBox, None) if image passes ALL checks.
        Returns (None, detail_dict) at the FIRST failure.

        detail_dict format::

            {
                "reason": "image_too_blurry",
                "measured_value": 45.2,
                "threshold": 100.0,
                "description": "Human-readable explanation"
            }

        Checks (in order, short-circuit at first failure):
            1. Zero faces detected
            2. Multiple faces detected
            3. Face bbox < min_face_size_px
            4. Estimated yaw > max_yaw_degrees
            5. Laplacian variance < blur_threshold (on face crop only)
        """
        faces = self.detect(image_bgr)

        # ── Check 1: No face ──────────────────────────────────────────────
        if len(faces) == 0:
            detail = {
                "reason": "no_face_detected",
                "measured_value": 0,
                "threshold": 1,
                "description": "No face was detected in the image.",
            }
            log.info(
                "enrollment_rejected",
                employee_id=employee_id,
                **detail,
            )
            return None, detail

        # ── Check 2: Multiple faces ───────────────────────────────────────
        if len(faces) > 1:
            detail = {
                "reason": "multiple_faces_detected",
                "measured_value": len(faces),
                "threshold": 1,
                "description": f"{len(faces)} faces detected; enrollment requires exactly one.",
            }
            log.info(
                "enrollment_rejected",
                employee_id=employee_id,
                **detail,
            )
            return None, detail

        face = faces[0]
        x, y, w, h = face.bbox

        # ── Check 3: Face too small ───────────────────────────────────────
        min_px = self.config.detection.min_face_size_px
        min_dim = min(w, h)
        if min_dim < min_px:
            detail = {
                "reason": "face_too_small",
                "measured_value": min_dim,
                "threshold": min_px,
                "description": f"Face is {min_dim}px; minimum is {min_px}px.",
            }
            log.info(
                "enrollment_rejected",
                employee_id=employee_id,
                **detail,
            )
            return None, detail

        # ── Check 4: Face not frontal (yaw) ──────────────────────────────
        yaw = self._estimate_yaw(face.landmarks)
        max_yaw = self.config.enrollment.max_yaw_degrees
        if abs(yaw) > max_yaw:
            detail = {
                "reason": "face_not_frontal_yaw",
                "measured_value": round(abs(yaw), 2),
                "threshold": max_yaw,
                "description": (
                    f"Estimated yaw {abs(yaw):.1f}° exceeds maximum {max_yaw}°. "
                    "Please face the camera more directly."
                ),
            }
            log.info(
                "enrollment_rejected",
                employee_id=employee_id,
                **detail,
            )
            return None, detail

        # ── Check 5: Blur (on face crop only) ────────────────────────────
        img_h, img_w = image_bgr.shape[:2]
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(img_w, x + w)
        y2 = min(img_h, y + h)
        face_crop = image_bgr[y1:y2, x1:x2]

        blur_score = self._compute_blur_score(face_crop)
        blur_threshold = self.config.enrollment.blur_threshold
        if blur_score < blur_threshold:
            detail = {
                "reason": "image_too_blurry",
                "measured_value": round(blur_score, 2),
                "threshold": blur_threshold,
                "description": (
                    f"Face sharpness score {blur_score:.1f} is below "
                    f"minimum {blur_threshold}. Please use a sharper image."
                ),
            }
            log.info(
                "enrollment_rejected",
                employee_id=employee_id,
                **detail,
            )
            return None, detail

        # ── Check 6: Illumination / Brightness ───────────────────────────
        if face_crop.size > 0:
            gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
            mean_brightness = float(np.mean(gray_crop))
            if mean_brightness < 30.0 or mean_brightness > 225.0:
                detail = {
                    "reason": "poor_illumination",
                    "measured_value": round(mean_brightness, 2),
                    "threshold": "30-225",
                    "description": f"Face lighting mean {mean_brightness:.1f} is poorly lit or overexposed.",
                }
                log.info("enrollment_rejected", employee_id=employee_id, **detail)
                return None, detail

        return face, None

    # ─── Private helpers ─────────────────────────────────────────────────────

    def _estimate_yaw(self, landmarks: np.ndarray) -> float:
        """Estimate face yaw (left-right turn) from 5-point landmarks.

        YuNet landmark order:
            0: right eye
            1: left eye
            2: nose tip
            3: right mouth corner
            4: left mouth corner

        Method: compare horizontal distance from right-eye→nose vs nose→left-eye.
        Asymmetry indicates yaw direction and magnitude.
        Returns estimated degrees (positive = turned right, negative = left).

        This is a geometric approximation, not a true 3D pose estimate.
        Sufficient for enrollment filtering purposes.
        """
        right_eye = landmarks[0]
        left_eye = landmarks[1]
        nose = landmarks[2]

        # Horizontal distances on each side of the nose
        d_right = abs(float(nose[0]) - float(right_eye[0]))
        d_left = abs(float(left_eye[0]) - float(nose[0]))

        total = d_right + d_left
        if total < 1e-6:
            return 0.0

        # Normalized asymmetry in [-1, 1]
        asymmetry = (d_right - d_left) / total

        # Scale to degrees: max asymmetry (≈ ±1) ≈ ±45°
        estimated_degrees = asymmetry * 45.0
        return estimated_degrees

    def _compute_blur_score(self, face_crop_bgr: np.ndarray) -> float:
        """Laplacian variance sharpness score on a face crop.

        Steps:
            1. Convert to grayscale.
            2. Apply Laplacian filter.
            3. Return variance of the result.

        Higher = sharper. Typical values:
            Sharp face image: > 100
            Blurry face image: < 50
        """
        if face_crop_bgr.size == 0:
            return 0.0
        gray = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        return float(laplacian.var())

    @staticmethod
    def _row_to_facebox(row: np.ndarray) -> FaceBox:
        """Convert a YuNet detection row (shape 15,) into a FaceBox.

        YuNet output layout (15 values):
            [0..3]   — bbox: x, y, w, h
            [4..13]  — landmarks: 5 points × (x, y)
            [14]     — confidence score
        """
        x, y, w, h = int(row[0]), int(row[1]), int(row[2]), int(row[3])
        lm = row[4:14].reshape(5, 2).astype(np.float32)
        confidence = float(row[14])

        # raw_detection must be shape (1, 15) for alignCrop()
        raw = row.reshape(1, -1)

        return FaceBox(
            bbox=(x, y, w, h),
            landmarks=lm,
            confidence=confidence,
            raw_detection=raw,
        )

    @staticmethod
    def _sha256(path: Path) -> str:
        """Compute SHA256 hash of a file."""
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
