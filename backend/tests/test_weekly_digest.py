"""Weekly Digest backend tests (iteration 70).

Covers:
    - Prefs shape (weeklyDigest default + PUT/GET, invalid timezone dropped,
      valid timezone persisted)
    - `POST /api/notifications/weekly-digest/run-now` premium gating
    - Deterministic content (title/body + notification metadata)
    - Dedup via weekly_digest_state
    - Push relay resilience (placeholder key → delivery_status="failed")
    - `sweep_and_send` returns considered/sent/skipped structure
    - APScheduler job registered
"""
from __future__ import annotations

import os
import sys
import uuid
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Ensure we can import backend modules for the sweep/scheduler tests.
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

# CRITICAL: import server first so its module (and notifications_router,
# push_service, etc.) is fully loaded — otherwise importing
# weekly_digest_service directly triggers a circular import via
# `push_service`'s module-level `Depends(_require_current_user())`.
import server as _server  # noqa: F401,E402

FRONTEND_ENV = BACKEND_DIR.parent / "frontend" / ".env"
_public_url = None
if FRONTEND_ENV.exists():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            _public_url = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
BASE_URL = (_public_url or os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# ---- Shared session ----------------------------------------------------
_sync_client = MongoClient(MONGO_URL)
_sync_db = _sync_client[DB_NAME]


def _api(method: str, path: str, **kw) -> requests.Response:
    return requests.request(method, f"{BASE_URL}{path}", timeout=20, **kw)


# ---- Fixtures ----------------------------------------------------------
@pytest.fixture(scope="module")
def test_user():
    """Register a fresh test user and return {user_id, token, email}."""
    email = f"digest+{uuid.uuid4().hex[:10]}@jaleter.app"
    payload = {"name": "Digest Test", "email": email, "password": "password123"}
    r = _api("POST", "/api/auth/register", json=payload)
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    body = r.json()
    uid = body["user"]["user_id"]
    tok = body["token"]
    yield {"user_id": uid, "token": tok, "email": email}
    # Cleanup
    for coll in ("users", "bank_transactions", "notifications",
                 "weekly_digest_state", "alert_state"):
        _sync_db[coll].delete_many({"user_id": uid})
    _sync_db["users"].delete_one({"email": email})


@pytest.fixture(scope="module")
def admin_token():
    r = _api("POST", "/api/auth/login",
             json={"email": "support@jaleter.com", "password": "Tarik0731!"})
    if r.status_code != 200:
        pytest.skip(f"admin login failed: {r.status_code} {r.text}")
    return r.json()["token"]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _clear_dedup(user_id: str) -> None:
    _sync_db.weekly_digest_state.delete_many({"user_id": user_id})
    _sync_db.notifications.delete_many({"user_id": user_id, "type": "weekly_digest"})


def _make_premium(user_id: str) -> None:
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _sync_db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "subscription_status": "active",
            "stripe_customer_id": f"cus_test_{user_id}",
            "stripe_subscription_id": f"sub_test_{user_id}",
            "subscription_current_period_end": future,
        }},
    )


# ---- Section 1: Prefs shape --------------------------------------------
class TestPrefs:
    def test_get_prefs_includes_weekly_digest_default_true(self, test_user):
        r = _api("GET", "/api/notifications/prefs", headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        prefs = r.json()
        assert "weeklyDigest" in prefs
        assert prefs["weeklyDigest"] is True

    def test_put_prefs_weekly_digest_false_persists(self, test_user):
        body = {
            "enabled": True,
            "perCategory": {},
            "singleExpense": {"enabled": False, "threshold": 200},
            "weeklyDigest": False,
            "timezone": "America/Los_Angeles",
        }
        r = _api("PUT", "/api/notifications/prefs",
                 json=body, headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["weeklyDigest"] is False
        g = _api("GET", "/api/notifications/prefs", headers=_auth(test_user["token"]))
        assert g.json()["weeklyDigest"] is False
        # Timezone should have been stored
        u = _sync_db.users.find_one({"user_id": test_user["user_id"]})
        assert u.get("timezone") == "America/Los_Angeles"

    def test_put_prefs_invalid_timezone_silently_dropped(self, test_user):
        # Ensure stored tz first
        _sync_db.users.update_one(
            {"user_id": test_user["user_id"]},
            {"$set": {"timezone": "America/Los_Angeles"}},
        )
        body = {
            "enabled": True,
            "perCategory": {},
            "singleExpense": {"enabled": False, "threshold": 200},
            "weeklyDigest": True,
            "timezone": "Mars/Olympus",
        }
        r = _api("PUT", "/api/notifications/prefs",
                 json=body, headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        u = _sync_db.users.find_one({"user_id": test_user["user_id"]})
        # Invalid tz must NOT overwrite stored value
        assert u.get("timezone") == "America/Los_Angeles"

    def test_put_prefs_valid_timezone_updates_document(self, test_user):
        body = {
            "enabled": True,
            "perCategory": {},
            "singleExpense": {"enabled": False, "threshold": 200},
            "weeklyDigest": True,
            "timezone": "Europe/Berlin",
        }
        r = _api("PUT", "/api/notifications/prefs",
                 json=body, headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        u = _sync_db.users.find_one({"user_id": test_user["user_id"]})
        assert u.get("timezone") == "Europe/Berlin"


# ---- Section 2: run-now gating -----------------------------------------
class TestRunNowGating:
    def test_non_premium_gets_402(self, test_user):
        # Make sure test_user is not premium
        _sync_db.users.update_one(
            {"user_id": test_user["user_id"]},
            {"$unset": {"subscription_status": "", "stripe_customer_id": "",
                        "stripe_subscription_id": "",
                        "subscription_current_period_end": "",
                        "premium_expires_at": ""}},
        )
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(test_user["token"]))
        assert r.status_code == 402, f"expected 402 got {r.status_code}: {r.text}"

    def test_admin_gets_200(self, admin_token):
        admin_user = _sync_db.users.find_one({"email": "support@jaleter.com"})
        assert admin_user, "admin user missing"
        _clear_dedup(admin_user["user_id"])
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(admin_token))
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text}"
        body = r.json()
        assert "title" in body or "skipped" in body
        # cleanup admin dedup so re-runs are safe
        _clear_dedup(admin_user["user_id"])

    def test_faked_premium_gets_200_with_digest_shape(self, test_user):
        _make_premium(test_user["user_id"])
        _clear_dedup(test_user["user_id"])
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(test_user["token"]))
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text}"
        body = r.json()
        for k in ("notification_id", "week_key", "push_status", "title", "body"):
            assert k in body, f"missing key {k} in {body}"


# ---- Section 3: Deterministic content ---------------------------------
class TestContent:
    def _seed_transactions(self, uid: str):
        _sync_db.bank_transactions.delete_many({"user_id": uid})
        today = datetime.now(timezone.utc).date()
        # Anchor to a "this week" and "last week" date range.
        # weekday(): Mon=0 ... Sun=6
        this_monday = today - timedelta(days=today.weekday())
        last_monday = this_monday - timedelta(days=7)
        docs = [
            # This week — 3 spend rows + 1 transfer row (excluded) + 1 negative
            {"user_id": uid, "account_id": "a1", "external_id": f"e1_{uid}",
             "date": (this_monday + timedelta(days=1)).strftime("%Y-%m-%d"),
             "amount": 50.0, "merchant_name": "Starbucks", "name": "SBUX",
             "system_category": None},
            {"user_id": uid, "account_id": "a1", "external_id": f"e2_{uid}",
             "date": (this_monday + timedelta(days=2)).strftime("%Y-%m-%d"),
             "amount": 25.0, "merchant_name": "Starbucks", "name": "SBUX",
             "system_category": None},
            {"user_id": uid, "account_id": "a1", "external_id": f"e3_{uid}",
             "date": (this_monday + timedelta(days=3)).strftime("%Y-%m-%d"),
             "amount": 100.0, "merchant_name": "Amazon", "name": "AMZN",
             "system_category": None},
            {"user_id": uid, "account_id": "a1", "external_id": f"e4_{uid}",
             "date": (this_monday + timedelta(days=3)).strftime("%Y-%m-%d"),
             "amount": 500.0, "merchant_name": "TransferGuy", "name": "XFER",
             "system_category": "transfer"},   # must be excluded
            {"user_id": uid, "account_id": "a1", "external_id": f"e5_{uid}",
             "date": (this_monday + timedelta(days=4)).strftime("%Y-%m-%d"),
             "amount": -20.0, "merchant_name": "Refund", "name": "R",
             "system_category": None},        # negative → excluded (income)
            # Last week — 1 spend row
            {"user_id": uid, "account_id": "a1", "external_id": f"e6_{uid}",
             "date": (last_monday + timedelta(days=1)).strftime("%Y-%m-%d"),
             "amount": 100.0, "merchant_name": "Costco", "name": "CST",
             "system_category": None},
        ]
        _sync_db.bank_transactions.insert_many(docs)

    def test_deterministic_body_and_metadata(self, test_user):
        uid = test_user["user_id"]
        _make_premium(uid)
        _sync_db.users.update_one({"user_id": uid}, {"$set": {"timezone": "UTC"}})
        self._seed_transactions(uid)
        _clear_dedup(uid)
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title"] == "Your weekly Jaleter summary"
        assert "You spent $" in body["body"]
        # last-week total > 0, so we expect one of up/down/flat
        assert any(w in body["body"].lower() for w in ("up ", "down ", "flat")), body["body"]

        n = _sync_db.notifications.find_one({"_id": __import__("bson").ObjectId(body["notification_id"])})
        assert n, "notification row missing"
        assert n["type"] == "weekly_digest"
        md = n["metadata"]
        for k in ("total_this_week", "total_prev_week", "txn_count",
                  "top_merchant", "top_amount", "budget_alerts", "large_txns"):
            assert k in md, f"metadata missing {k}"
        # 3 spend rows (50 + 25 + 100 = 175), top merchant Starbucks (75)? No: Amazon (100) > Starbucks (75)
        assert md["txn_count"] == 3
        assert abs(md["total_this_week"] - 175.0) < 0.01
        assert abs(md["total_prev_week"] - 100.0) < 0.01
        assert md["top_merchant"] == "Amazon"

    def test_body_includes_budget_and_large_counts(self, test_user):
        uid = test_user["user_id"]
        _make_premium(uid)
        _sync_db.users.update_one({"user_id": uid}, {"$set": {"timezone": "UTC"}})
        self._seed_transactions(uid)
        # Insert dummy alerts inside this ISO week (UTC)
        now = datetime.now(timezone.utc)
        this_monday = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0)
        _sync_db.notifications.insert_many([
            {"user_id": uid, "type": "category_80",
             "title": "80%", "body": "x",
             "created_at": this_monday + timedelta(hours=6),
             "read_at": None, "sent_at": None, "delivery_status": "queued"},
            {"user_id": uid, "type": "category_80",
             "title": "80%", "body": "x",
             "created_at": this_monday + timedelta(hours=7),
             "read_at": None, "sent_at": None, "delivery_status": "queued"},
            {"user_id": uid, "type": "large_transaction",
             "title": "Large", "body": "x",
             "created_at": this_monday + timedelta(hours=8),
             "read_at": None, "sent_at": None, "delivery_status": "queued"},
        ])
        _clear_dedup(uid)
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()["body"]
        assert "budget alert" in body, body
        assert "large txn" in body, body
        # Cleanup the injected alert rows
        _sync_db.notifications.delete_many(
            {"user_id": uid, "type": {"$in": ["category_80", "large_transaction"]}})

    def test_zero_activity_message(self, test_user):
        uid = test_user["user_id"]
        _make_premium(uid)
        _sync_db.users.update_one({"user_id": uid}, {"$set": {"timezone": "UTC"}})
        # Wipe all transactions for user
        _sync_db.bank_transactions.delete_many({"user_id": uid})
        _clear_dedup(uid)
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["body"] == "No spending activity this week. Enjoy the calm."


# ---- Section 4: Dedup --------------------------------------------------
class TestDedup:
    def test_second_run_is_skipped(self, test_user):
        uid = test_user["user_id"]
        _make_premium(uid)
        _sync_db.users.update_one({"user_id": uid}, {"$set": {"timezone": "UTC"}})
        _clear_dedup(uid)
        r1 = _api("POST", "/api/notifications/weekly-digest/run-now",
                  headers=_auth(test_user["token"]))
        assert r1.status_code == 200, r1.text
        week_key_1 = r1.json()["week_key"]
        # count notifications
        count_after_first = _sync_db.notifications.count_documents(
            {"user_id": uid, "type": "weekly_digest"})

        r2 = _api("POST", "/api/notifications/weekly-digest/run-now",
                  headers=_auth(test_user["token"]))
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("skipped") == "already_sent"
        assert body.get("week_key") == week_key_1
        count_after_second = _sync_db.notifications.count_documents(
            {"user_id": uid, "type": "weekly_digest"})
        assert count_after_second == count_after_first

    def test_dedup_key_format(self, test_user):
        uid = test_user["user_id"]
        rows = list(_sync_db.weekly_digest_state.find({"user_id": uid}))
        assert rows, "expected a dedup row"
        # format u/<user_id>/<YYYY>-W<ISO_WEEK>
        for row in rows:
            assert row["_id"].startswith(f"u/{uid}/")
            tail = row["_id"].split("/")[-1]
            assert "-W" in tail, tail
            year, wk = tail.split("-W")
            assert year.isdigit() and len(year) == 4
            assert wk.isdigit() and len(wk) == 2


# ---- Section 5: Push relay resilience ---------------------------------
class TestPushResilience:
    def test_push_failure_still_returns_200_and_persists(self, test_user):
        """`EMERGENT_PUSH_KEY=placeholder` → upstream 401. Notif persisted
        with delivery_status=='failed' and sent_at set."""
        uid = test_user["user_id"]
        _make_premium(uid)
        _sync_db.users.update_one({"user_id": uid}, {"$set": {"timezone": "UTC"}})
        _clear_dedup(uid)
        r = _api("POST", "/api/notifications/weekly-digest/run-now",
                 headers=_auth(test_user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("push_status") == "failed"
        n = _sync_db.notifications.find_one(
            {"_id": __import__("bson").ObjectId(body["notification_id"])})
        assert n["delivery_status"] == "failed"
        assert n["sent_at"] is not None
        assert isinstance(n["sent_at"], datetime)


# ---- Section 6: sweep_and_send (direct) --------------------------------
class TestSweep:
    def test_sweep_returns_dict_with_expected_keys(self, test_user):
        import weekly_digest_service as wd

        async def _run():
            motor_client = AsyncIOMotorClient(MONGO_URL, tz_aware=True)
            db = motor_client[DB_NAME]
            try:
                return await wd.sweep_and_send(db)
            finally:
                motor_client.close()

        result = asyncio.get_event_loop().run_until_complete(_run()) \
            if False else asyncio.new_event_loop().run_until_complete(_run())
        for k in ("considered", "sent", "skipped"):
            assert k in result, f"missing key {k} in {result}"
        assert result["sent"] >= 0


# ---- Section 7: Scheduler health ---------------------------------------
class TestScheduler:
    def test_job_registered(self):
        import weekly_digest_service as wd

        async def _run():
            started_locally = False
            if wd._scheduler is None:
                motor_client = AsyncIOMotorClient(MONGO_URL, tz_aware=True)
                wd.start_scheduler(motor_client[DB_NAME])
                started_locally = True
            try:
                assert wd._scheduler is not None
                jobs = wd._scheduler.get_jobs()
                names = [j.id for j in jobs]
                assert "weekly_digest_sweep" in names, names
            finally:
                if started_locally:
                    wd.stop_scheduler()
                    assert wd._scheduler is None

        asyncio.new_event_loop().run_until_complete(_run())

    def test_stop_scheduler_clears_state(self):
        import weekly_digest_service as wd

        async def _run():
            motor_client = AsyncIOMotorClient(MONGO_URL, tz_aware=True)
            saved = wd._scheduler
            wd._scheduler = None
            try:
                wd.start_scheduler(motor_client[DB_NAME])
                assert wd._scheduler is not None
                wd.stop_scheduler()
                assert wd._scheduler is None
            finally:
                wd._scheduler = saved
                motor_client.close()

        asyncio.new_event_loop().run_until_complete(_run())
