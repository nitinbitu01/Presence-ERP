"""
api/routes/recognition.py

Live frame recognition endpoint.

POST /recognize
    Upload one JPEG/PNG frame → detect faces → match embeddings →
    optionally record attendance → return results per face.

POST /recognize/frame/{camera_id}
    Streaming-friendly variant — camera_id in path.

Query parameters:
    camera_id (str): Required. Identifies the camera for cooldown tracking.
    record_attendance (bool, default True): If False, recognize only (no DB write).

The embeddings are loaded fresh from DB on every request.
For high-throughput systems (10+ cameras, >30 fps), cache embeddings in
memory and refresh on a background schedule. See README Performance section.
"""

from __future__ import annotations

import time

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from api.schemas import FrameResponse, RecognizeResponse
from attendance.service import AttendanceService
from database.connection import get_db
from database.repository import AttendanceRepository, EmployeeRepository
from face_engine.exceptions import FaceEngineError

router = APIRouter(prefix="/recognize", tags=["recognition"])


def _get_engine():
    from api.main import engine_instance
    return engine_instance


def _get_config():
    from api.main import config_instance
    return config_instance


def _decode_upload(file: UploadFile) -> np.ndarray:
    data = file.file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot decode image: {file.filename!r}.",
        )
    return img


@router.post(
    "",
    response_model=FrameResponse,
    summary="Recognize faces in a frame",
    description=(
        "Upload a single video frame image. "
        "All detected faces are matched against enrolled employees. "
        "If record_attendance=true (default), a cooldown-aware attendance event "
        "is written for each matched face."
    ),
)
async def recognize_frame(
    image: UploadFile = File(...),
    camera_id: str = Query(..., description="Camera identifier for cooldown tracking"),
    record_attendance: bool = Query(True, description="Write attendance event if face matched"),
    db: Session = Depends(get_db),
):
    t0 = time.perf_counter()
    engine = _get_engine()
    config = _get_config()

    # Decode frame
    image_bgr = _decode_upload(image)

    # Load employee embeddings from DB
    emp_repo = EmployeeRepository(db)
    employee_embeddings = emp_repo.load_all_embeddings()

    # Run recognition
    try:
        results = engine.process_frame(image_bgr, camera_id, employee_embeddings)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Recognition failed: {exc}",
        )

    # Optionally record attendance
    att_repo = AttendanceRepository(db)
    service = AttendanceService(config)

    response_results: list[RecognizeResponse] = []
    for r in results:
        event = None
        if record_attendance:
            try:
                event = service.maybe_record_attendance(
                    result=r,
                    camera_id=camera_id,
                    image_bgr=image_bgr,
                    attendance_repo=att_repo,
                )
            except Exception as exc:
                # Never let attendance errors kill the response
                import structlog
                structlog.get_logger().warning(
                    "attendance_record_error", error=str(exc)
                )

        response_results.append(RecognizeResponse(
            employee_id=r.employee_id,
            employee_name=r.employee_name,
            similarity_score=r.similarity_score,
            metric_used=r.metric_used,
            is_match=r.is_match,
            rejection_reason=r.rejection_reason,
            inference_time_ms=r.inference_time_ms,
            attendance_recorded=event is not None,
            event_type=event.event_type if event else None,
        ))

    if record_attendance and any(r.is_match for r in results):
        db.commit()

    total_ms = (time.perf_counter() - t0) * 1000

    return FrameResponse(
        camera_id=camera_id,
        faces_detected=len(results),
        results=response_results,
        total_inference_ms=round(total_ms, 2),
    )
