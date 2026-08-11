"""
attendance/service.py

Attendance business logic — cooldown enforcement and snapshot saving.

COOLDOWN RULE
-------------
An employee may only have one event recorded per camera per N minutes
(configurable via attendance.cooldown_minutes in config.yaml).

If the last event for this employee+camera is within the cooldown window,
the new event is SILENTLY SKIPPED (returns None, no error raised).
This prevents duplicate entries from brief re-detections.

SNAPSHOT SAVING
---------------
When attendance.save_snapshot is True in config, a JPEG of the full frame
is saved to snapshots/<date>/<employee_id>_<timestamp>.jpg.
The path is stored in the AttendanceEvent record.
Snapshot saving failures are logged as WARNING but DO NOT prevent the
attendance event from being recorded — availability > consistency here.

The service owns the cooldown + snapshot decisions.
The repository owns the SQL.
The engine owns the face recognition.
Routes own request/response shaping.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
import structlog

from database.models import AttendanceEvent
from database.repository import AttendanceRepository
from face_engine.config import Config
from face_engine.datatypes import RecognitionResult

log = structlog.get_logger()


class AttendanceService:
    """Orchestrates attendance marking with cooldown and snapshot logic."""

    def __init__(self, config: Config) -> None:
        self.config = config

    def maybe_record_attendance(
        self,
        result: RecognitionResult,
        camera_id: str,
        image_bgr: np.ndarray,
        attendance_repo: AttendanceRepository,
        now: datetime | None = None,
    ) -> AttendanceEvent | None:
        """Record attendance for a recognized face, respecting cooldown.

        Returns:
            AttendanceEvent if a new record was created.
            None if cooldown is active or result.is_match is False.

        Never raises — all errors are logged as WARNING.
        """
        if not result.is_match or result.employee_id is None:
            return None

        now = now or datetime.now(timezone.utc)

        # ── Cooldown check ────────────────────────────────────────────────
        if self._is_in_cooldown(result.employee_id, camera_id, attendance_repo, now):
            log.debug(
                "attendance_cooldown_active",
                employee_id=result.employee_id,
                camera_id=camera_id,
            )
            return None

        # ── Valid hours check ─────────────────────────────────────────────
        local_hour = now.hour  # UTC hour — adjust per timezone if needed
        start = self.config.attendance.valid_hour_start
        end = self.config.attendance.valid_hour_end
        if not (start <= local_hour < end):
            log.info(
                "attendance_outside_valid_hours",
                employee_id=result.employee_id,
                hour=local_hour,
                valid_start=start,
                valid_end=end,
            )
            return None

        # ── Snapshot ──────────────────────────────────────────────────────
        snapshot_path: str | None = None
        if self.config.attendance.save_snapshot:
            snapshot_path = self._save_snapshot(
                image_bgr=image_bgr,
                employee_id=result.employee_id,
                camera_id=camera_id,
                now=now,
            )

        # ── Determine event_type ──────────────────────────────────────────
        # Simple rule: first event of the day = check_in, second = check_out
        # More sophisticated logic (shift-based) can be added later.
        last = attendance_repo.get_last_event(result.employee_id, camera_id)
        if last is None:
            event_type = "check_in"
        else:
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            if last.marked_at.replace(tzinfo=timezone.utc) < today_start:
                event_type = "check_in"  # New day
            elif last.event_type == "check_in":
                event_type = "check_out"
            else:
                event_type = "check_in"  # Alternate

        # ── Create event ──────────────────────────────────────────────────
        event = attendance_repo.create_event(
            employee_id=result.employee_id,
            camera_id=camera_id,
            event_type=event_type,
            similarity_score=result.similarity_score,
            metric_used=result.metric_used,
            liveness_checked=self.config.security.liveness_enabled,
            snapshot_path=snapshot_path,
            marked_at=now,
        )

        log.info(
            "attendance_recorded",
            employee_id=result.employee_id,
            camera_id=camera_id,
            event_type=event_type,
            similarity_score=round(result.similarity_score, 4),
        )
        return event

    # ─── Private helpers ──────────────────────────────────────────────────────

    def _is_in_cooldown(
        self,
        employee_id: str,
        camera_id: str,
        attendance_repo: AttendanceRepository,
        now: datetime,
    ) -> bool:
        """Return True if last event is within cooldown_minutes."""
        last = attendance_repo.get_last_event(employee_id, camera_id)
        if last is None:
            return False
        last_at = last.marked_at
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        delta = now - last_at
        cooldown = timedelta(minutes=self.config.attendance.cooldown_minutes)
        return delta < cooldown

    def _save_snapshot(
        self,
        image_bgr: np.ndarray,
        employee_id: str,
        camera_id: str,
        now: datetime,
    ) -> str | None:
        """Save full-frame JPEG snapshot. Returns path string or None on error."""
        try:
            base = Path(self.config.attendance.snapshot_path)
            date_dir = base / now.strftime("%Y-%m-%d")
            date_dir.mkdir(parents=True, exist_ok=True)

            ts = now.strftime("%H%M%S")
            safe_cam = camera_id.replace("/", "_").replace(":", "_")
            filename = f"{employee_id}_{safe_cam}_{ts}.jpg"
            filepath = date_dir / filename

            quality = self.config.attendance.snapshot_jpeg_quality
            ok = cv2.imwrite(
                str(filepath),
                image_bgr,
                [cv2.IMWRITE_JPEG_QUALITY, quality],
            )
            if not ok:
                log.warning(
                    "snapshot_write_failed",
                    path=str(filepath),
                    reason="cv2.imwrite returned False",
                )
                return None

            log.debug("snapshot_saved", path=str(filepath))
            return str(filepath)

        except Exception as exc:
            log.warning(
                "snapshot_save_error",
                employee_id=employee_id,
                error=str(exc),
            )
            return None
