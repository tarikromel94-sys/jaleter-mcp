"""Iteration 75 — Verify three fixes:
  1) POST /api/user/reset-data clears user financial data but preserves
     the user profile, Stripe subscription, Plaid connections, device tokens.
  2) DELETE /api/account is a working alias for DELETE /api/auth/delete-account.
  3) Enhanced delete-account retains an anonymised billing_receipts entry
     when the user had a Stripe customer id.
Also confirms the rate-limit on /api/user/reset-data (5/hour → 6th call = 429).

Uses synchronous pytest + a helper to run motor calls via asyncio.run so we
do not require pytest-asyncio (not installed in this env).
"""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient


# --- Helpers ----------------------------------------------------------------

def _load_public_backend_url() -> str:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        line = line.strip()
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return v.rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL missing")


def _load_backend_env(key: str) -> str:
    for line in Path("/app/backend/.env").read_text().splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return v
    raise RuntimeError(f"{key} missing from /app/backend/.env")


BASE_URL = _load_public_backend_url()
MONGO_URL = _load_backend_env("MONGO_URL")
DB_NAME = _load_backend_env("DB_NAME")


def _db_run(coro_factory):
    """Run an async factory that receives the db and returns a coroutine."""
    async def _inner():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            return await coro_factory(client[DB_NAME])
        finally:
            client.close()
    return asyncio.run(_inner())


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register_user(api, suffix: str = "") -> dict:
    uniq = uuid.uuid4().hex[:10]
    email = f"iter75-{suffix}-{uniq}@jaletertest.com"
    password = "TestPwd_iter75!aB"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": f"Iter75 {suffix}", "email": email, "password": password},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    user_id = (data.get("user") or {}).get("user_id") or data.get("user_id")
    assert token and user_id, f"missing token/user_id in {data}"
    return {"token": token, "user_id": user_id, "email": email, "password": password}


# ---------------------------------------------------------------------------
# 1) POST /api/user/reset-data — happy path + preservation
# ---------------------------------------------------------------------------
class TestResetData:
    def test_reset_data_deletes_scoped_preserves_plaid_and_user(self, api):
        user = _register_user(api, "reset")
        uid = user["user_id"]
        headers = {"Authorization": f"Bearer {user['token']}"}

        async def _seed(db):
            await db.transactions.insert_many([
                {"user_id": uid, "amount": 12.34, "desc": "TEST_iter75_a"},
                {"user_id": uid, "amount": 45.67, "desc": "TEST_iter75_b"},
                {"user_id": uid, "amount": 89.01, "desc": "TEST_iter75_c"},
            ])
            await db.budget_cells.insert_many([
                {"user_id": uid, "month": "2026-01", "cat": "food", "amount": 100},
                {"user_id": uid, "month": "2026-01", "cat": "gas", "amount": 50},
            ])
            await db.notifications.insert_one(
                {"user_id": uid, "title": "TEST_iter75", "body": "x"}
            )
            await db.import_mappings.insert_one(
                {"user_id": uid, "src": "TEST_iter75_map", "dst": "food"}
            )
            await db.linked_accounts.insert_one(
                {"user_id": uid, "link_id": f"lk_iter75_{uid}",
                 "org_name": "TEST_iter75_bank"}
            )
            await db.plaid_items.insert_one(
                {"user_id": uid, "item_id": f"pi_iter75_{uid}",
                 "access_token_encrypted": "gAAAAA_placeholder"}
            )
        _db_run(_seed)

        # Call reset-data
        r = api.post(
            f"{BASE_URL}/api/user/reset-data", headers=headers, json={}, timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        dc = body.get("deleted_counts") or {}
        assert dc.get("transactions") == 3, f"transactions={dc.get('transactions')} full={dc}"
        assert dc.get("budget_cells") == 2, f"budget_cells={dc.get('budget_cells')} full={dc}"
        assert dc.get("notifications") == 1, f"notifications={dc.get('notifications')} full={dc}"
        assert dc.get("import_mappings") == 1, f"import_mappings={dc.get('import_mappings')} full={dc}"

        async def _verify(db):
            la = await db.linked_accounts.count_documents({"user_id": uid})
            pi = await db.plaid_items.count_documents({"user_id": uid})
            u = await db.users.find_one({"user_id": uid})
            return la, pi, u
        la, pi, u = _db_run(_verify)
        assert la == 1, f"linked_accounts wrongly deleted (count={la})"
        assert pi == 1, f"plaid_items wrongly deleted (count={pi})"
        assert u is not None, "user row was wrongly deleted"

        # Cleanup
        async def _cleanup(db):
            await db.linked_accounts.delete_many({"user_id": uid})
            await db.plaid_items.delete_many({"user_id": uid})
            await db.users.delete_one({"user_id": uid})
        _db_run(_cleanup)

    def test_reset_data_rate_limit(self, api):
        """5/hour → 6th call within the hour must return 429."""
        user = _register_user(api, "ratelim")
        uid = user["user_id"]
        headers = {"Authorization": f"Bearer {user['token']}"}
        statuses = []
        for _ in range(6):
            r = api.post(
                f"{BASE_URL}/api/user/reset-data",
                headers=headers, json={}, timeout=20,
            )
            statuses.append(r.status_code)
        # First 5 succeed, 6th is 429 — but rate limiting is per-IP (slowapi
        # default), so a previous test in the same run may consume 1 slot.
        # We therefore assert that (a) all statuses are 200 or 429, (b) at
        # least one 429 is present by the 6th call, and (c) 200s appear
        # BEFORE any 429 (monotonic).
        assert all(s in (200, 429) for s in statuses), f"unexpected statuses: {statuses}"
        assert 429 in statuses, f"no rate-limit triggered in 6 calls: {statuses}"
        first_429 = statuses.index(429)
        # No 200 should appear after a 429 within the same window
        assert all(s == 429 for s in statuses[first_429:]), (
            f"non-429 after first 429 (rate limit leaky?): {statuses}"
        )

        # Cleanup
        async def _cleanup(db):
            await db.users.delete_one({"user_id": uid})
        _db_run(_cleanup)


# ---------------------------------------------------------------------------
# 2) DELETE /api/account alias
# ---------------------------------------------------------------------------
class TestDeleteAccountAlias:
    def test_delete_account_alias_purges_user_no_receipt_without_stripe(self, api):
        user = _register_user(api, "alias")
        uid = user["user_id"]

        async def _count_before(db):
            return await db.billing_receipts.count_documents({})
        receipts_before = _db_run(_count_before)

        r = api.delete(
            f"{BASE_URL}/api/account",
            headers={"Authorization": f"Bearer {user['token']}",
                     "Content-Type": "application/json"},
            json={"password": user["password"]},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True, body

        async def _verify(db):
            u = await db.users.find_one({"user_id": uid})
            n = await db.billing_receipts.count_documents({})
            return u, n
        u, receipts_after = _db_run(_verify)
        assert u is None, "user still present after DELETE /api/account"
        assert receipts_after == receipts_before, (
            f"billing_receipts increased ({receipts_before}->{receipts_after}) "
            "despite user having no stripe_customer_id"
        )


# ---------------------------------------------------------------------------
# 3) Delete-account with Stripe → anonymised billing_receipts retention
# ---------------------------------------------------------------------------
class TestDeleteAccountBillingRetention:
    def test_billing_receipt_retained_with_stripe_ids_no_pii(self, api):
        user = _register_user(api, "billing")
        uid = user["user_id"]

        async def _prep(db):
            await db.users.update_one(
                {"user_id": uid},
                {"$set": {
                    "stripe_customer_id": "cus_test_iter75",
                    "stripe_subscription_id": "sub_test_iter75",
                    "subscription_status": "active",
                }},
            )
            await db.billing_receipts.delete_many(
                {"stripe_customer_id": "cus_test_iter75"}
            )
        _db_run(_prep)

        r = api.delete(
            f"{BASE_URL}/api/auth/delete-account",
            headers={"Authorization": f"Bearer {user['token']}",
                     "Content-Type": "application/json"},
            json={"password": user["password"]},
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"

        async def _verify(db):
            u = await db.users.find_one({"user_id": uid})
            rec = await db.billing_receipts.find_one(
                {"stripe_customer_id": "cus_test_iter75"}
            )
            return u, rec
        u, rec = _db_run(_verify)
        assert u is None
        assert rec is not None, "billing_receipts entry missing"
        assert rec.get("stripe_customer_id") == "cus_test_iter75"
        assert rec.get("stripe_subscription_id") == "sub_test_iter75"
        # No PII
        assert "user_id" not in rec, f"user_id must NOT be in receipt: {rec}"
        assert "email" not in rec, f"email must NOT be in receipt: {rec}"
        assert "name" not in rec, f"name must NOT be in receipt: {rec}"
        assert rec.get("account_deleted_at") is not None

        # Cleanup
        async def _cleanup(db):
            await db.billing_receipts.delete_many(
                {"stripe_customer_id": "cus_test_iter75"}
            )
        _db_run(_cleanup)
