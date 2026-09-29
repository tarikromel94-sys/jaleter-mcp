"""
Iteration 88 — Backend regression for the Stripe-Premium removal.

Verifies:
  1) Fresh user has no Premium → premium APIs return 402.
  2) POST /api/payments/checkout {jaleter_premium} → 410; /payments/products excludes jaleter_premium.
  3) Removed Stripe Premium routes are 404.
  4) POST /api/iap/sync activates membership + unlocks Plaid/accounts.
  5) IAP sync hardening: cannot revoke, expiry capped ≤400d, monotonic.
  6) Legacy Stripe grandfathering (direct Mongo insert) + edge cases.
  7) App Review + admin accounts are active.
  8) Coaching flow untouched (checkout + status + booking list).
  9) Health endpoint OK.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

def _load_env_file(path: str) -> None:
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip().strip('"').strip("'")
                os.environ.setdefault(k.strip(), v)
    except FileNotFoundError:
        pass


_load_env_file("/app/frontend/.env")
_load_env_file("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

APP_REVIEW_EMAIL = "Jaleter.appreview@gmail.com"
APP_REVIEW_PASS = "Jaleter029496!"
ADMIN_EMAIL = "support@jaleter.com"
ADMIN_PASS = "Tarik0731!"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _register(s: requests.Session, tag: str = "") -> tuple[str, str]:
    """Register a fresh user; returns (email, bearer_token)."""
    # rate-limit is 10/min → space out
    email = f"test_i88_{tag}_{uuid.uuid4().hex[:8]}@example.com"
    body = {"name": "Iter88", "email": email, "password": "Passw0rd!123"}
    for _ in range(3):
        r = s.post(f"{BASE_URL}/api/auth/register", json=body, timeout=15)
        if r.status_code == 200:
            return email, r.json()["token"]
        if r.status_code == 429:
            time.sleep(7)
            continue
        raise AssertionError(f"register failed: {r.status_code} {r.text}")
    raise AssertionError("register: exhausted retries (rate-limited)")


def _login(s: requests.Session, email: str, password: str) -> str:
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


# ---------- 1) Fresh user paywall ----------
class TestFreshUserPaywall:
    def test_membership_inactive_and_gates_402(self, s):
        _, tok = _register(s, "fresh")
        h = _h(tok)

        m = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15)
        assert m.status_code == 200, m.text
        j = m.json()
        assert j["active"] is False
        assert j["source"] is None
        assert j["status"] == "inactive"

        for path in ("/api/plaid/link-token", "/api/accounts/all", "/api/accounts/transactions"):
            method = s.post if "link-token" in path else s.get
            r = method(f"{BASE_URL}{path}", headers=h, json={} if "link-token" in path else None, timeout=15)
            assert r.status_code == 402, f"{path} expected 402, got {r.status_code}: {r.text[:200]}"


# ---------- 2) Premium checkout is 410, products excludes jaleter_premium ----------
class TestPremiumStripeGone:
    def test_checkout_jaleter_premium_returns_410(self, s):
        _, tok = _register(s, "410")
        r = s.post(
            f"{BASE_URL}/api/payments/checkout",
            headers=_h(tok),
            json={"product": "jaleter_premium", "platform": "web"},
            timeout=15,
        )
        assert r.status_code == 410, r.text
        msg = (r.json().get("detail") or "").lower()
        assert "app store" in msg or "google play" in msg, msg

    def test_products_only_coaching(self, s):
        r = s.get(f"{BASE_URL}/api/payments/products", timeout=15)
        assert r.status_code == 200
        keys = {p["key"] for p in r.json().get("products", [])}
        assert "coaching_session" in keys
        assert "jaleter_premium" not in keys
        coaching = next(p for p in r.json()["products"] if p["key"] == "coaching_session")
        assert coaching["amount"] == 75 or coaching["amount"] == 7500  # 75 dollars or cents


# ---------- 3) Removed Stripe Premium routes → 404 ----------
class TestStripePremiumRoutesGone:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("POST", "/api/payments/webhook"),
            ("POST", "/api/payments/billing-portal"),
            ("POST", "/api/payments/cancel-at-period-end"),
            ("POST", "/api/payments/resume"),
        ],
    )
    def test_route_404(self, s, method, path):
        # No auth required for detecting 404 (route missing); if the route still
        # existed with auth it would return 401/422 — anything but 404 fails.
        r = s.request(method, f"{BASE_URL}{path}", json={}, timeout=15)
        assert r.status_code == 404, f"{path} should be 404, got {r.status_code}: {r.text[:200]}"


# ---------- 4) IAP sync grants entitlement + unlocks premium APIs ----------
class TestIapSyncActivatesMembership:
    def test_iap_sync_activates_and_unlocks_apis(self, s):
        _, tok = _register(s, "iap")
        h = _h(tok)
        exp = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat().replace("+00:00", "Z")
        r = s.post(
            f"{BASE_URL}/api/iap/sync",
            headers=h,
            json={"active": True, "expires_at": exp, "product_id": "prodd4613e9ecb", "platform": "ios"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "active": True}

        m = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        assert m["active"] is True
        assert m["source"] == "iap"
        assert m["billing_platform"] == "ios"
        assert m["cancel_at_period_end"] is False
        assert m["current_period_end"] is not None

        assert s.post(f"{BASE_URL}/api/plaid/link-token", headers=h, json={}, timeout=20).status_code == 200
        assert s.get(f"{BASE_URL}/api/accounts/all", headers=h, timeout=20).status_code == 200


# ---------- 5) Hardening: can't revoke, cap 400d, monotonic ----------
class TestIapHardening:
    def test_cannot_revoke_and_expiry_monotonic_and_capped(self, s):
        _, tok = _register(s, "hard")
        h = _h(tok)

        # Grant 1 year
        exp1 = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat().replace("+00:00", "Z")
        assert s.post(f"{BASE_URL}/api/iap/sync", headers=h, json={"active": True, "expires_at": exp1, "platform": "ios"}, timeout=15).status_code == 200
        m1 = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        pe1 = datetime.fromisoformat(m1["current_period_end"].replace("Z", "+00:00"))

        # Client tries to revoke → membership must stay active
        r_rev = s.post(f"{BASE_URL}/api/iap/sync", headers=h, json={"active": False}, timeout=15)
        assert r_rev.status_code == 200
        assert s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()["active"] is True

        # 3-year expiry: cap ≤400 days from now
        exp3 = (datetime.now(timezone.utc) + timedelta(days=3 * 365)).isoformat().replace("+00:00", "Z")
        assert s.post(f"{BASE_URL}/api/iap/sync", headers=h, json={"active": True, "expires_at": exp3, "platform": "ios"}, timeout=15).status_code == 200
        m2 = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        pe2 = datetime.fromisoformat(m2["current_period_end"].replace("Z", "+00:00"))
        max_allowed = datetime.now(timezone.utc) + timedelta(days=400, hours=1)
        assert pe2 <= max_allowed, f"period_end {pe2} exceeds 400d cap {max_allowed}"
        # But should not be shorter than the previous 1-year value
        assert pe2 >= pe1

        # Earlier expiry attempt must NOT shorten
        exp_short = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat().replace("+00:00", "Z")
        assert s.post(f"{BASE_URL}/api/iap/sync", headers=h, json={"active": True, "expires_at": exp_short, "platform": "ios"}, timeout=15).status_code == 200
        m3 = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        pe3 = datetime.fromisoformat(m3["current_period_end"].replace("Z", "+00:00"))
        assert pe3 >= pe2 - timedelta(seconds=2), f"expiry shortened: {pe3} < {pe2}"


# ---------- 6) Grandfathered Stripe legacy ----------
class TestLegacyStripeGrandfather:
    @pytest.mark.asyncio
    async def test_legacy_stripe_future_active(self, s):
        email, tok = _register(s, "lg1")
        h = _h(tok)

        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            end = datetime.now(timezone.utc) + timedelta(days=200)
            r = await db.users.update_one(
                {"email": email.lower()},
                {"$set": {
                    "subscription_status": "active",
                    "stripe_subscription_id": f"sub_test_{uuid.uuid4().hex[:10]}",
                    "subscription_current_period_end": end,
                }},
            )
            assert r.matched_count == 1
        finally:
            client.close()

        m = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        assert m["active"] is True
        assert m["source"] == "legacy_stripe"
        assert m["cancel_at_period_end"] is True
        assert m["current_period_end"] is not None
        assert s.get(f"{BASE_URL}/api/accounts/all", headers=h, timeout=20).status_code == 200

    @pytest.mark.asyncio
    async def test_legacy_stripe_past_period_inactive(self, s):
        email, tok = _register(s, "lg2")
        h = _h(tok)

        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            end = datetime.now(timezone.utc) - timedelta(days=30)
            await db.users.update_one(
                {"email": email.lower()},
                {"$set": {
                    "subscription_status": "active",
                    "stripe_subscription_id": f"sub_test_{uuid.uuid4().hex[:10]}",
                    "subscription_current_period_end": end,
                }},
            )
        finally:
            client.close()

        m = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        assert m["active"] is False
        assert s.get(f"{BASE_URL}/api/accounts/all", headers=h, timeout=20).status_code == 402

    @pytest.mark.asyncio
    async def test_legacy_stripe_active_no_period_end_inactive(self, s):
        email, tok = _register(s, "lg3")
        h = _h(tok)

        client = AsyncIOMotorClient(MONGO_URL)
        try:
            db = client[DB_NAME]
            await db.users.update_one(
                {"email": email.lower()},
                {"$set": {
                    "subscription_status": "active",
                    "stripe_subscription_id": f"sub_test_{uuid.uuid4().hex[:10]}",
                },
                 "$unset": {"subscription_current_period_end": ""}},
            )
        finally:
            client.close()

        m = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        assert m["active"] is False, f"user with active status but no period_end must not be active: {m}"


# ---------- 7) Review + admin accounts ----------
class TestPrivilegedAccounts:
    def test_app_review_admin_active(self, s):
        tok = _login(s, APP_REVIEW_EMAIL, APP_REVIEW_PASS)
        h = _h(tok)
        m = s.get(f"{BASE_URL}/api/user/membership", headers=h, timeout=15).json()
        assert m["active"] is True
        assert m["source"] == "admin", f"expected source=admin, got {m['source']}"
        assert s.get(f"{BASE_URL}/api/accounts/all", headers=h, timeout=20).status_code == 200

    def test_support_admin_active(self, s):
        tok = _login(s, ADMIN_EMAIL, ADMIN_PASS)
        m = s.get(f"{BASE_URL}/api/user/membership", headers=_h(tok), timeout=15).json()
        assert m["active"] is True


# ---------- 8) Coaching untouched ----------
class TestCoachingUntouched:
    def test_coaching_checkout_and_booking(self, s):
        _, tok = _register(s, "coach")
        h = _h(tok)
        r = s.post(
            f"{BASE_URL}/api/payments/checkout",
            headers=h,
            json={"product": "coaching_session", "platform": "web"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "url" in j and "session_id" in j and "booking_id" in j

        st = s.get(f"{BASE_URL}/api/payments/status/{j['session_id']}", headers=h, timeout=20)
        assert st.status_code == 200, st.text
        assert st.json().get("product") == "coaching_session"

        bl = s.get(f"{BASE_URL}/api/coaching/bookings", headers=h, timeout=15)
        assert bl.status_code == 200
        bookings = bl.json().get("bookings", [])
        assert any(b.get("booking_id") == j["booking_id"] for b in bookings)


# ---------- 9) Health / import sanity ----------
class TestHealthAndBoot:
    def test_health_ok(self, s):
        r = s.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
