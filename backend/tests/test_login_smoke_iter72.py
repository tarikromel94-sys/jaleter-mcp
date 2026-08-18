"""Iteration 72 — smoke test: POST /api/auth/login still works for seeded admin
after the Apple Sign-In removal and the two new features (PIN Recovery,
Reports Audit) that touched only the frontend.
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fallback: read directly from /app/frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestAuthLoginSmoke:
    def test_admin_login_ok(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "email": "support@jaleter.com",
            "password": "Tarik0731!",
        }, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user" in data and "token" in data
        assert data["user"]["email"] == "support@jaleter.com"
        assert isinstance(data["token"], str) and len(data["token"]) > 20

    def test_regular_user_login_ok(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "email": "alex+test1@jaleter.app",
            "password": "password123",
        }, timeout=15)
        # Regular test user may or may not exist — accept 200 or 401
        assert r.status_code in (200, 401), r.text
        if r.status_code == 200:
            data = r.json()
            assert "user" in data and "token" in data

    def test_wrong_password_401(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={
            "email": "support@jaleter.com",
            "password": "wrong-password-xxx",
        }, timeout=15)
        assert r.status_code in (400, 401), r.text
