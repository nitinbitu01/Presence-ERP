"""
api/schemas.py

Pydantic v2 request/response schemas for all API endpoints.

Naming convention:
    - Request bodies: <Resource>CreateRequest, <Resource>UpdateRequest
    - Responses:      <Resource>Response, <Resource>ListResponse
    - Internal:       not exposed in schemas

Employee:
    POST /employees/enroll  → EnrollRequest / EnrollResponse
    GET  /employees/{id}    → EmployeeResponse
    GET  /employees/        → EmployeeListResponse
    PUT  /employees/{id}/deactivate → MessageResponse

Attendance:
    GET /attendance/{employee_id}       → AttendanceListResponse
    GET /attendance/daily-report        → DailyReportResponse

Health:
    GET /health  → HealthResponse
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


# ─── Employee schemas ─────────────────────────────────────────────────────────

class EnrollRequest(BaseModel):
    """POST /employees/enroll — multipart with employee metadata + images."""
    employee_id: str = Field(..., min_length=1, max_length=50, pattern=r"^[A-Za-z0-9_\-]+$")
    name: str = Field(..., min_length=1, max_length=200)
    department: str | None = Field(default=None, max_length=100)

    model_config = {"str_strip_whitespace": True}


class EnrollResponse(BaseModel):
    success: bool
    employee_id: str
    accepted_image_count: int
    rejected_image_count: int
    rejection_details: list[dict[str, Any]]
    failure_reason: str | None
    message: str


class EmployeeResponse(BaseModel):
    id: str
    name: str
    department: str | None
    enrolled_at: datetime
    is_active: bool

    model_config = {"from_attributes": True}


class EmployeeListResponse(BaseModel):
    employees: list[EmployeeResponse]
    total: int


# ─── Attendance schemas ───────────────────────────────────────────────────────

class AttendanceEventResponse(BaseModel):
    id: str
    employee_id: str
    camera_id: str
    event_type: str
    similarity_score: float
    metric_used: str
    snapshot_path: str | None
    liveness_checked: bool
    marked_at: datetime

    model_config = {"from_attributes": True}


class AttendanceListResponse(BaseModel):
    events: list[AttendanceEventResponse]
    total: int


class DailyReportEntry(BaseModel):
    employee_id: str
    employee_name: str
    check_in: datetime | None
    check_out: datetime | None
    total_events: int


class DailyReportResponse(BaseModel):
    date: str          # "YYYY-MM-DD"
    camera_id: str | None
    entries: list[DailyReportEntry]


# ─── Recognition schemas ──────────────────────────────────────────────────────

class RecognizeResponse(BaseModel):
    """Response for a single recognized face in a frame."""
    employee_id: str | None
    employee_name: str | None
    similarity_score: float
    metric_used: str
    is_match: bool
    rejection_reason: str | None
    inference_time_ms: float
    attendance_recorded: bool
    event_type: str | None       # "check_in" / "check_out" / None


class FrameResponse(BaseModel):
    """Response for POST /recognize — one result per detected face."""
    camera_id: str
    faces_detected: int
    results: list[RecognizeResponse]
    total_inference_ms: float


# ─── Stateless vision schemas (no DB writes — caller owns storage) ───────────
#
# Used by clients (e.g. the Presence ERP frontend) that keep their own
# encrypted embedding store and only want YuNet detection + SFace embedding
# extraction / matching as a service, without attendance_face persisting
# anything. See docs/yunet-sface-integration.md in the frontend repo.

class EmbedResponse(BaseModel):
    success: bool
    embedding: list[float] | None       # 128-d SFace embedding, None if failed
    accepted_image_count: int
    rejected_image_count: int
    rejection_details: list[dict[str, Any]]
    failure_reason: str | None


class VerifyRequest(BaseModel):
    """POST /vision/verify — form field alongside the uploaded image."""
    reference_embedding: list[float] = Field(..., min_length=1, max_length=2048)


class VerifyResponse(BaseModel):
    detected: bool
    score: float | None
    is_match: bool
    metric_used: str
    rejection_reason: str | None
    liveness_checked: bool


class ProbeResponse(BaseModel):
    """POST /vision/probe — single-frame detect+embed, no enrollment-grade
    quality gating (no min-image-count, no strict yaw/pitch/blur thresholds).
    Appropriate for check-in frames where liveness/quality has already been
    established by the caller's own client-side pipeline."""
    detected: bool
    embedding: list[float] | None
    rejection_reason: str | None


# ─── Health schemas ───────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    model_config = {"protected_namespaces": ()}  # Allow model_versions field name

    status: str
    detector_loaded: bool
    recognizer_loaded: bool
    last_inference_ms: float
    error_count_last_hour: int
    liveness_enabled: bool
    liveness_warning: str | None = None
    model_versions: dict[str, str]


# ─── Generic ──────────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str
    success: bool = True


class ErrorResponse(BaseModel):
    detail: str
    error_code: str | None = None
