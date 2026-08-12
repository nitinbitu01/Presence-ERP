"""
api/routes/vision.py

Stateless vision endpoints: YuNet detection + SFace embedding/matching with
NO database writes. For callers (e.g. the Presence ERP frontend) that keep
their own encrypted embedding store and only want this service to run the
actual YuNet/SFace models.

POST /vision/embed
    Upload 1-10 face images -> validate (same rules as /employees/enroll:
    single face, min size, frontal angle, sharpness) -> extract 128-d SFace
    embeddings -> average -> return the embedding array. Caller stores it
    (encrypted, wherever they like). Nothing is persisted here.

POST /vision/verify
    Upload one frame + a previously-stored embedding (JSON array of 128
    floats) -> detect the largest face -> extract its embedding -> compare
    against the supplied reference using the same cosine/L2 threshold logic
    as the rest of the engine. Nothing is persisted here.

Both endpoints reuse FaceEngine/FaceDetector/FaceRecognizer exactly as the
stateful endpoints do (same models, same config.yaml thresholds) — the only
difference is nothing is written to attendance_face's own database.
"""

from __future__ import annotations

import json

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from api.schemas import EmbedResponse, ProbeResponse, VerifyResponse
from face_engine.exceptions import EmbeddingDimensionError, FaceEngineError

router = APIRouter(prefix="/vision", tags=["vision (stateless)"])


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
    "/embed",
    response_model=EmbedResponse,
    summary="Detect + extract a 128-d SFace embedding (no DB write)",
    description=(
        "Upload 1-10 frontal face images. Runs the same validation as "
        "/employees/enroll (single face, min size, frontal angle, sharpness), "
        "extracts embeddings, and returns the averaged 128-d vector. "
        "Nothing is saved server-side — the caller owns storage."
    ),
)
async def embed(
    images: list[UploadFile] = File(...),
):
    engine = _get_engine()

    if not images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one image is required.",
        )
    if len(images) > 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 10 images per request.",
        )

    decoded_images = [_decode_upload(f) for f in images]

    try:
        # employee_id is unused for persistence here (embed() never touches
        # the DB) — it only appears in log lines from enroll_employee().
        result = engine.enroll_employee("_stateless_embed_", decoded_images)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face engine error: {exc}",
        )

    embedding_list = result.embedding.tolist() if result.embedding is not None else None

    return EmbedResponse(
        success=result.success,
        embedding=embedding_list,
        accepted_image_count=result.accepted_image_count,
        rejected_image_count=result.rejected_image_count,
        rejection_details=result.rejection_details,
        failure_reason=result.failure_reason,
    )


@router.post(
    "/probe",
    response_model=ProbeResponse,
    summary="Detect + extract embedding from a single frame, no quality gate (no DB write)",
    description=(
        "Upload one frame. Detects the largest face and extracts its 128-d "
        "SFace embedding directly -- no minimum-image-count, no strict "
        "yaw/pitch/blur enforcement (unlike /vision/embed, which is tuned "
        "for curated enrollment photos). Intended for check-in frames where "
        "the caller's own liveness/quality pipeline has already run. "
        "Nothing is saved server-side."
    ),
)
async def probe(
    image: UploadFile = File(...),
):
    engine = _get_engine()
    image_bgr = _decode_upload(image)

    detector = engine._get_detector()
    recognizer = engine._get_recognizer()

    try:
        faces = detector.detect(image_bgr)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Detection failed: {exc}",
        )

    if not faces:
        return ProbeResponse(detected=False, embedding=None, rejection_reason="no_face_detected")

    face = max(faces, key=lambda f: f.bbox[2] * f.bbox[3])

    try:
        embedding = recognizer.align_and_extract(image_bgr, face)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Embedding extraction failed: {exc}",
        )

    return ProbeResponse(detected=True, embedding=embedding.tolist(), rejection_reason=None)


@router.post(
    "/verify",
    response_model=VerifyResponse,
    summary="Detect + compare against a caller-supplied embedding (no DB write)",
    description=(
        "Upload one frame plus reference_embedding (JSON array of 128 floats, "
        "as previously returned by /vision/embed). Detects the largest face, "
        "extracts its embedding, and compares it against the reference using "
        "the configured metric/threshold. If security.liveness_enabled is "
        "true, also runs MiniFASNet anti-spoofing on the detected face."
    ),
)
async def verify(
    image: UploadFile = File(...),
    reference_embedding: str = Form(
        ..., description="JSON array of 128 floats, e.g. \"[0.01, -0.03, ...]\""
    ),
):
    engine = _get_engine()

    try:
        ref_list = json.loads(reference_embedding)
        if not isinstance(ref_list, list) or not ref_list:
            raise ValueError("reference_embedding must be a non-empty JSON array")
        ref_embedding = np.asarray(ref_list, dtype=np.float32)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid reference_embedding: {exc}",
        )

    image_bgr = _decode_upload(image)

    detector = engine._get_detector()
    recognizer = engine._get_recognizer()

    try:
        faces = detector.detect(image_bgr)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Detection failed: {exc}",
        )

    if not faces:
        return VerifyResponse(
            detected=False,
            score=None,
            is_match=False,
            metric_used=_get_config().recognition.metric,
            rejection_reason="no_face_detected",
            liveness_checked=False,
        )

    # Largest face by bbox area — same convention as enrollment validation.
    face = max(faces, key=lambda f: f.bbox[2] * f.bbox[3])

    liveness_checked = False
    if engine._liveness_enabled:
        liveness_checked = True
        if not engine._check_liveness(image_bgr, face):
            return VerifyResponse(
                detected=True,
                score=None,
                is_match=False,
                metric_used=_get_config().recognition.metric,
                rejection_reason="liveness_failed",
                liveness_checked=True,
            )

    try:
        embedding = recognizer.align_and_extract(image_bgr, face)
    except FaceEngineError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Embedding extraction failed: {exc}",
        )

    try:
        score, is_match = recognizer.match(embedding, ref_embedding)
    except EmbeddingDimensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"reference_embedding has wrong shape: {exc}",
        )

    return VerifyResponse(
        detected=True,
        score=round(float(score), 6),
        is_match=is_match,
        metric_used=_get_config().recognition.metric,
        rejection_reason=None if is_match else "below_threshold",
        liveness_checked=liveness_checked,
    )
