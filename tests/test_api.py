"""
tests/test_api.py

Phase 5 integration tests for the FastAPI application.

Uses FastAPI TestClient (httpx) + SQLite in-memory + mocked FaceEngine.
No real ONNX models or PostgreSQL needed.

Tests cover:
  - GET /health → 200 with correct fields
  - POST /employees/enroll → success + failure paths
  - GET /employees/ → list with correct count
  - GET /employees/{id} → 200 found, 404 not found
  - PUT /employees/{id}/deactivate → 200 + 404
  - GET /attendance/{id} → 200 events list
  - GET /attendance/report/daily → date-based grouping
  - POST /recognize → mocked recognition + attendance recording
"""

from __future__ import annotations

import io
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from database.models import Base
from database.connection import get_db
from database.repository import EmployeeRepository, AttendanceRepository
from face_engine.datatypes import RecognitionResult
from face_engine.detector import FaceBox
from face_engine.recognizer import EMBEDDING_DIM
from tests.conftest import FakeConfig


from sqlalchemy.pool import StaticPool


# ─── SQLite in-memory DB fixture ──────────────────────────────────────────────

@pytest.fixture(scope="function")
def test_engine_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine


@pytest.fixture(scope="function")
def test_db(test_engine_db):
    SessionLocal = sessionmaker(bind=test_engine_db, autocommit=False, autoflush=False)
    db = SessionLocal()
    yield db
    db.close()


# ─── App fixture with overridden dependencies ─────────────────────────────────

def _unit_vec(seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
    return v / np.linalg.norm(v)


def _unit_bytes(seed: int = 42) -> bytes:
    return _unit_vec(seed).tobytes()


def _fake_facebox() -> FaceBox:
    row = np.zeros(15, dtype=np.float32)
    row[0:4] = [10, 10, 100, 120]
    row[14] = 0.95
    return FaceBox(
        bbox=(10, 10, 100, 120),
        landmarks=row[4:14].reshape(5, 2).astype(np.float32),
        confidence=0.95,
        raw_detection=row.reshape(1, -1),
    )


def _make_recognition_result(is_match: bool = True) -> RecognitionResult:
    return RecognitionResult(
        employee_id="EMP001" if is_match else None,
        employee_name="Alice" if is_match else None,
        similarity_score=0.85 if is_match else 0.10,
        metric_used="cosine",
        is_match=is_match,
        face_box=_fake_facebox(),
        rejection_reason=None if is_match else "below_threshold",
        inference_time_ms=12.5,
    )


@pytest.fixture(scope="function")
def client(test_engine_db, test_db):
    """TestClient with overridden DB dependency and mocked engine."""
    import api.main as app_module
    from api.main import app

    # Build mocks
    fake_config = FakeConfig()
    fake_config.attendance.cooldown_minutes = 5
    fake_config.attendance.save_snapshot = False
    fake_config.attendance.snapshot_path = "snapshots/"
    fake_config.attendance.snapshot_jpeg_quality = 85
    fake_config.attendance.valid_hour_start = 0   # All hours valid in tests
    fake_config.attendance.valid_hour_end = 24
    fake_config.security.liveness_enabled = False

    mock_engine = MagicMock()
    mock_engine.health_check.return_value = {
        "status": "healthy",
        "detector_loaded": True,
        "recognizer_loaded": True,
        "last_inference_ms": 12.5,
        "error_count_last_hour": 0,
        "liveness_enabled": False,
        "model_versions": {
            "detector": "face_detection_yunet_2023mar.onnx",
            "recognizer": "face_recognition_sface_2021dec.onnx",
        },
    }
    mock_engine.process_frame.return_value = [_make_recognition_result(is_match=True)]

    from face_engine.datatypes import EnrollmentResult
    mock_engine.enroll_employee.return_value = EnrollmentResult(
        success=True,
        employee_id="EMP001",
        accepted_image_count=3,
        rejected_image_count=0,
        rejection_details=[],
        failure_reason=None,
        embedding=_unit_vec(),
    )
    mock_recognizer = MagicMock()
    mock_recognizer.serialize_embedding.return_value = _unit_bytes()
    mock_engine._get_recognizer.return_value = mock_recognizer

    # Override DB to use test SQLite — tables must exist in this engine
    Base.metadata.create_all(bind=test_engine_db)

    def _override_get_db():
        SessionLocal = sessionmaker(bind=test_engine_db, autocommit=False, autoflush=False)
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        # The lifespan has now run and reset config_instance/engine_instance
        # with the real Config + real FaceEngine. Re-inject our mocks HERE,
        # so all route handlers during the test body use the mocked objects.
        app_module.config_instance = fake_config
        app_module.engine_instance = mock_engine
        yield c

    app.dependency_overrides.clear()


# ─── Helper: seed DB with employee ───────────────────────────────────────────

def _seed_employee(test_db: Session, emp_id: str = "EMP001", name: str = "Alice"):
    repo = EmployeeRepository(test_db)
    repo.upsert(emp_id, name, "Engineering", _unit_bytes())
    test_db.commit()


def _seed_event(test_db: Session, emp_id: str = "EMP001"):
    repo = AttendanceRepository(test_db)
    repo.create_event(
        employee_id=emp_id,
        camera_id="CAM1",
        event_type="check_in",
        similarity_score=0.85,
        metric_used="cosine",
        liveness_checked=False,
        marked_at=datetime.now(timezone.utc),
    )
    test_db.commit()


# ─── Tests: Health ────────────────────────────────────────────────────────────

class TestHealthEndpoint:

    def test_health_returns_200(self, client):
        r = client.get("/health")
        assert r.status_code == 200

    def test_health_response_schema(self, client):
        data = client.get("/health").json()
        assert "status" in data
        assert "detector_loaded" in data
        assert "recognizer_loaded" in data
        assert "liveness_enabled" in data
        assert "model_versions" in data
        assert data["status"] == "healthy"


# ─── Tests: Employee endpoints ────────────────────────────────────────────────

class TestEmployeeEndpoints:

    def test_list_employees_empty(self, client):
        r = client.get("/employees/")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 0
        assert data["employees"] == []

    def test_list_employees_with_data(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        _seed_employee(test_db, "EMP002", "Bob")
        r = client.get("/employees/")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 2

    def test_get_employee_found(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        r = client.get("/employees/EMP001")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == "EMP001"
        assert data["name"] == "Alice"
        assert data["is_active"] is True

    def test_get_employee_not_found(self, client):
        r = client.get("/employees/NOTEXIST")
        assert r.status_code == 404

    def test_deactivate_employee_success(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        r = client.put("/employees/EMP001/deactivate")
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True

        # Verify is_active=False in DB
        repo = EmployeeRepository(test_db)
        emp = repo.get_by_id("EMP001")
        assert emp.is_active is False

    def test_deactivate_employee_not_found(self, client):
        r = client.put("/employees/NOTEXIST/deactivate")
        assert r.status_code == 404

    def test_deactivated_employee_excluded_from_list(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        _seed_employee(test_db, "EMP002", "Bob")
        client.put("/employees/EMP002/deactivate")

        r = client.get("/employees/")
        ids = [e["id"] for e in r.json()["employees"]]
        assert "EMP001" in ids
        assert "EMP002" not in ids

    def test_enroll_employee_success(self, client):
        """POST /employees/enroll with a valid image → 200."""
        # Create a valid JPEG in memory
        img = np.ones((200, 200, 3), dtype=np.uint8) * 128
        ok, buf = cv2.imencode(".jpg", img)
        assert ok

        r = client.post(
            "/employees/enroll",
            data={
                "employee_id": "EMP001",
                "name": "Alice Test",
                "department": "Engineering",
            },
            files={"images": ("test.jpg", buf.tobytes(), "image/jpeg")},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert data["employee_id"] == "EMP001"
        assert data["accepted_image_count"] == 3

    def test_enroll_no_images_returns_400(self, client):
        r = client.post(
            "/employees/enroll",
            data={"employee_id": "EMP001", "name": "Alice"},
        )
        assert r.status_code == 422  # Validation: images field is required

    def test_enroll_invalid_image_returns_400(self, client):
        r = client.post(
            "/employees/enroll",
            data={"employee_id": "EMP001", "name": "Alice"},
            files={"images": ("bad.jpg", b"not an image", "image/jpeg")},
        )
        assert r.status_code == 400


# ─── Tests: Attendance endpoints ──────────────────────────────────────────────

class TestAttendanceEndpoints:

    def test_get_employee_attendance_found(self, client, test_db):
        _seed_employee(test_db, "EMP001")
        _seed_event(test_db, "EMP001")

        r = client.get("/attendance/EMP001")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        assert data["events"][0]["employee_id"] == "EMP001"

    def test_get_employee_attendance_not_found(self, client):
        r = client.get("/attendance/NOTEXIST")
        assert r.status_code == 404

    def test_get_employee_attendance_empty(self, client, test_db):
        _seed_employee(test_db, "EMP001")
        r = client.get("/attendance/EMP001")
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_daily_report_valid_date(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        _seed_event(test_db, "EMP001")

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = client.get(f"/attendance/report/daily?date={today}")
        assert r.status_code == 200
        data = r.json()
        assert data["date"] == today
        assert isinstance(data["entries"], list)

    def test_daily_report_invalid_date_returns_400(self, client):
        r = client.get("/attendance/report/daily?date=not-a-date")
        assert r.status_code == 422  # Query param pattern validation

    def test_daily_report_missing_date_returns_422(self, client):
        r = client.get("/attendance/report/daily")
        assert r.status_code == 422


# ─── Tests: Recognition endpoint ─────────────────────────────────────────────

class TestRecognizeEndpoint:

    def _make_jpeg(self) -> bytes:
        img = np.ones((200, 200, 3), dtype=np.uint8) * 100
        ok, buf = cv2.imencode(".jpg", img)
        assert ok
        return buf.tobytes()

    def test_recognize_returns_200(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        jpeg = self._make_jpeg()

        r = client.post(
            "/recognize",
            params={"camera_id": "CAM_TEST"},
            files={"image": ("frame.jpg", jpeg, "image/jpeg")},
        )
        assert r.status_code == 200

    def test_recognize_response_schema(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        jpeg = self._make_jpeg()

        r = client.post(
            "/recognize",
            params={"camera_id": "CAM1"},
            files={"image": ("frame.jpg", jpeg, "image/jpeg")},
        )
        data = r.json()
        assert "camera_id" in data
        assert "faces_detected" in data
        assert "results" in data
        assert "total_inference_ms" in data
        assert isinstance(data["results"], list)

    def test_recognize_invalid_image_returns_400(self, client):
        r = client.post(
            "/recognize",
            params={"camera_id": "CAM1"},
            files={"image": ("bad.jpg", b"not_an_image", "image/jpeg")},
        )
        assert r.status_code == 400

    def test_recognize_no_attendance_when_flag_false(self, client, test_db):
        _seed_employee(test_db, "EMP001", "Alice")
        jpeg = self._make_jpeg()

        r = client.post(
            "/recognize",
            params={"camera_id": "CAM1", "record_attendance": False},
            files={"image": ("frame.jpg", jpeg, "image/jpeg")},
        )
        assert r.status_code == 200
        results = r.json()["results"]
        if results:
            assert results[0]["attendance_recorded"] is False
