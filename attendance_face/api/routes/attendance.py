"""
api/routes/attendance.py

Attendance reporting endpoints (read-only).

GET /attendance/{employee_id}
    Return recent events for an employee (default: last 100).

GET /attendance/report/daily
    Return a daily summary: first check-in and last check-out per employee.
    Query params: date (YYYY-MM-DD), camera_id (optional).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from api.schemas import AttendanceListResponse, AttendanceEventResponse, DailyReportEntry, DailyReportResponse
from database.connection import get_db
from database.repository import AttendanceRepository, EmployeeRepository

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.get(
    "/{employee_id}",
    response_model=AttendanceListResponse,
    summary="Get attendance events for one employee",
)
def get_employee_attendance(
    employee_id: str,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    # Verify employee exists
    emp_repo = EmployeeRepository(db)
    if not emp_repo.get_by_id(employee_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee {employee_id!r} not found.",
        )

    att_repo = AttendanceRepository(db)
    events = att_repo.get_events_for_employee(employee_id, limit=limit)
    return AttendanceListResponse(
        events=[AttendanceEventResponse.model_validate(e) for e in events],
        total=len(events),
    )


@router.get(
    "/report/daily",
    response_model=DailyReportResponse,
    summary="Daily check-in / check-out report",
)
def daily_report(
    date: str = Query(..., description="Date in YYYY-MM-DD format", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    camera_id: str | None = Query(None, description="Filter by camera ID"),
    db: Session = Depends(get_db),
):
    try:
        report_date = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid date format: {date!r}. Use YYYY-MM-DD.",
        )

    att_repo = AttendanceRepository(db)
    emp_repo = EmployeeRepository(db)
    events = att_repo.get_events_for_date(report_date, camera_id=camera_id)

    # Group by employee_id
    from collections import defaultdict
    by_employee: dict[str, list] = defaultdict(list)
    for ev in events:
        by_employee[ev.employee_id].append(ev)

    entries: list[DailyReportEntry] = []
    for emp_id, emp_events in by_employee.items():
        emp = emp_repo.get_by_id(emp_id)
        emp_name = emp.name if emp else emp_id

        check_in_events = [e for e in emp_events if e.event_type == "check_in"]
        check_out_events = [e for e in emp_events if e.event_type == "check_out"]

        first_in = min((e.marked_at for e in check_in_events), default=None)
        last_out = max((e.marked_at for e in check_out_events), default=None)

        entries.append(DailyReportEntry(
            employee_id=emp_id,
            employee_name=emp_name,
            check_in=first_in,
            check_out=last_out,
            total_events=len(emp_events),
        ))

    entries.sort(key=lambda e: e.employee_id)

    return DailyReportResponse(
        date=date,
        camera_id=camera_id,
        entries=entries,
    )
