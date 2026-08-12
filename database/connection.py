"""
database/connection.py

SQLAlchemy 2.0 engine + session factory.

Connection pool settings:
    pool_size=5           — base persistent connections
    max_overflow=10       — extra connections under burst load
    pool_timeout=30       — wait up to 30s for a free connection
    pool_pre_ping=True    — validate connection before use (survives DB restarts)

NEVER import this directly in route handlers.
Use the get_db() FastAPI dependency instead.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Generator

import structlog
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

log = structlog.get_logger()

# ── Build DSN from environment variables ──────────────────────────────────────
def _build_dsn() -> str:
    # Render / Railway / Heroku provide a single DATABASE_URL — prefer it.
    database_url = os.environ.get("DATABASE_URL", "")
    if database_url:
        # Render uses postgres:// scheme; SQLAlchemy requires postgresql+psycopg2://
        dsn = database_url.replace("postgres://", "postgresql+psycopg2://", 1)
        dsn = dsn.replace("postgresql://", "postgresql+psycopg2://", 1)
        return dsn
    # Fallback: individual vars for local development
    host = os.environ.get("DB_HOST", "localhost")
    port = os.environ.get("DB_PORT", "5432")
    name = os.environ.get("DB_NAME", "attendance_erp")
    user = os.environ.get("DB_USER", "attendance_user")
    password = os.environ.get("DB_PASSWORD", "")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}"


def create_db_engine(dsn: str | None = None):
    """Create SQLAlchemy engine. dsn overrides env-based DSN (used in tests)."""
    dsn = dsn or _build_dsn()
    engine = create_engine(
        dsn,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_pre_ping=True,
        echo=False,
    )
    log.info("db_engine_created", host=os.environ.get("DB_HOST", "localhost"))
    return engine


# Module-level engine and session factory (lazy — created on first import)
_engine = None
_SessionLocal = None


def get_engine():
    """Return the module-level engine, creating it on first call."""
    global _engine
    if _engine is None:
        _engine = create_db_engine()
    return _engine


def get_session_factory():
    """Return the module-level SessionLocal factory."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_engine(),
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )
    return _SessionLocal


# ── FastAPI dependency ────────────────────────────────────────────────────────

def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a DB session, closes on exit.

    Usage in routes::

        @router.get("/foo")
        def foo(db: Session = Depends(get_db)):
            ...
    """
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Context manager for non-FastAPI use (scripts, tests) ──────────────────────

@contextmanager
def db_session() -> Generator[Session, None, None]:
    """Context manager yielding a DB session with auto-rollback on error."""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
