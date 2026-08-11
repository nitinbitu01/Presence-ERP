"""
face_engine/__init__.py
Public API surface — external code imports only from here or FaceEngine.
"""

from face_engine.config import Config
from face_engine.exceptions import (
    BGR_RGBConversionError,
    CameraConnectionError,
    CameraMaxRetriesError,
    CameraStreamError,
    ConfigurationError,
    DatabaseError,
    EmbeddingDimensionError,
    EnrollmentFailedError,
    FaceEngineError,
    FaceNotFrontalError,
    FaceTooSmallError,
    ImageFormatError,
    ImageTooBlurryError,
    ModelChecksumError,
    ModelLoadError,
    MultipleFacesError,
    NoFaceDetectedError,
)

__all__ = [
    "Config",
    "FaceEngineError",
    "ModelLoadError",
    "ModelChecksumError",
    "NoFaceDetectedError",
    "MultipleFacesError",
    "FaceTooSmallError",
    "FaceNotFrontalError",
    "ImageTooBlurryError",
    "ImageFormatError",
    "BGR_RGBConversionError",
    "EmbeddingDimensionError",
    "EnrollmentFailedError",
    "CameraConnectionError",
    "CameraStreamError",
    "CameraMaxRetriesError",
    "DatabaseError",
    "ConfigurationError",
]
