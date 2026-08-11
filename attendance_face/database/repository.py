"""
database/repository.py

Repository pattern — all SQL is here, never in routes or services.

EmployeeRepository:
    - upsert(employee_id, name, department, embedding_bytes) → Employee
    - get_by_id(employee_id) → Employee | None
    - get_all_active() → list[Employee]
    - deactivate(employee_id) → bool
    - load_all_embeddings() → dict[str, tuple[np.ndarray, str]]
      Returns the full embedding cache for FaceEngine.process_frame().

AttendanceRepository:
    - create_event(...) → AttendanceEvent
    - get_last_event(employee_id, camera_id) → AttendanceEvent | None
      Used by cooldown check — fetches latest event for this employee+camera.
    - get_events_for_employee(employee_id, limit) → list[AttendanceEvent]
    - get_events_for_date(date, camera_id) → list[AttendanceEvent]

COOLDOWN LOGIC
--------------
Cooldown is NOT in the repository. It belongs in attendance/service.py.
The repository only provides get_last_event() so the service can compute
time delta. This keeps SQL concerns separate from business rules.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import numpy as np
import structlog
from sqlalchemy.orm import Session

from database.models import AttendanceEvent, Employee
from face_engine.recognizer import EMBEDDING_DIM

log = structlog.get_logger()


class EmployeeRepository:
    """Data access for the employees table."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def upsert(
        self,
        employee_id: str,
        name: str,
        department: str | None,
        embedding_bytes: bytes,
    ) -> Employee:
        """Insert new employee or update existing one's embedding + metadata.

        UPSERT strategy:
            If employee_id already exists → update name, department, embedding,
            set is_active=True (re-enrollment reactivates deactivated employees).
            If not exists → insert new record.

        embedding_bytes MUST be raw float32 bytes (512 bytes = 128 × 4).
        Never pass JSON-encoded floats — precision loss corrupts matching.
        """
        existing = self.db.get(Employee, employee_id)
        if existing:
            existing.name = name
            existing.department = department
            existing.embedding = embedding_bytes
            existing.is_active = True
            existing.enrolled_at = datetime.now(timezone.utc)
            employee = existing
            log.info("employee_updated", employee_id=employee_id)
        else:
            employee = Employee(
                id=employee_id,
                name=name,
                department=department,
                embedding=embedding_bytes,
                enrolled_at=datetime.now(timezone.utc),
                is_active=True,
            )
            self.db.add(employee)
            log.info("employee_created", employee_id=employee_id)

        self.db.flush()  # Flush to catch DB errors before commit
        return employee

    def get_by_id(self, employee_id: str) -> Employee | None:
        """Fetch one employee by PK. Returns None if not found."""
        return self.db.get(Employee, employee_id)

    def get_all_active(self) -> list[Employee]:
        """Fetch all active employees (is_active=True)."""
        return (
            self.db.query(Employee)
            .filter(Employee.is_active == True)  # noqa: E712
            .order_by(Employee.name)
            .all()
        )

    def deactivate(self, employee_id: str) -> bool:
        """Soft-delete: set is_active=False. Returns False if not found."""
        employee = self.db.get(Employee, employee_id)
        if not employee:
            return False
        employee.is_active = False
        self.db.flush()
        log.info("employee_deactivated", employee_id=employee_id)
        return True

    def load_all_embeddings(self) -> dict[str, tuple[np.ndarray, str]]:
        """Load all active employee embeddings into memory.

        Returns:
            Dict mapping employee_id → (embedding_array, employee_name).
            Passed directly to FaceEngine.process_frame().

        Embeddings are deserialized from raw float32 bytes.
        Shape is validated: must be (128,). Corrupt embeddings are skipped
        with a WARNING rather than crashing the recognition pipeline.
        """
        employees = self.get_all_active()
        result: dict[str, tuple[np.ndarray, str]] = {}
        skipped = 0

        for emp in employees:
            try:
                embedding = np.frombuffer(emp.embedding, dtype=np.float32)
                if embedding.shape != (EMBEDDING_DIM,):
                    log.warning(
                        "corrupt_embedding_skipped",
                        employee_id=emp.id,
                        shape=embedding.shape,
                        expected=(EMBEDDING_DIM,),
                    )
                    skipped += 1
                    continue
                result[emp.id] = (embedding, emp.name)
            except Exception as exc:
                log.warning(
                    "embedding_deserialize_error",
                    employee_id=emp.id,
                    error=str(exc),
                )
                skipped += 1

        log.info(
            "embeddings_loaded",
            total=len(employees),
            loaded=len(result),
            skipped=skipped,
        )
        return result


class AttendanceRepository:
    """Data access for the attendance_events table."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def create_event(
        self,
        employee_id: str,
        camera_id: str,
        event_type: str,
        similarity_score: float,
        metric_used: str,
        liveness_checked: bool,
        snapshot_path: str | None = None,
        marked_at: datetime | None = None,
    ) -> AttendanceEvent:
        """Insert one attendance event. Returns the persisted record."""
        event = AttendanceEvent(
            id=str(uuid.uuid4()),
            employee_id=employee_id,
            camera_id=camera_id,
            event_type=event_type,
            similarity_score=similarity_score,
            metric_used=metric_used,
            snapshot_path=snapshot_path,
            liveness_checked=liveness_checked,
            marked_at=marked_at or datetime.now(timezone.utc),
        )
        self.db.add(event)
        self.db.flush()
        log.info(
            "attendance_event_created",
            employee_id=employee_id,
            event_type=event_type,
            camera_id=camera_id,
        )
        return event

    def get_last_event(
        self,
        employee_id: str,
        camera_id: str,
    ) -> AttendanceEvent | None:
        """Fetch the most recent event for this employee+camera pair.

        Used by the cooldown check in attendance/service.py.
        Returns None if no prior event exists.
        """
        return (
            self.db.query(AttendanceEvent)
            .filter(
                AttendanceEvent.employee_id == employee_id,
                AttendanceEvent.camera_id == camera_id,
            )
            .order_by(AttendanceEvent.marked_at.desc())
            .first()
        )

    def get_events_for_employee(
        self,
        employee_id: str,
        limit: int = 100,
    ) -> list[AttendanceEvent]:
        """Fetch recent attendance events for one employee."""
        return (
            self.db.query(AttendanceEvent)
            .filter(AttendanceEvent.employee_id == employee_id)
            .order_by(AttendanceEvent.marked_at.desc())
            .limit(limit)
            .all()
        )

    def get_events_for_date(
        self,
        date: datetime,
        camera_id: str | None = None,
    ) -> list[AttendanceEvent]:
        """Fetch all attendance events for a given UTC date.

        date: any datetime — only the date part (year, month, day) is used.
        camera_id: optional filter.
        """
        from sqlalchemy import func

        start = datetime(date.year, date.month, date.day, 0, 0, 0, tzinfo=timezone.utc)
        end = datetime(date.year, date.month, date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)

        query = self.db.query(AttendanceEvent).filter(
            AttendanceEvent.marked_at >= start,
            AttendanceEvent.marked_at <= end,
        )
        if camera_id:
            query = query.filter(AttendanceEvent.camera_id == camera_id)

        return query.order_by(AttendanceEvent.marked_at.asc()).all()
