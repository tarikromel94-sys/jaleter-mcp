"""Iteration 78 — post-refactor regression + lapse email verification.

Scope:
 - Paywall sanity: /api/accounts still 402 for unpaid, 200 for premium.
 - /api/user/membership works for both users.
 - Unit test for _send_payment_failed_email throttle + send-on-first-fail using
   mocked email_service.send_email and mocked users collection (NO real emails,
   NO real Stripe objects).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE:
    # Fall back to the one from frontend/.env baked into the tests context.
    BASE = "https://no-changes-mobile.preview.emergentagent.com"
BASE = BASE.rstrip("/")

UNPAID = ("alex+test1@jaleter.app", "password123")
PREMIUM = ("demo@jaleter.com", "DemoOKn6EzMtN2!")


# ---------- helpers ---------- #
def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    return body["token"]


@pytest.fixture(scope="module")
def unpaid_token():
    return _login(*UNPAID)


@pytest.fixture(scope="module")
def premium_token():
    return _login(*PREMIUM)


# ---------- Paywall sanity ---------- #
class TestPaywallRegression:
    def test_unpaid_accounts_402(self, unpaid_token):
        r = requests.get(f"{BASE}/api/accounts", headers={"Authorization": f"Bearer {unpaid_token}"}, timeout=15)
        assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        # FastAPI wraps HTTPException.detail under 'detail'
        detail = body.get("detail") or body
        assert detail.get("error") == "payment_required"
        assert "subscription_status" in detail

    def test_premium_accounts_200(self, premium_token):
        r = requests.get(f"{BASE}/api/accounts", headers={"Authorization": f"Bearer {premium_token}"}, timeout=15)
        assert r.status_code == 200, f"premium got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "accounts" in body and isinstance(body["accounts"], list)


class TestMembershipEndpoint:
    def test_membership_unpaid(self, unpaid_token):
        r = requests.get(f"{BASE}/api/user/membership", headers={"Authorization": f"Bearer {unpaid_token}"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("active") is False
        assert "status" in body

    def test_membership_premium(self, premium_token):
        r = requests.get(f"{BASE}/api/user/membership", headers={"Authorization": f"Bearer {premium_token}"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get("active") is True


# ---------- Lapse email unit tests (mocked) ---------- #
class _FakeUsers:
    """Very small stand-in for db.users used by _send_payment_failed_email."""
    def __init__(self, user_doc):
        self._doc = user_doc
        self.update_calls = []

    async def find_one(self, q, projection=None):
        if q.get("user_id") == self._doc.get("user_id"):
            return dict(self._doc)
        return None

    async def update_one(self, q, update):
        self.update_calls.append((q, update))
        setters = update.get("$set", {})
        self._doc.update(setters)
        return None


class _FakeDB:
    def __init__(self, users):
        self.users = users


class TestPaymentFailedEmail:
    def _make_user(self, last=None):
        return {
            "user_id": "u_test_1",
            "email": "delivered@resend.dev",
            "name": "Alex",
            **({"last_payment_failed_email_at": last} if last is not None else {}),
        }

    def _invoice(self):
        return {
            "amount_due": 9000,
            "currency": "usd",
            "next_payment_attempt": int((datetime.now(timezone.utc) + timedelta(days=3)).timestamp()),
        }

    def test_sends_on_first_fail_and_records_timestamp(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import stripe_service, email_service  # type: ignore

        users = _FakeUsers(self._make_user())
        db = _FakeDB(users)

        with patch.object(email_service, "send_email", new=AsyncMock(return_value=(True, "sent"))) as mock_send:
            asyncio.get_event_loop().run_until_complete(
                stripe_service._send_payment_failed_email(db, "u_test_1", self._invoice())
            )
            assert mock_send.await_count == 1, "email must be sent on first failure"
            # Records last_payment_failed_email_at
            assert any("last_payment_failed_email_at" in (u.get("$set") or {}) for _, u in users.update_calls)

    def test_throttled_within_20h(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import stripe_service, email_service  # type: ignore

        recent = datetime.now(timezone.utc) - timedelta(hours=5)
        users = _FakeUsers(self._make_user(last=recent))
        db = _FakeDB(users)

        with patch.object(email_service, "send_email", new=AsyncMock(return_value=(True, "sent"))) as mock_send:
            asyncio.get_event_loop().run_until_complete(
                stripe_service._send_payment_failed_email(db, "u_test_1", self._invoice())
            )
            assert mock_send.await_count == 0, "must not resend within 20h throttle"

    def test_sends_after_20h_lapse(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import stripe_service, email_service  # type: ignore

        old = datetime.now(timezone.utc) - timedelta(hours=21)
        users = _FakeUsers(self._make_user(last=old))
        db = _FakeDB(users)

        with patch.object(email_service, "send_email", new=AsyncMock(return_value=(True, "sent"))) as mock_send:
            asyncio.get_event_loop().run_until_complete(
                stripe_service._send_payment_failed_email(db, "u_test_1", self._invoice())
            )
            assert mock_send.await_count == 1, "should resend after throttle window"

    def test_no_email_missing_user(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import stripe_service, email_service  # type: ignore

        users = _FakeUsers({"user_id": "someone_else"})
        db = _FakeDB(users)

        with patch.object(email_service, "send_email", new=AsyncMock(return_value=(True, "sent"))) as mock_send:
            asyncio.get_event_loop().run_until_complete(
                stripe_service._send_payment_failed_email(db, "missing", self._invoice())
            )
            assert mock_send.await_count == 0

    def test_builder_content(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import email_service  # type: ignore

        subject, html, text = email_service.build_payment_failed_email("Alex", "$90.00 USD", "January 21, 2026")
        assert "payment" in subject.lower()
        assert "Alex" in html and "Alex" in text
        assert "$90.00 USD" in html and "$90.00 USD" in text
        assert "January 21, 2026" in html
        # Access-continues messaging (past_due grace)
        assert "still active" in html.lower()
