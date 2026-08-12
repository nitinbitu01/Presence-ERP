"""
api/main.py

FastAPI application factory and startup lifecycle.

Module-level singletons (created once, shared across requests):
    engine_instance: FaceEngine — thread-safe via threading.local()
    config_instance: Config     — read-only after startup

These are intentionally module-level (not in dependency injection) because:
  - FaceEngine loads ONNX models lazily per thread — no constructor overhead
  - Config is read-only after startup — safe to share
  - FastAPI's Depends() is used for DB sessions (per-request lifecycle)

STRUCTLOG SETUP
---------------
Structlog is configured once here with a renderer-safe processor chain that
works with both stdlib Logger (production) and PrintLogger (tests/TestClient).
DO NOT add add_logger_name — it crashes on PrintLogger objects.

Run with:
    uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 1

WORKER COUNT
------------
Use --workers 1 (single process) to keep the threading.local() pattern safe.
Multi-process (gunicorn) is fine — each process has its own thread-local store.
Do NOT use multiple asyncio workers with shared engine state.

DATABASE TABLES
---------------
Tables are created on startup via Base.metadata.create_all().
In production, use Alembic migrations instead.
"""

from __future__ import annotations

import signal
import sys
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Configure structlog once at import time ───────────────────────────────────
# Use only processors that are safe for ALL logger types (PrintLogger + stdlib).
# DO NOT use add_logger_name — it calls logger.name which doesn't exist on
# structlog's own PrintLogger used inside TestClient lifespan.
if not structlog.is_configured():
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.BoundLogger,
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

from database.connection import get_engine
from database.models import Base
from face_engine.config import Config
from face_engine.engine import FaceEngine

log = structlog.get_logger()

# ── Module-level singletons ───────────────────────────────────────────────────
config_instance: Config = None   # type: ignore[assignment]
engine_instance: FaceEngine = None  # type: ignore[assignment]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    global config_instance, engine_instance

    # ── Startup ───────────────────────────────────────────────────────────
    log.info("app_startup_begin")

    config_instance = Config.from_yaml("config.yaml")
    engine_instance = FaceEngine(config_instance)

    # Create tables (idempotent — skips existing)
    try:
        db_engine = get_engine()
        Base.metadata.create_all(bind=db_engine)
        log.info("db_tables_ensured")
    except Exception as exc:
        log.warning("db_table_creation_failed", error=str(exc))
        # Do NOT crash — DB might not be available in test environments

    log.info("app_startup_complete")
    yield  # ← Application runs here

    # ── Shutdown ──────────────────────────────────────────────────────────
    log.info("app_shutdown_begin")
    if engine_instance:
        engine_instance.shutdown()
    log.info("app_shutdown_complete")


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="Face Attendance ERP",
        description=(
            "YuNet + SFace face recognition attendance system. "
            "Enroll employees with face images, then recognize faces from camera frames."
        ),
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS — restrict in production to your frontend domain
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],   # Tighten in production
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    from api.routes.employees import router as employees_router
    from api.routes.recognition import router as recognition_router
    from api.routes.attendance import router as attendance_router
    from api.routes.health import router as health_router
    from api.routes.vision import router as vision_router

    app.include_router(employees_router)
    app.include_router(recognition_router)
    app.include_router(attendance_router)
    app.include_router(health_router)
    app.include_router(vision_router)

    # Mount static files for Web Dashboard
    from pathlib import Path
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse, RedirectResponse

    static_dir = Path(__file__).parent / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/dashboard", include_in_schema=False)
    def dashboard():
        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return RedirectResponse(url="/docs")

    # Root redirect to dashboard if available, or docs
    @app.get("/", include_in_schema=False)
    def root():
        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return JSONResponse({"message": "Face Attendance ERP API", "docs": "/docs", "dashboard": "/dashboard"})

    return app


app = create_app()
