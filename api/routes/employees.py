"""
api/routes/employees.py

Employee enrollment and management endpoints.

POST /employees/enroll
    Upload images + metadata → validate → extract embeddings → save to DB.
    Accepts multipart/form-data with fields: employee_id, name, department
    and one or more image files named "images".

GET /employees/
    List all active employees (no embeddings in response).

GET /employees/{employee_id}
    Get single employee by ID.

PUT /employees/{employee_id}/deactivate
    Soft-delete — sets is_active=False. Preserves audit trail.
"""

from __future__ import annotations

import io
from typing import Annotated

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from api.schemas import (
    EnrollRequest,
    EnrollResponse,
    EmployeeListResponse,
    EmployeeResponse,
    MessageResponse,
)
from database.connection import get_db
from database.repository import EmployeeRepository
from face_engine.engine import FaceEngine
from face_engine.exceptions import FaceEngineError

router = APIRouter(prefix="/employees", tags=["employees"])


def _get_engine() -> FaceEngine:
    """Import lazily to avoid circular imports and allow test injection."""
    from api.main import engine_instance
    return engine_instance


def _decode_upload(file: UploadFile) -> np.ndarray:
    """Decode an uploaded image file to BGR numpy array.

    Raises:
        HTTPException 400 if file cannot be decoded as an image.
    """
    data = file.file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot decode image file: {file.filename!r}. "
                   "Supported formats: JPEG, PNG, BMP, TIFF.",
        )
    return img


@router.post(
    "/enroll",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
    summary="Enroll employee with face images",
    description=(
        "Upload 3–10 frontal face images for a new or existing employee. "
        "Each image is validated for: single face, minimum size, frontal angle, sharpness. "
        "A minimum of `min_accepted_images` (config.yaml) must pass to succeed. "
        "Re-enrolling an existing employee_id overwrites their embedding."
    ),
)
async def enroll_employee(
    employee_id: Annotated[str, Form()],
    name: Annotated[str, Form()],
    department: Annotated[str | None, Form()] = None,
    images: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    engine = _get_engine()

    if not images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one image is required for enrollment.",
        )

    # Decode all uploaded images
    decoded_images: list[np.ndarray] = []
    for f in images:
        img = _decode_upload(f)
        decoded_images.append(img)

    # Run enrollment pipeline
    try:
        result = engine.enroll_employee(employee_id, decoded_images)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face engine error during enrollment: {exc}",
        )

    if result.success and result.embedding is not None:
        # Serialize embedding and persist to database
        from face_engine.recognizer import FaceRecognizer
        # Use engine's thread-local recognizer for serialization
        recognizer = engine._get_recognizer()
        embedding_bytes = recognizer.serialize_embedding(result.embedding)

        emp_repo = EmployeeRepository(db)
        emp_repo.upsert(
            employee_id=employee_id,
            name=name,
            department=department,
            embedding_bytes=embedding_bytes,
        )
        db.commit()
        message = (
            f"Enrollment successful. {result.accepted_image_count} images accepted, "
            f"{result.rejected_image_count} rejected."
        )
    else:
        message = (
            f"Enrollment failed: {result.failure_reason}. "
            f"{result.accepted_image_count} images accepted, "
            f"{result.rejected_image_count} rejected. "
            "Submit clearer, frontal images."
        )

    return EnrollResponse(
        success=result.success,
        employee_id=result.employee_id,
        accepted_image_count=result.accepted_image_count,
        rejected_image_count=result.rejected_image_count,
        rejection_details=result.rejection_details,
        failure_reason=result.failure_reason,
        message=message,
    )


@router.get(
    "/",
    response_model=EmployeeListResponse,
    summary="List all active employees",
)
def list_employees(db: Session = Depends(get_db)):
    repo = EmployeeRepository(db)
    employees = repo.get_all_active()
    return EmployeeListResponse(
        employees=[EmployeeResponse.model_validate(e) for e in employees],
        total=len(employees),
    )


@router.get(
    "/{employee_id}",
    response_model=EmployeeResponse,
    summary="Get employee by ID",
)
def get_employee(employee_id: str, db: Session = Depends(get_db)):
    repo = EmployeeRepository(db)
    employee = repo.get_by_id(employee_id)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee {employee_id!r} not found.",
        )
    return EmployeeResponse.model_validate(employee)


@router.put(
    "/{employee_id}/deactivate",
    response_model=MessageResponse,
    summary="Soft-delete employee (preserves attendance records)",
)
def deactivate_employee(employee_id: str, db: Session = Depends(get_db)):
    repo = EmployeeRepository(db)
    success = repo.deactivate(employee_id)
    db.commit()
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee {employee_id!r} not found.",
        )
    return MessageResponse(
        message=f"Employee {employee_id!r} deactivated. Attendance records preserved.",
        success=True,
    )
