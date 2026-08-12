"""
tests/test_liveness.py

Phase 8 unit tests for face_engine/liveness.py.

Tests cover:
  - Missing model file fallback (returns True, 1.0)
  - Crop expansion calculation for 2.7x scale factor
  - Liveness prediction method signature and return format
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from face_engine.detector import FaceBox
from face_engine.liveness import LivenessDetector


def _fake_facebox() -> FaceBox:
    row = np.zeros(15, dtype=np.float32)
    row[0:4] = [10, 10, 50, 50]
    row[4:14] = [20, 20, 40, 20, 30, 30, 20, 40, 40, 40]
    row[14] = 0.95
    return FaceBox(
        bbox=(10, 10, 50, 50),
        landmarks=row[4:14].reshape(5, 2).astype(np.float32),
        confidence=0.95,
        raw_detection=row.reshape(1, -1),
    )


class TestLivenessDetector:

    def test_missing_model_fallback(self, tmp_path):
        missing_model = tmp_path / "nonexistent.onnx"
        detector = LivenessDetector(missing_model)

        assert detector.net is None

        image = np.zeros((100, 100, 3), dtype=np.uint8)
        face = _fake_facebox()
        is_live, conf = detector.predict(image, face)

        assert is_live is True
        assert conf == pytest.approx(1.0)

    def test_crop_expanded_face_size(self, tmp_path):
        missing_model = tmp_path / "nonexistent.onnx"
        detector = LivenessDetector(missing_model)

        image = np.ones((200, 200, 3), dtype=np.uint8) * 128
        face = _fake_facebox()
        crop = detector._crop_expanded_face(image, face)

        assert crop.shape == (80, 80, 3)

    @patch("cv2.dnn.readNetFromONNX")
    def test_predict_with_mocked_onnx_model(self, mock_read_net, tmp_path):
        fake_model = tmp_path / "minifasnet.onnx"
        fake_model.write_bytes(b"dummy_onnx_content")

        mock_net = MagicMock()
        # Mock 3-class logits where index 0 (Real) is highest
        mock_net.forward.return_value = np.array([[2.5, -1.0, -0.5]], dtype=np.float32)
        mock_read_net.return_value = mock_net

        detector = LivenessDetector(fake_model, threshold=0.80)
        assert detector.net is not None

        image = np.ones((200, 200, 3), dtype=np.uint8) * 100
        face = _fake_facebox()
        is_live, conf = detector.predict(image, face)

        assert is_live is True
        assert conf > 0.80
