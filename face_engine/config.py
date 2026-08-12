"""
face_engine/config.py

Loads config.yaml + .env and provides a typed Config object.
This is the single source of truth for all runtime configuration.
Secrets come from environment variables / .env file.
Algorithm parameters come from config.yaml.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog
import yaml
from dotenv import load_dotenv

from face_engine.exceptions import ConfigurationError

log = structlog.get_logger()

# Load .env file from project root (or wherever the app is launched from).
# This is a no-op if .env does not exist (e.g., in CI where env vars are injected).
load_dotenv()

# ─── Pattern for ${VAR:default} env-var interpolation ──────────────────────
_ENV_PATTERN = re.compile(r"\$\{([^}:]+)(?::([^}]*))?\}")


def _interpolate(value: Any) -> Any:
    """Recursively expand ${VAR:default} placeholders in config values."""
    if isinstance(value, str):
        def _replace(m: re.Match) -> str:
            var_name = m.group(1)
            default = m.group(2) if m.group(2) is not None else ""
            return os.environ.get(var_name, default)
        return _ENV_PATTERN.sub(_replace, value)
    if isinstance(value, dict):
        return {k: _interpolate(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate(v) for v in value]
    return value


# ─── Typed sub-configs ──────────────────────────────────────────────────────

@dataclass
class ModelFileConfig:
    filename: str
    sha256: str = ""


@dataclass
class ModelsConfig:
    base_path: str
    detector: ModelFileConfig
    recognizer: ModelFileConfig

    def detector_path(self) -> Path:
        return Path(self.base_path) / self.detector.filename

    def recognizer_path(self) -> Path:
        return Path(self.base_path) / self.recognizer.filename


@dataclass
class DetectionConfig:
    confidence_threshold: float
    min_face_size_px: int
    input_size: list[int]
    max_faces_per_frame: int


@dataclass
class RecognitionConfig:
    cosine_threshold: float
    l2_threshold: float
    metric: str  # "cosine" or "l2"

    def __post_init__(self) -> None:
        if self.metric not in ("cosine", "l2"):
            raise ConfigurationError(
                f"recognition.metric must be 'cosine' or 'l2', got: {self.metric!r}"
            )


@dataclass
class EnrollmentConfig:
    required_images: int
    min_accepted_images: int
    blur_threshold: float
    max_yaw_degrees: float
    max_pitch_degrees: float


@dataclass
class AttendanceConfig:
    cooldown_minutes: int
    save_snapshot: bool
    snapshot_path: str
    snapshot_format: str
    snapshot_jpeg_quality: int
    valid_hour_start: int
    valid_hour_end: int


@dataclass
class CameraConfig:
    frame_skip: int
    reconnect_max_attempts: int
    reconnect_backoff_seconds: float
    reconnect_backoff_multiplier: float
    frame_buffer_size: int
    read_timeout_seconds: float


@dataclass
class EngineConfig:
    thread_pool_size: int


@dataclass
class LoggingConfig:
    level: str
    format: str
    file: str
    max_bytes: int
    backup_count: int


@dataclass
class SecurityConfig:
    liveness_enabled: bool


@dataclass
class Config:
    models: ModelsConfig
    detection: DetectionConfig
    recognition: RecognitionConfig
    enrollment: EnrollmentConfig
    attendance: AttendanceConfig
    camera: CameraConfig
    engine: EngineConfig
    logging: LoggingConfig
    security: SecurityConfig

    @classmethod
    def from_yaml(cls, path: str | Path = "config.yaml") -> "Config":
        """Load and validate config from YAML file.

        Raises:
            ConfigurationError: If file is missing or a required key is absent.
        """
        yaml_path = Path(path)
        if not yaml_path.exists():
            raise ConfigurationError(
                f"config.yaml not found at {yaml_path.resolve()}. "
                "Ensure you run from the project root."
            )

        with yaml_path.open("r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)

        # Expand ${VAR:default} placeholders using environment variables
        raw = _interpolate(raw)

        try:
            cfg = cls._build(raw)
        except (KeyError, TypeError) as exc:
            raise ConfigurationError(
                f"config.yaml is missing or has an invalid field: {exc}"
            ) from exc

        _configure_structlog(cfg.logging)
        log.info(
            "config_loaded",
            path=str(yaml_path.resolve()),
            metric=cfg.recognition.metric,
            liveness_enabled=cfg.security.liveness_enabled,
        )
        return cfg

    @classmethod
    def _build(cls, raw: dict) -> "Config":
        m = raw["models"]
        det_cfg = raw["detection"]
        rec_cfg = raw["recognition"]
        enr_cfg = raw["enrollment"]
        att_cfg = raw["attendance"]
        cam_cfg = raw["camera"]
        eng_cfg = raw["engine"]
        log_cfg = raw["logging"]
        sec_cfg = raw["security"]

        # Parse liveness_enabled — may come as string "false" from env interpolation
        liveness_raw = sec_cfg["liveness_enabled"]
        if isinstance(liveness_raw, str):
            liveness_enabled = liveness_raw.strip().lower() not in ("false", "0", "no", "")
        else:
            liveness_enabled = bool(liveness_raw)

        return cls(
            models=ModelsConfig(
                base_path=m["base_path"],
                detector=ModelFileConfig(
                    filename=m["detector"]["filename"],
                    sha256=m["detector"].get("sha256", ""),
                ),
                recognizer=ModelFileConfig(
                    filename=m["recognizer"]["filename"],
                    sha256=m["recognizer"].get("sha256", ""),
                ),
            ),
            detection=DetectionConfig(
                confidence_threshold=float(det_cfg["confidence_threshold"]),
                min_face_size_px=int(det_cfg["min_face_size_px"]),
                input_size=list(det_cfg["input_size"]),
                max_faces_per_frame=int(det_cfg["max_faces_per_frame"]),
            ),
            recognition=RecognitionConfig(
                cosine_threshold=float(rec_cfg["cosine_threshold"]),
                l2_threshold=float(rec_cfg["l2_threshold"]),
                metric=str(rec_cfg["metric"]),
            ),
            enrollment=EnrollmentConfig(
                required_images=int(enr_cfg["required_images"]),
                min_accepted_images=int(enr_cfg["min_accepted_images"]),
                blur_threshold=float(enr_cfg["blur_threshold"]),
                max_yaw_degrees=float(enr_cfg["max_yaw_degrees"]),
                max_pitch_degrees=float(enr_cfg["max_pitch_degrees"]),
            ),
            attendance=AttendanceConfig(
                cooldown_minutes=int(att_cfg["cooldown_minutes"]),
                save_snapshot=bool(att_cfg["save_snapshot"]),
                snapshot_path=str(att_cfg["snapshot_path"]),
                snapshot_format=str(att_cfg["snapshot_format"]),
                snapshot_jpeg_quality=int(att_cfg["snapshot_jpeg_quality"]),
                valid_hour_start=int(att_cfg["valid_hour_start"]),
                valid_hour_end=int(att_cfg["valid_hour_end"]),
            ),
            camera=CameraConfig(
                frame_skip=int(cam_cfg["frame_skip"]),
                reconnect_max_attempts=int(cam_cfg["reconnect_max_attempts"]),
                reconnect_backoff_seconds=float(cam_cfg["reconnect_backoff_seconds"]),
                reconnect_backoff_multiplier=float(cam_cfg["reconnect_backoff_multiplier"]),
                frame_buffer_size=int(cam_cfg["frame_buffer_size"]),
                read_timeout_seconds=float(cam_cfg["read_timeout_seconds"]),
            ),
            engine=EngineConfig(
                thread_pool_size=int(eng_cfg["thread_pool_size"]),
            ),
            logging=LoggingConfig(
                level=str(log_cfg["level"]),
                format=str(log_cfg["format"]),
                file=str(log_cfg["file"]),
                max_bytes=int(log_cfg["max_bytes"]),
                backup_count=int(log_cfg["backup_count"]),
            ),
            security=SecurityConfig(
                liveness_enabled=liveness_enabled,
            ),
        )


# ─── structlog one-time configuration ───────────────────────────────────────

def _configure_structlog(log_cfg: LoggingConfig) -> None:
    """Configure structlog for JSON production logging.

    Call this once at startup (done automatically by Config.from_yaml).
    """
    import logging
    import logging.handlers
    from pathlib import Path as _Path

    # Ensure log directory exists
    log_file = _Path(log_cfg.file)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    numeric_level = getattr(logging, log_cfg.level.upper(), logging.INFO)

    # Root handler: rotating file
    file_handler = logging.handlers.RotatingFileHandler(
        filename=log_file,
        maxBytes=log_cfg.max_bytes,
        backupCount=log_cfg.backup_count,
        encoding="utf-8",
    )
    file_handler.setLevel(numeric_level)

    # Console handler for local dev visibility
    console_handler = logging.StreamHandler()
    console_handler.setLevel(numeric_level)

    logging.basicConfig(
        format="%(message)s",
        level=numeric_level,
        handlers=[file_handler, console_handler],
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            # NOTE: add_logger_name is intentionally omitted.
            # It calls logger.name which does not exist on structlog's
            # own PrintLogger (used when logger_factory=PrintLoggerFactory).
            # The event + level + timestamp are sufficient for log routing.
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
