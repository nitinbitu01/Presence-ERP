"""
tests/conftest.py — Shared pytest fixtures.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

# Ensure the project root is on sys.path so imports work from tests/
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))


# ─── Minimal config fixture without needing real model files ─────────────────

class _FakeModelFile:
    filename: str
    sha256: str

    def __init__(self, filename: str, sha256: str = ""):
        self.filename = filename
        self.sha256 = sha256


class _FakeModelsConfig:
    def __init__(self, base_path: str = "models/"):
        self.base_path = base_path
        self.detector = _FakeModelFile("face_detection_yunet_2023mar.onnx")
        self.recognizer = _FakeModelFile("face_recognition_sface_2021dec.onnx")

    def detector_path(self) -> Path:
        return Path(self.base_path) / self.detector.filename

    def recognizer_path(self) -> Path:
        return Path(self.base_path) / self.recognizer.filename


class _FakeDetectionConfig:
    confidence_threshold: float = 0.6
    min_face_size_px: int = 80
    input_size: list = [320, 320]
    max_faces_per_frame: int = 10


class _FakeRecognitionConfig:
    cosine_threshold: float = 0.363
    l2_threshold: float = 1.128
    metric: str = "cosine"


class _FakeEnrollmentConfig:
    required_images: int = 5
    min_accepted_images: int = 3
    blur_threshold: float = 100.0
    max_yaw_degrees: float = 30.0
    max_pitch_degrees: float = 20.0


class _FakeAttendanceConfig:
    cooldown_minutes: int = 5
    save_snapshot: bool = False
    snapshot_path: str = "snapshots/"
    snapshot_format: str = "jpg"
    snapshot_jpeg_quality: int = 85
    valid_hour_start: int = 6
    valid_hour_end: int = 22


class _FakeCameraConfig:
    frame_skip: int = 4
    reconnect_max_attempts: int = 5
    reconnect_backoff_seconds: float = 2.0
    reconnect_backoff_multiplier: float = 2.0
    frame_buffer_size: int = 2
    read_timeout_seconds: float = 5.0


class _FakeEngineConfig:
    thread_pool_size: int = 4


class _FakeLoggingConfig:
    level: str = "INFO"
    format: str = "json"
    file: str = "logs/test_attendance.log"
    max_bytes: int = 1048576
    backup_count: int = 2


class _FakeSecurityConfig:
    liveness_enabled: bool = False


class FakeConfig:
    """Minimal Config-compatible object for use in tests (no YAML, no disk I/O)."""
    models = _FakeModelsConfig()
    detection = _FakeDetectionConfig()
    recognition = _FakeRecognitionConfig()
    enrollment = _FakeEnrollmentConfig()
    attendance = _FakeAttendanceConfig()
    camera = _FakeCameraConfig()
    engine = _FakeEngineConfig()
    logging = _FakeLoggingConfig()
    security = _FakeSecurityConfig()


@pytest.fixture
def fake_config() -> FakeConfig:
    return FakeConfig()


# ─── Simple image fixtures ───────────────────────────────────────────────────

@pytest.fixture
def blank_white_image() -> np.ndarray:
    """100×100 white BGR image. Contains no face."""
    return np.ones((100, 100, 3), dtype=np.uint8) * 255


@pytest.fixture
def blank_black_image() -> np.ndarray:
    """100×100 black BGR image. Contains no face."""
    return np.zeros((100, 100, 3), dtype=np.uint8)


@pytest.fixture
def tiny_5x5_image() -> np.ndarray:
    """5×5 image — edge case for very small inputs."""
    return np.zeros((5, 5, 3), dtype=np.uint8)
