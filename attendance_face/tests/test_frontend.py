"""
tests/test_frontend.py

Phase 7 unit tests for Web Dashboard routes & static file serving in api/main.py.

Tests cover:
  - GET /dashboard → 200 OK (index.html)
  - GET / → 200 OK (index.html)
  - GET /static/styles.css → 200 OK
  - GET /static/app.js → 200 OK
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from tests.test_api import client, test_db, test_engine_db  # import fixtures


class TestDashboardRoutes:

    def test_dashboard_endpoint_returns_200(self, client):
        r = client.get("/dashboard")
        assert r.status_code == 200
        assert "<title>Presence ERP - Face Attendance System</title>" in r.text

    def test_root_endpoint_returns_dashboard_html(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "Presence ERP" in r.text

    def test_static_styles_css_returns_200(self, client):
        r = client.get("/static/styles.css")
        assert r.status_code == 200
        assert "var(--bg-dark)" in r.text

    def test_static_app_js_returns_200(self, client):
        r = client.get("/static/app.js")
        assert r.status_code == 200
        assert "function switchTab" in r.text
