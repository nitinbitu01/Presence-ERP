"""
face_engine/exceptions.py

All custom exceptions for the face engine.
Never use bare Exception anywhere in this codebase.
Always raise one of these — callers can catch specifically.
"""


class FaceEngineError(Exception):
    """Base — all face module exceptions inherit from this."""


# ─── Model loading ──────────────────────────────────────────────────────────

class ModelLoadError(FaceEngineError):
    """Model file missing, unreadable, or wrong format."""


class ModelChecksumError(ModelLoadError):
    """SHA256 checksum mismatch — file may be corrupted or tampered."""


# ─── Detection ──────────────────────────────────────────────────────────────

class NoFaceDetectedError(FaceEngineError):
    """Image contains zero detectable faces."""


class MultipleFacesError(FaceEngineError):
    """Image has multiple faces where exactly one was required."""


class FaceTooSmallError(FaceEngineError):
    """Face bounding box is below min_face_size_px threshold."""


class FaceNotFrontalError(FaceEngineError):
    """Yaw or pitch angle exceeds enrollment limit."""


class ImageTooBlurryError(FaceEngineError):
    """Laplacian variance below blur_threshold — image is too blurry."""


class ImageFormatError(FaceEngineError):
    """Cannot decode image bytes — wrong format or corrupted file."""


# ─── Recognition ────────────────────────────────────────────────────────────

class BGR_RGBConversionError(FaceEngineError):  # noqa: N801
    """Image passed to recognizer was not converted to RGB.
    Used in debug/test assertions only — not raised in production paths.
    """


class EmbeddingDimensionError(FaceEngineError):
    """Loaded embedding has wrong dimensions — possible model mismatch.
    Example: expected shape (128,) but got (256,).
    Check that model_filename in face_embeddings table matches current model.
    """


# ─── Enrollment ─────────────────────────────────────────────────────────────

class EnrollmentFailedError(FaceEngineError):
    """Enrollment rejected — insufficient valid images passed validation."""


# ─── Camera ─────────────────────────────────────────────────────────────────

class CameraConnectionError(FaceEngineError):
    """Initial camera connection failed (source unreachable)."""


class CameraStreamError(FaceEngineError):
    """Camera disconnected during active streaming."""


class CameraMaxRetriesError(FaceEngineError):
    """Camera reconnection failed after max_attempts — stream abandoned."""


# ─── Database ───────────────────────────────────────────────────────────────

class DatabaseError(FaceEngineError):
    """Embedding storage or retrieval failure."""


# ─── Configuration ──────────────────────────────────────────────────────────

class ConfigurationError(FaceEngineError):
    """config.yaml missing a required field or contains an invalid value."""
