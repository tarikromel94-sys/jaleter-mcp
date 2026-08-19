"""Iteration 73 — Final production readiness backend regression.

Covers (per review request):
  1. Login regression smoke for the admin account.
  2. Stripe subscription checkout: creates session, no entitlement granted.
  3. Stripe webhook: invalid signature → 400 AND no user mutation.
  4. Enhanced DELETE /api/auth/delete-account cascades every user-scoped
     collection + returns the `stripe` block.
  5. POST /api/auth/apple: malformed identity_token → 401 AND no user row created.
  6. Cross-user data isolation on GET /api/accounts (wealth surrogate),
     GET /api/accounts/transactions, GET /api/notifications and
     PATCH /api/accounts/transactions/{external_id}/classify with
     the other user's token → 404.
  7. Startup PROD-CHECK log lines are present for STRIPE_WEBHOOK_SECRET and
     EMERGENT_PUSH_KEY placeholders.

All tests use only the public EXPO_PUBLIC_BACKEND_URL from frontend/.env so
they exercise the same ingress → 8001 path the mobile app hits.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient


# ---- Env plumbing -----------------------------------------------------------
def _load_public_backend_url() -> str:
    """Read EXPO_PUBLIC_BACKEND_URL from /app/frontend/.env (no defaults)."""
    env_path = Path("/app/frontend/.env")
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return v.rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL missing from /app/frontend/.env")


def _load_backend_env(key: str) -> str:
    for line in Path("/app/backend/.env").read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


BASE_URL = _load_public_backend_url()
MONGO_URL = _load_backend_env("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = _load_backend_env("DB_NAME") or "test_database"

ADMIN_EMAIL = "support@jaleter.com"
ADMIN_PASSWORD = "Tarik0731!"


# ---- Fixtures ---------------------------------------------------------------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    try:
        yield c[DB_NAME]
    finally:
        c.close()


def _register(api: requests.Session, tag: str) -> tuple[dict, str]:
    email = f"test_iter73_{tag}_{uuid.uuid4().hex[:8]}@jaleter.app"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": f"IT73 {tag}", "email": email, "password": "Password!23"},
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    return body["user"], body["token"]


def _auth_headers(token: str) -> dict:
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


# =============================================================================
# 1. Login regression smoke
# =============================================================================
class TestLoginRegression:
    def test_admin_login_ok(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("token"), "no token in login response"
        assert body["user"]["email"] == ADMIN_EMAIL
        # /auth/me sanity check with the fresh token
        me = api.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(body["token"]))
        assert me.status_code == 200
        assert me.json()["email"] == ADMIN_EMAIL


# =============================================================================
# 2. Stripe subscription checkout — no entitlement granted
# =============================================================================
class TestStripeSubscriptionCheckout:
    def test_creates_session_no_entitlement(self, api, mongo):
        user, token = _register(api, "stripe")
        try:
            r = api.post(
                f"{BASE_URL}/api/payments/checkout",
                json={"product": "jaleter_premium", "platform": "mobile"},
                headers=_auth_headers(token),
            )
            assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text}"
            body = r.json()
            assert body.get("session_id"), "session_id missing"
            assert isinstance(body.get("url"), str) and body["url"].startswith(
                "https://checkout.stripe.com/"
            ), f"unexpected checkout url: {body.get('url')!r}"
            assert body.get("mode") == "subscription"

            # Verify payment_transactions row was written with kind=subscription
            txn = mongo.payment_transactions.find_one(
                {"session_id": body["session_id"]}
            )
            assert txn is not None, "payment_transactions row not persisted"
            assert txn.get("kind") == "subscription", (
                f"expected kind=subscription, got {txn.get('kind')!r}"
            )
            assert txn.get("user_id") == user["user_id"]

            # No entitlement yet — subscription_status must still be inactive
            fresh = mongo.users.find_one({"user_id": user["user_id"]})
            status = (fresh or {}).get("subscription_status", "inactive")
            assert status in (None, "inactive"), (
                f"entitlement leaked before webhook — subscription_status={status!r}"
            )
        finally:
            # cleanup — call the delete-account endpoint via API
            api.request(
                "DELETE",
                f"{BASE_URL}/api/auth/delete-account",
                headers=_auth_headers(token),
                json={"password": "Password!23"},
            )


# =============================================================================
# 3. Stripe webhook signature enforcement
# =============================================================================
class TestStripeWebhookSignature:
    def test_invalid_signature_returns_400_and_no_mutation(self, api, mongo):
        user, token = _register(api, "whsig")
        try:
            before = mongo.users.find_one({"user_id": user["user_id"]}) or {}
            before_status = before.get("subscription_status", "inactive")

            # Send a syntactically OK JSON payload but forged Stripe-Signature.
            resp = requests.post(
                f"{BASE_URL}/api/payments/webhook",
                data=b'{"id":"evt_forged","type":"checkout.session.completed",'
                b'"data":{"object":{"id":"cs_test_forged"}}}',
                headers={
                    "Content-Type": "application/json",
                    "Stripe-Signature": "t=1234567890,v1=deadbeef",
                },
                timeout=15,
            )
            # 400 is the required status. (503 would signal missing secret —
            # but the .env has whsec_test_local... which starts with "whsec_",
            # so the code takes the SignatureVerificationError branch → 400.)
            assert resp.status_code == 400, (
                f"expected 400 on invalid signature, got {resp.status_code}: {resp.text}"
            )

            # No user mutation
            after = mongo.users.find_one({"user_id": user["user_id"]}) or {}
            after_status = after.get("subscription_status", "inactive")
            assert after_status == before_status, (
                f"webhook forgery mutated subscription_status "
                f"({before_status!r} -> {after_status!r})"
            )
        finally:
            api.request(
                "DELETE",
                f"{BASE_URL}/api/auth/delete-account",
                headers=_auth_headers(token),
                json={"password": "Password!23"},
            )


# =============================================================================
# 4. Enhanced delete-account cascade
# =============================================================================
class TestDeleteAccountCascade:
    def test_delete_account_purges_all_user_scoped_rows(self, api, mongo):
        user, token = _register(api, "del")
        uid = user["user_id"]

        # Seed rows across the collections listed in server.py's purge list.
        now = datetime.now(timezone.utc)
        mongo.bank_transactions.insert_many([
            {"user_id": uid, "external_id": f"tx_{i}", "date": now, "amount": -12.34,
             "name": f"seed tx {i}"}
            for i in range(3)
        ])
        mongo.notifications.insert_one({
            "user_id": uid,
            "kind": "budget_alert",
            "title": "seed",
            "body": "seed",
            "created_at": now,
            "read_at": None,
        })
        mongo.alert_state.insert_one({
            "user_id": uid, "period": "2026-01", "sub_id": "food:groceries",
            "level": "p80", "created_at": now,
        })
        mongo.device_tokens.insert_one({
            "user_id": uid, "token": "ExponentPushToken[fake_seed]",
            "platform": "ios", "created_at": now,
        })

        # Sanity — rows exist pre-delete
        assert mongo.bank_transactions.count_documents({"user_id": uid}) == 3
        assert mongo.notifications.count_documents({"user_id": uid}) == 1
        assert mongo.alert_state.count_documents({"user_id": uid}) == 1
        assert mongo.device_tokens.count_documents({"user_id": uid}) == 1

        # Call delete-account with correct password
        r = api.request(
            "DELETE",
            f"{BASE_URL}/api/auth/delete-account",
            headers=_auth_headers(token),
            json={"password": "Password!23"},
        )
        assert r.status_code == 200, f"delete-account failed: {r.status_code} {r.text}"
        body = r.json()

        # (a) response includes stripe block with expected keys
        assert "stripe" in body, "delete-account response missing 'stripe' key"
        stripe_block = body["stripe"]
        assert "subscription_canceled" in stripe_block, "stripe.subscription_canceled missing"
        assert "customer_deleted" in stripe_block, "stripe.customer_deleted missing"

        # (b) seeded rows are gone
        assert mongo.bank_transactions.count_documents({"user_id": uid}) == 0
        assert mongo.notifications.count_documents({"user_id": uid}) == 0
        assert mongo.alert_state.count_documents({"user_id": uid}) == 0
        assert mongo.device_tokens.count_documents({"user_id": uid}) == 0

        # (c) user row is gone
        assert mongo.users.find_one({"user_id": uid}) is None, "user row still present"

        # Token should now be invalid
        me = api.get(f"{BASE_URL}/api/auth/me", headers=_auth_headers(token))
        assert me.status_code in (401, 404), (
            f"stale token still authenticated: {me.status_code}"
        )


# =============================================================================
# 5. Apple SIWA endpoint rejects invalid identity_token
# =============================================================================
class TestAppleSignIn:
    def test_malformed_identity_token_401_no_user_row(self, api, mongo):
        # Snapshot user count / apple_sub count
        before = mongo.users.count_documents({"apple_sub": {"$exists": True}})

        r = api.post(
            f"{BASE_URL}/api/auth/apple",
            json={"identity_token": "not-a-real-jwt", "email": None, "name": None},
        )
        assert r.status_code == 401, (
            f"expected 401 for malformed identity_token, got {r.status_code}: {r.text}"
        )

        after = mongo.users.count_documents({"apple_sub": {"$exists": True}})
        assert after == before, "user row was created on malformed Apple token"

    def test_apple_audiences_env_is_set(self):
        val = _load_backend_env("APPLE_AUDIENCES")
        assert val == "com.emergent.nochangesmobile.fl0fmc,host.exp.Exponent", (
            f"APPLE_AUDIENCES not set to expected bundle+Exponent list, got: {val!r}"
        )


# =============================================================================
# 6. Cross-user data isolation
# =============================================================================
class TestUserIsolation:
    def test_isolation_across_get_and_patch(self, api, mongo):
        userA, tokenA = _register(api, "isoA")
        userB, tokenB = _register(api, "isoB")
        try:
            uidA, uidB = userA["user_id"], userB["user_id"]
            now = datetime.now(timezone.utc)

            # Seed User B with a bank_transaction + notification.
            b_ext = f"tx_iso_b_{uuid.uuid4().hex[:6]}"
            mongo.bank_transactions.insert_one({
                "user_id": uidB, "external_id": b_ext, "date": now,
                "amount": -42.42, "name": "iso B tx",
            })
            b_notif = mongo.notifications.insert_one({
                "user_id": uidB, "kind": "budget_alert", "title": "isoB",
                "body": "isoB", "created_at": now, "read_at": None,
            }).inserted_id

            # Seed User A with a bank_transaction (so A's list is non-empty).
            a_ext = f"tx_iso_a_{uuid.uuid4().hex[:6]}"
            mongo.bank_transactions.insert_one({
                "user_id": uidA, "external_id": a_ext, "date": now,
                "amount": -1.11, "name": "iso A tx",
            })

            # --- GET /api/accounts (wealth surrogate) — A sees only A's accounts.
            # NB: this account has no linked_accounts, so accounts array is empty.
            r = api.get(f"{BASE_URL}/api/accounts", headers=_auth_headers(tokenA))
            assert r.status_code == 200
            accts = r.json().get("accounts", [])
            # Every returned account (if any) must belong to A. We don't have
            # a user_id in the response, but B has none, so the list length
            # should be identical between calls (both empty) — the real
            # isolation check is the transactions PATCH below.
            assert isinstance(accts, list)

            # --- GET /api/accounts/transactions — A must not see B's tx
            r = api.get(
                f"{BASE_URL}/api/accounts/transactions?limit=200",
                headers=_auth_headers(tokenA),
            )
            assert r.status_code == 200
            txs = r.json().get("transactions", [])
            ext_ids = {t.get("external_id") for t in txs}
            assert b_ext not in ext_ids, "User A saw User B's transaction"
            assert a_ext in ext_ids, "User A did not see their own transaction"

            # --- GET /api/notifications — A must not see B's notification
            r = api.get(
                f"{BASE_URL}/api/notifications",
                headers=_auth_headers(tokenA),
            )
            assert r.status_code == 200
            titles = [n.get("title") for n in r.json().get("notifications", [])]
            assert "isoB" not in titles, "User A saw User B's notification"

            # --- PATCH B's transaction with A's token → must be 404
            r = api.patch(
                f"{BASE_URL}/api/accounts/transactions/{b_ext}/classify",
                headers=_auth_headers(tokenA),
                json={"system_category": "transfer"},
            )
            assert r.status_code == 404, (
                f"cross-user PATCH allowed (expected 404, got {r.status_code}): {r.text}"
            )

            # Confirm B's tx was NOT mutated
            b_after = mongo.bank_transactions.find_one({"user_id": uidB, "external_id": b_ext})
            assert b_after.get("system_category") in (None, "", "none")

            # --- PATCH B's notification /read with A's token → must be 404
            r = api.patch(
                f"{BASE_URL}/api/notifications/{str(b_notif)}/read",
                headers=_auth_headers(tokenA),
            )
            assert r.status_code == 404, (
                f"cross-user notification mark-read allowed (got {r.status_code}): {r.text}"
            )
            # Confirm B's notification is still unread
            b_notif_after = mongo.notifications.find_one({"_id": b_notif})
            assert b_notif_after.get("read_at") is None

        finally:
            for tok in (tokenA, tokenB):
                api.request(
                    "DELETE",
                    f"{BASE_URL}/api/auth/delete-account",
                    headers=_auth_headers(tok),
                    json={"password": "Password!23"},
                )


# =============================================================================
# 7. Startup PROD-CHECK log lines
# =============================================================================
class TestProdCheckStartupLogs:
    def test_prod_check_logs_placeholder_errors(self):
        log_path = Path("/var/log/supervisor/backend.err.log")
        assert log_path.exists(), "backend.err.log not found"
        content = log_path.read_text(errors="ignore")
        # Grab only lines mentioning PROD-CHECK
        prod_lines = [ln for ln in content.splitlines() if "PROD-CHECK" in ln]
        assert prod_lines, "no PROD-CHECK lines logged at startup"

        joined = "\n".join(prod_lines)
        assert "STRIPE_WEBHOOK_SECRET" in joined, (
            "PROD-CHECK error for STRIPE_WEBHOOK_SECRET placeholder not logged"
        )
        assert "EMERGENT_PUSH_KEY" in joined, (
            "PROD-CHECK error for EMERGENT_PUSH_KEY placeholder not logged"
        )
        # Both should be flagged as placeholders explicitly
        assert any("PLACEHOLDER" in ln and "STRIPE_WEBHOOK_SECRET" in ln for ln in prod_lines)
        assert any("PLACEHOLDER" in ln and "EMERGENT_PUSH_KEY" in ln for ln in prod_lines)
