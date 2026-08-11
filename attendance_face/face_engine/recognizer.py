"""
face_engine/recognizer.py

SFace face recognizer wrapper.

THREAD SAFETY
-------------
NOT thread-safe. One instance per thread.
FaceEngine manages per-thread instances via threading.local(). See engine.py.

CRITICAL — BGR to RGB CONVERSION
---------------------------------
SFace was trained on RGB images. OpenCV loads images as BGR by default.

Passing BGR to FaceRecognizerSF.feature() produces wrong embeddings
with NO error or warning. The model silently returns incorrect vectors.
Similarity scores are degraded; matches fail unpredictably.

Conversion happens INSIDE align_and_extract() — NOT in the caller.
Callers always pass BGR (OpenCV native). This class always converts internally.
The conversion point is marked with an inline comment.

CRITICAL — MATCH SCORE DIRECTION
---------------------------------
FR_COSINE:
  - Returns cosine SIMILARITY (not distance)
  - Range: -1.0 to 1.0 (face pairs typically 0.0–1.0)
  - HIGHER score = MORE similar = same person
  - ACCEPT if score >= cosine_threshold
  - REJECT if score <  cosine_threshold

FR_NORM_L2:
  - Returns L2 DISTANCE (not similarity)
  - Range: 0.0 to ~2.0
  - LOWER score = MORE similar = same person
  - ACCEPT if score <= l2_threshold
  - REJECT if score >  l2_threshold  ← OPPOSITE direction to cosine

Getting the direction wrong causes the system to accept strangers and reject
known employees. Both failure modes have been observed in production deployments.
Explicit assertion tests are included in test_recognizer.py.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import cv2
import numpy as np
import structlog

from face_engine.config import Config
from face_engine.exceptions import (
    EmbeddingDimensionError,
    FaceEngineError,
    ModelChecksumError,
    ModelLoadError,
)

# Import FaceBox from detector to avoid circular dependency through engine
from face_engine.detector import FaceBox

log = structlog.get_logger()

# SFace always produces 128-dimensional embeddings
EMBEDDING_DIM = 128


class FaceRecognizer:
    """Wraps cv2.FaceRecognizerSF (SFace face recognizer)."""

    def __init__(self, config: Config) -> None:
        """Load SFace model.

        Verifies SHA256 checksum before loading (if sha256 set in config).
        Raises ModelChecksumError if checksum fails.
        Raises ModelLoadError if file is missing or cv2 cannot load it.
        """
        self.config = config
        model_path = config.models.recognizer_path()

        # ── File existence ────────────────────────────────────────────────
        if not model_path.exists():
            raise ModelLoadError(
                f"SFace model not found: {model_path.resolve()}. "
                "Run: python scripts/setup_models.py"
            )

        # ── SHA256 verification ───────────────────────────────────────────
        expected_sha = config.models.recognizer.sha256.strip().lower()
        if expected_sha:
            actual_sha = self._sha256(model_path)
            if actual_sha != expected_sha:
                raise ModelChecksumError(
                    f"SFace checksum mismatch for {model_path.name}. "
                    f"Expected: {expected_sha}  Actual: {actual_sha}. "
                    "Re-run: python scripts/setup_models.py"
                )

        # ── Load model ────────────────────────────────────────────────────
        t0 = time.perf_counter()
        try:
            self._recognizer: cv2.FaceRecognizerSF = cv2.FaceRecognizerSF.create(
                model=str(model_path),
                config="",
                backend_id=cv2.dnn.DNN_BACKEND_DEFAULT,
                target_id=cv2.dnn.DNN_TARGET_CPU,
            )
        except cv2.error as exc:
            raise ModelLoadError(
                f"cv2 failed to load SFace from {model_path}: {exc}"
            ) from exc

        load_ms = (time.perf_counter() - t0) * 1000
        log.info(
            "sface_model_loaded",
            filename=model_path.name,
            load_ms=round(load_ms, 2),
            metric=config.recognition.metric,
            checksum_verified=bool(expected_sha),
        )

    # ─── Public API ──────────────────────────────────────────────────────────

    def align_and_extract(
        self,
        image_bgr: np.ndarray,
        face: FaceBox,
    ) -> np.ndarray:
        """Align face crop and extract 128-d embedding.

        Steps:
            1. Convert BGR → RGB  (SFace trained on RGB, OpenCV loads BGR)
            2. alignCrop(image_rgb, face.raw_detection)
               — Uses YuNet 5-point landmarks for affine alignment.
               — DO NOT write a custom affine transform. SFace expects
                 exactly the crop that alignCrop() produces.
            3. feature(aligned_face)
               — Returns shape (1, 128) float32, already L2-normalized.
            4. Return flattened: shape (128,)

        Args:
            image_bgr: Full frame as BGR numpy array.
            face: FaceBox from detector — raw_detection passed to alignCrop.

        Returns:
            L2-normalized 128-d float32 embedding, shape (128,).

        Raises:
            FaceEngineError: If alignment or feature extraction fails.
        """
        t0 = time.perf_counter()

        # Step 1 — Convert BGR→RGB: SFace trained on RGB, OpenCV loads BGR
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

        # Step 2 — Affine-align face using YuNet landmarks
        try:
            aligned = self._recognizer.alignCrop(image_rgb, face.raw_detection)
        except cv2.error as exc:
            raise FaceEngineError(
                f"SFace alignCrop() failed: {exc}. "
                "Ensure raw_detection is the unmodified YuNet output row (shape 1×15)."
            ) from exc

        # Step 3 — Extract embedding
        try:
            embedding_2d = self._recognizer.feature(aligned)  # shape (1, 128)
        except cv2.error as exc:
            raise FaceEngineError(f"SFace feature() failed: {exc}") from exc

        # Step 4 — Flatten to (128,)
        embedding = embedding_2d.flatten().astype(np.float32)

        extract_ms = (time.perf_counter() - t0) * 1000
        log.debug(
            "embedding_extracted",
            shape=embedding.shape,
            norm=round(float(np.linalg.norm(embedding)), 4),
            extract_ms=round(extract_ms, 2),
        )

        return embedding

    def _extract_without_conversion(self, image_any: np.ndarray, face: FaceBox) -> np.ndarray:
        """Extract embedding WITHOUT BGR→RGB conversion.

        FOR TESTING ONLY — used in test_bgr_and_rgb_produce_different_embeddings
        to prove the conversion is necessary.

        DO NOT call this in production code paths.
        """
        try:
            aligned = self._recognizer.alignCrop(image_any, face.raw_detection)
            embedding_2d = self._recognizer.feature(aligned)
        except cv2.error as exc:
            raise FaceEngineError(f"_extract_without_conversion failed: {exc}") from exc
        return embedding_2d.flatten().astype(np.float32)

    def match(
        self,
        embedding1: np.ndarray,
        embedding2: np.ndarray,
    ) -> tuple[float, bool]:
        """Compare two 128-d embeddings.

        Returns:
            (score, is_match) where:
            - score is cosine similarity or L2 distance (see module docstring)
            - is_match is True if the pair are the same person

        ── Direction rules (CRITICAL) ───────────────────────────────────────
        Cosine: ACCEPT if score >= threshold  (higher = more similar)
        L2:     ACCEPT if score <= threshold  (lower  = more similar)
        ─────────────────────────────────────────────────────────────────────

        This method owns ALL threshold comparison logic. Callers receive a
        boolean — they never compare scores themselves.

        Raises:
            EmbeddingDimensionError: If either embedding is not shape (128,) float32.
        """
        self._validate_embedding(embedding1, "embedding1")
        self._validate_embedding(embedding2, "embedding2")

        metric = self.config.recognition.metric

        if metric == "cosine":
            score = float(
                self._recognizer.match(
                    embedding1.reshape(1, -1),
                    embedding2.reshape(1, -1),
                    cv2.FaceRecognizerSF_FR_COSINE,
                )
            )
            is_match = score >= self.config.recognition.cosine_threshold
        elif metric == "l2":
            score = float(
                self._recognizer.match(
                    embedding1.reshape(1, -1),
                    embedding2.reshape(1, -1),
                    cv2.FaceRecognizerSF_FR_NORM_L2,
                )
            )
            is_match = score <= self.config.recognition.l2_threshold
        else:
            raise FaceEngineError(
                f"Unknown metric: {metric!r}. Must be 'cosine' or 'l2'."
            )

        log.debug(
            "embedding_matched",
            metric=metric,
            score=round(score, 6),
            is_match=is_match,
            threshold=(
                self.config.recognition.cosine_threshold
                if metric == "cosine"
                else self.config.recognition.l2_threshold
            ),
        )
        return score, is_match

    def compute_average_embedding(
        self,
        embeddings: list[np.ndarray],
    ) -> np.ndarray:
        """Average multiple embeddings for enrollment (multi-image).

        Averaging breaks L2 normalization — output is explicitly re-normalized.

        Steps:
            1. Validate all inputs: shape (128,), dtype float32.
            2. Stack into (N, 128) array.
            3. Mean across axis=0 → shape (128,).
            4. Re-normalize: result / ||result||
            5. Assert output norm ≈ 1.0 (within 1e-5).

        Returns:
            Re-normalized 128-d float32 embedding.

        Raises:
            ValueError: If embeddings list is empty.
            EmbeddingDimensionError: If any embedding has wrong shape/dtype.
        """
        if not embeddings:
            raise ValueError("compute_average_embedding: embeddings list is empty.")

        for i, emb in enumerate(embeddings):
            self._validate_embedding(emb, f"embeddings[{i}]")

        stacked = np.stack(embeddings, axis=0)   # (N, 128)
        mean_emb = stacked.mean(axis=0)           # (128,)

        norm = np.linalg.norm(mean_emb)
        if norm < 1e-9:
            raise FaceEngineError(
                "Average embedding has near-zero norm — embeddings may be degenerate."
            )

        normalized = (mean_emb / norm).astype(np.float32)

        # Sanity check
        final_norm = np.linalg.norm(normalized)
        assert abs(final_norm - 1.0) < 1e-5, (
            f"Re-normalization failed: norm={final_norm}. Expected 1.0."
        )

        log.debug(
            "average_embedding_computed",
            n_images=len(embeddings),
            output_norm=round(float(final_norm), 6),
        )
        return normalized

    def serialize_embedding(self, embedding: np.ndarray) -> bytes:
        """Serialize embedding to bytes for database storage.

        Uses float32 binary serialization — NOT JSON float encoding.
        JSON encoding causes precision loss that corrupts matching.

        Format: raw bytes of float32 array (128 × 4 = 512 bytes).
        Load with: numpy.frombuffer(data, dtype=numpy.float32)
        """
        self._validate_embedding(embedding, "embedding")
        return embedding.astype(np.float32).tobytes()

    def deserialize_embedding(self, data: bytes) -> np.ndarray:
        """Restore embedding from database bytes.

        Raises:
            EmbeddingDimensionError: If deserialized array is not shape (128,).
        """
        embedding = np.frombuffer(data, dtype=np.float32)
        if embedding.shape != (EMBEDDING_DIM,):
            raise EmbeddingDimensionError(
                f"Deserialized embedding has wrong shape {embedding.shape}. "
                f"Expected ({EMBEDDING_DIM},). "
                "Possible model version mismatch between enrollment and recognition."
            )
        return embedding

    # ─── Private helpers ─────────────────────────────────────────────────────

    def _validate_embedding(self, embedding: np.ndarray, name: str) -> None:
        """Raise EmbeddingDimensionError if embedding is not shape (128,) float32."""
        if not isinstance(embedding, np.ndarray):
            raise EmbeddingDimensionError(
                f"{name} must be a numpy array, got {type(embedding).__name__}."
            )
        if embedding.shape != (EMBEDDING_DIM,):
            raise EmbeddingDimensionError(
                f"{name} has wrong shape {embedding.shape}. "
                f"Expected ({EMBEDDING_DIM},). "
                "Check model version — SFace always produces 128-d embeddings."
            )

    @staticmethod
    def _sha256(path: Path) -> str:
        """Compute SHA256 hash of a file."""
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
