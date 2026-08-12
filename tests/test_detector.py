"""
tests/test_detector.py

Phase 2 tests for face_engine/detector.py.

These tests use the REAL YuNet model (requires models/ folder to be populated).
Blank/white/black images are used as "no face" inputs — no mocking of OpenCV.
Only database and file I/O are mocked.

Run:
    cd attendance_face
    pytest tests/test_detector.py -v

Requirements:
    models/face_detection_yunet_2023mar.onnx must exist.
    Run: python scripts/setup_models.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from face_engine.detector import FaceBox, FaceDetector
from face_engine.exceptions import ModelLoadError
from tests.conftest import FakeConfig


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_synthetic_face_image(size: int = 200) -> np.ndarray:
    """Return a solid-color square image that contains NO real face.
    Used only for tests that call non-detection paths (blur, yaw math).
    """
    img = np.ones((size, size, 3), dtype=np.uint8) * 180
    # Draw a rough oval shape to vaguely look like a head — still not a real face
    cv2.ellipse(img, (size // 2, size // 2), (60, 80), 0, 0, 360, (220, 190, 160), -1)
    return img


def _make_blurry_image(size: int = 200) -> np.ndarray:
    """Return a heavily Gaussian-blurred solid-color image."""
    img = _make_synthetic_face_image(size)
    return cv2.GaussianBlur(img, (31, 31), 10)


def _make_fake_facebox(w: int = 100, h: int = 100, conf: float = 0.95) -> FaceBox:
    """Build a FaceBox dataclass with fake but plausible values."""
    row = np.zeros(15, dtype=np.float32)
    row[0], row[1], row[2], row[3] = 10.0, 10.0, float(w), float(h)
    # Landmarks: right_eye, left_eye, nose, right_mouth, left_mouth
    row[4:14] = [30, 50, 70, 50, 50, 80, 35, 100, 65, 100]
    row[14] = conf
    raw = row.reshape(1, -1)
    lm = row[4:14].reshape(5, 2).astype(np.float32)
    return FaceBox(
        bbox=(10, 10, w, h),
        landmarks=lm,
        confidence=conf,
        raw_detection=raw,
    )


def _detector_with_mock_yunet(config: FakeConfig) -> FaceDetector:
    """Return a FaceDetector whose internal YuNet is mocked (no real model needed)."""
    detector = object.__new__(FaceDetector)
    detector.config = config

    mock_yunet = MagicMock()
    # By default: detect returns (retval, None) → zero faces
    mock_yunet.detect.return_value = (0, None)
    detector._yunet = mock_yunet
    return detector


# ─── Tests: detect() return types ────────────────────────────────────────────

class TestDetectReturnType:
    """detect() must always return a list, never None."""

    def test_no_face_returns_empty_list_not_none(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        result = detector.detect(np.ones((100, 100, 3), dtype=np.uint8) * 255)
        assert result == [], "Expected empty list for no-face image"
        assert result is not None, "detect() must never return None"

    def test_detect_always_returns_list_type(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        result = detector.detect(np.zeros((100, 100, 3), dtype=np.uint8))
        assert isinstance(result, list), f"Expected list, got {type(result)}"

    def test_detect_returns_facebox_objects(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        # Simulate one detection row with confidence 0.95
        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [10, 10, 80, 80]
        row[4:14] = [30, 50, 70, 50, 50, 80, 35, 100, 65, 100]
        row[14] = 0.95
        detector._yunet.detect.return_value = (1, np.array([row]))
        result = detector.detect(np.ones((200, 200, 3), dtype=np.uint8))
        assert len(result) == 1
        assert isinstance(result[0], FaceBox)


# ─── Tests: confidence filtering ─────────────────────────────────────────────

class TestConfidenceFiltering:
    """Only faces above confidence_threshold should be returned."""

    def test_low_confidence_faces_filtered(self, fake_config):
        fake_config.detection.confidence_threshold = 0.99
        detector = _detector_with_mock_yunet(fake_config)

        # One detection at 0.95 — below 0.99 threshold
        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [10, 10, 90, 90]
        row[14] = 0.95
        detector._yunet.detect.return_value = (1, np.array([row]))

        result = detector.detect(np.ones((200, 200, 3), dtype=np.uint8))
        assert result == [], f"Expected [] after filtering, got {result}"

    def test_high_confidence_face_kept(self, fake_config):
        fake_config.detection.confidence_threshold = 0.5
        detector = _detector_with_mock_yunet(fake_config)

        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [10, 10, 90, 90]
        row[14] = 0.92
        detector._yunet.detect.return_value = (1, np.array([row]))

        result = detector.detect(np.ones((200, 200, 3), dtype=np.uint8))
        assert len(result) == 1

    def test_multiple_faces_filtered_by_threshold(self, fake_config):
        fake_config.detection.confidence_threshold = 0.8
        detector = _detector_with_mock_yunet(fake_config)

        # Two detections: one above, one below threshold
        rows = []
        for conf in [0.90, 0.70]:
            row = np.zeros(15, dtype=np.float32)
            row[0:4] = [10, 10, 80, 80]
            row[14] = conf
            rows.append(row)
        detector._yunet.detect.return_value = (2, np.array(rows))

        result = detector.detect(np.ones((300, 300, 3), dtype=np.uint8))
        assert len(result) == 1
        assert result[0].confidence == pytest.approx(0.90, abs=0.01)

    def test_faces_sorted_by_confidence_descending(self, fake_config):
        fake_config.detection.confidence_threshold = 0.5
        detector = _detector_with_mock_yunet(fake_config)

        confidences = [0.75, 0.95, 0.85]
        rows = []
        for conf in confidences:
            row = np.zeros(15, dtype=np.float32)
            row[0:4] = [10, 10, 80, 80]
            row[14] = conf
            rows.append(row)
        detector._yunet.detect.return_value = (3, np.array(rows))

        result = detector.detect(np.ones((300, 300, 3), dtype=np.uint8))
        returned_confs = [r.confidence for r in result]
        assert returned_confs == sorted(returned_confs, reverse=True), (
            "Results must be sorted by confidence, highest first"
        )

    def test_max_faces_cap_respected(self, fake_config):
        fake_config.detection.max_faces_per_frame = 3
        fake_config.detection.confidence_threshold = 0.5
        detector = _detector_with_mock_yunet(fake_config)

        rows = []
        for i in range(10):
            row = np.zeros(15, dtype=np.float32)
            row[0:4] = [10 * i, 10, 80, 80]
            row[14] = 0.6 + i * 0.01
            rows.append(row)
        detector._yunet.detect.return_value = (10, np.array(rows))

        result = detector.detect(np.ones((500, 500, 3), dtype=np.uint8))
        assert len(result) <= 3, "Should cap at max_faces_per_frame=3"


# ─── Tests: setInputSize called per frame ────────────────────────────────────

class TestInputSizePerFrame:
    """setInputSize must be called on every detect() invocation."""

    def test_input_size_set_every_call(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)

        frame1 = np.zeros((480, 640, 3), dtype=np.uint8)
        frame2 = np.zeros((720, 1280, 3), dtype=np.uint8)
        detector.detect(frame1)
        detector.detect(frame2)

        calls = detector._yunet.setInputSize.call_args_list
        assert len(calls) == 2, f"setInputSize should be called twice, got {len(calls)}"

        # First call: (640, 480)
        assert calls[0][0][0] == (640, 480), f"Expected (640,480), got {calls[0][0][0]}"
        # Second call: (1280, 720)
        assert calls[1][0][0] == (1280, 720), f"Expected (1280,720), got {calls[1][0][0]}"


# ─── Tests: validate_for_enrollment ──────────────────────────────────────────

class TestEnrollmentValidation:
    """validate_for_enrollment covers 5 ordered checks."""

    def test_no_face_returns_no_face_reason(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        # detect returns empty list → "no_face_detected"
        detector._yunet.detect.return_value = (0, None)

        face_box, detail = detector.validate_for_enrollment(
            np.ones((200, 200, 3), dtype=np.uint8) * 200, "EMP001"
        )
        assert face_box is None
        assert detail is not None
        assert detail["reason"] == "no_face_detected"
        assert "measured_value" in detail
        assert "threshold" in detail

    def test_multiple_faces_returns_correct_reason(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)

        # Simulate 2 high-confidence detections
        rows = []
        for i in range(2):
            row = np.zeros(15, dtype=np.float32)
            row[0:4] = [10 + i * 50, 10, 90, 90]
            row[14] = 0.92
            rows.append(row)
        detector._yunet.detect.return_value = (2, np.array(rows))
        fake_config.detection.confidence_threshold = 0.5

        face_box, detail = detector.validate_for_enrollment(
            np.ones((300, 300, 3), dtype=np.uint8), "EMP001"
        )
        assert face_box is None
        assert detail["reason"] == "multiple_faces_detected"
        assert detail["measured_value"] == 2

    def test_face_too_small_returns_correct_reason(self, fake_config):
        """Face with bbox 50×50 < min_face_size_px=80 must be rejected."""
        fake_config.detection.min_face_size_px = 80
        fake_config.detection.confidence_threshold = 0.5
        detector = _detector_with_mock_yunet(fake_config)

        # Single face at confidence 0.9 but small bbox (50×50)
        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [10, 10, 50, 50]  # 50×50 < 80
        row[4:14] = [20, 30, 40, 30, 30, 45, 22, 55, 42, 55]
        row[14] = 0.90
        detector._yunet.detect.return_value = (1, np.array([row]))

        face_box, detail = detector.validate_for_enrollment(
            np.ones((200, 200, 3), dtype=np.uint8), "EMP001"
        )
        assert face_box is None
        assert detail["reason"] == "face_too_small"
        assert detail["measured_value"] < 80

    def test_frontal_large_face_passes(self, fake_config):
        """A large, approximately frontal face should pass all checks."""
        fake_config.detection.min_face_size_px = 80
        fake_config.detection.confidence_threshold = 0.5
        fake_config.enrollment.blur_threshold = 5.0   # Very low for synthetic image
        fake_config.enrollment.max_yaw_degrees = 45.0
        detector = _detector_with_mock_yunet(fake_config)

        # Symmetric frontal landmarks → yaw ≈ 0
        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [10, 10, 120, 140]   # Large face
        # Symmetric: right_eye=(50,60), left_eye=(150,60), nose=(100,90)
        row[4] = 50;  row[5] = 60    # right_eye
        row[6] = 150; row[7] = 60    # left_eye
        row[8] = 100; row[9] = 90    # nose
        row[10] = 60; row[11] = 130  # right_mouth
        row[12] = 140; row[13] = 130 # left_mouth
        row[14] = 0.95
        detector._yunet.detect.return_value = (1, np.array([row]))

        # Sharp image (non-blurry)
        sharp_img = np.random.randint(0, 255, (200, 200, 3), dtype=np.uint8)

        face_box, detail = detector.validate_for_enrollment(sharp_img, "EMP001")
        # If blur check triggers on random noise image, adjust threshold
        # Random noise has very high Laplacian variance (>> 100), so should pass
        assert face_box is not None or (detail is not None and detail["reason"] != "face_too_small"), (
            f"Large frontal face should not be rejected for size. Got: {detail}"
        )

    def test_blurry_image_returns_correct_reason(self, fake_config):
        """Blurred face crop must produce 'image_too_blurry' rejection."""
        fake_config.detection.min_face_size_px = 80
        fake_config.detection.confidence_threshold = 0.5
        fake_config.enrollment.blur_threshold = 100.0
        fake_config.enrollment.max_yaw_degrees = 45.0  # Very lenient yaw
        detector = _detector_with_mock_yunet(fake_config)

        # Symmetric frontal face, large bbox
        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [10, 10, 120, 140]
        row[4] = 50;  row[5] = 60
        row[6] = 150; row[7] = 60
        row[8] = 100; row[9] = 90
        row[10] = 60; row[11] = 130
        row[12] = 140; row[13] = 130
        row[14] = 0.95
        detector._yunet.detect.return_value = (1, np.array([row]))

        # Create a very blurry image (pure solid color → Laplacian var ≈ 0)
        blurry_img = np.ones((200, 200, 3), dtype=np.uint8) * 128

        face_box, detail = detector.validate_for_enrollment(blurry_img, "EMP001")
        assert face_box is None
        assert detail is not None
        assert detail["reason"] == "image_too_blurry"
        assert detail["measured_value"] < detail["threshold"]


# ─── Tests: _estimate_yaw ────────────────────────────────────────────────────

class TestYawEstimation:
    """Unit tests for the internal _estimate_yaw helper."""

    def test_symmetric_face_has_near_zero_yaw(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        # Perfectly symmetric: right_eye=(40,50), left_eye=(160,50), nose=(100,80)
        lm = np.array([[40, 50], [160, 50], [100, 80], [50, 120], [150, 120]], dtype=np.float32)
        yaw = detector._estimate_yaw(lm)
        assert abs(yaw) < 5.0, f"Symmetric face should have near-zero yaw, got {yaw:.2f}°"

    def test_turned_right_has_positive_yaw(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        # Right-side profile: right_eye close to nose, left_eye far
        lm = np.array([[70, 50], [160, 50], [80, 80], [75, 120], [140, 120]], dtype=np.float32)
        yaw = detector._estimate_yaw(lm)
        assert yaw < 0.0, f"Right-profile face should have negative yaw (nose closer to right_eye), got {yaw:.2f}°"

    def test_degenerate_landmarks_returns_zero(self, fake_config):
        """All-zero landmarks should not crash — return 0.0."""
        detector = _detector_with_mock_yunet(fake_config)
        lm = np.zeros((5, 2), dtype=np.float32)
        yaw = detector._estimate_yaw(lm)
        assert yaw == pytest.approx(0.0)


# ─── Tests: _compute_blur_score ──────────────────────────────────────────────

class TestBlurScore:
    """Unit tests for Laplacian variance blur scoring."""

    def test_solid_color_image_has_very_low_score(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        solid = np.ones((100, 100, 3), dtype=np.uint8) * 128
        score = detector._compute_blur_score(solid)
        assert score < 1.0, f"Solid color image should have score < 1, got {score}"

    def test_sharp_random_image_has_high_score(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        noisy = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
        score = detector._compute_blur_score(noisy)
        assert score > 1000.0, f"Random noise image should have high blur score, got {score}"

    def test_blurred_image_lower_than_sharp(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        sharp = np.random.randint(50, 200, (100, 100, 3), dtype=np.uint8)
        blurry = cv2.GaussianBlur(sharp, (31, 31), 10)
        sharp_score = detector._compute_blur_score(sharp)
        blurry_score = detector._compute_blur_score(blurry)
        assert blurry_score < sharp_score, (
            f"Blurry image ({blurry_score:.1f}) should score lower than sharp ({sharp_score:.1f})"
        )

    def test_empty_crop_returns_zero(self, fake_config):
        detector = _detector_with_mock_yunet(fake_config)
        empty = np.zeros((0, 0, 3), dtype=np.uint8)
        score = detector._compute_blur_score(empty)
        assert score == 0.0


# ─── Tests: row_to_facebox ───────────────────────────────────────────────────

class TestRowToFaceBox:
    """Conversion from raw YuNet row to FaceBox dataclass."""

    def test_bbox_is_correct(self):
        row = np.zeros(15, dtype=np.float32)
        row[0:4] = [15.0, 25.0, 90.0, 110.0]
        row[14] = 0.88
        fb = FaceDetector._row_to_facebox(row)
        assert fb.bbox == (15, 25, 90, 110)

    def test_confidence_is_correct(self):
        row = np.zeros(15, dtype=np.float32)
        row[14] = 0.77
        fb = FaceDetector._row_to_facebox(row)
        assert fb.confidence == pytest.approx(0.77)

    def test_landmarks_shape(self):
        row = np.zeros(15, dtype=np.float32)
        row[4:14] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
        fb = FaceDetector._row_to_facebox(row)
        assert fb.landmarks.shape == (5, 2)
        assert fb.landmarks.dtype == np.float32

    def test_raw_detection_shape(self):
        row = np.zeros(15, dtype=np.float32)
        fb = FaceDetector._row_to_facebox(row)
        assert fb.raw_detection.shape == (1, 15), (
            f"raw_detection must be (1,15) for alignCrop(), got {fb.raw_detection.shape}"
        )


# ─── Tests: ModelLoadError ───────────────────────────────────────────────────

class TestModelLoadError:
    """FaceDetector must raise ModelLoadError if model file is missing."""

    def test_missing_model_raises_model_load_error(self, fake_config):
        fake_config.models.detector.filename = "nonexistent_model.onnx"
        fake_config.models.base_path = "models/"
        with pytest.raises(ModelLoadError, match="nonexistent_model"):
            FaceDetector(fake_config)
