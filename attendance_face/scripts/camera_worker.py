"""
scripts/camera_worker.py

Live RTSP / Webcam stream processor for the Face Recognition Attendance ERP.

Modes:
  1. Direct Mode (--mode direct): Uses local FaceEngine & Database directly.
     Ideal for single-edge deployments.
  2. API Mode (--mode api): Sends video frames via HTTP POST to /recognize endpoint.
     Ideal for distributed multi-camera edge deployments.

Key Features:
  - Frame skipping (config.yaml camera.frame_skip).
  - Stream drop recovery with exponential backoff (reconnect_max_attempts).
  - Real-time bounding box & landmark annotations with FPS overlay.
  - Headless mode (--headless) for server deployments without display.
  - Snapshot saving on attendance record.

Usage:
  python scripts/camera_worker.py --source 0                      # Local webcam (direct)
  python scripts/camera_worker.py --source rtsp://admin:pass@ip:554/live --camera-id CAM_ENTRANCE
  python scripts/camera_worker.py --source 0 --mode api --api-url http://localhost:8000
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from face_engine.config import Config
from face_engine.datatypes import RecognitionResult
from face_engine.engine import FaceEngine


# ─── Frame Annotator ─────────────────────────────────────────────────────────

def annotate_frame(
    frame: np.ndarray,
    results: list[RecognitionResult],
    fps: float,
    camera_id: str,
) -> np.ndarray:
    """Draw bounding boxes, facial landmarks, employee names, and metrics onto frame."""
    annotated = frame.copy()

    for r in results:
        box = r.face_box
        x, y, w, h = box.bbox

        # Color: Green for recognized match, Orange for unknown / un-enrolled face
        color = (0, 255, 0) if r.is_match else (0, 165, 255)
        thickness = 2

        # Draw Bounding Box
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, thickness)

        # Draw 5 Facial Landmarks (eyes, nose, mouth corners)
        for lx, ly in box.landmarks:
            cv2.circle(annotated, (int(lx), int(ly)), 2, (255, 255, 0), -1)

        # Label text
        if r.is_match:
            label = f"{r.employee_name} ({r.similarity_score:.2f})"
        else:
            reason = r.rejection_reason or "unknown"
            label = f"Unknown [{reason}]"

        # Background rectangle for text contrast
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        text_y = max(y - 10, th + 10)
        cv2.rectangle(
            annotated,
            (x, text_y - th - 4),
            (x + tw + 4, text_y + 4),
            color,
            -1,
        )
        cv2.putText(
            annotated,
            label,
            (x + 2, text_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )

    # Info banner (top-left)
    banner = f"Camera: {camera_id} | FPS: {fps:.1f} | Faces: {len(results)}"
    cv2.putText(
        annotated,
        banner,
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )

    return annotated


# ─── Camera Capture Handler with Reconnect Logic ─────────────────────────────

class CameraWorker:
    """Manages video capture lifecycle, frame skipping, and inference loop."""

    def __init__(
        self,
        source: str | int,
        camera_id: str,
        config: Config,
        mode: str = "direct",
        api_url: str = "http://localhost:8000",
        headless: bool = False,
    ) -> None:
        self.source = int(source) if str(source).isdigit() else source
        self.camera_id = camera_id
        self.config = config
        self.mode = mode
        self.api_url = api_url.rstrip("/")
        self.headless = headless

        self.cap: cv2.VideoCapture | None = None
        self.engine: FaceEngine | None = None

        if mode == "direct":
            self.engine = FaceEngine(config)

    def connect(self) -> bool:
        """Connect to VideoCapture with exponential backoff on failure."""
        attempts = 0
        max_attempts = self.config.camera.reconnect_max_attempts
        backoff = self.config.camera.reconnect_backoff_seconds
        multiplier = self.config.camera.reconnect_backoff_multiplier

        while attempts < max_attempts:
            attempts += 1
            print(f"[Camera {self.camera_id}] Opening source {self.source!r} (Attempt {attempts}/{max_attempts})...")

            self.cap = cv2.VideoCapture(self.source)
            if self.cap.isOpened():
                print(f"[Camera {self.camera_id}] Connected successfully.")
                return True

            print(f"[Camera {self.camera_id}] Connection failed. Retrying in {backoff:.1f}s...")
            time.sleep(backoff)
            backoff *= multiplier

        print(f"[Camera {self.camera_id}] ERROR: Could not connect to {self.source!r} after {max_attempts} attempts.")
        return False

    def run() -> None:
        if not self.connect():
            return

        frame_count = 0
        frame_skip = max(1, self.config.camera.frame_skip)
        last_results: list[RecognitionResult] = []

        fps_counter = 0
        fps_start = time.perf_counter()
        fps = 0.0

        # Import DB modules if direct mode
        db_session_factory = None
        att_service = None
        if self.mode == "direct":
            from database.connection import get_session_factory
            from attendance.service import AttendanceService
            db_session_factory = get_session_factory()
            att_service = AttendanceService(self.config)

        print(f"[Camera {self.camera_id}] Starting stream loop (frame_skip={frame_skip}, mode={self.mode})...")
        try:
            while self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret or frame is None:
                    print(f"[Camera {self.camera_id}] Stream disconnected. Attempting reconnect...")
                    self.cap.release()
                    if not self.connect():
                        break
                    continue

                frame_count += 1
                fps_counter += 1

                # Calculate FPS every 30 frames
                now_time = time.perf_counter()
                if now_time - fps_start >= 1.0:
                    fps = fps_counter / (now_time - fps_start)
                    fps_counter = 0
                    fps_start = now_time

                # Run inference on every Nth frame
                if frame_count % frame_skip == 0:
                    if self.mode == "direct" and self.engine and db_session_factory and att_service:
                        db = db_session_factory()
                        try:
                            from database.repository import EmployeeRepository, AttendanceRepository
                            emp_repo = EmployeeRepository(db)
                            att_repo = AttendanceRepository(db)
                            employee_embeddings = emp_repo.load_all_embeddings()

                            last_results = self.engine.process_frame(
                                frame, self.camera_id, employee_embeddings
                            )

                            for r in last_results:
                                att_service.maybe_record_attendance(
                                    result=r,
                                    camera_id=self.camera_id,
                                    image_bgr=frame,
                                    attendance_repo=att_repo,
                                )
                            db.commit()
                        except Exception as exc:
                            db.rollback()
                            print(f"[Camera {self.camera_id}] Frame processing error: {exc}")
                        finally:
                            db.close()

                    elif self.mode == "api":
                        last_results = self._process_via_api(frame)

                # Render UI display
                if not self.headless:
                    annotated = annotate_frame(frame, last_results, fps, str(self.camera_id))
                    cv2.imshow(f"Face Attendance ERP - {self.camera_id}", annotated)

                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q") or key == 27:  # Esc or 'q'
                        print("User requested quit.")
                        break

        except KeyboardInterrupt:
            print("Worker interrupted by user.")
        finally:
            self.stop()

    def _process_via_api(self, frame: np.ndarray) -> list[RecognitionResult]:
        """Send frame to FastAPI /recognize endpoint via httpx."""
        try:
            import httpx
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not ok:
                return []

            response = httpx.post(
                f"{self.api_url}/recognize",
                params={"camera_id": str(self.camera_id), "record_attendance": True},
                files={"image": ("frame.jpg", buf.tobytes(), "image/jpeg")},
                timeout=3.0,
            )
            if response.status_code != 200:
                print(f"API Error {response.status_code}: {response.text}")
                return []

            data = response.json()
            # Convert JSON results back to simplified RecognitionResult list for display
            results = []
            for r in data.get("results", []):
                fake_box = RecognitionResult(
                    employee_id=r.get("employee_id"),
                    employee_name=r.get("employee_name"),
                    similarity_score=r.get("similarity_score", 0.0),
                    metric_used=r.get("metric_used", "cosine"),
                    is_match=r.get("is_match", False),
                    face_box=r.get("face_box", None),
                    rejection_reason=r.get("rejection_reason"),
                    inference_time_ms=r.get("inference_time_ms", 0.0),
                )
                results.append(fake_box)
            return results
        except Exception as exc:
            print(f"API HTTP call failed: {exc}")
            return []

    def stop(self) -> None:
        """Release resources."""
        if self.cap:
            self.cap.release()
            self.cap = None
        if not self.headless:
            cv2.destroyAllWindows()
        if self.engine:
            self.engine.shutdown()
        print(f"[Camera {self.camera_id}] Worker stopped.")


# ─── Entry Point ─────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Live camera stream attendance worker.")
    parser.add_argument("--source", default="0", help="Camera source: index (0), RTSP URL, or video file path")
    parser.add_argument("--camera-id", default="CAM1", help="Identifier for this camera (e.g. CAM_ENTRANCE)")
    parser.add_argument("--mode", choices=["direct", "api"], default="direct", help="Processing mode: direct (DB) or api (HTTP)")
    parser.add_argument("--api-url", default="http://localhost:8000", help="FastAPI backend URL (for api mode)")
    parser.add_argument("--headless", action="store_true", help="Run without OpenCV GUI window")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")

    args = parser.parse_args()

    config = Config.from_yaml(args.config)
    worker = CameraWorker(
        source=args.source,
        camera_id=args.camera_id,
        config=config,
        mode=args.mode,
        api_url=args.api_url,
        headless=args.headless,
    )
    worker.run()


if __name__ == "__main__":
    main()
