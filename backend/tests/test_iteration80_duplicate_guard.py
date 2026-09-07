"""Iteration 80 — Duplicate payment guard + processing state + reconcile.

Tests the fixes for the $90 double-charge bug:
  - POST /api/payments/checkout returns {already_active:true} for premium user
    (no Stripe Checkout URL)
  - POST /api/payments/checkout returns {processing:true} for user with
    membership_processing flag (no Stripe Checkout URL)
  - GET /api/user/membership exposes 'processing' field
  - GET /api/accounts regression: 402 for unpaid / 200 for premium

DOES NOT complete any real Stripe payment — only inspects JSON responses.
"""
import os
import uuid
import asyncio

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://no-changes-mobile.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

DEMO_EMAIL = "demo@jaleter.com"
DEMO_PASSWORD = "DemoOKn6EzMtN2!"
ALEX_EMAIL = "alex+test1@jaleter.app"
ALEX_PASSWORD = "password123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text}"
    data = r.json()
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def demo():
    tok, u = _login(DEMO_EMAIL, DEMO_PASSWORD)
    return {"token": tok, "user": u}


@pytest.fixture(scope="module")
def flagged_user():
    """Return a user with membership_processing=true and NO stripe_customer_id
    so the reconcile-from-Stripe path is a no-op and the flag is preserved.

    Try alex+test1 first; if it has a stripe_customer_id, register a fresh
    throwaway user instead.
    """
    async def _work():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        alex = await db.users.find_one({"email": ALEX_EMAIL}, {"_id": 0})
        if alex and not alex.get("stripe_customer_id"):
            email = ALEX_EMAIL
            password = ALEX_PASSWORD
            reused = True
        else:
            # Register fresh user without stripe_customer_id.
            # NOTE: backend lowercases email on register.
            email = f"test_iter80_{uuid.uuid4().hex[:8]}@jaleter.app"
            password = "Password123!"
            reg = requests.post(
                f"{API}/auth/register",
                json={"name": "ITER80 Test", "email": email, "password": password},
                timeout=30,
            )
            assert reg.status_code == 200, f"register → {reg.status_code}: {reg.text}"
            reused = False
        # Set the processing flag (and unset any stripe_customer_id defensively).
        await db.users.update_one(
            {"email": email},
            {"$set": {"membership_processing": True},
             "$unset": {"stripe_customer_id": "", "stripe_subscription_id": "",
                        "subscription_status": ""}},
        )
        client.close()
        return email, password, reused

    email, password, reused = asyncio.run(_work())
    tok, u = _login(email, password)
    yield {"email": email, "password": password, "token": tok, "user": u, "reused": reused}

    # Cleanup: unset flag; delete throwaway user entirely.
    async def _cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        if reused:
            await db.users.update_one(
                {"email": email},
                {"$unset": {"membership_processing": ""}},
            )
        else:
            await db.users.delete_one({"email": email})
        client.close()

    asyncio.run(_cleanup())


# ------------------------ Checkout duplicate guard ------------------------
class TestCheckoutGuard:
    def test_demo_checkout_returns_already_active(self, demo):
        r = requests.post(
            f"{API}/payments/checkout",
            json={"product": "jaleter_premium", "platform": "web"},
            headers={"Authorization": f"Bearer {demo['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("already_active") is True, f"expected already_active, got {body}"
        assert "url" not in body or not body.get("url"), f"must NOT open checkout: {body}"

    def test_processing_flag_short_circuits_checkout(self, flagged_user):
        r = requests.post(
            f"{API}/payments/checkout",
            json={"product": "jaleter_premium", "platform": "web"},
            headers={"Authorization": f"Bearer {flagged_user['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("processing") is True, f"expected processing, got {body}"
        assert not body.get("url"), f"must NOT open checkout: {body}"
        assert not body.get("already_active"), body


# ------------------------ Membership status contract ----------------------
class TestMembershipStatus:
    def test_demo_membership_active_not_processing(self, demo):
        r = requests.get(
            f"{API}/user/membership",
            headers={"Authorization": f"Bearer {demo['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("active") is True, body
        assert body.get("processing") is False, body

    def test_flagged_user_membership_processing_true(self, flagged_user):
        # NO refresh param — refresh reconciles from Stripe and would clear
        # the synthetic flag since there is no stripe_customer_id anyway.
        r = requests.get(
            f"{API}/user/membership",
            headers={"Authorization": f"Bearer {flagged_user['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("active") is False, body
        assert body.get("processing") is True, body


# ------------------------ Regression: paywall gate ------------------------
class TestAccountsPaywall:
    def test_unpaid_accounts_402(self, flagged_user):
        r = requests.get(
            f"{API}/accounts",
            headers={"Authorization": f"Bearer {flagged_user['token']}"},
            timeout=30,
        )
        assert r.status_code == 402, f"unpaid accounts → {r.status_code}: {r.text}"
        detail = r.json().get("detail") or {}
        assert detail.get("error") == "payment_required", detail

    def test_premium_accounts_200(self, demo):
        r = requests.get(
            f"{API}/accounts",
            headers={"Authorization": f"Bearer {demo['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "accounts" in body, body
