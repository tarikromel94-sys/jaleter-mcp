"""Iteration 13 — Batch A regression tests.

Auth, forgot/reset-password, SimpleFIN link, payments checkout endpoints.
"""
import os
import re
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://no-changes-mobile.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

EMAIL = "alex+test1@jaleter.app"
PASSWORD = "password123"
NEW_PASSWORD = "NewPass123!"


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_login(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        assert r.status_code == 200
        assert "token" in r.json()

    def test_me(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json().get("email") == EMAIL


# ---------- Forgot / reset password ----------
class TestPasswordReset:
    def test_forgot_password_dev_fallback(self, api):
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": EMAIL})
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        assert "reset_token" in j, f"expected dev-fallback reset_token in {j}"
        # Save for next test
        pytest.reset_token = j["reset_token"]

    def test_reset_and_relogin_and_reset_back(self, api):
        tok = getattr(pytest, "reset_token", None)
        assert tok, "reset token missing"
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={"token": tok, "new_password": NEW_PASSWORD})
        assert r.status_code == 200, r.text
        assert "token" in r.json()

        # Login with new password
        r2 = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": NEW_PASSWORD})
        assert r2.status_code == 200, r2.text

        # Reset back to original password using another forgot-password cycle
        r3 = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": EMAIL})
        assert r3.status_code == 200
        rt = r3.json().get("reset_token")
        assert rt
        r4 = api.post(f"{BASE_URL}/api/auth/reset-password", json={"token": rt, "new_password": PASSWORD})
        assert r4.status_code == 200, r4.text
        # verify login with restored password
        r5 = api.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        assert r5.status_code == 200


# ---------- SimpleFIN link ----------
def _fetch_demo_token():
    """Scrape the beta-bridge demo token."""
    try:
        page = requests.get("https://beta-bridge.simplefin.org/info/developers", timeout=15).text
    except Exception as e:
        return None
    m = re.findall(r"aHR0[A-Za-z0-9+/=]+", page)
    return m[0] if m else None


class TestSimpleFIN:
    def test_link_demo_account(self, api, auth_headers):
        tok = _fetch_demo_token()
        if not tok:
            pytest.skip("Could not fetch demo simplefin token")
        r = api.post(
            f"{BASE_URL}/api/accounts/simplefin/link",
            headers=auth_headers,
            json={"setup_token": tok},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "link_id" in j
        pytest.link_id = j["link_id"]

    def test_get_all_accounts(self, api, auth_headers):
        # Skip if link failed
        if not getattr(pytest, "link_id", None):
            pytest.skip("no link_id from previous test")
        r = api.get(f"{BASE_URL}/api/accounts/all", headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        # Accept a variety of shapes: {accounts: [...]}, or list, etc.
        accounts = j.get("accounts") if isinstance(j, dict) else j
        assert accounts and len(accounts) > 0


# ---------- Payments ----------
class TestPayments:
    def test_products(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/payments/products", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        # products may be a list or dict; sanity-check contains items
        assert data

    def test_checkout_coaching(self, api, auth_headers):
        future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            headers=auth_headers,
            json={
                "product": "coaching_session",
                "platform": "mobile",
                "scheduled_at": future,
            },
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "url" in j
        assert "checkout.stripe.com" in j["url"]

    def test_checkout_premium(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            headers=auth_headers,
            json={"product": "jaleter_premium", "platform": "mobile"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "url" in j
        assert "checkout.stripe.com" in j["url"]
