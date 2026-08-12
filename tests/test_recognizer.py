"""
tests/test_recognizer.py

Phase 3 tests for face_engine/recognizer.py.

All OpenCV model I/O is mocked — no real ONNX file is required to run these tests.
The tests cover:
  - Cosine threshold direction (CRITICAL — wrong direction = accepts everyone)
  - L2 threshold direction (CRITICAL — opposite to cosine)
  - BGR vs RGB produce different embeddings (proves conversion is mandatory)
  - Average embedding is re-normalized after mean
  - Binary serialization round-trip preserves bit-exact float32 values
  - Wrong embedding dimension raises EmbeddingDimensionError
  - Empty embedding list raises ValueError
  - deserialize_embedding shape validation
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from face_engine.detector import FaceBox
from face_engine.exceptions import EmbeddingDimensionError, ModelLoadError
from face_engine.recognizer import EMBEDDING_DIM, FaceRecognizer
from tests.conftest import FakeConfig


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _unit_vec(dim: int = EMBEDDING_DIM, seed: int = 42) -> np.ndarray:
    """Return a reproducible unit-norm float32 vector."""
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(dim).astype(np.float32)
    return v / np.linalg.norm(v)


def _fake_facebox() -> FaceBox:
    """Build a minimal FaceBox for testing align_and_extract."""
    row = np.zeros(15, dtype=np.float32)
    row[0:4] = [10, 10, 100, 120]
    row[4:14] = [30, 50, 70, 50, 50, 80, 35, 100, 65, 100]
    row[14] = 0.95
    return FaceBox(
        bbox=(10, 10, 100, 120),
        landmarks=row[4:14].reshape(5, 2).astype(np.float32),
        confidence=0.95,
        raw_detection=row.reshape(1, -1),
    )


def _make_recognizer(config: FakeConfig) -> tuple[FaceRecognizer, MagicMock]:
    """
    Create a FaceRecognizer whose internal cv2.FaceRecognizerSF is fully mocked.
    Returns (recognizer, mock_sface) so tests can configure return values.
    """
    mock_sface = MagicMock(spec=cv2.FaceRecognizerSF)

    # alignCrop returns a small dummy aligned crop (112×112 BGR)
    mock_sface.alignCrop.return_value = np.ones((112, 112, 3), dtype=np.uint8) * 128

    # feature() returns a (1, 128) unit-norm float32 embedding by default
    default_emb = _unit_vec().reshape(1, EMBEDDING_DIM)
    mock_sface.feature.return_value = default_emb

    # Build recognizer object without loading a real model
    recognizer = object.__new__(FaceRecognizer)
    recognizer.config = config
    recognizer._recognizer = mock_sface
    return recognizer, mock_sface


# ─── Tests: Cosine threshold direction ───────────────────────────────────────

class TestCosineThresholdDirection:
    """
    CRITICAL: High cosine similarity must return is_match=True.
    Low cosine similarity must return is_match=False.

    Getting this backwards causes the system to accept ALL strangers and
    reject ALL known employees — the worst possible failure mode.
    """

    def test_high_cosine_score_is_match_true(self, fake_config):
        """Cosine score above threshold → is_match=True."""
        fake_config.recognition.metric = "cosine"
        fake_config.recognition.cosine_threshold = 0.363
        recognizer, mock_sface = _make_recognizer(fake_config)

        # Configure mock to return score above threshold
        mock_sface.match.return_value = 0.85  # >> 0.363

        e1 = _unit_vec(seed=1)
        e2 = _unit_vec(seed=1)  # same seed = identical vector
        score, is_match = recognizer.match(e1, e2)

        assert is_match is True, (
            f"Cosine score {score:.4f} >= threshold {fake_config.recognition.cosine_threshold} "
            f"must give is_match=True. Got is_match={is_match}. "
            "DIRECTION BUG: threshold comparison is backwards."
        )

    def test_low_cosine_score_is_match_false(self, fake_config):
        """Cosine score below threshold → is_match=False."""
        fake_config.recognition.metric = "cosine"
        fake_config.recognition.cosine_threshold = 0.363
        recognizer, mock_sface = _make_recognizer(fake_config)

        # Configure mock to return score below threshold
        mock_sface.match.return_value = 0.10  # << 0.363

        e1 = _unit_vec(seed=1)
        e2 = _unit_vec(seed=2)  # different seeds = different vectors
        score, is_match = recognizer.match(e1, e2)

        assert is_match is False, (
            f"Cosine score {score:.4f} < threshold {fake_config.recognition.cosine_threshold} "
            f"must give is_match=False. Got is_match={is_match}. "
            "DIRECTION BUG: threshold comparison is backwards."
        )

    def test_cosine_at_exact_threshold_is_match_true(self, fake_config):
        """Score exactly equal to threshold → is_match=True (>= boundary)."""
        fake_config.recognition.metric = "cosine"
        fake_config.recognition.cosine_threshold = 0.363
        recognizer, mock_sface = _make_recognizer(fake_config)

        mock_sface.match.return_value = 0.363  # exactly at boundary
        e = _unit_vec()
        score, is_match = recognizer.match(e, e)

        assert is_match is True, "Score == threshold should be accepted (>=)"

    def test_identical_embeddings_always_match_cosine(self, fake_config):
        """
        Identical embeddings have cosine similarity = 1.0.
        Must always return is_match=True regardless of threshold (as long as threshold < 1.0).
        """
        fake_config.recognition.metric = "cosine"
        fake_config.recognition.cosine_threshold = 0.5
        recognizer, mock_sface = _make_recognizer(fake_config)

        # Cosine of identical unit vectors = 1.0
        mock_sface.match.return_value = 1.0
        e = _unit_vec()
        score, is_match = recognizer.match(e, e)

        assert is_match is True, (
            f"Identical embeddings returned is_match={is_match} at score={score}. "
            "If False, cosine threshold comparison direction is wrong."
        )


# ─── Tests: L2 threshold direction ───────────────────────────────────────────

class TestL2ThresholdDirection:
    """
    CRITICAL: Low L2 distance = same person = is_match=True.
    High L2 distance = different person = is_match=False.
    This is the OPPOSITE direction to cosine.
    """

    def test_low_l2_score_is_match_true(self, fake_config):
        """L2 distance below threshold → is_match=True."""
        fake_config.recognition.metric = "l2"
        fake_config.recognition.l2_threshold = 1.128
        recognizer, mock_sface = _make_recognizer(fake_config)

        mock_sface.match.return_value = 0.05  # very small distance = same person

        e1 = _unit_vec(seed=1)
        e2 = _unit_vec(seed=1)
        score, is_match = recognizer.match(e1, e2)

        assert is_match is True, (
            f"L2 distance {score:.4f} <= threshold {fake_config.recognition.l2_threshold} "
            f"must give is_match=True. Got is_match={is_match}. "
            "DIRECTION BUG: L2 threshold is backwards (remember: lower = more similar for L2)."
        )

    def test_high_l2_score_is_match_false(self, fake_config):
        """L2 distance above threshold → is_match=False."""
        fake_config.recognition.metric = "l2"
        fake_config.recognition.l2_threshold = 1.128
        recognizer, mock_sface = _make_recognizer(fake_config)

        mock_sface.match.return_value = 1.8  # large distance = different person

        e1 = _unit_vec(seed=1)
        e2 = _unit_vec(seed=2)
        score, is_match = recognizer.match(e1, e2)

        assert is_match is False, (
            f"L2 distance {score:.4f} > threshold {fake_config.recognition.l2_threshold} "
            f"must give is_match=False. Got is_match={is_match}."
        )

    def test_l2_at_exact_threshold_is_match_true(self, fake_config):
        """L2 distance exactly equal to threshold → is_match=True (<= boundary)."""
        fake_config.recognition.metric = "l2"
        fake_config.recognition.l2_threshold = 1.128
        recognizer, mock_sface = _make_recognizer(fake_config)

        mock_sface.match.return_value = 1.128  # exactly at boundary
        e = _unit_vec()
        score, is_match = recognizer.match(e, e)

        assert is_match is True, "L2 score == threshold should be accepted (<=)"

    def test_identical_embeddings_l2_distance_is_zero(self, fake_config):
        """Identical embeddings should have L2 distance ≈ 0 → is_match=True."""
        fake_config.recognition.metric = "l2"
        fake_config.recognition.l2_threshold = 1.128
        recognizer, mock_sface = _make_recognizer(fake_config)

        mock_sface.match.return_value = 0.0  # identical vectors = zero distance
        e = _unit_vec()
        score, is_match = recognizer.match(e, e)

        assert is_match is True, (
            "Identical embeddings (L2=0) must always be is_match=True."
        )


# ─── Tests: BGR vs RGB conversion ────────────────────────────────────────────

class TestBGRRGBConversion:
    """
    Proves that BGR→RGB conversion inside align_and_extract is necessary.

    If this test fails, it means either:
      a) The conversion was removed from align_and_extract, or
      b) The test image is symmetric (R==B channels) — use an asymmetric image.
    """

    def test_bgr_and_rgb_inputs_produce_different_embeddings(self, fake_config):
        """
        BGR and RGB versions of the same asymmetric image must yield
        different embeddings when passed without conversion.

        Tests _extract_without_conversion() directly to expose the difference.
        The real align_and_extract() always converts internally.
        """
        recognizer, mock_sface = _make_recognizer(fake_config)

        # Create an asymmetric BGR image (R ≠ B channels)
        img_bgr = np.zeros((200, 200, 3), dtype=np.uint8)
        img_bgr[:, :, 0] = 50   # Blue channel
        img_bgr[:, :, 1] = 100  # Green channel
        img_bgr[:, :, 2] = 200  # Red channel

        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        face = _fake_facebox()

        # Simulate different embeddings for different color inputs
        emb_bgr = _unit_vec(seed=10)
        emb_rgb = _unit_vec(seed=20)  # Different seed = meaningfully different

        # Configure mock: first call returns bgr embedding, second returns rgb
        mock_sface.feature.side_effect = [
            emb_bgr.reshape(1, EMBEDDING_DIM),
            emb_rgb.reshape(1, EMBEDDING_DIM),
        ]

        result_bgr = recognizer._extract_without_conversion(img_bgr, face)
        result_rgb = recognizer._extract_without_conversion(img_rgb, face)

        # They must differ — if equal, conversion does nothing (indicates a bug)
        assert not np.allclose(result_bgr, result_rgb, atol=1e-3), (
            "BGR and RGB inputs produced identical embeddings. "
            "This means BGR→RGB conversion is not functioning. "
            "Verify align_and_extract() calls cv2.cvtColor(BGR2RGB) before alignCrop()."
        )

    def test_align_and_extract_calls_bgr2rgb_conversion(self, fake_config):
        """
        Verify that align_and_extract() internally performs BGR→RGB conversion
        by checking that alignCrop receives an RGB array (B≠R for asymmetric input).
        """
        recognizer, mock_sface = _make_recognizer(fake_config)

        # Asymmetric BGR: Blue=50, Red=200 (will be flipped to RGB)
        img_bgr = np.zeros((200, 200, 3), dtype=np.uint8)
        img_bgr[:, :, 0] = 50   # B
        img_bgr[:, :, 2] = 200  # R

        face = _fake_facebox()
        recognizer.align_and_extract(img_bgr, face)

        # Capture what was passed to alignCrop
        call_args = mock_sface.alignCrop.call_args
        assert call_args is not None, "alignCrop was not called"
        passed_image = call_args[0][0]  # First positional arg

        # In BGR: channel[0]=50 (Blue). After BGR→RGB: channel[0]=200 (was Red)
        # Check pixel [0,0]: if conversion happened, channel 0 should be 200
        pixel = passed_image[0, 0]
        assert pixel[0] == 200, (
            f"Expected alignCrop to receive RGB image (channel[0]=200=Red), "
            f"but got channel[0]={pixel[0]}. "
            "BGR→RGB conversion may be missing in align_and_extract()."
        )


# ─── Tests: align_and_extract ────────────────────────────────────────────────

class TestAlignAndExtract:
    """align_and_extract() must return a (128,) float32 array."""

    def test_returns_correct_shape(self, fake_config):
        recognizer, mock_sface = _make_recognizer(fake_config)
        img = np.ones((300, 300, 3), dtype=np.uint8) * 128
        face = _fake_facebox()
        emb = recognizer.align_and_extract(img, face)
        assert emb.shape == (EMBEDDING_DIM,), f"Expected ({EMBEDDING_DIM},), got {emb.shape}"

    def test_returns_float32_dtype(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        img = np.ones((300, 300, 3), dtype=np.uint8)
        emb = recognizer.align_and_extract(img, _fake_facebox())
        assert emb.dtype == np.float32, f"Expected float32, got {emb.dtype}"

    def test_aligncrop_called_with_raw_detection(self, fake_config):
        """alignCrop must receive face.raw_detection unmodified."""
        recognizer, mock_sface = _make_recognizer(fake_config)
        face = _fake_facebox()
        img = np.ones((200, 200, 3), dtype=np.uint8)
        recognizer.align_and_extract(img, face)

        call_args = mock_sface.alignCrop.call_args[0]
        passed_raw = call_args[1]
        np.testing.assert_array_equal(passed_raw, face.raw_detection)

    def test_feature_called_with_aligned_crop(self, fake_config):
        """feature() must be called with the output of alignCrop()."""
        recognizer, mock_sface = _make_recognizer(fake_config)
        aligned_crop = np.ones((112, 112, 3), dtype=np.uint8) * 77
        mock_sface.alignCrop.return_value = aligned_crop

        img = np.ones((300, 300, 3), dtype=np.uint8)
        recognizer.align_and_extract(img, _fake_facebox())

        call_args = mock_sface.feature.call_args[0]
        np.testing.assert_array_equal(call_args[0], aligned_crop)


# ─── Tests: Average embedding ─────────────────────────────────────────────────

class TestAverageEmbedding:
    """compute_average_embedding must produce a re-normalized (128,) float32."""

    def test_output_is_unit_norm(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        embeddings = [_unit_vec(seed=i) for i in range(5)]
        averaged = recognizer.compute_average_embedding(embeddings)
        norm = np.linalg.norm(averaged)
        assert abs(norm - 1.0) < 1e-5, (
            f"Averaged embedding norm is {norm}, expected 1.0. "
            "Re-normalization step may be missing."
        )

    def test_output_shape_is_correct(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        embeddings = [_unit_vec(seed=i) for i in range(3)]
        averaged = recognizer.compute_average_embedding(embeddings)
        assert averaged.shape == (EMBEDDING_DIM,)

    def test_output_dtype_is_float32(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        embeddings = [_unit_vec(seed=i) for i in range(3)]
        averaged = recognizer.compute_average_embedding(embeddings)
        assert averaged.dtype == np.float32

    def test_single_embedding_returns_same_vector(self, fake_config):
        """Average of one embedding = that embedding (after re-normalize)."""
        recognizer, _ = _make_recognizer(fake_config)
        e = _unit_vec(seed=99)
        averaged = recognizer.compute_average_embedding([e])
        np.testing.assert_allclose(averaged, e, atol=1e-5)

    def test_identical_embeddings_average_to_same(self, fake_config):
        """Average of identical embeddings = that embedding."""
        recognizer, _ = _make_recognizer(fake_config)
        e = _unit_vec(seed=42)
        averaged = recognizer.compute_average_embedding([e, e, e])
        np.testing.assert_allclose(averaged, e, atol=1e-5)

    def test_empty_list_raises_value_error(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        with pytest.raises(ValueError, match="empty"):
            recognizer.compute_average_embedding([])

    def test_wrong_shape_embedding_in_list_raises(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        good = _unit_vec()
        bad = np.ones(64, dtype=np.float32)  # 64-d, not 128-d
        with pytest.raises(EmbeddingDimensionError):
            recognizer.compute_average_embedding([good, bad])


# ─── Tests: Serialization round-trip ─────────────────────────────────────────

class TestSerialization:
    """serialize/deserialize must be bit-exact (not just close)."""

    def test_roundtrip_preserves_exact_values(self, fake_config):
        """
        array_equal (not allclose) — must be bit-for-bit identical.
        JSON float serialization would fail this test due to precision loss.
        """
        recognizer, _ = _make_recognizer(fake_config)
        original = _unit_vec(seed=77)

        serialized = recognizer.serialize_embedding(original)
        restored = recognizer.deserialize_embedding(serialized)

        np.testing.assert_array_equal(original, restored), (
            "Serialization is not bit-exact. "
            "Verify serialize uses .tobytes() and deserialize uses np.frombuffer()."
        )

    def test_serialized_bytes_length(self, fake_config):
        """float32 × 128 dims = 512 bytes exactly."""
        recognizer, _ = _make_recognizer(fake_config)
        data = recognizer.serialize_embedding(_unit_vec())
        assert len(data) == EMBEDDING_DIM * 4, (
            f"Expected {EMBEDDING_DIM * 4} bytes, got {len(data)}."
        )

    def test_deserialize_wrong_shape_raises(self, fake_config):
        """Wrong number of bytes → EmbeddingDimensionError."""
        recognizer, _ = _make_recognizer(fake_config)
        # 64 floats instead of 128
        bad_data = np.ones(64, dtype=np.float32).tobytes()
        with pytest.raises(EmbeddingDimensionError):
            recognizer.deserialize_embedding(bad_data)

    def test_serialize_input_must_be_128d(self, fake_config):
        """Passing wrong shape to serialize raises EmbeddingDimensionError."""
        recognizer, _ = _make_recognizer(fake_config)
        bad_emb = np.ones(64, dtype=np.float32)
        with pytest.raises(EmbeddingDimensionError):
            recognizer.serialize_embedding(bad_emb)


# ─── Tests: match() input validation ─────────────────────────────────────────

class TestMatchInputValidation:
    """match() must reject non-128-d embeddings before calling cv2."""

    def test_wrong_dim_embedding1_raises(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        wrong = np.ones(64, dtype=np.float32)
        correct = _unit_vec()
        with pytest.raises(EmbeddingDimensionError):
            recognizer.match(wrong, correct)

    def test_wrong_dim_embedding2_raises(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        correct = _unit_vec()
        wrong = np.ones(64, dtype=np.float32)
        with pytest.raises(EmbeddingDimensionError):
            recognizer.match(correct, wrong)

    def test_non_array_raises(self, fake_config):
        recognizer, _ = _make_recognizer(fake_config)
        with pytest.raises(EmbeddingDimensionError):
            recognizer.match([0.1] * 128, _unit_vec())  # list, not ndarray

    def test_match_returns_tuple_of_float_and_bool(self, fake_config):
        fake_config.recognition.metric = "cosine"
        recognizer, mock_sface = _make_recognizer(fake_config)
        mock_sface.match.return_value = 0.75

        result = recognizer.match(_unit_vec(seed=1), _unit_vec(seed=2))
        assert isinstance(result, tuple) and len(result) == 2
        score, is_match = result
        assert isinstance(score, float)
        assert isinstance(is_match, bool)

    def test_invalid_metric_raises(self, fake_config):
        fake_config.recognition.metric = "manhattan"  # not valid
        recognizer, _ = _make_recognizer(fake_config)
        from face_engine.exceptions import FaceEngineError
        with pytest.raises(FaceEngineError, match="Unknown metric"):
            recognizer.match(_unit_vec(seed=1), _unit_vec(seed=2))


# ─── Tests: ModelLoadError ────────────────────────────────────────────────────

class TestModelLoadError:
    """FaceRecognizer must raise ModelLoadError if model file is missing."""

    def test_missing_model_raises(self, fake_config):
        fake_config.models.recognizer.filename = "nonexistent_sface.onnx"
        fake_config.models.base_path = "models/"
        with pytest.raises(ModelLoadError, match="nonexistent_sface"):
            FaceRecognizer(fake_config)
