"""
tests/test_repository.py

Phase 5 tests for database/repository.py.

Uses SQLite in-memory — no PostgreSQL required.
SQLAlchemy 2.0 engine with Base.metadata.create_all().

Tests cover:
  - Employee upsert (insert + overwrite)
  - get_by_id found / not-found
  - get_all_active filters inactive
  - deactivate sets is_active=False
  - load_all_embeddings: correct shape, skips corrupt
  - AttendanceEvent: create, get_last, get_by_employee, get_by_date
  - Cooldown: get_last_event returns most-recent
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from database.models import Base
from database.repository import AttendanceRepository, EmployeeRepository
from face_engine.recognizer import EMBEDDING_DIM


from sqlalchemy.pool import StaticPool

# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def db_session() -> Session:
    """In-memory SQLite session. Isolated per test function."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def _unit_bytes(seed: int = 42) -> bytes:
    """Return 512 bytes of a valid unit-norm float32 embedding."""
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
    v = v / np.linalg.norm(v)
    return v.tobytes()


def _make_employee(db: Session, emp_id: str = "EMP001", name: str = "Alice", seed: int = 1):
    repo = EmployeeRepository(db)
    repo.upsert(emp_id, name, "Engineering", _unit_bytes(seed))
    db.commit()
    return repo.get_by_id(emp_id)


def _make_event(
    db: Session,
    emp_id: str = "EMP001",
    camera_id: str = "CAM1",
    event_type: str = "check_in",
    minutes_ago: int = 0,
):
    now = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    repo = AttendanceRepository(db)
    event = repo.create_event(
        employee_id=emp_id,
        camera_id=camera_id,
        event_type=event_type,
        similarity_score=0.85,
        metric_used="cosine",
        liveness_checked=False,
        snapshot_path=None,
        marked_at=now,
    )
    db.commit()
    return event


# ─── Tests: EmployeeRepository ────────────────────────────────────────────────

class TestEmployeeRepositoryInsert:

    def test_upsert_creates_new_employee(self, db_session):
        repo = EmployeeRepository(db_session)
        emp = repo.upsert("EMP001", "Alice", "Eng", _unit_bytes())
        db_session.commit()
        assert emp.id == "EMP001"
        assert emp.name == "Alice"
        assert emp.department == "Eng"
        assert emp.is_active is True

    def test_upsert_overwrites_existing_employee(self, db_session):
        _make_employee(db_session, "EMP001", "Alice", seed=1)

        repo = EmployeeRepository(db_session)
        repo.upsert("EMP001", "Alice Updated", "HR", _unit_bytes(seed=99))
        db_session.commit()

        updated = repo.get_by_id("EMP001")
        assert updated.name == "Alice Updated"
        assert updated.department == "HR"
        # Embedding bytes changed
        new_emb = np.frombuffer(updated.embedding, dtype=np.float32)
        assert new_emb.shape == (EMBEDDING_DIM,)

    def test_upsert_reactivates_deactivated_employee(self, db_session):
        _make_employee(db_session, "EMP001", "Alice")

        repo = EmployeeRepository(db_session)
        repo.deactivate("EMP001")
        db_session.commit()

        emp = repo.get_by_id("EMP001")
        assert emp.is_active is False

        # Re-enroll
        repo.upsert("EMP001", "Alice", None, _unit_bytes())
        db_session.commit()

        emp = repo.get_by_id("EMP001")
        assert emp.is_active is True, "Re-enrollment must reactivate the employee"

    def test_get_by_id_returns_none_for_missing(self, db_session):
        repo = EmployeeRepository(db_session)
        result = repo.get_by_id("NONEXISTENT")
        assert result is None

    def test_get_all_active_excludes_deactivated(self, db_session):
        _make_employee(db_session, "EMP001", "Alice", seed=1)
        _make_employee(db_session, "EMP002", "Bob", seed=2)
        _make_employee(db_session, "EMP003", "Carol", seed=3)

        repo = EmployeeRepository(db_session)
        repo.deactivate("EMP002")
        db_session.commit()

        active = repo.get_all_active()
        ids = [e.id for e in active]
        assert "EMP001" in ids
        assert "EMP003" in ids
        assert "EMP002" not in ids, "Deactivated employee must not appear in get_all_active()"

    def test_get_all_active_returns_empty_when_none(self, db_session):
        repo = EmployeeRepository(db_session)
        result = repo.get_all_active()
        assert result == []

    def test_deactivate_returns_false_for_missing(self, db_session):
        repo = EmployeeRepository(db_session)
        result = repo.deactivate("NONEXISTENT")
        assert result is False

    def test_deactivate_returns_true_for_existing(self, db_session):
        _make_employee(db_session, "EMP001")
        repo = EmployeeRepository(db_session)
        result = repo.deactivate("EMP001")
        db_session.commit()
        assert result is True


class TestLoadAllEmbeddings:

    def test_load_all_embeddings_correct_shape(self, db_session):
        _make_employee(db_session, "EMP001", "Alice", seed=1)
        _make_employee(db_session, "EMP002", "Bob", seed=2)

        repo = EmployeeRepository(db_session)
        embeddings = repo.load_all_embeddings()

        assert len(embeddings) == 2
        for emp_id, (emb, name) in embeddings.items():
            assert emb.shape == (EMBEDDING_DIM,), f"{emp_id}: wrong shape {emb.shape}"
            assert emb.dtype == np.float32

    def test_load_all_embeddings_excludes_deactivated(self, db_session):
        _make_employee(db_session, "EMP001", "Alice", seed=1)
        _make_employee(db_session, "EMP002", "Bob", seed=2)

        repo = EmployeeRepository(db_session)
        repo.deactivate("EMP002")
        db_session.commit()

        embeddings = repo.load_all_embeddings()
        assert "EMP001" in embeddings
        assert "EMP002" not in embeddings

    def test_load_all_embeddings_skips_corrupt(self, db_session):
        """Corrupt embedding (wrong byte count) is skipped, not crashed on."""
        from database.models import Employee
        from datetime import datetime, timezone

        # Insert employee with corrupt embedding (64 bytes instead of 512)
        corrupt_emp = Employee(
            id="EMP_CORRUPT",
            name="Bad Data",
            embedding=b"\x00" * 64,  # 16 floats, not 128
            enrolled_at=datetime.now(timezone.utc),
            is_active=True,
        )
        db_session.add(corrupt_emp)
        db_session.commit()

        _make_employee(db_session, "EMP001", "Alice", seed=1)

        repo = EmployeeRepository(db_session)
        embeddings = repo.load_all_embeddings()

        # Corrupt one skipped, valid one kept
        assert "EMP_CORRUPT" not in embeddings, (
            "Corrupt embedding must be silently skipped, not crash the pipeline."
        )
        assert "EMP001" in embeddings

    def test_load_all_embeddings_name_is_correct(self, db_session):
        _make_employee(db_session, "EMP001", "Jane Smith", seed=1)
        repo = EmployeeRepository(db_session)
        embeddings = repo.load_all_embeddings()
        _, name = embeddings["EMP001"]
        assert name == "Jane Smith"


# ─── Tests: AttendanceRepository ─────────────────────────────────────────────

class TestAttendanceRepository:

    def test_create_event_returns_record(self, db_session):
        _make_employee(db_session)
        event = _make_event(db_session, "EMP001", "CAM1", "check_in")
        assert event.id is not None
        assert event.employee_id == "EMP001"
        assert event.event_type == "check_in"
        assert event.similarity_score == pytest.approx(0.85)
        assert event.liveness_checked is False

    def test_create_event_uuid_is_unique(self, db_session):
        _make_employee(db_session)
        ev1 = _make_event(db_session, "EMP001", "CAM1", "check_in")
        ev2 = _make_event(db_session, "EMP001", "CAM1", "check_out")
        assert ev1.id != ev2.id

    def test_get_last_event_returns_most_recent(self, db_session):
        _make_employee(db_session)
        # Older event: 60 minutes ago
        _make_event(db_session, "EMP001", "CAM1", "check_in", minutes_ago=60)
        # Recent event: 5 minutes ago
        _make_event(db_session, "EMP001", "CAM1", "check_out", minutes_ago=5)

        repo = AttendanceRepository(db_session)
        last = repo.get_last_event("EMP001", "CAM1")

        assert last is not None
        assert last.event_type == "check_out", (
            "get_last_event must return the MOST RECENT event, not the oldest."
        )

    def test_get_last_event_returns_none_when_no_events(self, db_session):
        _make_employee(db_session)
        repo = AttendanceRepository(db_session)
        result = repo.get_last_event("EMP001", "CAM1")
        assert result is None

    def test_get_last_event_isolated_by_camera_id(self, db_session):
        """Events on different cameras must not bleed into each other."""
        _make_employee(db_session)
        _make_event(db_session, "EMP001", "CAM1", "check_in", minutes_ago=10)
        _make_event(db_session, "EMP001", "CAM2", "check_in", minutes_ago=5)

        repo = AttendanceRepository(db_session)
        last_cam1 = repo.get_last_event("EMP001", "CAM1")
        last_cam2 = repo.get_last_event("EMP001", "CAM2")

        assert last_cam1.camera_id == "CAM1"
        assert last_cam2.camera_id == "CAM2"

    def test_get_events_for_employee_respects_limit(self, db_session):
        _make_employee(db_session)
        for i in range(10):
            _make_event(db_session, "EMP001", "CAM1", "check_in", minutes_ago=i * 10)

        repo = AttendanceRepository(db_session)
        events = repo.get_events_for_employee("EMP001", limit=3)
        assert len(events) == 3

    def test_get_events_for_date_filters_correctly(self, db_session):
        _make_employee(db_session)
        today = datetime.now(timezone.utc)
        _make_event(db_session, "EMP001", "CAM1", "check_in", minutes_ago=30)

        repo = AttendanceRepository(db_session)
        events = repo.get_events_for_date(today, camera_id="CAM1")
        assert len(events) >= 1
        for ev in events:
            assert ev.camera_id == "CAM1"


# ─── Tests: Cooldown pattern ──────────────────────────────────────────────────

class TestCooldownPattern:
    """Verify get_last_event is usable for cooldown logic."""

    def test_recent_event_within_5_minutes(self, db_session):
        _make_employee(db_session)
        _make_event(db_session, "EMP001", "CAM1", "check_in", minutes_ago=2)

        repo = AttendanceRepository(db_session)
        last = repo.get_last_event("EMP001", "CAM1")
        assert last is not None

        now = datetime.now(timezone.utc)
        last_at = last.marked_at.replace(tzinfo=timezone.utc)
        delta = now - last_at
        cooldown = timedelta(minutes=5)

        assert delta < cooldown, (
            "Event 2 minutes ago should be within 5-minute cooldown. "
            "Cooldown service would block a new event."
        )

    def test_old_event_outside_cooldown(self, db_session):
        _make_employee(db_session)
        _make_event(db_session, "EMP001", "CAM1", "check_in", minutes_ago=10)

        repo = AttendanceRepository(db_session)
        last = repo.get_last_event("EMP001", "CAM1")

        now = datetime.now(timezone.utc)
        last_at = last.marked_at.replace(tzinfo=timezone.utc)
        delta = now - last_at
        cooldown = timedelta(minutes=5)

        assert delta > cooldown, (
            "Event 10 minutes ago should be outside 5-minute cooldown. "
            "Cooldown service would allow a new event."
        )
