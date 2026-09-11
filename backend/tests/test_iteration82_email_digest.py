"""Iteration 82 — Alert email delivery + email digest queueing.

Tests items A1..A6 from the review request:
  A1  Budget alert @ 80% with emailFrequency=instant → email_status='sent',
      push_status='failed' (preview push placeholder), delivery_status='sent'.
  A2  PUT emailFrequency='daily' persists round-trip; invalid ('hourly')
      normalizes to 'instant'.
  A3  With emailFrequency='daily', evaluate-budget → email_status='queued',
      delivery_status='queued'.
  A4  POST /email-digest/run-now flushes queued alerts → {sent, count>0},
      queued notifs flip to email_status='sent' + delivery_status='sent';
      second run-now → {skipped: 'empty'}.
  A5  evaluate-transaction with amount>=singleExpense threshold respects
      emailFrequency (queued when daily, sent when instant).
  A6  Reset user's emailFrequency back to 'instant'.
"""
from __future__ import annotations
import os
import random
import string
import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://no-changes-mobile.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

REVIEW_EMAIL = "jaleter.appreview@gmail.com"
REVIEW_PW = "Jaleter029496!"

PERIOD = "2026-01"


def _rand_suffix() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


# Unique sub_ids/tx ids per run so alert_state dedupe never collides with prior iterations
RUN = f"iter82_{_rand_suffix()}"
SUB_INSTANT = f"ta_{RUN}_i"
SUB_DAILY = f"ta_{RUN}_d"
TX_INSTANT = f"tx_{RUN}_i"
TX_DAILY = f"tx_{RUN}_d"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def auth(s):
    r = s.post(f"{API}/auth/login", json={"email": REVIEW_EMAIL, "password": REVIEW_PW})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    return {
        "token": j["token"],
        "user_id": j["user"]["user_id"],
        "headers": {"Authorization": f"Bearer {j['token']}", "Content-Type": "application/json"},
    }


@pytest.fixture(scope="module", autouse=True)
def _prep_and_cleanup(mongo, auth):
    """Baseline: emailFrequency=instant, singleExpense.enabled=True/500,
    perCategory ON for our sub_ids. Clean any prior iter82 rows first."""
    user_id = auth["user_id"]
    # wipe any leftover state from a prior partial run
    mongo.alert_state.delete_many({"_id": {"$regex": f"^u/{user_id}/.+/{RUN}"}})
    mongo.notifications.delete_many({
        "user_id": user_id,
        "$or": [
            {"category_id": {"$in": [SUB_INSTANT, SUB_DAILY]}},
            {"transaction_id": {"$in": [TX_INSTANT, TX_DAILY]}},
        ],
    })
    # any queued alerts leftover on the review account from other tests?
    # drain them via update so run-now dedupe tests are deterministic
    mongo.notifications.update_many(
        {"user_id": user_id, "email_status": "queued"},
        {"$set": {"email_status": "skipped_test_cleanup"}},
    )

    # baseline prefs
    body = {
        "enabled": True,
        "perCategory": {
            SUB_INSTANT: {"p50": False, "p80": True, "exceeded": True},
            SUB_DAILY: {"p50": False, "p80": True, "exceeded": True},
        },
        "singleExpense": {"enabled": True, "threshold": 500},
        "weeklyDigest": True,
        "emailFrequency": "instant",
    }
    import requests as _rq
    _rq.put(f"{API}/notifications/prefs", headers=auth["headers"], json=body)
    yield
    # ---- cleanup ----
    # A6: emailFrequency back to instant + defaults
    _rq.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
        "enabled": True,
        "perCategory": {},
        "singleExpense": {"enabled": False, "threshold": 200},
        "weeklyDigest": True,
        "emailFrequency": "instant",
    })
    # remove synthetic notifications + dedupe slots
    mongo.notifications.delete_many({
        "user_id": user_id,
        "$or": [
            {"category_id": {"$in": [SUB_INSTANT, SUB_DAILY]}},
            {"transaction_id": {"$in": [TX_INSTANT, TX_DAILY]}},
        ],
    })
    mongo.alert_state.delete_many({"_id": {"$regex": f"^u/{user_id}/.+/ta_{RUN}"}})
    mongo.alert_state.delete_many({"_id": {"$regex": f"^u/{user_id}/tx/tx_{RUN}"}})


# ---------- A2. Prefs round-trip for emailFrequency ----------
class TestA2PrefsEmailFrequency:
    def test_daily_persists(self, s, auth):
        r = s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True, "perCategory": {}, "singleExpense": {"enabled": True, "threshold": 500},
            "weeklyDigest": True, "emailFrequency": "daily",
        })
        assert r.status_code == 200, r.text
        assert r.json()["emailFrequency"] == "daily"
        g = s.get(f"{API}/notifications/prefs", headers=auth["headers"])
        assert g.status_code == 200
        assert g.json()["emailFrequency"] == "daily"

    def test_invalid_normalizes_to_instant(self, s, auth):
        r = s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True, "perCategory": {}, "singleExpense": {"enabled": True, "threshold": 500},
            "weeklyDigest": True, "emailFrequency": "hourly",
        })
        assert r.status_code == 200
        assert r.json()["emailFrequency"] == "instant"
        g = s.get(f"{API}/notifications/prefs", headers=auth["headers"])
        assert g.json()["emailFrequency"] == "instant"


# ---------- A1. Instant email delivery ----------
class TestA1InstantEmail:
    def test_instant_budget_alert_sends_email(self, s, auth, mongo):
        # Force instant + baseline perCategory
        s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True,
            "perCategory": {SUB_INSTANT: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 500},
            "weeklyDigest": True,
            "emailFrequency": "instant",
        })
        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_INSTANT, "name": "Dining", "parent_name": "Food",
            "budget": 1000, "spent": 850,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1, created
        n = created[0]
        assert n["type"] == "category_80"
        # server serialization returns email_status/push_status/delivery_status in the persisted doc
        # Fetch from Mongo to be sure
        doc = mongo.notifications.find_one({"_id": ObjectId(n["id"])})
        assert doc is not None
        assert doc.get("email_status") == "sent", f"expected email sent, got {doc.get('email_status')}"
        assert doc.get("push_status") == "failed", f"expected push failed in preview, got {doc.get('push_status')}"
        assert doc.get("delivery_status") == "sent", f"expected overall sent, got {doc.get('delivery_status')}"


# ---------- A3. Daily queueing ----------
class TestA3DailyQueued:
    def test_daily_budget_alert_queues_email(self, s, auth, mongo):
        s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True,
            "perCategory": {SUB_DAILY: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 500},
            "weeklyDigest": True,
            "emailFrequency": "daily",
        })
        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_DAILY, "name": "Dining", "parent_name": "Food",
            "budget": 1000, "spent": 850,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1
        n = created[0]
        assert n["type"] == "category_80"
        doc = mongo.notifications.find_one({"_id": ObjectId(n["id"])})
        assert doc.get("email_status") == "queued", doc
        assert doc.get("delivery_status") == "queued", doc
        # Push is still attempted instantly (fails in preview — placeholder key)
        assert doc.get("push_status") == "failed", doc


# ---------- A5. TX alert respects emailFrequency ----------
class TestA5TransactionEmailMode:
    def test_daily_large_tx_queues(self, s, auth, mongo):
        # We are still on emailFrequency=daily from A3
        r = s.post(f"{API}/notifications/evaluate-transaction",
                   headers=auth["headers"],
                   json={"id": TX_DAILY, "amount": 750, "name": "Amazon"})
        assert r.status_code == 200
        c = r.json()["created"]
        assert c is not None
        assert c["type"] == "large_transaction"
        doc = mongo.notifications.find_one({"_id": ObjectId(c["id"])})
        assert doc.get("email_status") == "queued", doc.get("email_status")
        assert doc.get("delivery_status") == "queued", doc.get("delivery_status")

    def test_instant_large_tx_sends(self, s, auth, mongo):
        # Switch back to instant, fire a fresh tx
        s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True, "perCategory": {},
            "singleExpense": {"enabled": True, "threshold": 500},
            "weeklyDigest": True, "emailFrequency": "instant",
        })
        r = s.post(f"{API}/notifications/evaluate-transaction",
                   headers=auth["headers"],
                   json={"id": TX_INSTANT, "amount": 900, "name": "Best Buy"})
        assert r.status_code == 200
        c = r.json()["created"]
        assert c is not None
        doc = mongo.notifications.find_one({"_id": ObjectId(c["id"])})
        assert doc.get("email_status") == "sent", doc.get("email_status")
        assert doc.get("push_status") == "failed", doc.get("push_status")
        assert doc.get("delivery_status") == "sent", doc.get("delivery_status")


# ---------- A4. Digest run-now flushes queued alerts ----------
class TestA4DigestRunNow:
    def test_run_now_flushes_and_dedupes(self, s, auth, mongo):
        # At this point A3+A5 have created 2 queued docs (SUB_DAILY, TX_DAILY).
        user_id = auth["user_id"]
        before_queued = mongo.notifications.count_documents(
            {"user_id": user_id, "email_status": "queued"}
        )
        assert before_queued >= 2, f"expected >=2 queued alerts, got {before_queued}"

        r = s.post(f"{API}/notifications/email-digest/run-now", headers=auth["headers"])
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("sent") is True, j
        assert j.get("count", 0) >= 2, j

        # Those docs should now be flipped
        still_queued = mongo.notifications.count_documents(
            {"user_id": user_id, "email_status": "queued"}
        )
        assert still_queued == 0, still_queued

        # Verify our specific docs flipped
        for cat_or_tx in [{"category_id": SUB_DAILY}, {"transaction_id": TX_DAILY}]:
            q = {"user_id": user_id, **cat_or_tx}
            d = mongo.notifications.find_one(q)
            assert d is not None
            assert d.get("email_status") == "sent", (cat_or_tx, d.get("email_status"))
            assert d.get("delivery_status") == "sent", (cat_or_tx, d.get("delivery_status"))

        # Second run-now: no queued left → skipped
        r2 = s.post(f"{API}/notifications/email-digest/run-now", headers=auth["headers"])
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2.get("skipped") == "empty", j2


# ---------- A6. Final cleanup: emailFrequency back to instant ----------
class TestA6ResetInstant:
    def test_reset_to_instant(self, s, auth):
        r = s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True, "perCategory": {},
            "singleExpense": {"enabled": False, "threshold": 200},
            "weeklyDigest": True, "emailFrequency": "instant",
        })
        assert r.status_code == 200
        assert r.json()["emailFrequency"] == "instant"
        g = s.get(f"{API}/notifications/prefs", headers=auth["headers"])
        assert g.json()["emailFrequency"] == "instant"
