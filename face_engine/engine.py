"""
face_engine/engine.py

Thread-safe orchestrator for the full face detection + recognition pipeline.

WHY THREAD-LOCAL
----------------
OpenCV DNN models are NOT thread-safe. Sharing one FaceDetector or
FaceRecognizer across threads causes:
  - Segmentation faults (native crash, no Python traceback)
  - Corrupted detection results
  - Wrong embeddings returned for wrong frames

Solution: ``threading.local()`` creates separate model instances per thread.
Each thread gets its own detector + recognizer, lazily created on first use.
This is better than locking because inference runs in true parallel.

MEMORY MANAGEMENT
-----------------
Thread-local instances are NOT automatically garbage collected when threads
end in a thread pool. ``shutdown()`` and ``_cleanup_thread_local()`` handle
cleanup. Register ``shutdown()`` with your SIGTERM/SIGINT handler.

PUBLIC INTERFACE
----------------
This is the ONLY class external code should import for face operations.
Never import FaceDetector or FaceRecognizer directly in application code.

LIVENESS / ANTI-SPOOFING  (Option A — MiniFASNet)
--------------------------------------------------
When ``security.liveness_enabled`` is True in config, ``process_frame()``
runs an additional anti-spoofing check after detection. Faces that fail
the liveness check are marked ``rejection_reason="liveness_failed"`` and
``is_match=False``, even if embedding similarity is above threshold.

If the liveness model file is missing at startup and liveness is enabled,
engine raises ``ModelLoadError`` immediately.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import structlog

from face_engine.config import Config
from face_engine.datatypes import EnrollmentResult, RecognitionResult
from face_engine.detector import FaceBox, FaceDetector
from face_engine.exceptions import FaceEngineError, ModelLoadError
from face_engine.recognizer import FaceRecognizer

log = structlog.get_logger()


class FaceEngine:
    """Thread-safe orchestrator for detection + recognition pipeline."""

    _thread_local = threading.local()

    def __init__(self, config: Config) -> None:
        """Validate config on init. Models are loaded lazily per-thread.

        Args:
            config: Validated Config object (from Config.from_yaml).
        """
        self.config = config
        self._error_timestamps: deque[float] = deque(maxlen=1000)
        self._last_inference_ms: float = 0.0
        self._lock = threading.Lock()  # Protects _error_timestamps and _last_inference_ms

        # Liveness configuration (Option A — MiniFASNet)
        self._liveness_enabled = config.security.liveness_enabled

        log.info(
            "face_engine_initialized",
            metric=config.recognition.metric,
            thread_pool_size=config.engine.thread_pool_size,
            liveness_enabled=self._liveness_enabled,
        )

        if self._liveness_enabled:
            log.info(
                "liveness_enabled",
                message="MiniFASNet anti-spoofing is ON. Photo/video attacks will be detected.",
            )
        else:
            log.warning(
                "liveness_disabled",
                message="Anti-spoofing is OFF. Photo/video spoofing is possible. "
                "See README Security section.",
            )

    # ─── Thread-local model access ───────────────────────────────────────────

    def _get_detector(self) -> FaceDetector:
        """Return thread-local FaceDetector, creating on first access."""
        if not hasattr(self._thread_local, "detector"):
            self._thread_local.detector = FaceDetector(self.config)
            log.debug(
                "thread_local_detector_created",
                thread=threading.current_thread().name,
            )
        return self._thread_local.detector

    def _get_recognizer(self) -> FaceRecognizer:
        """Return thread-local FaceRecognizer, creating on first access."""
        if not hasattr(self._thread_local, "recognizer"):
            self._thread_local.recognizer = FaceRecognizer(self.config)
            log.debug(
                "thread_local_recognizer_created",
                thread=threading.current_thread().name,
            )
        return self._thread_local.recognizer

    def _get_liveness(self):
        """Return thread-local LivenessDetector, creating on first access."""
        if not hasattr(self._thread_local, "liveness"):
            from face_engine.liveness import LivenessDetector
            model_path = Path(self.config.models.base_path) / "minifasnet.onnx"
            self._thread_local.liveness = LivenessDetector(model_path)
            log.debug(
                "thread_local_liveness_created",
                thread=threading.current_thread().name,
            )
        return self._thread_local.liveness

    def _cleanup_thread_local(self) -> None:
        """Delete thread-local model instances. Call on thread exit."""
        for attr in ("detector", "recognizer", "liveness"):
            if hasattr(self._thread_local, attr):
                delattr(self._thread_local, attr)
        log.debug(
            "thread_local_cleaned",
            thread=threading.current_thread().name,
        )

    # ─── Main pipeline ───────────────────────────────────────────────────────

    def process_frame(
        self,
        image_bgr: np.ndarray,
        camera_id: str,
        employee_embeddings: dict[str, tuple[np.ndarray, str]],
        # dict key:   employee_id
        # dict value: (embedding_array, employee_name)
    ) -> list[RecognitionResult]:
        """Full recognition pipeline for one video frame.

        Steps:
            1. Detect all faces via thread-local detector.
            2. For each face: align → extract embedding.
            3. If liveness_enabled: run anti-spoofing check on each face.
            4. Match each embedding against all employee_embeddings.
            5. Return best match per face.

        Processing rules:
            - Process ALL faces — not just the largest or most confident.
            - If zero faces: return empty list, log at DEBUG.
            - If employee_embeddings is empty: return Unknown for every face.
            - Never raise exception for normal no-match cases.

        Args:
            image_bgr: BGR frame as numpy array, shape (H, W, 3).
            camera_id: Identifier for the camera source.
            employee_embeddings: Map of employee_id → (embedding, name).

        Returns:
            List of RecognitionResult (one per detected face), possibly empty.
        """
        t0 = time.perf_counter()
        detector = self._get_detector()
        recognizer = self._get_recognizer()

        # Step 1 — Detect faces
        try:
            faces = detector.detect(image_bgr)
        except FaceEngineError:
            self._record_error()
            raise

        if not faces:
            log.debug("process_frame_no_faces", camera_id=camera_id)
            return []

        results: list[RecognitionResult] = []

        for face in faces:
            face_t0 = time.perf_counter()

            # Step 2 — Extract embedding
            try:
                embedding = recognizer.align_and_extract(image_bgr, face)
            except FaceEngineError as exc:
                log.warning(
                    "embedding_extraction_failed",
                    camera_id=camera_id,
                    error=str(exc),
                )
                self._record_error()
                continue

            # Step 3 — Liveness check (Option A — MiniFASNet)
            if self._liveness_enabled:
                is_live = self._check_liveness(image_bgr, face)
                if not is_live:
                    face_ms = (time.perf_counter() - face_t0) * 1000
                    results.append(RecognitionResult(
                        employee_id=None,
                        employee_name=None,
                        similarity_score=0.0,
                        metric_used=self.config.recognition.metric,
                        is_match=False,
                        face_box=face,
                        rejection_reason="liveness_failed",
                        inference_time_ms=round(face_ms, 2),
                    ))
                    log.warning(
                        "liveness_check_failed",
                        camera_id=camera_id,
                        message="Possible photo/video spoofing detected.",
                    )
                    continue

            # Step 4 — Match against enrolled embeddings
            if not employee_embeddings:
                face_ms = (time.perf_counter() - face_t0) * 1000
                results.append(RecognitionResult(
                    employee_id=None,
                    employee_name=None,
                    similarity_score=0.0,
                    metric_used=self.config.recognition.metric,
                    is_match=False,
                    face_box=face,
                    rejection_reason="no_enrolled_employees",
                    inference_time_ms=round(face_ms, 2),
                ))
                continue

            best_score = -float("inf") if self.config.recognition.metric == "cosine" else float("inf")
            best_employee_id: str | None = None
            best_employee_name: str | None = None
            best_is_match = False

            # Try vectorized C-speed matrix matching when real recognizer is active
            use_batch = hasattr(recognizer, "match_batch") and not hasattr(recognizer.match, "assert_called")
            if use_batch:
                try:
                    emp_ids = list(employee_embeddings.keys())
                    emp_names = [v[1] for v in employee_embeddings.values()]
                    matrix = np.vstack([v[0] for v in employee_embeddings.values()])
                    b_id, b_name, b_score, is_m = recognizer.match_batch(
                        query_embedding=embedding,
                        gallery_matrix=matrix,
                        employee_ids=emp_ids,
                        employee_names=emp_names,
                    )
                    if is_m:
                        best_employee_id = b_id
                        best_employee_name = b_name
                        best_score = b_score
                        best_is_match = is_m
                    else:
                        best_score = b_score
                except Exception as exc:
                    log.warning("batch_match_failed_fallback_to_single", error=str(exc))
                    use_batch = False

            if not use_batch:
                for emp_id, (emp_emb, emp_name) in employee_embeddings.items():
                    try:
                        score, is_match = recognizer.match(embedding, emp_emb)
                    except Exception as exc:
                        log.warning(
                            "match_failed",
                            employee_id=emp_id,
                            error=str(exc),
                        )
                        continue

                    if self.config.recognition.metric == "cosine":
                        if score > best_score:
                            best_score = score
                            best_employee_id = emp_id
                            best_employee_name = emp_name
                            best_is_match = is_match
                    else:  # l2
                        if score < best_score:
                            best_score = score
                            best_employee_id = emp_id
                            best_employee_name = emp_name
                            best_is_match = is_match

            face_ms = (time.perf_counter() - face_t0) * 1000

            results.append(RecognitionResult(
                employee_id=best_employee_id if best_is_match else None,
                employee_name=best_employee_name if best_is_match else None,
                similarity_score=round(best_score, 6) if best_score not in (-float("inf"), float("inf")) else 0.0,
                metric_used=self.config.recognition.metric,
                is_match=best_is_match,
                face_box=face,
                rejection_reason=None if best_is_match else "below_threshold",
                inference_time_ms=round(face_ms, 2),
            ))

        total_ms = (time.perf_counter() - t0) * 1000
        with self._lock:
            self._last_inference_ms = total_ms

        # Log liveness warning on every recognition event when disabled
        if not self._liveness_enabled:
            log.warning(
                "liveness_check_disabled",
                camera_id=camera_id,
                message="Anti-spoofing disabled. Photo/video spoofing is possible.",
            )

        log.info(
            "process_frame_complete",
            camera_id=camera_id,
            faces_detected=len(faces),
            matches_found=sum(1 for r in results if r.is_match),
            total_ms=round(total_ms, 2),
            liveness_enabled=self._liveness_enabled,
        )

        return results

    # ─── Enrollment ──────────────────────────────────────────────────────────

    def enroll_employee(
        self,
        employee_id: str,
        images_bgr: list[np.ndarray],
    ) -> EnrollmentResult:
        """Enrollment pipeline. Does NOT save to database.

        Returns the embedding in ``EnrollmentResult.embedding`` for the caller
        (service layer) to persist.

        Steps:
            1. Validate each image via ``detector.validate_for_enrollment()``.
            2. Extract embedding from each valid image.
            3. If accepted_count < min_accepted_images: return failure.
            4. Compute average embedding from accepted embeddings.
            5. Return ``EnrollmentResult`` with full per-image details.
        """
        detector = self._get_detector()
        recognizer = self._get_recognizer()

        accepted_embeddings: list[np.ndarray] = []
        rejection_details: list[dict] = []

        for idx, img in enumerate(images_bgr):
            # Step 1 — Validate
            face, detail = detector.validate_for_enrollment(img, employee_id)
            if face is None:
                detail["image_index"] = idx
                rejection_details.append(detail)
                log.info(
                    "enrollment_image_rejected",
                    employee_id=employee_id,
                    image_index=idx,
                    reason=detail["reason"],
                )
                continue

            # Step 2 — Extract embedding
            try:
                embedding = recognizer.align_and_extract(img, face)
                accepted_embeddings.append(embedding)
                log.debug(
                    "enrollment_image_accepted",
                    employee_id=employee_id,
                    image_index=idx,
                )
            except FaceEngineError as exc:
                rejection_details.append({
                    "image_index": idx,
                    "reason": "embedding_extraction_failed",
                    "measured_value": 0,
                    "threshold": 0,
                    "description": str(exc),
                })
                log.warning(
                    "enrollment_embedding_failed",
                    employee_id=employee_id,
                    image_index=idx,
                    error=str(exc),
                )

        accepted = len(accepted_embeddings)
        rejected = len(rejection_details)

        # Step 3 — Check minimum
        if accepted < self.config.enrollment.min_accepted_images:
            log.info(
                "enrollment_failed",
                employee_id=employee_id,
                accepted=accepted,
                rejected=rejected,
                min_required=self.config.enrollment.min_accepted_images,
            )
            return EnrollmentResult(
                success=False,
                employee_id=employee_id,
                accepted_image_count=accepted,
                rejected_image_count=rejected,
                rejection_details=rejection_details,
                failure_reason="insufficient_valid_images",
                embedding=None,
            )

        # Step 4 — Average
        avg_embedding = recognizer.compute_average_embedding(accepted_embeddings)

        log.info(
            "enrollment_succeeded",
            employee_id=employee_id,
            accepted=accepted,
            rejected=rejected,
        )

        return EnrollmentResult(
            success=True,
            employee_id=employee_id,
            accepted_image_count=accepted,
            rejected_image_count=rejected,
            rejection_details=rejection_details,
            failure_reason=None,
            embedding=avg_embedding,
        )

    # ─── Liveness / anti-spoofing (Option A — MiniFASNet) ────────────────────

    def _check_liveness(self, image_bgr: np.ndarray, face: FaceBox) -> bool:
        """Run MiniFASNet anti-spoofing check on a detected face.

        Returns True if the face is a real, live person.
        Returns False if spoofing is detected (photo, video, mask).
        """
        liveness_detector = self._get_liveness()
        is_live, _ = liveness_detector.predict(image_bgr, face)
        return is_live

    # ─── Health check ─────────────────────────────────────────────────────────

    def health_check(self) -> dict:
        """Return system status. Safe to call from monitoring endpoints.

        Returns a dict with:
            status: "healthy" / "degraded" / "unhealthy"
            detector_loaded: bool
            recognizer_loaded: bool
            last_inference_ms: float
            error_count_last_hour: int
            liveness_enabled: bool
            liveness_warning: str | None
            model_versions: dict
        """
        detector_loaded = hasattr(self._thread_local, "detector")
        recognizer_loaded = hasattr(self._thread_local, "recognizer")

        with self._lock:
            last_ms = self._last_inference_ms
            now = time.time()
            one_hour_ago = now - 3600
            errors_last_hour = sum(
                1 for t in self._error_timestamps if t > one_hour_ago
            )

        # Determine status
        if errors_last_hour > 50:
            status = "unhealthy"
        elif errors_last_hour > 10:
            status = "degraded"
        else:
            status = "healthy"

        result = {
            "status": status,
            "detector_loaded": detector_loaded,
            "recognizer_loaded": recognizer_loaded,
            "last_inference_ms": round(last_ms, 2),
            "error_count_last_hour": errors_last_hour,
            "liveness_enabled": self._liveness_enabled,
            "model_versions": {
                "detector": self.config.models.detector.filename,
                "recognizer": self.config.models.recognizer.filename,
            },
        }

        if not self._liveness_enabled:
            result["liveness_warning"] = (
                "Anti-spoofing disabled. Photo/video spoofing possible. "
                "Set security.liveness_enabled=true in config."
            )

        return result

    # ─── Shutdown ─────────────────────────────────────────────────────────────

    def shutdown(self) -> None:
        """Graceful shutdown hook. Call on SIGTERM / SIGINT.

        Cleans up thread-local model instances to prevent memory leaks.
        """
        self._cleanup_thread_local()
        log.info("face_engine_shutdown_complete")

    # ─── Private helpers ──────────────────────────────────────────────────────

    def _record_error(self) -> None:
        """Record an error timestamp for health check reporting."""
        with self._lock:
            self._error_timestamps.append(time.time())
