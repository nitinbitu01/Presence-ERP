"""
tests/test_vision.py

Tests for the stateless /vision/embed and /vision/verify endpoints.
Reuses the `client` fixture from test_api.py (mocked engine, no real models,
no real DB writes expected from these routes).
"""

from __future__ import annotations

import io
import json

import cv2
import numpy as np
import pytest

from face_engine.detector import FaceBox
from face_engine.exceptions import EmbeddingDimensionError
from face_engine.recognizer import EMBEDDING_DIM
from tests.test_api import client, test_db, test_engine_db, _unit_vec  # noqa: F401


def _jpeg_bytes(color=(255, 255, 255), size=(120, 120)) -> bytes:
    img = np.full((size[1], size[0], 3), color, dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def _fake_facebox() -> FaceBox:
    row = np.zeros(15, dtype=np.float32)
    row[0:4] = [10, 10, 100, 120]
    row[14] = 0.95
    return FaceBox(
        bbox=(10, 10, 100, 120),
        landmarks=row[4:14].reshape(5, 2).astype(np.float32),
        confidence=0.95,
        raw_detection=row.reshape(1, -1),
    )


class TestVisionEmbed:
    def test_embed_success(self, client):
        files = [("images", (f"img{i}.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")) for i in range(3)]
        resp = client.post("/vision/embed", files=files)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["embedding"] is not None
        assert len(body["embedding"]) == EMBEDDING_DIM
        assert body["accepted_image_count"] == 3

    def test_embed_requires_at_least_one_image(self, client):
        resp = client.post("/vision/embed", files=[])
        assert resp.status_code in (400, 422)

    def test_embed_rejects_more_than_ten_images(self, client):
        files = [("images", (f"img{i}.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")) for i in range(11)]
        resp = client.post("/vision/embed", files=files)
        assert resp.status_code == 400

    def test_embed_does_not_touch_db(self, client, test_db):
        """/vision/embed must never persist an employee row."""
        from database.repository import EmployeeRepository
        files = [("images", ("img.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg"))]
        resp = client.post("/vision/embed", files=files)
        assert resp.status_code == 200
        repo = EmployeeRepository(test_db)
        assert repo.get_all_active() == []


class TestVisionProbe:
    def test_probe_no_face(self, client):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = []
        resp = client.post(
            "/vision/probe",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["detected"] is False
        assert body["embedding"] is None
        assert body["rejection_reason"] == "no_face_detected"

    def test_probe_success(self, client):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._get_recognizer.return_value.align_and_extract.return_value = _unit_vec(seed=3)

        resp = client.post(
            "/vision/probe",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["detected"] is True
        assert body["rejection_reason"] is None
        assert len(body["embedding"]) == EMBEDDING_DIM

    def test_probe_no_min_image_count_gate(self, client):
        """Unlike /vision/embed, a single frame must succeed without a 3-image minimum."""
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._get_recognizer.return_value.align_and_extract.return_value = _unit_vec(seed=4)

        resp = client.post(
            "/vision/probe",
            files={"image": ("only_one.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
        )
        assert resp.status_code == 200
        assert resp.json()["detected"] is True

    def test_probe_does_not_touch_db(self, client, test_db):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._get_recognizer.return_value.align_and_extract.return_value = _unit_vec(seed=5)
        from database.repository import EmployeeRepository

        resp = client.post(
            "/vision/probe",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
        )
        assert resp.status_code == 200
        repo = EmployeeRepository(test_db)
        assert repo.get_all_active() == []


class TestVisionVerify:
    def test_verify_no_face_detected(self, client, monkeypatch):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = []

        ref = _unit_vec(seed=1).tolist()
        resp = client.post(
            "/vision/verify",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
            data={"reference_embedding": json.dumps(ref)},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["detected"] is False
        assert body["is_match"] is False
        assert body["rejection_reason"] == "no_face_detected"

    def test_verify_match(self, client):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._get_recognizer.return_value.align_and_extract.return_value = _unit_vec(seed=7)
        app_module.engine_instance._get_recognizer.return_value.match.return_value = (0.91, True)
        app_module.engine_instance._liveness_enabled = False

        ref = _unit_vec(seed=7).tolist()
        resp = client.post(
            "/vision/verify",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
            data={"reference_embedding": json.dumps(ref)},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["detected"] is True
        assert body["is_match"] is True
        assert body["score"] == 0.91

    def test_verify_below_threshold(self, client):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._get_recognizer.return_value.align_and_extract.return_value = _unit_vec(seed=7)
        app_module.engine_instance._get_recognizer.return_value.match.return_value = (0.10, False)
        app_module.engine_instance._liveness_enabled = False

        ref = _unit_vec(seed=99).tolist()
        resp = client.post(
            "/vision/verify",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
            data={"reference_embedding": json.dumps(ref)},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_match"] is False
        assert body["rejection_reason"] == "below_threshold"

    def test_verify_invalid_reference_embedding_json(self, client):
        resp = client.post(
            "/vision/verify",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
            data={"reference_embedding": "not-json"},
        )
        assert resp.status_code == 400

    def test_verify_wrong_dimension_reference_embedding(self, client):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._get_recognizer.return_value.align_and_extract.return_value = _unit_vec(seed=7)
        app_module.engine_instance._get_recognizer.return_value.match.side_effect = EmbeddingDimensionError(
            "bad shape"
        )

        resp = client.post(
            "/vision/verify",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
            data={"reference_embedding": json.dumps([0.1, 0.2, 0.3])},
        )
        assert resp.status_code == 400

    def test_verify_runs_liveness_when_enabled(self, client):
        import api.main as app_module
        app_module.engine_instance._get_detector.return_value.detect.return_value = [_fake_facebox()]
        app_module.engine_instance._liveness_enabled = True
        app_module.engine_instance._check_liveness.return_value = False

        ref = _unit_vec(seed=7).tolist()
        resp = client.post(
            "/vision/verify",
            files={"image": ("frame.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")},
            data={"reference_embedding": json.dumps(ref)},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["liveness_checked"] is True
        assert body["rejection_reason"] == "liveness_failed"
        assert body["is_match"] is False

        # Reset for other tests reusing the module-level mock engine
        app_module.engine_instance._liveness_enabled = False
