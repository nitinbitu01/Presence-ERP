"""
tests/test_camera_worker.py

Phase 6 unit tests for scripts/camera_worker.py.

Tests cover:
  - Frame annotation function (drawing boxes, labels, landmarks)
  - CameraWorker initialization
  - Exponential backoff reconnect logic
  - Headless mode execution with mocked VideoCapture
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from face_engine.datatypes import RecognitionResult
from face_engine.detector import FaceBox
from scripts.camera_worker import CameraWorker, annotate_frame
from tests.conftest import FakeConfig


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


class TestFrameAnnotator:

    def test_annotate_frame_matched_person(self):
        frame = np.zeros((200, 200, 3), dtype=np.uint8)
        result = RecognitionResult(
            employee_id="EMP001",
            employee_name="Jane Doe",
            similarity_score=0.88,
            metric_used="cosine",
            is_match=True,
            face_box=_fake_facebox(),
            rejection_reason=None,
            inference_time_ms=10.0,
        )

        annotated = annotate_frame(frame, [result], fps=25.0, camera_id="CAM1")
        assert annotated.shape == frame.shape
        assert annotated.dtype == np.uint8
        # Ensure image was modified (not all zeros anymore)
        assert np.any(annotated != 0)

    def test_annotate_frame_unmatched_person(self):
        frame = np.zeros((200, 200, 3), dtype=np.uint8)
        result = RecognitionResult(
            employee_id=None,
            employee_name=None,
            similarity_score=0.15,
            metric_used="cosine",
            is_match=False,
            face_box=_fake_facebox(),
            rejection_reason="below_threshold",
            inference_time_ms=8.0,
        )

        annotated = annotate_frame(frame, [result], fps=30.0, camera_id="CAM2")
        assert annotated.shape == frame.shape
        assert np.any(annotated != 0)


class TestCameraWorker:

    def test_worker_initialization(self):
        fake_cfg = FakeConfig()
        worker = CameraWorker(
            source=0,
            camera_id="CAM_TEST",
            config=fake_cfg,
            mode="api",
            api_url="http://localhost:8000",
            headless=True,
        )
        assert worker.source == 0
        assert worker.camera_id == "CAM_TEST"
        assert worker.mode == "api"
        assert worker.headless is True

    @patch("cv2.VideoCapture")
    def test_connect_success_on_first_try(self, mock_cap_class):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap_class.return_value = mock_cap

        fake_cfg = FakeConfig()
        worker = CameraWorker(source=0, camera_id="CAM1", config=fake_cfg, mode="api", headless=True)

        assert worker.connect() is True
        assert mock_cap_class.call_count == 1

    @patch("time.sleep")
    @patch("cv2.VideoCapture")
    def test_connect_fails_after_max_attempts(self, mock_cap_class, mock_sleep):
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = False
        mock_cap_class.return_value = mock_cap

        fake_cfg = FakeConfig()
        fake_cfg.camera.reconnect_max_attempts = 3
        fake_cfg.camera.reconnect_backoff_seconds = 0.1

        worker = CameraWorker(source="rtsp://badurl", camera_id="CAM1", config=fake_cfg, mode="api", headless=True)

        assert worker.connect() is False
        assert mock_cap_class.call_count == 3
        assert mock_sleep.call_count == 3
