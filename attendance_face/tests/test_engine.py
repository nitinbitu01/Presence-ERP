"""
tests/test_engine.py

Phase 4 tests for face_engine/engine.py.

Covers:
  - Thread-local model instances (no shared state)
  - process_frame pipeline (zero faces, single face, multi face)
  - enroll_employee pipeline (success, failure, mixed)
  - Concurrent process_frame with ThreadPoolExecutor (thread safety)
  - health_check returns correct structure
  - shutdown cleans thread-local state
  - Liveness flag propagation

All OpenCV model I/O is mocked — no ONNX files needed.
"""

from __future__ import annotations

import concurrent.futures
import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import numpy as np
import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from face_engine.datatypes import EnrollmentResult, RecognitionResult
from face_engine.detector import FaceBox
from face_engine.engine import FaceEngine
from face_engine.recognizer import EMBEDDING_DIM
from tests.conftest import FakeConfig


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _unit_vec(seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
    return v / np.linalg.norm(v)


def _fake_facebox(x: int = 10, conf: float = 0.95) -> FaceBox:
    row = np.zeros(15, dtype=np.float32)
    row[0:4] = [float(x), 10.0, 100.0, 120.0]
    row[4:14] = [30, 50, 70, 50, 50, 80, 35, 100, 65, 100]
    row[14] = conf
    return FaceBox(
        bbox=(x, 10, 100, 120),
        landmarks=row[4:14].reshape(5, 2).astype(np.float32),
        confidence=conf,
        raw_detection=row.reshape(1, -1),
    )


def _make_engine(config: FakeConfig) -> FaceEngine:
    """Create a FaceEngine with mocked detector and recognizer."""
    engine = object.__new__(FaceEngine)
    engine.config = config
    engine._error_timestamps = __import__("collections").deque(maxlen=1000)
    engine._last_inference_ms = 0.0
    engine._lock = threading.Lock()
    engine._liveness_enabled = config.security.liveness_enabled
    return engine


def _inject_mocks(engine: FaceEngine) -> tuple[MagicMock, MagicMock]:
    """Inject mock detector and recognizer into thread-local storage."""
    mock_detector = MagicMock()
    mock_recognizer = MagicMock()

    # Default: detect returns one face
    mock_detector.detect.return_value = [_fake_facebox()]

    # Default: align_and_extract returns a unit vector
    mock_recognizer.align_and_extract.return_value = _unit_vec(seed=1)

    # Default: match returns (0.85, True) for cosine
    mock_recognizer.match.return_value = (0.85, True)

    # Default: validate_for_enrollment returns (FaceBox, None) = pass
    mock_detector.validate_for_enrollment.return_value = (_fake_facebox(), None)

    # Default: compute_average_embedding returns a unit vector
    mock_recognizer.compute_average_embedding.return_value = _unit_vec(seed=99)

    engine._thread_local.detector = mock_detector
    engine._thread_local.recognizer = mock_recognizer

    return mock_detector, mock_recognizer


# ─── Tests: Thread-local model creation ──────────────────────────────────────

class TestThreadLocal:
    """Verify that FaceEngine uses per-thread model instances."""

    def test_get_detector_creates_on_first_access(self, fake_config):
        """_get_detector lazily creates a FaceDetector on first call."""
        engine = _make_engine(fake_config)

        # Patch FaceDetector constructor to avoid real model load
        with patch("face_engine.engine.FaceDetector") as MockDet:
            MockDet.return_value = MagicMock()
            det1 = engine._get_detector()
            det2 = engine._get_detector()
            # Created once, reused on second call
            assert MockDet.call_count == 1
            assert det1 is det2

    def test_get_recognizer_creates_on_first_access(self, fake_config):
        engine = _make_engine(fake_config)
        with patch("face_engine.engine.FaceRecognizer") as MockRec:
            MockRec.return_value = MagicMock()
            rec1 = engine._get_recognizer()
            rec2 = engine._get_recognizer()
            assert MockRec.call_count == 1
            assert rec1 is rec2

    def test_cleanup_removes_thread_local_state(self, fake_config):
        engine = _make_engine(fake_config)
        _inject_mocks(engine)

        assert hasattr(engine._thread_local, "detector")
        assert hasattr(engine._thread_local, "recognizer")

        engine._cleanup_thread_local()

        assert not hasattr(engine._thread_local, "detector")
        assert not hasattr(engine._thread_local, "recognizer")


# ─── Tests: process_frame ────────────────────────────────────────────────────

class TestProcessFrame:
    """process_frame pipeline tests."""

    def test_zero_faces_returns_empty_list(self, fake_config):
        engine = _make_engine(fake_config)
        mock_det, _ = _inject_mocks(engine)
        mock_det.detect.return_value = []  # No faces

        frame = np.ones((200, 200, 3), dtype=np.uint8)
        results = engine.process_frame(frame, "CAM1", {})

        assert results == []
        assert isinstance(results, list)

    def test_single_face_matched_returns_result(self, fake_config):
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)

        emb_emp = _unit_vec(seed=1)
        employees = {"EMP001": (emb_emp, "Jane Smith")}

        frame = np.ones((300, 300, 3), dtype=np.uint8)
        results = engine.process_frame(frame, "CAM_LOBBY", employees)

        assert len(results) == 1
        r = results[0]
        assert isinstance(r, RecognitionResult)
        assert r.is_match is True
        assert r.employee_id == "EMP001"
        assert r.employee_name == "Jane Smith"
        assert r.rejection_reason is None
        assert r.metric_used == "cosine"

    def test_single_face_no_match_returns_unknown(self, fake_config):
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)
        mock_rec.match.return_value = (0.10, False)  # Below threshold

        employees = {"EMP001": (_unit_vec(seed=5), "Bob")}
        frame = np.ones((300, 300, 3), dtype=np.uint8)
        results = engine.process_frame(frame, "CAM1", employees)

        assert len(results) == 1
        r = results[0]
        assert r.is_match is False
        assert r.employee_id is None
        assert r.employee_name is None
        assert r.rejection_reason == "below_threshold"

    def test_empty_employee_embeddings_returns_unknown(self, fake_config):
        engine = _make_engine(fake_config)
        _inject_mocks(engine)

        frame = np.ones((300, 300, 3), dtype=np.uint8)
        results = engine.process_frame(frame, "CAM1", {})

        assert len(results) == 1
        r = results[0]
        assert r.is_match is False
        assert r.rejection_reason == "no_enrolled_employees"

    def test_multiple_faces_all_processed(self, fake_config):
        """process_frame must process ALL faces, not just the first."""
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)

        # Return 3 faces
        mock_det.detect.return_value = [
            _fake_facebox(x=10, conf=0.95),
            _fake_facebox(x=120, conf=0.88),
            _fake_facebox(x=230, conf=0.92),
        ]

        employees = {"EMP001": (_unit_vec(seed=1), "Alice")}
        frame = np.ones((400, 400, 3), dtype=np.uint8)
        results = engine.process_frame(frame, "CAM1", employees)

        assert len(results) == 3, (
            f"Expected 3 results (one per face), got {len(results)}. "
            "process_frame must process ALL faces, not just the largest."
        )

    def test_best_match_selected_among_employees(self, fake_config):
        """When multiple employees enrolled, best cosine match is selected."""
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)

        # mock match returns different scores for different employees
        mock_rec.match.side_effect = [(0.42, True), (0.88, True)]

        employees = {
            "EMP001": (_unit_vec(seed=1), "Alice"),
            "EMP002": (_unit_vec(seed=2), "Bob"),
        }

        frame = np.ones((300, 300, 3), dtype=np.uint8)
        results = engine.process_frame(frame, "CAM1", employees)

        assert len(results) == 1
        r = results[0]
        assert r.is_match is True
        # Best cosine score is 0.88 → should be EMP002
        assert r.employee_id == "EMP002"
        assert r.employee_name == "Bob"

    def test_process_frame_returns_inference_time(self, fake_config):
        engine = _make_engine(fake_config)
        _inject_mocks(engine)

        results = engine.process_frame(
            np.ones((200, 200, 3), dtype=np.uint8),
            "CAM1",
            {"EMP001": (_unit_vec(), "Test")},
        )
        assert len(results) == 1
        assert results[0].inference_time_ms >= 0.0

    def test_process_frame_never_raises_for_no_match(self, fake_config):
        """No match is a normal case — must return result, not raise."""
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)
        mock_rec.match.return_value = (0.05, False)

        employees = {"EMP001": (_unit_vec(), "Test")}
        # Should not raise
        results = engine.process_frame(
            np.ones((200, 200, 3), dtype=np.uint8), "CAM1", employees
        )
        assert all(r.is_match is False for r in results)


# ─── Tests: enroll_employee ──────────────────────────────────────────────────

class TestEnrollEmployee:
    """Enrollment pipeline tests."""

    def test_successful_enrollment_5_images(self, fake_config):
        engine = _make_engine(fake_config)
        _inject_mocks(engine)

        images = [np.ones((200, 200, 3), dtype=np.uint8) for _ in range(5)]
        result = engine.enroll_employee("EMP001", images)

        assert isinstance(result, EnrollmentResult)
        assert result.success is True
        assert result.employee_id == "EMP001"
        assert result.accepted_image_count == 5
        assert result.rejected_image_count == 0
        assert result.embedding is not None
        assert result.embedding.shape == (EMBEDDING_DIM,)
        assert result.failure_reason is None

    def test_enrollment_fails_insufficient_valid_images(self, fake_config):
        fake_config.enrollment.min_accepted_images = 3
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)

        # All images fail validation
        mock_det.validate_for_enrollment.return_value = (
            None,
            {"reason": "image_too_blurry", "measured_value": 20.0,
             "threshold": 100.0, "description": "Blurry"},
        )

        images = [np.ones((200, 200, 3), dtype=np.uint8) for _ in range(5)]
        result = engine.enroll_employee("EMP001", images)

        assert result.success is False
        assert result.failure_reason == "insufficient_valid_images"
        assert result.embedding is None
        assert result.rejected_image_count == 5

    def test_enrollment_mixed_valid_and_invalid(self, fake_config):
        fake_config.enrollment.min_accepted_images = 3
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)

        # First 3 pass, last 2 fail
        call_count = [0]
        def side_effect_validate(img, emp_id):
            call_count[0] += 1
            if call_count[0] <= 3:
                return (_fake_facebox(), None)
            return (None, {
                "reason": "image_too_blurry",
                "measured_value": 30.0,
                "threshold": 100.0,
                "description": "Blurry",
            })

        mock_det.validate_for_enrollment.side_effect = side_effect_validate

        images = [np.ones((200, 200, 3), dtype=np.uint8) for _ in range(5)]
        result = engine.enroll_employee("EMP001", images)

        assert result.success is True
        assert result.accepted_image_count == 3
        assert result.rejected_image_count == 2
        assert len(result.rejection_details) == 2

    def test_enrollment_collects_rejection_details(self, fake_config):
        fake_config.enrollment.min_accepted_images = 1
        engine = _make_engine(fake_config)
        mock_det, mock_rec = _inject_mocks(engine)

        # Image 0: valid. Image 1: multiple_faces. Image 2: blur.
        call_count = [0]
        def side_effect_validate(img, emp_id):
            call_count[0] += 1
            if call_count[0] == 1:
                return (_fake_facebox(), None)
            elif call_count[0] == 2:
                return (None, {
                    "reason": "multiple_faces_detected",
                    "measured_value": 2,
                    "threshold": 1,
                    "description": "2 faces",
                })
            else:
                return (None, {
                    "reason": "image_too_blurry",
                    "measured_value": 40.0,
                    "threshold": 100.0,
                    "description": "Blurry",
                })

        mock_det.validate_for_enrollment.side_effect = side_effect_validate

        images = [np.ones((200, 200, 3), dtype=np.uint8) for _ in range(3)]
        result = engine.enroll_employee("EMP001", images)

        assert result.success is True
        assert result.accepted_image_count == 1
        assert result.rejected_image_count == 2
        reasons = [d["reason"] for d in result.rejection_details]
        assert "multiple_faces_detected" in reasons
        assert "image_too_blurry" in reasons
        # Each detail has image_index
        for d in result.rejection_details:
            assert "image_index" in d

    def test_enrollment_returns_embedding_none_on_failure(self, fake_config):
        fake_config.enrollment.min_accepted_images = 5
        engine = _make_engine(fake_config)
        mock_det, _ = _inject_mocks(engine)

        # All fail
        mock_det.validate_for_enrollment.return_value = (
            None,
            {"reason": "no_face_detected", "measured_value": 0,
             "threshold": 1, "description": "No face"},
        )

        images = [np.ones((100, 100, 3), dtype=np.uint8) for _ in range(3)]
        result = engine.enroll_employee("EMP001", images)

        assert result.success is False
        assert result.embedding is None


# ─── Tests: Thread safety with ThreadPoolExecutor ────────────────────────────

class TestThreadSafety:
    """Verify concurrent process_frame calls don't corrupt each other."""

    def test_concurrent_process_frame_completes_without_error(self, fake_config):
        """20 concurrent calls across 4 threads — all must complete."""
        engine = _make_engine(fake_config)

        def _worker(i: int) -> list[RecognitionResult]:
            # Each thread gets its own mocks via _inject_mocks
            _inject_mocks(engine)
            frame = np.ones((200, 200, 3), dtype=np.uint8) * (i % 256)
            return engine.process_frame(
                frame, f"CAM_{i}", {"EMP001": (_unit_vec(), "Test")}
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(_worker, i) for i in range(20)]
            results = [f.result() for f in futures]

        assert len(results) == 20, f"Expected 20 results, got {len(results)}"
        # All must have completed (each returns a list)
        for r in results:
            assert isinstance(r, list)

    def test_different_threads_get_different_instances(self, fake_config):
        """Thread-local storage means each thread has its own detector."""
        engine = _make_engine(fake_config)
        detector_ids: list[int] = []
        lock = threading.Lock()

        def _worker():
            with patch("face_engine.engine.FaceDetector") as MockDet:
                mock_instance = MagicMock()
                MockDet.return_value = mock_instance
                det = engine._get_detector()
                with lock:
                    detector_ids.append(id(det))

        threads = [threading.Thread(target=_worker) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Each thread should have created a unique instance
        assert len(set(detector_ids)) == 4, (
            f"Expected 4 unique detector instances (one per thread), "
            f"got {len(set(detector_ids))} unique IDs. "
            "Thread-local storage may not be working correctly."
        )


# ─── Tests: health_check ─────────────────────────────────────────────────────

class TestHealthCheck:

    def test_health_check_structure(self, fake_config):
        engine = _make_engine(fake_config)
        health = engine.health_check()

        assert "status" in health
        assert health["status"] in ("healthy", "degraded", "unhealthy")
        assert "detector_loaded" in health
        assert "recognizer_loaded" in health
        assert "last_inference_ms" in health
        assert "error_count_last_hour" in health
        assert "liveness_enabled" in health
        assert "model_versions" in health
        assert "detector" in health["model_versions"]
        assert "recognizer" in health["model_versions"]

    def test_liveness_warning_when_disabled(self, fake_config):
        fake_config.security.liveness_enabled = False
        engine = _make_engine(fake_config)
        health = engine.health_check()

        assert health["liveness_enabled"] is False
        assert "liveness_warning" in health
        assert "spoofing" in health["liveness_warning"].lower()

    def test_no_liveness_warning_when_enabled(self, fake_config):
        fake_config.security.liveness_enabled = True
        engine = _make_engine(fake_config)
        health = engine.health_check()

        assert health["liveness_enabled"] is True
        assert "liveness_warning" not in health

    def test_healthy_status_with_no_errors(self, fake_config):
        engine = _make_engine(fake_config)
        health = engine.health_check()
        assert health["status"] == "healthy"
        assert health["error_count_last_hour"] == 0

    def test_degraded_status_with_many_errors(self, fake_config):
        engine = _make_engine(fake_config)
        # Add 15 recent errors
        now = time.time()
        for _ in range(15):
            engine._error_timestamps.append(now)

        health = engine.health_check()
        assert health["status"] == "degraded"

    def test_unhealthy_status_with_excessive_errors(self, fake_config):
        engine = _make_engine(fake_config)
        now = time.time()
        for _ in range(55):
            engine._error_timestamps.append(now)

        health = engine.health_check()
        assert health["status"] == "unhealthy"


# ─── Tests: shutdown ─────────────────────────────────────────────────────────

class TestShutdown:

    def test_shutdown_cleans_thread_local(self, fake_config):
        engine = _make_engine(fake_config)
        _inject_mocks(engine)

        assert hasattr(engine._thread_local, "detector")
        engine.shutdown()
        assert not hasattr(engine._thread_local, "detector")
        assert not hasattr(engine._thread_local, "recognizer")


# ─── Tests: Liveness flag propagation ─────────────────────────────────────────

class TestLivenessFlag:

    def test_liveness_enabled_flag_propagated(self, fake_config):
        fake_config.security.liveness_enabled = True
        engine = _make_engine(fake_config)
        assert engine._liveness_enabled is True

    def test_liveness_disabled_flag_propagated(self, fake_config):
        fake_config.security.liveness_enabled = False
        engine = _make_engine(fake_config)
        assert engine._liveness_enabled is False

    def test_process_frame_with_liveness_enabled(self, fake_config):
        """When liveness is enabled, process_frame should still return results."""
        fake_config.security.liveness_enabled = True
        engine = _make_engine(fake_config)
        _inject_mocks(engine)

        employees = {"EMP001": (_unit_vec(), "Test")}
        results = engine.process_frame(
            np.ones((200, 200, 3), dtype=np.uint8), "CAM1", employees
        )
        # Liveness placeholder returns True → face should still match
        assert len(results) == 1
        assert results[0].is_match is True
