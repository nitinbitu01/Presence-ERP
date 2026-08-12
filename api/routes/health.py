"""
api/routes/health.py

Health check endpoint — safe for load balancer probes.

GET /health
    Returns status, model load state, error counts, and liveness flag.
    Never requires authentication (should be accessible to LB/monitoring).
"""

from __future__ import annotations

from fastapi import APIRouter
from api.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="System health check",
    description="Returns engine status. Safe to call from load balancer health probes.",
)
def health_check():
    from api.main import engine_instance
    data = engine_instance.health_check()
    return HealthResponse(**data)
