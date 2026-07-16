"""Iteration 11 backend tests — Stripe checkout, coaching, membership, plus regressions.

Uses public preview URL from EXPO_PUBLIC_BACKEND_URL (falls back to localhost:8001).
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "http://localhost:8001"
).rstrip("/")

TEST_EMAIL = "alex+test1@jaleter.app"
TEST_PASSWORD = "password123"


# ----------------- Fixtures -----------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


def future_iso(hours: int = 26) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


# ----------------- 1. Products list -----------------
class TestProducts:
    def test_products_list_public(self, api):
        r = api.get(f"{BASE_URL}/api/payments/products")
        assert r.status_code == 200
        data = r.json()
        products = data.get("products") or []
        keys = {p["key"]: p for p in products}
        assert "coaching_session" in keys
        assert "jaleter_premium" in keys
        assert keys["coaching_session"]["amount"] == 50.0
        assert keys["coaching_session"]["currency"] == "usd"
        assert keys["jaleter_premium"]["amount"] == 75.0
        assert keys["jaleter_premium"]["currency"] == "usd"


# ----------------- 2-4. Checkout create -----------------
class TestCheckout:
    _coaching_session_id = None
    _premium_session_id = None
    _booking_id = None

    def test_coaching_checkout_creates_session_and_booking(self, api, auth_headers):
        payload = {
            "product": "coaching_session",
            "platform": "mobile",
            "scheduled_at": future_iso(26),
        }
        r = api.post(f"{BASE_URL}/api/payments/checkout", json=payload, headers=auth_headers)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert data.get("session_id"), "session_id missing"
        assert data.get("url") and "checkout.stripe.com" in data["url"], f"Bad url: {data.get('url')}"
        assert re.match(r"^pay_[0-9a-f]{16}$", data.get("txn_id", "")), f"Bad txn_id: {data.get('txn_id')}"
        assert data.get("amount") == 50.0
        assert data.get("currency") == "usd"
        assert data.get("product_name") == "Coaching Session (1 hour)"
        assert data.get("booking_id"), "booking_id must be non-null for coaching"
        TestCheckout._coaching_session_id = data["session_id"]
        TestCheckout._booking_id = data["booking_id"]

    def test_coaching_checkout_rejects_past_scheduled_at(self, api, auth_headers):
        past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            json={"product": "coaching_session", "platform": "mobile", "scheduled_at": past},
            headers=auth_headers,
        )
        assert r.status_code == 400, f"Expected 400 for past scheduled_at, got {r.status_code}: {r.text}"

    def test_coaching_checkout_requires_scheduled_at(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            json={"product": "coaching_session", "platform": "mobile"},
            headers=auth_headers,
        )
        assert r.status_code == 400

    def test_premium_checkout_creates_session_without_booking(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            json={"product": "jaleter_premium", "platform": "mobile"},
            headers=auth_headers,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "checkout.stripe.com" in (data.get("url") or "")
        assert data.get("amount") == 75.0
        assert data.get("currency") == "usd"
        assert data.get("product_name") == "Jaleter Premium (Annual)"
        assert data.get("booking_id") is None
        TestCheckout._premium_session_id = data["session_id"]

    def test_unknown_product_rejected(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            json={"product": "bogus_product", "platform": "mobile"},
            headers=auth_headers,
        )
        assert r.status_code == 400


# ----------------- 5-6. Status endpoint -----------------
class TestStatus:
    def test_status_returns_unpaid_for_new_session(self, api, auth_headers):
        sid = TestCheckout._coaching_session_id
        assert sid, "Requires coaching checkout to have run first"
        r = api.get(f"{BASE_URL}/api/payments/status/{sid}", headers=auth_headers)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "status" in data
        assert "payment_status" in data
        # We cannot actually complete Stripe checkout so should still be unpaid
        assert data["payment_status"] in ("unpaid", "no_payment_required"), data
        assert data.get("session_id") == sid

    def test_status_unknown_session_returns_404(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/payments/status/cs_nonexistent_xxx", headers=auth_headers)
        assert r.status_code == 404


# ----------------- 7. Coaching bookings list -----------------
class TestBookings:
    def test_bookings_lists_pending(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/coaching/bookings", headers=auth_headers)
        assert r.status_code == 200
        bookings = r.json().get("bookings") or []
        assert isinstance(bookings, list)
        # The booking created in TestCheckout must appear
        ids = [b.get("booking_id") for b in bookings]
        assert TestCheckout._booking_id in ids, f"created booking {TestCheckout._booking_id} not in {ids}"
        target = [b for b in bookings if b.get("booking_id") == TestCheckout._booking_id][0]
        assert target["status"] == "pending_payment"
        assert target["user_email"] == TEST_EMAIL


# ----------------- 8. Membership status -----------------
class TestMembership:
    def test_membership_inactive_by_default(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/user/membership", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("active") is False
        # expires_at may be null or a past ISO
        # plan should be null if inactive
        assert data.get("plan") in (None, "")


# ----------------- 9. Auth required on payment endpoints -----------------
class TestAuthRequired:
    ENDPOINTS = [
        ("POST", "/api/payments/checkout", {"product": "jaleter_premium", "platform": "mobile"}),
        ("GET", "/api/payments/status/anything", None),
        ("GET", "/api/coaching/bookings", None),
        ("GET", "/api/user/membership", None),
    ]

    @pytest.mark.parametrize("method,path,body", ENDPOINTS)
    def test_missing_token_returns_401(self, api, method, path, body):
        url = f"{BASE_URL}{path}"
        if method == "GET":
            r = api.get(url, headers={})
        else:
            r = api.post(url, json=body, headers={"Content-Type": "application/json"})
        assert r.status_code == 401, f"{method} {path} without token got {r.status_code}"

    @pytest.mark.parametrize("method,path,body", ENDPOINTS)
    def test_invalid_token_returns_401(self, api, method, path, body):
        headers = {"Authorization": "Bearer not.a.real.jwt", "Content-Type": "application/json"}
        url = f"{BASE_URL}{path}"
        if method == "GET":
            r = api.get(url, headers=headers)
        else:
            r = api.post(url, json=body, headers=headers)
        assert r.status_code == 401, f"{method} {path} with bad token got {r.status_code}"


# ----------------- 10. Regressions -----------------
class TestRegressions:
    def test_auth_me_works(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json().get("email") == TEST_EMAIL

    def test_forgot_password_still_works(self, api):
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": TEST_EMAIL})
        # rate-limit 3/min — accept 200 or 429
        assert r.status_code in (200, 429), f"{r.status_code} {r.text}"
        if r.status_code == 200:
            data = r.json()
            assert data.get("ok") is True

    def test_reset_password_rejects_bad_token(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": "not_a_real_token_xxx", "new_password": "password123"},
        )
        assert r.status_code == 400

    def test_simplefin_link_rejects_bad_token(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/accounts/simplefin/link",
            json={"setup_token": "invalid_token_xxx"},
            headers=auth_headers,
        )
        # simplefin returns 400 for a bad token
        assert r.status_code in (400, 502), f"{r.status_code} {r.text}"

    def test_accounts_list(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/accounts", headers=auth_headers)
        assert r.status_code == 200
        assert "accounts" in r.json()

    def test_accounts_all(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/accounts/all", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json().get("accounts"), list)

    def test_providers_catalog(self, api):
        r = api.get(f"{BASE_URL}/api/providers")
        assert r.status_code == 200
        provs = r.json().get("providers")
        assert isinstance(provs, list) and len(provs) > 0
        ids = {p.get("id") for p in provs}
        assert "simplefin" in ids
        assert "snaptrade" in ids

    def test_support_request_create(self, api, auth_headers):
        r = api.post(
            f"{BASE_URL}/api/support/requests",
            json={"institution": "TEST_ITER11 Bank", "notes": "test iter11"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True
